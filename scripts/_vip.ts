import postgres from "postgres";
const WANT = [
  ["2026-10-01", "Regional Rock"], ["2026-10-01", "Jujubella"],
  ["2026-10-02", "Captain Parma"], ["2026-10-02", "Cockade"],
  ["2026-10-03", "Great Acclaim"],
];
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });
  for (const [date, horse] of WANT) {
    const r = await sql<any[]>`
      SELECT ra.off_time, c.name course, ra.field_size, ra.name race,
             ru.horse_name, ru.position, ru.sp, ru.ew_places, ru.ew_denom
      FROM runners ru JOIN races ra ON ra.id = ru.race_id
      LEFT JOIN courses c ON c.id = ra.course_id
      WHERE ra.race_date = ${date} AND upper(ru.horse_name) LIKE ${"%" + horse.toUpperCase() + "%"}`;
    for (const x of r) {
      const terms = x.ew_places && x.ew_denom ? `${x.ew_places} places at 1/${x.ew_denom}` : "no e/w terms held";
      console.log(`${date}  ${x.off_time}  ${String(x.course).padEnd(16)} ${String(x.horse_name).padEnd(15)} ` +
        `pos ${String(x.position ?? "-").padEnd(4)} field ${String(x.field_size).padStart(2)}  ${terms}`);
    }
  }
  await sql.end();
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
