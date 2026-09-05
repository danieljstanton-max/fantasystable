/**
 * Backtest the selection model against real results.
 *
 *   npm run backtest
 *   npm run backtest -- --from=2026-01-01 --to=2026-08-01
 *   npm run backtest -- --min-runs=4
 *
 * Runs the scorer over past qualifying races using ONLY form that existed
 * before each race, then measures what actually happened.
 *
 * The headline number is the ROI from backing the top-rated horse in every
 * qualifying race, to starting price, level stakes. Everything else exists to
 * explain that number: strike rate by star band, and each signal's record when
 * it fired.
 *
 * NO LOOKAHEAD. History for a horse is strictly runs before the race being
 * scored. The whole exercise is worthless otherwise, so it is enforced in one
 * place — buildHistory() — rather than trusted to each caller.
 */

import "dotenv/config";
import postgres from "postgres";

import {
  filterRace,
  scoreHorse,
  starsFromScore,
  type PastRun,
  type HorseToday,
  type RaceToday,
} from "../lib/selection";
import type { GoingBand } from "../lib/going";

const client = postgres(process.env.DATABASE_URL!, { max: 4, ssl: "require" });

const args = process.argv.slice(2);
const arg = (k: string, d: string) =>
  args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;

const FROM = arg("from", "2025-08-27");
const TO = arg("to", new Date().toISOString().slice(0, 10));
/** A horse needs at least this many prior runs to be scoreable. */
const MIN_RUNS = parseInt(arg("min-runs", "3"), 10);

interface Row {
  raceId: string;
  raceDate: string;
  courseSlug: string;
  distanceF: number | null;
  goingBand: string | null;
  raceType: string | null;
  raceName: string;
  ageBand: string | null;
  raceClass: string | null;
  fieldSize: number | null;
  horseId: string;
  horseName: string;
  age: number | null;
  positionNum: number | null;
  position: string | null;
  ofr: number | null;
  spDec: number | null;
  jockeyId: string | null;
  comment: string | null;
  ovrBtn: number | null;
  isNonRunner: boolean;
  t14Runs: number | null;
  t14Wins: number | null;
  t14Pct: number | null;
  headgearFirst: boolean;
  windRun: string | null;
  winMargin: number | null;
}

function pct(n: number, d: number) {
  return d ? `${((n / d) * 100).toFixed(1)}%` : "-";
}

async function main() {
  console.log(`\nBACKTEST  ${FROM} .. ${TO}   (min ${MIN_RUNS} prior runs)\n${"=".repeat(70)}`);

  process.stdout.write("  loading history into memory... ");
  const rows: Row[] = (await client`
    select ra.id "raceId", ra.race_date::text "raceDate", ra.course_slug "courseSlug",
           ra.distance_f "distanceF", ra.going_band "goingBand", ra.race_type "raceType",
           ra.name "raceName", ra.age_band "ageBand", ra.race_class "raceClass",
           ra.field_size "fieldSize",
           r.horse_id "horseId", r.horse_name "horseName", r.age,
           r.position_num "positionNum", r.position, r.ofr, r.sp_dec "spDec",
           r.jockey_id "jockeyId", r.comment, r.ovr_btn "ovrBtn",
           r.is_non_runner "isNonRunner",
           r.trainer_14_runs "t14Runs", r.trainer_14_wins "t14Wins",
           r.trainer_14_percent "t14Pct",
           coalesce(r.headgear_first_time,false) "headgearFirst",
           r.wind_surgery_run "windRun",
           (select min(w.ovr_btn) from runners w
             where w.race_id = ra.id and w.position_num = 2) "winMargin"
    from runners r join races ra on ra.id = r.race_id
    where ra.status = 'result' and r.position is not null
    order by ra.race_date`) as any;
  console.log(`${rows.length.toLocaleString()} settled runs`);

  // Index every horse's runs, oldest first, so a slice by date is cheap.
  const byHorse = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byHorse.has(r.horseId)) byHorse.set(r.horseId, []);
    byHorse.get(r.horseId)!.push(r);
  }

  const byRace = new Map<string, Row[]>();
  for (const r of rows) {
    if (r.raceDate < FROM || r.raceDate > TO) continue;
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId)!.push(r);
  }
  console.log(`  ${byRace.size.toLocaleString()} races in range`);

  /** Strictly runs BEFORE `before`. This is the only place history is built. */
  function buildHistory(horseId: string, before: string): PastRun[] {
    const all = byHorse.get(horseId) ?? [];
    const out: PastRun[] = [];
    for (let i = all.length - 1; i >= 0; i--) {
      const r = all[i];
      if (r.raceDate >= before) continue; // no lookahead, and no same-day form
      out.push({
        raceDate: r.raceDate,
        courseSlug: r.courseSlug,
        distanceF: r.distanceF,
        goingBand: (r.goingBand ?? "unknown") as GoingBand,
        positionNum: r.positionNum,
        ofr: r.ofr,
        fieldSize: r.fieldSize,
        jockeyId: r.jockeyId,
        comment: r.comment,
        raceType: r.raceType,
        ovrBtn: r.ovrBtn,
        age: r.age,
        winMargin: r.positionNum === 1 ? r.winMargin : null,
      });
      if (out.length >= 50) break;
    }
    return out;
  }

  // Jockey strike rates from the whole set. Slightly generous — it uses the
  // full period rather than only what was known at the time — but jockey form
  // moves slowly and rebuilding it per day would dominate the runtime.
  const jk = new Map<string, { rides: number; wins: number }>();
  for (const r of rows) {
    if (!r.jockeyId) continue;
    if (!jk.has(r.jockeyId)) jk.set(r.jockeyId, { rides: 0, wins: 0 });
    const t = jk.get(r.jockeyId)!;
    t.rides++;
    if (r.positionNum === 1) t.wins++;
  }
  const jockeyStrikeRate = (id: string) => {
    const t = jk.get(id);
    return t && t.rides >= 20 ? Math.round((t.wins / t.rides) * 100) : null;
  };

  /* ------------------------------------------------------------- run it */

  interface Bet { score: number; stars: number; won: boolean; placed: boolean; spDec: number | null; signals: string[]; }
  const topPicks: Bet[] = [];
  const allScored: Bet[] = [];
  const favourites: Bet[] = [];

  let racesUsed = 0, racesSkipped = 0, n = 0;

  for (const [raceId, runners] of byRace) {
    n++;
    if (n % 250 === 0) process.stdout.write(`\r  scoring ${n}/${byRace.size}...   `);

    const first = runners[0];
    const live = runners.filter((r) => !r.isNonRunner);

    const verdict = filterRace(
      { raceName: first.raceName, ageBand: first.ageBand, raceClass: first.raceClass },
      live.map((r) => ({ age: r.age, isNonRunner: r.isNonRunner }))
    );
    if (!verdict.eligible) continue;

    const race: RaceToday = {
      courseSlug: first.courseSlug,
      distanceF: first.distanceF,
      goingBand: (first.goingBand ?? "unknown") as GoingBand,
      raceType: first.raceType,
    };

    const scored: Array<Bet & { horseName: string }> = [];
    for (const r of live) {
      const history = buildHistory(r.horseId, r.raceDate);
      if (history.length < MIN_RUNS) continue;

      const today: HorseToday = {
        horseId: r.horseId,
        horseName: r.horseName,
        ofr: r.ofr,
        age: r.age,
        jockeyId: r.jockeyId,
        bestOddsDec: r.spDec,
        headgearFirstTime: r.headgearFirst,
        windSurgeryFirstTime: r.windRun === "1",
        daysSinceRun: daysBetween(history[0]?.raceDate, r.raceDate),
        trainer14Runs: r.t14Runs,
        trainer14Wins: r.t14Wins,
        trainer14Percent: r.t14Pct,
      };

      const s = scoreHorse(today, race, history, jockeyStrikeRate, r.raceDate);
      scored.push({
        horseName: r.horseName,
        score: s.score,
        stars: starsFromScore(s.score),
        won: r.positionNum === 1,
        placed: r.positionNum !== null && r.positionNum <= 3,
        spDec: r.spDec,
        signals: s.signals.map((x) => x.key),
      });
    }

    // Need most of the field scoreable for the race to be a fair test.
    if (scored.length < Math.max(4, Math.floor(live.length * 0.6))) { racesSkipped++; continue; }

    racesUsed++;
    allScored.push(...scored);
    scored.sort((a, b) => b.score - a.score);
    topPicks.push(scored[0]);

    // Baseline: the market's favourite in the same race.
    const priced = scored.filter((s) => s.spDec !== null);
    if (priced.length) {
      priced.sort((a, b) => (a.spDec as number) - (b.spDec as number));
      favourites.push(priced[0]);
    }
  }

  console.log(`\r  ${racesUsed.toLocaleString()} races scored, ${racesSkipped.toLocaleString()} skipped for thin form        `);

  /* --------------------------------------------------------- reporting */

  const roi = (bets: Bet[]) => {
    const withPrice = bets.filter((b) => b.spDec !== null && (b.spDec as number) > 1);
    if (!withPrice.length) return { n: 0, wins: 0, sr: "-", roi: "-", profit: 0 };
    let ret = 0;
    for (const b of withPrice) if (b.won) ret += b.spDec as number;
    const profit = ret - withPrice.length;
    return {
      n: withPrice.length,
      wins: withPrice.filter((b) => b.won).length,
      sr: pct(withPrice.filter((b) => b.won).length, withPrice.length),
      roi: `${((profit / withPrice.length) * 100).toFixed(1)}%`,
      profit: Math.round(profit * 100) / 100,
    };
  };

  console.log(`\n${"=".repeat(70)}`);
  console.log(`HEADLINE — backing the top-rated horse in every qualifying race\n`);
  const t = roi(topPicks);
  console.log(`  bets        ${t.n.toLocaleString()}`);
  console.log(`  winners     ${t.wins.toLocaleString()}`);
  console.log(`  strike rate ${t.sr}`);
  console.log(`  P/L to SP   ${t.profit > 0 ? "+" : ""}${t.profit} points`);
  console.log(`  ROI         ${t.roi}`);

  const f = roi(favourites);
  console.log(`\n  Baseline — backing the favourite in the same races`);
  console.log(`  strike rate ${f.sr}   ROI ${f.roi}   (${f.n.toLocaleString()} bets)`);

  console.log(`\n${"-".repeat(70)}`);
  console.log(`BY STAR BAND  (every scored runner, not just the top pick)\n`);
  console.log(`  ${"stars".padEnd(7)}${"runners".padStart(9)}${"wins".padStart(7)}${"strike".padStart(9)}${"ROI".padStart(10)}`);
  for (let st = 5; st >= 1; st--) {
    const band = allScored.filter((b) => b.stars === st);
    const r = roi(band);
    console.log(`  ${("*".repeat(st)).padEnd(7)}${r.n.toLocaleString().padStart(9)}${String(r.wins).padStart(7)}${r.sr.padStart(9)}${r.roi.padStart(10)}`);
  }

  console.log(`\n${"-".repeat(70)}`);
  console.log(`BY SIGNAL  (does it beat the baseline when it fires?)\n`);
  const baseSR = allScored.filter((b) => b.won).length / allScored.length;
  console.log(`  baseline strike rate across all scored runners: ${(baseSR * 100).toFixed(1)}%\n`);
  console.log(`  ${"signal".padEnd(26)}${"fired".padStart(8)}${"wins".padStart(7)}${"strike".padStart(9)}${"vs base".padStart(10)}${"ROI".padStart(9)}`);

  const keys = [...new Set(allScored.flatMap((b) => b.signals))].sort();
  const perSignal = keys.map((k) => {
    const band = allScored.filter((b) => b.signals.includes(k));
    const r = roi(band);
    const sr = band.filter((b) => b.won).length / (band.length || 1);
    return { k, band, r, lift: sr - baseSR };
  });
  perSignal.sort((a, b) => b.lift - a.lift);
  for (const { k, band, r, lift } of perSignal) {
    if (band.length < 30) continue;
    const arrow = lift > 0.01 ? "+" : lift < -0.01 ? "-" : " ";
    console.log(
      `  ${k.padEnd(26)}${band.length.toLocaleString().padStart(8)}${String(r.wins).padStart(7)}` +
        `${r.sr.padStart(9)}${(arrow + (lift * 100).toFixed(1) + "pp").padStart(10)}${r.roi.padStart(9)}`
    );
  }

  console.log(`\n${"=".repeat(70)}\n`);
  await client.end();
}

function daysBetween(from: string | undefined, to: string): number | null {
  if (!from) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
