/**
 * What did a reader with Best Odds Guaranteed actually get?
 *
 * We record to the advised price. Nearly every UK bookmaker runs BOG on
 * UK/Irish racing, which pays the SP when the SP is bigger — so the real
 * return to a reader is max(advised, SP), never the worse of the two.
 * This prices all three so the difference is a number, not an argument.
 */
import "dotenv/config";
import postgres from "postgres";
import { parseBestBets, type Pick } from "../lib/published";
import { betFor, settleBet, fracToDec } from "../lib/staking";
import { isHandicap } from "../lib/selection";

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });
  const dates = process.argv.slice(2);
  let oOut = 0, oRet = 0, sRet = 0, bRet = 0, n = 0, drifters = 0, shorteners = 0;

  for (const date of dates) {
    let picks: Pick[] = [];
    try { picks = parseBestBets(date); } catch { continue; }
    if (!picks.length) continue;

    const rows = await sql<any[]>`
      SELECT ru.horse_name, ru.position, ru.sp_dec, ra.field_size, ra.name
      FROM runners ru JOIN races ra ON ra.id = ru.race_id
      WHERE ra.race_date = ${date} AND ra.status = 'result'`;
    const byName = new Map(rows.map((r) => [norm(r.horse_name), r]));

    for (const p of picks) {
      const r = byName.get(norm(p.horse));
      if (!r) continue;
      const ourDec = fracToDec(p.priceFrac);
      const spDec = r.sp_dec != null ? Number(r.sp_dec) : null;
      if (!ourDec) continue;
      const pos = /^\d+$/.test(String(r.position)) ? parseInt(String(r.position), 10) : null;
      const hcap = isHandicap(String(r.name ?? ""));
      const bet = betFor(ourDec);                       // stake fixed by advised price
      const bogDec = spDec && spDec > ourDec ? spDec : ourDec;
      if (spDec && spDec > ourDec) drifters++;
      if (spDec && spDec < ourDec) shorteners++;
      const a = settleBet(bet, ourDec, pos, r.field_size, hcap);
      const s = settleBet(bet, spDec, pos, r.field_size, hcap);
      const b = settleBet(bet, bogDec, pos, r.field_size, hcap);
      oOut += a.outlay; oRet += a.returned; sRet += s.returned; bRet += b.returned; n++;
    }
  }
  const pl = (ret: number) => ret - oOut;
  const roi = (ret: number) => oOut ? ((ret - oOut) / oOut) * 100 : 0;
  console.log(`\n  ${n} settled bets, ${oOut.toFixed(2)}pts staked`);
  console.log(`    at advised price   ${pl(oRet) >= 0 ? "+" : ""}${pl(oRet).toFixed(2)}pts   ROI ${roi(oRet).toFixed(1)}%`);
  console.log(`    at SP              ${pl(sRet) >= 0 ? "+" : ""}${pl(sRet).toFixed(2)}pts   ROI ${roi(sRet).toFixed(1)}%`);
  console.log(`    with BOG           ${pl(bRet) >= 0 ? "+" : ""}${pl(bRet).toFixed(2)}pts   ROI ${roi(bRet).toFixed(1)}%`);
  console.log(`\n  drifted (SP bigger): ${drifters}   shortened: ${shorteners}`);
  await sql.end();
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
