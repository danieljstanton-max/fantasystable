/**
 * Account edits: display name, stable name, email change, sign-out
 * everywhere, delete.
 *
 * Two of these carry real consequences that deserve extra care:
 *
 * - `changeEmail` sends a link to the NEW address. Ownership of that address
 *   is what proves the change; we never trust the account owner alone. Until
 *   the link is used, the old email remains the sign-in.
 * - `deleteAccount` cascades through stables, picks, sales, sessions and
 *   league memberships. It cannot be undone, so the calling action requires
 *   a confirmation string ("DELETE") and re-checks the current session.
 *
 * Display and stable names are public on the leaderboard, so both go through
 * `sanitiseName` — a trim, a length cap, and a small blocklist. This is not
 * a moderation system; it's the floor that stops the most obvious abuse. A
 * real moderation flow (report, admin review, block) is separate work.
 */

import { and, eq, gt, lt, sql as raw } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { db, emailChangeRequests, sessions, users } from "@/db";
import { looksLikeEmail, normaliseEmail } from "./auth-session";

const EMAIL_CHANGE_TTL_MIN = 30;

/** Small blocklist. NOT a moderation system — the very obvious floor. */
const BLOCKED_TERMS = ["admin", "moderator", "fantasystable"];
const BLOCKED_SUBSTRINGS = ["fuck", "cunt", "nigger", "faggot", "retard"];

export type NameCheck = { ok: true; cleaned: string } | { ok: false; error: string };

export function sanitiseName(raw: string, kind: "display" | "stable"): NameCheck {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  const maxLen = kind === "stable" ? 40 : 30;
  const minLen = 2;
  if (cleaned.length < minLen) return { ok: false, error: `${cap(kind)} name is too short.` };
  if (cleaned.length > maxLen) return { ok: false, error: `${cap(kind)} name must be ${maxLen} or fewer characters.` };
  if (!/^[A-Za-z0-9 '’&.,!?()\-]+$/.test(cleaned)) {
    return { ok: false, error: "Use letters, numbers and basic punctuation only." };
  }
  const lc = cleaned.toLowerCase();
  if (BLOCKED_TERMS.includes(lc)) return { ok: false, error: "That name is reserved." };
  if (BLOCKED_SUBSTRINGS.some((s) => lc.includes(s))) {
    return { ok: false, error: "Try a different name." };
  }
  return { ok: true, cleaned };
}

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}

/* --------------------------------------------------------- profile edits */

export async function updateNames(
  userId: string,
  displayName: string,
  stableName: string
): Promise<{ ok: boolean; error?: string }> {
  const d = sanitiseName(displayName, "display");
  if (!d.ok) return { ok: false, error: d.error };
  const s = sanitiseName(stableName, "stable");
  if (!s.ok) return { ok: false, error: s.error };
  await db.update(users).set({ displayName: d.cleaned, stableName: s.cleaned }).where(eq(users.id, userId));
  return { ok: true };
}

export async function updateAvatarUrl(userId: string, url: string | null): Promise<void> {
  await db.update(users).set({ avatarUrl: url }).where(eq(users.id, userId));
}

/* ---------------------------------------------------------- email change */

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const secret = () => randomBytes(32).toString("base64url");

export type EmailChangeRequest =
  | { ok: true; url: string }
  | { ok: false; error: "invalid" | "same-address" | "in-use" };

export async function requestEmailChange(
  userId: string,
  origin: string,
  rawEmail: string
): Promise<EmailChangeRequest> {
  const email = normaliseEmail(rawEmail);
  if (!looksLikeEmail(email)) return { ok: false, error: "invalid" };

  const me = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (me?.email === email) return { ok: false, error: "same-address" };

  const other = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (other.length) return { ok: false, error: "in-use" };

  const token = secret();
  await db.insert(emailChangeRequests).values({
    tokenHash: sha256(token),
    userId,
    newEmail: email,
    expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MIN * 60_000),
  });
  const url = new URL("/api/auth/change-email", origin);
  url.searchParams.set("token", token);
  return { ok: true, url: url.toString() };
}

export async function consumeEmailChange(token: string): Promise<{ ok: boolean; email?: string }> {
  if (!token) return { ok: false };
  const rows = await db
    .update(emailChangeRequests)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(emailChangeRequests.tokenHash, sha256(token)),
        gt(emailChangeRequests.expiresAt, new Date()),
        raw`${emailChangeRequests.usedAt} is null`
      )
    )
    .returning({ userId: emailChangeRequests.userId, newEmail: emailChangeRequests.newEmail });

  const row = rows[0];
  if (!row) return { ok: false };

  // Race: someone might have taken this email between request and use.
  const clash = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, row.newEmail), raw`${users.id} <> ${row.userId}`))
    .limit(1);
  if (clash.length) return { ok: false };

  await db.update(users).set({ email: row.newEmail }).where(eq(users.id, row.userId));
  return { ok: true, email: row.newEmail };
}

/* ------------------------------------------------------------- security */

export async function signOutEverywhere(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteAccount(userId: string): Promise<void> {
  // Every table with a foreign key to users has ON DELETE CASCADE, so the
  // single delete cleans up sessions, tokens, stables, picks, sales, league
  // memberships and pending email changes.
  await db.delete(users).where(eq(users.id, userId));
}

// Housekeeping — same idle-sweep pattern as sessions
export async function pruneExpiredTokens(): Promise<void> {
  await db.delete(emailChangeRequests).where(lt(emailChangeRequests.expiresAt, new Date()));
}
