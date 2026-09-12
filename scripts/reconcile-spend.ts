/**
 * Reconcile stables.spendM against the sum of its stable_picks.priceM
 * for a given race date. Fixes any drift left over from a botched sweep
 * or a mid-save race condition.
 *
 *   npm run reconcile -- 2026-09-12         # report only
 *   npm run reconcile -- 2026-09-12 --fix   # apply the fix
 */

import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db, stables, stablePicks, users } from "../db";

(async () => {
  const date = process.argv[2];
  const fix = process.argv.includes("--fix");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run reconcile -- YYYY-MM-DD [--fix]");
    process.exit(1);
  }

  const rows = await db
    .select({
      id: stables.id,
      email: users.email,
      spendM: stables.spendM,
      picksSum: sql<number>`coalesce((select sum(price_m) from stable_picks where stable_id = ${stables.id}), 0)::real`,
      count: sql<number>`(select count(*) from stable_picks where stable_id = ${stables.id})::int`,
    })
    .from(stables)
    .innerJoin(users, eq(users.id, stables.userId))
    .where(eq(stables.raceDate, date));

  const drifted = rows.filter((r) => Math.abs(r.spendM - r.picksSum) > 0.05);
  console.log(`${rows.length} stables · ${drifted.length} out of sync`);
  for (const r of drifted) {
    const delta = Math.round((r.spendM - r.picksSum) * 10) / 10;
    console.log(
      `  ${r.email.padEnd(32)} spend £${r.spendM.toFixed(1).padStart(6)}m  picks_sum £${r.picksSum.toFixed(1).padStart(6)}m  drift ${delta >= 0 ? "+" : ""}${delta}m  (${r.count} picks)`
    );
    if (fix) {
      const newSpend = Math.round(r.picksSum * 10) / 10;
      await db.update(stables).set({ spendM: newSpend, updatedAt: new Date() }).where(eq(stables.id, r.id));
    }
  }
  console.log(fix ? "fixed." : "dry run — pass --fix to apply.");
  process.exit(0);
})();
