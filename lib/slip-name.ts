/**
 * What a day's slip is called on the homepage.
 *
 * Dan, 2026-10-23, the night before the Cheltenham October meeting: "4.
 * fairlawn skipper for the lucky and lets call it the Cheltenham lucky."
 *
 * The heading is a shortcode attribute sitting on the homepage, so naming one
 * day's slip by editing the page would name every day's slip — and keep naming
 * it after Cheltenham in November. Dated in a file the pipeline reads, the same
 * shape as VETOES.txt and PICKS.txt, so it reverts on its own tomorrow.
 *
 *   ~/Desktop/Racing Tips/SLIP.txt
 *   2026-10-23 | The Cheltenham Lucky 15
 *
 * It names the slip, nothing else. Whether the slip IS a Lucky 15 or a Patent
 * is still decided by how many selections there are — see hrt_slip_kind() in
 * the plugin. A four-horse card called "The Cheltenham Lucky 15" is a Lucky 15
 * because there are four of them, not because of what it is called.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR } from "./published";

export function slipNamePath(): string {
  return join(OUT_DIR, "SLIP.txt");
}

/** The name for this date, or null to leave the homepage's own heading alone. */
export function slipNameFor(date: string): string | null {
  const path = slipNamePath();
  if (!existsSync(path)) return null;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [d, ...rest] = line.split("|").map((p) => p.trim());
    if (d !== date) continue;
    const name = rest.join(" | ").trim();
    if (name) return name;
  }
  return null;
}
