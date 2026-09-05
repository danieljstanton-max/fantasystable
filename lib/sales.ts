/**
 * Selling a horse — the server-side rules.
 *
 * A sale is only ever legal if the stable is unlocked AND the player has
 * sales remaining AND the horse is actually in that stable. Every rule is
 * checked against the DB here rather than trusted from the request, because
 * a client that could name its own sale price could sell a £5m horse for
 * £45m and buy a Group 1 winner with the change.
 *
 * The sale price is the horse's CURRENT market price, taken from the same
 * card the pitch shows. Not what the horse was bought at — that's the number
 * for the profit/loss chip on the sheet, and it goes into `stable_sales` for
 * the receipt but not into the bank calculation.
 */

import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { db, stablePicks, stableSales, stables } from "@/db";
import { cardLockTime, isLocked } from "./lock";
import type { GameCard } from "./game-card";
import { N_SALES } from "./game-pricing";

export type SellResult =
  | { ok: true; boughtM: number; soldM: number; salesLeft: number; bank: number }
  | { ok: false; error: string };

export async function sellHorse(
  userId: string,
  card: GameCard,
  offDtByRaceId: Map<string, Date>,
  horseId: string
): Promise<SellResult> {
  // 1. Find the stable + the pick.
  const stableRow = (
    await db
      .select()
      .from(stables)
      .where(and(eq(stables.userId, userId), eq(stables.raceDate, card.date)))
      .limit(1)
  )[0];
  if (!stableRow) return { ok: false, error: "You haven't saved a stable yet." };
  if (stableRow.lockedAt) return { ok: false, error: "The card is locked — sales are closed." };

  // 2. Same lock check as save — belt and braces if the client hasn't caught up.
  const lockTime = cardLockTime(card, offDtByRaceId);
  if (lockTime && isLocked(lockTime)) {
    await db.update(stables).set({ lockedAt: new Date() }).where(eq(stables.id, stableRow.id));
    return { ok: false, error: "The card is locked — sales are closed." };
  }

  // 3. Sales-remaining check.
  const past = await db
    .select({ n: stableSales.saleIndex })
    .from(stableSales)
    .where(eq(stableSales.stableId, stableRow.id));
  if (past.length >= N_SALES) {
    return { ok: false, error: `That was your ${N_SALES}${N_SALES === 2 ? "nd" : "th"} sale — none left.` };
  }

  // 4. Horse must be currently in the stable.
  const pick = (
    await db
      .select()
      .from(stablePicks)
      .where(
        and(
          eq(stablePicks.stableId, stableRow.id),
          eq(stablePicks.kind, "horse"),
          eq(stablePicks.subjectId, horseId)
        )
      )
      .limit(1)
  )[0];
  if (!pick) return { ok: false, error: "That horse isn't in your stable." };

  // 5. Current market price from THE CARD. Never trust a price from the client.
  const runner = card.races.flatMap((r) => r.runners).find((r) => r.horseId === horseId);
  if (!runner) return { ok: false, error: "That horse isn't on the game card any more." };

  const boughtM = pick.priceM;
  const soldM = runner.price;

  // 6. Apply — delete the pick, add the sale, refresh spend on the stable so
  // Bank on the UI stays right.
  await db.transaction(async (tx) => {
    await tx
      .delete(stablePicks)
      .where(
        and(
          eq(stablePicks.stableId, stableRow.id),
          eq(stablePicks.kind, "horse"),
          eq(stablePicks.subjectId, horseId)
        )
      );
    await tx.insert(stableSales).values({
      id: randomBytes(16).toString("hex"),
      stableId: stableRow.id,
      saleIndex: past.length + 1,
      horseId,
      horseName: pick.subjectName,
      boughtM,
      soldM,
    });
    // Spend goes down by what the horse cost — the money the sale returned
    // goes back into the bank (BUDGET - spend), which is derived, not stored.
    const newSpend = Math.round((stableRow.spendM - boughtM) * 10) / 10;
    await tx
      .update(stables)
      .set({ spendM: newSpend, updatedAt: new Date() })
      .where(eq(stables.id, stableRow.id));
  });

  const salesLeft = N_SALES - past.length - 1;
  const newSpend = Math.round((stableRow.spendM - boughtM) * 10) / 10;
  return { ok: true, boughtM, soldM, salesLeft, bank: Math.round((100 - newSpend) * 10) / 10 };
}

/** Read the sales already made — for the "Sales left" counter and receipts. */
export async function loadSales(stableId: string) {
  return await db
    .select()
    .from(stableSales)
    .where(eq(stableSales.stableId, stableId))
    .orderBy(stableSales.saleIndex);
}
