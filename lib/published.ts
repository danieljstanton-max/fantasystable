/**
 * Reading back the files that actually went out.
 *
 * Settlement and the results publisher both need the same thing: the list of
 * horses we advised on a given day, at the price we advised. That answer comes
 * from the text files on the Desktop, never from re-running the model — the
 * point of both jobs is to audit what was published, and re-deriving the
 * selections would quietly launder any bug in the tipping run.
 *
 * Two naming conventions are in use. The day-named files are what Dan reads
 * ("SATURDAY 29 August - BEST BETS.txt"); the ISO-named ones are what the
 * scripts wrote first. Both are checked, day-named first, because that is the
 * copy that gets edited before it goes out.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const OUT_DIR = join(homedir(), "Desktop", "Racing Tips");

const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export type Pick = {
  source: "best-bet" | "write-up";
  rank: number | null;
  horse: string;
  priceFrac: string | null;
  course: string | null;
  offTime: string | null;
};

function firstExisting(paths: string[]): string | null {
  return paths.find(existsSync) ?? null;
}

export function bestBetsPath(date: string): string | null {
  return firstExisting([
    join(OUT_DIR, `${dayLabel(date)} - BEST BETS.txt`),
    join(OUT_DIR, `${date} BEST BETS.txt`),
  ]);
}

export function writeUpsPath(date: string): string | null {
  return firstExisting([
    join(OUT_DIR, `${dayLabel(date)} - RACE WRITE-UPS.txt`),
    join(OUT_DIR, `${date} race write-ups.txt`),
  ]);
}

export function parseBestBets(date: string): Pick[] {
  const path = bestBetsPath(date);
  if (!path) return [];

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const picks: Pick[] = [];

  for (let i = 0; i < lines.length; i++) {
    // "1. MY GIRL KATIE    13/8    1pt win"
    //
    // The staking advice was added to this line after the plan was fixed, and
    // it arrives in the same column-separated run as the price. Taking the
    // whole remainder as the price made every best bet settle as "no price".
    const m = lines[i].match(/^(\d+)\.\s+([A-Z0-9' \-().]+?)\s{2,}(.+)$/);
    if (!m) continue;

    const priceFrac = m[3].split(/\s{2,}/)[0].trim();

    // "   18:42 Newton Abbot · 3m2½f · Good · 7 runners"
    const ctx = (lines[i + 1] ?? "").match(/^\s+(\d{2}:\d{2})\s+(.+?)\s+·/);

    picks.push({
      source: "best-bet",
      rank: parseInt(m[1], 10),
      horse: m[2].trim(),
      priceFrac: /^no price/i.test(priceFrac) ? null : priceFrac,
      offTime: ctx ? ctx[1] : null,
      course: ctx ? ctx[2].trim() : null,
    });
  }
  return picks;
}

export function parseWriteUps(date: string): Pick[] {
  const path = writeUpsPath(date);
  if (!path) return [];

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const picks: Pick[] = [];

  let course: string | null = null;
  let offTime: string | null = null;

  for (const line of lines) {
    const c = line.match(/^([A-Z][A-Z '\-]+) RACING TIPS$/);
    if (c) { course = c[1].trim(); continue; }

    const t = line.match(/^(\d{2}:\d{2})\s{2,}/);
    if (t) { offTime = t[1]; continue; }

    // The verdict line, in all its published forms:
    //
    //   VERDICT: JEWEL MAKER 12/1 — 0.5pt each-way, 3 places at 1/5
    //   VERDICT: WITHTEARSINMYEYES 5/4 — 1pt win
    //   VERDICT: LISNADILL no price yet
    //   VERDICT: No bet
    //
    // The staking advice comes off first, then the horse is the leading run of
    // capitalised words — prices and lower-case commentary are not part of a
    // name. Matching the whole line instead left "LISNADILL no price yet" and
    // "JEWEL MAKER 12/1 — 0.5pt each-way" as horse names, neither of which
    // matches anything in a result.
    const v = line.match(/^VERDICT:\s+(.+?)\s*$/);
    if (v && !/^no bet/i.test(v[1])) {
      const rest = v[1].split(/\s+[—-]\s+/)[0].trim();
      const m = rest.match(/^((?:[A-Z][A-Z0-9'\u2019()\-.]*)(?:\s+[A-Z][A-Z0-9'\u2019()\-.]*)*)\s*(.*)$/);
      if (m) {
        let horse = m[1].trim();
        let price: string | null =
          m[2].match(/^(\d+\/\d+|EV(?:N|NS|S|ENS)?|\d+(?:\.\d+)?)/)?.[1] ?? null;

        // "GELATO EVS" — evens is a word, so it rides along with the name.
        if (!price && /\sEV(?:N|NS|S|ENS)?$/.test(horse)) {
          horse = horse.replace(/\sEV(?:N|NS|S|ENS)?$/, "");
          price = "EVS";
        }

        picks.push({
          source: "write-up",
          rank: null,
          horse,
          priceFrac: price,
          course,
          offTime,
        });
      }
    }
  }
  return picks;
}
