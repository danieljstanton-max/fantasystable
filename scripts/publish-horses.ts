/**
 * Push form profiles for the horses actually declared.
 *
 *   npm run publish:horses              # today and tomorrow
 *   npm run publish:horses -- 2026-08-31
 *
 * Dan, 2026-08-31: "when you click on a horse that's running you can look at
 * the back form of its last races."
 *
 * Only declared runners get a page. We hold 1.68m runs across 169,000 races,
 * and building a profile for every horse that ever ran would be a quarter of a
 * million pages nobody links to — thin content at scale, which is a good way
 * to be treated as a content farm. A horse gets a page when it is declared,
 * and keeps it afterwards.
 *
 * NO LOOKAHEAD, for the same reason the backtest enforces it: the form shown
 * is strictly runs BEFORE the race being previewed, so a profile read on the
 * morning of a race never contains the race itself.
 */

import "dotenv/config";
import postgres from "postgres";
import { withRetry } from "../lib/retry";

const sql = postgres(process.env.DATABASE_URL!, { ssl: "require" });

/** How many past runs to carry. Enough to read a career, short of a wall. */
const RUNS = 20;

function londonToday(offset = 0): string {
  const d = new Date(Date.now() + offset * 864e5);
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

async function main() {
  const arg = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const dates = arg ? [arg] : [londonToday(), londonToday(1)];

  const site = process.env.HRT_URL;
  const token = process.env.HRT_TOKEN;
  if (!site || !token) {
    console.error("HRT_URL and HRT_TOKEN must be set in .env.local");
    process.exit(1);
  }

  const declared = (await sql`
    select distinct on (r.horse_id)
           r.horse_id "id", r.horse_name "name", h.slug, h.sex, r.age,
           h.sire, h.dam, r.trainer_name "trainer"
    from runners r
    join races ra on ra.id = r.race_id
    left join horses h on h.id = r.horse_id
    where ra.race_date = any(${dates})
    order by r.horse_id, ra.race_date desc`) as any[];

  console.log(`  ${dates.join(", ")}: ${declared.length} declared horses`);
  if (!declared.length) { await sql.end(); return; }

  const ids = declared.map((d) => d.id);

  // Every completed run we hold for those horses, newest first.
  const form = (await sql`
    select r.horse_id "id", ra.race_date "date", ra.course_name "course",
           ra.going, ra.distance_round "dist", ra.race_class "class",
           ra.field_size "ran", ra.slug "raceSlug",
           r.position, r.sp, r.ofr "or", r.comment
    from runners r join races ra on ra.id = r.race_id
    where r.horse_id = any(${ids})
      and r.position is not null
      and ra.race_date < ${dates[0]}
    order by r.horse_id, ra.race_date desc`) as any[];

  const byHorse = new Map<string, any[]>();
  for (const f of form) {
    const list = byHorse.get(f.id) ?? [];
    if (list.length >= RUNS) continue;
    list.push({
      date: String(f.date).slice(0, 10),
      course: f.course, going: f.going, dist: f.dist, class: f.class,
      ran: f.ran, pos: f.position, sp: f.sp, or: f.or,
      comment: f.comment,
      url: f.raceSlug ? `${site.replace(/\/$/, "")}/racecard/${f.raceSlug}/` : "",
    });
    byHorse.set(f.id, list);
  }

  const horses = declared.map((d) => ({
    id: d.id,
    name: d.name,
    slug: d.slug ?? String(d.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    sex: d.sex ?? "",
    age: d.age ?? "",
    sire: d.sire ?? "",
    dam: d.dam ?? "",
    trainer: d.trainer ?? "",
    form: byHorse.get(d.id) ?? [],
  }));

  const withForm = horses.filter((h) => h.form.length).length;
  console.log(`  ${withForm} of ${horses.length} have form we hold`);

  // In batches: 500 profiles in one request is a large body and a long-running
  // PHP request, and a timeout halfway would leave no way to tell what landed.
  const SIZE = 100;
  let created = 0, updated = 0, skipped = 0;

  for (let i = 0; i < horses.length; i += SIZE) {
    const batch = horses.slice(i, i + SIZE);
    // The results and odds pushes were given retries after ECONNRESET killed
    // them mid-run; this one was missed, and it is the longest-running of the
    // three — four batches of a hundred profiles, so four chances for a
    // dropped connection to lose the lot.
    const res = await withRetry(`push horses batch ${i / SIZE + 1}`, () =>
      fetch(`${site.replace(/\/$/, "")}/wp-json/hrt/v1/horses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-HRT-Token": token },
        body: JSON.stringify({ horses: batch }),
      })
    );
    const text = await res.text();
    if (!res.ok) {
      console.error(`  batch ${i / SIZE + 1} failed (${res.status}): ${text.slice(0, 200)}`);
      process.exit(1);
    }
    try {
      const j = JSON.parse(text);
      created += j.created ?? 0; updated += j.updated ?? 0; skipped += j.skipped ?? 0;
    } catch { /* a body we cannot read is reported by the totals being short */ }
    process.stdout.write(`\r  pushed ${Math.min(i + SIZE, horses.length)}/${horses.length}`);
  }

  console.log(`\n  created ${created}, updated ${updated}` + (skipped ? `, skipped ${skipped}` : ""));
  await sql.end();
}

main().then(() => process.exit(0));
