/**
 * Turning a day's runners into a Stable game card.
 *
 * Pure. Callers do their own query and hand the rows in — the script reaches
 * for postgres-js and the page uses drizzle, and neither should own the rules
 * about which races are playable. Those rules are the product: get them wrong
 * in one place and the leaderboard settles against a card the page never
 * showed.
 */

import {
  BUDGET,
  JOCKEY_POINTS,
  N_HORSES,
  N_JOCKEYS,
  bookPercentage,
  deOverround,
  expectedPoints,
  horsePrice,
  jockeyPrice,
} from "./game-pricing";

/** Every runner must carry near-complete opening prices for a race to play. */
const MIN_COVERAGE = 0.95;
/** Below 100% is an arbitrage, so the data is wrong. Above 160% is a part-priced race. */
const MIN_BOOK = 1.0;
const MAX_BOOK = 1.6;

export type GameRunnerInput = {
  raceId: string;
  courseName: string;
  raceName: string;
  offTime: string;
  prizeValue: number | null;
  horseId: string;
  horseName: string;
  jockeyId: string | null;
  jockeyName: string | null;
  trainerName: string | null;
  silkUrl: string | null;
  openingOddsDec: number | null;
  openingOddsFrac: string | null;
  isNonRunner: boolean;
};

export type PricedRunner = {
  raceId: string;
  horseId: string;
  horse: string;
  jockeyId: string | null;
  jockey: string | null;
  trainer: string | null;
  silkUrl: string | null;
  oddsDec: number;
  frac: string;
  /** De-overrounded win probability. */
  p: number;
  price: number;
};

export type GameRace = {
  raceId: string;
  course: string;
  name: string;
  offTime: string;
  prizeValue: number | null;
  runners: PricedRunner[];
};

export type GameJockey = {
  id: string;
  name: string;
  rides: number;
  /** Sum of win probabilities across their rides on this card. */
  strength: number;
  price: number;
};

export type GameCard = {
  date: string;
  races: GameRace[];
  jockeys: GameJockey[];
  dropped: { race: string; why: string }[];
};

export type Stable = {
  horses: PricedRunner[];
  jockeys: GameJockey[];
  /** The horse carrying the double. */
  nap: PricedRunner | null;
  spend: number;
  bank: number;
  expectedPoints: number;
};

export function buildCard(
  rows: GameRunnerInput[],
  opts: { date: string; races?: number; meetings?: number } = { date: "" }
): GameCard {
  const wantRaces = opts.races ?? 12;
  const wantMeetings = opts.meetings ?? 4;

  const races = new Map<string, GameRunnerInput[]>();
  for (const row of rows) {
    const existing = races.get(row.raceId);
    if (existing) existing.push(row);
    else races.set(row.raceId, [row]);
  }

  // The richest meetings, then the richest races within them. A curated card is
  // the whole point — six horses from a 400-runner Saturday is a phone book.
  const meetingPrize = new Map<string, number>();
  for (const runners of races.values()) {
    const r = runners[0];
    meetingPrize.set(r.courseName, (meetingPrize.get(r.courseName) ?? 0) + (r.prizeValue ?? 0));
  }
  const chosen = new Set(
    [...meetingPrize.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, wantMeetings)
      .map(([course]) => course)
  );

  const candidates = [...races.values()]
    .filter((runners) => chosen.has(runners[0].courseName))
    .sort((a, b) => (b[0].prizeValue ?? 0) - (a[0].prizeValue ?? 0));

  const out: GameRace[] = [];
  const dropped: { race: string; why: string }[] = [];

  for (const runners of candidates) {
    if (out.length >= wantRaces) break;

    const meta = runners[0];
    const label = `${meta.courseName} ${meta.offTime}`;
    const live = runners.filter((r) => !r.isNonRunner);
    const priced = live.filter((r) => (r.openingOddsDec ?? 0) > 1);

    if (live.length < 4) {
      dropped.push({ race: label, why: `only ${live.length} live runners` });
      continue;
    }
    if (priced.length < live.length * MIN_COVERAGE) {
      dropped.push({ race: label, why: `opening prices for ${priced.length}/${live.length}` });
      continue;
    }
    const book = bookPercentage(priced.map((r) => r.openingOddsDec!));
    if (book < MIN_BOOK || book > MAX_BOOK) {
      dropped.push({ race: label, why: `book is ${(book * 100).toFixed(0)}%` });
      continue;
    }

    const probs = deOverround(priced.map((r) => r.openingOddsDec!));
    out.push({
      raceId: meta.raceId,
      course: meta.courseName,
      name: meta.raceName,
      offTime: meta.offTime,
      prizeValue: meta.prizeValue,
      runners: priced
        .map((r, i) => ({
          raceId: r.raceId,
          horseId: r.horseId,
          horse: r.horseName,
          jockeyId: r.jockeyId,
          jockey: r.jockeyName,
          trainer: r.trainerName,
          silkUrl: r.silkUrl,
          oddsDec: r.openingOddsDec!,
          frac: r.openingOddsFrac ?? `${(r.openingOddsDec! - 1).toFixed(1)}/1`,
          p: probs[i],
          price: horsePrice(probs[i]),
        }))
        .sort((a, b) => b.price - a.price),
    });
  }

  // Jockeys are priced on their book across the game card only. Rides elsewhere
  // on the day cannot score, so they cannot cost anything either.
  const books = new Map<string, GameJockey>();
  for (const race of out) {
    for (const runner of race.runners) {
      if (!runner.jockey) continue;
      const key = runner.jockeyId ?? runner.jockey;
      const entry = books.get(key) ?? {
        id: key,
        name: runner.jockey,
        rides: 0,
        strength: 0,
        price: 0,
      };
      entry.rides += 1;
      entry.strength += runner.p;
      books.set(key, entry);
    }
  }
  const jockeys = [...books.values()]
    .map((j) => ({ ...j, price: jockeyPrice(j.strength) }))
    .sort((a, b) => b.price - a.price);

  return { date: opts.date, races: out, jockeys, dropped };
}

/**
 * The best stable the card allows, by expected points.
 *
 * A knapsack over budget, at half-million granularity, with one horse per race
 * and a flag tracking whether the NAP has been spent. The NAP is what makes an
 * expensive horse worth its price — the same reason FPL prices Haaland for the
 * fact you will captain him — so it has to be inside the optimisation rather
 * than picked afterwards.
 *
 * Jockeys are handled by solving the horses at every possible budget and then
 * choosing the split, rather than by re-solving inside a loop over jockey
 * pairs. Same answer, one pass instead of hundreds.
 */
export function pickStable(card: GameCard, budget = BUDGET): Stable {
  const UNIT = 2; // half-millions
  const cap = Math.round(budget * UNIT);
  const empty: Stable = {
    horses: [],
    jockeys: [],
    nap: null,
    spend: 0,
    bank: budget,
    expectedPoints: 0,
  };
  if (card.races.length < N_HORSES || card.jockeys.length < N_JOCKEYS) return empty;

  // Best pair of jockeys at or under each budget level.
  const jockeyValue = new Float64Array(cap + 1).fill(-Infinity);
  const jockeyPick: (GameJockey[] | null)[] = new Array(cap + 1).fill(null);
  const pool = card.jockeys.slice(0, 30);
  for (let a = 0; a < pool.length; a++) {
    for (let b = a + 1; b < pool.length; b++) {
      const cost = Math.round((pool[a].price + pool[b].price) * UNIT);
      if (cost > cap) continue;
      const value = JOCKEY_POINTS[1] * (pool[a].strength + pool[b].strength);
      if (value > jockeyValue[cost]) {
        jockeyValue[cost] = value;
        jockeyPick[cost] = [pool[a], pool[b]];
      }
    }
  }
  let runningBest = -Infinity;
  let runningPick: GameJockey[] | null = null;
  for (let c = 0; c <= cap; c++) {
    if (jockeyValue[c] > runningBest) {
      runningBest = jockeyValue[c];
      runningPick = jockeyPick[c];
    }
    jockeyValue[c] = runningBest;
    jockeyPick[c] = runningPick;
  }

  // Horses: value[picked][napUsed][spend].
  const NEG = -Infinity;
  let value = Array.from({ length: N_HORSES + 1 }, () =>
    Array.from({ length: 2 }, () => new Float64Array(cap + 1).fill(NEG))
  );
  let picks: (PricedRunner[] | null)[][][] = Array.from({ length: N_HORSES + 1 }, () =>
    Array.from({ length: 2 }, () => new Array<PricedRunner[] | null>(cap + 1).fill(null))
  );
  value[0][0].fill(0);
  picks[0][0].fill([]);

  for (const race of card.races) {
    const nextValue = value.map((k) => k.map((n) => Float64Array.from(n)));
    const nextPicks = picks.map((k) => k.map((n) => n.slice()));
    for (let k = 0; k < N_HORSES; k++) {
      for (let nap = 0; nap < 2; nap++) {
        for (let b = 0; b <= cap; b++) {
          const base = value[k][nap][b];
          if (base === NEG) continue;
          const chosen = picks[k][nap][b] as PricedRunner[];
          for (const runner of race.runners) {
            const cost = Math.round(runner.price * UNIT);
            if (b + cost > cap) continue;
            const pts = expectedPoints(runner.p);
            if (base + pts > nextValue[k + 1][nap][b + cost]) {
              nextValue[k + 1][nap][b + cost] = base + pts;
              nextPicks[k + 1][nap][b + cost] = [...chosen, runner];
            }
            // Or take this one as the NAP, for double.
            if (nap === 0 && base + 2 * pts > nextValue[k + 1][1][b + cost]) {
              nextValue[k + 1][1][b + cost] = base + 2 * pts;
              nextPicks[k + 1][1][b + cost] = [...chosen, runner];
            }
          }
        }
      }
    }
    value = nextValue;
    picks = nextPicks;
  }

  let best = NEG;
  let bestHorses: PricedRunner[] | null = null;
  let bestJockeys: GameJockey[] | null = null;
  for (let hb = 0; hb <= cap; hb++) {
    if (value[N_HORSES][1][hb] === NEG) continue;
    const jb = cap - hb;
    if (jb < 0 || jockeyValue[jb] === -Infinity) continue;
    const total = value[N_HORSES][1][hb] + jockeyValue[jb];
    if (total > best) {
      best = total;
      bestHorses = picks[N_HORSES][1][hb] as PricedRunner[];
      bestJockeys = jockeyPick[jb];
    }
  }
  if (!bestHorses || !bestJockeys) return empty;

  const nap = bestHorses.reduce(
    (m, h) => (expectedPoints(h.p) > expectedPoints(m.p) ? h : m),
    bestHorses[0]
  );
  const spend =
    bestHorses.reduce((s, h) => s + h.price, 0) + bestJockeys.reduce((s, j) => s + j.price, 0);

  return {
    horses: [...bestHorses].sort((a, b) => b.price - a.price),
    jockeys: bestJockeys,
    nap,
    spend,
    bank: Math.round((budget - spend) * 10) / 10,
    expectedPoints: Math.round(best * 10) / 10,
  };
}
