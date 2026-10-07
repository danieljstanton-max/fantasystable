/**
 * The mark a horse is actually running off today.
 *
 * Dan, 2026-10-07, on tomorrow's NAP: "he runs off 85 tomorrow." He did. The
 * API said 80.
 *
 * `ofr` on a racecard is the rating the horse held when the entry was taken.
 * When a horse wins, the handicapper reassesses it, and that new figure reaches
 * the weights before it reaches the rating field. NOSTRUM won off 80 on
 * 3 October, was put up 5lb, and went into the 8 October card still showing 80
 * while carrying 143lb — top weight, and 5lb more than an 80 would get.
 *
 * The bias runs one way and it runs straight at us. The model rewards "won last
 * time out", then compares today's mark with the mark it last won off and finds
 * them level — which reads as the handicapper not having caught up. For a
 * recent winner that is always false. Both NOSTRUM and ONE NIGHT THUNDER were
 * selected on 8 October that way, each 5lb higher than we believed, and the
 * three selections that had not won last time had no discrepancy at all.
 *
 * The weights do not lie, because the weights are what the horse carries. In a
 * handicap, allotted weight is a fixed offset from the mark across the whole
 * field, so the field itself tells us the offset and anything standing outside
 * it is carrying a mark we do not hold.
 *
 * Three things break the naive version, and all three are handled here:
 *
 *   - an apprentice's claim comes OFF the carried weight, so it is added back
 *     before the comparison;
 *   - a penalty for a win since the weights were published puts a horse above
 *     the line, which is a real extra and not a stale mark;
 *   - a horse racing from out of the handicap carries the minimum, which puts
 *     it below the line.
 *
 * Only a clear majority sets the line. Where the field does not agree, no
 * effective mark is offered and the published one stands — a guess here would
 * be worse than the staleness it replaces.
 */

export interface MarkInput {
  /** The rating the racecard publishes. */
  ofr: number | null | undefined;
  /** Weight carried, in pounds, as declared. */
  weightLbs: number | null | undefined;
  /** The rider's claim, which came off the carried weight. */
  claim?: number | null;
}

export interface MarkRead {
  /** The published rating, unchanged. */
  published: number | null;
  /** What the carried weight says the mark is, or null if the field is unclear. */
  effective: number | null;
  /** effective - published, when both are known. */
  drift: number | null;
}

/** Weight the horse was allotted, before the rider's claim came off it. */
function allotted(r: MarkInput): number | null {
  if (r.weightLbs === null || r.weightLbs === undefined) return null;
  return Number(r.weightLbs) + Number(r.claim ?? 0);
}

/**
 * The offset between allotted weight and mark that most of this field shares.
 *
 * Returns null unless a clear majority agrees — six runners with six different
 * offsets describe a race whose weights we cannot read, not a race where every
 * mark is wrong.
 */
export function fieldOffset(field: MarkInput[]): number | null {
  const counts = new Map<number, number>();
  let usable = 0;
  for (const r of field) {
    const a = allotted(r);
    if (a === null || r.ofr === null || r.ofr === undefined || Number(r.ofr) <= 0) continue;
    usable++;
    const o = a - Number(r.ofr);
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  if (usable < 5) return null;

  let best: number | null = null;
  let bestN = 0;
  for (const [o, n] of counts) {
    if (n > bestN) { best = o; bestN = n; }
  }
  // A bare plurality is not enough: it has to be the line the field is on.
  return bestN >= Math.max(3, Math.ceil(usable * 0.5)) ? best : null;
}

/** Read one runner's mark against the line its own field is on. */
export function readMark(field: MarkInput[], runner: MarkInput): MarkRead {
  const published = runner.ofr === null || runner.ofr === undefined ? null : Number(runner.ofr);
  const offset = fieldOffset(field);
  const a = allotted(runner);
  if (offset === null || a === null) return { published, effective: null, drift: null };
  const effective = a - offset;
  return {
    published,
    effective,
    drift: published === null ? null : effective - published,
  };
}

/**
 * The mark to score and to print: the weight's answer where the field is clear,
 * the published rating otherwise.
 */
export function effectiveMark(field: MarkInput[], runner: MarkInput): number | null {
  const m = readMark(field, runner);
  return m.effective ?? m.published;
}
