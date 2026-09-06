/**
 * Saving a stable, and refusing to save a bad one.
 *
 * Every rule is re-checked here against the card the SERVER built. The browser
 * sends ids and nothing else: no prices, no totals, no "this cost £9m". A
 * client that could name its own prices could field six favourites for £6m, and
 * the leaderboard would be worthless within a week of anyone noticing.
 *
 * So the flow is: take ids, look up what those ids actually cost on today's
 * card, add it up here, and compare that to the budget. The number the player
 * saw is a courtesy; the number that counts is this one.
 */

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, stablePicks, stables } from "@/db";
import type { GameCard } from "./game-card";
import { cardLockTime, isLocked } from "./lock";
import { BUDGET, N_HORSES, N_JOCKEYS } from "./game-pricing";

export type StableSelection = {
  horseIds: string[];
  jockeyIds: string[];
  napHorseId: string | null;
};

export type SaveResult =
  | { ok: true; spend: number }
  | { ok: false; error: string };

export type SavedStable = {
  id: string;
  horseIds: string[];
  jockeyIds: string[];
  napHorseId: string | null;
  spendM: number;
  lockedAt: Date | null;
  points: number | null;
};

export async function loadStable(userId: string, raceDate: string): Promise<SavedStable | null> {
  const rows = await db
    .select()
    .from(stables)
    .where(and(eq(stables.userId, userId), eq(stables.raceDate, raceDate)))
    .limit(1);
  const stable = rows[0];
  if (!stable) return null;

  const picks = await db.select().from(stablePicks).where(eq(stablePicks.stableId, stable.id));
  return {
    id: stable.id,
    horseIds: picks.filter((p) => p.kind === "horse").map((p) => p.subjectId),
    jockeyIds: picks.filter((p) => p.kind === "jockey").map((p) => p.subjectId),
    napHorseId: stable.napHorseId,
    spendM: stable.spendM,
    lockedAt: stable.lockedAt,
    points: stable.points,
  };
}

/**
 * Validate a selection against the card. Pure, so the editor can call the same
 * rules to grey out an unaffordable horse before anyone submits.
 */
export function validate(card: GameCard, selection: StableSelection) {
  const byHorse = new Map(card.races.flatMap((r) => r.runners.map((x) => [x.horseId, x] as const)));
  const byJockey = new Map(card.jockeys.map((j) => [j.id, j] as const));

  const horses = selection.horseIds.map((id) => byHorse.get(id));
  const jockeys = selection.jockeyIds.map((id) => byJockey.get(id));

  if (horses.some((h) => !h)) return { ok: false as const, error: "A horse is not on today's card." };
  if (jockeys.some((j) => !j)) return { ok: false as const, error: "A jockey is not on today's card." };
  if (horses.length !== N_HORSES) {
    return { ok: false as const, error: `Pick ${N_HORSES} horses — you have ${horses.length}.` };
  }
  if (jockeys.length !== N_JOCKEYS) {
    return { ok: false as const, error: `Pick ${N_JOCKEYS} jockeys — you have ${jockeys.length}.` };
  }

  const raceIds = new Set(horses.map((h) => h!.raceId));
  if (raceIds.size !== horses.length) {
    return { ok: false as const, error: "Only one horse per race." };
  }
  if (new Set(selection.jockeyIds).size !== jockeys.length) {
    return { ok: false as const, error: "That jockey is already in your stable." };
  }
  if (!selection.napHorseId || !selection.horseIds.includes(selection.napHorseId)) {
    return { ok: false as const, error: "Name one of your six as the NAP." };
  }

  const spend =
    horses.reduce((sum, h) => sum + h!.price, 0) + jockeys.reduce((sum, j) => sum + j!.price, 0);

  // Float arithmetic on half-millions: allow a hair's width so a legitimate
  // £100.0m stable is not rejected by a rounding artefact.
  if (spend > BUDGET + 1e-6) {
    return { ok: false as const, error: `That is £${spend.toFixed(1)}m — the budget is £${BUDGET}m.` };
  }

  return {
    ok: true as const,
    spend: Math.round(spend * 10) / 10,
    horses: horses.map((h) => h!),
    jockeys: jockeys.map((j) => j!),
  };
}

export async function saveStable(
  userId: string,
  card: GameCard,
  offDtByRaceId: Map<string, Date>,
  selection: StableSelection
): Promise<SaveResult> {
  const existing = await loadStable(userId, card.date);
  if (existing?.lockedAt) {
    return { ok: false, error: "The card is locked — deadline passed." };
  }

  // Compute the lock time server-side. A client can never argue with this
  // because we never look at their clock — the deadline is derived from the
  // first race's off_dt minus one hour, straight from the database.
  const lockTime = cardLockTime(card, offDtByRaceId);
  if (lockTime && isLocked(lockTime)) {
    // Stamp the row so subsequent reads short-circuit and the UI can show
    // the "locked" state without recomputing the deadline every time.
    if (existing) {
      await db.update(stables).set({ lockedAt: new Date() }).where(eq(stables.id, existing.id));
    }
    return { ok: false, error: "The card is locked — deadline passed." };
  }

  const checked = validate(card, selection);
  if (!checked.ok) return { ok: false, error: checked.error };

  const stableId = existing?.id ?? randomBytes(16).toString("hex");

  // Replace rather than diff. A stable is six horses and two jockeys, so the
  // whole thing is smaller than the code to work out what changed.
  await db.transaction(async (tx) => {
    if (existing) {
      await tx
        .update(stables)
        .set({ napHorseId: selection.napHorseId, spendM: checked.spend, updatedAt: new Date() })
        .where(eq(stables.id, stableId));
      await tx.delete(stablePicks).where(eq(stablePicks.stableId, stableId));
    } else {
      await tx.insert(stables).values({
        id: stableId,
        userId,
        raceDate: card.date,
        napHorseId: selection.napHorseId,
        spendM: checked.spend,
      });
    }

    await tx.insert(stablePicks).values([
      ...checked.horses.map((h) => ({
        stableId,
        kind: "horse",
        subjectId: h.horseId,
        subjectName: h.horse,
        raceId: h.raceId,
        priceM: h.price,
      })),
      ...checked.jockeys.map((j) => ({
        stableId,
        kind: "jockey",
        subjectId: j.id,
        subjectName: j.name,
        raceId: null,
        priceM: j.price,
      })),
    ]);
  });

  return { ok: true, spend: checked.spend };
}
