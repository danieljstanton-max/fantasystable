/**
 * Rain against the declared going.
 *
 *   npm run going -- 2026-08-28
 *
 * A read-only view of what lib/weather projects. The projection itself lives
 * there because the write-ups and best-bets score against it — two
 * implementations of the same thresholds would drift, and the report would stop
 * describing what the model actually did.
 */
import "dotenv/config";
import postgres from "postgres";
import { projectCard, bandAtOff } from "../lib/weather";

(async () => {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run going -- YYYY-MM-DD");
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require" });

  const cards = await sql<{ course: string; off: string }[]>`
    select course_name as course, off_time as off
    from races where race_date = ${date}
    order by course_name, off_time`;

  const meetings = await sql<{ course: string; going: string | null; surface: string | null }[]>`
    select ra.course_name as course,
           max(ra.going) as going,
           max(ra.surface) as surface
    from races ra
    where ra.race_date = ${date}
    group by ra.course_name
    order by ra.course_name`;

  if (!meetings.length) {
    console.error(`No races stored for ${date}. Run the racecard ingest first.`);
    await sql.end();
    process.exit(1);
  }

  const projected = await projectCard(meetings, date);

  console.log(`\nGOING WATCH — ${date}`);
  console.log("=".repeat(96));
  console.log("  Rainfall from Open-Meteo. EFF is effective millimetres: everything before");
  console.log("  the first race, plus half of the previous two days — rain on already-wet");
  console.log("  ground moves the going further than the same rain on dry ground.\n");
  console.log("  <5mm none  ·  5-12 one step  ·  12-25 two  ·  25-40 three  ·  40+ four\n");
  console.log("  COURSE         DECLARED        PRIOR  Y'DAY  NIGHT     AM  BEFORE   EFF  MODEL READS");
  console.log("  " + "-".repeat(96));

  const changed: { course: string; going: string | null; surface: string | null }[] = [];

  for (const m of meetings) {
    const g = projected.get(m.course);
    if (!g) continue;

    const cell = (n: number) => (n < 0.05 ? "  —" : n.toFixed(1)).padStart(7);
    const reads = g.allWeather
      ? "all-weather, unaffected"
      : g.changed
      ? `${g.declaredBand} → ${g.projectedBand}`
      : g.note;

    console.log(
      `  ${m.course.slice(0, 14).padEnd(15)}` +
        `${(m.going ?? "?").slice(0, 15).padEnd(16)}` +
        `${cell(g.rain.priorDays)}${cell(g.rain.yesterday)}${cell(g.rain.overnight)}${cell(g.rain.morning)}` +
        `${g.rain.beforeRacing.toFixed(1).padStart(8)}${g.rain.effective.toFixed(1).padStart(6)}  ${reads}`
    );

    if (g.changed) changed.push(m);
  }

  if (changed.length) {
    console.log("\n  GROUND BY RACE TIME");
    console.log("  Each race is scored on the ground at its own off time. Where rain falls");
    console.log("  during the card the later races ride softer than the first.\n");

    for (const m of changed) {
      const g = projected.get(m.course)!;
      const offs = cards.filter((c) => c.course === m.course).map((c) => c.off);
      if (!offs.length) continue;

      const bands = offs.map((o) => ({ off: o, band: bandAtOff(g, o) }));
      const moves = new Set(bands.map((b) => b.band)).size > 1;

      console.log(
        `  ${m.course}  (declared ${m.going ?? "?"}, ${g.rain.effective.toFixed(1)}mm effective before the first)` +
        (moves ? "  — CHANGES THROUGH THE CARD" : "")
      );

      for (const b of bands) {
        const mm = g.byHour[`${String(Math.min(22, Math.max(12, parseInt(b.off.slice(0, 2), 10)))).padStart(2, "0")}:00`];
        console.log(
          `     ${b.off}  ${String(b.band).replace("-", " to ").padEnd(15)}` +
          (mm !== undefined ? `${mm.toFixed(1)}mm effective` : "")
        );
      }
      console.log("");
    }
  } else {
    console.log("\n  No card looks like moving on rainfall alone.");
  }

  console.log("");
  await sql.end();
})();
