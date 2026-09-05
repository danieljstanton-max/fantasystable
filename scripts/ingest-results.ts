/**
 * Settle yesterday's racing in our own database.
 *
 *   npm run ingest:results                   yesterday and today
 *   npm run ingest:results -- 2026-08-29     one day
 *   npm run ingest:results -- 2026-08-01 2026-08-29
 *
 * The racecard sweep captures a price for every runner the first time it sees
 * one. Nothing was writing the result back onto those same rows, so 495 opening
 * prices a day were being stored against races that stayed "upcoming" for ever,
 * and the finishing position and SP only ever existed inside a text file on the
 * Desktop.
 *
 * That gap is why the model cannot be evaluated properly. The one edge the live
 * record hints at is that our selections shorten into the off — and measuring
 * that needs the opening price and the returned SP on the same row. This job
 * puts them there.
 *
 * A racecard becomes a result in place, on the same row and the same URL. The
 * upsert sets result fields only: the slug, the opening price and everything
 * else captured before the off are left exactly as they were.
 */
import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

import * as schema from "../db/schema";
import { fetchResults } from "../lib/racing-api";
import { buildResultRows } from "../lib/result-rows";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function window(): { from: string; to: string } {
  const args = process.argv.slice(2).filter((a) => DATE.test(a));
  if (args.length >= 2) return { from: args[0], to: args[1] };
  if (args.length === 1) return { from: args[0], to: args[0] };

  // Yesterday and today by default. Evening cards settle after midnight, so
  // yesterday is swept again rather than assumed complete.
  const today = new Date();
  const yday = new Date(today.getTime() - 864e5);
  const d = (x: Date) => x.toISOString().slice(0, 10);
  return { from: d(yday), to: d(today) };
}

(async () => {
  const { from, to } = window();

  const client = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 4 });
  const db = drizzle(client, { schema });

  console.log(`\nIngesting results ${from} .. ${to}`);

  let races = 0;
  let runners = 0;
  let skipped = 0;
  let skip = 0;

  for (;;) {
    // `limit` caps at 100 — asking for more returns a 422 rather than clamping.
    const page: any = await fetchResults(from, to, 100, skip);
    const batch: any[] = page?.results ?? [];
    if (!batch.length) break;

    for (const raw of batch) {
      const rows = buildResultRows(raw);
      if (!rows) {
        skipped++;
        continue;
      }

      await db
        .insert(schema.races)
        .values(rows.race as any)
        .onConflictDoUpdate({
          target: schema.races.id,
          // Result fields only. Never the slug, never the course, never
          // anything a later racecard sweep could use to revert the day.
          set: {
            going: sql`excluded.going`,
            status: sql`excluded.status`,
            resultAt: sql`excluded.result_at`,
            winningTimeDetail: sql`excluded.winning_time_detail`,
            nonRunnersText: sql`excluded.non_runners`,
            comments: sql`excluded.comments`,
            raw: sql`excluded.raw`,
          },
        });

      if (rows.runners.length) {
        await db
          .insert(schema.runners)
          .values(rows.runners as any)
          .onConflictDoUpdate({
            target: [schema.runners.raceId, schema.runners.horseId],
            // The opening price, the best price and the shortest price seen are
            // deliberately absent: they are what the day looked like before the
            // off, and the whole point of settling in place is to be able to
            // compare them with what it returned.
            set: {
              position: sql`excluded.position`,
              positionNum: sql`excluded.position_num`,
              beatenBy: sql`excluded.beaten_by`,
              ovrBtn: sql`excluded.ovr_btn`,
              sp: sql`excluded.sp`,
              spDec: sql`excluded.sp_dec`,
              bsp: sql`excluded.bsp`,
              ofr: sql`excluded.ofr`,
              effectiveMark: sql`excluded.effective_mark`,
              rpr: sql`excluded.rpr`,
              ts: sql`excluded.ts`,
              weight: sql`excluded.weight`,
              weightLbs: sql`excluded.weight_lbs`,
              jockeyClaimLbs: sql`excluded.jockey_claim_lbs`,
              comment: sql`excluded.comment`,
              prize: sql`excluded.prize`,
              raw: sql`excluded.raw`,
            },
          });
      }

      races++;
      runners += rows.runners.length;
    }

    if (batch.length < 100) break;
    skip += 100;
  }

  // What the job is actually for: rows that now carry both a price taken before
  // the off and the price the race returned at.
  const [paired] = (await db.execute(sql`
    select count(*)::int as n
    from runners r join races ra on ra.id = r.race_id
    where ra.race_date between ${from} and ${to}
      and r.opening_odds_dec is not null and r.sp_dec is not null`)) as any;

  console.log(`  ${races} races settled, ${runners} runners`);
  if (skipped) console.log(`  ${skipped} skipped — no usable off time`);
  console.log(`  ${paired?.n ?? 0} runners now carry both an opening price and an SP\n`);

  await client.end();
})();
