import "dotenv/config";
import postgres from "postgres";
import { parseWriteUps } from "../lib/published";
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

async function main() {
  const date = process.argv[2], course = process.argv[3];
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });
  const picks = new Map(parseWriteUps(date).map((p) => [norm(p.horse), p]));
  const rs = await sql<any[]>`
    SELECT ra.id, ra.off_time, ra.name, ra.going FROM races ra JOIN courses c ON c.id = ra.course_id
    WHERE ra.race_date = ${date} AND c.name ILIKE ${course + "%"} ORDER BY ra.off_time`;
  for (const ra of rs) {
    const runners = await sql<any[]>`
      SELECT ru.horse_id, ru.horse_name, ru.best_odds_frac FROM runners ru
      WHERE ru.race_id = ${ra.id} AND NOT ru.is_non_runner ORDER BY ru.best_odds_dec NULLS LAST`;
    const lines: string[] = [];
    for (const r of runners) {
      const h = await sql<any[]>`
        SELECT count(*) FILTER (WHERE ru.position_num = 1)::int w,
               count(*) FILTER (WHERE ru.position_num <= 3)::int p, count(*)::int n
        FROM runners ru JOIN races ra2 ON ra2.id = ru.race_id
        WHERE ru.horse_id = ${r.horse_id} AND ra2.race_date < ${date}
          AND ra2.going ILIKE '%heavy%' AND ru.position_num IS NOT NULL`;
      const { w, p, n } = h[0];
      if (w > 0) lines.push(`      ${picks.has(norm(r.horse_name)) ? "OUR PICK  " : "          "}${String(r.horse_name).padEnd(22)} ${String(r.best_odds_frac ?? "-").padStart(6)}   ${w} win${w > 1 ? "s" : ""} from ${n} on heavy (${p} placed)`);
    }
    const mine = runners.find((r) => picks.has(norm(r.horse_name)));
    console.log(`\n  ${ra.off_time}  ${String(ra.name).slice(0, 46)}  [${ra.going}]`);
    console.log(`      our pick: ${mine ? mine.horse_name : "—"}`);
    console.log(lines.length ? lines.join("\n") : "          (nobody in this race has won on heavy)");
  }
  await sql.end();
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
