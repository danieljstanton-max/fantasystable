/**
 * Train and evaluate the data-driven model.
 *
 *   npm run train
 *   npm run train -- --split=2026-04-01 --handicaps-only
 *
 * Extracts features for every runner in every past race, fits a conditional
 * logit on the earlier period, and evaluates on the later one — races the fit
 * never saw.
 *
 * Three questions, in order of how much they matter:
 *
 *   1. Does it beat knowing nothing?        log loss vs log(field size)
 *   2. Is it honest about its own numbers?  calibration
 *   3. Does it disagree with the market
 *      in a way that makes money?           value betting, out of sample
 *
 * Only the third is worth anything commercially, and the first two are how you
 * tell whether the third is real or a coincidence.
 */

import "dotenv/config";
import postgres from "postgres";

import { extract, FEATURE_NAMES, N_FEATURES, type RunnerToday, type ExtractContext } from "../lib/features";
import { fit, predictRace, logLoss, calibration, marketProbabilities, type Race } from "../lib/model";
import { filterRace, type PastRun } from "../lib/selection";
import type { GoingBand } from "../lib/going";

const client = postgres(process.env.DATABASE_URL!, { max: 4, ssl: "require" });
const args = process.argv.slice(2);
const arg = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;

const SPLIT = arg("split", "2026-04-01");

// The window of racing to load. Unbounded, this pulled all 1.68m settled runs
// into the heap and died on an 8GB machine before a single feature was
// extracted. A fit needs enough history to be stable, not all of it.
const FROM = arg("from", "2024-09-01");
const TO   = arg("to", new Date().toISOString().slice(0, 10));
const HANDICAPS_ONLY = !args.includes("--all-races");
const MIN_HISTORY = parseInt(arg("min-history", "3"), 10);

interface Row {
  raceId: string; raceDate: string; courseSlug: string; distanceF: number | null;
  goingBand: string | null; raceType: string | null; raceName: string;
  ageBand: string | null; raceClass: string | null; fieldSize: number | null;
  horseId: string; horseName: string; age: number | null; draw: number | null;
  positionNum: number | null; ofr: number | null; spDec: number | null;
  jockeyId: string | null; jockeyClaimLbs: number | null; comment: string | null;
  ovrBtn: number | null; isNonRunner: boolean;
  t14Pct: number | null; t14Runs: number | null;
  headgearFirst: boolean; windRun: string | null;
}

function drawDistBand(f: number | null): string | null {
  if (f === null) return null;
  if (f <= 5.5) return "5f";
  if (f <= 6.5) return "6f";
  if (f <= 7.5) return "7f";
  if (f <= 8.5) return "1m";
  if (f <= 10.5) return "1m1f-1m2f";
  if (f <= 12.5) return "1m3f-1m4f";
  return "beyond 1m4f";
}
function paceDistBand(f: number | null): string | null {
  if (f === null) return null;
  if (f <= 6.5) return "sprint";
  if (f <= 8.5) return "7f-1m";
  if (f <= 12.5) return "1m1f-1m4f";
  if (f <= 17) return "1m5f-2m";
  if (f <= 22) return "2m1f-2m6f";
  return "beyond 2m6f";
}
function drawBandOf(draw: number | null, field: number): string | null {
  if (draw === null || field < 6) return null;
  const p = (draw - 1) / (field - 1);
  return p <= 1 / 3 ? "low" : p >= 2 / 3 ? "high" : "mid";
}

async function main() {
  console.log(`\nTRAINING THE DATA-DRIVEN MODEL\n${"=".repeat(76)}`);
  console.log(`  split ${SPLIT}   ${HANDICAPS_ONLY ? "handicaps only" : "all races"}   min ${MIN_HISTORY} prior runs\n`);

  process.stdout.write("  loading runs... ");
  const rows: Row[] = (await client`
    select ra.id "raceId", ra.race_date::text "raceDate", ra.course_slug "courseSlug",
           ra.distance_f "distanceF", ra.going_band "goingBand", ra.race_type "raceType",
           ra.name "raceName", ra.age_band "ageBand", ra.race_class "raceClass",
           ra.field_size "fieldSize",
           r.horse_id "horseId", r.horse_name "horseName", r.age, r.draw,
           r.position_num "positionNum", r.ofr, r.sp_dec "spDec",
           r.jockey_id "jockeyId", r.jockey_claim_lbs "jockeyClaimLbs",
           left(r.comment, 300) comment, r.ovr_btn "ovrBtn", r.is_non_runner "isNonRunner",
           r.trainer_14_percent "t14Pct", r.trainer_14_runs "t14Runs",
           coalesce(r.headgear_first_time,false) "headgearFirst",
           r.wind_surgery_run "windRun"
    from runners r join races ra on ra.id = r.race_id
    where ra.status = 'result' and r.position is not null
      and ra.race_date between ${FROM} and ${TO}
    order by ra.race_date`) as any;
  console.log(`${rows.length.toLocaleString()}`);

  const byHorse = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byHorse.has(r.horseId)) byHorse.set(r.horseId, []);
    byHorse.get(r.horseId)!.push(r);
  }
  const byRace = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId)!.push(r);
  }
  console.log(`  ${byRace.size.toLocaleString()} races, ${byHorse.size.toLocaleString()} horses`);

  // Measured biases, if they have been built.
  const drawMap = new Map<string, number>();
  for (const d of (await client`select * from draw_bias`) as any)
    drawMap.set(`${d.course_slug}|${d.dist_band}|${d.going_band}|${d.draw_band}`, Number(d.impact_value));
  const paceMap = new Map<string, number>();
  for (const p of (await client`select * from pace_bias`) as any)
    paceMap.set(`${p.course_slug}|${p.dist_band}|${p.race_code}|${p.run_style}`, Number(p.impact_value));
  console.log(`  ${drawMap.size} draw cells, ${paceMap.size} pace cells`);

  const jk = new Map<string, { rides: number; wins: number }>();
  for (const r of rows) {
    if (!r.jockeyId) continue;
    if (!jk.has(r.jockeyId)) jk.set(r.jockeyId, { rides: 0, wins: 0 });
    const t = jk.get(r.jockeyId)!;
    t.rides++;
    if (r.positionNum === 1) t.wins++;
  }
  const jockeyStrike = (id: string | null) => {
    if (!id) return null;
    const t = jk.get(id);
    return t && t.rides >= 20 ? (t.wins / t.rides) * 100 : null;
  };

  /** Runs strictly before `before` — the only place history is built. */
  function history(horseId: string, before: string): PastRun[] {
    const all = byHorse.get(horseId) ?? [];
    const out: PastRun[] = [];
    for (let i = all.length - 1; i >= 0; i--) {
      const r = all[i];
      if (r.raceDate >= before) continue;
      out.push({
        raceDate: r.raceDate, courseSlug: r.courseSlug, distanceF: r.distanceF,
        goingBand: (r.goingBand ?? "unknown") as GoingBand, positionNum: r.positionNum,
        ofr: r.ofr, fieldSize: r.fieldSize, jockeyId: r.jockeyId, comment: r.comment,
        raceType: r.raceType, ovrBtn: r.ovrBtn, age: r.age, winMargin: null,
      });
      if (out.length >= 30) break;
    }
    return out;
  }

  /* ------------------------------------------------- build the dataset --- */

  process.stdout.write("  extracting features... ");
  interface Built extends Race { raceDate: string; spDecs: Array<number | null>; names: string[]; }
  const built: Built[] = [];
  let skipped = 0;

  for (const [raceId, all] of byRace) {
    const live = all.filter((r) => !r.isNonRunner);
    if (live.length < 5) { skipped++; continue; }

    if (HANDICAPS_ONLY) {
      const v = filterRace(
        { raceName: live[0].raceName, ageBand: live[0].ageBand, raceClass: live[0].raceClass },
        live.map((r) => ({ age: r.age, isNonRunner: r.isNonRunner }))
      );
      if (!v.eligible) { skipped++; continue; }
    }

    const winnerIdx = live.findIndex((r) => r.positionNum === 1);
    if (winnerIdx < 0) { skipped++; continue; }

    const ofrs = live.map((r) => r.ofr).filter((o): o is number => o !== null);
    const first = live[0];
    const dBand = drawDistBand(first.distanceF);
    const pBand = paceDistBand(first.distanceF);

    const xs: number[][] = [];
    let usable = true;
    for (const r of live) {
      const hist = history(r.horseId, r.raceDate);
      if (hist.length < MIN_HISTORY) { usable = false; break; }

      const band = drawBandOf(r.draw, live.length);
      const drawIv = band && dBand
        ? drawMap.get(`${first.courseSlug}|${dBand}|${first.goingBand ?? "unknown"}|${band}`) ?? null
        : null;

      // Habitual style for the pace lookup, from prior runs only.
      const { readComment } = await import("../lib/form-reading");
      const styles = hist.slice(0, 5).map((h) => readComment(h.comment).runStyle).filter(Boolean) as string[];
      const counts = new Map<string, number>();
      for (const s of styles) counts.set(s, (counts.get(s) ?? 0) + 1);
      let habit: string | null = null, best = 0;
      for (const [k, v] of counts) if (v > best) { habit = k; best = v; }
      const paceIv = habit && best >= 3 && pBand && first.raceType
        ? paceMap.get(`${first.courseSlug}|${pBand}|${first.raceType}|${habit}`) ?? null
        : null;

      const ctx: ExtractContext = {
        ofrsInRace: ofrs, fieldSize: live.length, raceDate: r.raceDate,
        raceType: first.raceType, goingBand: first.goingBand ?? "unknown",
        distanceF: first.distanceF, courseSlug: first.courseSlug,
        jockeyStrike, drawIv, paceIv,
      };
      const today: RunnerToday = {
        horseId: r.horseId, horseName: r.horseName, ofr: r.ofr, age: r.age, draw: r.draw,
        jockeyId: r.jockeyId, jockeyClaimLbs: r.jockeyClaimLbs,
        headgearFirstTime: r.headgearFirst, windSurgeryFirstTime: r.windRun === "1",
        trainer14Pct: r.t14Pct, trainer14Runs: r.t14Runs,
      };
      xs.push(extract(today, ctx, hist));
    }
    if (!usable) { skipped++; continue; }

    built.push({
      x: xs, winner: winnerIdx, raceDate: first.raceDate,
      spDecs: live.map((r) => r.spDec), names: live.map((r) => r.horseName),
    });
  }
  console.log(`${built.length.toLocaleString()} races usable, ${skipped.toLocaleString()} skipped`);

  const train = built.filter((r) => r.raceDate < SPLIT);
  const test = built.filter((r) => r.raceDate >= SPLIT);
  console.log(`  train ${train.length.toLocaleString()}   test ${test.length.toLocaleString()}\n`);
  if (train.length < 200 || test.length < 100) {
    console.log("  not enough races either side of the split.\n");
    await client.end();
    return;
  }

  /* -------------------------------------------------------------- fit ---- */

  console.log(`  fitting on ${train.length.toLocaleString()} races...`);
  const { w, history: hist } = fit(train, { epochs: 400, l2: 0.02, verbose: 100 });

  const avgField = built.reduce((a, r) => a + r.x.length, 0) / built.length;
  const naive = Math.log(avgField);
  const trainLoss = logLoss(w, train);
  const testLoss = logLoss(w, test);

  console.log(`\n${"-".repeat(76)}`);
  console.log(`1. DOES IT BEAT KNOWING NOTHING?\n`);
  console.log(`  average field          ${avgField.toFixed(1)} runners`);
  console.log(`  log loss, no knowledge ${naive.toFixed(4)}`);
  console.log(`  log loss, train        ${trainLoss.toFixed(4)}`);
  console.log(`  log loss, TEST         ${testLoss.toFixed(4)}   ${testLoss < naive ? "better than chance" : "NO BETTER THAN CHANCE"}`);

  /* ------------------------------------------------------- coefficients -- */

  console.log(`\n${"-".repeat(76)}`);
  console.log(`WHAT THE DATA SAYS MATTERS  (fitted, not chosen)\n`);
  const ranked = FEATURE_NAMES.map((n, i) => ({ n, w: w[i] })).sort((a, b) => Math.abs(b.w) - Math.abs(a.w));
  console.log(`  ${"feature".padEnd(24)}${"weight".padStart(9)}`);
  for (const f of ranked.slice(0, 18))
    console.log(`  ${f.n.padEnd(24)}${f.w.toFixed(3).padStart(9)}  ${f.w > 0 ? "+".repeat(Math.min(8, Math.round(Math.abs(f.w) * 4))) : "-".repeat(Math.min(8, Math.round(Math.abs(f.w) * 4)))}`);

  /* -------------------------------------------------------- calibration -- */

  const preds: Array<{ p: number; won: boolean }> = [];
  for (const r of test) {
    const p = predictRace(w, r.x);
    p.forEach((pi, i) => preds.push({ p: pi, won: i === r.winner }));
  }
  console.log(`\n${"-".repeat(76)}`);
  console.log(`2. IS IT HONEST ABOUT ITS OWN NUMBERS?  (out of sample)\n`);
  console.log(`  ${"predicted".padEnd(12)}${"runners".padStart(9)}${"we said".padStart(10)}${"actual".padStart(9)}`);
  for (const b of calibration(preds))
    console.log(
      `  ${(`${(b.lo * 100).toFixed(0)}-${(b.hi * 100).toFixed(0)}%`).padEnd(12)}${b.n.toLocaleString().padStart(9)}` +
        `${(b.predicted * 100).toFixed(1).padStart(9)}%${(b.actual * 100).toFixed(1).padStart(8)}%`
    );

  /* ------------------------------------------------------ value betting -- */

  console.log(`\n${"-".repeat(76)}`);
  console.log(`3. DOES DISAGREEING WITH THE MARKET MAKE MONEY?  (out of sample)\n`);
  console.log(`  A bet is placed when our probability exceeds the market's by the edge shown.`);
  console.log(`  Prices are SP with the overround removed.\n`);
  console.log(`  ${"edge".padEnd(8)}${"bets".padStart(8)}${"wins".padStart(7)}${"strike".padStart(9)}${"ROI".padStart(9)}${"P/L".padStart(10)}`);

  for (const edge of [0, 0.02, 0.05, 0.08, 0.12]) {
    let bets = 0, wins = 0, staked = 0, ret = 0;
    for (const r of test) {
      const p = predictRace(w, r.x);
      const mkt = marketProbabilities(r.spDecs);
      for (let i = 0; i < p.length; i++) {
        const m = mkt[i], sp = r.spDecs[i];
        if (m === null || sp === null || sp <= 1) continue;
        if (p[i] - m < edge) continue;
        bets++; staked++;
        if (i === r.winner) { wins++; ret += sp; }
      }
    }
    const roi = staked ? ((ret - staked) / staked) * 100 : 0;
    console.log(
      `  ${(edge === 0 ? "any" : `+${(edge * 100).toFixed(0)}pp`).padEnd(8)}${bets.toLocaleString().padStart(8)}` +
        `${wins.toLocaleString().padStart(7)}${(bets ? ((wins / bets) * 100).toFixed(1) + "%" : "-").padStart(9)}` +
        `${(roi.toFixed(1) + "%").padStart(9)}${((ret - staked >= 0 ? "+" : "") + (ret - staked).toFixed(0)).padStart(10)}` +
        `${roi > 0 ? "  <-- PROFIT" : ""}`
    );
  }

  /* ---------------------------------------------------------- persist --- */

  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync("./model", { recursive: true });
  writeFileSync(
    "./model/weights.json",
    JSON.stringify(
      {
        trainedAt: new Date().toISOString(),
        split: SPLIT,
        handicapsOnly: HANDICAPS_ONLY,
        minHistory: MIN_HISTORY,
        trainRaces: train.length,
        testRaces: test.length,
        testLogLoss: testLoss,
        naiveLogLoss: naive,
        features: FEATURE_NAMES,
        weights: w,
      },
      null,
      2
    )
  );
  console.log(`\n  weights written to model/weights.json`);

  console.log(`\n${"=".repeat(76)}\n`);
  await client.end();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
