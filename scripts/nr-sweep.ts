/**
 * Sweep non-runners out of active stables and email affected players.
 *
 *   npm run nr:sweep
 *
 * Intended to run on a schedule (every 15 min through the buy window on
 * race day), or on demand when someone spots a late scratching. Idempotent:
 * a second pass sees no non-runners with picks against them and does
 * nothing.
 */

import "dotenv/config";
import { sweepNonRunners } from "../lib/nr-sweep";

const ORIGIN = process.env.PUBLIC_ORIGIN ?? "https://www.fantasystable.co.uk";

(async () => {
  const report = await sweepNonRunners(ORIGIN);
  console.log(`swept ${report.swept.length} stables, emailed ${report.emailed}`);
  for (const s of report.swept) {
    console.log(
      `  ${s.email.padEnd(32)} ${s.raceDate}  removed ${s.horses
        .map((h) => `${h.name} (£${h.refunded.toFixed(1)}m)`)
        .join(", ")} — bank now £${s.newBank.toFixed(1)}m`
    );
  }
  for (const e of report.errors) console.error("  error:", e);
  process.exit(report.errors.length ? 1 : 0);
})();
