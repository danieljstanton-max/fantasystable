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

  // 2. No 2yo nurseries, no 3yo-only handicaps.
  if (isNursery(race)) {
    return { eligible: false, reason: "two-year-old-nursery", ...base };
  }
  if (race.ageBand === "3yo") {
    return { eligible: false, reason: "three-year-old-only", ...base };
  }

  // 3. Field size.
  if (runnerCount < MIN_RUNNERS) {
    return { eligible: false, reason: "small-field", ...base };
  }

  // 4. All-aged handicaps carrying too many 3yos.
  if (isAllAged(race.ageBand) && threeYearOlds > MAX_THREE_YEAR_OLDS) {
    return { eligible: false, reason: "too-many-three-year-olds", ...base };
  }

  return { eligible: true, reason: null, ...base };
}

export const REJECT_LABELS: Record<RejectReason, string> = {
  "not-a-handicap": "Not a handicap",
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
  /** Official rating the horse ran off that day. */
  ofr: number | null;
  fieldSize: number | null;
  jockeyId: string | null;
  comment: string | null;
}

export interface HorseToday {
  horseId: string;
  horseName: string;
  ofr: number | null;
  jockeyId: string | null;
  bestOddsDec: number | null;
  headgearFirstTime: boolean;
  windSurgeryFirstTime: boolean;
}

export interface RaceToday {
  courseSlug: string;
  distanceF: number | null;
  goingBand: GoingBand;
}

export interface Signal {
  key: string;
  label: string;
  weight: number;
  detail: string;
}

export interface HorseScore {
  horseId: string;
  horseName: string;
  score: number;
  signals: Signal[];
  /** Set when a hard negative applies and nothing excuses it. */
  excluded: boolean;
  exclusionReason: string | null;
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

/** Runs where the horse won or was placed — its proven conditions. */
function winningRuns(history: PastRun[]): PastRun[] {
  return history.filter((r) => r.positionNum !== null && r.positionNum === 1);
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
): { going: boolean; trip: boolean; course: boolean; courseWins: number } {
  const wins = winningRuns(history);

  const going = wins.some((r) => {
    const d = goingDistance(r.goingBand, today.goingBand);
    return d !== null ? d <= GOING_TOLERANCE : r.goingBand === today.goingBand;
  });

  const trip = wins.some(
    (r) =>
      r.distanceF !== null &&
      today.distanceF !== null &&
      Math.abs(r.distanceF - today.distanceF) <= TRIP_TOLERANCE_F
  );

  const courseWins = wins.filter((r) => r.courseSlug === today.courseSlug).length;

  return { going, trip, course: courseWins > 0, courseWins };
}

/**
 * Has the horse won off a mark higher than today's?
 *
 * This is the core of the method. The gap in pounds is the size of the edge:
 * "off a mark of 55, which is now 10lb below his last winning mark."
 */
export function wonOffHigherMark(
  todayOfr: number | null,
  history: PastRun[]
): { found: boolean; lbsBelow: number; lastWinningMark: number | null; when: string | null } {
  if (todayOfr === null) {
    return { found: false, lbsBelow: 0, lastWinningMark: null, when: null };
  }

  let bestMark: number | null = null;
  let when: string | null = null;
  for (const r of winningRuns(history)) {
    if (r.ofr === null) continue;
    if (bestMark === null || r.ofr > bestMark) {
      bestMark = r.ofr;
      when = r.raceDate;
    }
  }

  if (bestMark === null || bestMark <= todayOfr) {
    return { found: false, lbsBelow: 0, lastWinningMark: bestMark, when };
  }

  return { found: true, lbsBelow: bestMark - todayOfr, lastWinningMark: bestMark, when };
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
  lookback = 4
): { found: boolean; runsOutOfWindow: number; ofrDrop: number; detail: string } {
  const wins = winningRuns(history);
  const recent = history.slice(0, lookback);

  if (wins.length === 0 || recent.length < 2) {
    return { found: false, runsOutOfWindow: 0, ofrDrop: 0, detail: "" };
  }

  const provenTrips = wins.map((r) => r.distanceF).filter((d): d is number => d !== null);
  const provenGoing = wins.map((r) => r.goingBand);

  let outOfWindow = 0;
  const reasons: string[] = [];

  for (const r of recent) {
    const wrongTrip =
      r.distanceF !== null &&
      provenTrips.length > 0 &&
      provenTrips.every((t) => Math.abs(t - r.distanceF!) > TRIP_TOLERANCE_F * 3);

    const wrongGoing = provenGoing.every((g) => {
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
      ? `${outOfWindow} of the last ${recent.length} starts on the wrong ${reasons.join(" and ")}, mark down ${ofrDrop}lb`
      : "",
  };
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

  const sr = jockeyStrikeRate(jockeyId);
  const prevSr = lastRun?.jockeyId ? jockeyStrikeRate(lastRun.jockeyId) : null;

  const topTier = sr !== null && sr >= topTierThreshold;
  const upgrade = changed && sr !== null && prevSr !== null && sr > prevSr + 5;

  const bits: string[] = [];
  if (wonOnBefore) bits.push("has won on this horse before");
  if (upgrade) bits.push(`upgrade from a ${prevSr}% rider to ${sr}%`);
  else if (topTier && changed) bits.push(`${sr}% rider takes over`);
  else if (topTier) bits.push(`${sr}% rider retains the ride`);

  return {
    found: wonOnBefore || upgrade || topTier,
    changed,
    wonOnBefore,
    detail: bits.join(", "),
  };
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
  jockeyStrikeRate: (jockeyId: string) => number | null = () => null
): HorseScore {
  const signals: Signal[] = [];

  const cond = likesConditions(race, history);
  if (cond.going) signals.push({ key: "going", label: "Proven on the ground", weight: 2, detail: `won on ${race.goingBand}` });
  if (cond.trip) signals.push({ key: "trip", label: "Proven at the trip", weight: 2, detail: `won over ${race.distanceF}f` });
  if (cond.course)
    signals.push({
      key: "course",
      label: "Course winner",
      weight: cond.courseWins >= 3 ? 3 : 2,
      detail: `won here ${cond.courseWins} time${cond.courseWins === 1 ? "" : "s"}`,
    });

  const mark = wonOffHigherMark(today.ofr, history);
  if (mark.found)
    signals.push({
      key: "mark",
      label: "Well handicapped",
      // The bigger the drop the stronger the case, capped so a freak old mark
      // cannot dominate the score on its own.
      weight: Math.min(4, 1 + Math.floor(mark.lbsBelow / 4)),
      detail: `${mark.lbsBelow}lb below its last winning mark of ${mark.lastWinningMark}`,
    });

  const plot = campaignedImpossibly(history);
  if (plot.found)
    signals.push({ key: "plot", label: "Mark being dropped", weight: 3, detail: plot.detail });

  const booking = significantBooking(today, history, jockeyStrikeRate);
  if (booking.found)
    signals.push({ key: "jockey", label: "Significant booking", weight: 2, detail: booking.detail });

  if (today.headgearFirstTime)
    signals.push({ key: "headgear", label: "First-time headgear", weight: 1, detail: "yard trying something" });
  if (today.windSurgeryFirstTime)
    signals.push({ key: "wind", label: "First run after wind surgery", weight: 1, detail: "" });

  const score = signals.reduce((sum, s) => sum + s.weight, 0);

  return {
    horseId: today.horseId,
    horseName: today.horseName,
    score,
    signals,
    excluded: false,
    exclusionReason: null,
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
