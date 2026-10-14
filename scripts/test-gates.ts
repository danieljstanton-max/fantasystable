/**
 * Every rule bug we have shipped, as a test that fails if it comes back.
 *
 *   npm run test:gates
 *
 * No database, no API. Each case below is a real selection that reached the
 * live site, named and dated, with the behaviour Dan asked for. The point is
 * not coverage for its own sake: it is that a fixed bug stays fixed, which is
 * what stops this feeling endless.
 *
 * Dan, 2026-10-02: "these are silly mistakes that can't happen, I can't check
 * every race every day and when I do check I always see mistakes."
 */
import { markGate, groundGate, streakGate, type PastRun } from "../lib/selection";
import { readDraw, drawBandOf, drawDistBand, drawKey, drawPhrase, ANY_GOING } from "../lib/draw";
import { gateField } from "../lib/gates";
import type { Veto } from "../lib/vetoes";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ok    ${label}`);
  else { failures++; console.log(`  FAIL  ${label}\n          expected ${e}\n          actual   ${a}`); }
}
const fails = (x: string | null) => x !== null;

/** A past run, with only the fields a gate reads. */
function run(p: Partial<PastRun>): PastRun {
  return {
    raceDate: "2026-01-01", courseSlug: "x", distanceF: 8, goingBand: "good",
    positionNum: null, ofr: null, fieldSize: 10, jockeyId: null, comment: null,
    raceType: "Flat", ovrBtn: null, age: 5, ...p,
  };
}
const noVetoes = new Map<string, Veto>();

console.log("\nstreak rule — no 3-timers, a recent winner only off a similar mark");
check(
  "DONTLOOKANYFURTHER, 13:55 Ayr 2026-09-18: won last two, up 13lb — excluded",
  fails(streakGate(
    [run({ positionNum: 1, ofr: 78, raceDate: "2026-09-05" }),
     run({ positionNum: 1, ofr: null, raceDate: "2026-08-22" })], 91, "Flat")),
  true
);
check(
  "a winner off an unchanged mark is fine — IMPRESSOR, 17:02 Hamilton 2026-09-21",
  fails(streakGate([run({ positionNum: 1, ofr: 54 })], 54, "Flat")),
  false
);
check(
  "CASTLEMONT, 15:35 Newmarket 2026-09-25: two wins, no comparable mark — excluded",
  fails(streakGate(
    [run({ positionNum: 1, ofr: null }), run({ positionNum: 1, ofr: null })], 98, "Flat")),
  true
);
check(
  "a 3-timer is out whatever the marks say",
  fails(streakGate(
    [run({ positionNum: 1, ofr: 60 }), run({ positionNum: 1, ofr: 60 }),
     run({ positionNum: 1, ofr: 60 })], 60, "Flat")),
  true
);
check(
  "STELLARMASTERPIECE 2026-09-08: a Flat win must not be read against a Chase mark",
  fails(streakGate([run({ positionNum: 1, ofr: 63, raceType: "Flat" })], 93, "Chase")),
  true  // no comparable mark in this code, so excluded — never "30lb more"
);
check(
  "GONE IN SIXTY, 15:10 Warwick 2026-09-30: chase win off 76, chase mark 81 — up 5lb, out",
  fails(streakGate(
    [run({ positionNum: 1, ofr: 76, raceType: "Chase" }),
     run({ positionNum: 4, ofr: 82, raceType: "Hurdle" })], 81, "Chase")),
  true
);

console.log("\nground rule — on soft or heavy it must have won or placed on it");
check(
  "never placed on soft or heavy, running on heavy — excluded",
  fails(groundGate([run({ positionNum: 7, goingBand: "good" })], "heavy")),
  true
);
check(
  "placed on soft is enough",
  fails(groundGate([run({ positionNum: 3, goingBand: "soft" })], "heavy")),
  false
);
check(
  "all-weather is off the turf scale and untouched",
  fails(groundGate([run({ positionNum: 7, goingBand: "good" })], "standard")),
  false
);

console.log("\nthe gate over a whole field");
const field = [
  { id: "castlemont", name: "CASTLEMONT", ofr: 98, h: [run({ positionNum: 1, ofr: null }), run({ positionNum: 1, ofr: null })] },
  { id: "archers",    name: "ARCHERS BAY", ofr: 98, h: [run({ positionNum: 4, ofr: 95 })] },
];
const g = gateField(field, (x) => ({ horseId: x.id, horseName: x.name, ofr: x.ofr, history: x.h }),
  { goingBand: "good", raceType: "Flat" }, noVetoes);
check("2026-09-25 Newmarket: the clean horse in the race is found", g.cleared.map((x) => x.id), ["archers"]);
check("and the race counts as having a clean horse", g.anyClean, true);
check("the gated one is named with a reason", typeof g.reasonFor(field[0]), "string");

const vetoed = new Map<string, Veto>([
  ["IMPRESSOR", { date: "2026-09-21", horse: "IMPRESSOR", reason: "ran yesterday" }],
]);
const g2 = gateField(
  [{ id: "a", name: "IMPRESSOR", ofr: 54, h: [run({ positionNum: 4, ofr: 54 })] }],
  (x) => ({ horseId: x.id, horseName: x.name, ofr: x.ofr, history: x.h }),
  { goingBand: "good", raceType: "Flat" }, vetoed
);
check("2026-09-20: a hand veto removes the horse everywhere", g2.cleared.length, 0);
check("and the veto's own words are the reason given", g2.reasonFor({ id: "a", name: "IMPRESSOR", ofr: 54, h: [] }), "ran yesterday");

console.log("\nthe mark gate — above what it last won off");
{
  const r = (ofr: number, pos: number, type = "Flat") =>
    run({ ofr, positionNum: pos, raceType: type });

  // WYLE COP, 5 October: won off 67 in August, ran off 79.
  check("a handicapper 12lb above its winning mark is stopped",
    markGate([r(67, 1)], 79, "Flat", "Whatever Handicap Stakes") !== null, true);
  check("and the reason names the mark it won off",
    String(markGate([r(67, 1)], 79, "Flat", "A Handicap")).includes("67"), true);

  check("level with its winning mark passes",
    markGate([r(79, 1)], 79, "Flat", "A Handicap"), null);
  check("below it passes",
    markGate([r(79, 1)], 75, "Flat", "A Handicap"), null);

  // KING'S SCHOLAR, 9 October: a novices' hurdle is not run off the mark.
  check("a non-handicap is never stopped",
    markGate([r(120, 1, "Hurdle")], 123, "Hurdle", "Novices Hurdle Race"), null);

  check("a hurdle win does not judge a chase mark",
    markGate([r(100, 1, "Hurdle")], 120, "Chase", "A Handicap Chase"), null);

  check("no win on record is unassessable, not stopped",
    markGate([r(70, 4)], 90, "Flat", "A Handicap"), null);
}


console.log("\ndraw lookup — three levels, and a pooled figure never claims today's ground");
{
  // IT'S ALL ABOUT YOU, 15:39 Nottingham 2026-10-14, drawn 6 of 11 in the
  // Colwick Cup over 2m on good to soft. Nottingham beyond 1m4f holds 126
  // races over good, good to firm and soft and nothing on good to soft, so a
  // two-level lookup returned "no draw data for this course and trip" and the
  // funnel's draw test could not fire on a Flat handicap about to be advised.
  const NOTT = "nottingham";
  const map = new Map<string, number>([
    [drawKey(NOTT, "beyond 1m4f", "good", "mid"), 1.22],
    [drawKey(NOTT, "beyond 1m4f", "soft", "mid"), 0.67],
    [drawKey(NOTT, "beyond 1m4f", ANY_GOING, "mid"), 1.06],
    [drawKey("thirsk", "7f", "good", "low"), 1.40],
  ]);
  const colwick = {
    courseSlug: NOTT, distanceF: 16, draw: 6, fieldSize: 11,
    projected: "good-soft", declared: "good-soft",
  };

  check("the stall is read as a position in the field, not a number",
    [drawBandOf(1, 11), drawBandOf(6, 11), drawBandOf(11, 11)], ["low", "mid", "high"]);
  check("16f buckets to beyond 1m4f", drawDistBand(16), "beyond 1m4f");

  const pooled = readDraw(map, colwick);
  check("Colwick Cup: no good-to-soft row, so the pooled trip figure answers",
    [pooled.iv, pooled.pooled], [1.06, true]);
  check("and it does not claim to have been measured on a going",
    pooled.goingBand, null);
  check("so the prose says what it actually measured",
    drawPhrase(pooled), "1.06x its share here over this trip, across all goings");

  // The pooled row is a floor, never a substitute. Where we hold the ground,
  // the ground wins — Catterick flipping low-to-high as it rains is the whole
  // reason the table is split by going.
  const onGoing = readDraw(map, { ...colwick, projected: "soft", declared: "soft" });
  check("where we hold today's ground, the pooled row is not used",
    [onGoing.iv, onGoing.pooled, onGoing.goingBand], [0.67, false, "soft"]);
  check("and that figure is printed against the going it was measured on",
    drawPhrase(onGoing), "0.67x its share here on soft");

  // 17:17 Redcar, 2026-09-23: declared good to firm, projected to dry to good.
  // The table holds good and not good-firm, and the projection is what the
  // race is run on.
  check("the projected going is preferred to the declared one",
    readDraw(map, { ...colwick, projected: "good", declared: "good-soft" }).iv, 1.22);
  check("and the declared going is still tried before pooling",
    readDraw(map, { ...colwick, projected: "firm", declared: "soft" }).iv, 0.67);

  // Under six runners the three-way split means nothing, so nothing is offered
  // rather than a figure read off a band that does not exist.
  check("a five-runner field gets no draw figure at all",
    readDraw(map, { ...colwick, fieldSize: 5 }).iv, null);
  check("a jumps runner with no stall gets none either",
    readDraw(map, { ...colwick, draw: null }).iv, null);
  check("a course and trip we hold nothing for still returns null",
    readDraw(map, { ...colwick, courseSlug: "ffos-las" }).iv, null);
  check("no figure means no phrase, not a 0.00x claim",
    drawPhrase({ iv: null, goingBand: null, pooled: false }), null);
}

console.log(failures === 0 ? "\nAll gate checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
