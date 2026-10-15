/**
 * The method, and nothing else: best handicapped · goes on the ground · drawn well.
 *
 *   npm run three -- 2026-10-13
 *
 * Dan, 2026-10-13: "I feel like we have made too many changes away from the
 * original — best handicapped, goes on the ground, is drawn well."
 *
 * He is right. The shortlist had grown a market filter, a field-size rule and
 * a form read on top of his three tests, and each of those was my judgement
 * wearing his method's clothes. This applies the three, states each one, and
 * adds nothing.
 *
 *   1. BEST HANDICAPPED — pounds below the mark it last won off, same code,
 *      read from the weights because the racecard rating goes stale after a
 *      reassessment.
 *   2. GOES ON THE GROUND — has won or placed on ground that proves today's.
 *      Softer proves softer; see lib/going-scale.ts.
 *   3. DRAWN WELL — the impact value of its side of the track at this course,
 *      trip and going, from our own results. Jumps races have no draw, and say
 *      so rather than scoring zero.
 *
 * No price filter, no field-size rule, no form read. Those are decisions for
 * whoever reads it.
 */
import "dotenv/config";
import postgres from "postgres";
import { readMark } from "../lib/marks";
import { sameDiscipline, groundGate } from "../lib/selection";
import { provingBands } from "../lib/going-scale";

const date = process.argv[2];

async function main() {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run three -- YYYY-MM-DD");
    process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });

  const draw = await sql<any[]>`
    SELECT course_slug, dist_band, going_band, draw_band, impact_value, races
    FROM draw_bias`;
  const distBand = (f: number) =>
    f <= 5.5 ? "5f" : f <= 6.5 ? "6f" : f <= 7.5 ? "7f" : f <= 8.5 ? "1m"
      : f <= 10.5 ? "1m1f-1m2f" : f <= 12.5 ? "1m3f-1m4f" : "beyond 1m4f";

  const races = await sql<any[]>`
    SELECT ra.id, ra.off_time, ra.name, ra.race_type, ra.going_band, ra.distance_f,
           ra.race_class, ra.field_size, ra.course_slug, c.name course
    FROM races ra LEFT JOIN courses c ON c.id = ra.course_id
    WHERE ra.race_date = ${date}
      AND EXISTS (SELECT 1 FROM runners n WHERE n.race_id = ra.id AND n.number IS NOT NULL)
    ORDER BY ra.off_time`;

  type Row = {
    off: string; course: string; name: string; price: string | null;
    wellIn: number; gw: number; gp: number; gn: number;
    drawIv: number | null; drawNote: string; field: number; cls: string | null;
    going: string; dist: number;
  };
  const rows: Row[] = [];

  for (const ra of races) {
    const field = await sql<any[]>`
      SELECT horse_id, horse_name, ofr, weight_lbs, age, jockey_claim_lbs claim, draw,
             best_odds_frac FROM runners
      WHERE race_id = ${ra.id} AND NOT is_non_runner`;
    const shape = (r: any) => ({ ofr: r.ofr, weightLbs: r.weight_lbs, claim: r.claim, age: r.age });
    const fs = field.map(shape);

    for (const r of field) {
      const mk = readMark(fs, shape(r));
      const mark = mk.effective ?? mk.published;
      if (mark === null) continue;

      const hist = await sql<any[]>`
        SELECT ra2.going_band "goingBand", ru.position_num "positionNum", ru.ofr,
               ra2.race_type "raceType", ra2.race_date "raceDate", ra2.distance_f "distanceF",
               ra2.course_slug "courseSlug", ru.ovr_btn "ovrBtn", ru.comment, ru.age,
               ra2.field_size "fieldSize", ru.jockey_id "jockeyId", NULL "winMargin"
        FROM runners ru JOIN races ra2 ON ra2.id = ru.race_id
        WHERE ru.horse_id = ${r.horse_id} AND ra2.race_date < ${date}
          AND ru.position_num IS NOT NULL
        ORDER BY ra2.race_date DESC`;

      // 1. best handicapped
      const code = hist.filter((h) => sameDiscipline(h.raceType, ra.race_type));
      const win = code.find((h) => Number(h.positionNum) === 1 && h.ofr !== null);
      if (!win) continue;
      const wellIn = Number(win.ofr) - mark;
      if (wellIn <= 0) continue;

      // 2. goes on the ground — a win OR a place on ground that proves today's
      if (groundGate(hist as any, ra.going_band)) continue;
      const proving = new Set(provingBands(ra.going_band));
      const on = code.filter((h) => proving.has(String(h.goingBand)));
      const gw = on.filter((h) => Number(h.positionNum) === 1).length;
      const gp = on.filter((h) => [2, 3].includes(Number(h.positionNum))).length;
      if (gw + gp < 1) continue;

      // 3. drawn well
      let drawIv: number | null = null;
      let drawNote = "no draw (jumps)";
      if (r.draw && String(ra.race_type).toLowerCase() === "flat") {
        const f = Number(ra.field_size) || field.length;
        const band = Number(r.draw) <= f / 3 ? "low" : Number(r.draw) <= (2 * f) / 3 ? "mid" : "high";
        const cell = draw.find(
          (d) => d.course_slug === ra.course_slug && d.dist_band === distBand(Number(ra.distance_f)) &&
            d.going_band === ra.going_band && d.draw_band === band
        );
        drawIv = cell ? Number(cell.impact_value) : null;
        drawNote = cell
          ? `drawn ${r.draw} of ${f} — ${band} side wins ${drawIv!.toFixed(2)}x its share here`
          : `drawn ${r.draw} of ${f} — no draw data for this course and trip`;
        if (drawIv !== null && drawIv < 0.9) continue;      // drawn badly: out
      }

      rows.push({
        off: String(ra.off_time), course: String(ra.course ?? "").replace(/\s*-\s*AW$/i, ""),
        name: String(r.horse_name), price: r.best_odds_frac, wellIn, gw, gp, gn: on.length,
        drawIv, drawNote, field: Number(ra.field_size), cls: ra.race_class,
        going: String(ra.going_band), dist: Number(ra.distance_f),
      });
    }
  }
  await sql.end();

  rows.sort((a, b) => b.wellIn - a.wellIn);
  console.log(`\nBEST HANDICAPPED · GOES ON THE GROUND · DRAWN WELL — ${date}`);
  console.log("=".repeat(78));
  console.log(`  ${rows.length} pass all three\n`);
  for (const r of rows) {
    console.log(`  ${r.off} ${r.course.padEnd(13)} ${r.name.toUpperCase().padEnd(19)} ${String(r.price ?? "-").padEnd(7)}${String(r.wellIn).padStart(3)}lb well in`);
    console.log(`      ${r.dist}f ${r.cls ?? "?"} ${r.going} · ${r.field} runners`);
    console.log(`      ground: ${r.gw}w ${r.gp}p from ${r.gn} on ${r.going} or proving · ${r.drawNote}`);
  }
  console.log("");
}
main().catch((e) => { console.error("\nfailed:", e?.message ?? e); process.exit(1); });
