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
}

export interface RaceToday {
  courseSlug: string;
  distanceF: number | null;
  goingBand: GoingBand;
  /** Today's discipline. Marks only compare within it. */
  raceType: string | null;
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

  let bestMark: number | null = null;
  let when: string | null = null;
  for (const r of winningRuns(history)) {
    if (r.ofr === null) continue;
    // Only wins inside the lookback window count. See MARK_LOOKBACK_MONTHS.
    if (monthsBetween(r.raceDate, today) > withinMonths) continue;
    // Marks never cross disciplines. See sameDiscipline().
    if (todayType && !sameDiscipline(r.raceType, todayType)) continue;
    if (bestMark === null || r.ofr > bestMark) {
      bestMark = r.ofr;
      when = r.raceDate;
    }
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
  todayType: string | null = null
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
        weight: 3,
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

  if (read.stayedOn) {
    return {
      signal: {
        key: "last-run-positive",
        label: young ? "Finishing well, and young enough to improve" : "Finishing well last time",
        weight: (young ? 3 : 2) + bonus,
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
        weight: bonus,
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
        weight: 2,
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
        weight: -1,
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
    return { key: "trainer-hot", label: "Yard in form", weight: 2, detail: `${percent}% — ${record}` };
  if (percent <= TRAINER_COLD_PCT)
    return { key: "trainer-cold", label: "Yard out of form", weight: -2, detail: `${percent}% — ${record}` };
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

  const mark = wonOffHigherMark(today.ofr, history, raceDate, race.raceType);
  if (mark.found)
    signals.push({
      key: "mark",
      label: "Well handicapped",
      // The bigger the drop the stronger the case, capped so a freak old mark
      // cannot dominate the score on its own.
      weight: Math.min(4, 1 + Math.floor(mark.lbsBelow / 4)),
      detail:
        `${mark.lbsBelow}lb below its ${mark.discipline ?? ""} winning mark of ` +
        `${mark.lastWinningMark} (${mark.when})`,
    });

  const plot = campaignedImpossibly(history, 4, race.raceType);
  if (plot.found)
    signals.push({ key: "plot", label: "Mark being dropped", weight: 3, detail: plot.detail });

  // A big run off today's mark. Only counted when the mark signal did not
  // already fire, so a horse is not paid twice for the same evidence.
  if (!mark.found) {
    const close = wentCloseOffSimilarMark(today.ofr, history, raceDate, race.raceType);
    if (close.found && close.best) {
      signals.push({
        key: "went-close",
        label: "Went close off this mark",
        weight: close.lengths <= 1 ? 3 : 2,
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
      weight: easy.surplus >= 8 ? 3 : 2,
      detail:
        `won by ${easy.margin}L (~${easy.marginLbs}lb) on ${easy.when}, ` +
        `raised only ${easy.rise}lb — ${easy.surplus}lb in hand`,
    });
  }

  const lastRun = lastRunReading(history, today.age);
  if (lastRun.signal) signals.push(lastRun.signal);

  const booking = significantBooking(today, history, jockeyStrikeRate);
  if (booking.found)
    signals.push({ key: "jockey", label: "Significant booking", weight: 2, detail: booking.detail });

  if (today.headgearFirstTime)
    signals.push({ key: "headgear", label: "First-time headgear", weight: 1, detail: "yard trying something" });
  if (today.windSurgeryFirstTime)
    signals.push({ key: "wind", label: "First run after wind surgery", weight: 1, detail: "" });

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
