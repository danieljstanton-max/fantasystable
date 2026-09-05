/**
 * Tip settlement and record maths.
 *
 * This file decides what the public track record says, so it is deliberately
 * boring, pure, and fully testable without a database. `npm run test:tips`
 * checks it against worked examples.
 *
 * Rules that are not negotiable:
 *
 * - Settlement derives from the runner's finishing position. Nothing here is
 *   ever hand-entered. A record you can edit is not a record.
 * - A non-runner voids the tip and returns the stake. Not a loss, not a win.
 * - The advised price settles the bet, never the SP. If we advised 7/2 and it
 *   went off 2/1, the record shows what a follower could actually have taken.
 * - A 1pt each-way bet stakes 1pt on the win and 1pt on the place: 2pt outlay.
 *   Reporting it as a 1pt bet halves the apparent stake and doubles the
 *   apparent ROI, which is the most common way tipping records flatter
 *   themselves.
 */

export type TipBetType = "win" | "each-way";
export type TipStatus = "pending" | "won" | "placed" | "lost" | "void";

export interface SettleableTip {
  betType: TipBetType;
  stakePoints: number;
  advisedPriceDec: number | null;
  ewPlaces?: number | null;
  ewFraction?: number | null;
}

export interface SettleableRunner {
  isNonRunner: boolean;
  positionNum: number | null;
  position: string | null;
}

export interface Settlement {
  status: TipStatus;
  outlayPoints: number;
  returnsPoints: number;
  profitPoints: number;
}

/**
 * Fractional odds to decimal, inclusive of stake. "7/2" -> 4.5, "evens" -> 2.
 *
 * Returns null rather than guessing. A tip with an unparseable price must fail
 * loudly at entry rather than settle at some default and quietly corrupt the
 * record.
 */
export function parsePrice(price: string | null | undefined): number | null {
  if (!price) return null;
  const s = String(price).trim().toLowerCase();

  if (s === "evens" || s === "evs" || s === "1/1") return 2;
  if (s === "sp") return null;

  const frac = s.match(/^(\d+(?:\.\d+)?)\s*[/-]\s*(\d+(?:\.\d+)?)$/);
  if (frac) {
    const num = parseFloat(frac[1]);
    const den = parseFloat(frac[2]);
    if (den === 0) return null;
    return num / den + 1;
  }

  // Already decimal, e.g. "4.5". Anything below 1 is not a price.
  const dec = parseFloat(s);
  if (Number.isFinite(dec) && dec > 1) return dec;

  return null;
}

/** Decimal back to the fractional string punters expect to read. */
export function formatPrice(dec: number | null | undefined): string | null {
  if (!dec || dec <= 1) return null;
  if (Math.abs(dec - 2) < 1e-9) return "evens";

  const target = dec - 1;
  const DENOMS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 25, 33, 40, 50, 66, 100];
  let best = { s: `${target.toFixed(2)}/1`, err: Infinity };
  for (const den of DENOMS) {
    const num = Math.round(target * den);
    if (num < 1) continue;
    const err = Math.abs(num / den - target);
    if (err < best.err - 1e-12) best = { s: `${num}/${den}`, err };
  }
  return best.s;
}

/**
 * Settle one tip against its runner.
 *
 * Returns `pending` while the race has no result, so an unsettled tip can
 * never be counted as a loss just because the results sweep has not run.
 */
export function settleTip(tip: SettleableTip, runner: SettleableRunner): Settlement {
  const isEw = tip.betType === "each-way";
  const stake = tip.stakePoints;
  const outlay = isEw ? stake * 2 : stake;

  // Withdrawn: stake back, no profit either way.
  if (runner.isNonRunner) {
    return { status: "void", outlayPoints: outlay, returnsPoints: outlay, profitPoints: 0 };
  }

  // No result yet.
  if (runner.position === null || runner.position === undefined || runner.position === "") {
    return { status: "pending", outlayPoints: outlay, returnsPoints: 0, profitPoints: 0 };
  }

  const dec = tip.advisedPriceDec;
  if (!dec || dec <= 1) {
    // Unpriced tips cannot be settled. Left pending and surfaced, rather than
    // silently scored at zero.
    return { status: "pending", outlayPoints: outlay, returnsPoints: 0, profitPoints: 0 };
  }

  // Non-completions (PU, F, UR, BD, RR, RO) have no positionNum and lose.
  const pos = runner.positionNum;
  const finished = typeof pos === "number" && Number.isFinite(pos) && pos > 0;

  let returns = 0;
  if (finished && pos === 1) returns += stake * dec;

  if (isEw) {
    const places = tip.ewPlaces ?? 0;
    const fraction = tip.ewFraction ?? 0;
    if (finished && places > 0 && fraction > 0 && pos <= places) {
      returns += stake * (1 + (dec - 1) * fraction);
    }
  }

  const status: TipStatus =
    finished && pos === 1 ? "won" : returns > 0 ? "placed" : "lost";

  return {
    status,
    outlayPoints: round2(outlay),
    returnsPoints: round2(returns),
    profitPoints: round2(returns - outlay),
  };
}

export interface RecordRow {
  status: TipStatus;
  outlayPoints: number | null;
  returnsPoints: number | null;
  profitPoints: number | null;
}

export interface TipRecord {
  settled: number;
  pending: number;
  wins: number;
  places: number;
  losses: number;
  voids: number;
  stakedPoints: number;
  returnedPoints: number;
  profitPoints: number;
  /** Return on outlay, as a percentage. Null when nothing has been staked. */
  roiPercent: number | null;
  strikeRatePercent: number | null;
}

/**
 * Aggregate settled tips into the numbers shown publicly.
 *
 * Voids are excluded from staked and from strike rate. Including them in the
 * denominator would understate the strike rate; including their returned stake
 * in turnover would flatter ROI. They are counted and reported separately so
 * the arithmetic can be checked by anyone who cares to.
 */
export function computeRecord(rows: RecordRow[]): TipRecord {
  let wins = 0, places = 0, losses = 0, voids = 0, pending = 0;
  let staked = 0, returned = 0;

  for (const r of rows) {
    if (r.status === "pending") { pending++; continue; }
    if (r.status === "void") { voids++; continue; }

    if (r.status === "won") wins++;
    else if (r.status === "placed") places++;
    else losses++;

    staked += r.outlayPoints ?? 0;
    returned += r.returnsPoints ?? 0;
  }

  const settled = wins + places + losses;
  const profit = returned - staked;

  return {
    settled,
    pending,
    wins,
    places,
    losses,
    voids,
    stakedPoints: round2(staked),
    returnedPoints: round2(returned),
    profitPoints: round2(profit),
    roiPercent: staked > 0 ? round2((profit / staked) * 100) : null,
    strikeRatePercent: settled > 0 ? round2((wins / settled) * 100) : null,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
