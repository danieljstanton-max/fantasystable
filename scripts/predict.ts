/**
 * Apply the trained model to an upcoming card.
 *
 *   npm run predict                 tomorrow
 *   npm run predict -- today
 *   npm run predict -- 2026-08-28
 *
 * Loads model/weights.json — written by `npm run train` — and scores every
 * runner in every qualifying race, then sets the model's probability against
 * the market's.
 *
 * TWO LISTS, because they are different things and conflating them is how you
 * lose money:
 *
 *   MOST LIKELY   the model's highest probabilities. Usually short prices,
 *                 because the market has found them too.
 *   BIGGEST EDGE  where the model most disagrees with the price. Out of
 *                 sample these returned -31%, so they are shown as what the
 *                 model thinks, not as a recommendation.
 */

import "dotenv/config";
import postgres from "postgres";
import { readFileSync, existsSync } from "node:fs";

import { extract, FEATURE_NAMES, type RunnerToday, type ExtractContext } from "../lib/features";
import { predictRace, marketProbabilities } from "../lib/model";
import { filterRace, type PastRun } from "../lib/selection";
import { readComment } from "../lib/form-reading";
import { formatPrice } from "../lib/tips";
import type { GoingBand } from "../lib/going";

const client = postgres(process.env.DATABASE_URL!, { max: 4, ssl: "require" });

function targetDate(): string {
  const a = process.argv[2];
  if (a && /^\d{4}-\d{2}-\d{2}$/.test(a)) return a;
  const d = new Date();
  if (a !== "today") d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

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
function drawBandOf(draw: number | null, field: number): string | null {
  if (draw === null || field < 6) return null;
  const p = (draw - 1) / (field - 1);
  return p <= 1 / 3 ? "low" : p >= 2 / 3 ? "high" : "mid";
}

async function main() {
  const date = targetDate();
  if (!existsSync("./model/weights.json")) {
    console.log(`\n  No trained model. Run: npm run train\n`);
    await client.end();
    return;
  }
  const model = JSON.parse(readFileSync("./model/weights.json", "utf-8"));
  const w: number[] = model.weights;

  console.log(`\nMODEL PREDICTIONS — ${date}\n${"=".repeat(76)}`);
  console.log(`  model trained ${String(model.trainedAt).slice(0, 16)} on ${model.trainRaces.toLocaleString()} races`);
  console.log(`  out-of-sample log loss ${Number(model.testLogLoss).toFixed(4)} against ${Number(model.naiveLogLoss).toFixed(4)} for no knowledge\n`);

  const upcoming: any[] = await client`
    select ra.id "raceId", ra.race_date::text "raceDate", ra.course_name "courseName",
           ra.course_slug "courseSlug", ra.off_time "offTime", ra.name "raceName",
           ra.age_band "ageBand", ra.race_class "raceClass", ra.distance_f "distanceF",
           ra.distance_round "distRound", ra.going, ra.going_band "goingBand",
           ra.race_type "raceType",
           r.horse_id "horseId", r.horse_name "horseName", r.age, r.draw,
           r.ofr, r.best_odds_dec "spDec", r.best_odds_frac "priceFrac",
           r.jockey_id "jockeyId", r.jockey_name "jockeyName",
           r.jockey_claim_lbs "jockeyClaimLbs", r.trainer_name "trainerName",
           r.trainer_14_percent "t14Pct", r.trainer_14_runs "t14Runs",
           coalesce(r.headgear_first_time,false) "headgearFirst",
           r.wind_surgery_run "windRun", r.is_non_runner "isNonRunner"
    from runners r join races ra on ra.id = r.race_id
    where ra.race_date = ${date}`;

  if (!upcoming.length) {
    console.log(`  nothing stored for ${date}. Run: npm run ingest:racecards -- ${date}\n`);
    await client.end();
    return;
  }

  // History for every horse involved.
  const ids = [...new Set(upcoming.map((r) => r.horseId))];
  const hist: any[] = await client`
    select r.horse_id "horseId", ra.race_date::text "raceDate", ra.course_slug "courseSlug",
           ra.distance_f "distanceF", ra.going_band "goingBand", ra.race_type "raceType",
           ra.field_size "fieldSize", r.position_num "positionNum", r.ofr,
           r.jockey_id "jockeyId", r.comment, r.ovr_btn "ovrBtn", r.age
    from runners r join races ra on ra.id = r.race_id
    where r.horse_id = any(${ids}) and ra.race_date < ${date} and r.position is not null
    order by ra.race_date desc`;
  const byHorse = new Map<string, PastRun[]>();
  for (const h of hist) {
    if (!byHorse.has(h.horseId)) byHorse.set(h.horseId, []);
    const list = byHorse.get(h.horseId)!;
    if (list.length < 30)
      list.push({
        raceDate: h.raceDate, courseSlug: h.courseSlug, distanceF: h.distanceF,
        goingBand: (h.goingBand ?? "unknown") as GoingBand, positionNum: h.positionNum,
        ofr: h.ofr, fieldSize: h.fieldSize, jockeyId: h.jockeyId, comment: h.comment,
        raceType: h.raceType, ovrBtn: h.ovrBtn, age: h.age, winMargin: null,
      });
  }

  const drawMap = new Map<string, number>();
  for (const d of (await client`select * from draw_bias`) as any)
    drawMap.set(`${d.course_slug}|${d.dist_band}|${d.going_band}|${d.draw_band}`, Number(d.impact_value));
  const paceMap = new Map<string, number>();
  for (const p of (await client`select * from pace_bias`) as any)
    paceMap.set(`${p.course_slug}|${p.dist_band}|${p.race_code}|${p.run_style}`, Number(p.impact_value));

  const jkRows: any[] = await client`
    select jockey_id "jockeyId", count(*)::int rides,
           count(*) filter (where position_num = 1)::int wins
    from runners where jockey_id is not null and position is not null
    group by 1 having count(*) >= 20`;
  const jkMap = new Map<string, number>();
  for (const j of jkRows) jkMap.set(j.jockeyId, (j.wins / j.rides) * 100);
  const jockeyStrike = (id: string | null) => (id ? jkMap.get(id) ?? null : null);

  /* ------------------------------------------------------------ score ---- */

  const byRace = new Map<string, any[]>();
  for (const r of upcoming) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId)!.push(r);
  }

  interface Pick {
    horse: string; course: string; off: string; race: string;
    p: number; mkt: number | null; edge: number | null;
    price: string | null; priceDec: number | null;
    trainer: string; jockey: string; claim: number | null;
    rank: number; field: number; runs: number;
  }
  const picks: Pick[] = [];
  let qualifying = 0;

  for (const [raceId, all] of byRace) {
    const live = all.filter((r) => !r.isNonRunner);
    if (live.length < 5) continue;
    const first = live[0];
    const v = filterRace(
      { raceName: first.raceName, ageBand: first.ageBand, raceClass: first.raceClass },
      live.map((r) => ({ age: r.age, isNonRunner: r.isNonRunner }))
    );
    if (!v.eligible) continue;
    qualifying++;

    const ofrs = live.map((r) => r.ofr).filter((o): o is number => o !== null);
    const dBand = drawDistBand(first.distanceF);
    const pBand = paceDistBand(first.distanceF);

    const xs: number[][] = [];
    for (const r of live) {
      const h = byHorse.get(r.horseId) ?? [];
      const band = drawBandOf(r.draw, live.length);
      const drawIv = band && dBand
        ? drawMap.get(`${first.courseSlug}|${dBand}|${first.goingBand ?? "unknown"}|${band}`) ?? null : null;

      const styles = h.slice(0, 5).map((x) => readComment(x.comment).runStyle).filter(Boolean) as string[];
      const counts = new Map<string, number>();
      for (const s of styles) counts.set(s, (counts.get(s) ?? 0) + 1);
      let habit: string | null = null, best = 0;
      for (const [k, n] of counts) if (n > best) { habit = k; best = n; }
      const paceIv = habit && best >= 3 && pBand && first.raceType
        ? paceMap.get(`${first.courseSlug}|${pBand}|${first.raceType}|${habit}`) ?? null : null;

      const ctx: ExtractContext = {
        ofrsInRace: ofrs, fieldSize: live.length, raceDate: date,
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
    }

    const probs = predictRace(w, xs);
    const mkt = marketProbabilities(live.map((r) => r.spDec));
    const order = probs.map((p, i) => ({ p, i })).sort((a, b) => b.p - a.p);

    order.forEach(({ p, i }, rank) => {
      const r = live[i];
      picks.push({
        horse: r.horseName, course: r.courseName, off: r.offTime, race: r.raceName,
        p, mkt: mkt[i], edge: mkt[i] !== null ? p - (mkt[i] as number) : null,
        price: r.priceFrac, priceDec: r.spDec,
        trainer: r.trainerName ?? "?", jockey: r.jockeyName ?? "?", claim: r.jockeyClaimLbs,
        rank: rank + 1, field: live.length, runs: (byHorse.get(r.horseId) ?? []).length,
      });
    });
  }

  console.log(`  ${byRace.size} races, ${qualifying} qualify, ${picks.length} runners scored\n`);

  const line = (s: Pick, i: number, showEdge: boolean) => {
    console.log(
      `  ${i + 1}. ${s.horse.toUpperCase().padEnd(21)} model ${(s.p * 100).toFixed(1).padStart(5)}%` +
        `   market ${(s.mkt !== null ? (s.mkt * 100).toFixed(1) + "%" : "-").padStart(6)}` +
        (showEdge ? `   edge ${((s.edge ?? 0) >= 0 ? "+" : "") + ((s.edge ?? 0) * 100).toFixed(1)}pp` : "") +
        `   ${s.price ?? "-"}`
    );
    console.log(`     ${s.off} ${s.course}  ${String(s.race).slice(0, 46)}`);
    console.log(`     ${s.trainer} / ${s.jockey}${s.claim ? `(${s.claim})` : ""}   ${s.runs} prior runs, ${s.field} runners`);
  };

  console.log(`${"-".repeat(76)}`);
  console.log(`MOST LIKELY WINNERS  (the model's highest probabilities)\n`);
  [...picks].sort((a, b) => b.p - a.p).slice(0, 5).forEach((s, i) => line(s, i, false));

  console.log(`\n${"-".repeat(76)}`);
  console.log(`BIGGEST DISAGREEMENT WITH THE MARKET\n`);
  console.log(`  Out of sample these returned -31%. Shown as what the model thinks,`);
  console.log(`  not as a recommendation.\n`);
  [...picks]
    .filter((s) => s.edge !== null && s.priceDec !== null && s.priceDec >= 2)
    .sort((a, b) => (b.edge as number) - (a.edge as number))
    .slice(0, 5)
    .forEach((s, i) => line(s, i, true));

  console.log(`\n${"=".repeat(76)}\n`);
  await client.end();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
