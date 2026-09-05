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
  /** Days since the previous run. From `last_run` on the racecard. */
  daysSinceRun?: number | null;
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

/** Runs where the horse won — its proven conditions. */
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
  history: PastRun[],
  today: string,
  withinMonths: number = MARK_LOOKBACK_MONTHS
): { found: boolean; lbsBelow: number; lastWinningMark: number | null; when: string | null } {
  if (todayOfr === null) {
    return { found: false, lbsBelow: 0, lastWinningMark: null, when: null };
  }

  let bestMark: number | null = null;
  let when: string | null = null;
  for (const r of winningRuns(history)) {
    if (r.ofr === null) continue;
    // Only wins inside the lookback window count. See MARK_LOOKBACK_MONTHS.
    if (monthsBetween(r.raceDate, today) > withinMonths) continue;
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
      weight: -3,
      detail: `${history.length} runs, no win`,
    };
  } else if (monthsSinceWin !== null && monthsSinceWin >= 24 && !excused) {
    signal = {
      key: "drought",
      label: "Long time without a win",
      weight: -3,
      detail: `${runsSinceWin} runs and ${monthsSinceWin} months since it won`,
    };
  } else if (monthsSinceWin !== null && monthsSinceWin >= 24 && excused) {
    signal = {
      key: "drought-excused",
      label: "Winless, but off its ground",
      weight: 1,
      detail: `${offOptimalGoing} of ${since.length} runs since its win on going it has never won on`,
    };
  }

  return { runsSinceWin, monthsSinceWin, everWon, offOptimalGoing, excused, signal };
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
    return { key: "layoff", label: "Long absence", weight: -4, detail: `${days} days off — over a year` };
  if (days >= 180)
    return { key: "layoff", label: "Long absence", weight: -3, detail: `${days} days off` };
  if (days >= 120)
    return { key: "layoff", label: "Off the track a while", weight: -1, detail: `${days} days off` };
  if (days <= 5)
    return { key: "quick-turnaround", label: "Quick turnaround", weight: 0, detail: `ran ${days} days ago` };
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
  raceDate: string = new Date().toISOString().slice(0, 10)
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

  const mark = wonOffHigherMark(today.ofr, history, raceDate);
  if (mark.found)
    signals.push({
      key: "mark",
      label: "Well handicapped",
      // The bigger the drop the stronger the case, capped so a freak old mark
      // cannot dominate the score on its own.
      weight: Math.min(4, 1 + Math.floor(mark.lbsBelow / 4)),
      detail: `${mark.lbsBelow}lb below its winning mark of ${mark.lastWinningMark} (${mark.when})`,
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
