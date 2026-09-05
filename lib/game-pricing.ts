/**
 * Pricing and scoring for the Saturday fantasy game ("Stable").
 *
 * Six horses and two jockeys from £100m, picked off one curated Saturday card.
 * Everything here is pure — no database, no API — so the pricer, the scorer and
 * the backtest all run the same arithmetic. Two implementations of a price is
 * how a leaderboard ends up disagreeing with the page that sold the horse.
 *
 * ## The one thing to know
 *
 * The horse price curve is CONVEX in win probability, and that is deliberate.
 * Backtested over 102 GB/IRE weekend cards (2025-09 to 2026-08), a price curve
 * linear in probability produces no game at all: expected points are also
 * linear in probability, so every horse is identical value, the optimal stable
 * is six flat mid-priced horses, and skilled play beat naive favourite-buying
 * by 5.6 points. Raising the curve to p^1.6 lifted that gap to 19.0 ± 2.9.
 *
 * Anything in the range p^1.4 to p^2.0 works; 102 weekends cannot separate them
 * more finely than that. Do not flatten this curve back towards linear on the
 * grounds that it "should" track the market. Tracking the market is exactly
 * what kills it.
 *
 * Two consequences fall out of the convexity, and both are load-bearing:
 *
 *   1. A genuine top price. One £45m star forces five £7-9m squad horses, and
 *      £25m+ horses routinely have to be passed over. That is the tension the
 *      whole game runs on.
 *   2. Expected points are CONCAVE in price (the exponent inverts to 0.625), so
 *      spreading value beats concentrating it. £7.5m + £7.5m is worth 5.58
 *      expected points against 4.49 for £10m + £5m — the same £15m. That is
 *      what makes selling a steamer and rebuying balanced a real move rather
 *      than a wash, and it is the entire justification for the sales mechanic.
 *
 * ## Jockeys are linear, and that is not an inconsistency
 *
 * A jockey's expected points are a plain sum over their rides, so there is no
 * fat upside to charge for and convex pricing just makes them unbuyable (at
 * p^1.6 a top book priced at £81m and every optimal team bought £4m
 * journeymen). But the SLOPE and the SCORING have to move together, and it is
 * easy to break the slot in either direction:
 *
 *   - At `2 + 9J` jockeys took 2 of 8 squad slots for ~20% of budget. Every
 *     team instantly bought the two best available and never thought about them
 *     again. Dead slot.
 *   - At `2 + 18J` with only 6 points a winner, a top rider returns ~0.31
 *     points per £m against ~0.41 for a horse, so every team buys the two
 *     CHEAPEST riders on the card instead. Also a dead slot, in the other
 *     direction — this is what the first build of the pitch view actually did.
 *
 * The pair that works is `2 + 18J` with 8 points a winner: the top book costs
 * ~£22m and returns about what a mid-priced horse does, so paying up for a
 * rider is a genuine choice. Change one of those two numbers and you have to
 * re-check the other.
 */

/** Total squad budget, in £m. */
export const BUDGET = 100;

export const N_HORSES = 6;
export const N_JOCKEYS = 2;
/** Ranked substitutes, used only to replace a non-runner. They cost budget. */
export const N_RESERVES = 2;
/** "Go to the Sales" — sell at market value, rebuy with the proceeds. */
export const N_SALES = 2;

/** Horse curve: price = HORSE_BASE + HORSE_SCALE * p ^ HORSE_GAMMA. */
export const HORSE_BASE = 5;
export const HORSE_SCALE = 104;
export const HORSE_GAMMA = 1.6;
export const HORSE_MIN = 5;
export const HORSE_MAX = 45;

/** Jockey curve: price = JOCKEY_BASE + JOCKEY_SLOPE * J. */
export const JOCKEY_BASE = 2;
export const JOCKEY_SLOPE = 18;
export const JOCKEY_MIN = 2;
export const JOCKEY_MAX = 30;

/** Points for finishing first, before the starting-price bonus. */
export const WIN_POINTS = 25;
/** Places pay 2nd through 5th. Steep, because placing is not the job. */
export const PLACE_POINTS: Record<number, number> = { 2: 12, 3: 7, 4: 4, 5: 2 };
/** Pulled up, fell, unseated, brought down, refused. */
export const NON_COMPLETION_POINTS = -5;
/** The NAP scores double. One per stable. */
export const NAP_MULTIPLIER = 2;

/** Position strings the API returns for a horse that did not complete. */
const NON_COMPLETIONS = new Set([
  "PU", "F", "UR", "BD", "SU", "RR", "REF", "DSQ", "VOI", "CO", "LFT",
]);

/** Prices are quoted to the nearest half-million. */
const toHalf = (n: number) => Math.round(n * 2) / 2;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Strip the overround from a race's prices.
 *
 * Implied probabilities from a bookmaker's board sum to 1.15-1.25, and the
 * excess scales with field size. Pricing off the raw implied number would make
 * a runner in a 20-runner handicap systematically dearer than the same chance
 * in a 5-runner novice chase, for no reason a player could ever discover.
 *
 * Proportional normalisation, not Shin. It under-corrects the favourite-longshot
 * bias, but it is explainable to a punter in one sentence, which matters more
 * here than the last half-percent of accuracy.
 */
export function deOverround(decimalOdds: number[]): number[] {
  const implied = decimalOdds.map((d) => (d > 1 ? 1 / d : 0));
  const book = implied.reduce((sum, x) => sum + x, 0);
  if (book <= 0) throw new Error("deOverround: no usable prices in this race");
  return implied.map((x) => x / book);
}

/**
 * The book percentage, as a sanity check on a race before it is priced.
 *
 * A partially-populated race — say four of twelve runners carrying an opening
 * price — produces a book far below 1.0, which inflates every probability and
 * silently prices a 12/1 shot like a favourite. Callers should refuse to price
 * any race whose book falls outside roughly 1.02-1.60.
 */
export function bookPercentage(decimalOdds: number[]): number {
  return decimalOdds.reduce((sum, d) => sum + (d > 1 ? 1 / d : 0), 0);
}

/** What a horse costs, from its de-overrounded win probability. */
export function horsePrice(p: number): number {
  const raw = HORSE_BASE + HORSE_SCALE * Math.pow(Math.max(p, 0), HORSE_GAMMA);
  return clamp(toHalf(raw), HORSE_MIN, HORSE_MAX);
}

/**
 * What a jockey costs.
 *
 * `bookStrength` is the sum of de-overrounded win probabilities across every
 * ride the jockey holds on the game card. One number covers both halves of
 * "how many rides, and how good are they" — six moderate rides summing to 1.2
 * and two strong ones summing to 1.2 are genuinely worth the same, and price
 * the same. Because of the floor, a bigger book is always better value per £m,
 * so the standing advice is to buy the biggest book you can afford.
 */
export function jockeyPrice(bookStrength: number): number {
  const raw = JOCKEY_BASE + JOCKEY_SLOPE * Math.max(bookStrength, 0);
  return clamp(toHalf(raw), JOCKEY_MIN, JOCKEY_MAX);
}

/**
 * Bonus points on a winner, by its starting price.
 *
 * Banded rather than continuous because a player has to be able to read it off
 * a card. The bands approximate 0.4 points per point of fractional odds, which
 * was the value that made points-per-£m exactly flat under the earlier linear
 * price curve. Under the convex curve value is deliberately no longer flat, but
 * 0.4 is retained: every backtest reported above ran on it, and it behaved.
 */
export function startingPriceBonus(decimalOdds: number): number {
  const fractional = decimalOdds - 1;
  if (fractional < 3) return 0;
  if (fractional < 8) return 2;
  if (fractional < 16) return 5;
  if (fractional < 28) return 9;
  return 14;
}

export type RunnerResult = {
  /** Finishing position, or null if the horse did not complete. */
  positionNum: number | null;
  /** Raw position string from the API — "1", "PU", "F". */
  position: string | null;
  /** Starting price, decimal. */
  spDec: number | null;
  isNonRunner: boolean;
};

/**
 * What a horse scored.
 *
 * A non-runner scores zero and is replaced by the stable's next reserve. It is
 * never a negative: a player cannot be punished for a withdrawal declared after
 * the sales window shut, and horses are vetted out right up to the off.
 */
/**
 * @param deadHeatShare how many horses shared this finishing position. 1 for
 *   a normal result; 2 or more for a dead heat. Points are divided equally,
 *   matching how a bookmaker settles the same finish.
 */
export function horsePoints(result: RunnerResult, deadHeatShare = 1): number {
  if (result.isNonRunner) return 0;

  const div = Math.max(1, deadHeatShare);

  if (result.positionNum === 1) {
    return (WIN_POINTS + startingPriceBonus(result.spDec ?? 1)) / div;
  }
  if (result.positionNum && PLACE_POINTS[result.positionNum] !== undefined) {
    return PLACE_POINTS[result.positionNum] / div;
  }
  if (result.positionNum) return 0;

  const code = result.position?.toUpperCase().trim();
  if (code && NON_COMPLETIONS.has(code)) return NON_COMPLETION_POINTS;
  return 0;
}

/**
 * Jockeys score off finishing position only — no starting-price bonus.
 *
 * Eight for a winner, not six. At six, a jockey returns at best ~0.31 points
 * per £m against ~0.41 for a horse, so the optimiser buys the two cheapest
 * riders on the card and the slot is dead — which is exactly as broken as
 * everyone buying the same two best riders, just in the other direction. Eight
 * puts a top book (J ≈ 1.1, ~£22m) level with a mid-priced horse, so paying up
 * for a rider becomes a real choice rather than a mistake.
 *
 * This was set from a single card and needs confirming once there are real
 * Saturday snapshots to test it against.
 */
export const JOCKEY_POINTS: Record<number, number> = { 1: 8, 2: 3, 3: 1 };

/**
 * Sum jockey points across a batch of rides. Each ride may carry an optional
 * `deadHeatShare` — a ride in a dead heat is worth half (or a third).
 */
export type JockeyRide = RunnerResult & { deadHeatShare?: number };
export function jockeyPoints(results: JockeyRide[]): number {
  return results.reduce((sum, r) => {
    if (r.isNonRunner || !r.positionNum) return sum;
    const base = JOCKEY_POINTS[r.positionNum] ?? 0;
    const div = Math.max(1, r.deadHeatShare ?? 1);
    return sum + base / div;
  }, 0);
}

/**
 * Expected points for a horse, used by the pricer and the optimiser.
 *
 * Approximates the starting-price bonus as 0.4 per point of fractional odds
 * rather than walking the bands, because in expectation those agree closely and
 * the smooth form is what makes the curve analysis above tractable.
 */
export function expectedPoints(p: number): number {
  return p * WIN_POINTS + 0.4 * (1 - p);
}
