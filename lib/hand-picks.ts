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
import { join } from "node:path";
import { OUT_DIR } from "./published";

export interface HandPick {
  date: string;
  time: string;
  course: string;
  horse: string;
  reason: string;
  /**
   * Put this one at the top of the five, whatever the model scored it.
   *
   * Dan, 2026-10-09: "I want you to make KING'S SCHOLAR the website NAP." The
   * pick reached the list and sorted second on points, which is not what was
   * asked for — the NAP is the horse of the day and he had named it. Written
   * as a fifth field:
   *
   *   2026-10-09 | 13:22 | Chepstow | KING'S SCHOLAR | NAP | improving with...
   */
  nap: boolean;
  /**
   * The line it was written on, counting from zero within its own date.
   *
   * Dan, 2026-10-20: "these are the 4 we are going for tomorrow in this
   * order." Hand picks were being ranked among themselves by what the model
   * made of their races, which reshuffled a list he had already ordered. The
   * order he typed is the order he meant.
   */
  order: number;
  /**
   * A stake Dan has named, overriding the automatic one.
   *
   * Dan, 2026-10-23, on QUEST FOR FUN: "the nap im tipping it eachway at 5/1."
   * betFor() makes 5/1 a 1pt win, because 5/1 and under is a win bet and 11/2
   * and bigger is each-way — that line is the staking plan, not a law, and in
   * a fourteen-runner handicap paying four places he wants the places.
   *
   * Written as its own field after the optional NAP marker:
   *
   *   2026-10-24 | 16:30 | Doncaster | QUEST FOR FUN | NAP | 0.5pt each-way | ...
   *   2026-10-24 | 16:30 | Doncaster | QUEST FOR FUN | each-way | ...
   *
   * Null means the staking plan decides, which is the normal case.
   */
  stake: { type: "win" | "ew"; points: number | null } | null;
  /**
   * The price Dan advised, frozen against the market.
   *
   * Dan, 2026-10-25: "i tipped it eachway at 9/2." WATCH THE WEATHER was 9/2
   * when he put it up on video and to the group, and had shortened to 4/1 by
   * the time the card was rebuilt — so a rebuild would have quietly lowered
   * the advised price under readers who had already taken 9/2, and understated
   * the bet in the record.
   *
   * The card otherwise takes the best price going at build time, which is
   * right for a model selection and wrong for one he has already advised
   * somewhere else. Written after the stake:
   *
   *   ... | NAP | 1pt each-way at 9/2 | reason
   */
  price: string | null;
}

/**
 * "0.5pt each-way", "1pt win", "each-way at 9/2", "ew", "win" — or null.
 * An optional "at <price>" pins the advised price against the market.
 */
function readStake(field: string): { stake: HandPick["stake"]; price: string | null } | null {
  const m = field.trim().match(
    /^(?:([\d.]+)\s*pts?\s+)?(win|each[- ]?way|e\/w|ew)(?:\s+(?:at|@)\s+([\d]+\/[\d]+|evens|evs))?$/i
  );
  if (!m) return null;
  const type = /^(win)$/i.test(m[2]) ? "win" : "ew";
  const points = m[1] ? Number(m[1]) : null;
  return {
    stake: { type, points: points !== null && Number.isFinite(points) && points > 0 ? points : null },
    price: m[3] ? m[3].trim() : null,
  };
}

export function picksPath(): string {
  return join(OUT_DIR, "PICKS.txt");
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

    // An optional NAP marker, then an optional stake, then the reason.
    const nap = rest.length > 0 && /^nap$/i.test(rest[0].trim());
    let after = nap ? rest.slice(1) : rest;
    const read = after.length > 0 ? readStake(after[0]) : null;
    const stake = read?.stake ?? null;
    const price = read?.price ?? null;
    if (read) after = after.slice(1);
    const reason = after.join(" | ").trim();

    out.push({
      date,
      time: time.padStart(5, "0"),
      course,
      horse,
      reason,
      nap,
      stake,
      price,
      order: 0,   // filled below, per date
    });
  }

  // Number them within their own date, in the order they were written.
  const seen = new Map<string, number>();
  for (const p of out) {
    const n = seen.get(p.date) ?? 0;
    p.order = n;
    seen.set(p.date, n + 1);
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
