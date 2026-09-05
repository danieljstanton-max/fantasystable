/**
 * League create, join, and lookup — server-side only.
 *
 * Every read and write goes through here so the join rule ("code is case-
 * insensitive and stripped of punctuation") is the same at every entry
 * point. If the leagues page's Join form and the URL-parameter join path
 * both call `joinLeague()`, they cannot diverge.
 *
 * The code alphabet leaves out 0/O, 1/I/L. Punters read codes out to each
 * other and mistype the visually confusable ones — losing five characters
 * is worth the readability. That leaves 31 characters over 6 slots, ~890m
 * combinations, plenty for the foreseeable future.
 */

import { and, eq, sql as raw } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, leagueMembers, leagues, stables, users } from "@/db";

export const CODE_LEN = 6;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LEN);
}

function randomCode(): string {
  const bytes = randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export type CreateResult =
  | { ok: true; leagueId: string; code: string; url: string; name: string }
  | { ok: false; error: string };

/**
 * Create a league and add its owner as the first member.
 *
 * Retries on the (very rare) code collision. In 31^6 space and a small
 * player base, an attempt-limit of 5 is more than enough — but bounding it
 * keeps a runaway loop out of the ledger if something ever goes odd with
 * the RNG.
 */
export async function createLeague(
  ownerUserId: string,
  origin: string,
  rawName: string
): Promise<CreateResult> {
  const name = rawName.trim().slice(0, 40);
  if (name.length < 3) return { ok: false, error: "Give your league a name of at least 3 letters." };

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const leagueId = randomBytes(16).toString("hex");
    try {
      await db.transaction(async (tx) => {
        await tx.insert(leagues).values({ id: leagueId, code, name, ownerUserId });
        await tx.insert(leagueMembers).values({ leagueId, userId: ownerUserId });
      });
      const url = `${origin}/game/leagues/join?code=${code}`;
      return { ok: true, leagueId, code, url, name };
    } catch (e: unknown) {
      // 23505 = unique_violation on leagues.code. Any other error propagates.
      if (isUniqueViolation(e)) continue;
      throw e;
    }
  }
  return { ok: false, error: "Could not generate a unique code — try again." };
}

export type JoinResult =
  | { ok: true; leagueId: string; leagueName: string; alreadyIn: boolean }
  | { ok: false; error: "not-found" | "invalid" };

export async function joinLeague(userId: string, rawCode: string): Promise<JoinResult> {
  const code = normaliseCode(rawCode);
  if (code.length !== CODE_LEN) return { ok: false, error: "invalid" };

  const league = (await db.select().from(leagues).where(eq(leagues.code, code)).limit(1))[0];
  if (!league) return { ok: false, error: "not-found" };

  // ON CONFLICT DO NOTHING so a re-tap of an already-joined link is a
  // friendly no-op rather than an error.
  const inserted = await db
    .insert(leagueMembers)
    .values({ leagueId: league.id, userId })
    .onConflictDoNothing()
    .returning({ leagueId: leagueMembers.leagueId });
  return {
    ok: true,
    leagueId: league.id,
    leagueName: league.name,
    alreadyIn: inserted.length === 0,
  };
}

/** Every league the user is a member of, plus a preview of their rank. */
export async function loadMyLeagues(userId: string) {
  const rows = await db
    .select({
      id: leagues.id,
      code: leagues.code,
      name: leagues.name,
      isOwner: raw<boolean>`${leagues.ownerUserId} = ${userId}`,
      members: raw<number>`(select count(*)::int from ${leagueMembers} lm2 where lm2.league_id = ${leagues.id})`,
    })
    .from(leagueMembers)
    .innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
    .where(eq(leagueMembers.userId, userId));
  return rows;
}

/**
 * A league's leaderboard for a given date (or all-time if omitted).
 *
 * Ranks are dense: two stables tied on 66 are both rank 1, next is 3. The
 * chosen convention matches what leaderboards commonly show and is what a
 * player expects when they see "you tied for 2nd".
 */
export async function loadLeagueBoard(leagueId: string, raceDate?: string) {
  const q = db
    .select({
      userId: leagueMembers.userId,
      email: users.email,
      displayName: users.displayName,
      points: stables.points,
      stableId: stables.id,
    })
    .from(leagueMembers)
    .innerJoin(users, eq(users.id, leagueMembers.userId))
    .leftJoin(
      stables,
      raceDate
        ? and(eq(stables.userId, leagueMembers.userId), eq(stables.raceDate, raceDate))
        : eq(stables.userId, leagueMembers.userId)
    )
    .where(eq(leagueMembers.leagueId, leagueId));
  return await q;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
}
