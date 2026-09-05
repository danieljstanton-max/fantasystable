/**
 * Selections Dan has taken out by hand.
 *
 * The model is measured and the write-ups are generated, but the file goes out
 * under his name and there has to be a way for him to say no. Editing the
 * output would not survive the next run — the daily job rewrites both files —
 * so a veto has to live somewhere the pipeline reads.
 *
 * Dan, 2026-08-30, on RATING:
 *   "i dont like rating its gone up 4lbs and with weather warnings in UK i
 *    don't think he wants soft ground"
 *
 * He was right on every count: a 4lb rise off the mark he won from, every win
 * in Class 6 going into a Class 2 final, and not one run on soft or heavy in
 * the form we hold while the card projected heavy.
 *
 * Vetoes are DATED. A blanket ban by name would quietly follow a horse into
 * next season and drop it on ground it actually wants, and nobody would
 * remember why. One line, one day, one reason.
 *
 *   ~/Desktop/Racing Tips/VETOES.txt
 *   2026-08-31 | RATING | 4lb rise, no run on soft, Class 6 winner in a Class 2
 *
 * A vetoed horse is not deleted. It keeps its write-up in its own race — the
 * site previews every race — and it is listed under SET ASIDE with the reason,
 * the same way the pace gate reports what it removed.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Veto {
  date: string;
  horse: string;
  reason: string;
}

export function vetoesPath(): string {
  return join(homedir(), "Desktop", "Racing Tips", "VETOES.txt");
}

/** Normalised for comparison — the files are not consistent about case. */
function key(name: string): string {
  return name.trim().toUpperCase().replace(/\s+/g, " ");
}

export function loadVetoes(date: string): Map<string, Veto> {
  const path = vetoesPath();
  const out = new Map<string, Veto>();
  if (!existsSync(path)) return out;

  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 2) continue;

    const [d, horse, ...rest] = parts;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (d !== date) continue;
    if (!horse) continue;

    out.set(key(horse), { date: d, horse, reason: rest.join(" | ") || "set aside by hand" });
  }
  return out;
}

export function isVetoed(vetoes: Map<string, Veto>, horseName: string): Veto | null {
  return vetoes.get(key(horseName)) ?? null;
}
