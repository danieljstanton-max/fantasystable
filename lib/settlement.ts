/**
 * Turning finished races into stable points.
 *
 * The scoring functions themselves — how many points a winner is worth, what
 * a place pays, the NAP double — live in `lib/game-pricing.ts` and are the
 * one source of truth. This file wires them to the database: for a given
 * day, read every saved stable, look up the results of the horses and
 * jockeys they picked, compute the score, and write it back.
 *
 * Two properties worth naming:
 *
 * - Deterministic. Running settlement twice on the same day produces the
 *   same numbers and the same rows. There are no timestamps in the math,
 *   nothing random. Safe to re-run after a late correction.
 * - Idempotent write. Each stable's total is UPDATEd in place; each pick's
 *   `points` column is UPDATEd. No rows are ever inserted twice.
 *
 * Called by the results cron and by an admin "resettle this day" button that
 * doesn't exist yet.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db, runners as runnersT, stablePicks, stables } from "@/db";
import { loadCard } from "./game-data";
import {
  horsePoints,
  jockeyPoints,
  NAP_MULTIPLIER,
  type RunnerResult,
} from "./game-pricing";

export type SettlementReport = {
  date: string;
  stablesSettled: number;
  totalPointsAwarded: number;
  perStable: { stableId: string; userId: string; points: number }[];
};

/**
 * Settle every saved stable for a given race date.
 *
 * Skips stables whose picks reference horses that haven't run yet — a full
 * settlement waits for every card race to have a `positionNum` or a
 * non-completion code. Partial settlement is a design decision to make
 * later; today the safer default is all-or-nothing per stable.
 */
export async function settleDate(date: string): Promise<SettlementReport> {
  const { card } = await loadCard(date);
  const stableRows = await db.select().from(stables).where(eq(stables.raceDate, date));

  const report: SettlementReport = {
    date,
    stablesSettled: 0,
    totalPointsAwarded: 0,
    perStable: [],
  };
  if (!stableRows.length || !card.races.length) return report;

  // Load every pick across every stable for this day in one query.
  const stableIds = stableRows.map((s) => s.id);
  const picks = await db
    .select()
    .from(stablePicks)
    .where(inArray(stablePicks.stableId, stableIds));

  const horseSubjectIds = [...new Set(picks.filter((p) => p.kind === "horse").map((p) => p.subjectId))];
  const jockeySubjectIds = [...new Set(picks.filter((p) => p.kind === "jockey").map((p) => p.subjectId))];

  // Horse results — keyed by horseId, filtered by raceId (a horse races many
  // times per season, so horseId alone would pull in unrelated rows).
  //
  // We also fetch every runner in each race so we can count dead-heat ties.
  // If two horses share position 1 in a race, each gets half points.
  const cardRaceIdList = card.races.map((r) => r.raceId);
  const horseResultByHorse = new Map<string, RunnerResult>();
  const raceHorseKey = (raceId: string, horseId: string) => `${raceId}|${horseId}`;
  const raceHorseToRaceId = new Map<string, string>();
  const positionCounts = new Map<string, number>(); // raceId + "|" + positionNum → count
  if (horseSubjectIds.length && cardRaceIdList.length) {
    const rows = await db
      .select({
        raceId: runnersT.raceId,
        horseId: runnersT.horseId,
        positionNum: runnersT.positionNum,
        position: runnersT.position,
        spDec: runnersT.spDec,
        isNonRunner: runnersT.isNonRunner,
      })
      .from(runnersT)
      .where(
        and(
          inArray(runnersT.horseId, horseSubjectIds),
          inArray(runnersT.raceId, cardRaceIdList)
        )
      );
    for (const r of rows) {
      horseResultByHorse.set(r.horseId, {
        positionNum: r.positionNum,
        position: r.position,
        spDec: r.spDec,
        isNonRunner: r.isNonRunner ?? false,
      });
      raceHorseToRaceId.set(raceHorseKey(r.raceId, r.horseId), r.raceId);
    }

    // For every race that has one of our picks in it, count how many horses
    // finished at each position — anything > 1 is a dead heat, and we halve.
    const raceIdsWithPicks = [...new Set(rows.map((r) => r.raceId))];
    if (raceIdsWithPicks.length) {
      const fullFields = await db
        .select({
          raceId: runnersT.raceId,
          positionNum: runnersT.positionNum,
        })
        .from(runnersT)
        .where(inArray(runnersT.raceId, raceIdsWithPicks));
      for (const r of fullFields) {
        if (r.positionNum == null) continue;
        const key = `${r.raceId}|${r.positionNum}`;
        positionCounts.set(key, (positionCounts.get(key) ?? 0) + 1);
      }
    }
  }

  // Jockey rides — every ride on the game card. Any ride off-card ignored.
  const cardRaceIds = new Set(cardRaceIdList);
  type RideResult = RunnerResult & { raceId: string; deadHeatShare?: number };
  const ridesByJockey = new Map<string, RideResult[]>();
  if (jockeySubjectIds.length && cardRaceIdList.length) {
    const rows = await db
      .select({
        jockeyId: runnersT.jockeyId,
        raceId: runnersT.raceId,
        positionNum: runnersT.positionNum,
        position: runnersT.position,
        spDec: runnersT.spDec,
        isNonRunner: runnersT.isNonRunner,
      })
      .from(runnersT)
      .where(
        and(
          inArray(runnersT.jockeyId, jockeySubjectIds),
          inArray(runnersT.raceId, cardRaceIdList)
        )
      );
    // Ensure positionCounts covers jockey ride races too.
    const rideRaceIds = [...new Set(rows.map((r) => r.raceId))].filter((id) => id);
    const uncounted = rideRaceIds.filter((id) => ![...positionCounts.keys()].some((k) => k.startsWith(`${id}|`)));
    if (uncounted.length) {
      const extra = await db
        .select({ raceId: runnersT.raceId, positionNum: runnersT.positionNum })
        .from(runnersT)
        .where(inArray(runnersT.raceId, uncounted));
      for (const r of extra) {
        if (r.positionNum == null) continue;
        const key = `${r.raceId}|${r.positionNum}`;
        positionCounts.set(key, (positionCounts.get(key) ?? 0) + 1);
      }
    }
    for (const r of rows) {
      if (!r.jockeyId || !cardRaceIds.has(r.raceId)) continue;
      const list = ridesByJockey.get(r.jockeyId) ?? [];
      const share = r.positionNum != null
        ? positionCounts.get(`${r.raceId}|${r.positionNum}`) ?? 1
        : 1;
      list.push({
        raceId: r.raceId,
        positionNum: r.positionNum,
        position: r.position,
        spDec: r.spDec,
        isNonRunner: r.isNonRunner ?? false,
        deadHeatShare: share,
      } as any);
      ridesByJockey.set(r.jockeyId, list);
    }
  }

  // Walk each stable, score its picks, write the numbers back.
  //
  // Partial settlement: every pick gets scored on what's known RIGHT NOW.
  // A horse whose race hasn't been called stays at null and contributes 0
  // to the running total; the moment its race lands, the next settlement
  // picks it up. Same for jockeys — points reflect settled rides only, and
  // grow through the day as each ride is called.
  //
  // The `complete` flag no longer gates the write; it just informs the
  // report so the CLI can say "5 stables fully settled, 42 in progress".
  for (const stable of stableRows) {
    const own = picks.filter((p) => p.stableId === stable.id);
    let total = 0;
    let complete = true;

    for (const pick of own) {
      let pts: number | null = null;

      if (pick.kind === "horse") {
        const result = horseResultByHorse.get(pick.subjectId);
        const raceUnsettled =
          !result ||
          (!result.isNonRunner &&
            result.positionNum === null &&
            (!result.position || !isNonCompletion(result.position)));
        if (raceUnsettled) {
          complete = false;
        } else {
          const raw = horsePoints(result!);
          pts = stable.napHorseId === pick.subjectId ? raw * NAP_MULTIPLIER : raw;
          total += pts;
        }
      } else {
        const rides = ridesByJockey.get(pick.subjectId) ?? [];
        // Score only the settled rides. Any unsettled ride keeps the stable
        // in the "in progress" bucket but doesn't block writing what we know.
        const settled = rides.filter(
          (r) => r.isNonRunner || r.positionNum !== null || (r.position && isNonCompletion(r.position))
        );
        if (settled.length < rides.length) complete = false;
        pts = jockeyPoints(settled);
        total += pts;
      }

      await db
        .update(stablePicks)
        .set({ points: pts })
        .where(
          and(
            eq(stablePicks.stableId, stable.id),
            eq(stablePicks.kind, pick.kind),
            eq(stablePicks.subjectId, pick.subjectId)
          )
        );
    }

    await db.update(stables).set({ points: total }).where(eq(stables.id, stable.id));
    if (complete) report.stablesSettled += 1;
    report.totalPointsAwarded += total;
    report.perStable.push({ stableId: stable.id, userId: stable.userId, points: total });
  }

  return report;
}

const NON_COMPLETIONS = new Set(["PU", "F", "UR", "BD", "SU", "RR", "REF", "DSQ", "VOI", "CO", "LFT"]);
function isNonCompletion(code: string) {
  return NON_COMPLETIONS.has(code.toUpperCase().trim());
}
