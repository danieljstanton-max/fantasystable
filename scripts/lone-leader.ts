/**
 * The horse that gets the lead on its own.
 *
 *   npm run lone -- 2026-10-05
 *
 * Dan, 2026-10-04: "using what I just said, in all races tomorrow are there any
 * standout horses we didn't look at."
 *
 * What he had just said, about ALWAYS BLUE at Pontefract: a front-runner that
 * gets an uncontested lead is worth having, and the same horse in a five-way
 * pace battle is a trap. The pace figures say the same thing more coldly — at
 * Pontefract over a mile on good, leaders win 2.57 times their share and
 * hold-up horses 0.35.
 *
 * So this looks for one thing only: a race with exactly one horse that goes
 * forward, at a course and trip where going forward wins. Everything else is
 * reported beside it so the call can be made on sight, not taken on trust.
 *
 * It is a screen, not a selection. It does not score, it does not stake, and
 * it does not write anything to the site. Horses already in the day's write-ups
 * are marked so the list is only what we have NOT already looked at.
 */
import "dotenv/config";
import postgres from "postgres";
import { readComment, type RunStyle } from "../lib/form-reading";
import { parseBestBets, parseWriteUps } from "../lib/published";
import { groundGate } from "../lib/selection";

/** How many readable runs before a style is worth believing. */
const MIN_READS = 3;
/** Share of readable runs in front to count as one that goes forward. */
const LEADS_SHARE = 0.5;
/** A rival with this many leads makes the lead contested. */
const RIVAL_LEADS = 2;

type Styled = {
  horseId: string;
  name: string;
  number: number | null;
  draw: number | null;
  ofr: number | null;
  priceFrac: string | null;
  priceDec: number | null;
  reads: number;
  leads: number;
  usual: RunStyle | null;
};

async function main() {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run lone -- YYYY-MM-DD");
    process.exit(1);
  }

  const ours = new Set(
    [...parseBestBets(date), ...parseWriteUps(date)].map((p) => p.horse.toUpperCase())
  );

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });

  // Declared races only — a field with no racecard number has not been
  // declared, and its "runners" are entries who may run somewhere else.
  const races = await sql<any[]>`
    SELECT ra.id, ra.off_time, ra.name, ra.distance_f, ra.race_class, ra.race_type,
           ra.going_band, ra.field_size, ra.course_slug, c.name course
    FROM races ra LEFT JOIN courses c ON c.id = ra.course_id
    WHERE ra.race_date = ${date}
      AND EXISTS (SELECT 1 FROM runners r WHERE r.race_id = ra.id AND r.number IS NOT NULL)
    ORDER BY ra.off_time`;

  // Every past comment for every runner declared that day, in one query.
  const past = await sql<any[]>`
    SELECT ru.horse_id, ru.comment, ra.race_date
    FROM runners ru JOIN races ra ON ra.id = ru.race_id
    WHERE ru.comment IS NOT NULL
      AND ru.horse_id IN (
        SELECT d.horse_id FROM runners d JOIN races dr ON dr.id = d.race_id
        WHERE dr.race_date = ${date} AND NOT d.is_non_runner)
      AND ra.race_date < ${date}
    ORDER BY ru.horse_id, ra.race_date DESC`;

  // Most recent eight runs per horse, which is as far back as a run style is
  // worth reading — tactics change with age, yard and trip.
  const byHorse = new Map<string, { style: RunStyle | null }[]>();
  for (const r of past) {
    const list = byHorse.get(r.horse_id) ?? [];
    if (list.length >= 8) continue;
    list.push({ style: readComment(String(r.comment)).runStyle });
    byHorse.set(r.horse_id, list);
  }

  const paceCells = await sql<any[]>`
    SELECT course_slug "slug", dist_band "band", race_code "code",
           races, impact_value "iv", roi
    FROM pace_bias WHERE run_style = 'led'`;

  // The same bands pace-bias.ts stores under, so a lookup cannot silently miss.
  const distBand = (f: number) =>
    f <= 6.5 ? "sprint" : f <= 8.5 ? "7f-1m" : f <= 12.5 ? "1m1f-1m4f"
      : f <= 17 ? "1m5f-2m" : f <= 22 ? "2m1f-2m6f" : "beyond 2m6f";

  const paceFor = (slug: string, distF: number, code: string) =>
    paceCells.find(
      (c) =>
        String(c.slug) === slug &&
        String(c.band) === distBand(distF) &&
        String(c.code).toLowerCase() === code.toLowerCase()
    ) ?? null;

  type Hit = {
    race: any; leader: Styled; rivals: number; pace: any;
    alreadyOurs: boolean; groundFail: string | null; history: any[];
  };
  const hits: Hit[] = [];

  for (const ra of races) {
    const field = await sql<any[]>`
      SELECT ru.horse_id, ru.horse_name, ru.number, ru.draw, ru.ofr,
             ru.best_odds_frac, ru.best_odds_dec
      FROM runners ru WHERE ru.race_id = ${ra.id} AND NOT ru.is_non_runner`;
    if (field.length < 5) continue;

    const styled: Styled[] = field.map((r) => {
      const runs = (byHorse.get(r.horse_id) ?? []).filter((x) => x.style);
      const leads = runs.filter((x) => x.style === "led").length;
      const counts: Record<string, number> = {};
      for (const x of runs) counts[x.style!] = (counts[x.style!] ?? 0) + 1;
      const usual = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) as RunStyle | null;
      return {
        horseId: r.horse_id, name: r.horse_name, number: r.number, draw: r.draw,
        ofr: r.ofr, priceFrac: r.best_odds_frac, priceDec: r.best_odds_dec,
        reads: runs.length, leads, usual,
      };
    });

    // One horse that goes forward, and nobody else with a habit of it.
    const goers = styled.filter((s) => s.reads >= MIN_READS && s.leads / s.reads >= LEADS_SHARE);
    if (goers.length !== 1) continue;
    const leader = goers[0];
    const rivals = styled.filter((s) => s.horseId !== leader.horseId && s.leads >= RIVAL_LEADS).length;
    if (rivals > 0) continue;

    const pace = paceFor(String(ra.course_slug ?? ""), Number(ra.distance_f), String(ra.race_type ?? "Flat"));

    // The ground rule is not negotiable, so a horse it would stop is reported
    // as stopped rather than quietly left in the list.
    const hist = await sql<any[]>`
      SELECT ra2.going_band "goingBand", ru.position_num "positionNum", ru.ofr,
             ra2.race_type "raceType", ra2.race_date "raceDate", ra2.distance_f "distanceF",
             ra2.course_slug "courseSlug", ru.ovr_btn "ovrBtn", ru.comment, ru.age,
             ra2.field_size "fieldSize", ru.jockey_id "jockeyId", NULL "winMargin"
      FROM runners ru JOIN races ra2 ON ra2.id = ru.race_id
      WHERE ru.horse_id = ${leader.horseId} AND ra2.race_date < ${date}
        AND ru.position_num IS NOT NULL
      ORDER BY ra2.race_date DESC`;

    hits.push({
      race: ra, leader, rivals, pace,
      alreadyOurs: ours.has(String(leader.name).toUpperCase()),
      groundFail: groundGate(hist as any, ra.going_band),
      history: hist,
    });
  }
  await sql.end();

  hits.sort((a, b) => (Number(b.pace?.iv ?? 0) - Number(a.pace?.iv ?? 0)));

  const fresh = hits.filter((h) => !h.alreadyOurs);
  console.log(`\nLONE FRONT-RUNNERS — ${date}`);
  console.log("=".repeat(78));
  console.log(`  ${races.length} declared races · ${hits.length} with exactly one horse that goes forward`);
  console.log(`  ${fresh.length} of those are NOT already one of our selections\n`);

  for (const h of hits) {
    const p = h.pace;
    const iv = p ? `lead IV ${Number(p.iv).toFixed(2)} off ${p.races} races` : "no measured pace cell here";
    const tag = h.alreadyOurs ? "[already ours]" : h.groundFail ? "[ground rule]" : "";
    console.log(
      `  ${h.race.off_time} ${String(h.race.course).replace(/\s*-\s*AW$/i, "").padEnd(14)} ` +
        `${String(h.leader.name).toUpperCase().padEnd(20)} ${String(h.leader.priceFrac ?? "-").padEnd(7)} ${tag}`
    );
    console.log(
      `      ${h.race.distance_f}f ${h.race.race_class ?? "?"} ${h.race.going_band} · ` +
        `${h.race.field_size} runners · draw ${h.leader.draw ?? "-"} · mark ${h.leader.ofr ?? "-"}`
    );
    console.log(`      led ${h.leader.leads} of ${h.leader.reads} readable runs, nothing else in the race leads · ${iv}`);
    if (h.groundFail) console.log(`      ground rule: ${h.groundFail}`);
    console.log("");
  }
}

main().catch((e) => {
  console.error("\nlone-leader failed:", e?.message ?? e);
  process.exit(1);
});
