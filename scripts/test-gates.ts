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
import { groundGate, streakGate, type PastRun } from "../lib/selection";
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

console.log(failures === 0 ? "\nAll gate checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
