/**
 * Feature extraction for the data-driven model.
 *
 * Every hand-built signal so far encoded a racing opinion and a weight I chose.
 * Twice that was measured and twice it lost: my weights returned -19.6% and
 * refitting them to measured lift returned -20.6%. So this file takes the other
 * road — describe each runner numerically, and let a fit decide what matters.
 *
 * THE PRICE IS NOT A FEATURE, deliberately.
 *
 * Given the odds the model would simply learn the market, score a beautiful log
 * loss, and be useless: it would agree with the price on everything and never
 * find a bet. It trains on form alone and its probability is then compared with
 * the market's. A bet exists only where the two disagree.
 *
 * NO LOOKAHEAD. Every feature is computed from runs strictly before the race
 * being described. That is enforced by the caller passing an already-truncated
 * history, and by nothing here ever touching today's result.
 */

import { readComment } from "./form-reading";
import { normaliseDiscipline, sameDiscipline, type PastRun } from "./selection";

/** One runner, as the model sees it. */
export interface FeatureRow {
  raceId: string;
  raceDate: string;
  horseId: string;
  horseName: string;
  won: boolean;
  /** Starting price. Used for evaluation only, never as an input. */
  spDec: number | null;
  x: number[];
}

/**
 * Feature names, in the order `extract()` returns them.
 *
 * Kept as a plain array so a fitted coefficient can always be printed next to
 * the thing it weights. An uninterpretable model would be a bad trade here:
 * the whole reason Royal Duke's false positive was catchable is that every
 * claim could be traced to its evidence.
 */
export const FEATURE_NAMES = [
  "or_norm",            // official rating, normalised within the race
  "or_rank",            // 1 = top rated, scaled 0..1
  "or_missing",
  "days_since_run",     // log1p, capped
  "quick_turnaround",   // ran within 5 days
  "long_layoff",        // 180+ days
  "age",
  "career_runs",        // log1p
  "career_win_rate",
  "wins_last_6",
  "won_last_time",
  "placed_last_time",
  "avg_pos_last_3",     // normalised by field size
  "avg_btn_last_3",     // beaten lengths per furlong
  "mark_vs_win_6mo",    // lb below a winning mark set inside 6 months
  "mark_vs_win_18mo",
  "mark_trend_3",       // lb change across the last 3 marks
  "proven_going",
  "proven_trip",
  "proven_course",
  "course_wins",
  "stayed_on_last",
  "travelled_well_last",
  "easy_ride_last",
  "failed_to_stay_last",
  "trouble_last",
  "fell_going_well_last",
  "trainer_14_pct",
  "trainer_14_runs",    // log1p
  "jockey_strike",
  "jockey_new",         // different rider from last time
  "jockey_won_on_it",
  "draw_iv",            // from the measured draw-bias table
  "pace_iv",            // measured bias for its habitual run style
  "field_size",         // log
  "headgear_first",
  "wind_surgery_first",
  "jockey_claim",
  "style_led",
  "style_prominent",
  "style_held_up",
] as const;

export const N_FEATURES = FEATURE_NAMES.length;

export interface ExtractContext {
  ofrsInRace: number[];
  fieldSize: number;
  raceDate: string;
  raceType: string | null;
  goingBand: string;
  distanceF: number | null;
  courseSlug: string;
  jockeyStrike: (id: string | null) => number | null;
  drawIv: number | null;
  paceIv: number | null;
}

export interface RunnerToday {
  horseId: string;
  horseName: string;
  ofr: number | null;
  age: number | null;
  draw: number | null;
  jockeyId: string | null;
  jockeyClaimLbs: number | null;
  headgearFirstTime: boolean;
  windSurgeryFirstTime: boolean;
  trainer14Pct: number | null;
  trainer14Runs: number | null;
}

const monthsBetween = (from: string, to: string) => {
  const a = new Date(from), b = new Date(to);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
};

const daysBetween = (from: string, to: string) =>
  Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000);

/** Best mark it won off in this code, inside `months`. */
function bestWinMark(now: RunnerToday, ctx: ExtractContext, hist: PastRun[], months: number): number | null {
  let best: number | null = null;
  for (const r of hist) {
    if (r.positionNum !== 1 || r.ofr === null) continue;
    if (!sameDiscipline(r.raceType, ctx.raceType)) continue;
    if (monthsBetween(r.raceDate, ctx.raceDate) > months) continue;
    if (best === null || r.ofr > best) best = r.ofr;
  }
  return best;
}

/**
 * Build the feature vector.
 *
 * Missing values become 0 with a companion flag where the distinction matters
 * (an absent official rating is not a rating of zero). Everything is roughly
 * centred and scaled so gradient descent behaves without a separate
 * standardisation pass.
 */
export function extract(now: RunnerToday, ctx: ExtractContext, hist: PastRun[]): number[] {
  const x: number[] = [];

  /* ---- rating, relative to the race rather than absolute ---- */
  const others = ctx.ofrsInRace.filter((o) => Number.isFinite(o));
  const mean = others.length ? others.reduce((a, b) => a + b, 0) / others.length : 0;
  const sd = others.length > 1
    ? Math.sqrt(others.reduce((a, b) => a + (b - mean) ** 2, 0) / others.length) || 1
    : 1;
  x.push(now.ofr !== null ? (now.ofr - mean) / sd : 0);
  x.push(
    now.ofr !== null && others.length
      ? others.filter((o) => o > (now.ofr as number)).length / others.length
      : 0.5
  );
  x.push(now.ofr === null ? 1 : 0);

  /* ---- freshness ---- */
  const last = hist[0];
  const days = last ? daysBetween(last.raceDate, ctx.raceDate) : null;
  x.push(days === null ? 0 : Math.log1p(Math.min(days, 720)) / 6.6);
  x.push(days !== null && days <= 5 ? 1 : 0);
  x.push(days !== null && days >= 180 ? 1 : 0);

  /* ---- age and experience ---- */
  x.push(now.age !== null ? (now.age - 5) / 4 : 0);
  x.push(Math.log1p(hist.length) / 4);
  const careerWins = hist.filter((r) => r.positionNum === 1).length;
  x.push(hist.length ? careerWins / hist.length : 0);
  x.push(hist.slice(0, 6).filter((r) => r.positionNum === 1).length / 6);
  x.push(last?.positionNum === 1 ? 1 : 0);
  x.push(last?.positionNum !== null && last?.positionNum !== undefined && last.positionNum <= 3 ? 1 : 0);

  /* ---- recent form shape ---- */
  const last3 = hist.slice(0, 3).filter((r) => r.positionNum !== null);
  x.push(
    last3.length
      ? last3.reduce((a, r) => a + (r.positionNum as number) / Math.max(2, r.fieldSize ?? 10), 0) / last3.length
      : 0.5
  );
  const btn3 = hist.slice(0, 3).filter((r) => r.ovrBtn !== null && r.distanceF);
  x.push(
    btn3.length
      ? Math.min(3, btn3.reduce((a, r) => a + (r.ovrBtn as number) / (r.distanceF as number), 0) / btn3.length)
      : 0.5
  );

  /* ---- the handicap mark ---- */
  const w6 = bestWinMark(now, ctx, hist, 6);
  const w18 = bestWinMark(now, ctx, hist, 18);
  x.push(w6 !== null && now.ofr !== null ? Math.max(-10, Math.min(20, w6 - now.ofr)) / 10 : 0);
  x.push(w18 !== null && now.ofr !== null ? Math.max(-10, Math.min(20, w18 - now.ofr)) / 10 : 0);
  const marks = hist.filter((r) => r.ofr !== null && sameDiscipline(r.raceType, ctx.raceType)).slice(0, 3);
  x.push(marks.length >= 2 ? Math.max(-15, Math.min(15, (marks[0].ofr as number) - (marks[marks.length - 1].ofr as number))) / 10 : 0);

  /* ---- proven conditions ---- */
  const wins = hist.filter((r) => r.positionNum === 1);
  x.push(wins.some((r) => r.goingBand === ctx.goingBand) ? 1 : 0);
  x.push(
    ctx.distanceF !== null &&
      wins.some((r) => r.distanceF !== null && Math.abs(r.distanceF - (ctx.distanceF as number)) <= 0.5)
      ? 1 : 0
  );
  const courseWins = wins.filter((r) => r.courseSlug === ctx.courseSlug).length;
  x.push(courseWins > 0 ? 1 : 0);
  x.push(Math.min(5, courseWins) / 5);

  /* ---- what the last comment said ---- */
  const c = last ? readComment(last.comment) : null;
  x.push(c?.stayedOn ? 1 : 0);
  x.push(c?.travelledWell ? 1 : 0);
  x.push(c?.easyRide ? 1 : 0);
  x.push(c?.failedToStay ? 1 : 0);
  x.push(c?.trouble ? 1 : 0);
  x.push(c?.fellGoingWell ? 1 : 0);

  /* ---- connections ---- */
  x.push(now.trainer14Pct !== null ? Math.min(40, now.trainer14Pct) / 20 - 1 : 0);
  x.push(Math.log1p(now.trainer14Runs ?? 0) / 4);
  const js = ctx.jockeyStrike(now.jockeyId);
  x.push(js !== null ? Math.min(30, js) / 15 - 1 : 0);
  x.push(last && last.jockeyId && now.jockeyId && last.jockeyId !== now.jockeyId ? 1 : 0);
  x.push(wins.some((r) => r.jockeyId === now.jockeyId) ? 1 : 0);

  /* ---- measured biases ---- */
  x.push(ctx.drawIv !== null ? ctx.drawIv - 1 : 0);
  x.push(ctx.paceIv !== null ? Math.min(3, ctx.paceIv) - 1 : 0);

  /* ---- race and runner shape ---- */
  x.push(Math.log(Math.max(2, ctx.fieldSize)) / 3 - 1);
  x.push(now.headgearFirstTime ? 1 : 0);
  x.push(now.windSurgeryFirstTime ? 1 : 0);
  x.push((now.jockeyClaimLbs ?? 0) / 7);

  /* ---- habitual run style ---- */
  const styles = hist.slice(0, 5).map((r) => readComment(r.comment).runStyle).filter(Boolean);
  const count = (s: string) => styles.filter((x) => x === s).length / Math.max(1, styles.length);
  x.push(count("led"));
  x.push(count("prominent"));
  x.push(count("held-up"));

  if (x.length !== N_FEATURES) {
    throw new Error(`extract() produced ${x.length} features, expected ${N_FEATURES}`);
  }
  return x;
}
