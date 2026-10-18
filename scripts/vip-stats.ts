/**
 * The VIP record cut the ways Dan actually reads it.
 *
 *   npm run vip:stats                 the last 7 days
 *   npm run vip:stats -- --days=30
 *   npm run vip:stats -- --month=2026-10
 *
 * Dan, 2026-10-18: "any stats for the last week on VIP — winning days v
 * losing days etc."
 *
 * A running total answers "how are we doing" and nothing else. What a service
 * is actually judged on is how often a subscriber has a good day, how long the
 * bad runs get, and whether the prices being advised are any good — a losing
 * day on three beaten favourites is a different thing from a losing day on
 * three horses that drifted.
 *
 * Settlement is NOT reimplemented here. It imports the same rules the published
 * record uses — Best Odds Guaranteed, each-way terms read from our own data,
 * a non-runner voided rather than lost — because two numbers for the same bet
 * is how a record stops being believed. See scripts/publish-vip.ts.
 */
import "dotenv/config";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { fracToDec, bestOddsGuaranteed } from "../lib/staking";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;

type Bet = { date: string; horse: string; stake: number; type: "win" | "ew"; price: string | null };

/** The same settlement as the published record. */
function settle(
  bet: Bet, result: string, ewDenom: number | null, spFrac: string | null
): { staked: number; profit: number } {
  const unit = bet.stake;
  const staked = bet.type === "ew" ? unit * 2 : unit;
  if (result === "void") return { staked: 0, profit: 0 };
  if (result === "pending") return { staked, profit: 0 };
  if (result === "lost") return { staked, profit: -staked };
  const advised = bet.price ? fracToDec(bet.price) : null;
  const dec = bestOddsGuaranteed(advised, fracToDec(spFrac));
  if (dec === null) return { staked, profit: 0 };
  const odds = dec - 1;
  const denom = ewDenom && ewDenom > 0 ? ewDenom : 5;
  let returned = 0;
  if (result === "won") {
    returned += unit * (1 + odds);
    if (bet.type === "ew") returned += unit * (1 + odds / denom);
  } else if (bet.type === "ew") {
    returned += unit * (1 + odds / denom);
  }
  return { staked, profit: returned - staked };
}

const money = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}`;

async function main() {
  const month = arg("month", "");
  const days = parseInt(arg("days", "7"), 10);
  const file = JSON.parse(readFileSync("data/vip-bets.json", "utf8"));

  let bets: Bet[] = Object.values(file.bets ?? {}).flat() as Bet[];
  bets.sort((a, b) => a.date.localeCompare(b.date));

  let from: string;
  if (month) {
    bets = bets.filter((b) => b.date.startsWith(month));
    from = `${month}-01`;
  } else {
    const last = bets.length ? bets[bets.length - 1].date : new Date().toISOString().slice(0, 10);
    const d = new Date(`${last}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (days - 1));
    from = d.toISOString().slice(0, 10);
    bets = bets.filter((b) => b.date >= from);
  }
  if (!bets.length) { console.log("\nNo VIP bets in that window.\n"); return; }

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });
  type Row = Bet & {
    result: string; staked: number; profit: number;
    sp: string | null; bsp: number | null; course: string; off: string; field: number;
  };
  const rows: Row[] = [];

  for (const b of bets) {
    const [r] = await sql<any[]>`
      SELECT ru.position_num, ru.sp, ru.bsp, ru.ew_places, ru.ew_denom, ru.is_non_runner,
             ra.off_time, ra.course_name, ra.field_size
      FROM runners ru JOIN races ra ON ra.id = ru.race_id
      WHERE ra.race_date = ${b.date} AND upper(ru.horse_name) = ${b.horse.toUpperCase()}`;
    const finish = r?.position_num === null || r?.position_num === undefined ? null : Number(r.position_num);
    const places = r?.ew_places === null || r?.ew_places === undefined ? null : Number(r.ew_places);
    let result = "pending";
    if (r?.is_non_runner) result = "void";
    else if (finish === null) result = "pending";
    else if (finish === 1) result = "won";
    else if (b.type === "ew" && places !== null && finish <= places) result = "placed";
    else result = "lost";
    const { staked, profit } = settle(b, result, r?.ew_denom ?? null, r?.sp ?? null);
    rows.push({
      ...b, result, staked, profit, sp: r?.sp ?? null,
      bsp: r?.bsp === null || r?.bsp === undefined ? null : Number(r.bsp),
      course: String(r?.course_name ?? "?"), off: String(r?.off_time ?? "?"),
      field: Number(r?.field_size ?? 0),
    });
  }
  await sql.end();

  const settled = rows.filter((r) => r.result !== "pending" && r.result !== "void");
  const label = month ? month : `${from} to ${bets[bets.length - 1].date}`;

  console.log(`\nVIP — ${label}`);
  console.log("=".repeat(70));

  /* ---------------------------------------------------------- by day ---- */
  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date)!.push(r);
  }
  const dayList = [...byDay.keys()].sort();

  console.log("\n  DAY BY DAY\n");
  console.log(`  ${"date".padEnd(12)}${"bets".padStart(5)}${"won".padStart(5)}${"staked".padStart(9)}${"P&L".padStart(9)}   selections`);
  let up = 0, down = 0, levelDays = 0;
  for (const d of dayList) {
    const g = byDay.get(d)!;
    const p = g.reduce((s, x) => s + x.profit, 0);
    const st = g.reduce((s, x) => s + x.staked, 0);
    const w = g.filter((x) => x.result === "won").length;
    if (g.every((x) => x.result === "pending")) continue;
    if (p > 0.0001) up++; else if (p < -0.0001) down++; else levelDays++;
    const names = g.map((x) => `${x.horse}${x.result === "won" ? " (W)" : x.result === "placed" ? " (P)" : ""}`).join(", ");
    console.log(`  ${d.padEnd(12)}${String(g.length).padStart(5)}${String(w).padStart(5)}${st.toFixed(2).padStart(9)}${money(p).padStart(9)}   ${names.slice(0, 44)}`);
  }

  /* ------------------------------------------------------- headline ----- */
  const staked = settled.reduce((s, x) => s + x.staked, 0);
  const profit = settled.reduce((s, x) => s + x.profit, 0);
  const winners = settled.filter((x) => x.result === "won").length;
  const placed = settled.filter((x) => x.result === "placed").length;

  console.log(`\n  WINNING DAYS v LOSING DAYS\n`);
  const totalDays = up + down + levelDays;
  console.log(`    winning days   ${String(up).padStart(2)} of ${totalDays}   ${((100 * up) / totalDays).toFixed(0)}%`);
  console.log(`    losing days    ${String(down).padStart(2)} of ${totalDays}   ${((100 * down) / totalDays).toFixed(0)}%`);
  if (levelDays) console.log(`    level days     ${String(levelDays).padStart(2)}`);

  // The run a subscriber actually sits through.
  let runD = 0, worstRun = 0, runW = 0, bestRun = 0;
  for (const d of dayList) {
    const g = byDay.get(d)!;
    if (g.every((x) => x.result === "pending")) continue;
    const p = g.reduce((s, x) => s + x.profit, 0);
    if (p < 0) { runD++; runW = 0; worstRun = Math.max(worstRun, runD); }
    else if (p > 0) { runW++; runD = 0; bestRun = Math.max(bestRun, runW); }
  }
  console.log(`    longest losing run  ${worstRun} day${worstRun === 1 ? "" : "s"}`);
  console.log(`    longest winning run ${bestRun} day${bestRun === 1 ? "" : "s"}`);

  // Dan, 2026-10-18: "just fun stats for the week — biggest day v worst day."
  const dayPnl = dayList
    .map((d) => ({ d, g: byDay.get(d)!, p: byDay.get(d)!.reduce((s, x) => s + x.profit, 0) }))
    .filter((x) => !x.g.every((b) => b.result === "pending"))
    .sort((a, b) => b.p - a.p);
  if (dayPnl.length) {
    const top = dayPnl[0], bot = dayPnl[dayPnl.length - 1];
    const who = (g: Row[]) => g.map((x) => x.horse.toUpperCase()).join(", ");
    console.log(`\n    best day    ${top.d}  ${money(top.p)}pts   ${who(top.g).slice(0, 40)}`);
    console.log(`    worst day   ${bot.d}  ${money(bot.p)}pts   ${who(bot.g).slice(0, 40)}`);
  }

  console.log(`\n  THE BETS\n`);
  console.log(`    ${settled.length} settled · ${winners} won${placed ? `, ${placed} placed` : ""} · strike rate ${((100 * winners) / settled.length).toFixed(0)}%`);
  console.log(`    ${staked.toFixed(2)}pts staked · ${money(profit)}pts · ROI ${((100 * profit) / staked).toFixed(1)}%`);
  const pend = rows.filter((x) => x.result === "pending").length;
  if (pend) console.log(`    ${pend} still to run`);

  // Where the profit came from. One horse carrying a week is worth knowing.
  const best = [...settled].sort((a, b) => b.profit - a.profit)[0];
  if (best && best.profit > 0) {
    console.log(`    biggest winner: ${best.horse.toUpperCase()} ${best.price ?? "?"} ${money(best.profit)}pts` +
      ` — ${((100 * best.profit) / Math.max(profit, 0.01)).toFixed(0)}% of the period's profit`);
  }

  /* ------------------------------------------- price-taking v the SP ---- */
  //
  // Dan, 2026-10-18: "biggest price winner, beating the sp etc."
  //
  // Two different questions that look like one. Whether the advised price beat
  // the SP says how good the price-taking was. What Best Odds Guaranteed added
  // is the other side of it: when a horse drifts, BOG pays the SP instead, so
  // the bets that "lost" on price still collected the bigger number.
  const priced = settled.filter((x) => x.price && fracToDec(x.price) && x.sp && fracToDec(x.sp));
  if (priced.length) {
    const beatSp = priced.filter((x) => fracToDec(x.price)! > fracToDec(x.sp)!);
    const drifted = priced.filter((x) => fracToDec(x.sp)! > fracToDec(x.price)!);

    // What BOG was actually worth: re-settle the winners at the advised price
    // and see the difference.
    let bogGain = 0;
    for (const x of priced) {
      if (x.result !== "won" && x.result !== "placed") continue;
      const adv = fracToDec(x.price)!, sp = fracToDec(x.sp)!;
      if (sp <= adv) continue;
      const unit = x.stake, denom = 5;
      const gain = x.type === "ew"
        ? unit * ((sp - adv) + (sp - adv) / denom)
        : unit * (sp - adv);
      bogGain += x.result === "won" ? gain : (x.type === "ew" ? unit * ((sp - adv) / denom) : 0);
    }

    console.log(`\n  PRICE TAKING\n`);
    console.log(`    advised price beat the SP on ${beatSp.length} of ${priced.length}`);
    console.log(`    drifted and paid at SP on ${drifted.length} (Best Odds Guaranteed)`);
    console.log(`    BOG was worth ${money(bogGain)}pts this period`);

    const winners2 = settled.filter((x) => x.result === "won" && x.price && fracToDec(x.price));
    if (winners2.length) {
      const big = [...winners2].sort((a, b) => fracToDec(b.price)! - fracToDec(a.price)!)[0];
      const avg = winners2.reduce((s, x) => s + fracToDec(x.price)!, 0) / winners2.length;
      console.log(`\n    biggest-priced winner  ${big.horse.toUpperCase()} at ${big.price}` +
        ` (${big.off} ${big.course}, ${money(big.profit)}pts)`);
      console.log(`    average winning price  ${(avg - 1).toFixed(2)}/1`);
    }
  }

  /* ------------------------------------------------------------ CLV ----- */
  const withBsp = settled.filter((x) => x.bsp !== null && x.price && fracToDec(x.price));
  if (withBsp.length) {
    const clvs = withBsp.map((x) => ((fracToDec(x.price)! / (x.bsp as number)) - 1) * 100).sort((a, b) => a - b);
    const mean = clvs.reduce((s, v) => s + v, 0) / clvs.length;
    const med = clvs.length % 2 ? clvs[(clvs.length - 1) / 2] : (clvs[clvs.length / 2 - 1] + clvs[clvs.length / 2]) / 2;
    console.log(`\n  CLOSING LINE  (advised price against Betfair SP)\n`);
    console.log(`    ${withBsp.length} of ${settled.length} bets have a BSP to compare`);
    console.log(`    beat the close on ${clvs.filter((c) => c > 1).length}, worse on ${clvs.filter((c) => c < -1).length}`);
    console.log(`    mean ${mean >= 0 ? "+" : ""}${mean.toFixed(1)}%   median ${med >= 0 ? "+" : ""}${med.toFixed(1)}%`);
  } else {
    console.log(`\n  No Betfair SP held for these bets yet — npm run backfill:bsp fills it in.`);
  }
  console.log("");
}

main().catch((e) => { console.error("\nvip stats failed:", e?.message ?? e); process.exit(1); });
