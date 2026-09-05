/**
 * The daily card report.
 *
 *   npm run daily                    tomorrow, to the Desktop folder
 *   npm run daily -- today
 *   npm run daily -- --out=/some/dir
 *
 * Ingests tomorrow's racecards, scores them, and writes a self-contained HTML
 * report plus a plain-text summary and a CSV of the flagged horses.
 *
 * Written to a folder rather than emailed on purpose. Sending mail would mean
 * holding credentials for an account, which is not something to hand to a
 * script — a folder needs no secrets, works whether or not anything is running,
 * and syncs through iCloud or Dropbox by itself if the folder is inside one.
 *
 * Intended to run unattended from launchd at 19:00. Prices for tomorrow are
 * published during the evening before, so 19:00 is late enough to have them and
 * early enough to act on.
 */

import "dotenv/config";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;

const OUT_DIR = arg("out", join(homedir(), "Desktop", "Racing Tips"));
const SKIP_INGEST = args.includes("--no-ingest");

function targetDate(): string {
  const a = args.find((x) => !x.startsWith("--"));
  if (a && /^\d{4}-\d{2}-\d{2}$/.test(a)) return a;
  const d = new Date();
  if (a !== "today") d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function run(cmd: string, cmdArgs: string[]): string {
  return execFileSync(cmd, cmdArgs, {
    cwd: process.cwd(),
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
}

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string
  );
}

async function main() {
  const date = targetDate();
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`\nDAILY REPORT — ${date}`);
  console.log(`  output: ${OUT_DIR}\n`);

  // 1. Fresh data. Courses first: races carry a foreign key to them, and an
  //    empty courses table fails the whole ingest.
  if (!SKIP_INGEST) {
    try {
      console.log("  refreshing courses...");
      run("npx", ["tsx", "--env-file=.env.local", "scripts/ingest-courses.ts"]);
      console.log("  ingesting racecards...");
      run("npx", ["tsx", "--env-file=.env.local", "scripts/ingest-racecards.ts", date]);
    } catch (e) {
      console.error(`  ingest failed: ${(e as Error).message.slice(0, 200)}`);
      // Carry on and report from what is already stored rather than producing
      // nothing — a stale report is more use than a missing one.
    }
  }

  // 2. Pull tomorrow's declared horses so the model has their form.
  if (!SKIP_INGEST) {
    try {
      console.log("  fetching career form for declared runners...");
      run("npx", ["tsx", "--env-file=.env.local", "scripts/backfill.ts", "--horses=tomorrow"]);
    } catch {
      console.error("  career fetch failed — continuing on stored form");
    }
  }

  // 3. Score.
  console.log("  scoring...");
  let output = "";
  try {
    output = run("npx", ["tsx", "--env-file=.env.local", "scripts/score-day.ts", date]);
  } catch (e) {
    output = `Scoring failed:\n${(e as Error).message}`;
  }

  // 4. Write the plain text exactly as produced — the terminal output is
  //    already the fullest version of the analysis.
  const txtPath = join(OUT_DIR, `${date} card.txt`);
  writeFileSync(txtPath, `RACING CARD — ${date}\nGenerated ${stamp}\n\n${output}`);

  // 5. A CSV of the flagged horses, for tracking selections and settling them.
  const flagged: string[] = ["date,horse,off_time,course,points,price,lbs_in_hand,prime,race"];
  const lines = output.split("\n");
  const start = lines.findIndex((l) => l.includes("WELL HANDICAPPED"));
  if (start >= 0) {
    for (let i = start; i < lines.length; i++) {
      const m = lines[i].match(/^\s*(\*?)([A-Z][A-Z' .()-]+?)\s{2,}(\d+)pt\s+(\S+)\s+([\d.]+)lb in hand/);
      if (!m) continue;
      const [, prime, horse, pts, price, lbs] = m;
      const meta = (lines[i + 1] ?? "").trim();
      const mm = meta.match(/^(\d{2}:\d{2})\s+(\S+)\s+(.*)$/);
      flagged.push(
        [date, `"${horse.trim()}"`, mm?.[1] ?? "", mm?.[2] ?? "", pts, price, lbs,
         prime === "*" ? "yes" : "no", `"${(mm?.[3] ?? "").replace(/"/g, "")}"`].join(",")
      );
    }
  }
  const csvPath = join(OUT_DIR, `${date} flagged.csv`);
  writeFileSync(csvPath, flagged.join("\n"));

  // 6. A readable HTML version of the same thing.
  const htmlPath = join(OUT_DIR, `${date} card.html`);
  writeFileSync(
    htmlPath,
    `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Racing card ${date}</title>
<style>
  body{background:#0a0a0c;color:#f6f6f8;font-family:"JetBrains Mono",ui-monospace,monospace;
       font-size:13px;line-height:1.55;margin:0;padding:24px 16px 60px;}
  .wrap{max-width:900px;margin:0 auto;}
  h1{font-family:system-ui,sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;
     font-size:30px;letter-spacing:-.01em;margin:0 0 4px;}
  h1 span{color:#e8112d;}
  .sub{color:#8b8b98;font-size:12px;margin-bottom:24px;}
  pre{white-space:pre-wrap;word-wrap:break-word;margin:0;}
  .note{border-left:3px solid #e0a020;background:#1c1c23;padding:12px 16px;margin:0 0 22px;
        font-family:system-ui,sans-serif;font-size:13px;color:#d7d7de;}
</style></head><body><div class="wrap">
<h1>Racing Card <span>${esc(date)}</span></h1>
<div class="sub">Generated ${esc(stamp)}</div>
<div class="note"><b>Not proven.</b> The model returned &minus;26.4% out of sample over 2,028
races. This is a shortlist built on stated evidence, for your judgement &mdash; not a set of
recommended bets. 18+ &middot; BeGambleAware.org</div>
<pre>${esc(output)}</pre>
</div></body></html>`
  );

  const flaggedCount = Math.max(0, flagged.length - 1);
  console.log(`\n  written:`);
  console.log(`    ${txtPath}`);
  console.log(`    ${htmlPath}`);
  console.log(`    ${csvPath}   (${flaggedCount} flagged horses)`);
  console.log("");
}

main().catch((e) => { console.error("\nDaily report failed:", e.message); process.exit(1); });
