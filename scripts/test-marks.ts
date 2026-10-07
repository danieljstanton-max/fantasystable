/**
 * The weight-derived mark, against the cases that caused it.
 *
 *   npm run test:marks
 */
import { readMark, fieldOffset } from "../lib/marks";

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

console.log(`\n${fail ? `${fail} FAILED, ` : ""}${pass} passed\n`);
process.exit(fail ? 1 : 0);
