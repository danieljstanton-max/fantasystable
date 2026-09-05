/**
 * Historical backfill.
 *
 *   npm run backfill -- --dry-run          plan only, no database needed
 *   npm run backfill -- --months=12        bulk results (12 is the API maximum)
 *   npm run backfill -- --horses           per-horse career form
 *   npm run backfill -- --months=12 --horses
 *
 * Two sources, because the API splits history in an awkward way:
 *
 *   /v1/results             capped at exactly 12 months back. Confirmed
 *                           2026-08-26: 2025-08-26 is accepted, 2025-08-20 is
 *                           rejected. `limit` maxes at 100.
 *
 *   /v1/horses/{id}/results NOT date-limited. Returns up to 50 career runs AND
 *                           the full field for every one of them. This is how
 *                           we get history older than a year: 41 of one horse's
 *                           50 runs predated the bulk cut-off, each carrying a
 *                           complete 16-runner race.
 *
 * So the deep history is harvested sideways, out of horse form lines, rather
 * than pulled directly. Races are deduplicated on race_id, so the same race
 * arriving via ten different horses is stored once.
 *
 * Idempotent throughout — safe to stop and restart.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";

import { apiGet, endpoints, fetchResults, REGIONS, RacingApiError } from "../lib/racing-api";
import {
  mapResultRace,
  mapResultRunner,
  mapRace,
  mapRunner,
  extractRunners,
} from "../lib/mappers";
import { filterRace } from "../lib/selection";

/* --------------------------------------------------------------- arguments */

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
/**
 * --horses[=scope]
 *
 *   qualifying  horses in races that pass Dan's filters (~120/day) — default
 *   declared    every horse declared today and tomorrow (~700/day)
 *   all         every horse in the database (~25-30k, a one-off overnight run)
 *
 * Scope only changes WHICH horses are queried. Every query returns up to 50
 * career runs with the complete field of each, so a wider scope deepens
 * history much faster.
 */
const horsesArg = args.find((a) => a === "--horses" || a.startsWith("--horses="));
const DO_HORSES = Boolean(horsesArg);
const HORSE_SCOPE = (horsesArg?.split("=")[1] ?? "qualifying") as
  | "qualifying"
  | "declared"
  | "all";
if (DO_HORSES && !["qualifying", "declared", "all"].includes(HORSE_SCOPE)) {
  console.error(`\n  Unknown --horses scope "${HORSE_SCOPE}". Use qualifying, declared or all.\n`);
  process.exit(1);
}

/** Skip horses whose form was pulled within this many days. */
const REFRESH_DAYS = (() => {
  const m = args.find((a) => a.startsWith("--refresh-days="));
  return m ? parseInt(m.split("=")[1], 10) : 7;
})();

/** Cap a run so an overnight job can be split. 0 = no cap. */
const LIMIT_HORSES = (() => {
  const m = args.find((a) => a.startsWith("--limit="));
  return m ? parseInt(m.split("=")[1], 10) : 0;
})();
const MONTHS = (() => {
  const m = args.find((a) => a.startsWith("--months="));
  const n = m ? parseInt(m.split("=")[1], 10) : 0;
  if (n > 12) {
    console.error(
      `\n  --months=${n} is not possible. /v1/results is capped at 12 months.\n` +
        `  Deeper history comes from --horses, which is not date-limited.\n`
    );
    process.exit(1);
  }
  return n;
})();

if (!MONTHS && !DO_HORSES) {
  console.error("\n  Nothing to do. Pass --months=12 and/or --horses.\n");
  process.exit(1);
}

const PAGE = 100; // API maximum

/* ------------------------------------------------------------------- stats */

const stats = {
  apiCalls: 0,
  bulkRaces: 0,
  bulkRunners: 0,
  horsesQueried: 0,
  horseRuns: 0,
  harvestedRaces: 0,
  harvestedRunners: 0,
  oldestSeen: "9999-99-99",
  errors: 0,
  bytes: 0,
};

const seenRaces = new Set<string>();

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  // Step forward a day: the cut-off is inclusive of exactly 12 months, and a
  // clock skew of hours either way would otherwise trip the 422.
  d.setDate(d.getDate() + 1);
  return ymd(d);
}

/* ------------------------------------------------------------ persistence */

/**
 * Loaded lazily so --dry-run works with no DATABASE_URL at all. db/index.ts
 * throws on import when the variable is missing, which is correct for the app
 * but would stop us planning a backfill before the database exists.
 */
type Store = Awaited<ReturnType<typeof loadStore>>;

async function loadStore() {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const postgres = (await import("postgres")).default;
  const schema = await import("../db/schema");
  const client = postgres(process.env.DATABASE_URL!, { max: 4 });
  return { db: drizzle(client, { schema }), schema, client };
}

/**
 * Write many races and runners in as few round trips as possible.
 *
 * The original wrote race-by-race: an 18-run career meant ~36 separate trips
 * to London at 37ms each. Batched, a whole career is two statements.
 *
 * Chunked because Postgres caps a statement at 65,535 bind parameters and
 * these tables are wide -- a race row carries ~35 columns, a runner ~40.
 */
async function persistBatch(store: Store | null, raceRows: any[], runnerRows: any[]) {
  if (!store || (!raceRows.length && !runnerRows.length)) return;
  const { db, schema } = store;
  const { sql } = await import("drizzle-orm");

  for (let i = 0; i < raceRows.length; i += 400) {
    const chunk = raceRows.slice(i, i + 400);
    await db
      .insert(schema.races)
      .values(chunk)
      .onConflictDoUpdate({
        target: schema.races.id,
        set: {
          going: sql`excluded.going`,
          status: sql`excluded.status`,
          resultAt: sql`excluded.result_at`,
          raw: sql`excluded.raw`,
        },
      });
  }

  for (let i = 0; i < runnerRows.length; i += 600) {
    const chunk = runnerRows.slice(i, i + 600);
    await db
      .insert(schema.runners)
      .values(chunk)
      .onConflictDoUpdate({
        target: [schema.runners.raceId, schema.runners.horseId],
        set: {
          position: sql`excluded.position`,
          positionNum: sql`excluded.position_num`,
          beatenBy: sql`excluded.beaten_by`,
          ovrBtn: sql`excluded.ovr_btn`,
          sp: sql`excluded.sp`,
          spDec: sql`excluded.sp_dec`,
          bsp: sql`excluded.bsp`,
          ofr: sql`excluded.ofr`,
          effectiveMark: sql`excluded.effective_mark`,
          rpr: sql`excluded.rpr`,
          ts: sql`excluded.ts`,
          weightLbs: sql`excluded.weight_lbs`,
          jockeyClaimLbs: sql`excluded.jockey_claim_lbs`,
          comment: sql`excluded.comment`,
        },
      });
  }
}

/**
 * Load every race id already stored, so a restart skips them instead of
 * re-upserting thousands of rows it has seen before. One query, and it makes
 * resumption nearly free.
 */
async function preloadSeen(store: Store | null) {
  if (!store) return;
  const { sql } = await import("drizzle-orm");
  const rows: any[] = await store.db.execute(sql`select id from races`);
  for (const r of rows) seenRaces.add(r.id);
  console.log(`  ${seenRaces.size.toLocaleString()} races already stored — these will be skipped`);
}

async function persistRace(store: Store | null, race: any, runnerRows: any[]) {
  if (!store) return; // dry run
  const { db, schema } = store;
  const { sql } = await import("drizzle-orm");

  await db
    .insert(schema.races)
    .values(race)
    .onConflictDoUpdate({
      target: schema.races.id,
      // A settled result must never be reverted by a later sweep.
      set: {
        going: sql`excluded.going`,
        status: sql`excluded.status`,
        resultAt: sql`excluded.result_at`,
        raw: sql`excluded.raw`,
      },
    });

  if (runnerRows.length) {
    await db
      .insert(schema.runners)
      .values(runnerRows)
      .onConflictDoUpdate({
        target: [schema.runners.raceId, schema.runners.horseId],
        set: {
          position: sql`excluded.position`,
          positionNum: sql`excluded.position_num`,
          beatenBy: sql`excluded.beaten_by`,
          ovrBtn: sql`excluded.ovr_btn`,
          sp: sql`excluded.sp`,
          spDec: sql`excluded.sp_dec`,
          bsp: sql`excluded.bsp`,
          ofr: sql`excluded.ofr`,
          effectiveMark: sql`excluded.effective_mark`,
          rpr: sql`excluded.rpr`,
          ts: sql`excluded.ts`,
          weightLbs: sql`excluded.weight_lbs`,
          jockeyClaimLbs: sql`excluded.jockey_claim_lbs`,
          comment: sql`excluded.comment`,
        },
      });
  }
}

/* ------------------------------------------------------- phase 1: results */

async function bulkResults(store: Store | null) {
  const start = monthsAgo(MONTHS);
  const end = ymd(new Date());

  console.log(`\nPHASE 1 — bulk results  ${start} .. ${end}`);

  let probe: any;
  try {
    probe = await fetchResults(start, end, 1, 0);
    stats.apiCalls++;
  } catch (e) {
    const msg = e instanceof RacingApiError ? e.body : (e as Error).message;
    console.error(`  cannot start: ${msg}`);
    stats.errors++;
    return;
  }

  const total = probe.total ?? 0;
  const pages = Math.ceil(total / PAGE);
  console.log(`  ${total.toLocaleString()} races, ${pages} pages of ${PAGE}`);

  if (DRY_RUN) {
    console.log(`  [dry run] would make ${pages} calls, ~${Math.round((pages * 0.4) / 60)} min at 400ms`);
    stats.bulkRaces = total;
    stats.bulkRunners = Math.round(total * 9.5);
    return;
  }

  for (let page = 0; page < pages; page++) {
    let payload: any;
    try {
      payload = await fetchResults(start, end, PAGE, page * PAGE);
      stats.apiCalls++;
    } catch (e) {
      stats.errors++;
      console.error(`  page ${page} failed: ${(e as Error).message}`);
      continue;
    }

    const list = payload.results ?? [];
    for (const raw of list) {
      const id = raw.race_id;
      if (!id || seenRaces.has(id)) continue;
      seenRaces.add(id);

      try {
        await storeHistoricalRace(store, raw);
        stats.bulkRaces++;
        stats.bulkRunners += (raw.runners ?? []).length;
        if (raw.date && raw.date < stats.oldestSeen) stats.oldestSeen = raw.date;
      } catch (e) {
        stats.errors++;
        // Surface the first failure loudly. Counting errors silently is how a
        // run once stored 2,476 races with zero runners: horse_name is NOT
        // NULL, every runner insert threw, and the total just ticked upward.
        if (stats.errors === 1) {
          console.error(`\n  FIRST ERROR (race ${raw.race_id}): ${(e as Error).message}\n`);
        }
      }
    }

    if (page % 10 === 0 || page === pages - 1) {
      process.stdout.write(
        `\r  page ${page + 1}/${pages}  ${stats.bulkRaces.toLocaleString()} races  ` +
          `${stats.bulkRunners.toLocaleString()} runners   `
      );
    }
  }
  console.log();
}

/**
 * Store one historical race.
 *
 * Result payloads carry no `off_time`, no odds and a different key for several
 * fields, so a race row is assembled from what a result actually has rather
 * than by pretending it is a racecard.
 */
/** Build the race and runner rows for one historical race, without writing. */
async function buildHistoricalRace(raw: any): Promise<{ race: any; runners: any[] } | null> {
  const result = mapResultRace(raw);
  const runnerRows = (raw.runners ?? []).map((h: any) => mapResultRunner(result.id, h));

  const offDt = raw.off_dt ? new Date(raw.off_dt) : null;
  if (!offDt || Number.isNaN(offDt.getTime())) return null;

  const { slugify, raceSlug } = await import("../lib/slug");
  const { normaliseGoing } = await import("../lib/going");
  const { offTime24, raceDateFromOffDt, stripCourseSuffix } = await import("../lib/mappers");

  const courseName = stripCourseSuffix(raw.course ?? "Unknown");
  const offTime = offTime24(offDt);

  return {
    race: {
      id: result.id,
      courseId: null, // historical courses may not be in our reference table
      courseName,
      courseSlug: slugify(courseName),
      raceDate: raceDateFromOffDt(offDt),
      offTime,
      offDt,
      name: raw.race_name ?? "Race",
      slug: raceSlug(offTime, raw.race_name ?? "Race"),
      distance: raw.dist ?? null,
      distanceF: raw.dist_f ? parseFloat(String(raw.dist_f)) : null,
      going: raw.going ?? null,
      goingBand: normaliseGoing(raw.going),
      surface: /aw|polytrack|tapeta|fibresand/i.test(raw.surface ?? "") ? "aw" : "turf",
      raceType: raw.type ?? null,
      raceClass: raw.class ?? null,
      pattern: raw.pattern ?? null,
      ageBand: raw.age_band ?? null,
      ratingBand: raw.rating_band ?? null,
      sexRestriction: raw.sex_rest ?? null,
      region: raw.region ?? null,
      fieldSize: (raw.runners ?? []).length,
      status: "result",
      resultAt: new Date(),
      winningTimeDetail: raw.winning_time_detail ?? null,
      nonRunnersText: raw.non_runners ?? null,
      comments: raw.comments ?? null,
      raw,
    },
    runners: runnerRows,
  };
}

async function storeHistoricalRace(store: Store | null, raw: any) {
  const result = mapResultRace(raw);
  const runnerRows = (raw.runners ?? []).map((h: any) => mapResultRunner(result.id, h));

  if (!store) return;

  const offDt = raw.off_dt ? new Date(raw.off_dt) : null;
  const { slugify, raceSlug } = await import("../lib/slug");
  const { normaliseGoing } = await import("../lib/going");
  const { offTime24, raceDateFromOffDt, stripCourseSuffix } = await import("../lib/mappers");

  if (!offDt || Number.isNaN(offDt.getTime())) return;

  const courseName = stripCourseSuffix(raw.course ?? "Unknown");
  const offTime = offTime24(offDt);

  const race = {
    id: result.id,
    courseId: raw.course_id ?? null,
    courseName,
    courseSlug: slugify(courseName),
    raceDate: raceDateFromOffDt(offDt),
    offTime,
    offDt,
    name: raw.race_name ?? "Race",
    slug: raceSlug(offTime, raw.race_name ?? "Race"),
    distance: raw.dist ?? null,
    distanceF: raw.dist_f ? parseFloat(String(raw.dist_f)) : null,
    going: raw.going ?? null,
    goingBand: normaliseGoing(raw.going),
    surface: /aw|polytrack|tapeta|fibresand/i.test(raw.surface ?? "") ? "aw" : "turf",
    raceType: raw.type ?? null,
    raceClass: raw.class ?? null,
    pattern: raw.pattern ?? null,
    ageBand: raw.age_band ?? null,
    ratingBand: raw.rating_band ?? null,
    sexRestriction: raw.sex_rest ?? null,
    region: raw.region ?? null,
    fieldSize: (raw.runners ?? []).length,
    status: "result",
    resultAt: new Date(),
    winningTimeDetail: raw.winning_time_detail ?? null,
    nonRunnersText: raw.non_runners ?? null,
    comments: raw.comments ?? null,
    raw,
  };

  await persistRace(store, race, runnerRows);
}

/* -------------------------------------------------- phase 2: horse careers */

/**
 * Which horses to fetch form for.
 *
 * Reads from the database rather than probe output, so it sees everything
 * already ingested rather than one saved payload. Horses whose form was
 * pulled recently are skipped, which makes a 30,000-call run resumable: stop
 * it, restart it, and it picks up where it left off.
 */
async function targetHorses(store: Store | null): Promise<Array<{ id: string; name: string }>> {
  if (!store) return [];
  const { db } = store;
  const { sql } = await import("drizzle-orm");

  const cutoff = `${REFRESH_DAYS} days`;

  // `qualifying` needs today's card run through the filters, which is easier
  // in JS than SQL; the other two are plain queries.
  if (HORSE_SCOPE === "qualifying") {
    const rows: any[] = await db.execute(sql`
      select r.horse_id, r.horse_name, ra.name race_name, ra.age_band, ra.race_class,
             r.age, r.is_non_runner
      from runners r join races ra on ra.id = r.race_id
      where ra.race_date >= current_date and ra.status = 'upcoming'`);

    const byRace = new Map<string, any[]>();
    for (const x of rows) {
      const k = `${x.race_name}||${x.age_band}||${x.race_class}`;
      if (!byRace.has(k)) byRace.set(k, []);
      byRace.get(k)!.push(x);
    }

    const out = new Map<string, string>();
    for (const [k, rs] of byRace) {
      const [raceName, ageBand, raceClass] = k.split("||");
      const verdict = filterRace(
        { raceName, ageBand: ageBand || null, raceClass: raceClass || null },
        rs.map((x) => ({ age: x.age, isNonRunner: x.is_non_runner }))
      );
      if (!verdict.eligible) continue;
      for (const x of rs) if (!x.is_non_runner) out.set(x.horse_id, x.horse_name);
    }
    return [...out].map(([id, name]) => ({ id, name }));
  }

  const rows: any[] =
    HORSE_SCOPE === "declared"
      ? await db.execute(sql`
          select distinct r.horse_id, r.horse_name
          from runners r join races ra on ra.id = r.race_id
          left join horses h on h.id = r.horse_id
          where ra.race_date >= current_date and r.is_non_runner = false
            and (h.form_fetched_at is null or h.form_fetched_at < now() - ${cutoff}::interval)`)
      : await db.execute(sql`
          select distinct r.horse_id, r.horse_name
          from runners r
          left join horses h on h.id = r.horse_id
          where h.form_fetched_at is null or h.form_fetched_at < now() - ${cutoff}::interval`);

  const list = rows.map((x: any) => ({ id: x.horse_id, name: x.horse_name }));
  return LIMIT_HORSES > 0 ? list.slice(0, LIMIT_HORSES) : list;
}

async function horseCareers(store: Store | null) {
  const horses = await targetHorses(store);
  console.log(
    `\nPHASE 2 — horse careers  [scope: ${HORSE_SCOPE}]  ` +
      `${horses.length.toLocaleString()} horses to fetch` +
      (LIMIT_HORSES ? ` (capped at ${LIMIT_HORSES})` : "")
  );
  if (!horses.length) {
    console.log(`  nothing to do — all fetched within the last ${REFRESH_DAYS} days`);
    return;
  }
  const eta = Math.round((horses.length * 0.4) / 60);
  console.log(`  ~${eta} min at 400ms per call`);

  if (DRY_RUN) {
    console.log(`  [dry run] would make ${horses.length} calls, ~${Math.round(horses.length * 0.4)}s`);
    console.log(`  each returns up to 50 career runs with the full field of every race`);
    // Sample three to show the real depth without hammering the API.
    const sample = horses.slice(0, 3);
    for (const h of sample) {
      try {
        const hr: any = await apiGet(endpoints.horseResults(h.id));
        stats.apiCalls++;
        const rs = hr.results ?? [];
        const dates = rs.map((r: any) => r.date).filter(Boolean).sort();
        const older = rs.filter((r: any) => r.date < monthsAgo(12)).length;
        const field = rs.reduce((n: number, r: any) => n + (r.runners?.length ?? 0), 0);
        console.log(
          `    ${h.name.padEnd(24)} ${String(rs.length).padStart(2)} runs  ` +
            `${dates[0] ?? "?"} .. ${dates[dates.length - 1] ?? "?"}  ` +
            `${older} beyond the bulk cut-off, ${field} runner rows`
        );
        if (dates[0] && dates[0] < stats.oldestSeen) stats.oldestSeen = dates[0];
      } catch {
        stats.errors++;
      }
    }
    return;
  }

  let n = 0;
  for (const h of horses) {
    n++;
    try {
      const hr: any = await apiGet(endpoints.horseResults(h.id));
      stats.apiCalls++;
      stats.horsesQueried++;

      const rs = hr.results ?? [];
      stats.horseRuns += rs.length;

      // Mark it fetched before storing races, so an interruption mid-horse
      // costs one re-fetch rather than restarting the whole run.
      const { sql: dsql } = await import("drizzle-orm");
      if (store) {
        await store.db.execute(dsql`
          update horses set form_fetched_at = now(), form_runs = ${rs.length}
          where id = ${h.id}`);
      }

      // Collect this horse's whole career, then write it in two statements
      // rather than two per race.
      const raceRows: any[] = [];
      const runnerRows: any[] = [];
      for (const raw of rs) {
        const id = raw.race_id;
        if (!id || seenRaces.has(id)) continue;
        seenRaces.add(id);
        const built = await buildHistoricalRace(raw);
        if (!built) continue;
        raceRows.push(built.race);
        runnerRows.push(...built.runners);
        stats.harvestedRaces++;
        stats.harvestedRunners += built.runners.length;
        if (raw.date && raw.date < stats.oldestSeen) stats.oldestSeen = raw.date;
      }
      await persistBatch(store, raceRows, runnerRows);
    } catch (e) {
      stats.errors++;
      if (stats.errors === 1) console.error(`\n  FIRST ERROR (${h.name}): ${(e as Error).message}\n`);
    }

    if (n % 10 === 0 || n === horses.length) {
      process.stdout.write(
        `\r  ${n}/${horses.length} horses  ${stats.harvestedRaces.toLocaleString()} extra races harvested   `
      );
    }
  }
  console.log();
}

/* -------------------------------------------------------------------- main */

async function main() {
  const started = Date.now();
  console.log(
    `\nBACKFILL${DRY_RUN ? "  [DRY RUN — no database writes]" : ""}\n` +
      `  bulk results : ${MONTHS ? `${MONTHS} months` : "skipped"}\n` +
      `  horse careers: ${DO_HORSES ? "yes" : "skipped"}`
  );

  let store: Store | null = null;
  if (!DRY_RUN) {
    if (!process.env.DATABASE_URL) {
      console.error("\n  DATABASE_URL is not set. Use --dry-run to plan without a database.\n");
      process.exit(1);
    }
    store = await loadStore();
  }

  if (store) await preloadSeen(store);
  if (MONTHS) await bulkResults(store);
  if (DO_HORSES) await horseCareers(store);

  const secs = Math.round((Date.now() - started) / 1000);
  console.log(`\nSUMMARY  (${secs}s, ${stats.apiCalls} API calls)`);
  if (MONTHS) {
    console.log(`  bulk races        ${stats.bulkRaces.toLocaleString()}`);
    console.log(`  bulk runners      ${stats.bulkRunners.toLocaleString()}`);
  }
  if (DO_HORSES) {
    console.log(`  horses queried    ${stats.horsesQueried.toLocaleString()}`);
    console.log(`  career runs       ${stats.horseRuns.toLocaleString()}`);
    console.log(`  races harvested   ${stats.harvestedRaces.toLocaleString()}`);
    console.log(`  runner rows       ${stats.harvestedRunners.toLocaleString()}`);
  }
  if (stats.oldestSeen !== "9999-99-99") console.log(`  oldest race seen  ${stats.oldestSeen}`);
  if (stats.errors) console.log(`  errors            ${stats.errors}`);
  console.log();

  if (store) await store.client.end();
}

main().catch((e) => {
  console.error("\nBackfill failed:", e.message);
  process.exit(1);
});
