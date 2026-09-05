/**
 * Run the mappers over the saved probe output and report what they produce.
 *
 *   npm run verify:mappers
 *
 * No database and no network — it reads probe-output/. The point is to prove
 * the mapping against real payloads before a single row is written, and to
 * catch the day The Racing API renames a field.
 */

import { readFileSync, existsSync } from "node:fs";
import {
  mapRace,
  mapRunner,
  mapResultRace,
  mapResultRunner,
  extractRaces,
  extractRunners,
  offTime24,
  stripFavouriteMarker,
} from "../lib/mappers";
import { parsePrice } from "../lib/tips";

const OUT = "./probe-output";
let problems = 0;

function flag(msg: string) {
  problems++;
  console.log(`  !! ${msg}`);
}

function load(file: string): any | null {
  const p = `${OUT}/${file}`;
  if (!existsSync(p)) {
    console.log(`  (skipped — ${p} not found; run \`npm run probe\`)`);
    return null;
  }
  return JSON.parse(readFileSync(p, "utf-8"));
}

/* ---------------------------------------------------------------- racecards */

console.log("\nRACECARDS  (/v1/racecards/pro)");
const cards = load("racecards-pro.json");

if (cards) {
  const races = extractRaces(cards);
  console.log(`  ${races.length} races\n`);

  let runners = 0;
  let nonRunners = 0;
  let priced = 0;
  const slugs = new Set<string>();

  for (const raw of races) {
    const race = mapRace(raw);

    // The trap: off_time is 12-hour. Confirm the mapped time is the real one.
    if (offTime24(race.offDt) !== race.offTime) {
      flag(`${race.id}: offTime ${race.offTime} disagrees with offDt`);
    }
    if (raw.off_time && race.offTime === String(raw.off_time).padStart(5, "0")) {
      const h = parseInt(String(raw.off_time).split(":")[0], 10);
      if (h < 10) flag(`${race.id}: off_time ${raw.off_time} taken literally — 12h bug`);
    }

    const url = `/racecards/${race.courseSlug}/${race.raceDate}/${race.slug}`;
    if (slugs.has(url)) flag(`duplicate URL ${url}`);
    slugs.add(url);

    if (/\(aw\)/i.test(race.courseSlug)) flag(`course slug carries (AW): ${race.courseSlug}`);

    for (const rh of extractRunners(raw)) {
      const r = mapRunner(race.id, rh);
      runners++;
      if (r.isNonRunner) nonRunners++;
      if (r.bestOddsDec !== null) priced++;

      if (r.isNonRunner && r.number !== null) flag(`${r.horseName}: NR but has a number`);
      if (!r.isNonRunner && r.number === null) flag(`${r.horseName}: runner with no number`);
      if (r.bestOddsDec !== null && r.bestOddsDec <= 1) flag(`${r.horseName}: odds <= 1`);
      if (/\((?:GB|IRE|FR|USA)\)/i.test(r.horseName)) flag(`${r.horseName}: country suffix left on`);
    }
  }

  console.log(`  runners        ${runners}`);
  console.log(`  non-runners    ${nonRunners}   (flagged by number === "NR")`);
  console.log(`  with a price   ${priced}`);
  console.log(`  unique URLs    ${slugs.size} of ${races.length}`);

  // Show a worked example end to end.
  const sample = mapRace(races[0]);
  const sampleRunner = mapRunner(sample.id, extractRunners(races[0])[0]);
  console.log(`\n  Example race`);
  console.log(`    ${sample.courseName} ${sample.offTime}  (published off_time: ${races[0].off_time})`);
  console.log(`    ${sample.name}`);
  console.log(`    URL   /racecards/${sample.courseSlug}/${sample.raceDate}/${sample.slug}`);
  console.log(`    going ${sample.going} -> band "${sample.goingBand}", surface ${sample.surface}`);
  console.log(`    dist  ${sample.distanceRound} (${sample.distanceF}f)   prize ${sample.prize}`);
  console.log(`\n  Example runner`);
  console.log(`    ${sampleRunner.horseName}  no.${sampleRunner.number} draw ${sampleRunner.draw}`);
  console.log(`    ${sampleRunner.trainerName} / ${sampleRunner.jockeyName}`);
  console.log(`    best ${sampleRunner.bestOddsFrac} (${sampleRunner.bestOddsDec}) with ${sampleRunner.bestOddsBookmaker}`);
  console.log(`    e/w  ${sampleRunner.ewPlaces} places at 1/${sampleRunner.ewDenom}`);
  console.log(`    OR ${sampleRunner.ofr}  RPR ${sampleRunner.rpr}  form ${sampleRunner.form}`);
  console.log(`    trainer 14d: ${sampleRunner.trainer14Wins}/${sampleRunner.trainer14Runs} (${sampleRunner.trainer14Percent}%)`);
}

/* ------------------------------------------------------------------ results */

console.log("\nRESULTS  (/v1/results)");
const res = load("results-range.json");

if (res) {
  const races = extractRaces(res);
  console.log(`  ${races.length} races\n`);

  let settled = 0;
  let winners = 0;
  let spParsed = 0;

  for (const raw of races) {
    const race = mapResultRace(raw);
    if (race.status !== "result") flag(`${race.id}: result status is not "result"`);

    for (const rh of extractRunners(raw)) {
      const r = mapResultRunner(race.id, rh);
      settled++;
      if (r.positionNum === 1) winners++;

      // The favourite marker must not defeat price parsing.
      const cleaned = stripFavouriteMarker(r.sp);
      if (r.sp && !cleaned) flag(`${r.horseId}: SP ${r.sp} stripped to nothing`);
      if (cleaned && parsePrice(cleaned) !== null) spParsed++;
      else if (r.sp) flag(`${r.horseId}: SP ${r.sp} -> ${cleaned} unparseable`);

      if (r.position && /^\d+$/.test(r.position) && r.positionNum === null) {
        flag(`${r.horseId}: numeric position ${r.position} not parsed`);
      }
    }
  }

  console.log(`  runners settled   ${settled}`);
  console.log(`  winners           ${winners}   (expect 1 per race)`);
  console.log(`  SPs parsed        ${spParsed} of ${settled}`);

  const r0 = extractRunners(races[0])[0];
  const m0 = mapResultRunner(races[0].race_id, r0);
  console.log(`\n  Example result`);
  console.log(`    pos ${m0.position}  SP ${m0.sp} -> ${stripFavouriteMarker(m0.sp)} = ${parsePrice(stripFavouriteMarker(m0.sp))}`);
  console.log(`    OR ${m0.ofr} (from "or")   TS ${m0.ts} (from "tsr")   weight ${m0.weightLbs}lb`);
}

console.log(
  problems === 0
    ? "\nMappers agree with the live payloads. No problems found.\n"
    : `\n${problems} problem(s) found.\n`
);
process.exit(problems === 0 ? 0 : 1);
