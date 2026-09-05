import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db, races, runners } from "@/db";
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
    })
    .from(runners)
    .innerJoin(races, eq(races.id, runners.raceId))
    .where(and(eq(races.raceDate, date), inArray(races.region, ["GB", "IRE"])));

  const card = buildCard(rows, { date, races: 12, meetings: 4 });
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
 * The card a signed-in player should see by default.
 *
 * Not "today" — the game is a build-then-lock flow, so as soon as today's
 * deadline has passed the card is a fait accompli and the punter wants the
 * NEXT race day, ready to build. This picks the earliest date that:
 *
 *   • has at least one GB/IRE race in the database, and
 *   • hasn't yet locked (i.e. first race is more than LOCK_OFFSET_MS away).
 *
 * Falls back to `today()` if nothing upcoming is ingested — the page will
 * then show an empty-card state, which is honest.
 */
export async function nextGameDate(now: Date = new Date()): Promise<string> {
  const cutoff = new Date(now.getTime() + LOCK_OFFSET_MS);
  const rows = await db
    .select({ raceDate: races.raceDate, offDt: races.offDt })
    .from(races)
    .where(and(inArray(races.region, ["GB", "IRE"]), gte(races.offDt, cutoff)))
    .orderBy(asc(races.offDt))
    .limit(1);
  return rows[0]?.raceDate ?? today();
}

/**
 * Which race week is this?
 *
 * The Saturday game numbers weeks from the start of the turf/national-hunt
 * season. We pick a Sunday-of-week-1 as the epoch so every date maps to a
 * simple integer via a difference in weeks. The chosen epoch is Monday
 * 2025-09-01, so 2025-09-06 (the first Saturday of the season) is Week 1.
 *
 * The number is purely cosmetic — it appears in the header for identity, and
 * later on the leaderboard so people can talk about "how you did in Week 3".
 * Rolling it over year-on-year is a decision to make when the season
 * genuinely restarts, not something to overthink now.
 */
const RACE_WEEK_EPOCH = Date.UTC(2025, 8, 1); // Mon 1 Sep 2025
export function raceWeekFor(date: string): number {
  const t = Date.parse(`${date}T12:00:00Z`);
  const weeks = Math.floor((t - RACE_WEEK_EPOCH) / (7 * 86_400_000));
  return Math.max(1, weeks + 1);
}
