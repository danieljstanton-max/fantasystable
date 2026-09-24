import "dotenv/config";
import postgres from "postgres";
import { parseBestBets } from "../lib/published";
import { fracToDec, betFor, settleBet } from "../lib/staking";
import { isHandicap } from "../lib/selection";
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });
  let won = 0, placed = 0, lost = 0, pending = 0, out = 0, staked = 0, ret = 0;
  const winners: string[] = [];
  console.log(`  DATE        NAP                     ADVISED   RESULT`);
  for (let d = 1; d <= 25; d++) {
    const date = `2026-09-${String(d).padStart(2, "0")}`;
    let picks: any[] = [];
    try { picks = parseBestBets(date); } catch { continue; }
    if (!picks.length) continue;
    const nap = picks[0];
    const r = (await sql<any[]>`
      SELECT ru.position, ru.is_non_runner nr, ra.field_size, ra.name, ra.status
      FROM runners ru JOIN races ra ON ra.id = ru.race_id
      WHERE ra.race_date = ${date} AND ru.horse_name ILIKE ${nap.horse}`)[0];
    const dec = fracToDec(nap.priceFrac);
    let res = "no result";
    if (!r) res = "not found";
    else if (r.nr) { res = "NON-RUNNER"; out++; }
    else if (r.status !== "result") { res = "still to run"; pending++; }
    else {
      const pos = /^\d+$/.test(String(r.position)) ? parseInt(String(r.position), 10) : null;
      const bet = betFor(dec);
      const s = settleBet(bet, dec, pos, r.field_size, isHandicap(String(r.name ?? "")));
      staked += s.outlay; ret += s.returned;
      if (pos === 1) { won++; res = `WON  ${s.profit >= 0 ? "+" : ""}${s.profit.toFixed(2)}pts`; winners.push(`${nap.horse} ${nap.priceFrac}`); }
      else if (s.returned > 0) { placed++; res = `placed  ${s.profit >= 0 ? "+" : ""}${s.profit.toFixed(2)}pts`; }
      else { lost++; res = `lost (${r.position})`; }
    }
    console.log(`  ${date}  ${String(nap.horse).padEnd(22)} ${String(nap.priceFrac ?? "-").padStart(6)}   ${res}`);
  }
  console.log(`\n  ${won} won, ${placed} placed, ${lost} lost, ${out} non-runners, ${pending} to run`);
  console.log(`  staked ${staked.toFixed(2)}pts, returned ${ret.toFixed(2)}pts — ${(ret - staked >= 0 ? "+" : "")}${(ret - staked).toFixed(2)}pts, ROI ${staked ? ((ret - staked) / staked * 100).toFixed(1) : "0"}%`);
  console.log(`  winners: ${winners.join(", ")}`);
  await sql.end();
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
