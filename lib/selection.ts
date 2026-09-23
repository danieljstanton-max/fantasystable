/**
 * Race eligibility and horse scoring.
 *
 * Dan's stated method, 2026-08-26. The race filters are absolute — a race that
 * fails any of them is never considered, regardless of how good a horse looks
 * in it. The horse signals are additive and produce the star rating.
 *
 * See docs/tipping-method.md for the reasoning behind each rule.
 */

import type { GoingBand } from "./going";
import { GOING_ORDER } from "./going";
import { readComment } from "./form-reading";

/* ========================================================================== */
/* Race filtering                                                             */
/* ========================================================================== */

export interface FilterableRace {
  raceName: string;
  ageBand: string | null; // "2yo" | "3yo" | "3yo+" | "4yo+"
  raceClass: string | null;
}

export interface FilterableRunner {
  age: number | null;
  isNonRunner: boolean;
}

export type RejectReason =
  | "not-a-handicap"
  | "arab-race"
  | "two-year-old-nursery"
  | "three-year-old-only"
  | "small-field"
  | "too-many-three-year-olds";

export interface RaceVerdict {
  eligible: boolean;
  reason: RejectReason | null;
  runnerCount: number;
  threeYearOlds: number;
}

/** Minimum declared runners. Below this, each-way terms shrink and value goes. */
export const MIN_RUNNERS = 7;

/** Above this many 3yos in an all-aged handicap, the form lines stop comparing. */
export const MAX_THREE_YEAR_OLDS = 4;

/**
 * A handicap is named as one. Nurseries are 2yo handicaps and are named
 * "Nursery", sometimes without the word "Handicap" at all, so both are checked.
 */
export function isHandicap(raceName: string): boolean {
  const n = raceName.toLowerCase();
  return n.includes("handicap") || n.includes("nursery");
}

/**
 * Arabian racing. Excluded 2026-08-27.
 *
 * A separate breed with its own form book, its own ratings and almost no
 * overlap with Thoroughbred racing. On today's card the Wolverhampton 17:10
 * Arab handicap passed every filter and then scored every runner zero — no
 * history exists for any of them — so the model would have tipped one at
 * random.
 *
 * Word boundaries matter here. A bare `includes("arab")` also matches the
 * "Melissa, ARABella And Oriana Hawthorne Handicap" at Musselburgh, which is
 * an ordinary handicap named after somebody. \barab\b matches "Arab" but not
 * "Arabella", because the following "e" is a word character.
 */
export function isArabRace(raceName: string): boolean {
  return /\barabs?\b|\barabians?\b|\banglo[- ]arab/i.test(raceName);
}

export function isNursery(race: FilterableRace): boolean {
  return (
    race.raceName.toLowerCase().includes("nursery") ||
    (isHandicap(race.raceName) && race.ageBand === "2yo")
  );
}

/** "3yo+" and "4yo+" are all-aged. "3yo" alone is a restricted age race. */
export function isAllAged(ageBand: string | null): boolean {
  return ageBand !== null && ageBand.includes("+");
}

/**
 * Apply the four race filters, in Dan's stated order.
 *
 * Runner counts use ACTUAL runners, with non-runners removed. Each-way terms
 * are what the rule is protecting, and bookmakers cut places when horses come
 * out — a 7-runner race that loses one is a 6-runner race for value purposes.
 */
export function filterRace(race: FilterableRace, runners: FilterableRunner[]): RaceVerdict {
  const live = runners.filter((r) => !r.isNonRunner);
  const runnerCount = live.length;
  const threeYearOlds = live.filter((r) => r.age === 3).length;

  const base = { runnerCount, threeYearOlds };

  // 1. Handicaps only.
  if (!isHandicap(race.raceName)) {
    return { eligible: false, reason: "not-a-handicap", ...base };
  }

  // 2. Thoroughbreds only.
  if (isArabRace(race.raceName)) {
    return { eligible: false, reason: "arab-race", ...base };
  }

  // 3. No 2yo nurseries, no 3yo-only handicaps.
  if (isNursery(race)) {
    return { eligible: false, reason: "two-year-old-nursery", ...base };
  }
  if (race.ageBand === "3yo") {
    return { eligible: false, reason: "three-year-old-only", ...base };
  }

  // 4. Field size.
  if (runnerCount < MIN_RUNNERS) {
    return { eligible: false, reason: "small-field", ...base };
  }

  // 5. All-aged handicaps carrying too many 3yos.
  if (isAllAged(race.ageBand) && threeYearOlds > MAX_THREE_YEAR_OLDS) {
    return { eligible: false, reason: "too-many-three-year-olds", ...base };
  }

  return { eligible: true, reason: null, ...base };
}

export const REJECT_LABELS: Record<RejectReason, string> = {
  "not-a-handicap": "Not a handicap",
  "arab-race": "Arabian racing",
  "two-year-old-nursery": "2yo nursery",
  "three-year-old-only": "3yo-only handicap",
  "small-field": `Fewer than ${MIN_RUNNERS} runners`,
  "too-many-three-year-olds": `More than ${MAX_THREE_YEAR_OLDS} three-year-olds`,
};

/* ========================================================================== */
/* Horse scoring                                                              */
/* ========================================================================== */

/**
 * One past run, as the model needs it.
 *
 * Populated from the results backfill. Everything here except `comment` comes
 * straight from /v1/results; `comment` is the narrative read by
 * lib/form-reading.ts.
 */
export interface PastRun {
  raceDate: string;
  courseSlug: string;
  distanceF: number | null;
  goingBand: GoingBand;
  positionNum: number | null;
  /** Official rating the horse ran off that day, IN THAT DISCIPLINE. */
  ofr: number | null;
  fieldSize: number | null;
  jockeyId: string | null;
  comment: string | null;
  /** "Flat" | "Hurdle" | "Chase" | "NH Flat" */
  raceType: string | null;
  /** "Class 4". British racing only — Irish cards carry no class. */
  raceClass?: string | null;
  /** Cumulative lengths behind the winner. 0 for the winner. */
  ovrBtn: number | null;
  age: number | null;
  /** When this horse WON, how far it won by (the runner-up's lengths). */
  winMargin?: number | null;
}

/**
 * Lengths to pounds.
 *
 * Dan, 2026-08-27: "when we look at horses that won recently we need to look at
 * how easily they won and by how far taking into account lentghs by weight."
 *
 * A length is worth far more over five furlongs than over three miles, so a
 * winning distance only means something once converted. The conventional scale,
 * in pounds per length:
 *
 *   FLAT   5f 3.0 | 6f 2.5 | 7f 2.0 | 1m 1.75 | 9-10f 1.5 | 11-12f 1.25
 *          13-16f 1.0 | 17f+ 0.75
 *   JUMPS  2m 1.0 | 2m4f 0.75 | 3m 0.6 | beyond 0.5
 *
 * This is an approximation of the published scale, not the scale itself — the
 * real thing varies by going and code. Good enough to tell a three-length
 * sprint win from a three-length staying win, which is the point.
 */
export function lbPerLength(distanceF: number | null, raceType: string | null): number {
  const jumps = ["hurdle", "chase"].includes(normaliseDiscipline(raceType));
  const f = distanceF ?? (jumps ? 20 : 8);

  if (jumps) {
    if (f <= 16) return 1.0;
    if (f <= 20) return 0.75;
    if (f <= 24) return 0.6;
    return 0.5;
  }

  if (f <= 5) return 3.0;
  if (f <= 6) return 2.5;
  if (f <= 7) return 2.0;
  if (f <= 8) return 1.75;
  if (f <= 10) return 1.5;
  if (f <= 12) return 1.25;
  if (f <= 16) return 1.0;
  return 0.75;
}

/** A winning distance expressed in pounds of superiority. */
export function marginInPounds(
  lengths: number | null,
  distanceF: number | null,
  raceType: string | null
): number | null {
  if (lengths === null || lengths === undefined) return null;
  return Math.round(lengths * lbPerLength(distanceF, raceType) * 10) / 10;
}

/**
 * Handicap marks are per discipline and are NOT comparable across them.
 *
 * A jumps horse carries a separate rating over hurdles and over fences, set by
 * different assessments, and its Flat mark is on a different scale again.
 * Final Orders on 2026-08-26:
 *
 *   Chase   26 runs, marks 120-150, 5 wins
 *   Hurdle  16 runs, marks  93-122, 2 wins
 *   Flat     8 runs, marks  56- 68, 1 win
 *
 * It ran in a HURDLE off 122 — the top of its hurdle range. The model compared
 * that against a chase win off 147 at Cheltenham, announced "25lb below its
 * winning mark", and made it the strongest selection on the card. The horse was
 * not well treated at all.
 *
 * So the mark comparison is strictly same-discipline. Going, course and run
 * style still transfer across codes — a horse that acts on soft acts on soft
 * whatever it is jumping — but a rating never does.
 */
export function sameDiscipline(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return normaliseDiscipline(a) === normaliseDiscipline(b);
}

export function normaliseDiscipline(t: string | null): string {
  const s = (t ?? "").toLowerCase();
  if (s.includes("chase")) return "chase";
  if (s.includes("hurdle")) return "hurdle";
  if (s.includes("nh flat") || s.includes("bumper")) return "nh-flat";
  if (s.includes("flat")) return "flat";
  return "unknown";
}

export interface HorseToday {
  horseId: string;
  horseName: string;
  ofr: number | null;
  age?: number | null;
  /** Stall number. Flat and all-weather only; jumps races have none. */
  draw?: number | null;
  /** Trainer's last 14 days, as supplied per runner by the API. */
  trainer14Runs?: number | null;
  trainer14Wins?: number | null;
  trainer14Percent?: number | null;
  jockeyId: string | null;
  bestOddsDec: number | null;
  headgearFirstTime: boolean;
  windSurgeryFirstTime: boolean;
  /** Days since the previous run. From `last_run` on the racecard. */
  daysSinceRun?: number | null;
  /**
   * Rank by official rating within today's field: 1 = top rated, ties share
   * the better rank. Supplied by the caller, because a horse cannot know its
   * own rank without seeing the rest of the race.
   */
  ofrRank?: number | null;
  /** How many runners carry a rating, so a rank of 1 from 2 can be discounted. */
  ofrRated?: number | null;
}

export interface RaceToday {
  courseSlug: string;
  /** The race title. Needed to tell a handicap from a maiden. */
  raceName?: string | null;
  distanceF: number | null;
  goingBand: GoingBand;
  /** Today's discipline. Marks only compare within it. */
  raceType: string | null;
  /** Runners actually declared, for normalising the draw. */
  fieldSize?: number | null;
  /** "Class 4". British racing only — Irish cards carry no class. */
  raceClass?: string | null;
}

/* -------------------------------------------------------------------------- */
/* Draw bias                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Distance buckets for draw purposes. Draw matters most at sprint trips.
 * Must match scripts/draw-bias.ts, which builds the table.
 */
export function drawDistBand(f: number | null): string | null {
  if (f === null) return null;
  if (f <= 5.5) return "5f";
  if (f <= 6.5) return "6f";
  if (f <= 7.5) return "7f";
  if (f <= 8.5) return "1m";
  if (f <= 10.5) return "1m1f-1m2f";
  if (f <= 12.5) return "1m3f-1m4f";
  return "beyond 1m4f";
}

export type DrawBand = "low" | "mid" | "high";

/**
 * Where a stall sits ACROSS THE FIELD, not its raw number.
 *
 * Stall 8 of 9 is a wide draw; stall 8 of 20 is not. Fields under six runners
 * are not split at all — the thirds stop meaning anything.
 */
export function drawBandOf(draw: number | null, fieldSize: number | null): DrawBand | null {
  if (draw === null || fieldSize === null || fieldSize < 6) return null;
  const p = (draw - 1) / (fieldSize - 1);
  if (p <= 1 / 3) return "low";
  if (p >= 2 / 3) return "high";
  return "mid";
}

/** Looks up a stored impact value; null when we have no reliable sample. */
export type DrawBiasLookup = (
  courseSlug: string,
  distBand: string,
  goingBand: string,
  drawBand: DrawBand
) => number | null;

/* -------------------------------------------------------------------------- */
/* Pace bias                                                                   */
/* -------------------------------------------------------------------------- */

/** Distance buckets for pace. Must match scripts/pace-bias.ts. */
export function paceDistBand(f: number | null): string | null {
  if (f === null) return null;
  if (f <= 6.5) return "sprint";
  if (f <= 8.5) return "7f-1m";
  if (f <= 12.5) return "1m1f-1m4f";
  if (f <= 17) return "1m5f-2m";
  if (f <= 22) return "2m1f-2m6f";
  return "beyond 2m6f";
}

export type PaceBiasLookup = (
  courseSlug: string,
  distBand: string,
  code: string,
  style: string
) => number | null;

/**
 * The run style a horse habitually adopts, from its recent comments.
 *
 * This is the PREDICTIVE half of the pace question, and the distinction
 * matters. The pace_bias table measures how horses that led on the day fared,
 * which is not information you have before the off — you cannot back "the
 * horse that will lead". What you CAN know is that this horse has led in four
 * of its last five, and that this track rewards it.
 *
 * Needs a clear habit: at least three of the last five runs in one style.
 */
export function habitualStyle(history: PastRun[]): { style: string | null; of: number; from: number } {
  const recent = history.slice(0, 5);
  const counts = new Map<string, number>();
  let read = 0;
  for (const r of recent) {
    const s = readComment(r.comment).runStyle;
    if (!s) continue;
    read++;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return n >= 3 ? { style: best, of: n, from: read } : { style: null, of: n, from: read };
}

export interface Signal {
  key: string;
  label: string;
  weight: number;
  detail: string;
}

/**
 * Signal weights.
 *
 * These began as my judgement and are being replaced by measured lift. Any
 * refit MUST be validated out of sample — fitting weights on a period and then
 * reporting performance on that same period measures memorisation, not skill.
 * `npm run backtest -- --split=DATE` does the honest version.
 */
export type Weights = Partial<Record<string, number>>;

/**
 * Measured weights, set 2026-08-27.
 *
 * Replaces the numbers I invented with what the evidence showed. Each is
 * justified by the audit (lift on the horse's NEXT run, 250,000 comments) or
 * by the fitted conditional logit over 40 features.
 *
 *   quick-turnaround  +7.8pp measured, and was scoring ZERO
 *   easyRide          +8.3pp, the strongest comment signal
 *   travelledWell     +6.4pp
 *   jockey            the single largest coefficient in the fit (0.705)
 *   draw              third largest (0.318)
 *   trouble           -0.6pp, wrong direction, so it scores nothing
 *   fell-going-well   +0.2pp, was weighted 3
 *
 * The mark and the plot are NOT reduced to nothing despite measuring near
 * zero. They no longer carry the score, but they are the gate: a horse only
 * reaches the list by being well handicapped, and these rank what qualifies.
 */
const MEASURED_WEIGHTS: Weights = {
  "quick-turnaround": 3,
  "last-run-easy": 3,
  jockey: 3,
  "trainer-hot": 2,
  "trainer-cold": -2,
  "draw-good": 2,
  "draw-bad": -2,
  "last-run-positive": 2,
  "last-run-won": 2,
  going: 2,
  "fails-on-ground": -2,
  trip: 2,
  course: 2,
  mark: 2,
  plot: 2,
  "went-close": 2,
  "won-easily": 2,
  "pace-suits": 1,
  "pace-against": -1,
  headgear: 1,
  wind: 1,
  "fell-going-well": 1,
  "last-run-trouble": 0,
  layoff: -3,
  drought: -2,
  "drought-excused": 0,
  "never-won": -2,
  "last-run-negative": -2,
};

/**
 * HYBRID, set 2026-08-29.
 *
 * Built to Dan's brief — a good handicap mark, trainer form and the jockey
 * booking carrying the score — but with "well handicapped" expressed the way
 * the evidence supports rather than the way the phrase is usually meant.
 *
 * The backtest over 2,299 races is blunt about the mark itself. `mark` (lbs
 * below a winning mark) fires 3,361 times for -0.8pp on strike and -28.1% ROI;
 * `plot` (the handicapper dropping a horse) fires 2,465 times for -0.2pp and
 * -26.4%. Both are inferences from the handicapper's number, and the market
 * reads that number too — earlier, and with the same conclusion.
 *
 * What does hold up is a horse that has SHOWN it is ahead of its mark:
 *
 *   won-easily   +2.3pp,  -12.3% ROI   the best of any positive signal
 *   went-close   +1.7pp,  -20.8% ROI
 *
 * So the mark still gates who qualifies, and demonstrated superiority to it
 * ranks them. That is the same idea, sourced from the racecourse rather than
 * from the ratings.
 *
 * Trainer form and the jockey booking are promoted as asked. The booking is
 * measured (+2.3pp, -18.1%) and was the largest coefficient in the fitted
 * logit. Trainer form is NOT measured: `trainer_14_percent` exists on 2,005
 * runners out of 1.68m, because it arrives on racecards and we only began
 * capturing those this month. It is in here on Dan's judgement and on the
 * fit — not on evidence — and that is the honest status of it until the
 * live record can say otherwise.
 *
 * `fails-on-ground` is weighted harder than its positive twin. At -11.4% it
 * has the best ROI in the whole set: knowing which horses cannot act on the
 * ground is worth more than knowing which can, because the market discounts
 * the negative less.
 */
const HYBRID_WEIGHTS: Weights = {
  // Shown to be ahead of the mark — the core of the hybrid.
  "won-easily": 4,
  "went-close": 3,

  // The people. Promoted per the brief.
  jockey: 4,
  "trainer-hot": 3,
  "trainer-cold": -3,

  // The mark itself: still the gate, no longer the score.
  mark: 2,
  plot: 1,

  // Conditions. The negative is trusted more than the positive.
  "fails-on-ground": -3,
  going: 2,
  trip: 2,
  course: 2,

  // Last time out.
  "last-run-easy": 3,
  "last-run-won": 2,
  "last-run-positive": 2,
  "last-run-negative": -2,
  "last-run-trouble": 0,
  "fell-going-well": 1,

  // Fitness and timing.
  "quick-turnaround": 3,
  layoff: -3,

  // Track shape. Unvalidated — the backtest has never passed the bias tables
  // into the scorer — so these are held at the weights they already had
  // rather than promoted on a hunch.
  "draw-good": 2,
  "draw-bad": -2,
  "pace-suits": 1,
  "pace-against": -1,

  // Kit.
  headgear: 1,
  wind: 1,

  // Hard negatives.
  "never-won": -2,
  drought: -2,
  "drought-excused": 0,
};

/**
 * The hybrid, taken apart.
 *
 * It bundles three separate claims — promote the people, promote demonstrated
 * superiority to the mark, demote the mark itself — and run together they
 * scored worse than what they replaced. Testing them one at a time is the only
 * way to find out which part carries the loss and which, if any, is worth
 * keeping.
 */
const PEOPLE_WEIGHTS: Weights = {
  ...MEASURED_WEIGHTS,
  jockey: 4,
  "trainer-hot": 3,
  "trainer-cold": -3,
};

const SHOWN_WEIGHTS: Weights = {
  ...MEASURED_WEIGHTS,
  "won-easily": 4,
  "went-close": 3,
};

const NO_MARK_WEIGHTS: Weights = {
  ...MEASURED_WEIGHTS,
  mark: 2,
  plot: 1,
};

/**
 * Two changes that each help on their own can hurt together: every one of them
 * adds points to a positive, and it is the TOTAL that ranks the field, so
 * inflating several at once shifts which horse tops the race rather than
 * sharpening the case for the one that already did. These isolate that.
 */
const PEOPLE_SHOWN_WEIGHTS: Weights = {
  ...MEASURED_WEIGHTS,
  jockey: 4,
  "trainer-hot": 3,
  "trainer-cold": -3,
  "won-easily": 4,
  "went-close": 3,
};

/**
 * LIVE, set 2026-08-30. The weights the tips are produced with.
 *
 * Four changes to MEASURED_WEIGHTS above, and the only set tried that improved
 * on it in two disjoint test periods rather than one:
 *
 *                        Mar-Jun 2026      Sep 2025-Feb 2026
 *   MEASURED_WEIGHTS        -3.4%               -4.3%
 *   these                   -2.6%               -4.1%
 *
 * across roughly 5,500 bets. A small edge, and worth having only because it is
 * consistent — nine other profiles were tried and every one of them won a
 * window and lost the other.
 *
 * Two honest limits on it. `trainer_14_percent` exists on 2,005 runner rows out
 * of 1.68m, because it arrives on racecards and we only began storing those
 * this month, so the trainer half of this can barely have fired in either test:
 * what is really measured here is the jockey booking and the ground negative.
 * And a 0.8 point gain sits inside a model whose ROI swings twelve points
 * between periods, so this is a direction, not a proof.
 *
 * Deliberately NOT included: everything the handicap study of 48,764 runs
 * suggested. Reversing the mark signal, weighting field size and paying for a
 * recent win produced 27 and 44 more winners per window and lost two to three
 * times as much money (STUDY_WEIGHTS, kept below so the result can be
 * reproduced). Those findings describe who wins races, which is the one thing
 * the market already prices correctly. They belong in the write-ups, where
 * "racing off the mark it won from" is true and persuasive, not in the score.
 */
const LIVE_WEIGHTS: Weights = {
  ...MEASURED_WEIGHTS,

  // The largest coefficient in the fitted logit, +2.3pp measured on strike,
  // and the half of Dan's hybrid that survived testing.
  jockey: 4,

  // Untested — see above. In on judgement, out the moment the data says so.
  "trainer-hot": 3,
  "trainer-cold": -3,

  // -11.4% ROI, the best of any signal in the set. Knowing which horses cannot
  // act on the ground is worth more than knowing which can, because the market
  // discounts the negative less than it discounts the positive.
  "fails-on-ground": -3,

  // Dropping a grade after running well in better company.
  //
  // Dan spotted the gap on Yes I'm Mali — beaten 0.2L in a 19-runner Class 3,
  // dropping to a Class 4 a pound lower, and the model had no term for it at
  // all. Tested at 2, 3 and 4 across both windows; only 2 improved in both:
  //
  //   weight 2   Mar-Jun -3.4% -> -2.7%    Sep-Feb -4.7% -> -4.6%
  //   weight 3                  -> -2.9%                 -> -6.2%
  //   weight 4                  -> -2.8%                 -> -5.5%
  //
  // The second window's gain is inside the noise, so this is shipped as a
  // small edge rather than a discovery. It is the only change tried in a long
  // sequence of them that did not lose money on one side or the other.
  "class-drop": 2,
};

/** The previous default, kept so any change can be run against it. */
const PEOPLE_GROUND_WEIGHTS: Weights = LIVE_WEIGHTS;

const GROUND_WEIGHTS: Weights = { ...MEASURED_WEIGHTS, "fails-on-ground": -3 };

const PEOPLE_GROUND_SHOWN_WEIGHTS: Weights = {
  ...PEOPLE_GROUND_WEIGHTS,
  "won-easily": 4,
  "went-close": 3,
};

/**
 * STUDY, set 2026-08-30.
 *
 * Everything the 48,764-run handicap study said, and nothing it did not.
 *
 * Three changes, each measured rather than reasoned:
 *
 *   the mark      "well handicapped" is turned round. A horse racing off the
 *                 mark it won from is the best bucket in the study (IV 1.35);
 *                 a horse a long way below it is one the assessor has been
 *                 dropping (IV 0.84). The old signal, which paid MORE the
 *                 further below the mark a horse was, is switched off.
 *
 *   field size    seven or fewer returns -6.6% and supplies a third of all
 *                 winners; sixteen and over returns -26.2%. There was no
 *                 field-size term at all.
 *
 *   recent wins   winning inside a month is IV 1.75. The model punished a
 *                 drought and paid nothing for the opposite.
 *
 * Held at their existing values: everything else. The last round of weight
 * tuning showed differences of one to three points are smaller than the swing
 * between test periods, so nothing here is a tweak — each is a signal that was
 * missing, or pointing the wrong way.
 */
const STUDY_WEIGHTS: Weights = {
  ...MEASURED_WEIGHTS,

  // The old, inverted mark signal stands down.
  mark: 0,

  "mark-on-winning": 3,
  "mark-above": 1,
  "mark-below": -1,
  "mark-well-below": -1,

  "field-small": 2,
  "field-big": -2,

  "recent-winner": 3,
  "recent-winner-3m": 1,
};

/**
 * VALUE, set 2026-08-30.
 *
 * The study measured two different things and they do not agree.
 *
 *   IV   who wins. The market reads this too, and prices it.
 *   ROI  what backing them returned. This is the only column that pays.
 *
 * STUDY_WEIGHTS above follows the IV column. This one follows the ROI column,
 * and the two disagree sharply:
 *
 *   61-180 days off   IV 0.81  but ROI -9.9%, second best in the study
 *   15-30 days off    IV 1.03  but ROI -19.9%
 *   8lb+ below mark   IV 0.84  but ROI -12.4%
 *   1-3lb below mark  IV 0.83  and ROI -23.3%
 *
 * So the layoff penalty is aimed at the group with the second-best returns in
 * the whole study, and the model is paying for freshness the market charges
 * more for than it is worth. Field size is the one factor where IV and ROI
 * point the same way, so it is the one thing carried over from STUDY.
 */
const VALUE_WEIGHTS: Weights = {
  ...MEASURED_WEIGHTS,
  "field-small": 2,
  "field-big": -2,
  layoff: -1,
};

/**
 * CLASS, set 2026-08-30. Dan's handicap-class hypothesis, scored.
 *
 * The negative is weighted harder than the positive, for the same reason
 * fails-on-ground is: a horse that has never won at today's level returns
 * -24.4%, and dropped into a grade it has never won at, -32.8% — the worst
 * bucket measured. Being proven at the grade returns -13.4%. The gap on the
 * downside is bigger than the gap on the upside, and the market prices a
 * negative less thoroughly than a positive.
 *
 * The class DROP is deliberately unscored. It adds winners and costs money.
 */
const CLASS_WEIGHTS: Weights = {
  ...LIVE_WEIGHTS,
  "class-proven": 2,
  "class-unproven": -3,
};

/** The same idea, weighted gently, to tell a wrong signal from too strong a one. */
const CLASS_LITE_WEIGHTS: Weights = {
  ...LIVE_WEIGHTS,
  "class-proven": 1,
  "class-unproven": -1,
};

/** Dan's "standout" — the ground coming right off a falling mark. */
const GROUND_RIGHT_WEIGHTS: Weights = {
  ...LIVE_WEIGHTS,
  "ground-comes-right": 3,
};

/**
 * The same, with the unconditional version stood down.
 *
 * `plot` fires 2,465 times for -26.4%; the same idea with "and today's ground
 * is ground it has won on" attached fires 841 times for -15.0%. If the
 * conditional one is the real signal, paying for the other 1,624 as well is
 * paying for the cases where the excuse has NOT been removed.
 */
const GROUND_SWAP_WEIGHTS: Weights = {
  ...LIVE_WEIGHTS,
  "ground-comes-right": 3,
  plot: 0,
};

/** Named weight sets, so a change can be measured against what it replaces. */
/**
 * MARKS, set 2026-08-30.
 *
 * Dan: "we're making mistakes on not checking the actual previous runs
 * comments — I think we should ignore previous runs comments and focus
 * heavily on handicap marks, course form and ground conditions."
 *
 * Every read taken from a running comment is switched off. That is seven
 * signals: the four last-run reads, the fell-going-well rescue, and the two
 * shown-more reads. "last-run-won" stays, because a winning position is a
 * result in the form book, not a sentence somebody wrote about it.
 *
 * What is left carries the weight instead: the mark (with the study's
 * reversal, so racing off a winning mark pays and being dropped does not),
 * course form, and the ground — including ground-comes-right, which has been
 * sitting at zero in the live set despite being the signal Dan describes as
 * the standout.
 */
const MARKS_WEIGHTS: Weights = {
  ...LIVE_WEIGHTS,
  ...STUDY_WEIGHTS,

  // read from a comment — off
  "last-run-positive": 0,
  "last-run-negative": 0,
  "last-run-trouble": 0,
  "last-run-easy": 0,
  "fell-going-well": 0,
  "won-easily": 0,
  "went-close": 0,

  // the three Dan wants doing the work
  "mark-on-winning": 5,
  course: 4,
  going: 3,
  "ground-comes-right": 4,
  "fails-on-ground": -4,
};

/**
 * The same, with the pace read off too.
 *
 * Run style is derived from comments as well — a horse is "a confirmed
 * front-runner" because sentences say it led. It is a positional fact rather
 * than a judgement, so it is worth testing separately instead of assuming
 * either way.
 */
const MARKS_NO_PACE_WEIGHTS: Weights = {
  ...MARKS_WEIGHTS,
  "pace-suits": 0,
  "pace-against": 0,
};

/** LIVE with only the comment-derived reads switched off. Isolates half of MARKS. */
const NO_COMMENTS_WEIGHTS: Weights = {
  ...LIVE_WEIGHTS,
  "last-run-positive": 0,
  "last-run-negative": 0,
  "last-run-trouble": 0,
  "last-run-easy": 0,
  "fell-going-well": 0,
  "won-easily": 0,
  "went-close": 0,
};

/** LIVE with only the mark/course/ground boost. Isolates the other half. */
const MARK_BOOST_WEIGHTS: Weights = {
  ...LIVE_WEIGHTS,
  ...STUDY_WEIGHTS,
  "mark-on-winning": 5,
  course: 4,
  going: 3,
  "ground-comes-right": 4,
  "fails-on-ground": -4,
};

/**
 * LIVE plus the one signal Dan calls the standout, and nothing else.
 *
 * "when looking for horses that are well handicapped, have been running on
 * ground they don't like (need soft, been running on good/firm) then this for
 * me is a key signal they are nearly ready to win a race."
 *
 * ground-comes-right has been sitting at weight 0 in the live set the whole
 * time, so it has never actually been tried.
 */
const GROUND_RIGHT_ONLY_WEIGHTS: Weights = {
  ...LIVE_WEIGHTS,
  "ground-comes-right": 4,
};

/**
 * LIVE with the study's mark terms and nothing else.
 *
 * Dan, 2026-09-01, on Yes I'm Mali at Ripon: beaten 0.2L into second in a
 * 19-runner Class 3 four days ago, dropping to Class 4 and a pound lower, and
 * the model did not flag it. It could not: the horse runs off exactly the mark
 * it last won from, so "pounds below a winning mark" is zero and the handicap
 * gate rejects it.
 *
 * The 48,764-run study says that is the wrong way round — off a winning mark
 * is the best bucket at IV 1.35, and a long way below is IV 0.84, an assessor
 * who has been dropping a horse that keeps failing.
 *
 * The earlier mark-boost test bundled this with four other changes and lost
 * 13pp; this isolates the mark terms so the question can actually be answered.
 */
const MARK_STUDY_WEIGHTS: Weights = {
  ...LIVE_WEIGHTS,
  mark: 0,
  "mark-on-winning": 3,
  "mark-above": 1,
  "mark-below": -1,
  "mark-well-below": -1,
};

/** LIVE plus the class-drop signal, at three candidate weights. */
const CLASS_DROP_2: Weights = { ...LIVE_WEIGHTS, "class-drop": 2 };
const CLASS_DROP_3: Weights = { ...LIVE_WEIGHTS, "class-drop": 3 };
const CLASS_DROP_4: Weights = { ...LIVE_WEIGHTS, "class-drop": 4 };

/** LIVE plus the course-specialist signal, at three candidate weights. */
const SPECIALIST_2: Weights = { ...LIVE_WEIGHTS, "course-specialist": 2 };
const SPECIALIST_3: Weights = { ...LIVE_WEIGHTS, "course-specialist": 3 };
const SPECIALIST_4: Weights = { ...LIVE_WEIGHTS, "course-specialist": 4 };

/** LIVE plus the study's field-size terms, which have never been switched on. */
const FIELD_2: Weights = { ...LIVE_WEIGHTS, "field-small": 2, "field-big": -2 };
const FIELD_1: Weights = { ...LIVE_WEIGHTS, "field-small": 1, "field-big": -1 };
const FIELD_3: Weights = { ...LIVE_WEIGHTS, "field-small": 3, "field-big": -3 };

/** LIVE plus "top rated in the race", at four candidate weights. */
const TOPRATED_1: Weights = { ...LIVE_WEIGHTS, "top-rated": 1 };
const TOPRATED_2: Weights = { ...LIVE_WEIGHTS, "top-rated": 2 };
const TOPRATED_3: Weights = { ...LIVE_WEIGHTS, "top-rated": 3 };
const TOPRATED_4: Weights = { ...LIVE_WEIGHTS, "top-rated": 4 };

/** Top rated, but only outside handicaps — where the raw data was strongest. */
const TOPRATED_MAIDEN_2: Weights = { ...LIVE_WEIGHTS, "top-rated-maiden": 2 };
const TOPRATED_MAIDEN_3: Weights = { ...LIVE_WEIGHTS, "top-rated-maiden": 3 };

/** LIVE plus the read-across version of the ground negative. */
const FAILS_NEAR_2: Weights = { ...LIVE_WEIGHTS, "fails-near-ground": -2 };
const FAILS_NEAR_3: Weights = { ...LIVE_WEIGHTS, "fails-near-ground": -3 };
const FAILS_NEAR_4: Weights = { ...LIVE_WEIGHTS, "fails-near-ground": -4 };

/**
 * LIVE with the last-time-out winner bonus removed.
 *
 * Dan, 2026-09-08: "why are we picking so many horses that won last time
 * anyway?"
 *
 * Because we pay for it. Over Sep-Feb `last-run-won` fired on 3,439 runners —
 * the fifth most-fired signal in the set — and lifted strike by 6.6pp, the
 * second-biggest lift there is. It also returned -17.9%. Winning last time is
 * the single most legible fact in a form book, so it is the one the market
 * prices hardest, and we are buying it at full retail.
 */
const NO_LAST_WIN_WEIGHTS: Weights = {
  ...LIVE_WEIGHTS,
  "last-run-won": 0,
};

/** LIVE with the last-time-out bonus halved rather than removed. */
const HALF_LAST_WIN_WEIGHTS: Weights = {
  ...LIVE_WEIGHTS,
  "last-run-won": 1,
};

export const WEIGHT_PROFILES: Record<string, Weights> = {
  "no-last-win": NO_LAST_WIN_WEIGHTS,
  "half-last-win": HALF_LAST_WIN_WEIGHTS,
  live: LIVE_WEIGHTS,
  class: CLASS_WEIGHTS,
  "ground-right": GROUND_RIGHT_WEIGHTS,
  "ground-swap": GROUND_SWAP_WEIGHTS,
  "class-lite": CLASS_LITE_WEIGHTS,
  measured: MEASURED_WEIGHTS,
  hybrid: HYBRID_WEIGHTS,
  people: PEOPLE_WEIGHTS,
  shown: SHOWN_WEIGHTS,
  "no-mark": NO_MARK_WEIGHTS,
  "people-shown": PEOPLE_SHOWN_WEIGHTS,
  "people-ground": PEOPLE_GROUND_WEIGHTS,
  ground: GROUND_WEIGHTS,
  "people-ground-shown": PEOPLE_GROUND_SHOWN_WEIGHTS,
  study: STUDY_WEIGHTS,
  value: VALUE_WEIGHTS,
  marks: MARKS_WEIGHTS,
  "marks-no-pace": MARKS_NO_PACE_WEIGHTS,
  "no-comments": NO_COMMENTS_WEIGHTS,
  "mark-boost": MARK_BOOST_WEIGHTS,
  "ground-right-only": GROUND_RIGHT_ONLY_WEIGHTS,
  "mark-study": MARK_STUDY_WEIGHTS,
  "class-drop-2": CLASS_DROP_2,
  "class-drop-3": CLASS_DROP_3,
  "class-drop-4": CLASS_DROP_4,
  "specialist-2": SPECIALIST_2,
  "specialist-3": SPECIALIST_3,
  "specialist-4": SPECIALIST_4,
  "field-1": FIELD_1,
  "field-2": FIELD_2,
  "field-3": FIELD_3,
  "top-1": TOPRATED_1,
  "top-2": TOPRATED_2,
  "top-3": TOPRATED_3,
  "top-4": TOPRATED_4,
  "topm-2": TOPRATED_MAIDEN_2,
  "topm-3": TOPRATED_MAIDEN_3,
  "near-2": FAILS_NEAR_2,
  "near-3": FAILS_NEAR_3,
  "near-4": FAILS_NEAR_4,
};

let ACTIVE_WEIGHTS: Weights = LIVE_WEIGHTS;

/** Override the default weights, e.g. from a fitted set. Returns the previous. */
export function setWeights(w: Weights): Weights {
  const prev = ACTIVE_WEIGHTS;
  ACTIVE_WEIGHTS = w;
  return prev;
}

/**
 * Add a signal only if it is carrying weight.
 *
 * A signal weighted zero contributes nothing to the score, and printing it in
 * a write-up tells a reader it was a reason when it was not. Used for the
 * signals added after the handicap study so that a profile which does not want
 * them gets neither the points nor the prose.
 */
function push(signals: Signal[], s: Signal) {
  if (s.weight !== 0) signals.push(s);
}

function weightFor(key: string, fallback: number): number {
  const w = ACTIVE_WEIGHTS[key];
  return w === undefined ? fallback : w;
}

export interface HorseScore {
  horseId: string;
  horseName: string;
  score: number;
  signals: Signal[];
  /** Set when a hard negative applies and nothing excuses it. */
  excluded: boolean;
  exclusionReason: string | null;
  /**
   * The horse's record on today's ground, and on the bands either side of it,
   * in plain words. Always populated, never scored.
   *
   * Dan, 2026-09-01, on Annandale being NAP for a Hamilton card projected
   * heavy: "a horse never running on heavy is a huge negative, the same as a
   * horse never winning on soft."
   *
   * The rule he asked for was measured over both windows and does not hold —
   * the badly-beaten group returned +87.4% over Sep-Feb, and excluding it
   * would have deleted our best segment. So the score is unchanged. What was
   * genuinely wrong is that the evidence was invisible: Annandale is 0 wins,
   * 0 places from 4 on soft with a best effort of 11.5L, and the file said
   * nothing at all, because the signal that would have said it carries weight
   * zero and weight-zero signals are never printed. This line is printed for
   * every selection whether it flatters the pick or not, so that a ground
   * record like that has to be read before the bet is made.
   */
  groundRecord: string;
}

/** How far a trip can differ and still count as "proven". */
const TRIP_TOLERANCE_F = 0.5;

/** How far apart two going bands can be and still count as similar. */
const GOING_TOLERANCE = 1;

function goingDistance(a: GoingBand, b: GoingBand): number | null {
  const i = GOING_ORDER.indexOf(a);
  const j = GOING_ORDER.indexOf(b);
  if (i < 0 || j < 0) return null; // "standard" (AW) is off the turf scale
  return Math.abs(i - j);
}

/**
 * The horse's record on one going band.
 *
 * Places count, not only wins. A horse that has been placed three times on soft
 * clearly handles it; requiring a win throws away most of the evidence the form
 * book holds. Four runs is the threshold for the reverse conclusion — three
 * without a place can be circumstance, four is a pattern.
 */
export function recordOn(
  history: PastRun[],
  band: GoingBand
): { runs: number; wins: number; placed: number } {
  if (band === "unknown") return { runs: 0, wins: 0, placed: 0 };

  const onBand = history.filter(
    (r) => r.goingBand === band && r.positionNum !== null
  );

  return {
    runs: onBand.length,
    wins: onBand.filter((r) => r.positionNum === 1).length,
    placed: onBand.filter((r) => r.positionNum !== null && r.positionNum <= 3).length,
  };
}

/** Runs where the horse won — its proven conditions. */
/**
 * The ground finally comes right.
 *
 * Dan, 2026-08-30: "when looking for horses that are well handicapped, have
 * been running on ground they don't like (need soft, been running on
 * good/firm) then this for me is a key signal they are nearly ready to win.
 * These are the standout horses."
 *
 * `campaignedImpossibly` already finds a mark falling while a horse was
 * campaigned outside its window. What it never asked is whether today puts
 * that right — it fires the same on a soft-ground horse facing good to firm
 * again, which is the opposite situation. Measured over 20,000 scored runners,
 * asking the extra question is worth 11 points of ROI: the unconditional
 * signal returns -26.4%, this one -15.0%.
 *
 * Three things together:
 *
 *   the horse has WON on today's ground
 *   its recent runs were on ground it has never won on
 *   the handicapper has taken it down across those runs
 *
 * A horse whose bad form has a reason, whose mark reflects the bad form, and
 * whose reason has just been removed.
 */
export function groundComesRight(
  todayOfr: number | null,
  history: PastRun[],
  race: RaceToday
): { found: boolean; offItsGround: number; of: number; drop: number; detail: string } {
  const none = { found: false, offItsGround: 0, of: 0, drop: 0, detail: "" };

  // Ground is a continuum, not a set of labels. A horse that has won on soft
  // is proven when the ground comes up good to soft, and a horse that needs
  // soft is not "off its ground" on good to soft either — it is off it on good
  // to firm. Testing the band exactly found nothing at all: Phoenix Pairc had
  // won on soft, ran four times on quicker ground with its mark down 7lb, and
  // did not qualify because Roscommon was reading good to soft rather than
  // soft. One band either way is the same ground to a horse.
  const wonBands = winningRuns(history)
    .map((r) => r.goingBand)
    .filter((b) => b !== "unknown");

  if (!wonBands.length) return none;

  // Won on exactly today's ground.
  //
  // Three versions of this were measured. Allowing one band either way, on the
  // reasoning that a soft-ground horse is proven on good to soft, fired more
  // often and returned far less (-25.0% against -15.0%). The strength of the
  // signal is in the literal claim: it has won on THIS going, not on something
  // like it.
  const wonExactly = new Set<string>(wonBands);
  if (!wonExactly.has(race.goingBand)) return none;

  const recent = history
    .filter((r) => sameDiscipline(r.raceType, race.raceType))
    .slice(0, 4);
  if (recent.length < 3) return none;

  const offItsGround = recent.filter(
    (r) => r.goingBand !== "unknown" && !wonExactly.has(r.goingBand)
  ).length;

  const marks = recent.map((r) => r.ofr).filter((o): o is number => o !== null);
  const drop = marks.length >= 2 && todayOfr !== null ? Math.max(...marks) - todayOfr : 0;

  if (offItsGround < recent.length - 1 || drop < 3) return none;

  return {
    found: true,
    offItsGround,
    of: recent.length,
    drop,
    detail:
      `${offItsGround} of the last ${recent.length} on ground it has never won on, ` +
      `mark down ${drop}lb, and it has won on ${race.goingBand}`,
  };
}

/** "Class 4" -> 4. Null for Irish racing, which carries no class. */
function classNumber(raceClass: string | null | undefined): number | null {
  const m = /(\d)/.exec(String(raceClass ?? ""));
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 7 ? n : null;
}

function winningRuns(history: PastRun[]): PastRun[] {
  return history.filter((r) => r.positionNum !== null && r.positionNum === 1);
}

/**
 * How far back a winning MARK still tells you anything. Set to 18 months on
 * 2026-08-26.
 *
 * Without a window, wonOffHigherMark() returns the highest mark a horse ever
 * won off. Cordouan scored five stars on a mark "42lb below its last winning
 * mark of 90" — a win from September 2022. Four years of decline read as a
 * plot. The handicapper had simply been right, repeatedly.
 *
 * The window applies to the MARK only, not to proven conditions. A horse that
 * has won at a course seven times still likes the course, however long ago;
 * what it won off back then says nothing about whether it is well treated now.
 */
export const MARK_LOOKBACK_MONTHS = 18;

function monthsBetween(from: string, to: string): number {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Infinity;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

/**
 * A mark falling steadily across years is decline, not a plot.
 *
 * Reported separately so it can be seen on a card without silently changing a
 * score. A horse whose rating has eroded season after season while running
 * poorly is being correctly assessed by the handicapper, and is the opposite
 * of the angle we are looking for.
 */
export function markDecline(
  history: PastRun[],
  today: string
): { declining: boolean; lbsLost: number; overMonths: number } {
  const marked = history.filter((r) => r.ofr !== null);
  if (marked.length < 6) return { declining: false, lbsLost: 0, overMonths: 0 };

  const newest = marked[0];
  const oldest = marked[marked.length - 1];
  const span = monthsBetween(oldest.raceDate, newest.raceDate);
  const lost = (oldest.ofr as number) - (newest.ofr as number);

  // Long span, large loss, and no recent win to explain a rise.
  const wonRecently = winningRuns(history).some(
    (r) => monthsBetween(r.raceDate, today) <= MARK_LOOKBACK_MONTHS
  );

  return { declining: span >= 24 && lost >= 15 && !wonRecently, lbsLost: lost, overMonths: span };
}

/**
 * Does the horse like today's conditions?
 *
 * Proven going, proven trip, proven course. Each is separate evidence — a
 * course winner over the trip on the ground is the full house.
 */
export function likesConditions(
  today: RaceToday,
  history: PastRun[]
): {
  going: boolean; trip: boolean; course: boolean; courseWins: number;
  failsOnGround: boolean;
  /** Never placed in four or more runs on this ground OR the bands beside it. */
  failsNearby: boolean;
  groundProof: "on-the-day" | "read-across" | null;
} {
  const wins = winningRuns(history);

  // Evidence that a horse acts on the ground, strongest first:
  //
  //   1. It has placed on this exact going. A horse does not run into the
  //      first three on soft by accident — winning is not the only proof.
  //   2. It has won within one band. Good-soft and soft are close enough to
  //      read across, but only in the absence of (3).
  //   3. It has been tried on this exact going repeatedly and never got near,
  //      which overrules (2). Two wins on good-soft do not survive none from
  //      six on soft.
  const record = recordOn(history, today.goingBand);

  const placedOnGround = record.runs > 0 && record.placed > 0;

  const wonNearby = wins.some((r) => {
    const d = goingDistance(r.goingBand, today.goingBand);
    return d !== null ? d <= GOING_TOLERANCE : r.goingBand === today.goingBand;
  });

  const failsOnGround = record.runs >= 4 && record.placed === 0;

  // The same test, one band either side.
  //
  // Dan, 2026-09-02, on the Annandale NAP: "is the ground an issue?" It is —
  // 0 wins and 0 placings from 4 on soft, and the card projects heavy. The
  // model said nothing at all, because failsOnGround counts runs on the EXACT
  // band and the horse has never seen heavy.
  //
  // The asymmetry is the bug. A win one band away counts as proof that a horse
  // acts on today's ground (wonNearby, GOING_TOLERANCE) but four failures one
  // band away count for nothing. That is backwards: fails-on-ground is the
  // best-measured signal in the set at -11.4% ROI, precisely because the market
  // discounts a negative less than it discounts a positive.
  const nearRuns = history.filter((r) => {
    const d = goingDistance(r.goingBand, today.goingBand);
    return r.positionNum !== null && d !== null && d <= GOING_TOLERANCE;
  });
  const nearPlaced = nearRuns.filter((r) => (r.positionNum ?? 99) <= 3).length;
  const failsNearby = !failsOnGround && nearRuns.length >= 4 && nearPlaced === 0;

  // Dan, 2026-08-30: "what makes you think ROCK OF ENGLAND would go on soft"
  //
  // Nothing did. He is 0 from 2 on good-soft — no win, no place — and the
  // signal never looked, because failsOnGround needs four runs before it
  // overrules the read-across, and wonNearby was happy to accept three wins
  // on good (one band away) as proof.
  //
  // Tightening this to "any two unplaced runs on the real ground kill the
  // read-across" was tested and REJECTED: it cost 3.0pp of ROI over Mar-Jun
  // 2026 and 0.9pp over Sep 2025-Feb 2026, both windows agreeing. The
  // neighbouring band is apparently carrying real information even when the
  // horse has been beaten on the exact going. So the score is left alone and
  // only the CLAIM is corrected, below — a read-across is reported as a
  // read-across, not as proof.
  const going = failsOnGround ? false : placedOnGround || wonNearby;

  // What the evidence actually is, so the label can stop overstating it.
  const groundProof: "on-the-day" | "read-across" | null = !going
    ? null
    : placedOnGround
      ? "on-the-day"
      : "read-across";

  const trip = wins.some(
    (r) =>
      r.distanceF !== null &&
      today.distanceF !== null &&
      Math.abs(r.distanceF - today.distanceF) <= TRIP_TOLERANCE_F
  );

  const courseWins = wins.filter((r) => r.courseSlug === today.courseSlug).length;

  return { going, trip, course: courseWins > 0, courseWins, failsOnGround, failsNearby, groundProof };
}

/**
 * The trip he wins at against the trip he runs today — the comparison Dan asked
 * to see, phrased so it says something.
 *
 * The first version printed "(he wins at 8f, this is 8f)", which is true and
 * useless. Now that the signal only fires when today IS his trip, the useful
 * statement is that he is back on it — and the two figures only both appear
 * when they actually differ.
 */
function evidence(reasons: string[], provenTrips: number[], todayF: number | null): string {
  if (!reasons.includes("trip") || !provenTrips.length || todayF === null) return "";

  const f = (n: number) => {
    const whole = Math.floor(n);
    const half = n - whole >= 0.4 && n - whole <= 0.6;
    return `${whole}${half ? "\u00bd" : ""}f`;
  };

  const nearest = [...provenTrips].sort(
    (a, b) => Math.abs(a - todayF) - Math.abs(b - todayF)
  )[0];

  // A comma clause, not another "and". The write-up already joins its reasons
  // with "and", and a detail that adds two more produces a sentence with four
  // of them in it.
  return Math.abs(nearest - todayF) <= 0.5
    ? `, back to ${f(todayF)} today where he wins`
    : `, back to ${f(todayF)} today, close to the ${f(nearest)} he wins at`;
}

/**
 * Has the horse won off a mark higher than today's?
 *
 * This is the core of the method. The gap in pounds is the size of the edge:
 * "off a mark of 55, which is now 10lb below his last winning mark."
 */
export function wonOffHigherMark(
  todayOfr: number | null,
  history: PastRun[],
  today: string,
  todayType: string | null = null,
  withinMonths: number = MARK_LOOKBACK_MONTHS
): {
  found: boolean;
  lbsBelow: number;
  lastWinningMark: number | null;
  when: string | null;
  discipline: string | null;
} {
  if (todayOfr === null) {
    return { found: false, lbsBelow: 0, lastWinningMark: null, when: null, discipline: null };
  }

  // The mark he LAST won off, not the highest he ever won off.
  //
  // Dan, 2026-09-23, on FISCAL POLICY: "this won last time out." He had — seven
  // days earlier, off 70, which is his mark today. This function reached back
  // for the biggest winning mark in the window and produced "7lb below the 77
  // it won from back in May 2025", an argument that he is well treated, while
  // saying nothing about the win a week ago off exactly today's figure.
  //
  // The handicapper reassesses from the most recent win; so does Dan's streak
  // rule, which compares today's mark to the one he won off last. Citing an
  // older, higher mark overstates the case whenever a horse has won since off
  // something lower — and on 2026-09-24 two write-ups on the live card did
  // exactly that.
  //
  // winningRuns() is newest first.
  let bestMark: number | null = null;
  let when: string | null = null;
  for (const r of winningRuns(history)) {
    if (r.ofr === null) continue;
    // Only wins inside the lookback window count. See MARK_LOOKBACK_MONTHS.
    if (monthsBetween(r.raceDate, today) > withinMonths) continue;
    // Marks never cross disciplines. See sameDiscipline().
    if (todayType && !sameDiscipline(r.raceType, todayType)) continue;
    bestMark = r.ofr;
    when = r.raceDate;
    break;
  }

  const discipline = todayType ? normaliseDiscipline(todayType) : null;

  if (bestMark === null || bestMark <= todayOfr) {
    return { found: false, lbsBelow: 0, lastWinningMark: bestMark, when, discipline };
  }

  return {
    found: true,
    lbsBelow: bestMark - todayOfr,
    lastWinningMark: bestMark,
    when,
    discipline,
  };
}

/**
 * Has the horse been campaigned in conditions it could not win in?
 *
 * Dan: "running over distances or on ground they can't possibly win off."
 *
 * This is the plot. A yard drops a horse's mark by running it where it has no
 * chance — wrong trip, wrong ground — then places it when conditions come
 * right. Evidence is a run of recent starts outside the horse's proven window,
 * with the official rating falling across them.
 */
export function campaignedImpossibly(
  history: PastRun[],
  lookback = 4,
  todayType: string | null = null,
  todayF: number | null = null,
  todayGoing: GoingBand = "unknown"
): { found: boolean; runsOutOfWindow: number; ofrDrop: number; detail: string } {
  // Same-discipline only: a mark moving in one code says nothing about another.
  const scoped = todayType
    ? history.filter((r) => sameDiscipline(r.raceType, todayType))
    : history;
  const wins = winningRuns(scoped);
  const recent = scoped.slice(0, lookback);

  if (wins.length === 0 || recent.length < 2) {
    return { found: false, runsOutOfWindow: 0, ofrDrop: 0, detail: "" };
  }

  const provenTrips = wins.map((r) => r.distanceF).filter((d): d is number => d !== null);
  const provenGoing = wins.map((r) => r.goingBand);

  // Today has to put it right.
  //
  // Dan, 2026-08-30, on Justenzia: "we need to see the trip he has won over and
  // the trip he is running on the day."
  //
  // The signal read "2 of his last 4 starts on the wrong trip and his mark is
  // 5lb lower for it" — as a reason to back him. His only win was at 9½f, the
  // two runs being excused were at 12f, and the race being previewed was 12f.
  // The excuse was being offered for the very conditions he was about to face
  // again, which is not a plot, it is a horse out of its depth with a falling
  // mark to show for it.
  //
  // So each half only counts if today is back inside the proven window. A run
  // at the wrong trip is only an excuse if today is the right trip.
  const tripRightToday =
    todayF === null ||
    provenTrips.length === 0 ||
    provenTrips.some((t) => Math.abs(t - todayF) <= TRIP_TOLERANCE_F * 3);

  const goingRightToday =
    todayGoing === "unknown" ||
    provenGoing.length === 0 ||
    provenGoing.some((g) => {
      const d = goingDistance(g, todayGoing);
      return d !== null ? d <= GOING_TOLERANCE + 1 : g === todayGoing;
    });

  let outOfWindow = 0;
  const reasons: string[] = [];

  for (const r of recent) {
    const wrongTrip =
      tripRightToday &&
      r.distanceF !== null &&
      provenTrips.length > 0 &&
      provenTrips.every((t) => Math.abs(t - r.distanceF!) > TRIP_TOLERANCE_F * 3);

    const wrongGoing =
      goingRightToday &&
      provenGoing.length > 0 &&
      provenGoing.every((g) => {
        const d = goingDistance(g, r.goingBand);
        return d !== null ? d > GOING_TOLERANCE + 1 : g !== r.goingBand;
      });

    if (wrongTrip || wrongGoing) {
      outOfWindow++;
      if (wrongTrip && !reasons.includes("trip")) reasons.push("trip");
      if (wrongGoing && !reasons.includes("ground")) reasons.push("ground");
    }
  }

  // The mark must actually be coming down over that spell.
  const marks = recent.map((r) => r.ofr).filter((o): o is number => o !== null);
  const ofrDrop = marks.length >= 2 ? marks[marks.length - 1] - marks[0] : 0;

  const found = outOfWindow >= 2 && ofrDrop > 0;

  return {
    found,
    runsOutOfWindow: outOfWindow,
    ofrDrop,
    detail: found
      ? `${outOfWindow} of the last ${recent.length} starts on the wrong ` +
        `${reasons.join(" and ")}${evidence(reasons, provenTrips, todayF)}, mark down ${ofrDrop}lb`
      : "",
  };
}

/**
 * A big run off today's mark, without needing a win.
 *
 * Dan, 2026-08-27: "we need to include BIG runs where horses went close and
 * are running of the same marks or 1 or 2lb higher".
 *
 * wonOffHigherMark() only counts victories, which misses the horse beaten a
 * neck off the same rating — arguably better evidence than a win from two
 * years ago, because the handicapper has not reacted to it. Guesstimate was
 * beaten 1.5 lengths off 72 and runs off 73: a length and a half from winning
 * at effectively the same mark, and the model scored it nothing.
 *
 * Same discipline only, and inside the mark lookback window.
 */
export function wentCloseOffSimilarMark(
  todayOfr: number | null,
  history: PastRun[],
  today: string,
  todayType: string | null = null,
  { maxLengths = 3, markTolerance = 2, withinMonths = MARK_LOOKBACK_MONTHS } = {}
): { found: boolean; best: PastRun | null; lengths: number; markDiff: number } {
  if (todayOfr === null) return { found: false, best: null, lengths: 0, markDiff: 0 };

  let best: PastRun | null = null;
  let bestLengths = Infinity;

  for (const r of history) {
    if (r.ofr === null || r.ovrBtn === null) continue;
    if (r.positionNum === null || r.positionNum === 1) continue; // wins handled elsewhere
    if (monthsBetween(r.raceDate, today) > withinMonths) continue;
    if (todayType && !sameDiscipline(r.raceType, todayType)) continue;

    // Ran off the same mark, or one it has since come down from — and no more
    // than markTolerance above today's.
    if (r.ofr < todayOfr - markTolerance) continue;
    if (r.ofr > todayOfr + markTolerance) continue;

    if (r.ovrBtn <= maxLengths && r.ovrBtn < bestLengths) {
      best = r;
      bestLengths = r.ovrBtn;
    }
  }

  return best
    ? { found: true, best, lengths: bestLengths, markDiff: (best.ofr as number) - todayOfr }
    : { found: false, best: null, lengths: 0, markDiff: 0 };
}

/**
 * How did it run last time?
 *
 * Dan, 2026-08-27: "the 'improving part' we dont need to get by lentghs beaten
 * on avg - i think we need to look at the last race comments."
 *
 * Replaces an averaged beaten-lengths trend. The in-running comment says what
 * the finishing position cannot: a horse beaten six lengths that was staying on
 * through the last furlong is going the right way, and one beaten the same
 * distance after weakening from two out is not.
 *
 * Frequencies across 655 horses declared on 2026-08-27, so these actually
 * separate runners rather than firing on everything:
 *
 *   stayed on / finished well   30%
 *   trouble in running           4%
 *   weakened / dropped away     14%
 *   nothing readable            53%
 */
export function lastRunReading(
  history: PastRun[],
  age: number | null | undefined
): { signal: Signal | null; evidence: string[] } {
  const last = history[0];
  if (!last) return { signal: null, evidence: [] };

  const read = readComment(last.comment);

  // A faller usually says nothing — but one that came down while travelling in
  // contention, or was brought down through no fault of its own, is a run the
  // market forgets and the form book hides.
  if (read.fellGoingWell) {
    return {
      signal: {
        key: "fell-going-well",
        label:
          read.nonCompletionType === "brought-down"
            ? "Brought down last time"
            : "Fell when going well",
        weight: weightFor("fell-going-well", 3),
        detail: `last time: ${read.evidence.slice(0, 2).join(", ") || read.nonCompletionType}`,
      },
      evidence: read.evidence,
    };
  }
  if (read.nonCompletion) return { signal: null, evidence: [] };

  const young = (age ?? 99) <= 5;

  // Travelling well and not being knocked about stack with finishing well:
  // together they describe a horse that had more to give.
  const extras: string[] = [];
  let bonus = 0;
  if (read.travelledWell) { extras.push("travelled well"); bonus += 1; }
  if (read.easyRide) { extras.push("not given a hard ride"); bonus += 2; }

  // Dan, 2026-08-28:
  //   "how can it be staying on at finish last time when he won the race,
  //    of course he was"
  //
  // Right. The signal exists to find horses that were finishing strongly WHEN
  // BEATEN — the run the bare result hides. A winner staying on is what winning
  // looks like; saying it adds nothing, and on Box Clever it described the same
  // race twice, once as a 3¾-length win and again as "staying on at the
  // finish". The comment above this function always said "when beaten"; the
  // code never checked.
  const wonLastTime = last.positionNum === 1;

  // Winning last time is a positive in its own right, and the model had none.
  //
  // Removing the bogus "staying on" claim from a winner left it with nothing
  // for its most recent run, which dropped Box Clever — a horse that won by
  // 3¾ lengths off an unchanged mark eight days ago — below one whose best
  // evidence was a beaten half-length in April. The claim was wrong; the horse
  // was not. Credit the win instead of the commentary.
  if (wonLastTime) {
    return {
      signal: {
        key: "last-run-won",
        label: young ? "Won last time, and young enough to improve" : "Won last time out",
        weight: weightFor("last-run-won", (young ? 3 : 2) + bonus),
        detail: `won on ${last.raceDate}${extras.length ? `, ${extras.join(", ")}` : ""}`,
      },
      evidence: read.evidence,
    };
  }

  if (read.stayedOn) {
    return {
      signal: {
        key: "last-run-positive",
        label: young ? "Finishing well, and young enough to improve" : "Finishing well last time",
        weight: weightFor("last-run-positive", (young ? 3 : 2) + bonus),
        detail: `last time: ${[...read.evidence.slice(0, 2), ...extras].join(", ")}`,
      },
      evidence: read.evidence,
    };
  }

  // Travelled well or was never asked, even without a strong finish.
  if (bonus > 0) {
    return {
      signal: {
        key: "last-run-easy",
        label: read.easyRide ? "Not given a hard ride last time" : "Travelled well last time",
        weight: weightFor("last-run-easy", bonus),
        detail: `last time: ${extras.join(", ")}`,
      },
      evidence: read.evidence,
    };
  }

  if (read.trouble) {
    return {
      signal: {
        key: "last-run-trouble",
        label: "Run compromised last time",
        weight: weightFor("last-run-trouble", 2),
        detail: `last time: ${read.evidence.slice(0, 2).join(", ")}`,
      },
      evidence: read.evidence,
    };
  }

  if (read.failedToStay) {
    return {
      signal: {
        key: "last-run-negative",
        label: "Weakened last time",
        weight: weightFor("last-run-negative", -1),
        detail: `last time: ${read.evidence.slice(0, 2).join(", ")}`,
      },
      evidence: read.evidence,
    };
  }

  return { signal: null, evidence: [] };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Is today's jockey booking significant?
 *
 * Three ways it counts: a change from last time to a materially better rider,
 * a rider who has already won on this horse, or a top-tier booking on a horse
 * whose usual partner is not.
 */
export function significantBooking(
  today: HorseToday,
  history: PastRun[],
  jockeyStrikeRate: (jockeyId: string) => number | null,
  topTierThreshold = 18
): { found: boolean; changed: boolean; wonOnBefore: boolean; detail: string } {
  const jockeyId = today.jockeyId;
  if (!jockeyId) return { found: false, changed: false, wonOnBefore: false, detail: "" };

  const lastRun = history[0];
  const changed = lastRun?.jockeyId != null && lastRun.jockeyId !== jockeyId;

  const wonOnBefore = winningRuns(history).some((r) => r.jockeyId === jockeyId);

  // Strike rates arrive as raw percentages. Round once, here, or every caller
  // prints "13.08262711864407%".
  const round = (n: number | null) => (n === null ? null : Math.round(n));
  const sr = round(jockeyStrikeRate(jockeyId));
  const prevSr = round(lastRun?.jockeyId ? jockeyStrikeRate(lastRun.jockeyId) : null);

  const topTier = sr !== null && sr >= topTierThreshold;
  const upgrade = changed && sr !== null && prevSr !== null && sr > prevSr + 5;

  // Dan, 2026-08-28:
  //   "significant booking is for a horse out of form and a top jockey booked"
  //
  // The signal is about stable intent, and intent only shows when the booking
  // is out of the ordinary. A top rider staying on a horse he already rides
  // says nothing — it was firing as "18% rider retains the ride" on any decent
  // jockey in the race, which is most races. A yard that puts a top rider on
  // something that has been running badly is telling you it expects a change.
  const recent = history.slice(0, 4);
  const outOfForm =
    recent.length >= 2 &&
    !recent.some((r) => r.positionNum !== null && r.positionNum <= 3);

  const newTopRider = changed && topTier;
  const bits: string[] = [];

  if (wonOnBefore && changed) bits.push("a rider who has won on it before returns");
  if (upgrade && outOfForm) bits.push(`upgrade from a ${prevSr}% rider to ${sr}% on a horse out of form`);
  else if (newTopRider && outOfForm) bits.push(`${sr}% rider takes over on a horse out of form`);
  else if (upgrade) bits.push(`upgrade from a ${prevSr}% rider to ${sr}%`);

  return {
    // A retained top-tier ride no longer qualifies on its own.
    found: bits.length > 0,
    changed,
    wonOnBefore,
    detail: bits.join(", "),
  };
}

/**
 * How long since it last won — and whether that is its fault.
 *
 * Dan, 2026-08-27:
 *   "if a horse hasnt won a race for 2 years then we need to mark this down,
 *    if a horse hasnt won because its not running on optimal ground then
 *    thats fine."
 *
 * So a long losing run is a caution, NOT a verdict. The exemption is the
 * important half: a horse campaigned off its optimal ground has an explanation
 * for not winning, and that is the same evidence that makes it interesting
 * when the ground finally comes right. Penalising it would reject exactly the
 * horses the method is built to find.
 *
 * The going check uses the horse's own winning bands, so "optimal" means what
 * this horse has actually proved, not a general notion of good ground.
 */
export function winDrought(
  history: PastRun[],
  today: string
): {
  runsSinceWin: number;
  monthsSinceWin: number | null;
  everWon: boolean;
  offOptimalGoing: number;
  excused: boolean;
  signal: Signal | null;
} {
  const wins = winningRuns(history);
  const everWon = wins.length > 0;

  const lastWinIdx = history.findIndex((r) => r.positionNum === 1);
  const runsSinceWin = lastWinIdx === -1 ? history.length : lastWinIdx;
  const monthsSinceWin = everWon ? monthsBetween(wins[0].raceDate, today) : null;

  // Which of the runs since the win were on going this horse has never won on?
  const provenGoing = wins.map((w) => w.goingBand);
  const since = history.slice(0, runsSinceWin);
  const offOptimalGoing = since.filter((r) => {
    if (!provenGoing.length) return false;
    return provenGoing.every((g) => {
      const d = goingDistance(g, r.goingBand);
      return d !== null ? d > GOING_TOLERANCE : g !== r.goingBand;
    });
  }).length;

  // More than half the drought spent on unsuitable ground explains it.
  const excused = since.length >= 3 && offOptimalGoing / since.length > 0.5;

  let signal: Signal | null = null;
  if (!everWon && history.length >= 8) {
    signal = {
      key: "never-won",
      label: "Has never won",
      weight: weightFor("never-won", -3),
      detail: `${history.length} runs, no win`,
    };
  } else if (monthsSinceWin !== null && monthsSinceWin >= 24 && !excused) {
    signal = {
      key: "drought",
      label: "Long time without a win",
      weight: weightFor("drought", -3),
      detail: `${runsSinceWin} runs and ${monthsSinceWin} months since it won`,
    };
  } else if (monthsSinceWin !== null && monthsSinceWin >= 24 && excused) {
    signal = {
      key: "drought-excused",
      label: "Winless, but off its ground",
      weight: weightFor("drought-excused", 1),
      detail: `${offOptimalGoing} of ${since.length} runs since its win on going it has never won on`,
    };
  }

  return { runsSinceWin, monthsSinceWin, everWon, offOptimalGoing, excused, signal };
}

/**
 * Did it win by more than the handicapper has taken off it?
 *
 * A horse that wins a five-furlong handicap by four lengths has shown roughly
 * twelve pounds of superiority. If the assessor has raised it six, it is still
 * six pounds ahead of its mark — and that is invisible if you only look at the
 * rating.
 *
 * Only wins inside the lookback window, in today's discipline, count.
 */
export function wonMoreEasilyThanRaised(
  todayOfr: number | null,
  history: PastRun[],
  today: string,
  todayType: string | null = null
): {
  found: boolean;
  surplus: number;
  margin: number;
  marginLbs: number;
  rise: number;
  when: string | null;
} {
  const none: {
    found: boolean; surplus: number; margin: number;
    marginLbs: number; rise: number; when: string | null;
  } = { found: false, surplus: 0, margin: 0, marginLbs: 0, rise: 0, when: null };
  if (todayOfr === null) return none;

  let best = none;

  for (const r of winningRuns(history)) {
    if (r.ofr === null || r.winMargin === null || r.winMargin === undefined) continue;
    if (monthsBetween(r.raceDate, today) > MARK_LOOKBACK_MONTHS) continue;
    if (todayType && !sameDiscipline(r.raceType, todayType)) continue;

    const lbs = marginInPounds(r.winMargin, r.distanceF, r.raceType);
    if (lbs === null) continue;

    // What the handicapper actually did to it since that win.
    const rise = todayOfr - r.ofr;

    // Only meaningful when the horse was RAISED. A negative rise means the
    // mark has since FALLEN, and crediting the drop here double-counts what
    // wonOffHigherMark() already scores. Simiyann showed the failure: a win by
    // a quarter of a length (worth ~0.3lb) was reported as "14.3lb in hand"
    // purely because its mark had dropped 14lb, and it collected for the same
    // 14lb twice in one score.
    if (rise < 0) continue;

    const surplus = lbs - rise;

    if (surplus > best.surplus) {
      best = {
        found: surplus >= 3, // below three pounds it is noise
        surplus: Math.round(surplus * 10) / 10,
        margin: r.winMargin,
        marginLbs: lbs,
        rise,
        when: r.raceDate,
      };
    }
  }

  return best.found ? best : none;
}

/**
 * Trainer form over the last fourteen days.
 *
 * +2 for a hot yard, -2 for a cold one, per Dan 2026-08-27.
 *
 * The thresholds come from the live distribution across 375 upcoming runners
 * whose trainer had a usable sample (2026-08-27):
 *
 *   mean 12.6%   median 12.0%   20th percentile 5%   80th percentile 20%
 *
 * So HOT is the top fifth and COLD the bottom fifth — symmetric, and derived
 * rather than picked.
 *
 * MIN_TRAINER_RUNS matters more than the thresholds. A yard with one runner
 * and one winner is not on a 100% strike rate, it is on no strike rate at all.
 * Below the minimum the signal simply does not fire, in either direction:
 * roughly half of runners get no trainer signal, which is the honest outcome
 * rather than inventing one.
 */
export const TRAINER_HOT_PCT = 20;
export const TRAINER_COLD_PCT = 5;
export const MIN_TRAINER_RUNS = 10;

export function trainerFormSignal(
  runs: number | null | undefined,
  wins: number | null | undefined,
  percent: number | null | undefined
): Signal | null {
  if (runs === null || runs === undefined || runs < MIN_TRAINER_RUNS) return null;
  if (percent === null || percent === undefined) return null;

  const record = `${wins ?? "?"} from ${runs} in 14 days`;

  if (percent >= TRAINER_HOT_PCT)
    return { key: "trainer-hot", label: "Yard in form", weight: weightFor("trainer-hot", 2), detail: `${percent}% — ${record}` };
  if (percent <= TRAINER_COLD_PCT)
    return { key: "trainer-cold", label: "Yard out of form", weight: weightFor("trainer-cold", -2), detail: `${percent}% — ${record}` };
  return null;
}

/**
 * Time off, and what it costs.
 *
 * Added 2026-08-27 after Al Suil Eile scored five stars on tomorrow's card
 * while 486 days off the track. Every condition matched — Southwell, 7f,
 * standard, right field size — and the model had no idea the horse had not
 * run in sixteen months.
 *
 * The bands are conventional rather than fitted, and should be re-checked
 * against the backfill: a returning horse's strike rate is measurable from
 * the history we now hold.
 */
export function layoffPenalty(days: number | null | undefined): Signal | null {
  if (days === null || days === undefined) return null;

  if (days >= 365)
    return { key: "layoff", label: "Long absence", weight: weightFor("layoff", -4), detail: `${days} days off — over a year` };
  if (days >= 180)
    return { key: "layoff", label: "Long absence", weight: weightFor("layoff", -3), detail: `${days} days off` };
  if (days >= 120)
    return { key: "layoff", label: "Off the track a while", weight: weightFor("layoff", -1), detail: `${days} days off` };
  if (days <= 5)
    return { key: "quick-turnaround", label: "Quick turnaround", weight: weightFor("quick-turnaround", 0), detail: `ran ${days} day${days === 1 ? "" : "s"} ago` };
  return null;
}

/**
 * Score one horse.
 *
 * Weights are a starting hypothesis, not a finding. They must be re-fitted
 * against the backfill before the star bands mean anything — see
 * docs/tipping-method.md.
 */
export function scoreHorse(
  today: HorseToday,
  race: RaceToday,
  history: PastRun[],
  jockeyStrikeRate: (jockeyId: string) => number | null = () => null,
  raceDate: string = new Date().toISOString().slice(0, 10),
  drawBias: DrawBiasLookup = () => null,
  paceBias: PaceBiasLookup = () => null
): HorseScore {
  const signals: Signal[] = [];

  const cond = likesConditions(race, history);
  if (cond.going) {
    const rec = recordOn(history, race.goingBand);
    // Dan, 2026-08-30, on Rating and then on the card as a whole:
    //   "this is what i mean by mistakes, the whole card prob has the same
    //    mistakes"
    //
    // It did. Across the 51 selections for 31 August, twelve claimed "Proven
    // on the ground" on a PLACING and no win, five of those on a single run,
    // and nine more had never raced on it at all. Rating's proof was one
    // Class 6 third at Bath — out of a 33-run career — while the card
    // projected heavy.
    //
    // The score is deliberately unchanged: tightening this was measured on
    // 2026-08-30 and cost 3.0pp of ROI over Mar-Jun and 0.9pp over Sep-Feb.
    // What changes is the claim, and the claim now has to survive being read
    // next to the record printed beside it.
    //
    // One run out of a long career is not thin evidence, it is a yard keeping
    // a horse off that ground, so it gets said outright.
    const bigCareer = history.length >= 8;
    const label =
      cond.groundProof === "read-across"
        ? "Won on similar ground"
        : rec.wins > 0
          ? "Proven on the ground"
          : rec.runs <= 1 && bigCareer
            ? "Tried once on this ground"
            : "Placed on the ground";

    signals.push({
      key: "going",
      label,
      weight: weightFor("going", 2),
      // Say what the evidence actually is. "Won on soft" when the proof is
      // three places is the kind of overstatement that erodes trust in the file.
      // The career count rides along so the write-up can say "once in 33
      // starts" rather than "on its only start". Those are the same fact and
      // only one of them makes a reader stop.
      detail: rec.runs > 0
        ? `${rec.wins}w ${rec.placed}p from ${rec.runs} on ${race.goingBand} of ${history.length}`
        : `won on similar ground`,
    });
  }

  // Repeatedly tried on today's ground and never got near. A real negative, and
  // one worth stating: it is the reason a horse that looks well handicapped is
  // being passed over.
  if (cond.failsNearby) {
    push(signals, {
      key: "fails-near-ground",
      label: "Never placed on this sort of ground",
      weight: weightFor("fails-near-ground", 0),
      detail: `no placing in four or more runs on this ground or the bands beside it`,
    });
  }

  if (cond.failsOnGround) {
    const rec = recordOn(history, race.goingBand);
    signals.push({
      key: "fails-on-ground",
      label: "Unproven on the ground",
      weight: weightFor("fails-on-ground", -2),
      detail: `${rec.runs} runs on ${race.goingBand}, never placed`,
    });
  }
  if (cond.trip) signals.push({ key: "trip", label: "Proven at the trip", weight: weightFor("trip", 2), detail: `won over ${race.distanceF}f` });
  if (cond.course)
    signals.push({
      key: "course",
      label: "Course winner",
      weight: weightFor("course", cond.courseWins >= 3 ? 3 : 2),
      detail: `won here ${cond.courseWins} time${cond.courseWins === 1 ? "" : "s"}`,
    });

  const mark = wonOffHigherMark(today.ofr, history, raceDate, race.raceType);
  if (mark.found)
    signals.push({
      key: "mark",
      label: "Well handicapped",
      // The bigger the drop the stronger the case, capped so a freak old mark
      // cannot dominate the score on its own.
      weight: weightFor("mark", Math.min(4, 1 + Math.floor(mark.lbsBelow / 4))),
      detail:
        `${mark.lbsBelow}lb below its ${mark.discipline ?? ""} winning mark of ` +
        `${mark.lastWinningMark} (${mark.when})`,
    });

  // The same fact, cut the way 48,764 handicap runs say it behaves.
  //
  // The signal above pays a horse for being a long way BELOW a mark it once won
  // off, on the reasoning that it is ahead of the assessor. The measurement is
  // the other way round:
  //
  //   8lb+ below its winning mark   IV 0.84
  //   1-3lb below                   IV 0.83
  //   running off the same mark     IV 1.35
  //   6lb+ above                    IV 1.24
  //
  // and it survives restricting to horses that won inside the last year, so it
  // is not simply measuring decline. The handicapper drops horses that are
  // losing; a big drop is mostly evidence of that. A horse racing off the mark
  // it won from, or a little above it, is one that won recently and has not yet
  // been stopped — and that is the strongest bucket in the study.
  if (mark.found && today.ofr !== null && mark.lastWinningMark !== null) {
    const vsWin = today.ofr - mark.lastWinningMark;
    const of = `its winning mark of ${mark.lastWinningMark} (${mark.when})`;

    if (vsWin >= 0 && vsWin <= 5) {
      push(signals, {
        key: "mark-on-winning",
        label: "Racing off a winning mark",
        weight: weightFor("mark-on-winning", 0),
        detail: vsWin === 0 ? `off ${of}` : `${vsWin}lb above ${of}`,
      });
    } else if (vsWin > 5) {
      push(signals, {
        key: "mark-above",
        label: "Above its winning mark",
        weight: weightFor("mark-above", 0),
        detail: `${vsWin}lb above ${of}`,
      });
    } else if (vsWin <= -8) {
      push(signals, {
        key: "mark-well-below",
        label: "A long way below its winning mark",
        weight: weightFor("mark-well-below", 0),
        detail: `${-vsWin}lb below ${of} — the assessor has been dropping it`,
      });
    } else {
      push(signals, {
        key: "mark-below",
        label: "Below its winning mark",
        weight: weightFor("mark-below", 0),
        detail: `${-vsWin}lb below ${of}`,
      });
    }
  }

  // Class: has he won at this grade?
  //
  // Dan, 2026-08-30: "the class is key in handicaps — if the handicapper drops
  // him into a grade where he has won before."
  //
  // Measured across 48,764 handicap runs, and the two halves of that behave
  // differently, so they are scored separately:
  //
  //   best win is at today's grade   IV 1.27,  ROI -13.4%
  //   has won in a HIGHER grade      IV 1.11,  ROI -19.5%
  //   has only won lower down        IV 1.01,  ROI -24.4%
  //   dropped in grade, unproven     IV 1.00,  ROI -32.8%   worst in the study
  //
  // Being proven at the grade is what pays. The drop itself is not: dropping
  // adds winners (IV 1.31) but returns less than not dropping (-16.7% against
  // -14.8%), because a horse dropped in class is obvious and the market prices
  // it. So the class DROP scores nothing and the class RECORD scores.
  //
  // The strongest of the four is the negative, as it was for the ground: a
  // horse being asked to win at a level it has never won at is worth more to
  // know than one that has, because the market discounts a negative less.
  //
  // British racing only — Irish cards carry no class, and a missing class
  // means no signal rather than a guess.
  // Top rated in today's field.
  //
  // Dan, 2026-09-02: "can we add a factor based on official ratings — top
  // rated in the race."
  //
  // Everything the model measures about the mark is historical: how far below
  // a winning mark, whether the mark is falling, whether it went close off a
  // similar one. Nothing compares the horse with the animals it is actually
  // running against today.
  //
  // Measured across 2022-2026, top rated is the strongest untested angle in
  // the raw data — IV 1.36 in handicaps and 1.41 in maidens, with the best ROI
  // of any bucket examined (-11.7% and -8.8% against a -15% to -34% baseline).
  //
  // MEASURED AND REJECTED, 2026-09-02. It does not survive as a weight:
  //
  //            window A            window B
  //   live     -2.7%               -4.6%
  //   w1       -0.2%               -6.6%
  //   w2       -0.6%               -9.5%
  //   w3       -0.2%               -9.0%
  //   w4       -2.3%              -13.0%
  //
  // The two windows point in opposite directions, and window B gets steadily
  // worse as the weight rises. The likeliest reason is that the model's mark
  // signals already carry most of what the rating says, so adding it again
  // just pushes the pick towards the shorter price the market has read too.
  //
  // The maiden variant could not be tested at all: filterRace() takes handicaps
  // only, so the best segment in the whole dataset — top rated in a maiden,
  // -8.8% — sits outside the races we bet. That is a question about the betting
  // universe, not about this weight, and it is left for Dan to decide.
  //
  // A rank of 1 out of 3 rated runners is not the same claim as 1 out of 14,
  // so the field has to be big enough for the rank to mean anything.
  if ( today.ofrRank === 1 && ( today.ofrRated ?? 0 ) >= 5 ) {
    // The raw data separates handicaps from maidens: IV 1.36 against 1.41, and
    // ROI -11.7% against -8.8%. Both are offered so the difference can be
    // tested rather than assumed.
    const isHcap = /handicap/i.test( String( race.raceName ?? "" ) );

    push( signals, {
      key: isHcap ? "top-rated" : "top-rated-maiden",
      label: "Top rated in the race",
      weight: weightFor( isHcap ? "top-rated" : "top-rated-maiden", 0 ),
      detail: `highest official rating of the ${today.ofrRated} rated runners`,
    } );
  }

  // The course specialist, back at its track and its mark.
  //
  // Dan, 2026-09-01, on Phoenix Moon: "it only ever wins at Lingfield and it's
  // slipped to its last winning mark back at Lingfield."
  //
  // Four career wins, every one at Lingfield, best winning mark 61 — and it
  // runs off 61 there today, having been beaten at Newbury, Salisbury, Bath,
  // Windsor and Nottingham in between, which is what dropped the mark.
  //
  // The existing "course winner" signal counts wins at the track. It cannot
  // see that they are ALL of this horse's wins, which is the whole point: a
  // horse that wins everywhere and has won here once is not the same animal as
  // one that has only ever won here.
  //
  // MEASURED AND REJECTED, 2026-09-01. The pattern is real and easy to
  // identify — six runners on one card — but it does not pay:
  //
  //   the signal itself   Mar-Jun -10.1% ROI     Sep-Feb -30.2% ROI
  //   top pick at w2      -2.7% -> -2.8%         -4.6% -> -6.7%
  //   top pick at w3      -2.7% -> -2.6%         -4.6% -> -6.9%
  //   top pick at w4      -2.7% -> -2.5%         -4.6% -> -8.4%
  //
  // A twenty-point swing in the signal's own return between two windows is
  // noise, and every weight made the second window worse. Left at zero, so it
  // is computed and never scored — the definition is kept because the next
  // person to notice this pattern deserves to find the measurement rather than
  // repeat it.
  const allWins = winningRuns( history );
  if ( allWins.length >= 2 ) {
    const here = allWins.filter( ( r ) => r.courseSlug === race.courseSlug );

    if ( here.length === allWins.length ) {
      const marks = here.map( ( r ) => r.ofr ).filter( ( m ): m is number => m !== null && m !== undefined );
      const bestHere = marks.length ? Math.max( ...marks ) : null;
      const atOrBelow = bestHere !== null && today.ofr !== null && today.ofr !== undefined
        && Number( today.ofr ) <= bestHere;

      push( signals, {
        key: "course-specialist",
        label: atOrBelow
          ? "Only wins here, and back on a winning mark"
          : "Only wins here",
        weight: weightFor( "course-specialist", 0 ),
        detail: `all ${allWins.length} of his wins are at this track` +
          ( bestHere !== null
            ? `, the best off ${bestHere}${atOrBelow ? ` and he runs off ${today.ofr} today` : ""}`
            : "" ),
      } );
    }
  }

  // Dropping in grade off a good run in better company.
  //
  // Dan, 2026-09-01, on Yes I'm Mali: "ran a real good race last time out, a
  // better class of race, and it's a lb lower in a lower grade — why wouldn't
  // this be flagged."
  //
  // It would not, because there was no class term at all. The horse was beaten
  // 0.2L into second in a 19-runner Class 3 four days ago and drops to a Class
  // 4 today off a pound less, and the model scored it 4 points: two for the
  // trip and two for going close. Every angle it had was about the mark, and
  // the mark had not moved enough to notice.
  //
  // The two halves have to go together. A horse dropped in class because it is
  // outclassed is not the same as one that ran to form in better company and
  // has been let in — the first is a negative and the second is the oldest
  // angle in the book.
  const prevRun = history[0];
  if ( prevRun ) {
    const from = classNumber( prevRun.raceClass ?? null );
    const to   = classNumber( race.raceClass );
    const pos  = prevRun.positionNum;
    const btn  = prevRun.ovrBtn;

    // "Ran well" means it was competitive, not merely that it finished: the
    // first three, or beaten under two lengths anywhere in the field.
    const ranWell =
      ( pos !== null && pos <= 3 ) ||
      ( btn !== null && btn !== undefined && Number( btn ) <= 2 );

    if ( from !== null && to !== null && from < to && ranWell ) {
      const grades = to - from;
      push( signals, {
        key: "class-drop",
        label: grades > 1 ? "Drops two grades after a good run" : "Drops a grade after a good run",
        weight: weightFor( "class-drop", 0 ),
        detail: `${pos === 1 ? "won" : pos !== null ? `${pos}${pos === 2 ? "nd" : pos === 3 ? "rd" : "th"}` : "ran"}` +
          ` in a Class ${from}${btn !== null && btn !== undefined && Number( btn ) > 0 ? `, beaten ${btn}L` : ""}` +
          `, drops to Class ${to}`,
      } );
    }
  }

  const todayClass = classNumber( race.raceClass );
  if ( todayClass !== null ) {
    const wonClasses = winningRuns( history )
      .map( ( r ) => classNumber( r.raceClass ?? null ) )
      .filter( ( c ): c is number => c !== null );

    if ( wonClasses.length ) {
      const best = Math.min( ...wonClasses );

      if ( best <= todayClass ) {
        push( signals, {
          key: "class-proven",
          label: "Proven at this class",
          weight: weightFor( "class-proven", 0 ),
          detail: best === todayClass
            ? `has won a Class ${todayClass}`
            : `has won as high as Class ${best}`,
        } );
      } else {
        push( signals, {
          key: "class-unproven",
          label: "Never won at this level",
          weight: weightFor( "class-unproven", 0 ),
          detail: `best win is a Class ${best}, and this is a Class ${todayClass}`,
        } );
      }
    }
  }

  // Field size.
  //
  // Handicaps of seven or fewer supply a third of all winners from under a
  // fifth of the runners, at -6.6% ROI — the best of anything measured. Sixteen
  // and over returns -26.2%. The model had no field-size term at all.
  if (race.fieldSize !== null && race.fieldSize !== undefined) {
    if (race.fieldSize <= 7) {
      push(signals, {
        key: "field-small",
        label: "Small field",
        weight: weightFor("field-small", 0),
        detail: `${race.fieldSize} runners — handicaps this size win at 1.71x`,
      });
    } else if (race.fieldSize >= 16) {
      push(signals, {
        key: "field-big",
        label: "Big-field handicap",
        weight: weightFor("field-big", 0),
        detail: `${race.fieldSize} runners — these win at 0.56x`,
      });
    }
  }

  // A recent winner. IV 1.75 inside a month, 1.25 inside three. The model
  // penalises a drought and pays nothing for the opposite.
  {
    const lastWin = winningRuns(history)[0];
    if (lastWin) {
      const months = monthsBetween(lastWin.raceDate, raceDate);
      if (months <= 1) {
        push(signals, {
          key: "recent-winner",
          label: "Won this month",
          weight: weightFor("recent-winner", 0),
          detail: `won at ${lastWin.courseSlug ?? "the track"} on ${lastWin.raceDate}`,
        });
      } else if (months <= 3) {
        push(signals, {
          key: "recent-winner-3m",
          label: "Won in the last three months",
          weight: weightFor("recent-winner-3m", 0),
          detail: `last won ${months} month${months === 1 ? "" : "s"} ago`,
        });
      }
    }
  }

  const plot = campaignedImpossibly(history, 4, race.raceType, race.distanceF, race.goingBand);
  if (plot.found)
    signals.push({ key: "plot", label: "Mark being dropped", weight: weightFor("plot", 3), detail: plot.detail });

  // The ground finally comes right.
  //
  // Dan, 2026-08-30: "when looking for horses that are well handicapped, have
  // been running on ground they don't like (need soft, been running on
  // good/firm) then this for me is a key signal they are nearly ready to win.
  // These are the standout horses."
  //
  // `plot` above already finds a horse whose mark has been falling while it was
  // campaigned outside its window. What it never asked is whether today puts
  // that right — it fires the same on a soft-ground horse facing good to firm
  // again, which is the opposite situation. Three things have to be true
  // together:
  //
  //   the horse has WON on today's ground
  //   its recent runs were all on ground it has never won on
  //   the handicapper has taken it down across those runs
  //
  // That is a horse whose bad form has a reason, whose mark reflects the bad
  // form, and whose reason has just been removed. The market reads the form
  // figures; the excuse is the part it discounts.
  const comesRight = groundComesRight(today.ofr, history, race);
  if (comesRight.found) {
    push(signals, {
      key: "ground-comes-right",
      label: "Ground comes right off a falling mark",
      weight: weightFor("ground-comes-right", 0),
      detail: comesRight.detail,
    });
  }

  // A big run off today's mark. Only counted when the mark signal did not
  // already fire, so a horse is not paid twice for the same evidence.
  if (!mark.found) {
    const close = wentCloseOffSimilarMark(today.ofr, history, raceDate, race.raceType);
    if (close.found && close.best) {
      signals.push({
        key: "went-close",
        label: "Went close off this mark",
        weight: weightFor("went-close", close.lengths <= 1 ? 3 : 2),
        detail:
          `beaten ${close.lengths}L off ${close.best.ofr}` +
          `${close.markDiff > 0 ? ` (${close.markDiff}lb higher than today)` : ""} on ${close.best.raceDate}`,
      });
    }
  }

  const easy = wonMoreEasilyThanRaised(today.ofr, history, raceDate, race.raceType);
  if (easy.found) {
    signals.push({
      key: "won-easily",
      label: "Won by more than the handicapper took",
      weight: weightFor("won-easily", easy.surplus >= 8 ? 3 : 2),
      detail:
        `won by ${easy.margin}L (~${easy.marginLbs}lb) on ${easy.when}, ` +
        (easy.rise === 0
          ? `escapes a penalty — ${easy.surplus}lb in hand`
          : `raised only ${easy.rise}lb — ${easy.surplus}lb in hand`),
    });
  }

  const lastRun = lastRunReading(history, today.age);
  if (lastRun.signal) signals.push(lastRun.signal);

  const booking = significantBooking(today, history, jockeyStrikeRate);
  if (booking.found)
    signals.push({ key: "jockey", label: "Significant booking", weight: weightFor("jockey", 2), detail: booking.detail });

  if (today.headgearFirstTime)
    signals.push({ key: "headgear", label: "First-time headgear", weight: weightFor("headgear", 1), detail: "yard trying something" });
  if (today.windSurgeryFirstTime)
    signals.push({ key: "wind", label: "First run after wind surgery", weight: weightFor("wind", 1), detail: "" });

  // Draw bias. Flat only — there are no stalls over jumps — and only where a
  // stored impact value exists for this exact course, trip and going. The
  // bias reverses with the ground at several tracks (Thirsk 6f runs IV 1.61
  // for low draws on soft and 0.83 on good-firm), so a per-track number is
  // not good enough and a missing cell means no signal rather than a guess.
  const code = normaliseDiscipline(race.raceType);
  if (code === "flat") {
    const band = drawBandOf(today.draw ?? null, race.fieldSize ?? null);
    const dist = drawDistBand(race.distanceF);
    if (band && dist) {
      const iv = drawBias(race.courseSlug, dist, race.goingBand, band);
      if (iv !== null && iv >= 1.3)
        signals.push({
          key: "draw-good",
          label: "Favoured by the draw",
          weight: weightFor("draw-good", iv >= 1.5 ? 2 : 1),
          detail: `${band} draw here wins ${iv.toFixed(2)}x its share on ${race.goingBand}`,
        });
      else if (iv !== null && iv <= 0.85)
        signals.push({
          key: "draw-bad",
          label: "Wrong side of the draw",
          // Dan, 2026-08-28: "do you not need a high draw at Thirsk over 7f"
          //
          // Bobby Bennu was drawn 1 of 14 where a low draw wins 0.74x its
          // share, and nothing fired: the cut-off was 0.7 and it missed by four
          // hundredths. A 26% reduction in winning chance is not nothing, and a
          // hard edge either side of it made the signal binary where the effect
          // is continuous.
          weight: weightFor("draw-bad", iv <= 0.5 ? -3 : iv <= 0.7 ? -2 : -1),
          detail: `${band} draw here wins ${iv.toFixed(2)}x its share on ${race.goingBand}`,
        });
    }
  }

  // Pace: does this horse's habitual style suit this track and trip?
  //
  // Across 43 measured cells front-runners average an impact value of 2.12,
  // but that is measured after the event. Scoring it requires knowing the
  // horse USUALLY leads — and that this particular track rewards it. Southwell
  // and Wolverhampton beyond 1m4f punish front-runners (IV 0.72 and 0.86)
  // while Lingfield and Doncaster reward them heavily.
  const habit = habitualStyle(history);
  const paceDist = paceDistBand(race.distanceF);
  if (habit.style && paceDist && race.raceType) {
    const iv = paceBias(race.courseSlug, paceDist, race.raceType, habit.style);
    if (iv !== null && iv >= 1.6)
      signals.push({
        key: "pace-suits",
        label: "Run style suits this track",
        weight: weightFor("pace-suits", iv >= 2.2 ? 2 : 1),
        detail: `usually ${habit.style} (${habit.of} of last ${habit.from}); ${habit.style} wins ${iv.toFixed(2)}x here`,
      });
    else if (iv !== null && iv <= 0.9) {
      // Dan, 2026-08-28:
      //   "if the track is against the way a horse runs why would it make best
      //    bets?"
      //
      // Because the penalty was flat at -1 whatever the bias, while the reward
      // scaled. An impact value of 0.43 means that running style wins at 43%
      // of its expected rate at this track and trip — a structural handicap the
      // horse has to overcome before anything else counts — and it was being
      // charged the same as a 0.89, which is barely a bias at all.
      const severity =
        iv <= 0.5 ? -3 :
        iv <= 0.7 ? -2 : -1;

      signals.push({
        key: "pace-against",
        label: "Run style against this track",
        weight: weightFor("pace-against", severity),
        detail:
          `usually ${habit.style}; ${habit.style} wins only ${iv.toFixed(2)}x here` +
          (iv <= 0.5 ? " — a style this track rarely rewards" : ""),
      });
    }
  }

  const trainer = trainerFormSignal(
    today.trainer14Runs,
    today.trainer14Wins,
    today.trainer14Percent
  );
  if (trainer) signals.push(trainer);

  const layoff = layoffPenalty(today.daysSinceRun);
  if (layoff) signals.push(layoff);

  const drought = winDrought(history, raceDate);
  if (drought.signal) signals.push(drought.signal);

  // Negative signals can drag a score below zero; a tip is never a negative
  // number of points, it is simply not a tip.
  const score = Math.max(0, signals.reduce((sum, s) => sum + s.weight, 0));

  return {
    horseId: today.horseId,
    horseName: today.horseName,
    score,
    signals,
    excluded: false,
    exclusionReason: null,
    groundRecord: describeGround(history, race.goingBand),
  };
}

/**
 * Dan's ground rule, 2026-09-01, stated after seeing the backtest and holding
 * to it anyway:
 *
 *   "if a horse has never won or placed on soft or heavy it can't be picked.
 *    it's the same with horses that only won on soft or heavy and the ground
 *    is good/firm"
 *
 * A gate, not a minus — it removes the horse from the tips outright, the same
 * shape as the big-field and track-style gates.
 *
 * On the numbers this costs us: over Sep-Feb the group it excludes returned
 * +19.1% and the badly-beaten end of it +87.4%, so this is not an ROI
 * improvement and is not presented as one. It is Dan's editorial line on what
 * the site is willing to put its name to, and he took it with the measurement
 * in front of him.
 *
 * Deliberately narrow on both sides. "Soft or heavy" means those two bands
 * only — good-to-soft is not soft. "Good or firm" means good, good-to-firm and
 * firm. All-weather (standard) sits off the turf scale entirely and neither
 * half of the rule touches it.
 *
 * Returns the reason to set the horse aside, or null to let it through.
 */
const SOFTISH: GoingBand[] = ["soft", "heavy"];
const FIRMISH: GoingBand[] = ["good", "good-firm", "firm"];

export function groundGate(history: PastRun[], band: GoingBand): string | null {
  const pretty = (b: GoingBand) => String(b).replace("-", " to ");

  if (SOFTISH.includes(band)) {
    const on = history.filter((r) => SOFTISH.includes(r.goingBand) && r.positionNum !== null);
    const ok = on.some((r) => (r.positionNum ?? 99) <= 3);
    if (ok) return null;
    return on.length
      ? `${on.length} run${on.length === 1 ? "" : "s"} on soft or heavy, never won, never placed` +
        ` — and today is ${pretty(band)}`
      : `Never run on soft or heavy in ${history.length} start${history.length === 1 ? "" : "s"}` +
        ` — and today is ${pretty(band)}`;
  }

  if (FIRMISH.includes(band)) {
    const wins = history.filter((r) => r.positionNum === 1);
    if (!wins.length) return null;
    const allSoft = wins.every((r) => SOFTISH.includes(r.goingBand));
    if (!allSoft) return null;
    return `Every win (${wins.length}) has come on soft or heavy — and today is ${pretty(band)}`;
  }

  return null;
}

/** How far above the winning mark still counts as "a similar mark". */
const STREAK_MARK_TOLERANCE = 3;

/**
 * Dan's streak rule, 2026-09-08.
 *
 *   "I just don't want horses in the search that are on a 3-timer or more. If a
 *    horse won well and he runs off a similar mark as he won off then fine —
 *    but anything else I don't like and I wouldn't pick."
 *
 * So:
 *   - three wins in a row or more  -> out, no exceptions
 *   - one or two wins in a row     -> only if today's mark is within
 *                                     STREAK_MARK_TOLERANCE of the mark that
 *                                     run was won off
 *   - no win last time             -> unaffected
 *
 * A gate, not a weight, like the ground rule. Stated as a personal preference
 * and taken as one — he asked for it without wanting it measured first, and
 * that is his call to make about his own site.
 *
 * Marks never cross disciplines, so the comparison only uses wins in today's
 * code. A horse whose winning run was over hurdles has no comparable mark for a
 * chase, and an incomparable mark is treated as failing the test rather than
 * passing it by default — the rule is a preference for horses the handicapper
 * has not yet caught, and "we cannot tell" is not that.
 *
 * Returns the reason to set the horse aside, or null to let it through.
 */
export function streakGate(
  history: PastRun[],
  todayOfr: number | null,
  todayType: string | null
): string | null {
  let streak = 0;
  for (const r of history) {
    if (r.positionNum === 1) streak++;
    else break;
  }
  if (streak === 0) return null;

  // "Won its last one" is not English. A single win is "last time".
  const word = ["", "", "two", "three", "four", "five", "six"][streak] ?? String(streak);
  const ran = streak === 1 ? "Won last time" : `Won its last ${word}`;

  if (streak >= 3) {
    return `${ran} — a ${streak}-timer, and the handicapper has had ${streak} goes at it`;
  }

  const marks = history.slice(0, streak)
    .filter((r) => r.ofr !== null && sameDiscipline(r.raceType, todayType))
    .map((r) => r.ofr as number);

  if (!marks.length || todayOfr === null) {
    return `${ran}, and there is no comparable mark in this code to judge the rise`;
  }

  const wonOff = Math.min(...marks);
  const rise = todayOfr - wonOff;
  if (rise > STREAK_MARK_TOLERANCE) {
    return `${ran} off ${wonOff} and runs off ${todayOfr} — up ${rise}lb`;
  }
  return null;
}

/**
 * The record on today's ground in one line, for printing rather than scoring.
 *
 * Reads the band itself and the bands either side of it, because "soft" and
 * "heavy" are one notch apart and a horse beaten out of sight on soft tells
 * you plenty about its chance on heavy. The best finishing margin rides along:
 * beaten a length four times and beaten eleven lengths four times are the same
 * "0 wins 0 places" and completely different horses.
 */
export function describeGround(history: PastRun[], band: GoingBand): string {
  const exact = recordOn(history, band);
  const near = history.filter((r) => {
    const d = goingDistance(r.goingBand, band);
    return r.positionNum !== null && d !== null && d > 0 && d <= GOING_TOLERANCE;
  });
  const pretty = String(band).replace("-", " to ");

  const margin = (runs: PastRun[]) => {
    const ds = runs
      .map((r) => (r.positionNum === 1 ? 0 : Number(r.ovrBtn ?? NaN)))
      .filter((n) => Number.isFinite(n));
    return ds.length ? Math.min(...ds) : null;
  };

  if (exact.runs === 0 && near.length === 0)
    return history.length
      ? `Never run on ${pretty} or anything like it in ${history.length} starts`
      : `No form on ${pretty}`;

  const parts: string[] = [];
  if (exact.runs > 0) {
    const m = margin(history.filter((r) => r.goingBand === band && r.positionNum !== null));
    parts.push(
      `${exact.wins}w ${exact.placed}p from ${exact.runs} on ${pretty}` +
      (exact.wins === 0 && m !== null ? `, best beaten ${m}L` : "")
    );
  } else {
    parts.push(`never run on ${pretty}`);
  }

  if (near.length > 0) {
    const w = near.filter((r) => r.positionNum === 1).length;
    const pl = near.filter((r) => (r.positionNum ?? 99) <= 3).length;
    const m = margin(near);
    parts.push(
      `${w}w ${pl}p from ${near.length} on the ground either side` +
      (w === 0 && m !== null ? `, best beaten ${m}L` : "")
    );
  }
  return parts.join("; ");
}

/**
 * Is this horse well handicapped enough to put in front of Dan?
 *
 * The gate, not a score. Dan, 2026-08-27: "remember its flagging well
 * handicapped horses to me".
 *
 * The measurement said the mark angle does not predict winners by itself
 * (-0.6pp) — but that only matters if it is being asked to pick. Its job here
 * is to decide who appears on the list at all; the ranking and the judgement
 * happen afterwards. A filter and a predictor are different things.
 *
 * Any ONE of these qualifies:
 *   - racing below a mark it won off inside 18 months
 *   - its mark has been coming down across recent runs
 *   - it went close off a mark no lower than today's
 */
export interface HandicapCase {
  qualifies: boolean;
  /** Conditions today also match what it has won on. Dan's "perfect conditions". */
  prime: boolean;
  /** Well handicapped AND the ground that beat it has come right. */
  standout: boolean;
  standoutWhy: string;
  reasons: string[];
  /** Pounds of room, where that is measurable. */
  lbsInHand: number;
}

/**
 * How much room counts as well handicapped.
 *
 * The first version qualified on any evidence at all and passed 101 of 145
 * runners — 70% of the card, which is a list rather than a flag. A pound below
 * a winning mark is noise: the handicapper moves horses by that much routinely
 * and it says nothing.
 *
 * Three pounds is the floor for a real edge, and five with today's conditions
 * proven is Dan's "perfect conditions" case — the one the method exists to
 * catch.
 */
export const HANDICAP_MIN_LBS = 3;
export const HANDICAP_PRIME_LBS = 5;

export function wellHandicapped(
  today: HorseToday,
  race: RaceToday,
  history: PastRun[],
  raceDate: string
): HandicapCase {
  // Reasons carry their weight so the strongest can lead.
  //
  // They were previously pushed in a fixed order and the write-up printed the
  // first, which meant Box Clever led on "beaten 1 length off 68 on 27 July"
  // while the fact that it won its next start off the same mark, and was not
  // raised for it, went unmentioned. The order of the checks in this function
  // is not the order of their importance.
  const weighted: { text: string; lbs: number }[] = [];
  let lbs = 0;

  const mark = wonOffHigherMark(today.ofr, history, raceDate, race.raceType);
  if (mark.found) {
    weighted.push({
      text: `${mark.lbsBelow}lb below its ${mark.discipline ?? ""} winning mark of ${mark.lastWinningMark} (${mark.when})`,
      lbs: mark.lbsBelow,
    });
    lbs = Math.max(lbs, mark.lbsBelow);
  }

  const plot = campaignedImpossibly(history, 4, race.raceType, race.distanceF, race.goingBand);
  if (plot.found) {
    weighted.push({ text: plot.detail, lbs: plot.ofrDrop });
    lbs = Math.max(lbs, plot.ofrDrop);
  }

  const close = wentCloseOffSimilarMark(today.ofr, history, raceDate, race.raceType);
  if (close.found && close.best) {
    weighted.push({
      text:
        `beaten ${close.lengths}L off ${close.best.ofr}` +
        `${close.markDiff > 0 ? ` (${close.markDiff}lb higher than today)` : ""} on ${close.best.raceDate}`,
      lbs: Math.max(0, close.markDiff),
    });
    lbs = Math.max(lbs, Math.max(0, close.markDiff));
  }

  const easy = wonMoreEasilyThanRaised(today.ofr, history, raceDate, race.raceType);
  if (easy.found) {
    weighted.push({
      // Dan, 2026-08-28: "instead of raised 0lb we should say escapes a penalty"
      //
      // A horse that won and was not put up is running off a mark the
      // handicapper has yet to catch. "Raised 0lb" is how the arithmetic reads;
      // "escapes a penalty" is how racing says it.
      text:
        easy.rise === 0
          ? `won by ${easy.margin}L (~${easy.marginLbs}lb) and escapes a penalty — ${easy.surplus}lb in hand`
          : `won by ${easy.margin}L (~${easy.marginLbs}lb), raised ${easy.rise}lb — ${easy.surplus}lb in hand`,
      // A win the handicapper under-rated is the strongest evidence there is,
      // and it must never sit behind a beaten run from an earlier start.
      lbs: easy.surplus + 0.5,
    });
    lbs = Math.max(lbs, easy.surplus);
  }

  const reasons = weighted
    .sort((a, b) => b.lbs - a.lbs)
    .map((w) => w.text);

  const lbsInHand = Math.round(lbs * 10) / 10;

  // Conditions proven today: going, trip and course all inside its winning
  // profile. "The profit model is when we catch a horse in perfect conditions."
  const cond = likesConditions(race, history);
  const conditionsRight = cond.going && cond.trip;

  // The standout is a narrower thing than prime, and a different one. Prime
  // asks whether conditions suit. This asks whether the reason the mark fell
  // has just been removed — the horse is well in BECAUSE of runs that no
  // longer apply.
  const comesRight = groundComesRight(today.ofr, history, race);

  return {
    qualifies: lbsInHand >= HANDICAP_MIN_LBS,
    prime: lbsInHand >= HANDICAP_PRIME_LBS && conditionsRight,
    standout: lbsInHand >= HANDICAP_MIN_LBS && comesRight.found,
    standoutWhy: comesRight.detail,
    reasons,
    lbsInHand,
  };
}

/**
 * Star rating from a score.
 *
 * Deliberately a plain, inspectable mapping. It is a hypothesis until strike
 * rate and ROI by band are measured over a real sample — if 5-star selections
 * do not beat 3-star ones, this mapping is wrong, not the record.
 */
export function starsFromScore(score: number): number {
  if (score >= 11) return 5;
  if (score >= 8) return 4;
  if (score >= 6) return 3;
  if (score >= 4) return 2;
  return 1;
}
