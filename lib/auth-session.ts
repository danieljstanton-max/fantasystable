/**
 * Shared session primitives used by every sign-in path (magic link, Google,
 * anything future). Split out of lib/auth.ts so lib/auth-google.ts can reuse
 * them without pulling in the magic-link machinery — the two files then
 * consist only of their provider-specific logic.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq, lt } from "drizzle-orm";
import { db, sessions } from "@/db";

const COOKIE = "stable_session";
const SESSION_TTL_DAYS = 30;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export async function startSession(userId: string): Promise<void> {
  const id = secret();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);
  await db.insert(sessions).values({ idHash: sha256(id), userId, expiresAt });
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
  const jar = await cookies();
  jar.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export function sessionCookieName(): string {
  return COOKIE;
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
