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
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
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

      // Cards are published in batches, and the Irish ones habitually land last.
      // On 2026-08-29 the 19:00 run caught four meetings; a re-ingest the next
      // morning found seven, including the Curragh and Sandown. One pass at
      // seven in the evening is not enough, and a short second pass costs
      // nothing — the ingest upserts on natural keys, so it is safe to repeat.
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

  // 4b. The NAP gets the long-form treatment.
  //
  // The NAP was being published as a horse, a price and a course — the same
  // three facts every racing site has, and none of the argument. The write-up
  // for its race is three sentences because every race gets three sentences;
  // the biggest bet of the day should be the longest thing on the page, not
  // the shortest. `vip.ts` already writes the full case for one horse, so the
  // top best bet gets one every day, and publish.ts picks it up from the folder
  // exactly as it picks up a hand-written one.
  const topBet = bets.match(/^1\.\s+([A-Z0-9' \-().]+?)\s{2,}/m)?.[1]?.trim();
  const topOff = bets.match(/^\s+(\d{2}:\d{2})\s+\S/m)?.[1];

  if (topBet && topOff) {
    console.log(`  writing the NAP note for ${topBet}...`);
    try {
      run("npx", [
        "tsx", "--env-file=.env.local", "scripts/vip.ts",
        date, topOff, topBet, "--save",
      ]);
    } catch (e) {
      // A missing NAP note costs the card its longest write-up, not the day.
      console.error(`  NAP note failed (the tips are unaffected): ${(e as Error).message.split("\n")[0]}`);
    }
  }

  // A failed run must never overwrite a good one.
  //
  // On 2026-08-30 the 19:00 job lost DNS to Neon. Every step failed, and the
  // report then wrote what it had — "Best bets failed: getaddrinfo ENOTFOUND"
  // — straight over Monday's tips, turning 40KB of write-ups into 402 bytes of
  // error text. The publish that followed could then find no write-ups, so the
  // failure was silent from the outside and total on disk.
  //
  // The files on the Desktop are the record of what was published. A run that
  // produced nothing has nothing to say about them.
  const failed = (out: string) =>
    !out.trim() ||
    /^(Write-ups|Best bets) failed/m.test(out) ||
    /ENOTFOUND|ECONNREFUSED|Command failed/.test(out.slice(0, 400));

  if (failed(writeups) || failed(bets)) {
    console.error("\n  RUN FAILED — the existing files have been left alone.");
    if (failed(writeups)) console.error("    write-ups: " + writeups.trim().split("\n")[0].slice(0, 120));
    if (failed(bets)) console.error("    best bets: " + bets.trim().split("\n")[0].slice(0, 120));
    console.error("\n  Nothing was written and nothing was published. Re-run when the");
    console.error("  database is reachable:  npm run daily -- " + date + "\n");
    process.exit(1);
  }

  // 5. Two files, which is all that was asked for: the selections, and the
  //    preview of every race. Anything else was clutter in the folder.
  // Named by day, not by ISO date. Sorted by name in Finder, "2026-08-29" lands
  // below the previous two days and Dan could not find it. The day is what he
  // is actually looking for.
  const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  const MONTHS = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"];
  const d = new Date(`${date}T12:00:00Z`);
  const label = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

  const betsPath = join(OUT_DIR, `${label} - BEST BETS.txt`);
  writeFileSync(betsPath, bets);

  const upPath = join(OUT_DIR, `${label} - RACE WRITE-UPS.txt`);
  writeFileSync(upPath, writeups);

  console.log(`\n  written:`);
  console.log(`    ${betsPath}`);
  console.log(`    ${upPath}`);

  // 6. Check the file that was just written against the database.
  //
  // Every error found in these files has been the same shape: a sentence
  // asserting something the record does not support. Reading them by eye is
  // not a check, it is a hope. This runs on every published file, and any
  // failure is written into the file itself rather than left in a log nobody
  // opens — an unverified claim the reader cannot see is worse than one
  // labelled as unverified.
  // Whether the day is fit to go out on its own.
  //
  // Dan, 2026-09-02, turning on unattended publishing: "publish."
  //
  // Draft-by-default had been doing two jobs — waiting for Dan, and stopping a
  // day that failed its checks. Remove the first and the second goes with it,
  // and a card that failed pre-flight would have gone live unattended. The
  // checks now gate the publish directly, so live mode means "live if it
  // passes" and nothing else.
  let checksPassed = true;

  console.log("\n  pre-flight checks...");
  try {
    const report = run("npx", ["tsx", "--env-file=.env.local", "scripts/preflight.ts", date]);
    console.log(report.split("\n").filter(Boolean).slice(-3).join("\n"));
  } catch (e) {
    const detail = (e as Error).message;
    checksPassed = false;
    console.error("  PRE-FLIGHT FAILED — do not send without checking");
    console.error(detail);

    writeFileSync(
      upPath,
      `!! PRE-FLIGHT FAILED — one or more checks did not pass. Treat this file\n` +
      `!! as provisional and check the races flagged below.\n` +
      `!!\n${detail.split("\n").map((l) => `!! ${l}`).join("\n")}\n\n` + writeups
    );
  }

  // 6b. The contradiction audit.
  //
  // Dan, 2026-09-01: "we need to check all write-ups as this can't happen,
  // it's sloppy."
  //
  // Pre-flight checks whether a claim matches the record. This checks whether
  // the write-up argues against itself — a horse that won last time being told
  // to "find a bit more than he has shown", a run he finished third in being
  // dismissed with "draw a line through it". Both went out before anything
  // looked, because the auditor existed but nothing ran it, and it did not
  // read the NAP note at all.
  //
  // Run over the last six days when it was first wired in, it found 18.
  console.log("\n  contradiction audit...");
  try {
    const audit = run("npx", ["tsx", "--env-file=.env.local", "scripts/audit-writeups.ts", date]);
    console.log(audit.split("\n").filter(Boolean).slice(-2).join("\n"));
  } catch (e) {
    const detail = (e as Error).message;
    checksPassed = false;
    console.error("  AUDIT FAILED — the write-ups contradict the form somewhere");
    console.error(detail.split("\n").slice(-14).join("\n"));

    writeFileSync(
      upPath,
      `!! AUDIT FAILED — one or more write-ups argue against the horse's own\n` +
      `!! record. Check the races listed below before sending.\n` +
      `!!\n${detail.split("\n").map((l) => `!! ${l}`).join("\n")}\n\n` +
      readFileSync(upPath, "utf8")
    );
  }

  // 7. Push to the site.
  //
  // Draft by default. The model has changed a great deal recently and an
  // unreviewed write-up going public is a worse failure than a late one — but
  // the files are on the site within a minute of being written, so publishing
  // is one click rather than an evening of copying.
  //
  // Set HRT_AUTOPUBLISH=live in .env.local to skip the review step.
  if (process.env.HRT_URL && process.env.HRT_TOKEN) {
    const wanted = (process.env.HRT_AUTOPUBLISH ?? "").toLowerCase() === "live";
    const live = wanted && checksPassed;

    if (wanted && !checksPassed) {
      console.error("  HELD AS DRAFT — autopublish is on, but the checks did not pass.");
      console.error("  Fix what is flagged above, then publish by hand:");
      console.error(`    npx tsx --env-file=.env.local scripts/publish.ts ${date} --live`);
    }
    console.log(`\n  publishing to the site (${live ? "live" : "draft"})...`);
    try {
      const args = ["tsx", "--env-file=.env.local", "scripts/publish.ts", date];
      if (live) args.push("--live");
      console.log(run("npx", args).split("\n").filter(Boolean).slice(-2).join("\n"));

      // Form profiles for the horses declared, so a name on a racecard has
      // somewhere to click through to. Always published — a reference page is
      // not a tip, and holding it as a draft would leave every horse link on
      // a live card pointing at nothing.
      //
      // Its own try: a failure here must not lose the day. The tips are
      // already up by this point, and a missing profile degrades to plain
      // text on the card rather than to a broken page.
      try {
        console.log("\n  pushing horse form profiles...");
        console.log(
          run("npx", ["tsx", "--env-file=.env.local", "scripts/publish-horses.ts", date])
            .split("\n").filter(Boolean).slice(-2).join("\n")
        );
      } catch (e) {
        console.error("  horse profiles failed (the tips are unaffected):");
        console.error("   ", (e as Error).message.split("\n")[0]);
      }
    } catch (e) {
      // A publishing failure must never lose the day's work — the files are
      // already written to the Desktop by this point.
      console.error("  publish failed (the files are still on the Desktop):");
      console.error("   ", (e as Error).message.split("\n")[0]);
    }
  }

  console.log("");
}

main().catch((e) => { console.error("\nDaily report failed:", e.message); process.exit(1); });
