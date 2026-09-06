/**
 * Aggregate stats we surface on the pitch — ownership percentages and
 * per-jockey historical records.
 *
 * Nothing here is a leaderboard or a settlement number; it's the shoulder
 * furniture a player uses to decide whether a pick is a differential or a
 * consensus, and to peek at a jockey's actual record before locking one in.
 */

import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, races, runners, stablePicks, stables } from "@/db";

/**
 * Ownership % per horse for a race date.
 *
 * Returns a Map keyed by horseId. Each value is the fraction of saved
 * stables on that date that picked the horse (0..1). If nobody's saved yet
 * the map is empty — the caller renders "no one yet" rather than 0/0.
 */
export async function loadHorseOwnership(raceDate: string): Promise<Map<string, number>> {
  const [{ n: total }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(stables)
    .where(eq(stables.raceDate, raceDate));

  if (!total) return new Map();

  const rows = await db
    .select({
      horseId: stablePicks.subjectId,
      picks: sql<number>`count(*)::int`,
    })
    .from(stablePicks)
    .innerJoin(stables, eq(stables.id, stablePicks.stableId))
    .where(and(eq(stables.raceDate, raceDate), eq(stablePicks.kind, "horse")))
    .groupBy(stablePicks.subjectId);

  const out = new Map<string, number>();
  for (const r of rows) out.set(r.horseId, r.picks / total);
  return out;
}

/** Same shape as loadHorseOwnership but for jockeys on the game card. */
export async function loadJockeyOwnership(raceDate: string): Promise<Map<string, number>> {
  const [{ n: total }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(stables)
    .where(eq(stables.raceDate, raceDate));
  if (!total) return new Map();

  const rows = await db
    .select({
      jockeyId: stablePicks.subjectId,
      picks: sql<number>`count(*)::int`,
    })
    .from(stablePicks)
    .innerJoin(stables, eq(stables.id, stablePicks.stableId))
    .where(and(eq(stables.raceDate, raceDate), eq(stablePicks.kind, "jockey")))
    .groupBy(stablePicks.subjectId);

  const out = new Map<string, number>();
  for (const r of rows) out.set(r.jockeyId, r.picks / total);
  return out;
}

export type JockeyRecord = {
  rides: number;
  wins: number;
  places: number; // top-3
  winPct: number; // 0..1
  placePct: number; // 0..1
  courseRides?: number;
  courseWins?: number;
  courseWinPct?: number;
};

/**
 * Historical record for a jockey — the last `limit` completed rides.
 *
 * Uses `positionNum` (populated on settlement), so anything without a
 * finishing position is ignored (races we haven't ingested results for,
 * non-completions, non-runners). If `courseId` is passed, adds "at course"
 * numbers using every ride we have there — a lifetime cut, not the last N.
 */
export async function loadJockeyRecord(
  jockeyId: string,
  courseId?: string | null,
  limit = 10
): Promise<JockeyRecord | null> {
  const recent = await db
    .select({
      pos: runners.positionNum,
    })
    .from(runners)
    .innerJoin(races, eq(races.id, runners.raceId))
    .where(and(eq(runners.jockeyId, jockeyId), isNotNull(runners.positionNum)))
    .orderBy(desc(races.offDt))
    .limit(limit);

  if (recent.length === 0) return null;

  const rides = recent.length;
  const wins = recent.filter((r) => r.pos === 1).length;
  const places = recent.filter((r) => (r.pos ?? 99) <= 3).length;

  const base: JockeyRecord = {
    rides,
    wins,
    places,
    winPct: wins / rides,
    placePct: places / rides,
  };

  if (courseId) {
    const [row] = await db
      .select({
        rides: sql<number>`count(*)::int`,
        wins: sql<number>`count(*) filter (where ${runners.positionNum} = 1)::int`,
      })
      .from(runners)
      .innerJoin(races, eq(races.id, runners.raceId))
      .where(
        and(
          eq(runners.jockeyId, jockeyId),
          eq(races.courseId, courseId),
          isNotNull(runners.positionNum)
        )
      );
    if (row && row.rides > 0) {
      base.courseRides = row.rides;
      base.courseWins = row.wins;
      base.courseWinPct = row.wins / row.rides;
    }
  }

  return base;
}
