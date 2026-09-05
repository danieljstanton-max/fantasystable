/**
 * What does this horse need in order to win?
 *
 *   npm run horse -- "Jewel Maker"
 *   npm run horse -- simiyann
 *
 * Reads every run we hold and works out the conditions under which the horse
 * actually wins — going, trip, course, mark, class, field size, freshness,
 * run style — then says what it needs today and whether it has it.
 *
 * Everything is reported WITH its sample size. A 100% strike rate from two
 * runs is not a preference, and the profile says so rather than pretending
 * otherwise.
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import * as schema from "../db/schema";
import { readComment, type RunStyle } from "../lib/form-reading";
import { MARK_LOOKBACK_MONTHS } from "../lib/selection";

const client = postgres(process.env.DATABASE_URL!, { max: 4, ssl: "require" });
const db = drizzle(client, { schema });

interface Run {
  date: string;
  course: string;
  courseSlug: string;
  distF: number | null;
  distRound: string | null;
  going: string | null;
  goingBand: string | null;
  raceClass: string | null;
  raceName: string;
  fieldSize: number | null;
  pos: number | null;
  posText: string | null;
  ofr: number | null;
  sp: string | null;
  spDec: number | null;
  jockey: string | null;
  trainer: string | null;
  comment: string | null;
  isHandicap: boolean;
  raceType: string | null;
}

function pct(n: number, d: number): string {
  return d === 0 ? "-" : `${Math.round((n / d) * 100)}%`;
}

/** Group runs by a key and report runs / wins / places. */
function tally(runs: Run[], key: (r: Run) => string | null) {
  const m = new Map<string, { runs: number; wins: number; places: number }>();
  for (const r of runs) {
    const k = key(r);
    if (!k) continue;
    if (!m.has(k)) m.set(k, { runs: 0, wins: 0, places: 0 });
    const t = m.get(k)!;
    t.runs++;
    if (r.pos === 1) t.wins++;
    else if (r.pos !== null && r.pos <= 3) t.places++;
  }
  return [...m].sort((a, b) => b[1].wins - a[1].wins || b[1].runs - a[1].runs);
}

function bar(label: string, t: { runs: number; wins: number; places: number }) {
  const marks = "#".repeat(t.wins) + "+".repeat(t.places);
  return `    ${label.padEnd(18)} ${String(t.runs).padStart(3)} runs  ${String(t.wins).padStart(2)}W ${String(t.places).padStart(2)}P  ${pct(t.wins, t.runs).padStart(4)}  ${marks}`;
}

async function main() {
  const query = process.argv.slice(2).join(" ").trim();
  if (!query) {
    console.error('\n  Usage: npm run horse -- "Horse Name"\n');
    process.exit(1);
  }

  const matches: any[] = await db.execute(sql`
    select distinct r.horse_id, r.horse_name, count(*)::int runs
    from runners r
    where lower(r.horse_name) like ${"%" + query.toLowerCase() + "%"}
    group by r.horse_id, r.horse_name
    order by runs desc limit 8`);

  if (!matches.length) {
    console.log(`\n  No horse matching "${query}".\n`);
    await client.end();
    return;
  }
  if (matches.length > 1) {
    console.log(`\n  ${matches.length} matches:`);
    for (const m of matches) console.log(`    ${m.horse_name}  (${m.runs} runs held)`);
    console.log(`\n  Using the first.\n`);
  }

  const horseId = matches[0].horse_id;
  const horseName = matches[0].horse_name;

  const rows: any[] = await db.execute(sql`
    select ra.race_date::text date, ra.course_name course, ra.course_slug,
           ra.distance_f dist_f, ra.distance_round dist_round, ra.going,
           ra.going_band, ra.race_class, ra.name race_name, ra.field_size,
           r.position_num pos, r.position pos_text, r.ofr, r.sp, r.sp_dec,
           ra.race_type, r.jockey_name jockey, r.trainer_name trainer, r.comment
    from runners r join races ra on ra.id = r.race_id
    where r.horse_id = ${horseId} and r.position is not null
    order by ra.race_date desc`);

  const runs: Run[] = rows.map((x) => ({
    date: x.date, course: x.course, courseSlug: x.course_slug,
    distF: x.dist_f, distRound: x.dist_round, going: x.going, goingBand: x.going_band,
    raceClass: x.race_class, raceName: x.race_name, fieldSize: x.field_size,
    pos: x.pos, posText: x.pos_text, ofr: x.ofr, sp: x.sp, spDec: x.sp_dec,
    jockey: x.jockey, trainer: x.trainer, comment: x.comment,
    isHandicap: /handicap|nursery/i.test(x.race_name ?? ""),
    raceType: x.race_type,
  }));

  const wins = runs.filter((r) => r.pos === 1);
  const placed = runs.filter((r) => r.pos !== null && r.pos > 1 && r.pos <= 3);

  console.log(`\n${"=".repeat(68)}`);
  console.log(`${horseName.toUpperCase()}`);
  console.log(`${"=".repeat(68)}`);
  console.log(`  ${runs.length} runs held   ${wins.length} wins   ${placed.length} placed   strike ${pct(wins.length, runs.length)}`);
  if (runs.length) console.log(`  form spans ${runs[runs.length - 1].date} to ${runs[0].date}`);
  if (runs.length < 6) console.log(`  ** small sample — treat everything below as indicative only`);

  if (!wins.length) {
    console.log(`\n  Never won in the runs we hold. There is no winning profile to`);
    console.log(`  describe — what follows is where it has run best.`);
  }

  /* ---------------------------------------------------------------- going */
  console.log(`\n  GOING`);
  for (const [k, t] of tally(runs, (r) => r.goingBand)) console.log(bar(k, t));
  const wonGoing = [...new Set(wins.map((w) => w.goingBand).filter(Boolean))];
  const neverWonGoing = [...new Set(runs.map((r) => r.goingBand).filter(Boolean))]
    .filter((g) => !wonGoing.includes(g))
    .filter((g) => runs.filter((r) => r.goingBand === g).length >= 3);

  /* ----------------------------------------------------------------- trip */
  console.log(`\n  DISTANCE`);
  for (const [k, t] of tally(runs, (r) => (r.distF ? `${r.distF}f` : null)).slice(0, 8))
    console.log(bar(k, t));
  const winTrips = wins.map((w) => w.distF).filter((d): d is number => d !== null);
  const tripLo = winTrips.length ? Math.min(...winTrips) : null;
  const tripHi = winTrips.length ? Math.max(...winTrips) : null;

  /* --------------------------------------------------------------- course */
  console.log(`\n  COURSE`);
  for (const [k, t] of tally(runs, (r) => r.course).slice(0, 8)) console.log(bar(k, t));
  const winCourses = [...new Set(wins.map((w) => w.course))];

  /* ----------------------------------------------------------------- mark */
  console.log(`\n  DISCIPLINE`);
  for (const [k, t] of tally(runs, (r) => r.raceType)) console.log(bar(k, t));

  const marked = runs.filter((r) => r.ofr !== null);
  const winMarks = wins.map((w) => w.ofr).filter((o): o is number => o !== null);
  const current = marked[0]?.ofr ?? null;

  // Ratings are set separately per code and are not comparable across them,
  // so the mark section is reported one discipline at a time.
  console.log(`\n  HANDICAP MARK  (per discipline — ratings do not cross codes)`);
  const disciplines = [...new Set(runs.map((r) => r.raceType).filter(Boolean))] as string[];
  for (const d of disciplines) {
    const dr = runs.filter((r) => r.raceType === d && r.ofr !== null);
    if (!dr.length) continue;
    const dw = dr.filter((r) => r.pos === 1);
    const cur = dr[0].ofr;
    console.log(`    ${d}:`);
    console.log(`      ran off        ${dr.map((r) => r.ofr).slice(0, 8).join(", ")}`);
    console.log(`      most recent    ${cur}`);
    if (dw.length) {
      const best = Math.max(...(dw.map((r) => r.ofr) as number[]));
      console.log(`      won off        ${dw.map((r) => r.ofr).join(", ")}   best ${best}`);
      if (cur !== null) {
        const gap = best - cur;
        console.log(`      ${gap > 0 ? `${gap}lb BELOW` : gap === 0 ? `AT` : `${-gap}lb above`} its best winning ${d} mark`);
      }
    } else {
      console.log(`      never won in this code`);
    }
  }
  console.log(`\n  MARK TREND (all codes, for shape only)`);
  if (!marked.length) {
    console.log(`    no official ratings held`);
  } else {
    console.log(`    current (last run)   ${current}`);
    if (winMarks.length) {
      console.log(`    won off             ${winMarks.sort((a, b) => b - a).join(", ")}`);
      const best = Math.max(...winMarks);
      const lastWin = wins.find((w) => w.ofr === best);
      if (current !== null) {
        const gap = best - current;
        console.log(
          `    ${gap > 0 ? `${gap}lb BELOW` : `${-gap}lb above`} its best winning mark of ${best}` +
            (lastWin ? ` (${lastWin.date})` : "")
        );
      }
      // recency matters — see MARK_LOOKBACK_MONTHS
      const recent = wins.filter((w) => {
        const months = (Date.now() - new Date(w.date).getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        return months <= MARK_LOOKBACK_MONTHS;
      });
      console.log(
        recent.length
          ? `    ${recent.length} of those wins are inside ${MARK_LOOKBACK_MONTHS} months`
          : `    ** no wins inside ${MARK_LOOKBACK_MONTHS} months — an old winning mark is not evidence it is well treated`
      );
    }
    const trend = marked.slice(0, 6).map((r) => r.ofr).reverse();
    if (trend.length >= 2) {
      const delta = (trend[trend.length - 1] ?? 0) - (trend[0] ?? 0);
      console.log(`    last ${trend.length} marks       ${trend.join(" -> ")}  (${delta >= 0 ? "+" : ""}${delta}lb)`);
    }
  }

  /* ------------------------------------------------------------ run style */
  const styles = runs.slice(0, 10).map((r) => readComment(r.comment).runStyle).filter(Boolean) as RunStyle[];
  const styleCount = new Map<string, number>();
  for (const s of styles) styleCount.set(s, (styleCount.get(s) ?? 0) + 1);
  const topStyle = [...styleCount].sort((a, b) => b[1] - a[1])[0];
  console.log(`\n  RUN STYLE  (last ${styles.length} runs read)`);
  console.log(`    ${topStyle ? `${topStyle[0]} in ${topStyle[1]} of ${styles.length}` : "not readable from comments"}`);

  /* ----------------------------------------------------- field size, class */
  console.log(`\n  FIELD SIZE`);
  for (const [k, t] of tally(runs, (r) =>
    r.fieldSize === null ? null : r.fieldSize <= 8 ? "small (<=8)" : r.fieldSize <= 12 ? "medium (9-12)" : "big (13+)"
  )) console.log(bar(k, t));

  console.log(`\n  CLASS`);
  for (const [k, t] of tally(runs, (r) => r.raceClass).slice(0, 6)) console.log(bar(k, t));

  /* --------------------------------------------------------------- jockey */
  const jt = tally(runs, (r) => r.jockey).filter(([, t]) => t.wins > 0);
  if (jt.length) {
    console.log(`\n  WINS FOR`);
    for (const [k, t] of jt.slice(0, 5)) console.log(bar(k, t));
  }

  /* -------------------------------------------------------------- verdict */
  console.log(`\n${"-".repeat(68)}`);
  console.log(`  WHAT IT NEEDS\n`);

  const needs: string[] = [];
  if (wonGoing.length) needs.push(`Ground: has won on ${wonGoing.join(" and ")}.`);
  if (neverWonGoing.length) needs.push(`Avoid: no win in ${neverWonGoing.length} tried band(s) — ${neverWonGoing.join(", ")}.`);
  if (tripLo !== null) {
    needs.push(
      tripLo === tripHi
        ? `Trip: every win at ${tripLo}f.`
        : `Trip: wins between ${tripLo}f and ${tripHi}f.`
    );
  }
  if (winCourses.length) needs.push(`Course: winner at ${winCourses.join(", ")}.`);
  if (winMarks.length && current !== null) {
    const best = Math.max(...winMarks);
    needs.push(
      current <= best
        ? `Mark: races off ${current}, and has won off ${best} — ${best - current}lb of room.`
        : `Mark: races off ${current}, which is ${current - best}lb ABOVE anything it has won off. Needs improvement, not just a drop.`
    );
  }
  if (topStyle) {
    needs.push(
      topStyle[0] === "led"
        ? `Pace: makes the running — needs to get an uncontested lead.`
        : topStyle[0] === "held-up"
        ? `Pace: held up — needs a strong gallop in front to run at.`
        : `Pace: races ${topStyle[0]}.`
    );
  }
  const smallOnly = tally(runs, (r) =>
    r.fieldSize === null ? null : r.fieldSize <= 8 ? "small" : "bigger"
  );
  const small = smallOnly.find(([k]) => k === "small");
  if (small && small[1].wins > 0 && small[1].wins === wins.length && wins.length >= 2)
    needs.push(`Field size: every win came in a field of 8 or fewer.`);

  if (!needs.length) console.log(`    Not enough winning form to say.`);
  for (const n of needs) console.log(`    - ${n}`);

  console.log(`\n  LAST 6 RUNS\n`);
  console.log(`    ${"DATE".padEnd(12)}${"POS".padEnd(5)}${"COURSE".padEnd(15)}${"DIST".padEnd(7)}${"GOING".padEnd(13)}${"OR".padEnd(5)}SP`);
  for (const r of runs.slice(0, 6)) {
    console.log(
      `    ${r.date.padEnd(12)}${String(r.posText ?? "-").padEnd(5)}${String(r.course).slice(0, 14).padEnd(15)}` +
        `${String(r.distRound ?? "-").padEnd(7)}${String(r.going ?? "-").slice(0, 12).padEnd(13)}` +
        `${String(r.ofr ?? "-").padEnd(5)}${r.sp ?? "-"}`
    );
    const read = readComment(r.comment);
    const notes: string[] = [];
    if (read.trouble) notes.push("trouble in running");
    if (read.stayedOn) notes.push("stayed on");
    if (read.failedToStay) notes.push("weakened");
    if (notes.length) console.log(`      ${notes.join(", ")}`);
  }

  console.log(`\n${"=".repeat(68)}\n`);
  await client.end();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
