/**
 * Reading the draw-bias table.
 *
 * Dan, 2026-10-14: "why don't we have data?" We did — it was seven weeks and
 * 1,983 races stale. Rebuilding it took draw_bias from 815 cells to 2,332. But
 * rebuilding does not fix the shape of the lookup, and the shape was the other
 * half of the problem.
 *
 * The table is keyed course × trip × going × draw band, and the going makes it
 * sparse by design: Catterick favours low on good and high on soft, so a single
 * figure per track would be worse than none. The cost is that a course and trip
 * can hold hundreds of races and still have no row for the ground today's race
 * is run on. Nottingham beyond 1m4f holds 126 races across good, good to firm
 * and soft, and nothing on good to soft — so IT'S ALL ABOUT YOU, drawn 6 of 11
 * in the Colwick Cup, came back "no draw data for this course and trip" and the
 * funnel's draw test could not fire on a Flat handicap we were about to advise.
 *
 * So there are three levels, in this order:
 *
 *   1. the projected going — what the race will actually be run on
 *   2. the declared going — in case the projection moved off a band we hold
 *   3. all goings pooled at that course and trip ("any")
 *
 * Level 3 is written by `npm run draw` under going_band 'any', and it earns the
 * same minimum race count as every other cell, so it is a real measurement and
 * not an average of averages. It answers a weaker question — whether that side
 * of the track wins its share here over this trip, ground aside — and the
 * caller is told so, because a figure measured across all goings must never be
 * printed as though it were measured on today's.
 *
 * Shared because it was duplicated: best-bets and write-ups each had their own
 * copy of levels 1 and 2, and on 2026-09-23 a one-level version in one of them
 * put a different horse at the top of the 17:17 Redcar than the other.
 */

/** Goes in the going_band column for the pooled, ground-agnostic row. */
export const ANY_GOING = "any";

export type DrawBand = "low" | "mid" | "high";

/** Distance buckets. Must match `distBand()` in scripts/draw-bias.ts. */
export function drawDistBand(f: number | null | undefined): string | null {
  if (f === null || f === undefined) return null;
  const n = Number(f);
  if (!Number.isFinite(n)) return null;
  if (n <= 5.5) return "5f";
  if (n <= 6.5) return "6f";
  if (n <= 7.5) return "7f";
  if (n <= 8.5) return "1m";
  if (n <= 10.5) return "1m1f-1m2f";
  if (n <= 12.5) return "1m3f-1m4f";
  return "beyond 1m4f";
}

/**
 * Where a stall sits across the field, not its raw number: stall 8 of 9 is a
 * wide draw and stall 8 of 20 is not. Under six runners the split means
 * nothing.
 */
export function drawBandOf(
  draw: number | null | undefined,
  fieldSize: number | null | undefined
): DrawBand | null {
  if (draw === null || draw === undefined) return null;
  const field = Number(fieldSize ?? 0);
  if (field < 6) return null;
  const q = (Number(draw) - 1) / (field - 1);
  if (!Number.isFinite(q)) return null;
  return q <= 1 / 3 ? "low" : q >= 2 / 3 ? "high" : "mid";
}

export function drawKey(course: string, dist: string, going: string, band: string): string {
  return `${course}|${dist}|${going}|${band}`;
}

export interface DrawRead {
  /** Impact value, or null if we hold nothing at any level. */
  iv: number | null;
  /** The going the figure was measured on, or null when it is the pooled row. */
  goingBand: string | null;
  /** True when the figure is every going at this course and trip. */
  pooled: boolean;
}

const NO_DRAW: DrawRead = { iv: null, goingBand: null, pooled: false };

/**
 * Read one runner's draw figure off the table, walking the three levels.
 *
 * `map` is keyed by `drawKey()`. `projected` is the going the race will be run
 * on; `declared` is what the card says. Pass the same value for both when there
 * is no projection.
 */
export function readDraw(
  map: Map<string, number>,
  opts: {
    courseSlug: string | null | undefined;
    distanceF: number | null | undefined;
    draw: number | null | undefined;
    fieldSize: number | null | undefined;
    projected: string | null | undefined;
    declared: string | null | undefined;
  }
): DrawRead {
  const band = drawBandOf(opts.draw, opts.fieldSize);
  const dist = drawDistBand(opts.distanceF);
  if (!band || !dist || !opts.courseSlug) return NO_DRAW;

  const at = (going: string) => map.get(drawKey(String(opts.courseSlug), dist, going, band));

  const proj = opts.projected ?? opts.declared ?? "unknown";
  const onProjected = at(proj);
  if (onProjected !== undefined) return { iv: onProjected, goingBand: proj, pooled: false };

  const decl = opts.declared ?? "unknown";
  if (decl !== proj) {
    const onDeclared = at(decl);
    if (onDeclared !== undefined) return { iv: onDeclared, goingBand: decl, pooled: false };
  }

  const anyGoing = at(ANY_GOING);
  if (anyGoing !== undefined) return { iv: anyGoing, goingBand: null, pooled: true };

  return NO_DRAW;
}

/** How to describe a figure in prose without overclaiming what it measures. */
export function drawPhrase(d: DrawRead): string | null {
  if (d.iv === null) return null;
  const x = `${d.iv.toFixed(2)}x its share here`;
  return d.pooled ? `${x} over this trip, across all goings` : `${x} on ${d.goingBand}`;
}
