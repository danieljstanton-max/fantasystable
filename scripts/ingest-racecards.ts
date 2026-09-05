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
          .onConflictDoUpdate({ target: horses.id, set: { name: sql`excluded.name` } });
      if (people.jockeys.length)
        await tx
          .insert(jockeys)
          .values(people.jockeys)
          .onConflictDoUpdate({ target: jockeys.id, set: { name: sql`excluded.name` } });
      if (people.trainers.length)
        await tx
          .insert(trainers)
          .values(people.trainers)
          .onConflictDoUpdate({ target: trainers.id, set: { name: sql`excluded.name` } });

      // The race. Do not overwrite `status` — a settled result must not be
      // reverted to "upcoming" by a later racecard sweep.
      await tx
        .insert(races)
        .values({ ...race, fieldSize: race.fieldSize ?? runnerRows.length })
        .onConflictDoUpdate({
          target: races.id,
          set: {
            going: sql`excluded.going`,
            goingBand: sql`excluded.going_band`,
            fieldSize: sql`excluded.field_size`,
            prize: sql`excluded.prize`,
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
            set: {
              jockeyId: sql`excluded.jockey_id`,
              jockeyName: sql`excluded.jockey_name`,
              number: sql`excluded.number`,
              draw: sql`excluded.draw`,
              weight: sql`excluded.weight`,
              weightLbs: sql`excluded.weight_lbs`,
              headgear: sql`excluded.headgear`,
              ofr: sql`excluded.ofr`,
              rpr: sql`excluded.rpr`,
              ts: sql`excluded.ts`,
              form: sql`excluded.form`,
              odds: sql`excluded.odds`,
              isNonRunner: sql`excluded.is_non_runner`,
              raw: sql`excluded.raw`,
            },
          });

        // Anything previously declared but absent from this sweep is a
        // withdrawal. Mark it; never delete it.
        const present = runnerRows.map((r) => r.horseId);
        if (present.length) {
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
