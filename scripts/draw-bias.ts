/**
 * Draw bias, computed from our own results.
 *
 *   npm run draw                     build the table and show the strongest biases
 *   npm run draw -- --course=chester
 *   npm run draw -- --min-races=40
 *
 * Published draw-bias tables are static, and the bias is not. Catterick
 * famously favours low draws on good ground and high draws on soft — a single
 * number for the track is worse than no number at all. So this measures it from
 * 40,000 of our own Flat races, segmented by course, distance and going band,
 * and writes the result to `draw_bias` for the scorer to read.
 *
 * The measure is IMPACT VALUE: the win rate of a draw band divided by the win
 * rate you would expect if the draw did not matter. IV 1.40 means horses drawn
 * there win 40% more often than chance. IV is used rather than raw win rate
 * because it is comparable across field sizes.
 *
 * Draw is normalised to a position in the field (0 = innermost stall, 1 =
 * widest), because stall 8 in a 9-runner race is a wide draw and stall 8 in a
 * 20-runner race is not.
 *
 * Jumps races are excluded — there are no stalls.
 */

import "dotenv/config";
import postgres from "postgres";

const client = postgres(process.env.DATABASE_URL!, { max: 4, ssl: "require" });
const args = process.argv.slice(2);
const arg = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;

const MIN_RACES = parseInt(arg("min-races", "30"), 10);
const COURSE = arg("course", "").toLowerCase();

/** Distance buckets. Draw matters most at sprint trips. */
function distBand(f: number | null): string | null {
  if (f === null) return null;
  if (f <= 5.5) return "5f";
  if (f <= 6.5) return "6f";
  if (f <= 7.5) return "7f";
  if (f <= 8.5) return "1m";
  if (f <= 10.5) return "1m1f-1m2f";
  if (f <= 12.5) return "1m3f-1m4f";
  return "beyond 1m4f";
}

type Band = "low" | "mid" | "high";

/** Where a stall sits across the field, not its raw number. */
function drawBand(draw: number, fieldSize: number): Band | null {
  if (fieldSize < 6) return null; // too few stalls for the split to mean anything
  const p = (draw - 1) / (fieldSize - 1);
  if (p <= 1 / 3) return "low";
  if (p >= 2 / 3) return "high";
  return "mid";
}

async function main() {
  console.log(`\nDRAW BIAS — computed from our own results\n${"=".repeat(76)}`);
  process.stdout.write("  loading Flat runners with a draw... ");

  const rows: any[] = await client`
    select ra.course_name course, ra.course_slug, ra.distance_f dist,
           ra.going_band going, ra.id race_id,
           r.draw, r.position_num pos, r.sp_dec sp,
           count(*) over (partition by ra.id) field
    from runners r join races ra on ra.id = r.race_id
    where ra.race_type = 'Flat' and ra.status = 'result'
      and r.draw is not null and r.position is not null
      and r.is_non_runner = false`;
  console.log(`${rows.length.toLocaleString()} runners`);

  interface Cell {
    course: string; slug: string; dist: string; going: string; band: Band;
    runners: number; wins: number; races: Set<string>; staked: number; returned: number;
  }
  const cells = new Map<string, Cell>();
  // Baseline win rate per (course, dist, going) so IV is measured against the
  // right denominator rather than a global average.
  const totals = new Map<string, { runners: number; wins: number }>();

  for (const r of rows) {
    const d = distBand(r.dist);
    if (!d) continue;
    const band = drawBand(Number(r.draw), Number(r.field));
    if (!band) continue;
    const going = r.going ?? "unknown";

    const groupKey = `${r.course_slug}|${d}|${going}`;
    if (!totals.has(groupKey)) totals.set(groupKey, { runners: 0, wins: 0 });
    const t = totals.get(groupKey)!;
    t.runners++;
    if (r.pos === 1) t.wins++;

    const key = `${groupKey}|${band}`;
    if (!cells.has(key))
      cells.set(key, {
        course: r.course, slug: r.course_slug, dist: d, going, band,
        runners: 0, wins: 0, races: new Set(), staked: 0, returned: 0,
      });
    const c = cells.get(key)!;
    c.runners++;
    c.races.add(r.race_id);
    if (r.pos === 1) c.wins++;
    if (r.sp !== null && Number(r.sp) > 1) {
      c.staked++;
      if (r.pos === 1) c.returned += Number(r.sp);
    }
  }

  const results = [...cells.values()]
    .map((c) => {
      const t = totals.get(`${c.slug}|${c.dist}|${c.going}`)!;
      const baseline = t.wins / t.runners;
      const rate = c.wins / c.runners;
      return {
        ...c,
        raceCount: c.races.size,
        winRate: rate * 100,
        iv: baseline > 0 ? rate / baseline : 0,
        roi: c.staked ? ((c.returned - c.staked) / c.staked) * 100 : 0,
      };
    })
    .filter((c) => c.raceCount >= MIN_RACES);

  /* ------------------------------------------------------ persist ------- */

  await client`
    create table if not exists draw_bias (
      course_slug text not null,
      dist_band   text not null,
      going_band  text not null,
      draw_band   text not null,
      races       integer not null,
      runners     integer not null,
      wins        integer not null,
      impact_value real not null,
      roi         real,
      computed_at timestamptz not null default now(),
      primary key (course_slug, dist_band, going_band, draw_band)
    )`;
  await client`truncate draw_bias`;
  for (const c of results) {
    await client`
      insert into draw_bias (course_slug, dist_band, going_band, draw_band,
                             races, runners, wins, impact_value, roi)
      values (${c.slug}, ${c.dist}, ${c.going}, ${c.band},
              ${c.raceCount}, ${c.runners}, ${c.wins}, ${c.iv}, ${c.roi})`;
  }
  console.log(`  ${results.length.toLocaleString()} cells stored in draw_bias (min ${MIN_RACES} races each)\n`);

  /* ------------------------------------------------------- report ------- */

  const show = (list: typeof results, title: string) => {
    console.log(`${"-".repeat(76)}`);
    console.log(`${title}\n`);
    console.log(`  ${"course".padEnd(16)}${"dist".padEnd(12)}${"going".padEnd(11)}${"draw".padEnd(6)}${"races".padStart(6)}${"IV".padStart(7)}${"win%".padStart(7)}${"ROI".padStart(8)}`);
    for (const c of list) {
      console.log(
        `  ${String(c.course).slice(0, 15).padEnd(16)}${c.dist.padEnd(12)}${String(c.going).padEnd(11)}` +
          `${c.band.padEnd(6)}${String(c.raceCount).padStart(6)}${c.iv.toFixed(2).padStart(7)}` +
          `${(c.winRate.toFixed(1) + "%").padStart(7)}${(c.roi.toFixed(0) + "%").padStart(8)}`
      );
    }
    console.log("");
  };

  if (COURSE) {
    const mine = results.filter((c) => c.slug.includes(COURSE))
      .sort((a, b) => a.dist.localeCompare(b.dist) || a.going.localeCompare(b.going) || a.band.localeCompare(b.band));
    show(mine, `${COURSE.toUpperCase()} — every measured cell`);
    await client.end();
    return;
  }

  show([...results].sort((a, b) => b.iv - a.iv).slice(0, 20), "STRONGEST ADVANTAGES  (IV above 1 means the draw helps)");
  show([...results].sort((a, b) => a.iv - b.iv).slice(0, 15), "STRONGEST DISADVANTAGES");

  // Where does the bias flip with the ground? That is the case a static table
  // cannot represent.
  const flips: string[] = [];
  const byCD = new Map<string, typeof results>();
  for (const c of results) {
    const k = `${c.slug}|${c.dist}`;
    if (!byCD.has(k)) byCD.set(k, []);
    byCD.get(k)!.push(c);
  }
  for (const [k, list] of byCD) {
    const lows = list.filter((c) => c.band === "low");
    if (lows.length < 2) continue;
    const best = lows.reduce((a, b) => (a.iv > b.iv ? a : b));
    const worst = lows.reduce((a, b) => (a.iv < b.iv ? a : b));
    if (best.iv - worst.iv >= 0.45)
      flips.push(
        `  ${best.course.padEnd(16)}${best.dist.padEnd(12)} low draw: IV ${best.iv.toFixed(2)} on ${best.going}` +
          `  vs  IV ${worst.iv.toFixed(2)} on ${worst.going}`
      );
  }
  console.log(`${"-".repeat(76)}`);
  console.log(`BIAS THAT FLIPS WITH THE GROUND  (why one number per track is wrong)\n`);
  if (!flips.length) console.log("  none found at this sample threshold");
  for (const f of flips.slice(0, 15)) console.log(f);

  console.log(`\n${"=".repeat(76)}\n`);
  await client.end();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
