/**
 * Snapshot the game card's prices at ONE instant.
 *
 *   npm run snapshot:prices              # today
 *   npm run snapshot:prices -- 2026-09-12
 *
 * Called on a schedule (every 15 minutes on race day) so the price a player
 * saw when they built their stable is the same one settlement will use. The
 * per-runner `opening_odds_at` timestamps on the racecards table can span
 * hours; a single snapshot instant makes the picture consistent.
 *
 * Writes are append-only. A duplicate tick within the same second is a
 * no-op via the composite primary key on `game_prices`.
 */

import "dotenv/config";
import { db, gamePrices } from "../db";
import { loadCard, today } from "../lib/game-data";

(async () => {
  const date = process.argv[2] ?? today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run snapshot:prices -- YYYY-MM-DD");
    process.exit(1);
  }

  const { card } = await loadCard(date);
  if (!card.races.length) {
    console.log(`no card for ${date} — nothing to snapshot`);
    process.exit(0);
  }

  const snapshotAt = new Date();
  const rows = [
    ...card.races.flatMap((race) =>
      race.runners.map((r) => ({
        raceDate: date,
        snapshotAt,
        kind: "horse" as const,
        subjectId: r.horseId,
        subjectName: r.horse,
        raceId: race.raceId,
        oddsDec: r.oddsDec,
        strength: r.p,
        priceM: r.price,
      }))
    ),
    ...card.jockeys.map((j) => ({
      raceDate: date,
      snapshotAt,
      kind: "jockey" as const,
      subjectId: j.id,
      subjectName: j.name,
      raceId: null as string | null,
      oddsDec: null as number | null,
      strength: j.strength,
      priceM: j.price,
    })),
  ];

  await db.insert(gamePrices).values(rows).onConflictDoNothing();
  console.log(`snapshotted ${rows.length} rows at ${snapshotAt.toISOString()} for ${date}`);
  process.exit(0);
})();
