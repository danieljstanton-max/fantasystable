/**
 * Flag laboratory.
 *
 *   npm run flags
 *   npm run flags -- --split=2026-05-01
 *
 * The model does not need to pick the winner of every race. It needs to FLAG
 * two profiles — well handicapped, and on the up — and Dan decides what to do
 * with them.
 *
 * The broad "well handicapped" signal fired on 6% of runners and returned
 * -0.6pp of lift, which says the definition is too loose rather than that the
 * angle is wrong. So this file defines many PRECISE variants and measures each
 * one against SP over twelve months.
 *
 * Every number is strike rate AND ROI, because a flag that finds winners at
 * unbackable prices is worthless here. Beating SP is the whole target.
 *
 * MULTIPLE COMPARISONS WARNING. Testing twenty variants and reporting the best
 * one is how people fool themselves. Anything promising here must survive
 * --split, where it is measured on races the idea was never derived from.
 */

import "dotenv/config";
import postgres from "postgres";
import { readComment } from "../lib/form-reading";
import { marginInPounds, normaliseDiscipline, sameDiscipline } from "../lib/selection";

const client = postgres(process.env.DATABASE_URL!, { max: 4, ssl: "require" });
const args = process.argv.slice(2);
const arg = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const SPLIT = arg("split", "");

interface Run {
  raceId: string; raceDate: string; courseSlug: string;
  distanceF: number | null; goingBand: string | null; raceType: string | null;
  raceName: string; ageBand: string | null; raceClass: string | null;
  fieldSize: number | null; horseId: string; age: number | null; surface: string | null;
  positionNum: number | null; ofr: number | null; spDec: number | null;
  comment: string | null; ovrBtn: number | null; isNonRunner: boolean;
  t14Pct: number | null; t14Runs: number | null; winMargin: number | null;
}

/** A flag is a predicate over (today's run, prior form). */
interface Flag {
  name: string;
  group: "well-handicapped" | "on-the-up" | "perfect-conditions" | "control";
  test: (now: Run, hist: Run[]) => boolean;
}

const wins = (h: Run[]) => h.filter((r) => r.positionNum === 1);
const monthsAgo = (from: string, to: string) => {
  const a = new Date(from), b = new Date(to);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
};
const sameCode = (a: Run, b: Run) => sameDiscipline(a.raceType, b.raceType);

/** Best mark it won off in the same code, inside `months`. */
function bestWinMark(now: Run, hist: Run[], months: number): Run | null {
  let best: Run | null = null;
  for (const r of wins(hist)) {
    if (r.ofr === null || !sameCode(r, now)) continue;
    if (monthsAgo(r.raceDate, now.raceDate) > months) continue;
    if (!best || (r.ofr as number) > (best.ofr as number)) best = r;
  }
  return best;
}

/**
 * Dan, 2026-08-27: "there are key factors like well handicapped but running on
 * wrong surface, the profit model is when we catch a horse in perfect
 * conditions."
 *
 * Surface is turf vs all-weather, and is NOT the same as going. A horse whose
 * mark came down over three runs on the wrong surface is well treated AND has
 * an explanation for the losses — and today, back on the right one, is the
 * moment the method is aiming at.
 */
function wonOnThisSurface(now: Run, hist: Run[]): boolean {
  return wins(hist).some((r) => r.surface === now.surface);
}

/** Ran on a surface it has never won on. */
function wrongSurface(r: Run, hist: Run[]): boolean {
  const w = wins(hist);
  return w.length > 0 && !w.some((x) => x.surface === r.surface);
}

function provenToday(now: Run, hist: Run[]): boolean {
  const w = wins(hist).filter((r) => sameCode(r, now));
  const going = w.some((r) => r.goingBand === now.goingBand);
  const trip =
    now.distanceF !== null &&
    w.some((r) => r.distanceF !== null && Math.abs(r.distanceF - (now.distanceF as number)) <= 0.5);
  return going && trip;
}

const FLAGS: Flag[] = [
  /* ---------------------------------------------- well handicapped ------ */
  {
    name: "mark: any drop vs 18mo win",
    group: "well-handicapped",
    test: (n, h) => {
      const b = bestWinMark(n, h, 18);
      return !!b && n.ofr !== null && (b.ofr as number) > n.ofr;
    },
  },
  {
    name: "mark: 5lb+ below 18mo win",
    group: "well-handicapped",
    test: (n, h) => {
      const b = bestWinMark(n, h, 18);
      return !!b && n.ofr !== null && (b.ofr as number) - n.ofr >= 5;
    },
  },
  {
    name: "mark: 10lb+ below 18mo win",
    group: "well-handicapped",
    test: (n, h) => {
      const b = bestWinMark(n, h, 18);
      return !!b && n.ofr !== null && (b.ofr as number) - n.ofr >= 10;
    },
  },
  {
    name: "mark: 5lb+ below AND conditions proven",
    group: "well-handicapped",
    test: (n, h) => {
      const b = bestWinMark(n, h, 18);
      return !!b && n.ofr !== null && (b.ofr as number) - n.ofr >= 5 && provenToday(n, h);
    },
  },
  {
    name: "mark: 5lb+ below, win inside 6mo",
    group: "well-handicapped",
    test: (n, h) => {
      const b = bestWinMark(n, h, 6);
      return !!b && n.ofr !== null && (b.ofr as number) - n.ofr >= 5;
    },
  },
  {
    name: "mark falling 3 straight runs",
    group: "well-handicapped",
    test: (n, h) => {
      const m = h.filter((r) => r.ofr !== null && sameCode(r, n)).slice(0, 3);
      return m.length === 3 && (m[2].ofr as number) > (m[1].ofr as number) && (m[1].ofr as number) > (m[0].ofr as number);
    },
  },
  {
    name: "mark falling 3 runs AND proven today",
    group: "well-handicapped",
    test: (n, h) => {
      const m = h.filter((r) => r.ofr !== null && sameCode(r, n)).slice(0, 3);
      const falling = m.length === 3 && (m[2].ofr as number) > (m[1].ofr as number) && (m[1].ofr as number) > (m[0].ofr as number);
      return falling && provenToday(n, h);
    },
  },
  {
    name: "went close (<2L) off same/higher mark",
    group: "well-handicapped",
    test: (n, h) =>
      n.ofr !== null &&
      h.some(
        (r) =>
          sameCode(r, n) && r.ofr !== null && r.ovrBtn !== null &&
          r.positionNum !== null && r.positionNum > 1 &&
          r.ovrBtn <= 2 && r.ofr >= (n.ofr as number) &&
          monthsAgo(r.raceDate, n.raceDate) <= 12
      ),
  },

  /* --------------------------------------------------- on the up -------- */
  { name: "won last time out", group: "on-the-up", test: (n, h) => h[0]?.positionNum === 1 },
  {
    name: "won last time, raised < margin worth",
    group: "on-the-up",
    test: (n, h) => {
      const last = h[0];
      if (!last || last.positionNum !== 1 || last.ofr === null || n.ofr === null) return false;
      const lbs = marginInPounds(last.winMargin, last.distanceF, last.raceType);
      return lbs !== null && lbs - (n.ofr - last.ofr) >= 3;
    },
  },
  {
    name: "won 2 of last 3",
    group: "on-the-up",
    test: (n, h) => h.slice(0, 3).filter((r) => r.positionNum === 1).length >= 2,
  },
  {
    name: "lightly raced (<8 runs) + won last time",
    group: "on-the-up",
    test: (n, h) => h.length < 8 && h[0]?.positionNum === 1,
  },
  {
    name: "young (3-4yo) + won last time",
    group: "on-the-up",
    test: (n, h) => (n.age ?? 99) <= 4 && h[0]?.positionNum === 1,
  },
  {
    name: "improving positions (3 runs)",
    group: "on-the-up",
    test: (n, h) => {
      const p = h.slice(0, 3).map((r) => r.positionNum).filter((x): x is number => x !== null);
      return p.length === 3 && p[0] < p[1] && p[1] < p[2];
    },
  },
  {
    name: "won last time + hot yard (20%+)",
    group: "on-the-up",
    test: (n, h) => h[0]?.positionNum === 1 && (n.t14Runs ?? 0) >= 10 && (n.t14Pct ?? 0) >= 20,
  },
  {
    name: "won last time + proven today",
    group: "on-the-up",
    test: (n, h) => h[0]?.positionNum === 1 && provenToday(n, h),
  },
  {
    name: "won easily last time (comment)",
    group: "on-the-up",
    test: (n, h) => {
      const last = h[0];
      return !!last && last.positionNum === 1 && readComment(last.comment).easyRide;
    },
  },

  /* ------------------------------------------- perfect conditions ------- */
  {
    name: "well-in + back on winning surface",
    group: "perfect-conditions",
    test: (n, h) => {
      const b = bestWinMark(n, h, 12);
      return !!b && n.ofr !== null && (b.ofr as number) - n.ofr >= 4 && wonOnThisSurface(n, h);
    },
  },
  {
    name: "well-in + surface + going + trip",
    group: "perfect-conditions",
    test: (n, h) => {
      const b = bestWinMark(n, h, 12);
      return (
        !!b && n.ofr !== null && (b.ofr as number) - n.ofr >= 4 &&
        wonOnThisSurface(n, h) && provenToday(n, h)
      );
    },
  },
  {
    name: "mark fell on WRONG surface, right today",
    group: "perfect-conditions",
    test: (n, h) => {
      const recent = h.filter((r) => sameCode(r, n)).slice(0, 4);
      if (recent.length < 3) return false;
      const off = recent.filter((r) => wrongSurface(r, h)).length;
      const marks = recent.map((r) => r.ofr).filter((x): x is number => x !== null);
      const fell = marks.length >= 2 && marks[marks.length - 1] > marks[0];
      return off >= 2 && fell && wonOnThisSurface(n, h);
    },
  },
  {
    name: "mark fell on wrong GOING, right today",
    group: "perfect-conditions",
    test: (n, h) => {
      const recent = h.filter((r) => sameCode(r, n)).slice(0, 4);
      if (recent.length < 3) return false;
      const w = wins(h);
      if (!w.length) return false;
      const off = recent.filter((r) => !w.some((x) => x.goingBand === r.goingBand)).length;
      const marks = recent.map((r) => r.ofr).filter((x): x is number => x !== null);
      const fell = marks.length >= 2 && marks[marks.length - 1] > marks[0];
      return off >= 2 && fell && w.some((x) => x.goingBand === n.goingBand);
    },
  },
  {
    name: "everything: well-in, surface, going, trip, course",
    group: "perfect-conditions",
    test: (n, h) => {
      const b = bestWinMark(n, h, 12);
      return (
        !!b && n.ofr !== null && (b.ofr as number) - n.ofr >= 4 &&
        wonOnThisSurface(n, h) && provenToday(n, h) &&
        wins(h).some((r) => r.courseSlug === n.courseSlug)
      );
    },
  },

  /* ---------------------------------------------------- controls -------- */
  { name: "CONTROL: every scored runner", group: "control", test: () => true },
  {
    name: "CONTROL: ran within 5 days",
    group: "control",
    test: (n, h) => {
      if (!h[0]) return false;
      const d = (new Date(n.raceDate).getTime() - new Date(h[0].raceDate).getTime()) / 86400000;
      return d <= 5;
    },
  },
];

function roi(bets: Run[]) {
  const w = bets.filter((b) => b.spDec !== null && (b.spDec as number) > 1);
  if (!w.length) return { n: 0, wins: 0, sr: 0, roi: 0 };
  const ret = w.reduce((a, b) => a + (b.positionNum === 1 ? (b.spDec as number) : 0), 0);
  const winners = w.filter((b) => b.positionNum === 1).length;
  return { n: w.length, wins: winners, sr: (winners / w.length) * 100, roi: ((ret - w.length) / w.length) * 100 };
}

async function main() {
  process.stdout.write("\n  loading... ");
  const rows: Run[] = (await client`
    select ra.id "raceId", ra.race_date::text "raceDate", ra.course_slug "courseSlug",
           ra.distance_f "distanceF", ra.going_band "goingBand", ra.race_type "raceType",
           ra.name "raceName", ra.age_band "ageBand", ra.race_class "raceClass",
           ra.field_size "fieldSize", r.horse_id "horseId", r.age, ra.surface,
           r.position_num "positionNum", r.ofr, r.sp_dec "spDec", r.comment,
           r.ovr_btn "ovrBtn", r.is_non_runner "isNonRunner",
           r.trainer_14_percent "t14Pct", r.trainer_14_runs "t14Runs",
           (select min(w.ovr_btn) from runners w where w.race_id = ra.id and w.position_num = 2) "winMargin"
    from runners r join races ra on ra.id = r.race_id
    where ra.status = 'result' and r.position is not null
    order by ra.race_date`) as any;
  console.log(`${rows.length.toLocaleString()} settled runs`);

  const byHorse = new Map<string, Run[]>();
  for (const r of rows) {
    if (!byHorse.has(r.horseId)) byHorse.set(r.horseId, []);
    byHorse.get(r.horseId)!.push(r);
  }

  // Only handicaps, since that is the whole method.
  const targets = rows.filter(
    (r) => !r.isNonRunner && /handicap/i.test(r.raceName) && !/nursery|arab/i.test(r.raceName)
  );
  console.log(`  ${targets.length.toLocaleString()} handicap runners\n`);

  function history(r: Run): Run[] {
    const all = byHorse.get(r.horseId) ?? [];
    const out: Run[] = [];
    for (let i = all.length - 1; i >= 0; i--) {
      if (all[i].raceDate >= r.raceDate) continue;
      out.push(all[i]);
      if (out.length >= 40) break;
    }
    return out;
  }

  function report(pool: Run[], label: string) {
    const base = roi(pool);
    console.log(`${"=".repeat(78)}`);
    console.log(`${label}   —   baseline: ${base.n.toLocaleString()} runners, ${base.sr.toFixed(1)}% strike, ${base.roi.toFixed(1)}% ROI\n`);
    console.log(`  ${"flag".padEnd(42)}${"n".padStart(7)}${"strike".padStart(9)}${"vs base".padStart(9)}${"ROI".padStart(9)}`);

    let group = "";
    for (const f of FLAGS) {
      if (f.group !== group) { group = f.group; console.log(`  --- ${group} ---`); }
      const hits = pool.filter((r) => { try { return f.test(r, history(r)); } catch { return false; } });
      const r = roi(hits);
      if (r.n < 40) { console.log(`  ${f.name.padEnd(42)}${r.n.toString().padStart(7)}${"too thin".padStart(27)}`); continue; }
      const lift = r.sr - base.sr;
      console.log(
        `  ${f.name.padEnd(42)}${r.n.toLocaleString().padStart(7)}` +
          `${(r.sr.toFixed(1) + "%").padStart(9)}${((lift >= 0 ? "+" : "") + lift.toFixed(1) + "pp").padStart(9)}` +
          `${(r.roi.toFixed(1) + "%").padStart(9)}${r.roi > -5 ? "  <--" : ""}`
      );
    }
    console.log("");
  }

  if (SPLIT) {
    report(targets.filter((r) => r.raceDate < SPLIT), `FIT PERIOD (before ${SPLIT})`);
    report(targets.filter((r) => r.raceDate >= SPLIT), `TEST PERIOD (from ${SPLIT}) — the only numbers that count`);
  } else {
    report(targets, "ALL HANDICAP RUNNERS");
  }

  console.log(`  Anything marked <-- beats -5% ROI. Confirm it with --split before believing it.\n`);
  await client.end();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
