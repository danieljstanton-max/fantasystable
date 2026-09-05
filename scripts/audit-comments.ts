/**
 * Audit the comment parser against real comments.
 *
 *   npm run audit                     overview + the riskiest phrases
 *   npm run audit -- --reading=trouble    every phrase behind one reading
 *   npm run audit -- --phrase="in hand"   every comment a phrase fired on
 *   npm run audit -- --conflicts          comments where readings disagree
 *
 * Royal Duke's last run read "lost momentum inside final 110yds and dropped
 * away late". The parser called it a compromised run. It was a horse stopping.
 * That was worth three points and made it a recommended bet — found by one
 * person asking "how do you know?", not by any check we had.
 *
 * So this exists to make that kind of error findable on purpose. For every
 * reading it reports which phrase triggered it, how often, and — the number
 * that matters — the WIN RATE of runners it fired on. A reading that is
 * supposed to be positive but whose runners win less than average is either
 * mis-specified or measuring something else.
 */

import "dotenv/config";
import postgres from "postgres";
import { readComment } from "../lib/form-reading";

const client = postgres(process.env.DATABASE_URL!, { max: 4, ssl: "require" });
const args = process.argv.slice(2);
const arg = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;

const READING = arg("reading", "");
const PHRASE = arg("phrase", "");
const CONFLICTS = args.includes("--conflicts");
const SAMPLE = parseInt(arg("sample", "8"), 10);

interface Row {
  comment: string; pos: number | null; sp: number | null; horse: string;
  horseId: string; raceDate: string;
  /** Finishing position and SP in this horse's NEXT run. */
  nextPos: number | null; nextSp: number | null;
}

function pct(n: number, d: number) { return d ? `${((n / d) * 100).toFixed(1)}%` : "-"; }

async function main() {
  process.stdout.write("\n  loading comments... ");
  //
  // CRITICAL: every rate below is the horse's NEXT run, not this one.
  //
  // Measured against the same race, these readings are circular. "Comfortably",
  // "readily" and "in hand" DESCRIBE winners, so easyRide returned a 67.5% win
  // rate and looked like the strongest signal ever found. It was measuring the
  // race the comment was written about. A faller wins 0.7% of the race it fell
  // in, for the same reason.
  //
  // What the scorer actually asks is different: this horse was staying on / in
  // trouble / travelling well LAST time — is it more likely to win NEXT time?
  //
  const rows: Row[] = (await client`
    select r.comment, r.position_num pos, r.sp_dec sp, r.horse_name horse,
           r.horse_id "horseId", ra.race_date::text "raceDate",
           nx.position_num "nextPos", nx.sp_dec "nextSp"
    from runners r
    join races ra on ra.id = r.race_id
    left join lateral (
      select r2.position_num, r2.sp_dec
      from runners r2 join races ra2 on ra2.id = r2.race_id
      where r2.horse_id = r.horse_id
        and ra2.race_date > ra.race_date
        and r2.position is not null
      order by ra2.race_date asc
      limit 1
    ) nx on true
    where ra.status = 'result' and r.position is not null
      and r.comment is not null and r.comment <> ''
      and nx.position_num is not null
    limit 250000`) as any;
  console.log(`${rows.length.toLocaleString()} comments that have a following run`);

  const baseWins = rows.filter((r) => r.nextPos === 1).length;
  const baseRate = baseWins / rows.length;
  console.log(`  baseline: these horses win ${(baseRate * 100).toFixed(1)}% of their NEXT start\n`);

  /* ------------------------------------------------ single phrase ------- */
  if (PHRASE) {
    const hits = rows.filter((r) => r.comment.toLowerCase().includes(PHRASE.toLowerCase()));
    const w = hits.filter((r) => r.nextPos === 1).length;
    console.log(`${"=".repeat(78)}`);
    console.log(`PHRASE "${PHRASE}" — ${hits.length.toLocaleString()} comments; they win ${pct(w, hits.length)} of their NEXT start\n`);
    for (const h of hits.slice(0, 25)) {
      const r = readComment(h.comment);
      const flags = [
        r.runStyle, r.trouble && "TROUBLE", r.stayedOn && "stayed-on",
        r.failedToStay && "weakened", r.travelledWell && "travelled",
        r.easyRide && "easy", r.fellGoingWell && "fell-going-well",
      ].filter(Boolean).join(" ");
      console.log(`  [pos ${String(h.pos ?? "-").padStart(3)}] ${flags}`);
      console.log(`    ${h.comment.slice(0, 150)}`);
    }
    console.log("");
    await client.end();
    return;
  }

  /* -------------------------------------------------- conflicts --------- */
  if (CONFLICTS) {
    const bad = rows.filter((r) => {
      const x = readComment(r.comment);
      return (x.trouble && x.failedToStay) || (x.stayedOn && x.failedToStay) || (x.travelledWell && x.failedToStay);
    });
    console.log(`${"=".repeat(78)}`);
    console.log(`CONFLICTING READINGS — ${bad.length.toLocaleString()} of ${rows.length.toLocaleString()} (${pct(bad.length, rows.length)})\n`);
    console.log(`  These are comments where the parser reached two conclusions that`);
    console.log(`  pull opposite ways. Each one is a chance to be wrong.\n`);
    for (const h of bad.slice(0, 20)) {
      const x = readComment(h.comment);
      const flags = [x.trouble && "TROUBLE", x.stayedOn && "stayed-on", x.travelledWell && "travelled", x.failedToStay && "weakened"]
        .filter(Boolean).join(" + ");
      console.log(`  [pos ${String(h.pos ?? "-").padStart(3)}] ${flags}`);
      console.log(`    ${h.comment.slice(0, 150)}`);
    }
    console.log("");
    await client.end();
    return;
  }

  /* ---------------------------------------------- reading breakdown ----- */

  const READINGS: Array<[string, (c: string) => boolean, "positive" | "negative"]> = [
    ["stayedOn", (c) => readComment(c).stayedOn, "positive"],
    ["trouble", (c) => readComment(c).trouble, "positive"],
    ["travelledWell", (c) => readComment(c).travelledWell, "positive"],
    ["easyRide", (c) => readComment(c).easyRide, "positive"],
    ["fellGoingWell", (c) => readComment(c).fellGoingWell, "positive"],
    ["failedToStay", (c) => readComment(c).failedToStay, "negative"],
  ];

  console.log(`${"=".repeat(78)}`);
  console.log(`READINGS — do they predict the NEXT run?\n`);
  console.log(`  ${"reading".padEnd(16)}${"expect".padEnd(10)}${"fired".padStart(9)}${"win%".padStart(8)}${"vs base".padStart(10)}  verdict`);

  for (const [name, test, expect] of READINGS) {
    if (READING && READING !== name) continue;
    const hits = rows.filter((r) => test(r.comment));
    const w = hits.filter((r) => r.nextPos === 1).length;
    const rate = hits.length ? w / hits.length : 0;
    const lift = (rate - baseRate) * 100;
    const ok = expect === "positive" ? lift > -0.5 : lift < 0.5;
    console.log(
      `  ${name.padEnd(16)}${expect.padEnd(10)}${hits.length.toLocaleString().padStart(9)}` +
        `${(rate * 100).toFixed(1).padStart(7)}%${((lift >= 0 ? "+" : "") + lift.toFixed(1) + "pp").padStart(10)}` +
        `  ${ok ? "ok" : "<-- WRONG DIRECTION"}`
    );
  }

  /* ------------------------------------------- riskiest phrases --------- */
  // A phrase that fires often AND whose runners win below average is the kind
  // that produced the Royal Duke error: it is being read as encouragement when
  // the horses it describes are, on the evidence, beaten.

  console.log(`\n${"-".repeat(78)}`);
  console.log(`RISKIEST PHRASES  (read as positive, but the horses underperform NEXT time)\n`);

  const POSITIVE_PHRASES = [
    "stayed on well", "stayed on", "kept on", "finished strongly", "ran on",
    "rallied", "plugged on", "closed on", "fought on", "responded to keep",
    "no room", "short of room", "hampered", "denied a clear run", "checked",
    "squeezed out", "had to switch", "lost momentum",
    "travelling well", "travelling strongly", "going well", "cruising",
    "in hand", "comfortably", "readily", "easily", "pushed out", "in command",
    "not knocked about", "eased down", "allowed to coast",
  ];

  const scored = POSITIVE_PHRASES.map((p) => {
    const hits = rows.filter((r) => r.comment.toLowerCase().includes(p));
    const w = hits.filter((r) => r.nextPos === 1).length;
    return { p, n: hits.length, rate: hits.length ? w / hits.length : 0 };
  })
    .filter((x) => x.n >= 100)
    .sort((a, b) => a.rate - b.rate);

  console.log(`  ${"phrase".padEnd(26)}${"fired".padStart(8)}${"win%".padStart(8)}${"vs base".padStart(10)}`);
  for (const x of scored.slice(0, 12)) {
    const lift = (x.rate - baseRate) * 100;
    console.log(
      `  ${x.p.padEnd(26)}${x.n.toLocaleString().padStart(8)}${(x.rate * 100).toFixed(1).padStart(7)}%` +
        `${((lift >= 0 ? "+" : "") + lift.toFixed(1) + "pp").padStart(10)}${lift < -1 ? "  <-- check this" : ""}`
    );
  }

  console.log(`\n  Inspect any of them:  npm run audit -- --phrase="lost momentum"\n`);
  console.log(`${"=".repeat(78)}\n`);
  await client.end();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
