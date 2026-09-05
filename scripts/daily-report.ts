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

  // 3. Write-ups for EVERY race, which is what goes on the site.
  console.log("  writing up every race...");
  let writeups = "";
  try {
    writeups = run("npx", ["tsx", "--env-file=.env.local", "scripts/write-ups.ts", date]);
  } catch (e) {
    writeups = `Write-ups failed:\n${(e as Error).message}`;
  }

  // 4. The five best bets.
  console.log("  picking the best bets...");
  let bets = "";
  try {
    bets = run("npx", ["tsx", "--env-file=.env.local", "scripts/best-bets.ts", date]);
  } catch (e) {
    bets = `Best bets failed:\n${(e as Error).message}`;
  }

  // 5. Two files, which is all that was asked for: the selections, and the
  //    preview of every race. Anything else was clutter in the folder.
  const betsPath = join(OUT_DIR, `${date} BEST BETS.txt`);
  writeFileSync(betsPath, bets);

  const upPath = join(OUT_DIR, `${date} race write-ups.txt`);
  writeFileSync(upPath, writeups);

  console.log(`\n  written:`);
  console.log(`    ${betsPath}`);
  console.log(`    ${upPath}`);
  console.log("");
}

main().catch((e) => { console.error("\nDaily report failed:", e.message); process.exit(1); });
