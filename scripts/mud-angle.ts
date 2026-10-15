/**
 * Proven mud horses running off less than they last won off.
 *
 *   npm run mud -- 2026-10-09
 *   npm run mud -- 2026-10-09 --bands=soft,heavy
 *
 * Dan, 2026-10-08, on a card where rain had moved four tracks: "on the heavy
 * tracks find some horses that have won on heavy and are below last winning
 * mark."
 *
 * Two hard facts, both of which the database can answer, and neither of which
 * the score asks for in this combination. The ground rule only ever REMOVES a
 * horse — it says a horse without soft or heavy form cannot be picked on soft
 * or heavy. It has nothing to say in the other direction, so a horse that has
 * actually won in the mud gets no credit for it beyond a line in its ground
 * record.
 *
 * Marks come from the weights, not from `ofr` — see lib/marks.ts. A horse
 * reassessed for a recent win still shows the old rating on the racecard, and
 * on this screen that is the difference between "4lb well in" and "1lb up".
 *
 * Going is the PROJECTED band, not the declared one, because that is what the
 * selections are made on and what the horses will actually run on.
 *
 * It is a screen, not a selection: no score, no stake, nothing published.
 * Anything already in the day's write-ups is marked, so the list is what we
 * have not already looked at.
 */
import "dotenv/config";
import postgres from "postgres";
import { readMark } from "../lib/marks";
import { sameDiscipline } from "../lib/selection";
import { parseBestBets, parseWriteUps } from "../lib/published";
import { projectCard, bandAtOff, type GoingProjection } from "../lib/weather";

/** The wet end of the turf scale. All-weather is off this scale entirely. */
const WET = ["soft", "heavy", "good-soft"];

async function main() {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run mud -- YYYY-MM-DD [--bands=soft,heavy]");
    process.exit(1);
  }
  const bands = (process.argv.find((a) => a.startsWith("--bands=")) ?? "")
    .split("=")[1]?.split(",").map((s) => s.trim()).filter(Boolean) ?? WET;

  const ours = new Set(
    [...parseBestBets(date), ...parseWriteUps(date)].map((p) => p.horse.toUpperCase())
  );

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });

  // Every declared race, then filtered on the PROJECTED going.
  //
  // Filtering on `going_band` in SQL reads the DECLARED going, which is the one
  // thing this screen must not use: the whole question was about the tracks the
  // rain has moved. On 9 October that returned Chepstow only and silently
  // dropped York and Downpatrick, both declared good and both projected good to
  // soft on 8mm and 9mm — exactly the races Dan was asking about.
  const allRaces = await sql<any[]>`
    SELECT ra.id, ra.off_time, ra.name, ra.going_band, ra.going, ra.surface,
           ra.distance_f, ra.race_class, ra.race_type, ra.field_size,
           ra.course_name, c.name course
    FROM races ra LEFT JOIN courses c ON c.id = ra.course_id
    WHERE ra.race_date = ${date}
      AND EXISTS (SELECT 1 FROM runners r WHERE r.race_id = ra.id AND r.number IS NOT NULL)
    ORDER BY ra.off_time`;

  const meetings = [...new Map(
    allRaces.map((r) => [String(r.course_name), {
      course: String(r.course_name), going: r.going ?? null, surface: r.surface ?? null,
    }])
  ).values()];
  const projection: Map<string, GoingProjection> = await projectCard(meetings, date);

  const races = allRaces.filter((ra) => {
    const band = bandAtOff(projection.get(String(ra.course_name)), ra.off_time) ?? ra.going_band;
    ra.projectedBand = band;
    return bands.includes(String(band));
  });

  if (!races.length) {
    console.log(`\nNo race on ${date} is projected on ${bands.join(", ")}.\n`);
    await sql.end();
    return;
  }

  type Hit = {
    off: string; course: string; distanceF: number; raceClass: string | null;
    field: number; going: string; declaredBand: string; horse: string; price: string | null;
    mark: number; drift: number | null; lastWin: { mark: number; date: string; going: string };
    below: number; mudWins: number; mudPlaces: number; mudRuns: number;
    alreadyOurs: boolean;
  };
  const hits: Hit[] = [];

  for (const ra of races) {
    const field = await sql<any[]>`
      SELECT ru.horse_id, ru.horse_name, ru.ofr, ru.weight_lbs, ru.age, ru.jockey_claim_lbs claim,
             ru.best_odds_frac, ru.best_odds_dec
      FROM runners ru WHERE ru.race_id = ${ra.id} AND NOT ru.is_non_runner`;
    if (field.length < 4) continue;
    const shape = (r: any) => ({ ofr: r.ofr, weightLbs: r.weight_lbs, claim: r.claim, age: r.age });
    const fieldShape = field.map(shape);

    for (const r of field) {
      const mk = readMark(fieldShape, shape(r));
      const mark = mk.effective ?? mk.published;
      if (mark === null) continue;

      const hist = await sql<any[]>`
        SELECT ra2.race_date, ra2.going_band, ra2.race_type, ru.position_num, ru.ofr
        FROM runners ru JOIN races ra2 ON ra2.id = ru.race_id
        WHERE ru.horse_id = ${r.horse_id} AND ra2.race_date < ${date}
          AND ru.position_num IS NOT NULL
        ORDER BY ra2.race_date DESC`;

      // Marks only compare within a code.
      const code = hist.filter((h) => sameDiscipline(h.race_type, ra.race_type));
      const wins = code.filter((h) => Number(h.position_num) === 1 && h.ofr !== null);
      if (!wins.length) continue;

      const lw = wins[0];
      const below = Number(lw.ofr) - mark;
      if (below <= 0) continue;                    // not below its winning mark

      // Won in the mud — the whole point of the screen, so a place is not enough.
      const mud = code.filter((h) => WET.includes(String(h.going_band)));
      const mudWins = mud.filter((h) => Number(h.position_num) === 1).length;
      if (mudWins < 1) continue;

      hits.push({
        off: String(ra.off_time), course: String(ra.course ?? "").replace(/\s*-\s*AW$/i, ""),
        distanceF: Number(ra.distance_f), raceClass: ra.race_class, field: Number(ra.field_size),
        going: String(ra.projectedBand),
        declaredBand: String(ra.going_band),
        horse: String(r.horse_name), price: r.best_odds_frac,
        mark, drift: mk.drift,
        lastWin: { mark: Number(lw.ofr), date: String(lw.race_date).slice(0, 10), going: String(lw.going_band) },
        below,
        mudWins,
        mudPlaces: mud.filter((h) => [2, 3].includes(Number(h.position_num))).length,
        mudRuns: mud.length,
        alreadyOurs: ours.has(String(r.horse_name).toUpperCase()),
      });
    }
  }
  await sql.end();

  hits.sort((a, b) => b.below - a.below || b.mudWins - a.mudWins);

  console.log(`\nWON IN THE MUD, AND IN BELOW ITS WINNING MARK — ${date}`);
  console.log("=".repeat(78));
  console.log(`  ${races.length} races projected on ${bands.join(", ")} · ${hits.length} qualify`);
  console.log(`  ${hits.filter((h) => !h.alreadyOurs).length} are not already one of our selections\n`);

  for (const h of hits) {
    console.log(
      `  ${h.off} ${h.course.padEnd(13)} ${h.horse.toUpperCase().padEnd(20)} ${String(h.price ?? "-").padEnd(7)}` +
        `${h.alreadyOurs ? " [already ours]" : ""}`
    );
    console.log(
      `      ${h.distanceF}f ${h.raceClass ?? "?"} ${h.going}` +
        `${h.declaredBand !== h.going ? ` (declared ${h.declaredBand})` : ""} · ${h.field} runners · ` +
        `off ${h.mark}${h.drift ? ` (racecard says ${h.mark - h.drift})` : ""}`
    );
    console.log(
      `      ${h.below}lb BELOW the ${h.lastWin.mark} it won off (${h.lastWin.date}, ${h.lastWin.going})` +
        ` · in the mud: ${h.mudWins}w ${h.mudPlaces}p from ${h.mudRuns}`
    );
    console.log("");
  }
}

main().catch((e) => {
  console.error("\nmud angle failed:", e?.message ?? e);
  process.exit(1);
});
