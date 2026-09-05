/**
 * Do the two systems together beat either alone?
 *
 *   npm run combine
 *   npm run combine -- --split=2026-04-01
 *
 * We have two independent readings of every runner:
 *
 *   THE MODEL   a calibrated probability from a conditional logit over 40
 *               features. Honest about its own numbers, cannot beat the price.
 *   THE RULES   Dan's method as signals with weights. Interpretable, explains
 *               itself, also cannot beat the price.
 *
 * Neither wins on its own. The open question is whether AGREEMENT between them
 * — plus a price that pays — finds something either misses. That is a real
 * hypothesis rather than a hope: they read partly different things, so where
 * both point the same way the evidence is genuinely doubled.
 *
 * Everything below is measured out of sample, and the strategies are declared
 * up front rather than discovered by rummaging. Testing twenty combinations
 * and reporting the best is how the "-0.9% third favourite" mirage happened.
 */

import "dotenv/config";
import postgres from "postgres";

import { extract, type RunnerToday, type ExtractContext } from "../lib/features";
import { fit, predictRace, marketProbabilities, type Race } from "../lib/model";
import { filterRace, scoreHorse, starsFromScore, type PastRun, type HorseToday, type RaceToday } from "../lib/selection";
import { readComment } from "../lib/form-reading";
import type { GoingBand } from "../lib/going";

const client = postgres(process.env.DATABASE_URL!, { max: 4, ssl: "require" });
const args = process.argv.slice(2);
const arg = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const SPLIT = arg("split", "2026-04-01");

function drawDistBand(f: number | null): string | null {
  if (f === null) return null;
  if (f <= 5.5) return "5f"; if (f <= 6.5) return "6f"; if (f <= 7.5) return "7f";
  if (f <= 8.5) return "1m"; if (f <= 10.5) return "1m1f-1m2f";
  if (f <= 12.5) return "1m3f-1m4f"; return "beyond 1m4f";
}
function paceDistBand(f: number | null): string | null {
  if (f === null) return null;
  if (f <= 6.5) return "sprint"; if (f <= 8.5) return "7f-1m";
  if (f <= 12.5) return "1m1f-1m4f"; if (f <= 17) return "1m5f-2m";
  if (f <= 22) return "2m1f-2m6f"; return "beyond 2m6f";
}
function drawBandOf(d: number | null, field: number): string | null {
  if (d === null || field < 6) return null;
  const p = (d - 1) / (field - 1);
  return p <= 1 / 3 ? "low" : p >= 2 / 3 ? "high" : "mid";
}

/** One runner with both readings and the outcome. */
interface Scored {
  raceId: string; raceDate: string; horse: string;
  won: boolean; sp: number | null;
  modelP: number; marketP: number | null; rulePts: number; stars: number;
  modelRank: number; ruleRank: number; marketRank: number; field: number;
}

async function main() {
  console.log(`\nCOMBINING THE TWO SYSTEMS\n${"=".repeat(78)}`);
  process.stdout.write("  loading... ");

  const rows: any[] = await client`
    select ra.id "raceId", ra.race_date::text "raceDate", ra.course_slug "courseSlug",
           ra.distance_f "distanceF", ra.going_band "goingBand", ra.race_type "raceType",
           ra.name "raceName", ra.age_band "ageBand", ra.race_class "raceClass",
           ra.field_size "fieldSize",
           r.horse_id "horseId", r.horse_name "horseName", r.age, r.draw,
           r.position_num "positionNum", r.ofr, r.sp_dec "spDec",
           r.jockey_id "jockeyId", r.jockey_claim_lbs "jockeyClaimLbs",
           r.comment, r.ovr_btn "ovrBtn", r.is_non_runner "isNonRunner",
           r.trainer_14_percent "t14Pct", r.trainer_14_runs "t14Runs",
           r.trainer_14_wins "t14Wins",
           coalesce(r.headgear_first_time,false) "headgearFirst",
           r.wind_surgery_run "windRun"
    from runners r join races ra on ra.id = r.race_id
    where ra.status = 'result' and r.position is not null
    order by ra.race_date`;
  console.log(`${rows.length.toLocaleString()} runs`);

  const byHorse = new Map<string, any[]>();
  for (const r of rows) {
    if (!byHorse.has(r.horseId)) byHorse.set(r.horseId, []);
    byHorse.get(r.horseId)!.push(r);
  }
  const byRace = new Map<string, any[]>();
  for (const r of rows) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId)!.push(r);
  }

  const drawMap = new Map<string, number>();
  for (const d of (await client`select * from draw_bias`) as any)
    drawMap.set(`${d.course_slug}|${d.dist_band}|${d.going_band}|${d.draw_band}`, Number(d.impact_value));
  const paceMap = new Map<string, number>();
  for (const p of (await client`select * from pace_bias`) as any)
    paceMap.set(`${p.course_slug}|${p.dist_band}|${p.race_code}|${p.run_style}`, Number(p.impact_value));

  const jk = new Map<string, { rides: number; wins: number }>();
  for (const r of rows) {
    if (!r.jockeyId) continue;
    if (!jk.has(r.jockeyId)) jk.set(r.jockeyId, { rides: 0, wins: 0 });
    const t = jk.get(r.jockeyId)!; t.rides++; if (r.positionNum === 1) t.wins++;
  }
  const jockeyStrike = (id: string | null) => {
    if (!id) return null;
    const t = jk.get(id);
    return t && t.rides >= 20 ? (t.wins / t.rides) * 100 : null;
  };

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

  /* ---------------------------------------------- build every race ------- */

  process.stdout.write("  scoring both systems... ");
  /**
   * Deliberately narrow. An earlier version retained the full history and the
   * whole database row for every runner and exhausted the heap: 30 past runs
   * times ~10 runners times ~50,000 races is millions of objects kept alive
   * long after they were needed.
   */
  interface Slim { horseName: string; spDec: number | null; }
  interface Built { raceId: string; raceDate: string; x: number[][]; winner: number; runners: Slim[]; rulePts: number[]; }
  const built: Built[] = [];

  for (const [raceId, all] of byRace) {
    const live = all.filter((r) => !r.isNonRunner);
    if (live.length < 5) continue;
    const first = live[0];
    const v = filterRace(
      { raceName: first.raceName, ageBand: first.ageBand, raceClass: first.raceClass },
      live.map((r) => ({ age: r.age, isNonRunner: r.isNonRunner }))
    );
    if (!v.eligible) continue;
    const winner = live.findIndex((r) => r.positionNum === 1);
    if (winner < 0) continue;

    const ofrs = live.map((r) => r.ofr).filter((o): o is number => o !== null);
    const dBand = drawDistBand(first.distanceF);
    const pBand = paceDistBand(first.distanceF);

    const xs: number[][] = [], rulePts: number[] = [];
    let ok = true;

    for (const r of live) {
      const h = history(r.horseId, r.raceDate);
      if (h.length < 3) { ok = false; break; }

      const band = drawBandOf(r.draw, live.length);
      const drawIv = band && dBand
        ? drawMap.get(`${first.courseSlug}|${dBand}|${first.goingBand ?? "unknown"}|${band}`) ?? null : null;
      const styles = h.slice(0, 5).map((x) => readComment(x.comment).runStyle).filter(Boolean) as string[];
      const counts = new Map<string, number>();
      for (const s of styles) counts.set(s, (counts.get(s) ?? 0) + 1);
      let habit: string | null = null, bn = 0;
      for (const [k, n] of counts) if (n > bn) { habit = k; bn = n; }
      const paceIv = habit && bn >= 3 && pBand && first.raceType
        ? paceMap.get(`${first.courseSlug}|${pBand}|${first.raceType}|${habit}`) ?? null : null;

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
      xs.push(extract(today, ctx, h));

      // The rule system, on the same runner.
      const raceToday: RaceToday = {
        courseSlug: first.courseSlug, distanceF: first.distanceF,
        goingBand: (first.goingBand ?? "unknown") as GoingBand,
        raceType: first.raceType, fieldSize: live.length,
      };
      const horseToday: HorseToday = {
        horseId: r.horseId, horseName: r.horseName, ofr: r.ofr, age: r.age, draw: r.draw,
        jockeyId: r.jockeyId, bestOddsDec: r.spDec,
        headgearFirstTime: r.headgearFirst, windSurgeryFirstTime: r.windRun === "1",
        daysSinceRun: h[0] ? Math.round((new Date(r.raceDate).getTime() - new Date(h[0].raceDate).getTime()) / 86400000) : null,
        trainer14Runs: r.t14Runs, trainer14Wins: r.t14Wins, trainer14Percent: r.t14Pct,
      };
      const s = scoreHorse(horseToday, raceToday, h, jockeyStrike, r.raceDate,
        () => drawIv, () => paceIv);
      rulePts.push(s.score);
    }
    if (!ok) continue;
    built.push({
      raceId, raceDate: first.raceDate, x: xs, winner, rulePts,
      runners: live.map((r) => ({ horseName: r.horseName, spDec: r.spDec })),
    });
  }
  console.log(`${built.length.toLocaleString()} races`);
  // The raw rows are no longer needed and are the largest thing in memory.
  byRace.clear();
  byHorse.clear();
  rows.length = 0;

  const train = built.filter((b) => b.raceDate < SPLIT);
  const test = built.filter((b) => b.raceDate >= SPLIT);
  console.log(`  train ${train.length.toLocaleString()}  test ${test.length.toLocaleString()}\n`);

  console.log(`  fitting the model on the train period only...`);
  const { w } = fit(train.map((b) => ({ x: b.x, winner: b.winner })), { epochs: 350, l2: 0.02 });

  /* ------------------------------------------------ score the test set --- */

  const scored: Scored[] = [];
  for (const b of test) {
    const p = predictRace(w, b.x);
    const mkt = marketProbabilities(b.runners.map((r) => r.spDec));
    const modelOrder = p.map((v, i) => i).sort((a, c) => p[c] - p[a]);
    const ruleOrder = b.rulePts.map((v, i) => i).sort((a, c) => b.rulePts[c] - b.rulePts[a]);
    const priced = b.runners.map((r, i) => ({ i, sp: r.spDec }))
      .filter((r) => r.sp !== null).sort((a, c) => (a.sp as number) - (c.sp as number));

    b.runners.forEach((r, i) => {
      scored.push({
        raceId: b.raceId, raceDate: b.raceDate, horse: r.horseName,
        won: i === b.winner, sp: r.spDec,
        modelP: p[i], marketP: mkt[i], rulePts: b.rulePts[i], stars: starsFromScore(b.rulePts[i]),
        modelRank: modelOrder.indexOf(i) + 1,
        ruleRank: ruleOrder.indexOf(i) + 1,
        marketRank: priced.findIndex((x) => x.i === i) + 1,
        field: b.runners.length,
      });
    });
  }

  const roi = (bets: Scored[]) => {
    const w2 = bets.filter((b) => b.sp !== null && (b.sp as number) > 1);
    if (!w2.length) return { n: 0, wins: 0, sr: "-", roi: "-", pl: 0 };
    const ret = w2.reduce((a, b) => a + (b.won ? (b.sp as number) : 0), 0);
    const wins = w2.filter((b) => b.won).length;
    return {
      n: w2.length, wins,
      sr: `${((wins / w2.length) * 100).toFixed(1)}%`,
      roi: `${(((ret - w2.length) / w2.length) * 100).toFixed(1)}%`,
      pl: Math.round(ret - w2.length),
    };
  };

  const report = (name: string, bets: Scored[]) => {
    const r = roi(bets);
    console.log(
      `  ${name.padEnd(44)}${r.n.toLocaleString().padStart(7)}${String(r.wins).padStart(7)}` +
        `${r.sr.padStart(9)}${r.roi.padStart(9)}${String(r.pl).padStart(8)}` +
        `${parseFloat(r.roi) > 0 ? "  <-- PROFIT" : ""}`
    );
  };

  console.log(`\n${"-".repeat(78)}`);
  console.log(`OUT OF SAMPLE — ${test.length.toLocaleString()} races\n`);
  console.log(`  ${"strategy".padEnd(44)}${"bets".padStart(7)}${"wins".padStart(7)}${"strike".padStart(9)}${"ROI".padStart(9)}${"P/L".padStart(8)}`);

  console.log(`  --- each system alone ---`);
  report("model's top pick", scored.filter((s) => s.modelRank === 1));
  report("rules' top pick", scored.filter((s) => s.ruleRank === 1));
  report("market favourite", scored.filter((s) => s.marketRank === 1));

  console.log(`  --- where they agree ---`);
  const agree = scored.filter((s) => s.modelRank === 1 && s.ruleRank === 1);
  report("both systems' top pick", agree);
  report("both top 2", scored.filter((s) => s.modelRank <= 2 && s.ruleRank <= 2));

  console.log(`  --- agreement AND a price worth taking ---`);
  const edge = (s: Scored) => (s.marketP !== null ? s.modelP - s.marketP : -1);
  report("both agree, model over market", agree.filter((s) => edge(s) > 0));
  report("both agree, edge +3pp", agree.filter((s) => edge(s) >= 0.03));
  report("both agree, not the favourite", agree.filter((s) => s.marketRank > 1));
  report("both agree, price 4/1 or bigger", agree.filter((s) => (s.sp ?? 0) >= 5));
  report("both agree, 4/1+, model over market", agree.filter((s) => (s.sp ?? 0) >= 5 && edge(s) > 0));

  console.log(`  --- for contrast: agreement at short prices ---`);
  report("both agree, odds-on to 3/1", agree.filter((s) => (s.sp ?? 99) < 4));

  console.log(`\n${"-".repeat(78)}`);
  console.log(`HOW OFTEN DO THEY AGREE?\n`);
  const races = new Set(scored.map((s) => s.raceId)).size;
  console.log(`  races                       ${races.toLocaleString()}`);
  console.log(`  both picked the same horse  ${agree.length.toLocaleString()}  (${((agree.length / races) * 100).toFixed(0)}%)`);
  const modelTop = scored.filter((s) => s.modelRank === 1);
  console.log(`  model top pick was fav      ${modelTop.filter((s) => s.marketRank === 1).length.toLocaleString()}  (${((modelTop.filter((s) => s.marketRank === 1).length / races) * 100).toFixed(0)}%)`);
  console.log(`  agreed pick was NOT fav     ${agree.filter((s) => s.marketRank > 1).length.toLocaleString()}`);

  console.log(`\n${"=".repeat(78)}\n`);
  await client.end();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
