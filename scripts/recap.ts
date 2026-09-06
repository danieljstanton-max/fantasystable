/**
 * End-of-day recap emails.
 *
 *   npm run recap -- 2026-09-06
 *
 * Sends one personalised summary to every player who saved a stable for the
 * given day. Prints the highlights it computed and how many mails went out.
 * Safe to run again (players will just get a second copy — so don't).
 */

import "dotenv/config";
import { sendDayRecap } from "../lib/recap";

(async () => {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run recap -- YYYY-MM-DD");
    process.exit(1);
  }

  const r = await sendDayRecap(date);
  console.log(`recap for ${r.date} — ${r.entrants} entrants, ${r.emailed} mails sent`);
  if (r.winner) console.log(`  winner:            ${r.winner.stableName} · ${r.winner.points} pts`);
  if (r.bestNap) console.log(`  best NAP:          ${r.bestNap.horse} · ${r.bestNap.points} pts (${r.bestNap.picks} had it)`);
  if (r.bigPriceWinner) console.log(`  priciest winner:   ${r.bigPriceWinner.horse} · £${r.bigPriceWinner.priceM.toFixed(1)}m (${r.bigPriceWinner.picks})`);
  if (r.mostPopular) console.log(`  most popular pick: ${r.mostPopular.horse} · ${r.mostPopular.picks} stables · finished ${r.mostPopular.positionLabel ?? "—"}`);
  for (const e of r.errors) console.error("  error:", e);
  process.exit(r.errors.length ? 1 : 0);
})();
