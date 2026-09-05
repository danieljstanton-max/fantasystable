/**
 * Form-comment reading, checked against real comments from probe-output.
 *
 *   npm run test:form
 */
import { readFileSync, existsSync } from "node:fs";
import { readComment, excuseUnproven, racePaceShape } from "../lib/form-reading";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ok    ${label}`);
  else { fails++; console.log(`  FAIL  ${label}\n          expected ${e}\n          actual   ${a}`); }
}

console.log("\nrun style");
check("goes straight to front -> led",
  readComment("Went straight to the front and dictated a fast gallop").runStyle, "led");
check("held up -> held-up",
  readComment("Held up towards the back - stumbled").runStyle, "held-up");
check("handy -> prominent",
  readComment("Handy in the pack early - closed on the front group").runStyle, "prominent");
check("mid-division -> midfield",
  readComment("Settled in mid-division - lost place from 3 out").runStyle, "midfield");
check("empty comment -> null", readComment("").runStyle, null);
check("undefined -> null", readComment(undefined).runStyle, null);

console.log("\nfinishing verdict — order in the narrative decides it");
check("stayed on at the finish",
  (({stayedOn,failedToStay}) => ({stayedOn,failedToStay}))(
    readComment("Lost ground into the last three furlongs and pushed along with two to go - stayed on well")),
  { stayedOn: true, failedToStay: false });
check("dropped away at the finish",
  (({stayedOn,failedToStay}) => ({stayedOn,failedToStay}))(
    readComment("Closed on front group two furlongs out - dropped away before the last")),
  { stayedOn: false, failedToStay: true });

console.log("\ntrouble in running");
check("no room is trouble", readComment("Headway 2f out - short of room inside final furlong").trouble, true);
check("clean run is not", readComment("Led throughout and won comfortably").trouble, false);

console.log("\nnon-completion");
check("unseated", readComment("Held up towards the back - stumbled and lost rider 3rd").nonCompletion, true);
check("pulled up", readComment("Dropped away with no chance and eased - pulled up before the 11th").nonCompletion, true);

console.log("\nexcuseUnproven — Dan's override");
check("staying on excuses an unproven trip",
  excuseUnproven(["Kept on well inside the final furlong", "Dropped away tamely"]).reason, "stayed-on");
check("blocked run excuses a bad position",
  excuseUnproven(["Denied a clear run inside the final furlong"]).reason, "trouble-in-running");
check("nothing to excuse",
  excuseUnproven(["Never travelling, weakened 3f out"]).excused, false);
check("a faller tells us nothing",
  excuseUnproven(["Held up, fell 3rd"]).excused, false);
check("staying on outranks trouble",
  excuseUnproven(["Short of room 2f out", "Stayed on strongly"]).reason, "stayed-on");

console.log("\npace shape");
check("lone leader", racePaceShape(["led","held-up","held-up","midfield","prominent"]).verdict, "lone-leader");
check("collapse likely", racePaceShape(["led","led","led","held-up","midfield"]).verdict, "collapse-likely");
check("contested", racePaceShape(["led","led","held-up","midfield"]).verdict, "contested");
check("too little data", racePaceShape(["led", null, null]).verdict, "unknown");

/* ---- replay against the real payload ---- */
const p = "./probe-output/results-range.json";
if (existsSync(p)) {
  console.log("\nreplay against live comments");
  const d = JSON.parse(readFileSync(p, "utf-8"));
  const races = (d.results ?? d) as any[];
  let total = 0, styled = 0;
  for (const r of races) {
    const styles: any[] = [];
    for (const h of r.runners ?? []) {
      const read = readComment(h.comment);
      total++;
      if (read.runStyle) styled++;
      styles.push(read.runStyle);
    }
    const shape = racePaceShape(styles);
    console.log(`  ${String(r.course).padEnd(12)} ${styles.filter(Boolean).length}/${styles.length} styles read -> ${shape.verdict} (${shape.leaders} leaders, ${shape.heldUp} held up)`);
  }
  console.log(`\n  run style identified on ${styled} of ${total} runners (${Math.round((styled/total)*100)}%)`);
  if (styled / total < 0.8) { fails++; console.log("  !! under 80% coverage — phrase list needs widening"); }
}


console.log("\nfell / brought down when going well");
check("brought down is always excused",
  readComment("Held up towards the back - brought down at the 3rd").fellGoingWell, true);
check("fell while in contention counts",
  readComment("Settled with the pack - pushed into contention to challenge three out - still very much involved when fell").fellGoingWell, true);
check("fell while travelling well counts",
  readComment("Travelling well in second when came to grief at the 9th").fellGoingWell, true);
check("fell from the back does not",
  readComment("Held up towards the back - stumbled and lost rider 3rd").fellGoingWell, false);
check("pulled up never counts as going well",
  readComment("Travelling well early - dropped away with no chance and pulled up before the 11th").fellGoingWell, false);
check("type: brought down",
  readComment("Held up - brought down at the 12th").nonCompletionType, "brought-down");
check("type: pulled up",
  readComment("Dropped away and pulled up before the last").nonCompletionType, "pulled-up");

console.log(fails === 0 ? "\nAll form-reading checks passed.\n" : `\n${fails} check(s) FAILED.\n`);
process.exit(fails === 0 ? 0 : 1);
