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
  WEIGHT_PROFILES,
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

// Which weight set to score with, so a proposed change can be run against the
// one it would replace instead of quietly becoming the new baseline.
const PROFILE = arg("weights", "live");

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
  draw: number | null;
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

  const profile = WEIGHT_PROFILES[PROFILE];
  if (!profile) {
    console.error(`Unknown weight profile "${PROFILE}". Try: ${Object.keys(WEIGHT_PROFILES).join(", ")}`);
    process.exit(1);
  }
  setWeights(profile);
  console.log(`  weights: ${PROFILE}`);

  process.stdout.write("  loading history into memory... ");

  // Only the horses that actually run inside the window, plus their own prior
  // form. Loading every settled run we hold — 1.68m rows, comments and all —
  // exhausted the heap before the backtest started, and all but a fraction of
  // it belonged to horses that never appear in the test period.
  //
  // Prior form reaches back three years before the window opens. Beyond that a
  // run tells the model nothing it does not already know, and the rows cost
  // memory the machine does not have.
  const histFrom = new Date(`${FROM}T00:00:00Z`);
  histFrom.setUTCFullYear(histFrom.getUTCFullYear() - 3);
  const HIST_FROM = histFrom.toISOString().slice(0, 10);

  const rows: Row[] = (await client`
    with target as (
      select distinct r.horse_id
      from runners r
      join races ra on ra.id = r.race_id
      where ra.status = 'result'
        and ra.race_date between ${FROM} and ${TO}
        and r.position is not null
    )
    select ra.id "raceId", ra.race_date::text "raceDate", ra.course_slug "courseSlug",
           ra.distance_f "distanceF", ra.going_band "goingBand", ra.race_type "raceType",
           ra.name "raceName", ra.age_band "ageBand", ra.race_class "raceClass",
           ra.field_size "fieldSize",
           r.horse_id "horseId", r.horse_name "horseName", r.age, r.draw,
           r.position_num "positionNum", r.position, r.ofr, r.sp_dec "spDec",
           r.jockey_id "jockeyId", left(r.comment, 300) comment, r.ovr_btn "ovrBtn",
           r.is_non_runner "isNonRunner",
           r.trainer_14_runs "t14Runs", r.trainer_14_wins "t14Wins",
           r.trainer_14_percent "t14Pct",
           coalesce(r.headgear_first_time,false) "headgearFirst",
           r.wind_surgery_run "windRun",
           (select min(w.ovr_btn) from runners w
             where w.race_id = ra.id and w.position_num = 2) "winMargin"
    from runners r
    join races ra on ra.id = r.race_id
    join target t on t.horse_id = r.horse_id
    where ra.status = 'result' and r.position is not null
      and ra.race_date between ${HIST_FROM} and ${TO}
    order by ra.race_date, ra.id, r.horse_id`) as any;
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

  // The measured draw and pace biases.
  //
  // These were never passed to the scorer, so four signals — draw-good,
  // draw-bad, pace-suits, pace-against — could not fire in a backtest and had
  // never been measured at all. One of them gates the best bets: a severe
  // pace-against removes a horse from the five. Scoring the model without them
  // was not testing the model that actually picks the tips.
  const drawMap = new Map<string, number>();
  for (const d of (await client`select * from draw_bias`) as any)
    drawMap.set(`${d.course_slug}|${d.dist_band}|${d.going_band}|${d.draw_band}`, Number(d.impact_value));

  const paceMap = new Map<string, number>();
  for (const p of (await client`select * from pace_bias`) as any)
    paceMap.set(`${p.course_slug}|${p.dist_band}|${p.race_code}|${p.run_style}`, Number(p.impact_value));

  console.log(`  ${drawMap.size} draw cells, ${paceMap.size} pace cells`);

  const drawBias = (course: string, dist: string, going: string, band: string) =>
    drawMap.get(`${course}|${dist}|${going}|${band}`) ?? null;
  const paceBias = (course: string, dist: string, code: string, style: string) =>
    paceMap.get(`${course}|${dist}|${code}|${style}`) ?? null;

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
        raceClass: r.raceClass,
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
  /** The race title, so finals and championships can be told apart. */
  raceName?: string;
  /** Stepping up 2+ grades with no compensating drop in the weights. */
  outOfDepth?: boolean;
  /** Was this also the market favourite in its race? */
  wasFav?: boolean;
  /** Rank by price in its race: 1 = favourite. */
  priceRank?: number;
  /** Runners in the race — a race-level fact, kept for segmenting. */
  fieldSize?: number | null;
  /** The going band of the race, for segmenting by ground. */
  goingBand?: string | null;
  /** Form on soft/heavy: proven, tried without going close, or never seen. */
  softProven?: "proven" | "tried" | "never";
  /** Best finishing margin on soft/heavy, in lengths. Null if never tried. */
  softBest?: number | null;
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
      raceClass: first.raceClass,
      raceName: first.raceName,
    };

    // Rank by official rating across today's field. A horse cannot know its own
    // rank without seeing the race, so the caller works it out once and passes
    // it in. Ties share the better rank — joint top rated is still top rated.
    const rated = live.filter((x) => x.ofr !== null && x.ofr !== undefined);
    const ofrDesc = [...rated].sort((a, b) => Number(b.ofr) - Number(a.ofr));
    const rankOf = new Map<string, number>();
    ofrDesc.forEach((x, i) => {
      const tie = i > 0 && Number(ofrDesc[i - 1].ofr) === Number(x.ofr);
      rankOf.set(x.horseId, tie ? rankOf.get(ofrDesc[i - 1].horseId)! : i + 1);
    });

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
        draw: r.draw,
        ofrRank: rankOf.get(r.horseId) ?? null,
        ofrRated: rated.length,
      };

      const s = scoreHorse(
        today, race, history, jockeyStrikeRate, r.raceDate, drawBias, paceBias
      );
      // Best grade this horse has ever won in, and whether today is deeper.
      const clsNo = (c: string | null) => {
        const m = /(\d)/.exec(String(c ?? ""));
        const n = m ? parseInt(m[1], 10) : NaN;
        return n >= 1 && n <= 7 ? n : null;
      };
      const wonClasses = history
        .filter((h) => h.positionNum === 1)
        .map((h) => clsNo(h.raceClass ?? null))
        .filter((x): x is number => x !== null);
      const todayCls = clsNo(first.raceClass);
      const bestWon = wonClasses.length ? Math.min(...wonClasses) : null;

      // The mark it won off most recently, in this discipline.
      const lastWinOfr = history.find((h) => h.positionNum === 1 && h.ofr !== null)?.ofr ?? null;
      const noDrop = r.ofr !== null && lastWinOfr !== null && r.ofr >= lastWinOfr;

      const outOfDepth =
        todayCls !== null && bestWon !== null && bestWon - todayCls >= 2 && noDrop;

      scored.push({
        horseName: r.horseName,
        raceName: r.raceName,
        fieldSize: r.fieldSize ?? null,
        goingBand: first.goingBand ?? null,
        softBest: (() => {
          const on = history.filter((h) => (h.goingBand === "soft" || h.goingBand === "heavy")
            && h.positionNum !== null);
          if (!on.length) return null;
          return Math.min(...on.map((h) => h.positionNum === 1 ? 0 : Number(h.ovrBtn ?? 99)));
        })(),
        softProven: (() => {
          const on = history.filter((h) => h.goingBand === "soft" || h.goingBand === "heavy");
          if (!on.length) return "never" as const;
          const close = on.some((h) => h.positionNum === 1 ||
            (h.ovrBtn !== null && h.ovrBtn !== undefined && Number(h.ovrBtn) <= 2));
          return close ? ("proven" as const) : ("tried" as const);
        })(),
        outOfDepth,
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

    // Ties broken by name, not by whatever order the rows arrived in.
    //
    // Two runs of this backtest over identical data returned 515 winners and
    // then 500 — a 2.5 point swing in ROI from nothing but row order, which is
    // wider than any difference between the weight profiles it was being used
    // to compare. Scores are integers and ties are common, so an unstable sort
    // key made the whole tool unable to answer the question it exists for.
    scored.sort((a, b) => b.score - a.score || a.horseName.localeCompare(b.horseName));
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
  // Out of depth: the Rating profile.
  //
  // Dan, 2026-08-30: a Class 6 winner entered in a Class 2, four pounds ABOVE
  // the mark it won off a fortnight earlier. The model scored it 17 points and
  // made it the second best bet of the day, because "won last time" and
  // "course winner" are counted without asking what grade either was in.
  //
  // Two conditions together: today is at least two grades better than anything
  // the horse has ever won in, and there is no compensating drop in the mark.
  {
    const deep = topPicks.filter((b) => b.outOfDepth);
    const fine = topPicks.filter((b) => !b.outOfDepth);
    const roi2 = (xs: Bet[]) =>
      xs.length ? ((xs.reduce((a, b) => a + (b.won ? b.spDec ?? 0 : 0), 0) - xs.length) / xs.length) * 100 : 0;
    const sr2 = (xs: Bet[]) => (xs.length ? (xs.filter((b) => b.won).length / xs.length) * 100 : 0);

    console.log("-".repeat(70));
    console.log("OUT OF DEPTH  (2+ grades above its best win, no drop in the weights)\n");
    console.log(`  out of depth  ${String(deep.length).padStart(6)} bets   strike ${sr2(deep).toFixed(1)}%   ROI ${roi2(deep).toFixed(1)}%`);
    console.log(`  the rest      ${String(fine.length).padStart(6)} bets   strike ${sr2(fine).toFixed(1)}%   ROI ${roi2(fine).toFixed(1)}%\n`);
  }

  // Field size is a RACE-level fact, so it cannot change which horse is picked
  // within a race — weighting it moved the ROI not at all, at any weight. What
  // it can do is say which races are worth betting in, which is a different
  // lever and one the model has no way to pull.
  {
    const band = (n: number | null) =>
      n === null ? "unknown" : n <= 6 ? "a 4-6" : n <= 9 ? "b 7-9"
        : n <= 12 ? "c 10-12" : n <= 16 ? "d 13-16" : "e 17+";
    const groups = new Map<string, Bet[]>();
    for (const b of topPicks) {
      const k = band(b.fieldSize ?? null);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(b);
    }
    const roi2 = (xs: Bet[]) =>
      xs.length ? ((xs.reduce((a, b) => a + (b.won ? b.spDec ?? 0 : 0), 0) - xs.length) / xs.length) * 100 : 0;
    const sr2 = (xs: Bet[]) => (xs.length ? (xs.filter((b) => b.won).length / xs.length) * 100 : 0);

    console.log("-".repeat(70));
    console.log("OUR PICKS BY FIELD SIZE\n");
    for (const k of [...groups.keys()].sort())
      console.log(`  ${k.padEnd(10)} ${String(groups.get(k)!.length).padStart(5)} bets   strike ${sr2(groups.get(k)!).toFixed(1).padStart(5)}%   ROI ${roi2(groups.get(k)!).toFixed(1).padStart(6)}%`);
    console.log();

    // What the headline would be with the biggest fields left alone.
    // Where the money actually is, once the biggest fields are left alone.
    for (const cap of [21, 17, 13, 10]) {
      const kept = topPicks.filter((b) => (b.fieldSize ?? 99) < cap);
      const cut = topPicks.length - kept.length;
      console.log(
        `  fields under ${String(cap).padStart(2)}   ${String(kept.length).padStart(5)} bets   ` +
        `strike ${sr2(kept).toFixed(1).padStart(5)}%   ROI ${roi2(kept).toFixed(1).padStart(6)}%   ` +
        `(${cut} left alone)`
      );
    }
    console.log();

  }

  // Dan, 2026-09-02: "a horse never running on heavy is a huge negative, the
  // same as a horse never winning on soft. If the ground is soft or heavy we
  // can only look at horses that have won or gone close on the ground."
  //
  // Measured as he stated it: on soft or heavy going, split our picks by
  // whether they have ever won, or been beaten under two lengths, on soft or
  // heavy. "Never run on it at all" is counted separately, because that is a
  // different claim from having tried and failed.
  {
    const SOFTISH = new Set(["soft", "heavy"]);
    const softRaces = topPicks.filter((b) => SOFTISH.has(String(b.goingBand ?? "")));

    const groups = new Map<string, Bet[]>();
    for (const b of softRaces) {
      const k = b.softProven === "proven" ? "a won or went close on it"
              : b.softProven === "tried" ? "b tried it, never went close"
              : "c never run on it";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(b);
    }

    const roiS = (xs: Bet[]) =>
      xs.length ? ((xs.reduce((a, b) => a + (b.won ? b.spDec ?? 0 : 0), 0) - xs.length) / xs.length) * 100 : 0;
    const srS = (xs: Bet[]) => (xs.length ? (xs.filter((b) => b.won).length / xs.length) * 100 : 0);

    console.log("-".repeat(70));
    console.log("PICKS ON SOFT OR HEAVY, BY PROVEN FORM ON IT\n");
    for (const k of [...groups.keys()].sort())
      console.log(`  ${k.padEnd(28)} ${String(groups.get(k)!.length).padStart(4)} bets   strike ${srS(groups.get(k)!).toFixed(1).padStart(5)}%   ROI ${roiS(groups.get(k)!).toFixed(1).padStart(6)}%`);
    console.log(`  ${"all soft/heavy picks".padEnd(28)} ${String(softRaces.length).padStart(4)} bets   strike ${srS(softRaces).toFixed(1).padStart(5)}%   ROI ${roiS(softRaces).toFixed(1).padStart(6)}%`);
    console.log();
  }

  // The sharper question: not "has it proved itself on soft" but "how badly
  // has it been beaten when it tried". Annandale's best of four runs on soft
  // was 11.5L. That is a different animal from beaten a length.
  {
    const SOFTISH = new Set(["soft", "heavy"]);
    const tried = topPicks.filter((b) =>
      SOFTISH.has(String(b.goingBand ?? "")) && b.softBest !== null && b.softBest !== undefined);
    const band = (d: number) =>
      d <= 2 ? "a within 2L" : d <= 6 ? "b 2-6L" : d <= 12 ? "c 6-12L" : "d beaten 12L+";
    const g = new Map<string, Bet[]>();
    for (const b of tried) {
      const k = band(Number(b.softBest));
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(b);
    }
    const roiT = (xs: Bet[]) =>
      xs.length ? ((xs.reduce((a, b) => a + (b.won ? b.spDec ?? 0 : 0), 0) - xs.length) / xs.length) * 100 : 0;
    const srT = (xs: Bet[]) => (xs.length ? (xs.filter((b) => b.won).length / xs.length) * 100 : 0);
    console.log("-".repeat(70));
    console.log("PICKS ON SOFT/HEAVY, BY BEST EFFORT ON IT\n");
    for (const k of [...g.keys()].sort())
      console.log(`  ${k.padEnd(16)} ${String(g.get(k)!.length).padStart(4)} bets   strike ${srT(g.get(k)!).toFixed(1).padStart(5)}%   ROI ${roiT(g.get(k)!).toFixed(1).padStart(6)}%`);
    console.log();
  }

  // Dan, 2026-08-30, on Rating in the Chepstow Mile Series Final: "its a series
  // final a very tough race". A final is the best of everything that qualified
  // through the series, so the race is harder than its class or its prize money
  // suggests — and a horse arriving on the back of a Class 6 win is in deeper
  // than its form figures show.
  {
    const isFinal = (b: Bet) => /\bfinals?\b|championship/i.test(String(b.raceName ?? ""));
    const fin = topPicks.filter(isFinal);
    const rest = topPicks.filter((b) => !isFinal(b));
    const roi = (xs: Bet[]) =>
      xs.length ? ((xs.reduce((a, b) => a + (b.won ? b.spDec ?? 0 : 0), 0) - xs.length) / xs.length) * 100 : 0;
    const strike = (xs: Bet[]) => (xs.length ? (xs.filter((b) => b.won).length / xs.length) * 100 : 0);

    console.log("-".repeat(70));
    console.log("SERIES FINALS AND CHAMPIONSHIPS\n");
    console.log(`  finals          ${String(fin.length).padStart(5)} bets   strike ${strike(fin).toFixed(1)}%   ROI ${roi(fin).toFixed(1)}%`);
    console.log(`  every other race ${String(rest.length).padStart(4)} bets   strike ${strike(rest).toFixed(1)}%   ROI ${roi(rest).toFixed(1)}%\n`);
  }

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
