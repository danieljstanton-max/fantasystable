/**
 * The weight-derived mark, against the cases that caused it.
 *
 *   npm run test:marks
 */
import { readMark, fieldOffset, isMixedAge, ageMissing } from "../lib/marks";

let pass = 0, fail = 0;
function ok(name: string, got: unknown, want: unknown) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${same ? "ok  " : "FAIL"}  ${name}${same ? "" : `\n          got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  same ? pass++ : fail++;
}

// 8 October, 20:30 Southwell. NOSTRUM won off 80 five days earlier, was raised
// 5lb, and went into this card still published as 80 on 143lb — top weight.
const southwell = [
  { ofr: 80, weightLbs: 143, claim: 0 },   // Nostrum: stale by 5lb
  { ofr: 82, weightLbs: 140, claim: 0 },
  { ofr: 78, weightLbs: 136, claim: 0 },
  { ofr: 77, weightLbs: 135, claim: 0 },
  { ofr: 77, weightLbs: 135, claim: 0 },
  { ofr: 72, weightLbs: 130, claim: 0 },
  { ofr: 72, weightLbs: 130, claim: 0 },
  { ofr: 69, weightLbs: 127, claim: 0 },
  { ofr: 67, weightLbs: 125, claim: 0 },
];

console.log("\nthe horse that was raised for winning");
ok("the field's line is found", fieldOffset(southwell), 58);
ok("NOSTRUM reads 85, not 80", readMark(southwell, southwell[0]),
   { published: 80, effective: 85, drift: 5 });
ok("a horse on the line is unchanged", readMark(southwell, southwell[1]),
   { published: 82, effective: 82, drift: 0 });

// 8 October, 15:30 Ayr. PARISIAC is allotted 128 off 75 like everyone else on
// the line; his rider claims 3. Adding the claim back invented a 3lb rise on
// the one runner in the field who had one. Dan: "parisiac runs off 75."
console.log("\nthe claim is already out of the allotted weight");
const ayr = [
  { ofr: 87, weightLbs: 140, claim: 0 },
  { ofr: 85, weightLbs: 138, claim: 0 },
  { ofr: 79, weightLbs: 132, claim: 0 },
  { ofr: 77, weightLbs: 130, claim: 0 },
  { ofr: 75, weightLbs: 128, claim: 3 },   // Parisiac
  { ofr: 74, weightLbs: 127, claim: 0 },
  { ofr: 71, weightLbs: 124, claim: 0 },
];
ok("PARISIAC stays on 75", readMark(ayr, ayr[4]), { published: 75, effective: 75, drift: 0 });
ok("the claim does not move the line", fieldOffset(ayr), 53);

console.log("\na pound off the line is the long handicap, not a reassessment");
const longHandicap = [
  { ofr: 87, weightLbs: 140, claim: 0 },
  { ofr: 85, weightLbs: 138, claim: 0 },
  { ofr: 79, weightLbs: 132, claim: 0 },
  { ofr: 79, weightLbs: 131, claim: 0 },   // 1lb off
  { ofr: 77, weightLbs: 130, claim: 0 },
  { ofr: 76, weightLbs: 128, claim: 0 },   // 1lb off
];
ok("1lb is not reported", readMark(longHandicap, longHandicap[3]).drift, 0);

console.log("\nwhen the field does not agree, say nothing");
const muddle = [
  { ofr: 70, weightLbs: 133, claim: 0 },
  { ofr: 68, weightLbs: 140, claim: 0 },
  { ofr: 66, weightLbs: 120, claim: 0 },
  { ofr: 64, weightLbs: 155, claim: 0 },
  { ofr: 62, weightLbs: 111, claim: 0 },
];
ok("no line, no effective mark", readMark(muddle, muddle[0]).effective, null);
ok("and the published mark still stands", readMark(muddle, muddle[0]).published, 70);

console.log("\nmissing data is not a drift");
ok("no weight means no answer", readMark(southwell, { ofr: 80, weightLbs: null }).effective, null);
ok("too few runners to read", fieldOffset(southwell.slice(0, 3)), null);


console.log("\nweight-for-age is not a reassessment");
// 16 October 2026, 14:17 Haydock, a 3yo+ handicap over a mile. Every
// three-year-old carried 3lb less than its rating implies; every older horse
// carried exactly what it implies. That 3lb is the weight-for-age allowance.
//
// Read as one line across the whole field, the older majority sets the
// baseline and every three-year-old looks reassessed. MONOCEROS came down from
// 84 to 81, which made it LEVEL with the 81 it won off on 5 September instead
// of 3lb above it — so markGate let it through and it was NAP on tomorrow's
// card. The error runs one way, always flattering the younger horse, which is
// the exact shape the method hunts for.
const haydock = [
  { ofr: 85, weightLbs: 133, claim: 0, age: 3 },   // Viper
  { ofr: 84, weightLbs: 132, claim: 0, age: 3 },   // Monoceros
  { ofr: 83, weightLbs: 131, claim: 0, age: 3 },   // Food For Thought
  { ofr: 84, weightLbs: 135, claim: 0, age: 4 },
  { ofr: 89, weightLbs: 140, claim: 0, age: 5 },
  { ofr: 86, weightLbs: 137, claim: 0, age: 5 },
  { ofr: 84, weightLbs: 135, claim: 0, age: 5 },
  { ofr: 84, weightLbs: 135, claim: 0, age: 6 },
  { ofr: 78, weightLbs: 129, claim: 0, age: 7 },
  { ofr: 75, weightLbs: 126, claim: 0, age: 8 },
];
const monoceros = haydock[1];

ok("the field is recognised as mixed-age", isMixedAge(haydock), true);
ok("a three-year-old keeps the mark the racecard gives it",
   readMark(haydock, monoceros).effective, 84);
ok("and is reported as no drift, not a 3lb reassessment",
   readMark(haydock, monoceros).drift, 0);
ok("every three-year-old in the race, not just the one",
   haydock.filter((r) => r.age === 3).map((r) => readMark(haydock, r).effective),
   [85, 84, 83]);
ok("the older horses are unaffected",
   haydock.filter((r) => (r.age ?? 0) >= 4).map((r) => readMark(haydock, r).effective),
   [84, 89, 86, 84, 84, 78, 75]);
ok("each age group is read against its own line",
   [fieldOffset(haydock, 3), fieldOffset(haydock, 5)], [48, 51]);

// The fix must not blind the module to a real reassessment inside an age group.
const reassessedThreeYearOld = [
  ...haydock,
  { ofr: 80, weightLbs: 131, claim: 0, age: 3 },   // carries 3lb more than an 80 should
];
ok("a genuine reassessment inside an age group is still caught",
   readMark(reassessedThreeYearOld, reassessedThreeYearOld[10]).drift, 3);

// An age-restricted race has one line and must behave exactly as before.
const allSameAge = southwell.map((r) => ({ ...r, age: 4 }));
ok("an age-restricted race still reads one line",
   readMark(allSameAge, allSameAge[0]).drift, 5);
ok("and is not treated as mixed-age", isMixedAge(allSameAge), false);

// Ages absent is a fault for anything that publishes, not a shrug: without
// them this falls back to one line for the whole field, which is the bug.
ok("a field with no ages at all is reported", ageMissing(southwell), true);
ok("a field with ages is not", ageMissing(haydock), false);


console.log("\nan age group of one cannot establish an allowance");
// 17:00 Southwell, 19 October 2026, a 4yo+ apprentice handicap. Every runner
// sat on offset 75 except DISTILLATE on 80. It won off 47 four days earlier
// and had been put up 5lb: the weights carried the new figure, the rating
// field had not caught up.
//
// It is the only six-year-old in the race. Reading its own weight as its age
// group's line found no drift and let a 5lb rise through — on a horse whose
// recent win is exactly what the method hunts for. Weight-for-age is nil for
// four-year-olds and up by October, which is why every other age agreed.
const southwellApprentice = [
  { ofr: 60, weightLbs: 135, claim: 0, age: 7 },
  { ofr: 60, weightLbs: 135, claim: 0, age: 5 },
  { ofr: 60, weightLbs: 135, claim: 0, age: 4 },
  { ofr: 59, weightLbs: 134, claim: 0, age: 4 },
  { ofr: 59, weightLbs: 134, claim: 0, age: 4 },
  { ofr: 57, weightLbs: 132, claim: 0, age: 4 },
  { ofr: 55, weightLbs: 130, claim: 0, age: 5 },
  { ofr: 53, weightLbs: 128, claim: 0, age: 4 },
  { ofr: 47, weightLbs: 127, claim: 0, age: 6 },   // Distillate: 5lb out, alone at 6
  { ofr: 50, weightLbs: 125, claim: 0, age: 5 },
];
const distillate = southwellApprentice[8];

ok("the lone six-year-old is read against the field, not against itself",
   readMark(southwellApprentice, distillate).effective, 52);
ok("so the 5lb rise is reported", readMark(southwellApprentice, distillate).drift, 5);
ok("and the rest of the field is untouched",
   southwellApprentice.filter((r) => r !== distillate).map((r) => readMark(southwellApprentice, r).drift),
   [0, 0, 0, 0, 0, 0, 0, 0, 0]);

// The Haydock guard must survive: three three-year-olds sharing an allowance
// still set their own line.
ok("two or more sharing an age still set their own line",
   readMark(haydock, monoceros).effective, 84);
ok("and a lone older horse in that race is still read against the field",
   readMark(haydock, haydock[3]).drift, 0);

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exit(fail ? 1 : 0);
