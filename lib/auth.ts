/**
 * Sign-in by one-time link. Provider-specific logic only; shared session
 * primitives live in lib/auth-session.ts.
 */

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, sql as raw } from "drizzle-orm";
import { db, loginTokens, sessions, users } from "@/db";
import {
  looksLikeEmail,
  normaliseEmail,
  secret,
  sessionCookieName,
  sha256,
  startSession,
} from "./auth-session";

export { normaliseEmail, looksLikeEmail } from "./auth-session";

const TOKEN_TTL_MIN = 15;
const RATE_LIMIT = 5;
const RATE_WINDOW_MIN = 15;

export type SignInRequest =
  | { ok: true; url: string }
  | { ok: false; reason: "invalid" | "rate-limited" | "age-required" };

export async function requestSignIn(
  rawEmail: string,
  origin: string,
  ageConfirmed: boolean
): Promise<SignInRequest> {
  // Every existing user was grandfathered at the age-gate migration, so any
  // real request coming through requestSignIn is either an existing player
  // (who already has ageConfirmedAt stamped) or a new one (who has to tick
  // the box now). We enforce here so a crafted POST that omits the field
  // cannot create a user with no confirmation on record.
  if (!ageConfirmed) return { ok: false, reason: "age-required" };
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  jar.set("age_ok", "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TOKEN_TTL_MIN * 60,
  });
  const email = normaliseEmail(rawEmail);
  if (!looksLikeEmail(email)) return { ok: false, reason: "invalid" };

  const since = new Date(Date.now() - RATE_WINDOW_MIN * 60_000);
  const [{ count }] = await db
    .select({ count: raw<number>`count(*)::int` })
    .from(loginTokens)
    .where(and(eq(loginTokens.email, email), gt(loginTokens.createdAt, since)));
  if (count >= RATE_LIMIT) return { ok: false, reason: "rate-limited" };

  const token = secret();
  await db.insert(loginTokens).values({
    tokenHash: sha256(token),
    email,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MIN * 60_000),
  });

  const url = new URL("/api/auth/callback", origin);
  url.searchParams.set("token", token);
  return { ok: true, url: url.toString() };
}

export async function consumeSignIn(token: string): Promise<string | null> {
  if (!token) return null;

  const claimed = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(loginTokens.tokenHash, sha256(token)),
        gt(loginTokens.expiresAt, new Date()),
        raw`${loginTokens.usedAt} is null`
      )
    )
    .returning({ email: loginTokens.email });

  const email = claimed[0]?.email;
  if (!email) return null;

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let userId = existing[0]?.id;

  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const ageOk = jar.get("age_ok")?.value === "1";
  jar.delete("age_ok");

  if (!userId) {
    userId = randomBytes(16).toString("hex");
    await db.insert(users).values({
      id: userId,
      email,
      ageConfirmedAt: ageOk ? new Date() : null,
    });
  } else {
    const patch: Record<string, unknown> = { lastSeenAt: new Date() };
    if (ageOk && !existing[0]?.ageConfirmedAt) patch.ageConfirmedAt = new Date();
    await db.update(users).set(patch).where(eq(users.id, userId));
  }

  await startSession(userId);
  return userId;
}

export type CurrentUser = { id: string; email: string; displayName: string | null };

export async function currentUser(): Promise<CurrentUser | null> {
  const jar = await cookies();
  const id = jar.get(sessionCookieName())?.value;
  if (!id) return null;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.idHash, sha256(id)))
    .limit(1);

  const row = rows[0];
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return { id: row.id, email: row.email, displayName: row.displayName };
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(sessionCookieName())?.value;
  if (id) await db.delete(sessions).where(eq(sessions.idHash, sha256(id)));
  jar.delete(sessionCookieName());
}
