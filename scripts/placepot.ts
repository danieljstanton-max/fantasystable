/**
 * The daily Placepot: one horse per leg, chosen to place.
 *
 *   npm run placepot -- 2026-10-04            # pick the meeting for us
 *   npm run placepot -- 2026-10-04 --course curragh
 *
 * Dan, 2026-10-03: "I want horses with a good chance of placing" — so this
 * optimises survival, not dividend. His own article argues the big returns come
 * from opposing a popular favourite, and that is true; it is a different page.
 * This one is built to get through six legs.
 *
 * The ceiling is low and the page should say so. Across 30,502 settled races
 * since October 2024, under placepot place terms, the favourite places 63.0% of
 * the time. Six favourites in a row is 6.25% — about one day in sixteen.
 */
import "dotenv/config";
import postgres from "postgres";
import { groundGate, wellHandicapped, type PastRun } from "../lib/selection";
import { normaliseGoing } from "../lib/going";

/** Placepot place terms. Tote rules, by field size, with the handicap case. */
export function placeTerms(field: number, raceName: string): number {
  if (field <= 4) return 1;
  if (field <= 7) return 2;
  if (/handicap/i.test(raceName) && field >= 16) return 4;
  return 3;
}

/**
 * Place chance by price and by places on offer. Measured, not modelled.
 *
 * Every settled race since October 2024 — 30,502 of them — bucketed by the
 * horse's implied win probability after the overround is taken out, against
 * whether it placed under placepot terms. Columns are 5% bands of implied
 * probability from 0-5% up to 45%+.
 *
 * Rank alone was not enough: it scored every market leader at 63%, so an evens
 * favourite in a six-runner race with two places looked identical to a 9/2
 * favourite in a thirteen-runner race, and the choice of meeting came out
 * arbitrary. Price and place terms are what actually move it.
 */
const PLACE_RATE: Record<number, number[]> = {
  1: [0.03, 0.08, 0.13, 0.18, 0.23, 0.28, 0.33, 0.38, 0.43, 0.50], // winner only: implied prob itself
  2: [0.072, 0.201, 0.298, 0.391, 0.466, 0.527, 0.593, 0.647, 0.692, 0.795],
  3: [0.101, 0.271, 0.396, 0.495, 0.582, 0.653, 0.713, 0.776, 0.817, 0.901],
  4: [0.134, 0.306, 0.438, 0.547, 0.568, 0.620, 0.680, 0.740, 0.800, 0.880],
};
function placeChance(impliedProb: number, placesOffered: number): number {
  const row = PLACE_RATE[placesOffered] ?? PLACE_RATE[3];
  return row[Math.min(9, Math.max(0, Math.floor(impliedProb * 20)))];
}

export type PlacepotLeg = {
  leg: number; off: string; raceId: string; name: string; field: number; places: number;
  horse: string; number: string; price: string; chance: number; why: string;
};
export type Placepot = {
  date: string; course: string; courseSlug: string;
  legs: PlacepotLeg[]; survival: number;
};

/**
 * Build a placepot for EVERY meeting with six priced races.
 *
 * Dan, 2026-10-03: "we need a placepot for each meeting — legs across the top
 * and the meetings down the left hand side and just post the numbers of the
 * horses." One card per meeting was the wrong shape: a punter picks the meeting
 * he is playing, so the page has to cover the card he is actually at.
 *
 * Ordered by how likely the six legs are to survive, so the strongest sits at
 * the top of the grid.
 */
export async function buildPlacepots(date: string, want?: string): Promise<Placepot[]> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });

  const meetings = await sql<any[]>`
    SELECT ra.course_slug, c.name course, count(*)::int races
    FROM races ra JOIN courses c ON c.id = ra.course_id
    WHERE ra.race_date = ${date} GROUP BY 1,2 HAVING count(*) >= 6 ORDER BY 3 DESC`;
  if (!meetings.length) { await sql.end(); return []; }

  type Leg = PlacepotLeg;
  const built: { course: string; slug: string; legs: Leg[]; survival: number }[] = [];

  for (const m of meetings) {
    if (want && m.course_slug !== want) continue;
    const races = await sql<any[]>`
      SELECT ra.id, ra.off_time, ra.name, ra.field_size, ra.going, ra.course_slug,
             ra.distance_f, ra.race_type, ra.race_class
      FROM races ra WHERE ra.race_date=${date} AND ra.course_slug=${m.course_slug}
      ORDER BY ra.off_time LIMIT 6`;
    const legs: Leg[] = [];
    for (const ra of races) {
      const rs = await sql<any[]>`
        SELECT ru.horse_id, ru.horse_name, ru.number, ru.best_odds_frac, ru.best_odds_dec
        FROM runners ru WHERE ru.race_id=${ra.id} AND NOT ru.is_non_runner
          AND ru.best_odds_dec IS NOT NULL ORDER BY ru.best_odds_dec`;
      if (!rs.length) continue;
      const field = Number(ra.field_size) || rs.length;
      const p = placeTerms(field, String(ra.name ?? ""));
      const band = normaliseGoing(String(ra.going ?? ""));

      // Our own angles, among the horses that can actually place.
      //
      // Dan, 2026-10-03: "we should[n't] just select favs though - like we pick
      // horses ones that are well handicapped etc." So the market sets who is
      // credible and our handicap read picks between them. Taking the favourite
      // every time is a different, duller page; taking a well-handicapped horse
      // with no place chance is not a placepot leg at all.
      //
      // Candidates: anything with at least a 45% chance of placing on the
      // measured table. Among those, a horse the handicap read likes wins; if
      // none qualifies, the best place chance does.
      const raw = rs.map((r) => 1 / Number(r.best_odds_dec));
      const book = raw.reduce((a, b) => a + b, 0);

      type Cand = { r: any; chance: number; hcap: boolean; reason: string };
      const cands: Cand[] = [];
      for (let i = 0; i < Math.min(rs.length, 5); i++) {
        const r = rs[i];
        const chance = placeChance(raw[i] / book, p);
        if (chance < 0.45) continue;
        const hist = (await sql<any[]>`
          SELECT ra2.going_band "goingBand", ru.position_num "positionNum", ru.ofr,
                 ra2.race_type "raceType", ra2.race_date "raceDate", ra2.distance_f "distanceF",
                 ra2.course_slug "courseSlug", ru.ovr_btn "ovrBtn", ru.comment, ru.age,
                 ra2.field_size "fieldSize", ru.jockey_id "jockeyId",
                 (SELECT min(w.ovr_btn) FROM runners w
                   WHERE w.race_id = ra2.id AND w.position_num = 2) "winMargin"
          FROM runners ru JOIN races ra2 ON ra2.id=ru.race_id
          WHERE ru.horse_id=${r.horse_id} AND ra2.race_date < ${date} AND ru.position_num IS NOT NULL
          ORDER BY ra2.race_date DESC`) as unknown as PastRun[];
        if (groundGate(hist, band as any)) continue;   // Dan's rule applies here too
        const hc = wellHandicapped(
          { horseId: r.horse_id, horseName: r.horse_name, ofr: r.ofr ?? null, age: r.age ?? null,
            draw: null, jockeyId: null, bestOddsDec: Number(r.best_odds_dec),
            headgearFirstTime: false, windSurgeryFirstTime: false, daysSinceRun: null,
            trainer14Runs: null, trainer14Wins: null, trainer14Percent: null } as any,
          { courseSlug: String(ra.course_slug ?? ""), distanceF: Number(ra.distance_f) || null,
            goingBand: band as any, raceType: ra.race_type ?? null, fieldSize: field,
            raceClass: ra.race_class ?? null, raceName: String(ra.name ?? "") } as any,
          hist, date
        );
        cands.push({
          r, chance, hcap: hc.qualifies,
          reason: hc.qualifies && hc.reasons.length ? String(hc.reasons[0]).slice(0, 70) : "",
        });
      }
      if (!cands.length) continue;
      cands.sort((a, b) => Number(b.hcap) - Number(a.hcap) || b.chance - a.chance);
      const chosen = cands[0];
      const pick = chosen.r;
      const chance = chosen.chance;
      const why = chosen.hcap ? chosen.reason || "well handicapped" : "best place chance in the race";
      if (!pick) continue;
      legs.push({
        leg: legs.length + 1, raceId: String(ra.id),
        off: String(ra.off_time), name: String(ra.name ?? ""), field, places: p,
        horse: String(pick.horse_name), number: String(pick.number ?? "?"),
        price: String(pick.best_odds_frac ?? "-"), chance, why,
      });
    }
    if (legs.length === 6)
      built.push({ course: String(m.course), slug: String(m.course_slug), legs,
                   survival: legs.reduce((s, l) => s * l.chance, 1) });
  }

  built.sort((a, b) => b.survival - a.survival);
  await sql.end();
  return built.map((b) => ({
    date, course: b.course, courseSlug: b.slug, legs: b.legs, survival: b.survival,
  }));
}

async function main() {
  const date = process.argv[2];
  const want = (process.argv.find((a) => a.startsWith("--course=")) ?? "").split("=")[1];
  if (!date) { console.error("usage: npm run placepot -- YYYY-MM-DD [--course=slug]"); process.exit(1); }
  const all = await buildPlacepots(date, want);
  if (!all.length) { console.log("No meeting had six priced races."); return; }

  console.log(`\nDAILY PLACEPOT — ${date}\n`);
  for (const best of all) {
  console.log(`${best.course.toUpperCase()}`);
  best.legs.forEach((l, i) => {
    console.log(`  Leg ${i + 1}  ${l.off}  ${l.name.slice(0, 42)}`);
    console.log(`         ${l.field} runners, ${l.places} place${l.places === 1 ? "" : "s"}`);
    console.log(`         No.${l.number}  ${l.horse}  ${l.price}   ~${(l.chance * 100).toFixed(0)}% to place  (${l.why})`);
  });
  console.log(`  all six surviving: about ${(best.survival * 100).toFixed(1)}%\n`);
  }
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
