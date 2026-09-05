/**
 * Selections Dan has put IN by hand.
 *
 * Dan, 2026-09-04, on the 20:30 Newcastle: "I want Look Back Smiling to replace
 * Starliner."
 *
 * The mirror of lib/vetoes.ts. A veto says no; this says yes. Both exist for
 * the same reason — the file goes out under his name, the daily job rewrites
 * both documents every night, and editing the output would survive exactly one
 * run. An override has to live where the pipeline reads it.
 *
 * Vetoing the model's pick would not do this job. Take Starliner out of the
 * 20:30 and the race falls to Second Fiddle on 11 points, not to Look Back
 * Smiling on 6. Replacing a selection is a different act from removing one, and
 * it needs its own instruction.
 *
 *   ~/Desktop/Racing Tips/PICKS.txt
 *   2026-09-05 | 20:30 | Newcastle | LOOK BACK SMILING | ran on well at Kempton
 *
 * Dated and race-specific, for the same reason vetoes are dated: a standing
 * preference for a horse would follow it into conditions nobody checked.
 *
 * A hand pick does NOT get dressed in the model's language. The write-up says
 * it was picked by hand and gives the stated reason, because a reader deserves
 * to know which selections are the machine's and which are Dan's — and because
 * the model's own score is right there in the best-bets file saying something
 * different.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface HandPick {
  date: string;
  time: string;
  course: string;
  horse: string;
  reason: string;
}

export function picksPath(): string {
  return join(homedir(), "Desktop", "Racing Tips", "PICKS.txt");
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function loadHandPicks(): HandPick[] {
  const path = picksPath();
  if (!existsSync(path)) return [];

  const out: HandPick[] = [];
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const parts = line.split("|").map((p) => p.trim());
    if (parts.length < 4) continue;

    const [date, time, course, horse, ...rest] = parts;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!/^\d{1,2}:\d{2}$/.test(time)) continue;

    out.push({
      date,
      time: time.padStart(5, "0"),
      course,
      horse,
      reason: rest.join(" | ").trim(),
    });
  }
  return out;
}

/** The hand pick for this race, if there is one. */
export function handPickFor(
  picks: HandPick[],
  date: string,
  time: string,
  course: string
): HandPick | null {
  const bareCourse = norm(String(course).replace(/\s*\(.*$/, ""));
  return (
    picks.find(
      (p) =>
        p.date === date &&
        p.time === String(time) &&
        norm(p.course.replace(/\s*\(.*$/, "")) === bareCourse
    ) ?? null
  );
}
