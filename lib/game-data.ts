import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, races, runners, stablePicks, stables } from "@/db";
import { buildCard, type GameCard } from "./game-card";
import { LOCK_OFFSET_MS } from "./lock";

/**
 * The card for a date, straight from the database.
 *
 * One function, because the page and the save action must agree about what is
 * on the card down to the penny. If the page built the card one way and
 * validation built it another, a horse could be offered at one price and
 * refused at another, and the player would be right to be furious.
 */
export async function loadCard(
  date: string
): Promise<{ card: GameCard; offDtByRaceId: Map<string, Date> }> {
  const rows = await db
    .select({
      raceId: races.id,
      courseName: races.courseName,
      raceName: races.name,
      offTime: races.offTime,
      offDt: races.offDt,
      prizeValue: races.prizeValue,
      horseId: runners.horseId,
      horseName: runners.horseName,
      jockeyId: runners.jockeyId,
      jockeyName: runners.jockeyName,
      trainerName: runners.trainerName,
      silkUrl: runners.silkUrl,
      openingOddsDec: runners.openingOddsDec,
      openingOddsFrac: runners.openingOddsFrac,
      isNonRunner: runners.isNonRunner,
      form: runners.form,
      comment: runners.comment,
      weight: runners.weight,
      headgear: runners.headgear,
      lastRun: runners.lastRun,
      ofr: runners.ofr,
      rpr: runners.rpr,
    })
    .from(runners)
    .innerJoin(races, eq(races.id, runners.raceId))
    .where(and(eq(races.raceDate, date), inArray(races.region, ["GB", "IRE"])));

  const card = buildCard(rows, { date });
  const offDtByRaceId = new Map<string, Date>();
  for (const row of rows) {
    if (row.offDt && !offDtByRaceId.has(row.raceId)) {
      offDtByRaceId.set(row.raceId, row.offDt);
    }
  }
  return { card, offDtByRaceId };
}

/** Legacy shape kept for callers that only need the card. */
export async function loadCardOnly(date: string) {
  return (await loadCard(date)).card;
}

/**
 * Today in Europe/London wall-clock (YYYY-MM-DD). Race dates are always UK
 * local, so the game's notion of "today" must match — a UTC midnight would
 * flip the date twice a year at 00:00 BST vs 01:00 GMT and put the wrong
 * card on the pitch for an hour.
 */
export const today = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

/**
 * Ensure every saved pick still shows on the pitch, even after the card
 * composition changes.
 *
 * `buildCard` filters non-runners and low-coverage races. That's the right
 * call for the buyer's view, but it means a saved horse can silently vanish
 * from the pitch if its race gets filtered or the horse itself becomes a
 * non-runner. This helper looks up any horse/jockey that's been saved but
 * isn't on the card and splices a minimal row back in so the pitch always
 * renders the six the player picked. Non-runners are marked, not deleted —
 * per CLAUDE.md.
 */
export async function mergeSavedIntoCard(
  card: GameCard,
  savedHorseIds: string[],
  savedJockeyIds: string[]
): Promise<GameCard> {
  const knownHorses = new Set(
    card.races.flatMap((r) => r.runners.map((x) => x.horseId))
  );
  const knownJockeys = new Set(card.jockeys.map((j) => j.id));

  const missingHorses = savedHorseIds.filter((id) => !knownHorses.has(id));
  const missingJockeys = savedJockeyIds.filter((id) => !knownJockeys.has(id));
  if (missingHorses.length === 0 && missingJockeys.length === 0) return card;

  // Fall back to whatever we stored on `stable_picks` — that record was
  // written at save time with the price the player paid, so it's the honest
  // source of truth here for the SPEND. We also want the horse's silk so
  // the card doesn't render as a blank green square when it slips off the
  // main card, so join to `runners` for the silk_url too.
  const picks = missingHorses.length > 0
    ? await db
        .select({
          subjectId: stablePicks.subjectId,
          subjectName: stablePicks.subjectName,
          raceId: stablePicks.raceId,
          priceM: stablePicks.priceM,
          silkUrl: runners.silkUrl,
          isNonRunner: runners.isNonRunner,
        })
        .from(stablePicks)
        .leftJoin(
          runners,
          and(eq(runners.horseId, stablePicks.subjectId), eq(runners.raceId, stablePicks.raceId))
        )
        .where(and(eq(stablePicks.kind, "horse"), inArray(stablePicks.subjectId, missingHorses)))
    : [];

  const jockeyPicks = missingJockeys.length > 0
    ? await db
        .select({
          subjectId: stablePicks.subjectId,
          subjectName: stablePicks.subjectName,
          priceM: stablePicks.priceM,
        })
        .from(stablePicks)
        .where(and(eq(stablePicks.kind, "jockey"), inArray(stablePicks.subjectId, missingJockeys)))
    : [];

  // Group orphan horses by their (original) race id so we don't produce six
  // "Non-runners" tiles with no shape. If a race is entirely gone from the
  // current card, we create one synthetic race for it.
  const byRace = new Map<string, typeof picks>();
  for (const p of picks) {
    if (!p.raceId) continue;
    const arr = byRace.get(p.raceId) ?? [];
    arr.push(p);
    byRace.set(p.raceId, arr);
  }

  const extraRaces: GameCard["races"] = [];
  for (const [raceId, group] of byRace) {
    const anyNonRunner = group.some((p) => p.isNonRunner);
    extraRaces.push({
      raceId,
      course: anyNonRunner ? "Non-runner" : "Off-card",
      name: anyNonRunner ? "Withdrawn from the race" : "Race no longer on the card",
      offTime: "—",
      prizeValue: null,
      runners: group.map((p) => ({
        horseId: p.subjectId,
        horse: p.subjectName,
        raceId,
        jockeyId: null,
        jockey: null,
        trainer: null,
        silkUrl: p.silkUrl,
        oddsDec: 0,
        frac: "—",
        p: 0,
        price: p.priceM,
        form: null,
        comment: null,
        weight: null,
        headgear: null,
        lastRun: null,
        ofr: null,
        rpr: null,
        course: null,
        offTime: null,
        raceName: null,
      })),
    });
  }

  const extraJockeys: GameCard["jockeys"] = jockeyPicks.map((p) => ({
    id: p.subjectId,
    name: p.subjectName,
    rides: 0,
    strength: 0,
    price: p.priceM,
  }));

  return {
    ...card,
    races: [...card.races, ...extraRaces],
    jockeys: [...card.jockeys, ...extraJockeys],
  };
}

/**
 * The card a signed-in player should see by default.
 *
 * The game runs Saturdays only. This returns the coming Saturday's date
 * (YYYY-MM-DD, Europe/London), or if today IS Saturday and racing hasn't
 * finished yet, today. Sunday morning through Friday all point at the
 * next Saturday so the pitch always shows something buildable.
 */
export async function nextGameDate(now: Date = new Date()): Promise<string> {
  // Europe/London wall-clock components. The DOW for Sat is 6.
  const uk = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const dow = uk.getDay();
  // On Saturday, stay on today until 23:00 UK — after that flip to next Sat.
  if (dow === 6 && uk.getHours() < 23) return today();
  const daysUntilNextSat = ((6 - dow + 7) % 7) || 7;
  const nextSat = new Date(now.getTime() + daysUntilNextSat * 86_400_000);
  return nextSat.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

/** Kept for the /game caller which imports this — always returns null now
 *  (the Saturday-only default handles the "stick with my stable" case). */
export async function activeStableDate(_userId: string | null): Promise<string | null> {
  return null;
}

/**
 * Which game week is this?
 *
 * Numbered from the first Saturday the game went live. The epoch is the
 * Monday before that Saturday, so 2026-09-12 is Game Week 1, 2026-09-19 is
 * Game Week 2, and so on. The launch week is the identity anchor for
 * "how did I do in Week 1"; there is no pre-history to number.
 *
 * The number is purely cosmetic and rolls forward indefinitely. Reset the
 * epoch when the season genuinely restarts — not before.
 */
const GAME_WEEK_EPOCH = Date.UTC(2026, 8, 7); // Mon 7 Sep 2026
export function raceWeekFor(date: string): number {
  const t = Date.parse(`${date}T12:00:00Z`);
  const weeks = Math.floor((t - GAME_WEEK_EPOCH) / (7 * 86_400_000));
  return Math.max(1, weeks + 1);
}

/**
 * Per-horse results for the pitch: has it run, where did it finish, what
 * points did it earn?
 *
 * Reads from `runners` for the position + non-runner flag and from
 * `stable_picks` for the settled points (populated by settleDate). Callers
 * treat "no row" as "not settled yet" — the pitch keeps its live look for
 * anything without a result.
 */
export type HorseResult = {
  horseId: string;
  raceId: string;
  positionNum: number | null;
  positionLabel: string | null; // "1", "2", "PU", "F", "UR" — as published
  isNonRunner: boolean;
  points: number | null;
};

export async function loadHorseResults(
  stableId: string,
  horseRaceIds: { horseId: string; raceId: string }[]
): Promise<Map<string, HorseResult>> {
  const out = new Map<string, HorseResult>();
  if (horseRaceIds.length === 0) return out;

  // stable_picks.points, keyed by horseId (kind='horse') for the stable.
  const pointsRows = await db
    .select({ subjectId: stablePicks.subjectId, points: stablePicks.points })
    .from(stablePicks)
    .where(and(eq(stablePicks.stableId, stableId), eq(stablePicks.kind, "horse")));
  const pointsByHorse = new Map(pointsRows.map((r) => [r.subjectId, r.points]));

  // Position for each (horseId, raceId). We only need the specific runner
  // row for the horse in the race we picked it in — the same horse could
  // in principle have another row in a different race, but not for the
  // same card, and we scope by raceId regardless.
  for (const { horseId, raceId } of horseRaceIds) {
    const [row] = await db
      .select({
        positionNum: runners.positionNum,
        position: runners.position,
        isNonRunner: runners.isNonRunner,
      })
      .from(runners)
      .where(and(eq(runners.horseId, horseId), eq(runners.raceId, raceId)))
      .limit(1);
    out.set(horseId, {
      horseId,
      raceId,
      positionNum: row?.positionNum ?? null,
      positionLabel: row?.position ?? null,
      isNonRunner: row?.isNonRunner ?? false,
      points: pointsByHorse.get(horseId) ?? null,
    });
  }

  return out;
}

/**
 * Per-jockey settled points for a stable. Written by settleDate on the
 * stable_picks row; keyed by jockeyId here for a quick lookup on the bench.
 * Returns an empty map for a stable with no picks (or before settlement).
 */
export async function loadJockeyResults(stableId: string): Promise<Map<string, number | null>> {
  const rows = await db
    .select({ subjectId: stablePicks.subjectId, points: stablePicks.points })
    .from(stablePicks)
    .where(and(eq(stablePicks.stableId, stableId), eq(stablePicks.kind, "jockey")));
  const out = new Map<string, number | null>();
  for (const r of rows) out.set(r.subjectId, r.points);
  return out;
}

