/**
 * When does a stable lock?
 *
 * ONE hour before the first race on the card, and never any later. Sales and
 * every kind of edit close together — Dan's rule, and the right one: it gives
 * players time to react to the last non-runners and jockey changes while
 * still leaving a clean gap before the first horse leaves the stalls.
 *
 * The lock time is DERIVED, not stored, so no cron is needed to "flip" the
 * flag on a schedule. Every save checks `nowIsPast(lockTime)` and refuses.
 * When a save after the lock time is refused, the stable's `lockedAt` column
 * is stamped as a record of the moment we told the player no — that then
 * shows in the UI and drives the settlement pipeline. It's the derived rule
 * that's load-bearing; the column is just history.
 */

import type { GameCard } from "./game-card";

/** How far ahead of the first race the deadline sits. */
export const LOCK_OFFSET_MS = 60 * 60 * 1000;

/**
 * The instant this card locks, or null if there's no priceable race.
 *
 * A card's races come from the DB with off_dt as a timestamptz, but the
 * GameCard shape only carries off_time (a string) and a raceId. Callers that
 * need the lock time reach into the DB (or pass the first race's off_dt in
 * separately) — see cardLockTimeFromOffDt below. The two-arg form keeps this
 * module pure and lets both server actions and preview code test lock logic
 * without a query.
 */
export function cardLockTimeFromOffDt(firstRaceOffDt: Date | string): Date {
  const off = firstRaceOffDt instanceof Date ? firstRaceOffDt : new Date(firstRaceOffDt);
  return new Date(off.getTime() - LOCK_OFFSET_MS);
}

/** True when the given clock reading is at or past the lock. */
export function isLocked(lockTime: Date, now: Date = new Date()): boolean {
  return now.getTime() >= lockTime.getTime();
}

/**
 * A human-readable "locks at HH:MM" or "closes in Xm" for the header/strip.
 * Uses London time because the whole card is scheduled in London.
 */
export function lockLabel(lockTime: Date, now: Date = new Date()): string {
  const msLeft = lockTime.getTime() - now.getTime();
  if (msLeft <= 0) return "Locked";
  const mins = Math.round(msLeft / 60000);
  if (mins < 60) return `Locks in ${mins}m`;
  const hhmm = lockTime.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
    hour12: false,
  });
  return `Locks at ${hhmm}`;
}

/**
 * Lock time for a card, given a lookup for the first race's off_dt.
 *
 * The card selector already picks the richest races, sorted by prize; the
 * first race in `card.races` after sorting by off time is what locks the day.
 * The lookup lets the caller pass a `Map<raceId, off_dt>` from the DB rather
 * than re-querying inside this module.
 */
export function cardLockTime(
  card: GameCard,
  offDtByRaceId: Map<string, Date>
): Date | null {
  if (!card.races.length) return null;
  const withOff = card.races
    .map((r) => ({ r, off: offDtByRaceId.get(r.raceId) }))
    .filter((x): x is { r: (typeof card.races)[number]; off: Date } => !!x.off)
    .sort((a, b) => a.off.getTime() - b.off.getTime());
  if (!withOff.length) return null;
  return cardLockTimeFromOffDt(withOff[0].off);
}
