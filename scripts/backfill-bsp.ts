/**
 * Re-ingest results for days where Betfair SP is missing.
 *
 *   npm run backfill:bsp                    every gap since BSP data begins
 *   npm run backfill:bsp -- --from=2025-07-01
 *   npm run backfill:bsp -- --days=10       only the ten most recent gaps
 *
 * Dan, 2026-10-16: "do we have access to BSP in our database?" We do, and the
 * column was 15% full for October while September was 48% and August 92%.
 *
 * The pattern gave it away: every day was either 100% or 0%, never partial.
 * Betfair publishes BSP a while after the off, and `ingest:results` runs from
 * the sweep shortly after racing — so the figure is simply not there yet when
 * we ask. The two October days that did have it were days something re-ran
 * later. Re-ingesting 14 October took it from 0 to 100%.
 *
 * BSP matters more here than it looks. It is the fairest available benchmark
 * for whether a selection was value: beating it is evidence of an edge in a way
 * that beating a bookmaker's early price is not, because the bookmaker's price
 * is an offer and BSP is what the market actually settled on. The VIP service
 * started in July 2025, which is inside the BSP window, so every bet we can
 * recover can be measured against it.
 *
 * Results ingest is idempotent and never overwrites races.status, so this is
 * safe to run over any range as often as you like.
 */
import "dotenv/config";
import postgres from "postgres";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;

async function main() {
  const from = arg("from", "2024-01-01");
  const limit = parseInt(arg("days", "0"), 10);
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });

  const rows = await sql<any[]>`
    SELECT ra.race_date::text d, count(*)::int n, count(ru.bsp)::int b
    FROM runners ru JOIN races ra ON ra.id = ru.race_id
    WHERE ru.position IS NOT NULL AND ra.race_date >= ${from}
      AND ra.race_date < current_date
    GROUP BY 1 ORDER BY 1 DESC`;
  await sql.end();

  // Newest first: a recent gap is the one most likely to matter to today's work.
  let gaps = rows.filter((r) => r.b < r.n).map((r) => String(r.d).slice(0, 10));
  if (limit > 0) gaps = gaps.slice(0, limit);

  console.log(`\nBSP BACKFILL\n${"=".repeat(68)}`);
  console.log(`  ${gaps.length} day${gaps.length === 1 ? "" : "s"} missing some or all BSP since ${from}\n`);
  if (!gaps.length) return;

  let done = 0, failed = 0;
  for (const d of gaps) {
    const r = spawnSync("npx", ["tsx", "--env-file=.env.local", "scripts/ingest-results.ts", d], {
      stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
    });
    if (r.status === 0) { done++; process.stdout.write(`  ${d} ok`); }
    else { failed++; process.stdout.write(`  ${d} FAILED`); }
    process.stdout.write(done % 5 === 0 ? "\n" : "   ");
  }
  console.log(`\n\n  re-ingested ${done} day${done === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}.`);
  console.log(`  Run it again later for any day whose BSP had still not been published.\n`);
}

main().catch((e) => { console.error("\nbackfill failed:", e?.message ?? e); process.exit(1); });
