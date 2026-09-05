/**
 * Pull one horse's full career on demand.
 *
 *   npm run fetch:horse -- "Huckleberry Sting"
 *
 * For looking at a horse that is not on an upcoming card, so has never been
 * picked up by the scoped backfill.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "../db/schema";
import { apiGet, endpoints } from "../lib/racing-api";
import { mapResultRace, mapResultRunner, offTime24, raceDateFromOffDt, stripCourseSuffix } from "../lib/mappers";
import { slugify, raceSlug } from "../lib/slug";
import { normaliseGoing } from "../lib/going";

const client = postgres(process.env.DATABASE_URL!, { max: 4, ssl: "require" });
const db = drizzle(client, { schema });

async function main() {
  const q = process.argv.slice(2).join(" ").trim();
  const m: any[] = await db.execute(sql`
    select distinct horse_id, horse_name from runners
    where lower(horse_name) like ${"%" + q.toLowerCase() + "%"} limit 1`);
  if (!m.length) { console.log(`  no horse matching "${q}"`); await client.end(); return; }

  const { horse_id: id, horse_name: name } = m[0];
  const hr: any = await apiGet(endpoints.horseResults(id));
  const rs = hr.results ?? [];
  console.log(`\n  ${name}: ${rs.length} career runs returned`);

  let stored = 0;
  for (const raw of rs) {
    const offDt = raw.off_dt ? new Date(raw.off_dt) : null;
    if (!offDt || Number.isNaN(offDt.getTime())) continue;
    const result = mapResultRace(raw);
    const courseName = stripCourseSuffix(raw.course ?? "Unknown");
    const offTime = offTime24(offDt);
    await db.insert(schema.races).values({
      id: result.id, courseId: null, courseName, courseSlug: slugify(courseName),
      raceDate: raceDateFromOffDt(offDt), offTime, offDt,
      name: raw.race_name ?? "Race", slug: raceSlug(offTime, raw.race_name ?? "Race"),
      distance: raw.dist ?? null, distanceF: raw.dist_f ? parseFloat(String(raw.dist_f)) : null,
      going: raw.going ?? null, goingBand: normaliseGoing(raw.going),
      surface: /aw|polytrack|tapeta|fibresand/i.test(raw.surface ?? "") ? "aw" : "turf",
      raceType: raw.type ?? null, raceClass: raw.class ?? null, pattern: raw.pattern ?? null,
      ageBand: raw.age_band ?? null, ratingBand: raw.rating_band ?? null,
      sexRestriction: raw.sex_rest ?? null, region: raw.region ?? null,
      fieldSize: (raw.runners ?? []).length, status: "result", resultAt: new Date(),
      winningTimeDetail: raw.winning_time_detail ?? null, comments: raw.comments ?? null, raw,
    }).onConflictDoUpdate({ target: schema.races.id, set: { raw: sql`excluded.raw`, raceType: sql`excluded.race_type` } });

    const rows = (raw.runners ?? []).map((h: any) => mapResultRunner(result.id, h));
    if (rows.length) {
      await db.insert(schema.runners).values(rows).onConflictDoUpdate({
        target: [schema.runners.raceId, schema.runners.horseId],
        set: { position: sql`excluded.position`, positionNum: sql`excluded.position_num`,
               ofr: sql`excluded.ofr`, sp: sql`excluded.sp`, comment: sql`excluded.comment` },
      });
    }
    stored++;
  }
  console.log(`  ${stored} races stored\n`);
  await client.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
