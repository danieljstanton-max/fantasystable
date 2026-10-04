import postgres from "postgres";
import { readComment } from "../lib/form-reading";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });
  const [t] = await sql<any[]>`
    SELECT ru.horse_id, ru.horse_name, ru.number, ru.draw, ru.ofr, ru.best_odds_frac,
           ru.jockey_name, ru.trainer_name, ru.form, ru.last_run,
           ra.id race_id, ra.off_time, ra.name, ra.distance_f, ra.race_class,
           ra.going_band, ra.field_size, ra.race_type, c.name course
    FROM runners ru JOIN races ra ON ra.id=ru.race_id
    LEFT JOIN courses c ON c.id=ra.course_id
    WHERE ra.race_date='2026-10-05' AND upper(ru.horse_name) LIKE '%ALWAYS BLUE%'`;
  if (!t) { console.log("ALWAYS BLUE not found on 2026-10-05"); await sql.end(); return; }
  console.log(`${t.off_time} ${t.course} — ${t.name}`);
  console.log(`${t.distance_f}f · ${t.race_class} · ${t.race_type} · ${t.going_band} · ${t.field_size} runners\n`);
  console.log(`ALWAYS BLUE  No.${t.number} draw ${t.draw ?? "-"}  mark ${t.ofr}  ${t.best_odds_frac ?? "-"}`);
  console.log(`  ${t.trainer_name} / ${t.jockey_name}   form ${t.form}   ${t.last_run} days\n`);

  const styleOf = async (hid: string) => {
    const h = await sql<any[]>`
      SELECT ru.comment, ra.race_date FROM runners ru JOIN races ra ON ra.id=ru.race_id
      WHERE ru.horse_id=${hid} AND ra.race_date<'2026-10-05' AND ru.comment IS NOT NULL
      ORDER BY ra.race_date DESC LIMIT 8`;
    const st = h.map((x) => readComment(String(x.comment)).runStyle).filter(Boolean) as string[];
    const n: Record<string, number> = {};
    for (const s of st) n[s] = (n[s] ?? 0) + 1;
    const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
    return { counts: n, usual: top ? top[0] : null, reads: st.length, recent: st.slice(0, 4) };
  };

  const ab = await styleOf(t.horse_id);
  console.log(`  run style, last ${ab.reads} readable runs: ${JSON.stringify(ab.counts)}  → usually ${ab.usual}`);
  console.log(`  most recent first: ${ab.recent.join(", ")}\n`);

  console.log("WHO ELSE WANTS THE LEAD IN THIS RACE\n");
  const field = await sql<any[]>`
    SELECT ru.horse_id, ru.horse_name, ru.number, ru.draw, ru.ofr, ru.best_odds_frac
    FROM runners ru WHERE ru.race_id=${t.race_id} AND NOT ru.is_non_runner
    ORDER BY ru.best_odds_dec NULLS LAST`;
  for (const r of field) {
    const s = await styleOf(r.horse_id);
    const led = (s.counts["led"] ?? 0);
    const flag = s.usual === "led" ? "  << FRONT-RUNNER" : led >= 2 ? "  (has led)" : "";
    console.log(`  No.${String(r.number ?? "-").padStart(2)} draw ${String(r.draw ?? "-").padStart(2)} ` +
      `${String(r.horse_name).padEnd(20)} ${String(r.best_odds_frac ?? "-").padEnd(7)} mark ${String(r.ofr ?? "-").padStart(3)}  ` +
      `${(s.usual ?? "unread").padEnd(10)} (led ${led}/${s.reads})${flag}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
