/**
 * Push live prices to the site, and nothing else.
 *
 *   npm run publish:odds            # today
 *   npm run publish:odds -- 2026-08-31
 *
 * Dan, 2026-08-31: "we need to show 2 prices, price advised and current odds."
 *
 * The advised price is frozen onto the tip when it is published. The current
 * one has to be refreshed all day, and the full day push rewrites fifty-one
 * race pages — far too heavy for a ten-minute loop, and it would also rewrite
 * the tips themselves. This sends prices to /day/{date}/odds, which merges
 * them into the runners already stored and touches nothing else.
 *
 * Only races that have not gone off yet are sent. A price on a race that has
 * already run is not a price anyone can take, and pushing it would keep
 * bouncing the page cache for no reason.
 */

import "dotenv/config";
import postgres from "postgres";
import { withRetry } from "../lib/retry";

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require" });

function todayInLondon(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

async function main() {
  const arg = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const date = arg ?? todayInLondon();

  const site = process.env.HRT_URL;
  const token = process.env.HRT_TOKEN;
  if (!site || !token) {
    console.error("HRT_URL and HRT_TOKEN must be set in .env.local");
    process.exit(1);
  }

  const rows = (await sql`
    select ra.id "raceId", ra.off_dt "offDt", ra.course_name "course", ra.off_time "time",
           r.horse_name "horse", r.best_odds_frac "price", r.best_odds_bookmaker "book",
           r.is_non_runner "nr"
    from races ra join runners r on r.race_id = ra.id
    where ra.race_date = ${date}
      and ra.off_dt > now()
      and ra.status is distinct from 'result'
    order by ra.off_dt, r.number nulls last`) as any[];

  if (!rows.length) {
    console.log(`  ${date}: nothing left to price — every race has gone off`);
    await sql.end();
    return;
  }

  const byRace = new Map<string, any>();
  for (const r of rows) {
    let e = byRace.get(r.raceId);
    if (!e) {
      e = { id: String(r.raceId), course: r.course, time: r.time, runners: [] as any[] };
      byRace.set(r.raceId, e);
    }
    e.runners.push({ horse: r.horse, price: r.price ?? "", book: r.book ?? "", nr: !!r.nr });
  }

  const races = [...byRace.values()];
  const priced = rows.filter((r) => r.price).length;
  console.log(`  ${date}: ${races.length} races still to run, ${priced}/${rows.length} runners priced`);

  const res = await withRetry(`push odds ${date}`, () =>
    fetch(`${site.replace(/\/$/, "")}/wp-json/hrt/v1/day/${date}/odds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-HRT-Token": token },
      body: JSON.stringify({ date, races }),
    })
  );

  const text = await res.text();
  if (!res.ok) {
    console.error(`  push failed (${res.status}): ${text.slice(0, 300)}`);
    process.exit(1);
  }

  try {
    const j = JSON.parse(text);
    console.log(`  updated ${j.updated} of ${j.races} race pages` + (j.missed ? `, ${j.missed} not matched` : ""));
  } catch {
    console.log(`  ${text.slice(0, 200)}`);
  }
  await sql.end();
}

main().then(() => process.exit(0));
