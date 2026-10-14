/**
 * Which horse a race offers up.
 *
 * Dan, 2026-10-14: "it's starting to annoy me today how out of 100 races only
 * 2 horses fit the criteria and one of them is 50/1."
 *
 * He was right, and the cause was the order two steps ran in. best-bets scored
 * every runner, took the single highest scorer per race, and only then asked
 * whether that horse was well handicapped, went on the ground and had won at
 * the distance. So a card of 100+ races was tested fourteen horses deep — one
 * per race — and a race was discarded whole whenever its top scorer failed.
 *
 * On 14 October GUNFIGHTER failed on 3lb and took the entire 17:30 Kempton
 * with it, PORT ROAD included: 1lb below the mark it won off, two wins at the
 * trip, two wins at the track, 3 from 24 on the surface, and the highest-rated
 * horse on the whole card at 14 points. It could not be selected because a
 * horse the score liked 3 points more was in the same race.
 *
 * That is backwards from the method. The method is to find the horses that are
 * well handicapped, go on the ground and have won at the distance, and then
 * rank those. The score ranks the qualifiers; it does not nominate the one
 * candidate the criteria get to vet.
 *
 * Two rules keep this from becoming the mirror-image bug:
 *
 *  - Surviving the funnel is necessary, not sufficient. A survivor with no
 *    positive evidence is not a selection, or we would be picking on the
 *    absence of an objection instead of on a case.
 *  - Where nothing survives, the top scorer still carries the race forward so
 *    the set-aside report names a horse and a reason, rather than the race
 *    vanishing from the card with nothing said.
 */

export interface RaceChoice<T> {
  /** The horse to put forward, or undefined when the race offers nothing. */
  chosen: T | undefined;
  /** True when `chosen` passed every hard test. False means it is set aside. */
  qualifies: boolean;
  /**
   * Runners the score rated above `chosen`, best first. These are set aside,
   * and they get printed: a reader cannot judge a pick without knowing the
   * model's own favourite was removed and on what grounds.
   */
  outranked: Array<{ item: T; by: number; why: string | null }>;
}

/**
 * Pick from a race.
 *
 * `ranked` must already be sorted best-score-first. `fail` returns null for a
 * runner that passes every hard test, or a short reason. `score` reads the
 * runner's score; only a positive score can be selected.
 */
export function chooseFromRace<T>(
  ranked: T[],
  fail: (x: T) => string | null,
  score: (x: T) => number
): RaceChoice<T> {
  if (!ranked.length) return { chosen: undefined, qualifies: false, outranked: [] };

  const survivor = ranked.find((x) => fail(x) === null && score(x) > 0);
  const chosen = survivor ?? ranked[0];
  const qualifies = survivor !== undefined;

  // Measured against the chosen horse's score, so a hand pick or a third-best
  // survivor reports honestly rather than against the field's top score.
  const chosenScore = score(chosen);
  const outranked = ranked
    .filter((x) => x !== chosen && score(x) > chosenScore)
    .map((x) => ({ item: x, by: score(x) - chosenScore, why: fail(x) }));

  return { chosen, qualifies, outranked };
}
