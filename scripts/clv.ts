/**
 * Closing line value — did the market come to us?
 *
 *   npm run clv -- 2026-08-27 2026-08-29
 *
 * The backtest says the model has no edge at starting price. The live record
 * says something different: selections shorten into the off. Both can be true,
 * and which one is right decides what this product actually is.
 *
 * Beating the closing line is the one measure that predicts long-term profit
 * from a betting model, because the closing price is the most accurate
 * forecast anyone produces. A tipster whose horses are consistently shorter at
 * the off than when advised is finding something before the market does. One
 * whose horses drift is being beaten to it, and every winner is luck.
 *
 * The comparison here is against the rest of the field on the same day, not
 * against nothing — on a day when every price shortens, shortening is not an
 * achievement.
 */
import "dotenv/config";
import postgres from "postgres";
import { parseBestBets, parseWriteUps } from "../lib/published";
import { stripHorseCountry } from "../lib/mappers";

const norm = (s: string) => stripHorseCountry(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Overround-free move, in percent. Negative means it shortened. */
const movePct = (open: number, sp: number) => ((sp - open) / open) * 100;

function days(): string[] {
  const args = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  if (args.length < 2) return args;
  const out: string[] = [];
  for (let d = new Date(args[0]); d <= new Date(args[1]); d = new Date(d.getTime() + 864e5)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

(async () => {
  const dates = days();
  if (!dates.length) {
    console.error("usage: npm run clv -- YYYY-MM-DD [YYYY-MM-DD]");
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 2 });

  type Row = { horse: string; open: number; sp: number; won: boolean; date: string };
  const ours: Row[] = [];
  const field: Row[] = [];
  let noPick = 0;

  for (const date of dates) {
    const picks = new Set(
      [...parseBestBets(date), ...parseWriteUps(date)].map((p) => norm(p.horse))
    );
    if (!picks.size) noPick++;

    const rows: any[] = await sql`
      select r.horse_name "horse", r.opening_odds_dec "open", r.sp_dec "sp",
             r.position_num "pos"
      from runners r join races ra on ra.id = r.race_id
      where ra.race_date = ${date}
        and ra.status = 'result'
        and r.opening_odds_dec is not null
        and r.sp_dec is not null
        and coalesce(r.is_non_runner, false) = false`;

    for (const r of rows) {
      const row: Row = {
        horse: r.horse, open: Number(r.open), sp: Number(r.sp),
        won: r.pos === 1, date,
      };
      (picks.has(norm(r.horse)) ? ours : field).push(row);
    }
  }

  await sql.end();

  if (!ours.length) {
    console.error("\nNo published selections matched a settled runner with an opening price.");
    console.error("Run `npm run ingest:results` for these dates first.\n");
    process.exit(1);
  }

  const summarise = (rows: Row[], label: string) => {
    const moves = rows.map((r) => movePct(r.open, r.sp));
    const mean = moves.reduce((a, b) => a + b, 0) / moves.length;
    const sorted = [...moves].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const shortened = moves.filter((m) => m < -1).length;
    const drifted = moves.filter((m) => m > 1).length;

    console.log(`  ${label.padEnd(22)} ${String(rows.length).padStart(5)} runners`);
    console.log(`    mean move        ${mean >= 0 ? "+" : ""}${mean.toFixed(1)}%`);
    console.log(`    median move      ${median >= 0 ? "+" : ""}${median.toFixed(1)}%`);
    console.log(`    shortened        ${((shortened / rows.length) * 100).toFixed(1)}%`);
    console.log(`    drifted          ${((drifted / rows.length) * 100).toFixed(1)}%`);
    console.log(`    strike rate      ${((rows.filter((r) => r.won).length / rows.length) * 100).toFixed(1)}%`);
    return mean;
  };

  console.log(`\nCLOSING LINE VALUE  ${dates[0]} .. ${dates[dates.length - 1]}`);
  console.log("=".repeat(70));
  console.log("  Move is opening price to SP. Negative is a horse that shortened.\n");

  const oursMean = summarise(ours, "OUR SELECTIONS");
  console.log("");
  const fieldMean = summarise(field, "everything else");

  const gap = oursMean - fieldMean;
  console.log("\n" + "-".repeat(70));
  console.log(`  Our selections moved ${Math.abs(gap).toFixed(1)}% ${gap < 0 ? "SHORTER" : "LONGER"} than the rest of the field.`);

  if (gap < -3) {
    console.log("\n  The market comes to these horses. That is the edge worth building on:");
    console.log("  the price advised is better than the price returned, so the product is");
    console.log("  the early call, not the prediction.");
  } else if (gap > 3) {
    console.log("\n  These horses drift relative to the field. The market is not following");
    console.log("  us, and every winner at a bigger SP than advised is luck rather than");
    console.log("  an edge. Treat any positive ROI here with suspicion.");
  } else {
    console.log("\n  No meaningful difference from the field. On this sample the selections");
    console.log("  are not being backed any harder than the horses we passed over.");
  }

  // Like for like on price.
  //
  // Our selections are shorter than the field on average, and short-priced
  // horses shorten more often than 50/1 shots drift — so the headline gap
  // above flatters us by comparing a book of second favourites against a book
  // that includes every no-hoper on the card. The only comparison that means
  // anything is within a price band.
  const BANDS: Array<[string, number, number]> = [
    ["odds-on", 0, 2],
    ["evens - 3/1", 2, 4],
    ["7/2 - 6/1", 4, 7],
    ["13/2 - 12/1", 7, 13],
    ["14/1 - 25/1", 13, 26],
    ["over 25/1", 26, Infinity],
  ];

  console.log("\n" + "-".repeat(70));
  console.log("  LIKE FOR LIKE — median move within the same opening price band\n");
  console.log("  band              ours          field         gap     n(ours)");
  console.log("  " + "-".repeat(60));

  const med = (xs: number[]) =>
    xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN;

  let bandsFor = 0;
  let bandsAgainst = 0;

  for (const [label, lo, hi] of BANDS) {
    const inBand = (r: Row) => r.open >= lo && r.open < hi;
    const o = ours.filter(inBand).map((r) => movePct(r.open, r.sp));
    const f = field.filter(inBand).map((r) => movePct(r.open, r.sp));
    if (o.length < 5 || f.length < 20) continue;

    const mo = med(o);
    const mf = med(f);
    const gap = mo - mf;
    if (gap < 0) bandsFor++;
    else bandsAgainst++;

    console.log(
      `  ${label.padEnd(16)} ${(mo >= 0 ? "+" : "") + mo.toFixed(1) + "%"}`.padEnd(36) +
      `${(mf >= 0 ? "+" : "") + mf.toFixed(1) + "%"}`.padEnd(15) +
      `${(gap >= 0 ? "+" : "") + gap.toFixed(1)}`.padEnd(12) +
      String(o.length)
    );
  }

  console.log("");
  if (bandsFor && !bandsAgainst) {
    console.log("  Our horses shorten more than the field in every band with enough data.");
    console.log("  That survives the obvious objection, and is worth taking seriously.");
  } else if (bandsFor > bandsAgainst) {
    console.log(`  Ours shorten more in ${bandsFor} of ${bandsFor + bandsAgainst} bands. Suggestive, not settled.`);
  } else {
    console.log("  Once price is controlled for, the advantage largely disappears — the");
    console.log("  headline gap was mostly a reflection of backing shorter horses.");
  }

  console.log(`\n  Sample is ${ours.length} selections across ${dates.length - noPick} published days.`);
  console.log("  Under a few hundred, treat the number as a direction, not a result.\n");
})();
