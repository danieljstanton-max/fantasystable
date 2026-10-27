/**
 * How many selections a day's card carries.
 *
 * Dan has asked for a specific number six times in a fortnight — "lets just do
 * 4", "just the 3 for tomorrow", "TOdays 4 only" — and each time the card was
 * trimmed by vetoing the horses below the line. That works once and then does
 * not: taking one out promotes the next, so a five-horse card trimmed to four
 * needs a veto, a rebuild, another veto, another rebuild. On 27 October it
 * took three passes and was still offering a fifth.
 *
 * Worse, it fills VETOES.txt with horses that have nothing wrong with them.
 * A veto is meant to record a judgement about a horse; using it to count to
 * four buries the real ones.
 *
 *   ~/Desktop/Racing Tips/CARD.txt
 *   2026-10-27 | 4
 *
 * Dated, like the vetoes, the hand picks and the slip name, so it reverts to
 * the usual five on its own tomorrow.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR } from "./published";

export function cardSizePath(): string {
  return join(OUT_DIR, "CARD.txt");
}

/** The number of selections for this date, or null to use the default. */
export function cardSizeFor(date: string): number | null {
  const path = cardSizePath();
  if (!existsSync(path)) return null;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [d, n] = line.split("|").map((p) => p.trim());
    if (d !== date) continue;
    const size = parseInt(n, 10);
    if (Number.isFinite(size) && size > 0 && size <= 20) return size;
  }
  return null;
}
