/**
 * Cross-check every published write-up against the database.
 *
 * Dan, 2026-09-08, after Lucky Hero: "we need to run a check on all write-ups
 * as this is not acceptable."
 *
 * The existing pre-flight looks for claims the record contradicts. Lucky Hero
 * showed that is not enough: the note said "winning a Class 5 off 77 back in
 * April", which was TRUE, while the horse had won its last two off 75 and gone
 * up 10lb. Nothing was false; the wrong true thing was chosen. So this checks
 * two more things:
 *
 *   STALE WIN    — the write-up cites a win older than a later one that exists
 *   MISSED RUN   — the horse is on a sequence of wins and the prose never says so
 *
 * Read-only. Reports; changes nothing.
 *
 *   npm run audit:all                 # every write-up file on disk
 *   npm run audit:all -- 2026-09-09   # one day
 */
import "dotenv/config";
import postgres from "postgres";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OUT_DIR } from "../lib/published";

const DIR = OUT_DIR;
const MONTHS = ["January","February","March","April","May","June","July",
                "August","September","October","November","December"];

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const iso = (d: any) => new Date(d).toISOString().slice(0, 10);

(async () => {
  const only = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require" });

  const files = readdirSync(DIR).filter((f) => f.endsWith("RACE WRITE-UPS.txt"));

  type Issue = { file: string; horse: string; kind: string; detail: string };
  const issues: Issue[] = [];
  let selections = 0;

  // One query for every horse named in every file, rather than one per
  // selection. Six hundred round trips to Neon took long enough that the first
  // run timed out before printing its own summary.
  const names = new Set<string>();
  for (const f of files) {
    for (const m of readFileSync(join(DIR, f), "utf8")
      .matchAll(/^VERDICT:\s+([A-Z][A-Z0-9' \-]+?)\s+(?:\d|no price)/gm)) {
      names.add(m[1].trim());
    }
  }
  const normed = [...names].map(norm);
  const rows = normed.length ? await sql<any[]>`
    select upper(regexp_replace(r.horse_name,'[^A-Za-z0-9]','','g')) as key,
           ra.race_date, ra.race_class, r.position, r.ofr
    from runners r join races ra on ra.id = r.race_id
    where upper(regexp_replace(r.horse_name,'[^A-Za-z0-9]','','g')) = any(${normed})
      and r.position is not null
    order by ra.race_date desc` : [];

  const byHorse = new Map<string, any[]>();
  for (const r of rows) {
    if (!byHorse.has(r.key)) byHorse.set(r.key, []);
    byHorse.get(r.key)!.push(r);
  }
  console.log(`  ${names.size} distinct horses, ${rows.length} historic runs loaded`);

  for (const f of files) {
    const body = readFileSync(join(DIR, f), "utf8");

    // The date the file is for, from its header line.
    const dm = body.match(/^HORSE RACING TIPS — [A-Z]+, (\d{1,2}) ([A-Za-z]+) (\d{4})/m);
    if (!dm) continue;
    const month = MONTHS.findIndex((m) => m.toUpperCase() === dm[2].toUpperCase());
    if (month < 0) continue;
    const date = `${dm[3]}-${String(month + 1).padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
    if (only && date !== only) continue;

    // Every verdict is a selection.
    for (const m of body.matchAll(/^VERDICT:\s+([A-Z][A-Z0-9' \-]+?)\s+(?:\d|no price)/gm)) {
      const horse = m[1].trim();
      selections++;

      // The paragraph this selection sits in — back to the previous rule line.
      const at = m.index ?? 0;
      const start = body.lastIndexOf("\n---", at);
      const para = body.slice(start < 0 ? 0 : start, at);

      const all = byHorse.get(norm(horse)) ?? [];
      // race_date comes back as a Date. String(date) is "Tue Sep 08 2026 ...",
      // which compares to "2026-09-09" as greater on the first character, so a
      // naive < silently matched nothing and the audit reported all clear.
      const runs = all.filter((r: any) => iso(r.race_date) < date);
      if (!runs.length) continue;

      // 1. A cited winning mark that is not the most recent win.
      const cite = para.match(/winning mark of (\d+)\s*back in ([A-Z][a-z]+)/);
      if (cite) {
        const citedMark = Number(cite[1]);
        const wins = runs.filter((r) => r.position === "1" && r.ofr !== null);
        if (wins.length) {
          const latest = wins[0];
          if (Number(latest.ofr) !== citedMark) {
            issues.push({
              file: f, horse, kind: "STALE WIN",
              detail: `cites a winning mark of ${citedMark} (${cite[2]}), but the most recent win was off ${latest.ofr} on ${iso(latest.race_date)}`,
            });
          }
        }
      }

      // 2. A winning sequence the prose never mentions.
      let streak = 0;
      for (const r of runs) { if (r.position === "1") streak++; else break; }
      if (streak >= 2) {
        // Must match every phrasing lib/voice.ts can produce, or the check
        // reports its own output as a fault. The first version looked for
        // "won his last four" while STREAK_LINES writes "winning his last
        // four", so a corrected write-up was still flagged.
        const NUM = "(?:two|three|four|five|six|\\d+)";
        const saysSo = new RegExp(
          [
            `(?:won|winning) (?:his |her |its )?last ${NUM}`,
            `${NUM} (?:straight wins|wins on the bounce)`,
            `${NUM} on the (?:bounce|trot)`,
            "back-to-back",
            "in hot form",
          ].join("|"),
          "i"
        ).test(para);
        if (!saysSo) {
          issues.push({
            file: f, horse, kind: "MISSED RUN",
            detail: `has won its last ${streak} and the write-up never says so`,
          });
        }
      }
    }
  }

  console.log(`\nWRITE-UP CROSS-CHECK`);
  console.log("=".repeat(78));
  console.log(`  ${files.length} files, ${selections} selections checked\n`);

  if (!issues.length) {
    console.log("  Nothing found.\n");
  } else {
    const byKind = new Map<string, Issue[]>();
    for (const i of issues) {
      if (!byKind.has(i.kind)) byKind.set(i.kind, []);
      byKind.get(i.kind)!.push(i);
    }
    for (const [kind, list] of byKind) {
      console.log(`  ${kind} — ${list.length}\n`);
      for (const i of list.slice(0, 25)) {
        console.log(`    ${i.horse}  (${i.file.replace(" - RACE WRITE-UPS.txt", "")})`);
        console.log(`      ${i.detail}\n`);
      }
      if (list.length > 25) console.log(`    ... and ${list.length - 25} more\n`);
    }
  }

  await sql.end();
  process.exit(issues.length ? 1 : 0);
})();
