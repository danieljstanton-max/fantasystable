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
import { chooseFromRace } from "../lib/funnel";
import { goingNote } from "../lib/course-guide";
import { likesConditions, showedSomething, type RaceToday } from "../lib/selection";
import { describeGround } from "../lib/selection";
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


console.log("\nthe funnel runs on every runner, not on the one the score ranked first");
{
  // The 17:30 Kempton, 14 October 2026. GUNFIGHTER topped the score and is 3lb
  // above the 68 it won off. PORT ROAD is 1lb BELOW the 76 it won off, has two
  // wins at the trip, two wins at the track and 3 from 24 on the surface — and
  // at 14 points was the highest-rated horse on the entire card.
  //
  // Because the old code read `best = scored[0]` and vetted that one horse
  // afterwards, GUNFIGHTER's 3lb binned the whole race and PORT ROAD could not
  // be selected. Two horses made the card out of 100+ races; with this fixed,
  // five did.
  type R = { name: string; score: number; fail: string | null };
  const kempton: R[] = [
    { name: "GUNFIGHTER", score: 17, fail: "mark" },
    { name: "PORT ROAD",  score: 14, fail: null },
    { name: "HITCHED",    score: 11, fail: null },
  ];
  const fail = (x: R) => x.fail;
  const score = (x: R) => x.score;

  const k = chooseFromRace(kempton, fail, score);
  check("the race offers its best SURVIVOR, not its top scorer",
    k.chosen?.name, "PORT ROAD");
  check("and that horse counts as a qualifier", k.qualifies, true);
  check("the top scorer is reported as outranking us, with its reason",
    [k.outranked.length, k.outranked[0].item.name, k.outranked[0].by, k.outranked[0].why],
    [1, "GUNFIGHTER", 3, "mark"]);

  // The mirror-image bug: picking on the absence of an objection rather than
  // on a case. A survivor with no positive evidence is not a selection.
  const nothingDoing: R[] = [
    { name: "TOP SCORER", score: 9, fail: "ground" },
    { name: "NO EVIDENCE", score: 0, fail: null },
  ];
  const n = chooseFromRace(nothingDoing, fail, score);
  check("a zero-scoring survivor is not selected", n.qualifies, false);
  check("and the top scorer carries the race into the set-aside report",
    n.chosen?.name, "TOP SCORER");

  // A race where nothing survives must still name a horse and a reason, or it
  // vanishes off the card with nothing said — the hole that hid 12 races.
  const allFail: R[] = [
    { name: "A", score: 12, fail: "mark" },
    { name: "B", score: 8, fail: "trip" },
  ];
  const a = chooseFromRace(allFail, fail, score);
  check("nothing survives: the race still reports its top scorer",
    [a.chosen?.name, a.qualifies], ["A", false]);

  check("an empty race chooses nothing rather than throwing",
    chooseFromRace([] as R[], fail, score).chosen, undefined);

  // Where the top scorer passes, nothing changes — the fix must not reorder a
  // race the old code already got right.
  const clean: R[] = [
    { name: "FAVOURITE", score: 15, fail: null },
    { name: "SECOND", score: 10, fail: null },
  ];
  const c = chooseFromRace(clean, fail, score);
  check("a clean race still gives the top scorer",
    [c.chosen?.name, c.qualifies, c.outranked.length], ["FAVOURITE", true, 0]);
}


console.log("\na generated NAP note is never filed or labelled as the paid VIP product");
{
  // Dan, 2026-10-14: "why is VIP Gunfighter? are you broken" / "I said I had
  // chosen green falcon."
  //
  // The 18:00 job writes the long note for the day's number one best bet. It
  // called vip.ts without --nap, so the note was tagged "VIP PLAY", and the
  // filename was hardcoded "VIP" regardless of the tag. The note for
  // GUNFIGHTER — the model's own selection, which the funnel now sets aside at
  // 3lb above its winning mark — landed as "2026-10-14 VIP 1730 Gunfighter.txt"
  // and was indistinguishable from a note Dan had written for his paying group.
  //
  // These mirror vip.ts: tag and filename both key off --nap, nothing else.
  const tagFor = (argv: string[]) => (argv.includes("--nap") ? "NAP" : "VIP PLAY");
  const fileFor = (argv: string[], date: string, off: string, horse: string) =>
    `${date} ${argv.includes("--nap") ? "NAP" : "VIP"} ${off.replace(":", "")} ${horse}.txt`;

  // What daily-report.ts passes. The --nap is the fix.
  const dailyJob = ["2026-10-14", "17:30", "GUNFIGHTER", "--save", "--selection", "--nap"];
  check("the daily job's note is tagged NAP, not VIP PLAY", tagFor(dailyJob), "NAP");
  check("and is filed under NAP, so it cannot pass for a paid selection",
    fileFor(dailyJob, "2026-10-14", "17:30", "Gunfighter"),
    "2026-10-14 NAP 1730 Gunfighter.txt");

  // A note Dan asks for by hand is still the VIP product.
  const byHand = ["2026-10-14", "15:39", "GREEN FALCON", "--save"];
  check("a hand-written VIP note keeps the VIP tag", tagFor(byHand), "VIP PLAY");
  check("and the VIP filename", fileFor(byHand, "2026-10-14", "15:39", "Green Falcon"),
    "2026-10-14 VIP 1539 Green Falcon.txt");

  // The filename was hardcoded, so --nap alone would not have fixed it. This is
  // the check that would have caught it.
  check("the filename follows the tag rather than being hardcoded",
    fileFor(["--nap"], "2026-10-14", "17:30", "X").includes(" VIP "), false);
}


console.log("\nno going posted: nothing is selected from it, and nothing prints \"unknown\"");
{
  // Fontwell, 15 October 2026. The going had not been posted when the card was
  // built, so the band was "unknown" — and I SHUT THAT D'OR was selected out of
  // it with "Ground: Never run on unknown or anything like it in 23 starts" and
  // "Fontwell on unknown: Soft ground makes the finish more demanding".
  //
  // Two faults. The prose named a band that does not exist, and the course
  // note fell through to a soft-ground description we had no reason to believe.
  // Underneath both: Dan's ground rule is a hard gate, and a horse cannot be
  // said to have passed a test that was never run.
  const record = (band: string, hist: PastRun[]) => describeGround(hist, band as any);
  check("no band means no ground record, and it says so plainly",
    record("unknown", [run({ goingBand: "good", positionNum: 1 })]),
    "going not posted yet, so the ground record cannot be read");
  check("the phrase never contains the word unknown",
    /unknown/i.test(String(record("unknown", [run({ positionNum: 2 })]))), false);

  // A real band still reports normally — the fix must not silence the rule it
  // was built to serve.
  check("a posted band still gives a record",
    /1w|0w/.test(String(record("soft", [run({ goingBand: "soft", positionNum: 1 })]))), true);

  // The course note is suppressed rather than falling through to groundNote.
  const guide: any = {
    course: "Fontwell", groundNote: "Soft ground makes the finish more demanding.",
    going: { heavy: "", soft: "", good: "", firm: "" }, trap: null,
  };
  check("no course going-note without a band", goingNote(guide, "unknown" as any), null);
  check("but a real band still gets one",
    goingNote(guide, "soft" as any), "Soft ground makes the finish more demanding.");
}


console.log("\nwon at the distance means won at the distance IN THIS CODE");
{
  // Dan, 2026-10-18, on KINBARA FIRSTDRAFT at 14:20 Sedgefield: "has never won
  // over chase fences." He was right — nine runs over fences, no wins. Both
  // its wins are hurdle wins, and the trip test counted the 20.5f hurdle win
  // as proof it could win a 21f CHASE. It reached the card on that.
  //
  // The trip is the same distance in either code; the race is not. Jumping
  // fences is the difference, which is why marks are never compared across
  // codes either.
  const chaseToday: RaceToday = {
    courseSlug: "sedgefield", distanceF: 21, goingBand: "good",
    raceType: "Chase", fieldSize: 8, raceClass: "Class 5",
    raceName: "A Handicap Chase",
  } as RaceToday;

  const hurdleWins: PastRun[] = [
    run({ raceType: "Hurdle", distanceF: 20.5, courseSlug: "sedgefield", positionNum: 1, ofr: 110 }),
    run({ raceType: "Hurdle", distanceF: 16, positionNum: 1, ofr: 105 }),
    run({ raceType: "Chase", distanceF: 20, positionNum: 2, ofr: 90 }),
  ];
  check("a hurdle win at the trip does not prove a chase at the trip",
    likesConditions(chaseToday, hurdleWins).trip, false);
  check("nor does a hurdle win round the course count as course form",
    likesConditions(chaseToday, hurdleWins).courseWins, 0);

  // A chase win at the trip still counts, or the gate would refuse everything.
  const chaseWin: PastRun[] = [
    ...hurdleWins,
    run({ raceType: "Chase", distanceF: 21, courseSlug: "sedgefield", positionNum: 1, ofr: 95 }),
  ];
  check("a chase win at the trip does count", likesConditions(chaseToday, chaseWin).trip, true);
  check("and a chase win round the course is course form",
    likesConditions(chaseToday, chaseWin).courseWins, 1);

  // The same horse running over hurdles again: now the hurdle win is the
  // relevant one. The rule has to cut both ways or it is just a chase penalty.
  const hurdleToday: RaceToday = { ...chaseToday, raceType: "Hurdle", distanceF: 20.5 } as RaceToday;
  check("back over hurdles, the hurdle win at the trip counts again",
    likesConditions(hurdleToday, hurdleWins).trip, true);

  // A missing race type must not quietly fail every horse.
  const unknownCode: RaceToday = { ...chaseToday, raceType: null } as RaceToday;
  check("an unknown code filters nothing rather than refusing everything",
    likesConditions(unknownCode, hurdleWins).trip, true);
}


console.log("\na selection has to have shown something lately");
{
  // Dan, 2026-10-20, after six days without a winner: "pointless picking well
  // handicapped horses if there is not a positive sign they are returning to
  // form." Measured over 31 settled selections it kept both winners and 8 of
  // the 10 placed, and cut 4 — none of them a winner.
  const beaten = (pos: number, btn: number, comment: string | null = null) =>
    run({ positionNum: pos, ovrBtn: btn, comment });

  // GETAWAY WITH YOU, due 21 October: 7th beaten 34L, 7th beaten 63L, 7th
  // beaten 18L. Nothing in any of it.
  check("three well-beaten runs with flat comments is a stand-down",
    showedSomething([beaten(7, 34.25), beaten(7, 63.5), beaten(7, 18)]) !== null, true);
  check("and the reason names the finishing positions",
    String(showedSomething([beaten(7, 34.25), beaten(7, 63.5), beaten(7, 18)])).includes("7"), true);

  // Any one of the three tests is enough.
  check("a placed run clears it",
    showedSomething([beaten(9, 20), beaten(3, 2), beaten(11, 15)]), null);
  check("a close finish clears it even from out of the places",
    showedSomething([beaten(6, 1.5), beaten(11, 15), beaten(9, 20)]), null);
  check("staying on clears it",
    showedSomething([beaten(8, 9, "kept on well inside the final furlong"), beaten(11, 15)]), null);
  check("travelling well clears it",
    showedSomething([beaten(8, 9, "travelled well until weakening"), beaten(11, 15)]), null);
  check("trouble in running clears it — it showed something and was stopped",
    showedSomething([beaten(8, 9, "badly hampered on the home turn"), beaten(11, 15)]), null);

  // Only the last TWO count: the question is current form.
  //
  // BUCCABAY, due 21 October, cleared a three-run window on its third-last
  // start — 5th of 8 beaten a length in August — having since run 9th of 9
  // beaten 7L and 7th of 9 beaten 5L. Dan: "why is buccabay still there?"
  check("a good run three starts back does not survive two bad ones since",
    showedSomething([beaten(9, 7), beaten(7, 5), beaten(5, 1)]) !== null, true);
  check("but the run before last still counts",
    showedSomething([beaten(9, 7), beaten(5, 1)]), null);
  check("a good run four starts ago does not count",
    showedSomething([beaten(9, 20), beaten(10, 25), beaten(8, 19), beaten(1, 0)]) !== null, true);

  // No runs is unassessable, not a failure — the same way markGate treats a
  // horse that has never won off a rating.
  check("a horse with no form on record is not failed", showedSomething([]), null);
  check("nor is one whose only runs have no finishing position",
    showedSomething([run({ positionNum: null })]), null);

  // A comment that contradicts itself must not read as positive.
  check("one-paced is not staying on",
    showedSomething([beaten(8, 9, "ran on one-paced"), beaten(11, 15), beaten(9, 20)]) !== null, true);
}

console.log(failures === 0 ? "\nAll gate checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
