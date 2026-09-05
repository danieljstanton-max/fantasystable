/**
 * The staking plan.
 *
 *   1pt win        on anything 5/1 (6.0) or shorter
 *   0.5pt each-way on anything 11/2 (6.5) or bigger
 *
 * One point of outlay either way, which keeps the P/L readable: every bet
 * costs the same, so the return is directly comparable across the card.
 *
 * This lives in one module because three things consume it — the write-ups, the
 * best-bets file and the settler. If the advice and the accounting disagree
 * about what was staked, the record is worthless.
 */

/** 5/1. At or below this, back it to win. */
export const WIN_MAX_DEC = 6.0;

export type BetType = "win" | "ew" | "none";

export type Bet = {
  type: BetType;
  /** Points on the win part. */
  win: number;
  /** Points on the place part. Zero for a win bet. */
  place: number;
  /** Total outlay in points. Always 1. */
  total: number;
  /** How the advice reads in the write-up. */
  label: string;
};

/**
 * Which bet a price calls for.
 *
 * There is no gap to worry about: the next fractional price above 5/1 is 11/2,
 * so the boundary is clean. Anything a bookmaker prices between the two is
 * treated as a win bet, which is the more conservative reading.
 */
export function betFor(priceDec: number | null): Bet {
  // No price, no stake. The bet depends entirely on which side of 5/1 the price
  // falls, so advising one without a price is guessing.
  if (priceDec === null || !Number.isFinite(priceDec)) {
    return { type: "none", win: 0, place: 0, total: 0, label: "" };
  }
  if (priceDec <= WIN_MAX_DEC) {
    return { type: "win", win: 1, place: 0, total: 1, label: "1pt win" };
  }
  return { type: "ew", win: 0.5, place: 0.5, total: 1, label: "0.5pt each-way" };
}

export type PlaceTerms = {
  places: number;
  /** Fraction of the win odds paid on the place part. */
  fraction: number;
  label: string;
};

/**
 * Industry each-way terms.
 *
 * Handicaps of 12 or more pay a quarter rather than a fifth, and 16+ handicaps
 * pay four places. Getting this wrong overstates returns on exactly the big-field
 * handicaps this model is built to find, so it is worth being exact.
 */
export function placeTerms(field: number, isHandicap: boolean): PlaceTerms | null {
  if (field <= 4) return null; // win only
  if (field <= 7) return { places: 2, fraction: 1 / 4, label: "2 places at 1/4" };

  if (isHandicap) {
    if (field <= 11) return { places: 3, fraction: 1 / 5, label: "3 places at 1/5" };
    if (field <= 15) return { places: 3, fraction: 1 / 4, label: "3 places at 1/4" };
    return { places: 4, fraction: 1 / 4, label: "4 places at 1/4" };
  }

  return { places: 3, fraction: 1 / 5, label: "3 places at 1/5" };
}

export type Settlement = {
  outlay: number;
  returned: number;
  profit: number;
  note: string;
};

/**
 * Settle one bet.
 *
 * `position` is the finishing position, or null for a non-completion — a faller,
 * pulled up, unseated. Those lose; only a withdrawal returns the stake, and a
 * withdrawal never reaches here because it is voided upstream.
 */
export function settleBet(
  bet: Bet,
  priceDec: number | null,
  position: number | null,
  field: number,
  isHandicap: boolean
): Settlement {
  const outlay = bet.total;

  if (bet.type === "none" || priceDec === null) {
    return { outlay, returned: 0, profit: -outlay, note: "no price" };
  }

  const won = position === 1;

  if (bet.type === "win") {
    const returned = won ? bet.win * priceDec : 0;
    return { outlay, returned, profit: returned - outlay, note: won ? "won" : "lost" };
  }

  const terms = placeTerms(field, isHandicap);

  // A field too small for place terms means the each-way bet is not available;
  // the whole point goes on the win instead of half of it being unstakeable.
  if (!terms) {
    const returned = won ? outlay * priceDec : 0;
    return { outlay, returned, profit: returned - outlay, note: won ? "won (win only)" : "lost" };
  }

  const placed = position !== null && position <= terms.places;

  // The place part pays a fraction of the win odds. The stake itself comes back
  // on top, which is why it is (odds - 1) * fraction + 1.
  const placeOdds = (priceDec - 1) * terms.fraction + 1;

  const returned =
    (won ? bet.win * priceDec : 0) + (placed ? bet.place * placeOdds : 0);

  return {
    outlay,
    returned,
    profit: returned - outlay,
    note: won ? "won" : placed ? `placed (${terms.label})` : "lost",
  };
}
