/** npm run test:going — the scale, against the case that caused it. */
import { provingBands, hasProvenWin } from "../lib/going-scale";
let pass=0, fail=0;
const ok=(n:string,g:unknown,w:unknown)=>{const s=JSON.stringify(g)===JSON.stringify(w);
  console.log(`  ${s?"ok  ":"FAIL"}  ${n}${s?"":`\n          got ${JSON.stringify(g)} want ${JSON.stringify(w)}`}`); s?pass++:fail++;};

console.log("\nsofter ground proves softer ground");
ok("heavy counts for soft", provingBands("soft"), ["soft","heavy"]);
ok("soft and heavy count for good-soft", provingBands("good-soft"), ["good-soft","soft","heavy"]);
ok("nothing is softer than heavy", provingBands("heavy"), ["heavy"]);

console.log("\nit does not run the other way");
ok("firm takes only firm", provingBands("firm"), ["firm"]);
ok("good-firm takes firm too", provingBands("good-firm"), ["firm","good-firm"]);
ok("good takes both neighbours", provingBands("good"), ["good-firm","good","good-soft"]);

console.log("\nall-weather is off the turf scale");
ok("standard takes the AW bands", provingBands("standard"), ["standard-fast","standard","standard-slow"]);

console.log("\nKEKE, 10 October, 16:08 Naas on soft");
const keke = [
  { goingBand: "heavy",     positionNum: 1 },   // 27 Sep, 9/4
  { goingBand: "good-soft", positionNum: 1 },
  { goingBand: "soft",      positionNum: 5 },
  { goingBand: "soft",      positionNum: 4 },
  { goingBand: "good",      positionNum: 1 },
];
ok("the heavy win proves soft", hasProvenWin(keke, "soft"), true);
ok("and a good winner alone would not", hasProvenWin([{goingBand:"good",positionNum:1}], "soft"), false);

console.log(`\n${fail?`${fail} FAILED, `:""}${pass} passed\n`);
process.exit(fail?1:0);
