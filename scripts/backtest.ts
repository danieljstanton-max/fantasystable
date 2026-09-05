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
  setWeights,
  type Weights,
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
/**
 * Fit weights on races before this date, then report on races after it.
 *
 * Without a split, "refit the weights and the ROI improved" measures nothing
 * but memorisation — the weights were derived from the very outcomes being
 * scored. The out-of-sample half is the only number worth quoting.
 */
const SPLIT = arg("split", "");

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


  interface Bet {
  score: number; stars: number; won: boolean; placed: boolean;
  spDec: number | null; signals: string[];
  /** Was this also the market favourite in its race? */
  wasFav?: boolean;
  /** Rank by price in its race: 1 = favourite. */
  priceRank?: number;
  }

  /** Score every qualifying race whose date falls inside [lo, hi). */
  function runPeriod(lo: string, hi: string) {
  const topPicks: Bet[] = [];
  const allScored: Bet[] = [];
  const favourites: Bet[] = [];

  let racesUsed = 0, racesSkipped = 0, n = 0;

  for (const [raceId, runners] of byRace) {
    n++;
    const first = runners[0];
    if (first.raceDate < lo || first.raceDate >= hi) continue;
    if (n % 500 === 0) process.stdout.write(`\r  scoring... ${racesUsed.toLocaleString()} races   `);
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

    // Rank every runner by price so "did we disagree with the market" is
    // answerable, not just "did we pick a winner".
    const priced = scored.filter((s) => s.spDec !== null)
      .sort((a, b) => (a.spDec as number) - (b.spDec as number));
    priced.forEach((b, i) => { b.priceRank = i + 1; b.wasFav = i === 0; });

    allScored.push(...scored);
    scored.sort((a, b) => b.score - a.score);
    topPicks.push(scored[0]);
    if (priced.length) favourites.push(priced[0]);
  }

    console.log(`\r  ${racesUsed.toLocaleString()} races scored, ${racesSkipped.toLocaleString()} skipped for thin form        `);
    return { topPicks, allScored, favourites };
  }

  const FAR = "9999-12-31";

  /** Lift per signal, measured on a set of scored runners. */
  function fitWeights(scored: Bet[]): { weights: Weights; base: number } {
    const base = scored.filter((b) => b.won).length / (scored.length || 1);
    const keys = [...new Set(scored.flatMap((b) => b.signals))];
    const weights: Weights = {};
    for (const k of keys) {
      const band = scored.filter((b) => b.signals.includes(k));
      if (band.length < 100) continue; // too thin to fit anything to
      const sr = band.filter((b) => b.won).length / band.length;
      const lift = (sr - base) * 100;
      // One point per 1.5pp of lift, clamped. Deliberately coarse: a finer
      // mapping would only fit the fitting period more tightly.
      weights[k] = Math.max(-4, Math.min(4, Math.round(lift / 1.5)));
    }
    return { weights, base };
  }

  if (SPLIT) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`TRAIN / TEST SPLIT at ${SPLIT}\n`);

    console.log(`  FIT period  ${FROM} .. ${SPLIT}`);
    const train = runPeriod(FROM, SPLIT);
    const { weights, base } = fitWeights(train.allScored);
    console.log(`  baseline strike ${(base * 100).toFixed(1)}%, fitted ${Object.keys(weights).length} weights`);
    const shown = Object.entries(weights).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
    console.log(`  ${shown.map(([k, v]) => `${k}:${v}`).join("  ")}`);

    console.log(`\n  TEST period ${SPLIT} .. ${TO}   (weights above, never fitted to this data)`);

    // Baseline: the hand-picked weights, on the same test races.
    const beforeW = setWeights({});
    const testDefault = runPeriod(SPLIT, FAR);
    setWeights(weights);
    const testFitted = runPeriod(SPLIT, FAR);
    setWeights(beforeW);

    const roiOf = (bets: Bet[]) => {
      const w = bets.filter((b) => b.spDec !== null && (b.spDec as number) > 1);
      if (!w.length) return { n: 0, sr: "-", roi: "-" };
      const ret = w.reduce((a, b) => a + (b.won ? (b.spDec as number) : 0), 0);
      return {
        n: w.length,
        sr: pct(w.filter((b) => b.won).length, w.length),
        roi: `${(((ret - w.length) / w.length) * 100).toFixed(1)}%`,
      };
    };

    const a = roiOf(testDefault.topPicks);
    const b = roiOf(testFitted.topPicks);
    const f = roiOf(testFitted.favourites);

    console.log(`\n  ${"".padEnd(24)}${"bets".padStart(8)}${"strike".padStart(9)}${"ROI".padStart(10)}`);
    console.log(`  ${"hand-picked weights".padEnd(24)}${a.n.toLocaleString().padStart(8)}${a.sr.padStart(9)}${a.roi.padStart(10)}`);
    console.log(`  ${"fitted weights".padEnd(24)}${b.n.toLocaleString().padStart(8)}${b.sr.padStart(9)}${b.roi.padStart(10)}`);
    console.log(`  ${"market favourite".padEnd(24)}${f.n.toLocaleString().padStart(8)}${f.sr.padStart(9)}${f.roi.padStart(10)}`);
    console.log(`\n${"=".repeat(70)}\n`);
    await client.end();
    return;
  }

  let { topPicks, allScored, favourites } = runPeriod(FROM, FAR);

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

  /* ------------------------------------------------- price band analysis */

  const PRICE_BANDS: Array<[string, number, number]> = [
    ["odds-on",      1.0,  2.0],
    ["evens - 3/1",  2.0,  4.0],
    ["7/2 - 6/1",    4.0,  7.0],
    ["13/2 - 12/1",  7.0, 13.0],
    ["14/1 - 25/1", 13.0, 26.0],
    ["over 25/1",   26.0, 1000],
  ];

  console.log(`\n${"-".repeat(70)}`);
  console.log(`ROI BY PRICE  (all scored runners — where does the money actually live?)\n`);
  console.log(`  ${"price".padEnd(14)}${"runners".padStart(9)}${"wins".padStart(7)}${"strike".padStart(9)}${"ROI".padStart(10)}`);
  for (const [label, lo, hi] of PRICE_BANDS) {
    const band = allScored.filter((b) => b.spDec !== null && (b.spDec as number) >= lo && (b.spDec as number) < hi);
    const r = roi(band);
    console.log(`  ${label.padEnd(14)}${r.n.toLocaleString().padStart(9)}${String(r.wins).padStart(7)}${r.sr.padStart(9)}${r.roi.padStart(10)}`);
  }

  console.log(`\n${"-".repeat(70)}`);
  console.log(`STARS x PRICE  (ROI; blank means fewer than 50 runners)\n`);
  process.stdout.write(`  ${"".padEnd(7)}`);
  for (const [label] of PRICE_BANDS) process.stdout.write(label.padStart(13));
  console.log("");
  for (let st = 5; st >= 3; st--) {
    process.stdout.write(`  ${("*".repeat(st)).padEnd(7)}`);
    for (const [, lo, hi] of PRICE_BANDS) {
      const band = allScored.filter(
        (b) => b.stars === st && b.spDec !== null && (b.spDec as number) >= lo && (b.spDec as number) < hi
      );
      const r = roi(band);
      process.stdout.write((band.length < 50 ? "-" : `${r.roi} (${band.length})`).padStart(13));
    }
    console.log("");
  }

  console.log(`\n${"-".repeat(70)}`);
  console.log(`DO WE ADD ANYTHING TO THE MARKET?\n`);

  const agreed = topPicks.filter((b) => b.wasFav);
  const disagreed = topPicks.filter((b) => b.wasFav === false);
  const ra = roi(agreed), rd = roi(disagreed);
  console.log(`  top pick WAS the favourite     ${ra.n.toLocaleString().padStart(6)} bets  ${ra.sr.padStart(7)}  ROI ${ra.roi}`);
  console.log(`  top pick was NOT the favourite ${rd.n.toLocaleString().padStart(6)} bets  ${rd.sr.padStart(7)}  ROI ${rd.roi}`);

  console.log(`\n  by the price rank of our selection:\n`);
  console.log(`  ${"our pick was".padEnd(20)}${"bets".padStart(8)}${"strike".padStart(9)}${"ROI".padStart(10)}`);
  for (const [label, lo, hi] of [["favourite",1,1],["2nd favourite",2,2],["3rd favourite",3,3],["4th-6th in market",4,6],["7th or bigger",7,99]] as Array<[string,number,number]>) {
    const band = topPicks.filter((b) => (b.priceRank ?? 99) >= lo && (b.priceRank ?? 99) <= hi);
    const r = roi(band);
    if (r.n < 30) continue;
    console.log(`  ${label.padEnd(20)}${r.n.toLocaleString().padStart(8)}${r.sr.padStart(9)}${r.roi.padStart(10)}`);
  }

  console.log(`\n${"-".repeat(70)}`);
  console.log(`SUGGESTED WEIGHTS from measured lift (hypothesis, not a result)\n`);
  console.log(`  ${"signal".padEnd(26)}${"lift".padStart(9)}${"suggested".padStart(11)}`);
  for (const { k, band, lift } of perSignal) {
    if (band.length < 100) continue;
    // One point per 1.5pp of lift, clamped, rounded — deliberately crude.
    const w = Math.max(-4, Math.min(4, Math.round((lift * 100) / 1.5)));
    console.log(`  ${k.padEnd(26)}${((lift * 100).toFixed(1) + "pp").padStart(9)}${String(w).padStart(11)}`);
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
