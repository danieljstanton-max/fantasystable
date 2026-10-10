/**
 * Going is a scale, not a set of buckets.
 *
 * Dan, 2026-10-10, on KEKE being dropped for having no win on soft: "KEKE has
 * won on heavy — that's softer than soft so of course he will be ok."
 *
 * He is right, and the shortlist was asking the wrong question. It tested for
 * a win on today's exact band and found 0 from 2 on soft, while the horse had
 * won on HEAVY — ground more testing than today's, which is the stronger proof,
 * not a weaker one — and on good-to-soft as well. It had won on the band either
 * side of today's and was thrown out for the gap in the middle.
 *
 * The rule, stated the way he stated it: ground more testing than today's
 * proves today's. A horse that goes on heavy will go on soft.
 *
 * It does not run the other way. Winning on heavy says nothing about firm — a
 * mud-loving stayer can be hopeless on quick ground — so on the dry half of the
 * scale the proof has to come from ground at least as quick. Good sits in the
 * middle and takes either neighbour.
 *
 * All-weather is off this scale entirely, as it is everywhere else in this
 * codebase: Tapeta is not a point on the turf axis.
 */

/** Dry to wet. Index order is the whole point. */
export const TURF_SCALE = [
  "firm", "good-firm", "good", "good-soft", "soft", "heavy",
] as const;

export const AW_SCALE = ["standard-fast", "standard", "standard-slow"] as const;

export type Band = string;

const idx = (scale: readonly string[], b: Band) => scale.indexOf(String(b));

/**
 * Bands whose form counts as proof for `today`.
 *
 * On testing ground: today's band and anything wetter.
 * On quick ground:   today's band and anything quicker.
 * On good:           today's band and both neighbours.
 */
export function provingBands(today: Band): Band[] {
  const aw = idx(AW_SCALE, today);
  if (aw >= 0) return [...AW_SCALE];        // the AW bands are close enough to each other

  const i = idx(TURF_SCALE, today);
  if (i < 0) return [today];

  const good = idx(TURF_SCALE, "good");
  if (i > good) return TURF_SCALE.slice(i);                 // soft, heavy: wetter proves it
  if (i < good) return TURF_SCALE.slice(0, i + 1);          // firm, good-firm: quicker proves it
  return TURF_SCALE.slice(good - 1, good + 2);              // good: either neighbour
}

/** Has it won on ground that proves today's? */
export function hasProvenWin(
  runs: { goingBand: Band | null; positionNum: number | null }[],
  today: Band
): boolean {
  const ok = new Set(provingBands(today));
  return runs.some((r) => Number(r.positionNum) === 1 && r.goingBand && ok.has(String(r.goingBand)));
}
