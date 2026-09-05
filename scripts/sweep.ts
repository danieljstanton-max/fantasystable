/**
 * The ten-minute sweep: keep today's card, its prices and its results current,
 * then rebuild the month's running total.
 *
 *   npm run sweep            # respects the racing-hours window
 *   npm run sweep -- --now   # run every step regardless of the hour
 *
 * Why this is TypeScript and not the shell script it replaces.
 *
 * Dan, 2026-09-03: "I'm not sure the website is running updated odds regularly."
 *
 * It was not. The launchd job had been repointed at scripts/push-results.sh and
 * every run since exited 127 — zsh could not read the file. macOS does not let
 * a launchd-spawned shell into ~/Documents, which the log had been saying for
 * weeks in a way nobody read: 136 "getcwd: cannot access parent directories"
 * lines, going back long before the change. It never mattered while the plist
 * invoked npm directly, because node is what actually opens the project files
 * and node has access; the shell only ever needed to exist.
 *
 * So the sweep lives where the access is. The plist is back to the shape that
 * demonstrably worked — npm run, with WorkingDirectory set — and this file is
 * the single definition of what a sweep does, which is the point that was lost
 * when the plist grew its own inline copy of the commands.
 */
import { spawnSync } from "node:child_process";

const london = (opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...opts });

const parts = london({
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
}).formatToParts(new Date());

const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
const today = `${get("year")}-${get("month")}-${get("day")}`;
const hour = parseInt(get("hour"), 10);
const day = parseInt(get("day"), 10);
const month = today.slice(0, 7);

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const yesterday = shift(today, -1);
const lastMonth = shift(`${month}-01`, -1).slice(0, 7);

const force = process.argv.includes("--now");

// Nothing to do overnight. London hours, not the machine's: on CEST the local
// clock reads 00:xx while London is still on 23:xx, and a bare local date names
// a day the card has not reached — which is what produced the 422s from the
// results endpoint on 1 September.
if (!force && (hour < 7 || hour > 23)) process.exit(0);

console.log(`--- ${today} ${get("hour")}:${get("minute")} London ---`);

/**
 * One step. Never fatal.
 *
 * Under `set -e` in the old script the first failure killed everything after
 * it, which is how a single 422 stopped the month push for a whole day without
 * saying so.
 */
function step(label: string, args: string[]) {
  const r = spawnSync("npx", ["tsx", "--env-file=.env.local", ...args], {
    stdio: "inherit",
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(`  step failed, continuing: ${label} (exit ${r.status ?? "signal"})`);
  }
}

// From 07:00 — the card, and the prices on it. The odds push is the whole
// reason a reader sees a current price beside the advised one.
step("ingest racecards", ["scripts/ingest-racecards.ts", today]);
step("publish odds", ["scripts/publish-odds.ts", today]);

// From 11:00 — results. A race that has not returned is skipped, so an early
// pass costs one API call. Yesterday is swept too: Irish cards and evening
// meetings settle after midnight, and a day is not finished when the clock
// says it is.
if (force || hour >= 11) {
  step("ingest results", ["scripts/ingest-results.ts", today]);
  step("publish results (today)", ["scripts/publish-results.ts", today]);
  step("publish results (yesterday)", ["scripts/publish-results.ts", yesterday]);

  // Recomputed from the published files every pass rather than accumulated: a
  // corrected result or a late non-runner has to be able to move the figure.
  step("publish month", ["scripts/publish-month.ts", month]);

  // Either side of a rollover, so the 1st does not blank the widget while the
  // previous evening is still settling.
  if (day <= 2) step("publish previous month", ["scripts/publish-month.ts", lastMonth]);
}
