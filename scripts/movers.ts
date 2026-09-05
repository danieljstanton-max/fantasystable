/**
 * Market movers — the best-backed horses of the day.
 *
 *   npm run movers
 *   npm run movers -- today
 *   npm run movers -- 2026-08-27
 *
 * The Racing API carries no price history: every `history` array in the odds
 * feed comes back empty. So the only way to know what a horse opened at is to
 * have recorded it ourselves. The racecard ingest writes `opening_odds_dec` on
 * the first sweep of the day and never overwrites it; every later sweep updates
 * the current best price. The difference between the two is money.
 *
 * A steamer is a horse whose price has shortened materially since it opened —
 * somebody is backing it. Historically that is exactly the signal that
 * replicated in the flag lab: a horse the market fancied but which did not win
 * is worth following next time, and one being backed right now is worth
 * knowing about today.
 *
 * REQUIRES the ingest to have run more than once today. On the first sweep the
 * opening price and the current price are the same and nothing will move.
 */

import "dotenv/config";
import postgres from "postgres";
import { formatPrice } from "../lib/tips";

const client = postgres(process.env.DATABASE_URL!, { max: 2, ssl: "require" });

/** How much a price must shorten before it counts as a move. */
const STEAM_THRESHOLD = 0.12; // 12%

function targetDate(): string {
  const a = process.argv[2];
  if (a && /^\d{4}-\d{2}-\d{2}$/.test(a)) return a;
  const d = new Date();
  if (a !== "tomorrow") return d.toISOString().slice(0, 10);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const date = targetDate();
  console.log(`\nMARKET MOVERS — ${date}\n${"=".repeat(72)}`);

  const rows: any[] = await client`
    select r.horse_name, r.opening_odds_dec o, r.best_odds_dec c,
           r.shortest_odds_dec s, r.opening_odds_at,
           r.trainer_name, r.jockey_name, r.ofr,
           ra.course_name, ra.off_time, ra.name race_name, ra.field_size
    from runners r join races ra on ra.id = r.race_id
    where ra.race_date = ${date}
      and r.is_non_runner = false
      and r.opening_odds_dec is not null
      and r.best_odds_dec is not null
    order by ra.off_time`;

  if (!rows.length) {
    console.log(`  no priced runners stored for ${date}.`);
    console.log(`  run: npm run ingest:racecards -- ${date}\n`);
    await client.end();
    return;
  }

  const moved = rows.filter((r) => Number(r.o) !== Number(r.c));
  console.log(`\n  ${rows.length.toLocaleString()} priced runners, ${moved.length.toLocaleString()} have moved since opening`);

  if (!moved.length) {
    const first = rows[0]?.opening_odds_at;
    console.log(`\n  Nothing has moved yet — prices were first recorded ${first ?? "just now"}.`);
    console.log(`  Movers need at least two ingest sweeps. Run the ingest again in ten minutes.\n`);
    await client.end();
    return;
  }

  // move < 0 means the price shortened, i.e. it has been backed.
  const withMove = rows.map((r) => ({
    ...r,
    move: (Number(r.c) - Number(r.o)) / Number(r.o),
  }));

  const steamers = withMove
    .filter((r) => r.move <= -STEAM_THRESHOLD)
    .sort((a, b) => a.move - b.move);
  const drifters = withMove
    .filter((r) => r.move >= STEAM_THRESHOLD)
    .sort((a, b) => b.move - a.move);

  const line = (r: any) => {
    const pctMove = `${r.move > 0 ? "+" : ""}${(r.move * 100).toFixed(0)}%`;
    return (
      `  ${String(r.horse_name).slice(0, 20).padEnd(21)}` +
      `${String(r.off_time).padEnd(7)}${String(r.course_name).slice(0, 13).padEnd(14)}` +
      `${(formatPrice(Number(r.o)) ?? "-").padStart(7)} -> ${(formatPrice(Number(r.c)) ?? "-").padEnd(7)}` +
      `${pctMove.padStart(7)}   ${String(r.trainer_name ?? "").slice(0, 20)}`
    );
  };

  console.log(`\n${"-".repeat(72)}`);
  console.log(`BACKED — shortened ${Math.round(STEAM_THRESHOLD * 100)}%+ since opening\n`);
  if (!steamers.length) console.log(`  none yet`);
  for (const r of steamers.slice(0, 20)) console.log(line(r));

  console.log(`\n${"-".repeat(72)}`);
  console.log(`DRIFTING — eased ${Math.round(STEAM_THRESHOLD * 100)}%+ since opening\n`);
  if (!drifters.length) console.log(`  none yet`);
  for (const r of drifters.slice(0, 10)) console.log(line(r));

  console.log(`\n${"-".repeat(72)}`);
  console.log(`BEST BACKED OF THE DAY\n`);
  const top = steamers.slice(0, 5);
  if (!top.length) console.log(`  nothing has been backed hard enough to call yet`);
  top.forEach((r, i) => {
    console.log(
      `  ${i + 1}. ${String(r.horse_name).toUpperCase()}  ` +
        `${formatPrice(Number(r.o))} into ${formatPrice(Number(r.c))}  (${(r.move * 100).toFixed(0)}%)`
    );
    console.log(`     ${r.off_time} ${r.course_name}  ${String(r.race_name).slice(0, 44)}`);
    console.log(`     ${r.trainer_name ?? "?"} / ${r.jockey_name ?? "?"}   OR ${r.ofr ?? "-"}   ${r.field_size ?? "?"} runners`);
  });

  console.log(`\n${"=".repeat(72)}\n`);
  await client.end();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
