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
 * `weight_lbs` is the ALLOTTED weight, before the rider's claim comes off it,
 * so the claim must NOT be added back. Dan, 2026-10-08: "parisiac runs off 75."
 * He did. Adding his jockey's 3lb claim put him on 78 and invented a rise that
 * did not exist — the error was exactly the size of the claim, on exactly the
 * one runner in the field who had one. The claim already has its own meaning
 * elsewhere: `effectiveMark()` in lib/mappers.ts is the mark adjusted DOWN for
 * a claim, which is a different question from the one asked here.
 *
 * Two things still move a horse off the line legitimately: a penalty for a win
 * since the weights were published puts it above, and a horse racing from out
 * of the handicap carries the minimum, which puts it below. Both are usually a
 * pound or two, so a drift under 2lb is treated as noise and not reported — on
 * 8 October three runners in one Ayr handicap sat 1lb off the line with nothing
 * wrong with any of them.
 *
 * Only a clear majority sets the line. Where the field does not agree, nothing
 * is offered and the published mark stands — a guess here would be worse than
 * the staleness it replaces.
 */

/** Below this, a horse off the line is long-handicap noise, not a stale mark. */
const MIN_DRIFT_LBS = 2;

export interface MarkInput {
  /** The rating the racecard publishes. */
  ofr: number | null | undefined;
  /** Weight carried, in pounds, as declared. */
  weightLbs: number | null | undefined;
  /** The rider's claim, which came off the carried weight. */
  claim?: number | null;
  /**
   * The horse's age. Required in any race open to more than one age group —
   * see fieldOffset() for why reading one line across ages invents a mark.
   */
  age?: number | null;
}

export interface MarkRead {
  /** The published rating, unchanged. */
  published: number | null;
  /** What the carried weight says the mark is, or null if the field is unclear. */
  effective: number | null;
  /** effective - published, when both are known. */
  drift: number | null;
}

/** Weight the horse was allotted. `weight_lbs` already is that figure. */
function allotted(r: MarkInput): number | null {
  if (r.weightLbs === null || r.weightLbs === undefined) return null;
  return Number(r.weightLbs);
}

/**
 * The offset between allotted weight and mark that most of this field shares.
 *
 * Returns null unless a clear majority agrees — six runners with six different
 * offsets describe a race whose weights we cannot read, not a race where every
 * mark is wrong.
 */
export function fieldOffset(field: MarkInput[], age?: number | null): number | null {
  // Weight-for-age is not a reassessment.
  //
  // Dan, 2026-10-16: MONOCEROS was NAP on tomorrow's card. It won off 81 on
  // 5 September and runs off 84 — 3lb ABOVE its winning mark, which markGate
  // stops. It was not stopped, because this function had already moved its
  // mark to 81 and made it level.
  //
  // The 14:17 Haydock is a 3yo+ handicap over a mile in October. Every
  // three-year-old in it carried 3lb less than its rating implies and every
  // older horse carried exactly what it implies:
  //
  //     age 3  offset 48   (VIPER, MONOCEROS, FOOD FOR THOUGHT)
  //     age 4+ offset 51   (everything else)
  //
  // That 3lb is the weight-for-age allowance, a published scale that varies by
  // age, distance and time of year. One line read across the whole field makes
  // the older majority the baseline and every younger horse look reassessed —
  // and the error runs one way, always flattering the younger horse, which is
  // exactly the shape the method hunts for. The same bias that made this module
  // necessary, arriving through the module itself.
  //
  // So a runner is read against the line its OWN age group is on. A horse alone
  // in its age group is its own baseline, which means no correction rather than
  // a false one: missing a reassessment is a cost worth paying to avoid
  // inventing a mark. Where age is not known, the whole field is used, which is
  // the old behaviour and correct in an age-restricted race.
  const cohort =
    age === null || age === undefined
      ? field
      : field.filter((r) => r.age === age);
  const pool = cohort.length ? cohort : field;

  const counts = new Map<number, number>();
  let usable = 0;
  for (const r of pool) {
    const a = allotted(r);
    if (a === null || r.ofr === null || r.ofr === undefined || Number(r.ofr) <= 0) continue;
    usable++;
    const o = a - Number(r.ofr);
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }

  // The whole-field minimum still applies: five runners is the point at which a
  // line means anything. Inside an age group we only need the group to agree
  // with itself, because the group is the line.
  const multiAge = field.some((r) => r.age !== null && r.age !== undefined)
    && new Set(field.map((r) => r.age).filter((a) => a !== null && a !== undefined)).size > 1;
  const floor = multiAge && pool !== field ? 1 : 5;
  if (usable < floor) return null;

  let best: number | null = null;
  let bestN = 0;
  for (const [o, n] of counts) {
    if (n > bestN) { best = o; bestN = n; }
  }
  if (best === null) return null;

  // A bare plurality is not enough: it has to be the line the group is on.
  const needed = pool === field && !multiAge
    ? Math.max(3, Math.ceil(usable * 0.5))
    : Math.max(1, Math.ceil(usable * 0.5));
  return bestN >= needed ? best : null;
}

/** Read one runner's mark against the line its own field is on. */
/**
 * True when the field holds more than one age group, so weight-for-age is in
 * play and a single weight line cannot be read across it.
 */
export function isMixedAge(field: MarkInput[]): boolean {
  const ages = new Set(
    field.map((r) => r.age).filter((a) => a !== null && a !== undefined)
  );
  return ages.size > 1;
}

/**
 * True when no runner carries an age. Callers that may be handed a mixed-age
 * race should treat this as a fault rather than a shrug: without ages this
 * falls back to one line for the whole field, which is the behaviour that
 * dropped every three-year-old's mark by the weight-for-age allowance.
 */
export function ageMissing(field: MarkInput[]): boolean {
  return field.length > 0 && field.every((r) => r.age === null || r.age === undefined);
}

export function readMark(field: MarkInput[], runner: MarkInput): MarkRead {
  const published = runner.ofr === null || runner.ofr === undefined ? null : Number(runner.ofr);
  const offset = fieldOffset(field, runner.age);
  const a = allotted(runner);
  if (offset === null || a === null) return { published, effective: null, drift: null };
  const effective = a - offset;
  const drift = published === null ? null : effective - published;
  // A pound either way is the long handicap, not a reassessment.
  if (drift !== null && Math.abs(drift) < MIN_DRIFT_LBS) {
    return { published, effective: published, drift: 0 };
  }
  return { published, effective, drift };
}

/**
 * The mark to score and to print: the weight's answer where the field is clear,
 * the published rating otherwise.
 *
 * NOT `effectiveMark` — lib/mappers.ts already uses that name for the mark
 * adjusted down by a rider's claim, which is a different question.
 */
export function markFromWeights(field: MarkInput[], runner: MarkInput): number | null {
  const m = readMark(field, runner);
  return m.effective ?? m.published;
}
