/**
 * Ingest racecards for today and tomorrow.
 *
 *   npm run ingest:racecards
 *   npm run ingest:racecards -- 2026-08-27
 *
 * Idempotent: safe to run every ten minutes. Races and runners are upserted on
 * their natural keys, so a re-run updates going, odds and non-runners in place
 * without creating duplicates.
 *
 * Non-runners are marked, never deleted. A punter who followed a link to a
 * horse that has since been withdrawn should see "non-runner", not a 404 — and
 * the model needs to know a horse was declared and pulled.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and, notInArray, sql } from "drizzle-orm";

import * as schema from "../db/schema";
import { races, runners, horses, jockeys, trainers, ingestRuns } from "../db/schema";
import { fetchRacecards } from "../lib/racing-api";
import { mapRace, mapRunner, extractRaces, extractRunners } from "../lib/mappers";
import { slugify } from "../lib/slug";

const client = postgres(process.env.DATABASE_URL!, { max: 4 });
const db = drizzle(client, { schema });

function datesToIngest(): string[] {
  const arg = process.argv[2];
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return [arg];
  const today = new Date();
  const tomorrow = new Date(Date.now() + 864e5);
  return [today, tomorrow].map((d) => d.toISOString().slice(0, 10));
}

/** Collect people referenced by runners so foreign keys resolve. */
function collectPeople(runnerRows: ReturnType<typeof mapRunner>[]) {
  const j = new Map<string, { id: string; name: string; slug: string }>();
  const t = new Map<string, { id: string; name: string; slug: string }>();
  const h = new Map<string, { id: string; name: string; slug: string }>();
  for (const r of runnerRows) {
    if (r.jockeyId && r.jockeyName && !j.has(r.jockeyId))
      j.set(r.jockeyId, { id: r.jockeyId, name: r.jockeyName, slug: slugify(r.jockeyName) });
    if (r.trainerId && r.trainerName && !t.has(r.trainerId))
      t.set(r.trainerId, { id: r.trainerId, name: r.trainerName, slug: slugify(r.trainerName) });
    if (r.horseId && !h.has(r.horseId))
      h.set(r.horseId, { id: r.horseId, name: r.horseName, slug: slugify(r.horseName) });
  }
  return { jockeys: [...j.values()], trainers: [...t.values()], horses: [...h.values()] };
}

async function ingestDate(date: string) {
  console.log(`\n${date}`);
  const payload = await fetchRacecards(date, "pro");
  const rawRaces = extractRaces(payload as Record<string, unknown>);

  if (rawRaces.length === 0) {
    console.log("  no races returned — check the response shape with `npm run probe`");
    return { races: 0, runners: 0 };
  }

  let runnerCount = 0;

  for (const rawRace of rawRaces) {
    const race = mapRace(rawRace);
    if (!race.id || race.id === "undefined" || !race.raceDate || !race.offTime) {
      console.log(`  skipped a race with missing id/date/time — mapping likely wrong`);
      continue;
    }

    const runnerRows = extractRunners(rawRace).map((h) => mapRunner(race.id, h));
    const people = collectPeople(runnerRows);

    await db.transaction(async (tx) => {
      // Reference entities first, so runner FKs resolve.
      if (people.horses.length)
        await tx
          .insert(horses)
          .values(people.horses)
          .onConflictDoUpdate({
            target: horses.id,
            set: { name: sql`excluded.name`, slug: sql`excluded.slug` },
          });
      if (people.jockeys.length)
        await tx
          .insert(jockeys)
          .values(people.jockeys)
          .onConflictDoUpdate({
            target: jockeys.id,
            set: { name: sql`excluded.name`, slug: sql`excluded.slug` },
          });
      if (people.trainers.length)
        await tx
          .insert(trainers)
          .values(people.trainers)
          .onConflictDoUpdate({
            target: trainers.id,
            set: { name: sql`excluded.name`, slug: sql`excluded.slug` },
          });

      // The race. Do not overwrite `status` — a settled result must not be
      // reverted to "upcoming" by a later racecard sweep.
      await tx
        .insert(races)
        .values({ ...race, fieldSize: race.fieldSize ?? runnerRows.length })
        .onConflictDoUpdate({
          target: races.id,
          set: {
            going: sql`excluded.going`,
            goingDetailed: sql`excluded.going_detailed`,
            goingBand: sql`excluded.going_band`,
            fieldSize: sql`excluded.field_size`,
            prize: sql`excluded.prize`,
            prizeValue: sql`excluded.prize_value`,
            region: sql`excluded.region`,
            stalls: sql`excluded.stalls`,
            railMovements: sql`excluded.rail_movements`,
            weather: sql`excluded.weather`,
            jumps: sql`excluded.jumps`,
            distanceRound: sql`excluded.distance_round`,
            raw: sql`excluded.raw`,
            ingestedAt: sql`now()`,
          },
        });

      if (runnerRows.length) {
        await tx
          .insert(runners)
          .values(runnerRows)
          .onConflictDoUpdate({
            target: [runners.raceId, runners.horseId],
            // NOTE: this list is exhaustive on purpose. Anything omitted is
            // silently never updated on a re-ingest — which is how
            // jockey_claim_lbs and effective_mark stayed null after being
            // added. If you add a column to the runner mapper, add it here.
            set: {
              jockeyId: sql`excluded.jockey_id`,
              jockeyName: sql`excluded.jockey_name`,
              jockeyClaimLbs: sql`excluded.jockey_claim_lbs`,
              trainerId: sql`excluded.trainer_id`,
              trainerName: sql`excluded.trainer_name`,
              number: sql`excluded.number`,
              draw: sql`excluded.draw`,
              age: sql`excluded.age`,
              weight: sql`excluded.weight`,
              weightLbs: sql`excluded.weight_lbs`,
              headgear: sql`excluded.headgear`,
              headgearFirstTime: sql`excluded.headgear_first_time`,
              ofr: sql`excluded.ofr`,
              effectiveMark: sql`excluded.effective_mark`,
              rpr: sql`excluded.rpr`,
              ts: sql`excluded.ts`,
              performanceRating: sql`excluded.performance_rating`,
              speedRating: sql`excluded.speed_rating`,
              form: sql`excluded.form`,
              lastRun: sql`excluded.last_run`,
              silkUrl: sql`excluded.silk_url`,
              comment: sql`excluded.comment`,
              trainer14Runs: sql`excluded.trainer_14_runs`,
              trainer14Wins: sql`excluded.trainer_14_wins`,
              trainer14Percent: sql`excluded.trainer_14_percent`,
              trainerRtf: sql`excluded.trainer_rtf`,
              windSurgery: sql`excluded.wind_surgery`,
              windSurgeryRun: sql`excluded.wind_surgery_run`,
              odds: sql`excluded.odds`,
              bestOddsDec: sql`excluded.best_odds_dec`,
              // Opening price is written once and never moved. Without the
              // COALESCE every ten-minute sweep would overwrite it and the
              // "opened at" price would just track the current one.
              openingOddsDec: sql`coalesce(runners.opening_odds_dec, excluded.opening_odds_dec)`,
              openingOddsFrac: sql`coalesce(runners.opening_odds_frac, excluded.opening_odds_frac)`,
              openingOddsAt: sql`coalesce(runners.opening_odds_at, excluded.opening_odds_at)`,
              // Shortest price seen today: only ever moves down.
              shortestOddsDec: sql`least(coalesce(runners.shortest_odds_dec, excluded.best_odds_dec), excluded.best_odds_dec)`,
              bestOddsFrac: sql`excluded.best_odds_frac`,
              bestOddsBookmaker: sql`excluded.best_odds_bookmaker`,
              ewPlaces: sql`excluded.ew_places`,
              ewDenom: sql`excluded.ew_denom`,
              oddsUpdatedAt: sql`excluded.odds_updated_at`,
              isNonRunner: sql`excluded.is_non_runner`,
              raw: sql`excluded.raw`,
            },
          });

        // Anything previously declared but absent from this sweep is a
        // withdrawal. Mark it; never delete it.
        //
        // "Declared" is the operative word. Big handicaps are balloted: the
        // card for the Ayr Bronze Cup on 2026-09-18 first came through as the
        // whole entry — about 190 horses, none with a saddle-cloth number —
        // and then as the 24 who actually got in. Every horse that missed the
        // cut was marked a non-runner, and the race page listed 165 of them
        // under "Non-runners", most of them running elsewhere or nowhere.
        //
        // An entry that never got a number was never a runner, so it was never
        // withdrawn — it is removed, not marked. A horse that did have a number
        // and then vanished is a real withdrawal and is kept, as before: a
        // reader following a link to it should still see "non-runner".
        const present = runnerRows.map((r) => r.horseId);
        if (present.length) {
          await tx
            .delete(runners)
            .where(and(
              eq(runners.raceId, race.id),
              notInArray(runners.horseId, present),
              sql`coalesce(${runners.raw}->>'number', '') = ''`,
            ));
          await tx
            .update(runners)
            .set({ isNonRunner: true })
            .where(and(eq(runners.raceId, race.id), notInArray(runners.horseId, present)));
        }
      }
    });

    runnerCount += runnerRows.length;
  }

  console.log(`  ${rawRaces.length} races, ${runnerCount} runners`);
  return { races: rawRaces.length, runners: runnerCount };
}

async function main() {
  const runId = randomUUID();
  await db.insert(ingestRuns).values({ id: runId, job: "racecards", status: "running" });

  let totalRaces = 0;
  let totalRunners = 0;

  try {
    for (const date of datesToIngest()) {
      const r = await ingestDate(date);
      totalRaces += r.races;
      totalRunners += r.runners;
    }

    await db
      .update(ingestRuns)
      .set({
        status: "ok",
        finishedAt: new Date(),
        racesSeen: totalRaces,
        runnersSeen: totalRunners,
      })
      .where(eq(ingestRuns.id, runId));

    console.log(`\nDone. ${totalRaces} races, ${totalRunners} runners.\n`);
  } catch (err) {
    await db
      .update(ingestRuns)
      .set({ status: "error", finishedAt: new Date(), error: (err as Error).message })
      .where(eq(ingestRuns.id, runId));
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("\nIngest failed:", e);
  process.exit(1);
});
