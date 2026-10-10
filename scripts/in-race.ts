/**
 * Our selection against the rest of its own race.
 *
 *   npm run check:race -- 2026-10-10
 *
 * Dan, 2026-10-10: "I feel like we are going away from our original picks and
 * not checking enough data, horses v horses in the race — are we double
 * checking all?"
 *
 * We were not. Every check runs VERTICALLY: one horse against its own record.
 * `check:marks` asks whether the selection is well handicapped against its own
 * history, the ground gate asks whether it has run on today's going, the streak
 * gate asks about its own last few starts. Not one of them asks the horizontal
 * question — whether the horse we picked is the best-handicapped horse in the
 * race it is running in.
 *
 * That gap explains several of this week's arguments:
 *
 *   - WYLE COP, 5 October. The model's own write-up called a DIFFERENT horse
 *     in that race "well handicapped" and picked Wyle Cop anyway.
 *   - PARISIAC, 8 October. Picked at 3lb ABOVE its winning mark in a race
 *     containing ALPHA MAGIC at 10lb below and TOPWARRIOR level. We had the
 *     worst-handicapped of the three.
 *
 * Both were found by Dan reading the card, not by anything here.
 *
 * So: for every selection, rank its whole field on the one number his method
 * turns on — pounds below the mark it last won off, in the same code, read
 * from the weights rather than the stale racecard rating. Then say plainly
 * where our horse sits in that order.
 *
 * It reports. The best-handicapped horse in a race is not automatically the
 * right selection — ground, trip, draw, pace and the yard all matter, and a
 * horse 10lb well in with no form on the going is not a bet. The point is that
 * when we pass over the best-handicapped horse in a race, that should be a
 * decision somebody made, not a thing nobody looked at.
 */
import "dotenv/config";
import postgres from "postgres";
import { readMark } from "../lib/marks";
import { sameDiscipline, groundGate } from "../lib/selection";
import { parseBestBets, parseWriteUps } from "../lib/published";

type Runner = {
  horseId: string;
  name: string;
  price: string | null;
  priceDec: number | null;
  mark: number | null;
  drift: number | null;
  lastWinMark: number | null;
  lastWinDate: string | null;
  /** lastWinMark - mark. Positive is well in. */
  wellIn: number | null;
  groundFail: string | null;
  isOurs: boolean;
};

async function main() {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run check:race -- YYYY-MM-DD");
    process.exit(1);
  }

  const picks = [...parseBestBets(date), ...parseWriteUps(date)];
  const bestBets = new Set(parseBestBets(date).map((p) => p.horse.toUpperCase()));
  if (!picks.length) {
    console.error(`No published files for ${date}.`);
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });

  // One row per race we have a best bet in.
  const seen = new Set<string>();
  const wanted = picks.filter((p) => {
    if (!bestBets.has(p.horse.toUpperCase())) return false;
    const k = `${p.horse.toUpperCase()}|${p.offTime ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let passedOver = 0;

  for (const p of wanted) {
    const [ours] = await sql<any[]>`
      SELECT ru.horse_id, ra.id race_id, ra.off_time, ra.name, ra.race_type,
             ra.going_band, ra.distance_f, ra.race_class, ra.field_size, c.name course
      FROM runners ru JOIN races ra ON ra.id = ru.race_id
      LEFT JOIN courses c ON c.id = ra.course_id
      WHERE ra.race_date = ${date}
        AND upper(ru.horse_name) = ${p.horse.toUpperCase()}
        ${p.offTime ? sql`AND ra.off_time = ${p.offTime}` : sql``}
        AND EXISTS (SELECT 1 FROM runners n WHERE n.race_id = ra.id AND n.number IS NOT NULL)`;
    if (!ours) continue;

    const field = await sql<any[]>`
      SELECT ru.horse_id, ru.horse_name, ru.ofr, ru.weight_lbs, ru.jockey_claim_lbs claim,
             ru.best_odds_frac, ru.best_odds_dec
      FROM runners ru WHERE ru.race_id = ${ours.race_id} AND NOT ru.is_non_runner`;
    const shape = (r: any) => ({ ofr: r.ofr, weightLbs: r.weight_lbs, claim: r.claim });
    const fieldShape = field.map(shape);

    const rows: Runner[] = [];
    for (const r of field) {
      const mk = readMark(fieldShape, shape(r));
      const mark = mk.effective ?? mk.published;

      const hist = await sql<any[]>`
        SELECT ra2.going_band "goingBand", ru.position_num "positionNum", ru.ofr,
               ra2.race_type "raceType", ra2.race_date "raceDate", ra2.distance_f "distanceF",
               ra2.course_slug "courseSlug", ru.ovr_btn "ovrBtn", ru.comment, ru.age,
               ra2.field_size "fieldSize", ru.jockey_id "jockeyId", NULL "winMargin"
        FROM runners ru JOIN races ra2 ON ra2.id = ru.race_id
        WHERE ru.horse_id = ${r.horse_id} AND ra2.race_date < ${date}
          AND ru.position_num IS NOT NULL
        ORDER BY ra2.race_date DESC`;

      const code = hist.filter((h) => sameDiscipline(h.raceType, ours.race_type));
      const wins = code.filter((h) => Number(h.positionNum) === 1 && h.ofr !== null);
      const lw = wins[0] ?? null;

      rows.push({
        horseId: r.horse_id,
        name: String(r.horse_name),
        price: r.best_odds_frac,
        priceDec: r.best_odds_dec === null ? null : Number(r.best_odds_dec),
        mark,
        drift: mk.drift,
        lastWinMark: lw ? Number(lw.ofr) : null,
        lastWinDate: lw ? String(lw.raceDate).slice(0, 10) : null,
        wellIn: lw && mark !== null ? Number(lw.ofr) - mark : null,
        groundFail: groundGate(hist as any, ours.going_band),
        isOurs: r.horse_id === ours.horse_id,
      });
    }

    // Best handicapped first; horses with no win in the code have no claim to
    // the ranking at all and sit at the bottom.
    const ranked = [...rows].sort((a, b) => {
      if (a.wellIn === null && b.wellIn === null) return 0;
      if (a.wellIn === null) return 1;
      if (b.wellIn === null) return -1;
      return b.wellIn - a.wellIn;
    });

    const ourRow = rows.find((r) => r.isOurs)!;
    const ourPos = ranked.findIndex((r) => r.isOurs) + 1;
    // Only horses the ground rule would actually let us back count as "better",
    // and only ones that are genuinely well in.
    //
    // Comparing against a null read was the first mistake here: when our own
    // horse has no win in the code there is nothing to compare, and treating
    // every rated rival as "better handicapped" listed horses 11lb ABOVE their
    // winning mark as though they were the ones we should have had.
    const better = ranked.filter(
      (r) => !r.isOurs && !r.groundFail && r.wellIn !== null && r.wellIn > 0 &&
        (ourRow.wellIn === null || r.wellIn > ourRow.wellIn)
    );
    if (better.length) passedOver++;

    console.log(
      `\n${ours.off_time} ${String(ours.course).replace(/\s*-\s*AW$/i, "")} — ` +
        `${ours.distance_f}f ${ours.race_class ?? "?"} ${ours.going_band}, ${ours.field_size} runners`
    );
    console.log(`  ${String(ours.name).slice(0, 56)}`);
    console.log(
      `  OURS: ${ourRow.name.toUpperCase()} ${ourRow.price ?? "-"} — ` +
        (ourRow.wellIn === null
          ? "no win in this code, so no handicap read at all"
          : `${ourRow.wellIn >= 0 ? ourRow.wellIn + "lb well in" : Math.abs(ourRow.wellIn) + "lb above its winning mark"}`) +
        `, ranked ${ourPos} of ${ranked.length} in the race on that measure`
    );

    if (!better.length) {
      console.log(
        ourRow.wellIn === null
          ? "  Nothing in the race is well in and clear of the ground rule either."
          : "  Nothing in the race is better handicapped and clear of the ground rule."
      );
      continue;
    }
    console.log(`  Passed over — better handicapped, and the ground rule lets them run:`);
    for (const b of better.slice(0, 4)) {
      // "-11lb below" is not English and not what the figure means.
      const w = b.wellIn as number;
      console.log(
        `     ${b.name.toUpperCase().padEnd(20)} ${String(b.price ?? "-").padEnd(7)} ` +
          `off ${String(b.mark ?? "-").padStart(3)}${b.drift ? "*" : " "} — ` +
          `${Math.abs(w)}lb ${w >= 0 ? "below" : "above"} the ${b.lastWinMark} it won off (${b.lastWinDate})`
      );
    }
  }
  await sql.end();

  console.log(`\n${"=".repeat(74)}`);
  console.log(
    `  ${passedOver} of ${wanted.length} selections are NOT the best-handicapped runner in their race.`
  );
  console.log(
    "  That is not automatically wrong — ground, trip, draw, pace and the yard\n" +
      "  all matter. It should be a decision somebody made, not a thing nobody\n" +
      "  looked at.\n"
  );
}

main().catch((e) => {
  console.error("\nin-race check failed:", e?.message ?? e);
  process.exit(1);
});
