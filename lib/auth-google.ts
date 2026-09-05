/**
 * Sign in with Google, using OAuth 2.0 directly.
 *
 * No SDK. Google's flow is three HTTPs — redirect the user to their consent
 * page, receive a code back, exchange it for an id_token — and that is a
 * dependency's worth of network on either side of a hundred lines. Matching
 * the philosophy of lib/auth.ts: every line auditable, no library between us
 * and the credential that logs a player in.
 *
 * The account rules are shared with email sign-in: an unrecognised address
 * creates a new user, a recognised one is signed straight into the existing
 * account. Session cookies come from the same `startSession()` helper, so a
 * player who first signs in with a magic link and later signs in with Google
 * on the same address ends up in the same stable. That is the point of
 * matching on email rather than on OAuth `sub`.
 *
 * Security properties worth naming:
 *
 * - The `state` parameter is a random 32-byte string, stored short-lived in a
 *   `google_oauth` cookie and checked on the callback. Without it a stranger
 *   could craft a callback URL that logs someone into a stranger's account.
 * - Only the `id_token` is trusted for identity. We verify its signature
 *   against Google's JWKS, its issuer, its audience and its expiry. The
 *   access_token is discarded; we don't need it and holding it makes the
 *   compromise of this codebase materially worse.
 * - We only accept accounts with `email_verified: true`. An unverified
 *   Gmail address is a way to be anyone.
 */

import { createHash, randomBytes, createPublicKey, verify } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, users } from "@/db";
import { startSession, normaliseEmail } from "./auth-session";

const STATE_COOKIE = "google_oauth";
const STATE_TTL_MIN = 10;

/** Whether Google sign-in is wired up. Both env vars must be present. */
export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/**
 * Build the URL to redirect the user to Google's consent screen.
 * Stamps a random `state` into a short-lived cookie so the callback can prove
 * this exact browser started the flow.
 */
export async function startGoogleFlow(origin: string, ageConfirmed: boolean): Promise<string> {
  if (!googleConfigured()) throw new Error("Google OAuth is not configured");

  const state = randomBytes(32).toString("base64url");
  const jar = await cookies();
  if (ageConfirmed) {
    jar.set("age_ok", "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 10 * 60,
    });
  }
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STATE_TTL_MIN * 60,
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  url.searchParams.set("redirect_uri", `${origin}/api/auth/google/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  // A verified email is the whole point; ask for `select_account` so a person
  // signed into multiple Google accounts isn't silently logged in to the wrong
  // stable.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/**
 * Handle Google's callback. Returns the user id on success, or null.
 */
export async function consumeGoogleCallback(
  origin: string,
  code: string,
  state: string
): Promise<string | null> {
  if (!googleConfigured()) return null;

  const jar = await cookies();
  const stored = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  if (!stored || stored !== state) return null;
  if (!code) return null;

  // Exchange the code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${origin}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return null;
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) return null;

  const payload = await verifyIdToken(tokens.id_token);
  if (!payload) return null;

  const email = normaliseEmail(payload.email);
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  let userId = existing[0]?.id;

  const ageOk = jar.get("age_ok")?.value === "1";
  jar.delete("age_ok");

  if (!userId) {
    userId = randomBytes(16).toString("hex");
    await db.insert(users).values({
      id: userId,
      email,
      displayName: payload.name ?? null,
      ageConfirmedAt: ageOk ? new Date() : null,
    });
  } else {
    const patch: Record<string, unknown> = { lastSeenAt: new Date() };
    if (ageOk && !existing[0].ageConfirmedAt) patch.ageConfirmedAt = new Date();
    await db.update(users).set(patch).where(eq(users.id, userId));
  }

  await startSession(userId);
  return userId;
}

/* ----------------------------------------------------------- verification */

type IdTokenPayload = {
  iss: string;
  aud: string;
  exp: number;
  email: string;
  email_verified: boolean;
  name?: string;
  sub: string;
};

/**
 * Verify Google's id_token against Google's public keys.
 *
 * A stolen id_token would let an attacker sign in as its subject, so this
 * MUST check the signature. We fetch Google's JWKS on demand — the endpoint
 * is CDN-cached and the fetch is a few kB. In production a memoised fetch
 * with a TTL would be an obvious improvement; for now the tradeoff is fine.
 */
async function verifyIdToken(idToken: string): Promise<IdTokenPayload | null> {
  const [headerB64, payloadB64, signatureB64] = idToken.split(".");
  if (!headerB64 || !payloadB64 || !signatureB64) return null;

  const header = JSON.parse(Buffer.from(headerB64, "base64url").toString()) as {
    alg: string;
    kid: string;
  };
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as IdTokenPayload;

  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") return null;
  if (payload.aud !== process.env.GOOGLE_CLIENT_ID) return null;
  if (payload.exp * 1000 < Date.now()) return null;
  if (!payload.email_verified) return null;
  if (!payload.email) return null;

  const jwks = await (await fetch("https://www.googleapis.com/oauth2/v3/certs")).json();
  const jwk = jwks.keys.find((k: { kid: string }) => k.kid === header.kid);
  if (!jwk) return null;

  const key = createPublicKey({ key: jwk, format: "jwk" });
  const signed = `${headerB64}.${payloadB64}`;
  const signature = Buffer.from(signatureB64, "base64url");

  const ok = verify(
    "RSA-SHA256",
    Buffer.from(signed),
    { key, dsaEncoding: "ieee-p1363" as const },
    signature
  );
  return ok ? payload : null;
}
