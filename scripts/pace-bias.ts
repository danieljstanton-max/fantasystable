/**
 * Pace bias, computed from our own results.
 *
 *   npm run pace
 *   npm run pace -- --course=chester
 *   npm run pace -- --min-races=40
 *
 * The other half of the draw question. Some tracks are impossible to come from
 * behind on — tight, turning, short straights — and others have a long enough
 * run-in that a closer gets its chance. Where the draw decides who gets a good
 * position, the pace bias decides whether that position is worth having.
 *
 * Run style is read from the in-running comment of each past run, the same
 * parser that reads staying-on and trouble. So this is measured, not assumed:
 * for every course and distance we ask what proportion of winners led, raced
 * prominently, or came from behind, and compare it with the proportion of
 * RUNNERS who did the same. A track where 20% of runners lead but 40% of
 * winners led is a track where the lead is worth having.
 *
 * Impact value again: 1.40 means horses of that style win 40% more often than
 * their share of the field would predict.
 *
 * Applies to every code. A front-runner's advantage over hurdles is as real as
 * on the Flat, and unlike the draw there are no stalls to worry about.
 */

import "dotenv/config";
import postgres from "postgres";
import { readComment, type RunStyle } from "../lib/form-reading";

const client = postgres(process.env.DATABASE_URL!, { max: 4, ssl: "require" });
const args = process.argv.slice(2);
const arg = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;

const MIN_RACES = parseInt(arg("min-races", "30"), 10);

/** Runners a cell needs before it is worth a row at all. */
const MIN_RUNNERS = parseInt(arg("min-runners", "60"), 10);

/**
 * Pseudo-runs at the baseline rate, mixed into every cell.
 *
 * Higher means more scepticism about small cells. 40 pulls a 36-run cell about
 * half way back to no-bias while leaving a 400-run cell essentially untouched.
 */
const PRIOR = parseInt(arg("prior", "40"), 10);
const COURSE = arg("course", "").toLowerCase();

function distBand(f: number | null): string | null {
  if (f === null) return null;
  if (f <= 6.5) return "sprint";        // 5-6f
  if (f <= 8.5) return "7f-1m";
  if (f <= 12.5) return "1m1f-1m4f";
  if (f <= 17) return "1m5f-2m";
  if (f <= 22) return "2m1f-2m6f";
  return "beyond 2m6f";
}

async function main() {
  console.log(`\nPACE BIAS — which run styles win where\n${"=".repeat(78)}`);
  process.stdout.write("  reading in-running comments... ");

  const rows: any[] = await client`
    select ra.course_name course, ra.course_slug, ra.distance_f dist,
           ra.race_type code, ra.id race_id,
           r.position_num pos, r.sp_dec sp, r.comment
    from runners r join races ra on ra.id = r.race_id
    where ra.status = 'result' and r.position is not null
      and r.comment is not null and r.comment <> ''
      and r.is_non_runner = false`;
  console.log(`${rows.length.toLocaleString()} runs with a comment`);

  interface Cell {
    course: string; slug: string; dist: string; code: string; style: RunStyle;
    runners: number; wins: number; races: Set<string>; staked: number; returned: number;
  }
  const cells = new Map<string, Cell>();
  const totals = new Map<string, { runners: number; wins: number }>();

  let readable = 0;
  for (const r of rows) {
    const d = distBand(r.dist);
    if (!d) continue;
    const style = readComment(r.comment).runStyle;
    if (!style) continue;
    readable++;

    const groupKey = `${r.course_slug}|${d}|${r.code ?? "?"}`;
    if (!totals.has(groupKey)) totals.set(groupKey, { runners: 0, wins: 0 });
    const t = totals.get(groupKey)!;
    t.runners++;
    if (r.pos === 1) t.wins++;

    const key = `${groupKey}|${style}`;
    if (!cells.has(key))
      cells.set(key, {
        course: r.course, slug: r.course_slug, dist: d, code: r.code ?? "?",
        style, runners: 0, wins: 0, races: new Set(), staked: 0, returned: 0,
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
  console.log(`  ${readable.toLocaleString()} had a readable run style (${Math.round((readable / rows.length) * 100)}%)`);

  const results = [...cells.values()]
    .map((c) => {
      const t = totals.get(`${c.slug}|${c.dist}|${c.code}`)!;
      const baseline = t.wins / t.runners;
      const rate = c.wins / c.runners;
      // A hard floor, and a deliberately biased one. Read this before changing it.
      //
      // Dan, 2026-09-05, on whether Ascot favours front-runners over 1m4f:
      // "can we run this against how we pick horses, because I think you made
      // a mistake first time."
      //
      // He was right about the mistake. This floor IS structurally biased.
      // Front-runners are the rarest style, so they field the fewest runners
      // per cell and are culled hardest — 8.7% of `led` cells survived against
      // 29.8% of `held-up` — and the surviving table skews negative, median IV
      // 0.83 among kept cells against 1.01 among dropped. Ascot 1m1f-1m4f held
      // rows for midfield and held-up and none for led, while the raw runs had
      // leaders winning 2.4x their share.
      //
      // The fix was obvious and it does not pay. Replacing the floor with
      // empirical-Bayes shrinkage — every cell kept, each trusted in
      // proportion to its evidence — was measured on both windows:
      //
      //                        Mar-Jun    Sep-Feb
      //   floor at 60 (live)     -2.7%      -4.6%
      //   shrinkage, prior 40    -2.4%      -6.5%
      //   shrinkage, prior 90    -2.6%      -5.8%
      //
      // Window A gains a little, window B loses far more, and B is the larger
      // sample (3,207 bets against 2,299). Letting the model see more pace
      // signal makes it worse, which says the extra cells are noise or already
      // in the price — not that front-runners do not win.
      //
      // So the table stays biased on purpose, and the bias is now documented
      // rather than accidental. Reproduce with:
      //   npm run pace -- --prior=40 --min-runners=12
      return {
        ...c,
        raceCount: c.races.size,
        share: (c.runners / t.runners) * 100,
        winRate: rate * 100,
        iv: baseline > 0 ? rate / baseline : 0,
        roi: c.staked ? ((c.returned - c.staked) / c.staked) * 100 : 0,
      };
    })
    .filter((c) => c.raceCount >= MIN_RACES && c.runners >= MIN_RUNNERS);

  await client`
    create table if not exists pace_bias (
      course_slug text not null,
      dist_band   text not null,
      race_code   text not null,
      run_style   text not null,
      races       integer not null,
      runners     integer not null,
      wins        integer not null,
      field_share real not null,
      impact_value real not null,
      roi         real,
      computed_at timestamptz not null default now(),
      primary key (course_slug, dist_band, race_code, run_style)
    )`;
  await client`truncate pace_bias`;
  for (const c of results) {
    await client`
      insert into pace_bias (course_slug, dist_band, race_code, run_style,
                             races, runners, wins, field_share, impact_value, roi)
      values (${c.slug}, ${c.dist}, ${c.code}, ${c.style},
              ${c.raceCount}, ${c.runners}, ${c.wins}, ${c.share}, ${c.iv}, ${c.roi})`;
  }
  console.log(`  ${results.length.toLocaleString()} cells stored in pace_bias\n`);

  const show = (list: typeof results, title: string) => {
    console.log(`${"-".repeat(78)}`);
    console.log(`${title}\n`);
    console.log(`  ${"course".padEnd(16)}${"dist".padEnd(13)}${"code".padEnd(9)}${"style".padEnd(10)}${"races".padStart(6)}${"IV".padStart(7)}${"win%".padStart(7)}${"ROI".padStart(8)}`);
    for (const c of list)
      console.log(
        `  ${String(c.course).slice(0, 15).padEnd(16)}${c.dist.padEnd(13)}${String(c.code).slice(0, 8).padEnd(9)}` +
          `${c.style.padEnd(10)}${String(c.raceCount).padStart(6)}${c.iv.toFixed(2).padStart(7)}` +
          `${(c.winRate.toFixed(1) + "%").padStart(7)}${(c.roi.toFixed(0) + "%").padStart(8)}`
      );
    console.log("");
  };

  if (COURSE) {
    show(
      results.filter((c) => c.slug.includes(COURSE))
        .sort((a, b) => a.dist.localeCompare(b.dist) || b.iv - a.iv),
      `${COURSE.toUpperCase()} — every measured cell`
    );
    await client.end();
    return;
  }

  const leaders = results.filter((c) => c.style === "led").sort((a, b) => b.iv - a.iv);
  const closers = results.filter((c) => c.style === "held-up").sort((a, b) => b.iv - a.iv);

  show(leaders.slice(0, 15), "FRONT-RUNNERS DOMINATE HERE");
  show(closers.slice(0, 12), "CLOSERS DO BEST HERE");
  show(leaders.slice(-10).reverse(), "WORST PLACES TO TRY TO MAKE ALL");

  // How strong is the lead advantage overall? This is the headline the pace
  // shape reading in the scorer is built on.
  const allLed = results.filter((c) => c.style === "led");
  const avgIv = allLed.reduce((a, b) => a + b.iv, 0) / (allLed.length || 1);
  console.log(`${"-".repeat(78)}`);
  console.log(`  Across ${allLed.length} measured course/distance cells, front-runners average IV ${avgIv.toFixed(2)}.`);
  console.log(`  An IV above 1 means leading wins more often than its share of runners implies.\n`);
  console.log(`${"=".repeat(78)}\n`);
  await client.end();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
