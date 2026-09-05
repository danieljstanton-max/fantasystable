/**
 * Score every saved stable for a given day.
 *
 *   npm run settle:game            # today
 *   npm run settle:game -- 2026-09-05
 *
 * Reads the game card for that date, walks every saved stable, and writes
 * `points` on each stable/pick using the scoring rules in lib/game-pricing.ts.
 * Deterministic — safe to run twice.
 */

import "dotenv/config";
import { settleDate } from "../lib/settlement";

(async () => {
  const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run settle:game -- YYYY-MM-DD");
    process.exit(1);
  }

  console.log(`settling ${date}…`);
  const report = await settleDate(date);
  console.log(`stables settled:      ${report.stablesSettled}`);
  console.log(`total points awarded: ${report.totalPointsAwarded}`);
  if (report.perStable.length) {
    console.log("per stable:");
    for (const s of report.perStable) {
      console.log(`  ${s.stableId}  user ${s.userId}  ${s.points} pts`);
    }
  }
  process.exit(0);
})();
