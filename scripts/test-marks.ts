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

console.log("\nthe claim comes off the weight, so it goes back on first");
const apprentice = [
  { ofr: 70, weightLbs: 133, claim: 0 },
  { ofr: 68, weightLbs: 128, claim: 3 },   // claims 3: carries 128, allotted 131
  { ofr: 66, weightLbs: 124, claim: 5 },
  { ofr: 64, weightLbs: 120, claim: 7 },
  { ofr: 62, weightLbs: 125, claim: 0 },
];
ok("a claimer is not read as a stale mark", readMark(apprentice, apprentice[1]).drift, 0);
ok("and nor is the bigger claim", readMark(apprentice, apprentice[3]).drift, 0);

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
