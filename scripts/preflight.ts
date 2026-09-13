/**
 * Pre-flight checks. Run before either file is sent.
 *
 *   npm run preflight -- 2026-08-28
 *
 * Every check here exists because a specific error reached Dan in a published
 * file. The date on each is when it was found. Nothing is removed once added:
 * a check that has never failed since the day it was written is the check
 * doing its job.
 *
 * Exit code is the number of failures, so the daily job can refuse to ship.
 */
import "dotenv/config";
import { OUT_DIR, dayLabel, writeUpsPath, bestBetsPath } from "../lib/published";
import { openerAlternation } from "../lib/voice";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import postgres from "postgres";
import { readComment } from "../lib/form-reading";
import { betFor } from "../lib/staking";

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

type Check = {
  id: string;
  found: string;
  what: string;
  failures: string[];
};

(async () => {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run preflight -- YYYY-MM-DD");
    process.exit(1);
  }

  // Where the day's files are is decided in one place. The report started
  // writing day-named files ("MONDAY 31 August - BEST BETS.txt") and the
  // pre-flight was still looking for the ISO names, so it failed on every run
  // and stamped PRE-FLIGHT FAILED on a file that had never been checked.
  const upPath = writeUpsPath(date);
  const betPath = bestBetsPath(date);

  if (!upPath || !betPath) {
    console.error(`missing: no write-ups or best bets on the Desktop for ${date}`);
    console.error(`  looked for "${dayLabel(date)} - ..." and "${date} ..." in ${OUT_DIR}`);
    process.exit(1);
  }

  const up = readFileSync(upPath, "utf8");
  const bets = readFileSync(betPath, "utf8");
  const upLines = up.split(/\r?\n/);

  // The pre-flight fires one history query per selection — fifty-odd round
  // trips in a row. Neon dropped the connection mid-run on 2026-08-29 with
  // ECONNRESET, the job aborted, and the write-ups shipped stamped as failed
  // when nothing was actually wrong with them. Idle timeout and a retry make it
  // survive a dropped socket.
  const sql = postgres(process.env.DATABASE_URL!, {
    ssl: "require",
    max: 3,
    idle_timeout: 20,
    connect_timeout: 30,
    max_lifetime: 60 * 30,
  });

  /** Retry a query once on a dropped connection. */
  const retry = async <T>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); }
    catch (e: any) {
      if (!/ECONNRESET|CONNECTION_CLOSED|CONNECT_TIMEOUT/i.test(String(e?.code ?? e?.message))) throw e;
      await new Promise((r) => setTimeout(r, 1200));
      return await fn();
    }
  };
  const checks: Check[] = [];
  const add = (id: string, found: string, what: string, failures: string[]) =>
    checks.push({ id, found, what, failures });

  /* ---------------------------------------------------------------- data */

  const races = await sql`
    select ra.id, ra.off_time "off", ra.course_name "course", ra.name,
           ra.field_size "field", ra.going
    from races ra where ra.race_date = ${date} order by ra.off_time`;

  const runners = await sql`
    select r.horse_id "id", r.horse_name "name", r.race_id "raceId",
           r.is_non_runner "nr", r.best_odds_dec "priceDec"
    from runners r join races ra on ra.id = r.race_id
    where ra.race_date = ${date}`;

  const idByName = new Map<string, any>();
  for (const r of runners as any[]) idByName.set(norm(r.name), r);

  // Selection sentences, by race.
  type Sel = { race: string; horse: string; sentence: string; verdict: string };
  const sels: Sel[] = [];
  let race = "";
  for (let i = 0; i < upLines.length; i++) {
    const r = upLines[i].match(/^(\d{2}:\d{2})\s{2,}(.+)$/);
    if (r) { race = `${r[1]} ${r[2].slice(0, 38)}`; continue; }
    // The openers come from lib/voice, the same list the write-ups are
    // generated from. Hard-coding three of them here meant every phrase added
    // later was invisible to this check, and all five best bets were reported
    // as missing from their own write-ups.
    const m = upLines[i].match(
      new RegExp(`^([A-Z][A-Z0-9' ]+[A-Z0-9]) at .*?(?:${openerAlternation()})\\.\\s*(.*)$`)
    );
    if (m) {
      const v = upLines.slice(i, i + 6).find((l) => l.startsWith("VERDICT:")) ?? "";
      sels.push({ race, horse: m[1].trim(), sentence: m[2], verdict: v });
    }
  }

  /* -------------------------------------------------------------- checks */

  // 1
  {
    const verdicts = (up.match(/^VERDICT:/gm) ?? []).length;
    add("coverage", "2026-08-27",
      "Every race on the card has a verdict — no race is skipped",
      verdicts === (races as any[]).length
        ? []
        : [`${verdicts} verdicts for ${(races as any[]).length} races`]);
  }

  // 2
  // Word boundaries matter here. Without them "avoid" matches inside a horse's
  // name: SAX AVOIDANCE, 20:00 Kempton on 2026-09-14, read as a hedged verdict
  // and held the whole card off the site overnight. The verdict was
  // "SAX AVOIDANCE 4/1 — 1pt win", as committed as they come.
  add("no-hedging", "2026-08-27",
    'No "no bet" or hedged verdicts — the site commits to every race',
    (up.match(/^VERDICT:.*\b(no bet|nothing to back|avoid)\b/gim) ?? []));

  // 3
  {
    const bad: string[] = [];
    const betHorses = [...bets.matchAll(/^\d+\.\s+([A-Z][A-Z0-9' ]+[A-Z0-9])\s{2,}/gm)].map((m) => m[1].trim());
    for (const h of betHorses) {
      const s = sels.find((x) => norm(x.horse) === norm(h));
      if (!s) bad.push(`${h} is a best bet but is not the write-up selection for its race`);
    }
    add("files-agree", "2026-08-26",
      "Every best bet is also the write-up selection for that race", bad);
  }

  // 4
  {
    const bad: string[] = [];
    for (const s of sels) {
      if (/no price yet/.test(s.verdict)) continue;
      const m = s.verdict.match(/^VERDICT:\s+.+?\s+(\S+)\s+—\s+(.+)$/);
      if (!m) { bad.push(`${s.race} ${s.horse}: verdict carries no stake`); continue; }
      const priceDec = idByName.get(norm(s.horse))?.priceDec ?? null;
      const want = betFor(priceDec === null ? null : Number(priceDec));
      if (want.type !== "none" && !m[2].startsWith(want.label))
        bad.push(`${s.race} ${s.horse}: stake is "${m[2]}", plan says "${want.label}"`);
    }
    add("staking", "2026-08-27",
      "1pt win at 5/1 and under, 0.5pt each-way at 11/2 and bigger", bad);
  }

  // 5
  add("prices", "2026-08-27",
    "Priced selections state the price; unpriced ones say so rather than guessing",
    (up.match(/^VERDICT:\s+[A-Z][A-Z0-9' ]*[A-Z0-9]\s*$/gm) ?? [])
      .map((l) => `${l.trim()} — no price and no explanation`));

  // 6
  add("no-nulls", "2026-08-27",
    'No "null" or "undefined" printed where a value was missing',
    [...up.matchAll(/\b(null|undefined|NaN)\b/g)].map((m) => `literal "${m[1]}" in the file`));

  // 7
  add("rounding", "2026-08-28",
    "No unrounded percentages or long decimals",
    [...up.matchAll(/\d+\.\d{4,}/g)].map((m) => `${m[0]} printed unrounded`));

  // 8
  // Widened 2026-08-30 after "ran 1 days ago" reached the site on the NAP.
  // One bad plural on the biggest bet of the day is the sentence a reader
  // remembers, so every countable noun the generator prints is checked, not
  // just the two that had already gone wrong.
  // 0. There is a card at all.
  //
  // Dan, 2026-09-08: "don't update the site if you find an error — ask for
  // approval." The first thing to check is that there is something to approve.
  //
  // On 7 September the daily job ran before Tuesday's declarations reached the
  // database. The write-ups file contained one line — "No races stored for
  // 2026-09-08" — and every one of these checks PASSED, because each looks for
  // a bad thing and an empty file has none. Only publish.ts noticed, and only
  // because it could not find write-ups to send. A check that cannot fail on an
  // empty input is not a check.
  add("has-a-card", "2026-09-08",
    "The card has selections in it at all",
    (() => {
      const verdicts = (up.match(/^VERDICT:/gm) ?? []).length;
      if (verdicts === 0) return ["the write-ups file contains no verdicts at all"];
      if (verdicts < (races as any[]).length)
        return [`${verdicts} verdicts for ${(races as any[]).length} races — the file is incomplete`];
      return [];
    })());

  add("grammar", "2026-08-30",
    "Singular/plural agreement on every counted noun",
    // The word boundary alone is not enough: \b sits happily after the decimal
    // point in "2.1 times", so a pace line reading "front-runners win 2.1 times
    // their share" was reported as "1 times" and held a clean card as a draft
    // on 2 September. The NAP and the Lucky 15 did not switch over that night
    // because of it. A lookbehind rules out a preceding digit or point.
    [...up.matchAll(
      /(?<![\d.])\b1 (lengths|pounds|lbs|days|weeks|months|years|runs|wins|starts|times|places|runners)\b/g
    )].map((m) => `"1 ${m[1]}"`));

  // 9
  add("no-raw-labels", "2026-08-28",
    "No raw signal labels dropped into prose",
    [...up.matchAll(/It (proven|significant|course winner|yard in form)/g)]
      .map((m) => `"${m[0]}..." — signal name used as a verb phrase`));

  // 10
  add("house-style", "2026-08-28",
    'A win off an unchanged mark reads "escapes a penalty", never "raised 0lb"',
    [...up.matchAll(/raised (?:only )?0lb/g)].map((m) => `"${m[0]}"`));

  // 11
  add("voice", "2026-08-28",
    'The horse is "he", not "it" — Dan\'s register, not a form-book readout',
    [...up.matchAll(/(?:makes most appeal|looks the pick of these|is the one[^.]*)\. It /g)]
      .map(() => 'selection sentence uses "It" for the horse')
      .concat([...up.matchAll(/(?:trip|ground|mark) (?:it|its) /g)]
        .map((m) => `"${m[0].trim()}" — the horse is "he"`)));

  // 12
  add("verb-phrases", "2026-08-28",
    'Clauses after "It ..." read as verb phrases, not bare subjects',
    [...up.matchAll(/\bIt (the|a|an|his|her|its) \b/g)].map((m) => `"${m[0].trim()}..."`));

  // 12
  add("repetition", "2026-08-28",
    "No single clause opens more than a fifth of the write-ups",
    (() => {
      const counts = new Map<string, number>();
      for (const sel of sels) {
        const first = sel.sentence.replace(/^It /, "").split(/,| and /)[0].trim().slice(0, 40);
        if (first) counts.set(first, (counts.get(first) ?? 0) + 1);
      }
      const cap = Math.max(4, Math.ceil(sels.length / 5));
      return [...counts.entries()]
        .filter(([, n]) => n > cap)
        .map(([c, n]) => `"${c}..." opens ${n} of ${sels.length} write-ups (cap ${cap})`);
    })());

  // 13
  add("pace-evidence", "2026-08-28",
    "Pace claims cite the track's own bias, never asserted blanket",
    (up.match(/uncontested lead could be worth plenty/g) ?? [])
      .map(() => "blanket front-runner claim with no impact value"));

  /* --- per-selection checks against the record --- */
  const stayed: string[] = [];
  const wonLast: string[] = [];
  const beatenClaim: string[] = [];
  const courseWins: string[] = [];
  const nonRunner: string[] = [];

  for (const s of sels) {
    const r = idByName.get(norm(s.horse));
    if (!r) { nonRunner.push(`${s.race}: ${s.horse} is not a declared runner`); continue; }
    if (r.nr) { nonRunner.push(`${s.race}: ${s.horse} is a non-runner`); continue; }

    const hist = await retry(() => sql`
      select ra.race_date "d", ra.course_slug "cs", r.position_num "pos",
             r.ofr, r.ovr_btn "btn", r.comment
      from runners r join races ra on ra.id = r.race_id
      where r.horse_id = ${r.id} and ra.race_date < ${date} and r.position_num is not null
      order by ra.race_date desc`);
    // No limit. It was 60, the same cap the write-ups used, so the check and
    // the thing it checks were reading the same truncated history and agreeing
    // with each other while both were wrong. A verifier that shares its
    // subject's blind spot is not a verifier.
    const runs = hist as any[];
    const last = runs[0];

    if (/staying on at the finish last time/.test(s.sentence)) {
      if (!last?.comment || !readComment(last.comment).stayedOn)
        stayed.push(`${s.race} ${s.horse}: comment does not support it — "${String(last?.comment ?? "").slice(-64)}"`);
      // A winner staying on is not information. The claim is only worth making
      // about a horse that was beaten.
      else if (last?.pos === 1)
        stayed.push(`${s.race} ${s.horse}: won last time — "staying on at the finish" says nothing`);
    }

    if (last?.position_num === 1 || last?.pos === 1) {
      if (/^It was beaten /.test(s.sentence))
        wonLast.push(`${s.race} ${s.horse}: won last time but the write-up leads on a beaten run`);
    }

    const btn = s.sentence.match(/beaten ([\d.]+) lengths? off (\d+)/);
    if (btn && !runs.some((x) => String(x.ofr) === btn[2] && Math.abs(Number(x.btn ?? -1) - Number(btn[1])) < 0.6))
      beatenClaim.push(`${s.race} ${s.horse}: "${btn[0]}" matches no run on record`);

    const here = s.sentence.match(/has won here(?: (\d+) times| twice)?/);
    if (here) {
      const claimed = here[1] ? parseInt(here[1], 10) : here[0].includes("twice") ? 2 : 1;
      const [{ cs }] = (await retry(() =>
        sql`select course_slug "cs" from races where id = ${r.raceId}`)) as any;
      const actual = runs.filter((x) => x.pos === 1 && x.cs === cs).length;
      if (actual !== claimed)
        courseWins.push(`${s.race} ${s.horse}: claims ${claimed} course win(s), record shows ${actual}`);
    }
  }

  add("staying-on", "2026-08-28",
    '"Staying on at the finish" is supported by the actual running comment', stayed);
  add("leads-on-best", "2026-08-28",
    "A horse that won last time is not described as beaten", wonLast);
  add("beaten-claim", "2026-08-28",
    '"Beaten N lengths off M" matches a real run', beatenClaim);
  add("course-wins", "2026-08-28",
    '"Has won here N times" matches the course record', courseWins);
  add("real-runners", "2026-08-27",
    "Every selection is a declared, non-withdrawn runner", nonRunner);

  /* -------------------------------------------------------------- report */

  const failed = checks.filter((c) => c.failures.length);

  console.log(`\nPRE-FLIGHT — ${date}`);
  console.log("=".repeat(78));
  console.log(`  ${sels.length} selections across ${(races as any[]).length} races\n`);

  for (const c of checks) {
    const ok = c.failures.length === 0;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.id.padEnd(15)} ${c.what}`);
    if (!ok) for (const f of c.failures.slice(0, 6)) console.log(`          ${f}`);
    if (c.failures.length > 6) console.log(`          ...and ${c.failures.length - 6} more`);
  }

  console.log("");
  console.log(
    failed.length
      ? `  ${failed.length} of ${checks.length} checks FAILED — do not send.\n`
      : `  All ${checks.length} checks passed.\n`
  );

  await sql.end();
  process.exit(failed.length);
})();
