/**
 * Apply the race filters to a real card.
 *
 *   npm run filter:today
 *
 * Reads probe-output/racecards-pro.json so it runs with no database.
 */
import { readFileSync } from "node:fs";
import { extractRaces, extractRunners, mapRace, mapRunner } from "../lib/mappers";
import { filterRace, REJECT_LABELS } from "../lib/selection";

const payload = JSON.parse(readFileSync("./probe-output/racecards-pro.json", "utf-8"));
const races = extractRaces(payload);

const kept: string[] = [];
const counts = new Map<string, number>();

console.log(`\n${races.length} races on the card\n`);
console.log(`${"".padEnd(4)}${"COURSE".padEnd(15)}${"OFF".padEnd(7)}${"AGE".padEnd(6)}${"RNRS".padEnd(6)}${"3YO".padEnd(5)}VERDICT`);
console.log("-".repeat(88));

for (const raw of races) {
  const race = mapRace(raw);
  const runners = extractRunners(raw).map((h) => mapRunner(race.id, h));
  const v = filterRace(
    { raceName: race.name, ageBand: race.ageBand, raceClass: race.raceClass },
    runners
  );

  const label = v.eligible ? "KEEP" : REJECT_LABELS[v.reason!];
  counts.set(label, (counts.get(label) ?? 0) + 1);
  if (v.eligible) kept.push(`${race.courseName} ${race.offTime} — ${race.name.slice(0, 52)}`);

  console.log(
    `${(v.eligible ? " ok " : "  . ")}` +
      `${race.courseName.padEnd(15)}${race.offTime.padEnd(7)}` +
      `${(race.ageBand ?? "?").padEnd(6)}${String(v.runnerCount).padEnd(6)}${String(v.threeYearOlds).padEnd(5)}` +
      label
  );
}

console.log("\nBreakdown");
for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${k}`);
}

console.log(`\n${kept.length} qualifying races:\n`);
for (const k of kept) console.log(`  ${k}`);
console.log();
