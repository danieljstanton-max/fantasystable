/**
 * Run the selection method against a real card.
 *
 *   npm run score            tomorrow
 *   npm run score -- today
 *   npm run score -- 2026-08-28
 *
 * Filters the card to qualifying handicaps, loads each runner's career from
 * the database, scores it against docs/tipping-method.md, and prints what
 * fired. Read-only — it stores nothing.
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import * as schema from "../db/schema";
import {
  filterRace,
  scoreHorse,
  starsFromScore,
  REJECT_LABELS,
  type PastRun,
  type HorseToday,
  type RaceToday,
} from "../lib/selection";
import { excuseUnproven, readComment, racePaceShape } from "../lib/form-reading";
import { markDecline } from "../lib/selection";
import type { GoingBand } from "../lib/going";

const client = postgres(process.env.DATABASE_URL!, { max: 4, ssl: "require" });
const db = drizzle(client, { schema });

function targetDate(): string {
  const arg = process.argv[2];
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg;
  const d = new Date();
  if (arg !== "today") d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const date = targetDate();
  console.log(`\nSCORING ${date}\n${"=".repeat(64)}`);

  const raceRows: any[] = await db.execute(sql`
    select id, course_name, off_time, name, age_band, race_class,
           going_band, distance_f, distance_round, going, field_size, race_type
    from races where race_date = ${date} order by off_time`);

  if (!raceRows.length) {
    console.log(`  no races stored for ${date} — run \`npm run ingest:racecards -- ${date}\``);
    await client.end();
    return;
  }

  const runnerRows: any[] = await db.execute(sql`
    select r.race_id, r.horse_id, r.horse_name, r.age, r.is_non_runner,
           r.ofr, r.effective_mark, r.jockey_id, r.jockey_name, r.jockey_claim_lbs,
           r.trainer_name, r.best_odds_dec, r.best_odds_frac,
           r.headgear_first_time, r.wind_surgery_run, r.form, r.last_run
    from runners r join races ra on ra.id = r.race_id
    where ra.race_date = ${date}`);

  const byRace = new Map<string, any[]>();
  for (const r of runnerRows) {
    if (!byRace.has(r.race_id)) byRace.set(r.race_id, []);
    byRace.get(r.race_id)!.push(r);
  }

  // Qualifying races only.
  const eligible: any[] = [];
  const rejected = new Map<string, number>();
  for (const race of raceRows) {
    const rs = byRace.get(race.id) ?? [];
    const v = filterRace(
      { raceName: race.name, ageBand: race.age_band, raceClass: race.race_class },
      rs.map((x) => ({ age: x.age, isNonRunner: x.is_non_runner }))
    );
    if (v.eligible) eligible.push({ race, runners: rs.filter((x) => !x.is_non_runner) });
    else rejected.set(REJECT_LABELS[v.reason!], (rejected.get(REJECT_LABELS[v.reason!]) ?? 0) + 1);
  }

  console.log(`\n  ${raceRows.length} races -> ${eligible.length} qualify`);
  for (const [k, n] of [...rejected].sort((a, b) => b[1] - a[1]))
    console.log(`     ${String(n).padStart(3)} rejected: ${k}`);

  if (!eligible.length) { await client.end(); return; }

  // Jockey strike rates over everything we hold.
  const jockeyRows: any[] = await db.execute(sql`
    select r.jockey_id,
           count(*)::int rides,
           count(*) filter (where r.position_num = 1)::int wins
    from runners r
    where r.jockey_id is not null and r.position is not null
    group by r.jockey_id having count(*) >= 20`);
  const strike = new Map<string, number>();
  for (const j of jockeyRows) strike.set(j.jockey_id, Math.round((j.wins / j.rides) * 100));
  const jockeyStrikeRate = (id: string) => strike.get(id) ?? null;

  const cardBest: any[] = [];

  for (const { race, runners } of eligible) {
    console.log(`\n${"-".repeat(64)}`);
    console.log(`${race.course_name} ${race.off_time}  ${String(race.name).slice(0, 44)}`);
    console.log(`${race.distance_round ?? "?"}  ${race.going ?? "?"}  ${race.race_type ?? "?"}  ${runners.length} runners  ${race.race_class ?? ""}`);

    const raceToday: RaceToday = {
      courseSlug: "",
      distanceF: race.distance_f,
      goingBand: race.going_band as GoingBand,
      raceType: race.race_type,
    };

    const scored: any[] = [];
    const styles: any[] = [];

    for (const r of runners) {
      const history = await loadHistory(r.horse_id, date);
      const today: HorseToday = {
        horseId: r.horse_id,
        horseName: r.horse_name,
        ofr: r.ofr,
        age: r.age,
        jockeyId: r.jockey_id,
        bestOddsDec: r.best_odds_dec,
        headgearFirstTime: Boolean(r.headgear_first_time),
        windSurgeryFirstTime: r.wind_surgery_run === "1",
        daysSinceRun: r.last_run,
      };

      const raceForHorse: RaceToday = { ...raceToday, courseSlug: courseSlugOf(race.course_name) };
      const s = scoreHorse(today, raceForHorse, history, jockeyStrikeRate, date);
      const decline = markDecline(history, date);

      // Dan's override: unproven is not fatal if it was staying on or blocked.
      const excuse = excuseUnproven(history.slice(0, 4).map((h) => h.comment));
      const lastStyle = history[0] ? readComment(history[0].comment).runStyle : null;
      styles.push(lastStyle);

      scored.push({ ...s, runs: history.length, excuse, decline, odds: r.best_odds_frac, trainer: r.trainer_name, jockey: r.jockey_name, claim: r.jockey_claim_lbs, ofr: r.ofr });
    }

    const shape = racePaceShape(styles);
    console.log(`pace: ${shape.verdict}  (${shape.leaders} front-runners, ${shape.heldUp} held up)`);

    scored.sort((a, b) => b.score - a.score);

    // One selection per race. A tipster does not take three from the same
    // contest, so the card ranking compares each race's best against the rest.
    if (scored.length) {
      const clear = scored.length > 1 ? scored[0].score - scored[1].score : scored[0].score;
      // Dangers: the next two in the same race, with what makes them
      // dangerous. A write-up has to talk about the race, not just the pick.
      const dangers = scored.slice(1, 3).map((d: any) => ({
        name: d.horseName,
        score: d.score,
        odds: d.odds,
        trainer: d.trainer,
        jockey: d.jockey,
        top: d.signals
          .filter((x: any) => x.weight > 0)
          .sort((a: any, b: any) => b.weight - a.weight)
          .slice(0, 2)
          .map((x: any) => x.label),
        warnings: d.signals.filter((x: any) => x.weight < 0).map((x: any) => x.label),
      }));

      cardBest.push({
        ...scored[0],
        dangers,
        fieldScores: scored.map((x: any) => x.score),
        course: race.course_name,
        offTime: race.off_time,
        raceName: race.name,
        going: race.going,
        dist: race.distance_round,
        fieldSize: runners.length,
        pace: shape.verdict,
        clear, // margin over the next horse in the same race
      });
    }

    const top = scored.slice(0, 4);
    console.log("");
    for (const s of top) {
      const stars = "*".repeat(starsFromScore(s.score));
      console.log(
        `  ${String(s.horseName).slice(0, 20).padEnd(21)} ${String(s.score).padStart(2)}pt ${stars.padEnd(5)} ` +
          `${String(s.odds ?? "-").padStart(6)}  OR ${String(s.ofr ?? "-").padStart(3)}  ${s.runs} runs`
      );
      for (const sig of s.signals)
        console.log(`      ${sig.weight < 0 ? "-" : "+"} ${sig.label}: ${sig.detail}`);
      if (s.excuse.excused)
        console.log(`      ~ excused (${s.excuse.reason}): ${s.excuse.evidence.slice(0, 2).join(", ")}`);
      if (s.decline?.declining)
        console.log(`      ! long-term decline: ${s.decline.lbsLost}lb lost over ${s.decline.overMonths} months, no win in ${18} months`);
      if (!s.signals.length && !s.excuse.excused) console.log(`      (nothing fired)`);
    }

    // Spread of scores across the whole field — how competitive is this race?
    const all = scored.map((x: any) => x.score);
    const clearOut = all.length > 1 ? all[0] - all[1] : all[0];
    console.log(
      `  field spread: ${all.join(" ")}   ` +
        (clearOut >= 4 ? "one clear standout" : clearOut >= 2 ? "fairly clear" : "competitive")
    );
  }

  /* ------------------------------ card summary ------------------------------ */

  // Rank by score, then by how clear-cut the race is. A 9-point horse that is
  // 4 points ahead of anything else is a better bet than a 9-point horse in a
  // race where three others score 8.
  cardBest.sort((a, b) => b.score - a.score || b.clear - a.clear);

  console.log(`\n${"=".repeat(64)}`);
  console.log(`TOP SELECTIONS — ${date}\n`);
  cardBest.slice(0, 5).forEach((s, i) => {
    console.log(
      `${i + 1}. ${String(s.horseName).toUpperCase().padEnd(20)} ${starsFromScore(s.score)}* ` +
        `${String(s.score).padStart(2)}pt  (clear by ${s.clear})`
    );
    console.log(`   ${s.offTime} ${s.course}  ${s.dist ?? "?"}  ${s.going ?? "?"}  ${s.fieldSize} runners  pace: ${s.pace}`);
    console.log(`   ${String(s.raceName).slice(0, 58)}`);
    console.log(`   ${s.trainer ?? "?"} / ${s.jockey ?? "?"}${s.claim ? `(${s.claim})` : ""}   price ${s.odds ?? "not yet published"}`);
    for (const sig of s.signals) console.log(`     ${sig.weight < 0 ? "!" : "-"} ${sig.label}: ${sig.detail}`);
    if (s.excuse?.excused) console.log(`     - excused (${s.excuse.reason})`);
    if (s.decline?.declining) console.log(`     ! ${s.decline.lbsLost}lb decline over ${s.decline.overMonths} months`);
    if (s.dangers?.length) {
      console.log(`   DANGERS`);
      for (const d of s.dangers) {
        console.log(
          `     ${String(d.name).padEnd(20)} ${String(d.score).padStart(2)}pt  ${String(d.odds ?? "-").padStart(6)}  ` +
            `${d.top.join(", ") || "little to recommend it"}` +
            (d.warnings.length ? `  [${d.warnings.join(", ")}]` : "")
        );
      }
    }
    console.log("");
  });

  console.log(`${"=".repeat(64)}\n`);
  await client.end();
}

function courseSlugOf(name: string): string {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Every past run we hold for this horse, most recent first. */
async function loadHistory(horseId: string, before: string): Promise<PastRun[]> {
  const rows: any[] = await db.execute(sql`
    select ra.race_date::text race_date, ra.course_slug, ra.distance_f,
           ra.going_band, ra.field_size, ra.race_type, r.position_num, r.ofr, r.ovr_btn, r.age,
           r.jockey_id, r.comment
    from runners r join races ra on ra.id = r.race_id
    where r.horse_id = ${horseId} and ra.race_date < ${before}
      and r.position is not null
    order by ra.race_date desc limit 50`);

  return rows.map((x) => ({
    raceDate: x.race_date,
    courseSlug: x.course_slug,
    distanceF: x.distance_f,
    goingBand: x.going_band as GoingBand,
    positionNum: x.position_num,
    ofr: x.ofr,
    fieldSize: x.field_size,
    jockeyId: x.jockey_id,
    comment: x.comment,
    raceType: x.race_type,
    ovrBtn: x.ovr_btn,
    age: x.age,
  }));
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
