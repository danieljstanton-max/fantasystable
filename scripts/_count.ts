import "dotenv/config";
import postgres from "postgres";
async function main(){
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });
  const t = await sql`
    select 'courses' t, count(*)::int n from courses
    union all select 'races', count(*)::int from races
    union all select 'runners', count(*)::int from runners
    union all select 'horses', count(*)::int from horses
    union all select 'tips', count(*)::int from tips`;
  for (const r of t) console.log(`  ${String(r.t).padEnd(10)} ${Number(r.n).toLocaleString()}`);
  const d = await sql`select min(race_date) lo, max(race_date) hi from races`;
  console.log(`  span       ${d[0].lo} .. ${d[0].hi}`);
  const s = await sql`select status, count(*)::int n from races group by status order by n desc`;
  console.log(`  by status  ${s.map((x:any)=>`${x.status}=${x.n}`).join("  ")}`);
  await sql.end();
}
main().catch(e=>{console.error(e.message);process.exit(1)});
