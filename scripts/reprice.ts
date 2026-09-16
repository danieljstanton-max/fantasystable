import "dotenv/config";
import postgres from "postgres";
import { parseBestBets, parseWriteUps } from "../lib/published";
import { fracToDec, betFor } from "../lib/staking";

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const date = process.argv[2];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });
  const bets = new Set(parseBestBets(date).map((p) => norm(p.horse)));
  const picks = parseWriteUps(date);
  const rows = await sql<any[]>`
    SELECT ru.horse_name, ru.best_odds_frac, ru.best_odds_dec, ru.best_odds_bookmaker,
           ru.is_non_runner, ra.off_time, ra.course_name
    FROM runners ru JOIN races ra ON ra.id = ru.race_id
    WHERE ra.race_date = ${date}`;
  const out: any[] = [];
  for (const p of picks) {
    const cands = rows.filter((r) => norm(r.horse_name) === norm(p.horse));
    const r = cands.find((c) => !c.is_non_runner) ?? cands[0];
    if (!r) continue;
    const was = fracToDec(p.priceFrac), now = r.best_odds_dec != null ? Number(r.best_odds_dec) : null;
    const move = was && now ? ((now - was) / was) * 100 : null;
    const stakeFlip = was && now && betFor(was).type !== betFor(now).type;
    out.push({ off: r.off_time, course: r.course_name, horse: p.horse, best: bets.has(norm(p.horse)),
               was: p.priceFrac ?? "—", now: r.best_odds_frac ?? "—", book: r.best_odds_bookmaker ?? "",
               move, nr: r.is_non_runner, stakeFlip });
  }
  out.sort((a, b) => String(a.off).localeCompare(String(b.off)));
  console.log(`  ${"OFF".padEnd(6)}${"COURSE".padEnd(14)}${"HORSE".padEnd(24)}${"ADVISED".padStart(8)}${"NOW".padStart(8)}  MOVE`);
  for (const o of out) {
    const mv = o.move == null ? "" : `${o.move > 0 ? "+" : ""}${o.move.toFixed(0)}%`;
    const flag = o.nr ? "  NON-RUNNER" : o.stakeFlip ? "  stake band changes" : Math.abs(o.move ?? 0) >= 25 ? "  big move" : "";
    console.log(`  ${String(o.off).padEnd(6)}${String(o.course).slice(0,13).padEnd(14)}${(o.best ? "★ " : "  ") + o.horse.slice(0,21).padEnd(22)}${o.was.padStart(8)}${o.now.padStart(8)}  ${mv.padEnd(5)}${flag}`);
  }
  const moved = out.filter((o) => o.move != null);
  const shorter = moved.filter((o) => o.move < 0).length, longer = moved.filter((o) => o.move > 0).length;
  console.log(`\n  ${out.length} selections · ${shorter} shortened · ${longer} drifted · ${moved.length - shorter - longer} unchanged · ★ = best bet`);
  await sql.end();
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
