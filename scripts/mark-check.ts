/**
 * Every selection's handicap mark, against the mark it last won off.
 *
 *   npm run check:marks -- 2026-10-05
 *
 * Dan, 2026-10-04, on WYLE COP: "he won last 2/3 races and has gone up 12lb in
 * the handicap now running over 6 furlongs in a higher class race?"
 *
 * He was right on every figure, and nothing in the pipeline had anything to say
 * about it. The write-up read "only just denied off a similar mark, beaten 2L
 * off 78 on 26 March" — true, and it never mentioned that the horse dropped to
 * 67, won twice in Class 5 over 5f off 67 and 72, and had been put up 12lb. A
 * reader could not judge the pick from what was printed.
 *
 * This is the ground-rule lesson applied to the handicapper. The house rule is
 * that every selection prints its ground record, flattering or not, because a
 * signal with weight zero is never printed and that is how a 0-from-4-on-soft
 * NAP reached the site. A mark that has gone up fails exactly the same way: it
 * is not evidence FOR the horse, so nothing ever had a reason to mention it.
 *
 * It reports rather than blocks. Dan's method is well-handicapped horses, but
 * "up on the last winning mark" is not automatically wrong — a horse returned
 * to a mark it has already won off at today's trip and class is a different
 * case from one chasing a new high. The two are told apart below, and the call
 * stays his.
 */
import "dotenv/config";
import postgres from "postgres";
import { parseBestBets, parseWriteUps } from "../lib/published";
import { sameDiscipline } from "../lib/selection";
import { readMark } from "../lib/marks";

/** Above this, a rise is worth a human looking at it. */
const RISE_FLAG_LBS = 6;

type Row = {
  /** effective - published, when the weights disagree with the rating field. */
  drift: number | null;
  published: number | null;
  rank: number | null;
  horse: string;
  course: string;
  off: string;
  mark: number | null;
  distanceF: number | null;
  raceClass: string | null;
  raceType: string | null;
  lastWin: {
    date: string;
    mark: number | null;
    distanceF: number | null;
    raceClass: string | null;
  } | null;
  /** Has it ever won off today's mark or higher, in this code? */
  wonOffThisMark: { date: string; mark: number; distanceF: number | null; raceClass: string | null } | null;
  rise: number | null;
  note: string[];
};

const clsNum = (c: string | null) => {
  const m = String(c ?? "").match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
};

async function main() {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run check:marks -- YYYY-MM-DD");
    process.exit(1);
  }

  const picks = [...parseBestBets(date), ...parseWriteUps(date)];
  if (!picks.length) {
    console.error(`No published files for ${date} — nothing to check.`);
    process.exit(1);
  }

  // One row per horse: the best-bets list and the write-ups name the same
  // horses, and a selection should not be reported twice.
  const seen = new Set<string>();
  const wanted = picks.filter((p) => {
    const k = `${p.horse.toUpperCase()}|${p.offTime ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });
  const rows: Row[] = [];

  for (const p of wanted) {
    const [today] = await sql<any[]>`
      SELECT ru.horse_id, ru.horse_name, ru.ofr, ru.weight_lbs, ru.jockey_claim_lbs,
             ra.id race_id, ra.distance_f, ra.race_class,
             ra.race_type, ra.off_time, c.name course
      FROM runners ru JOIN races ra ON ra.id = ru.race_id
      LEFT JOIN courses c ON c.id = ra.course_id
      WHERE ra.race_date = ${date}
        AND upper(ru.horse_name) = ${p.horse.toUpperCase()}
        ${p.offTime ? sql`AND ra.off_time = ${p.offTime}` : sql``}`;
    if (!today) continue;

    // The published rating goes stale the moment a horse is reassessed for a
    // win, and the weights carry the new figure first. Read the mark off the
    // field's own weight line — see lib/marks.ts.
    const fieldRows = await sql<any[]>`
      SELECT ru.ofr, ru.weight_lbs, ru.jockey_claim_lbs
      FROM runners ru WHERE ru.race_id = ${today.race_id} AND NOT ru.is_non_runner`;
    const shape = (r: any) => ({ ofr: r.ofr, weightLbs: r.weight_lbs, claim: r.jockey_claim_lbs });
    const mk = readMark(fieldRows.map(shape), shape(today));
    const trueMark = mk.effective ?? mk.published;
    const drift = mk.drift;

    const hist = await sql<any[]>`
      SELECT ra.race_date, ra.distance_f, ra.race_class, ra.race_type,
             ru.position_num, ru.ofr
      FROM runners ru JOIN races ra ON ra.id = ru.race_id
      WHERE ru.horse_id = ${today.horse_id} AND ra.race_date < ${date}
      ORDER BY ra.race_date DESC`;

    // Only this code. A hurdle mark and a chase mark are different numbers
    // about different things, and comparing them is meaningless.
    const code = hist.filter((h) => sameDiscipline(h.race_type, today.race_type));
    const wins = code.filter((h) => Number(h.position_num) === 1 && h.ofr !== null);

    const lw = wins[0] ?? null;
    const mark = trueMark;
    const lastMark = lw ? Number(lw.ofr) : null;
    const rise = mark !== null && lastMark !== null ? mark - lastMark : null;

    const atOrAbove = mark === null ? null : wins.find((w) => Number(w.ofr) >= mark) ?? null;

    const note: string[] = [];
    if (rise !== null && rise >= RISE_FLAG_LBS) {
      note.push(`${rise}lb up on its last winning mark`);
      if (atOrAbove) {
        note.push(
          `but has won off ${atOrAbove.ofr} (${String(atOrAbove.race_date).slice(0, 10)}, ` +
            `${atOrAbove.distance_f}f ${atOrAbove.race_class ?? "?"})`
        );
      } else {
        note.push("and has never won off a mark this high");
      }
      const lwCls = clsNum(lw?.race_class ?? null);
      const tCls = clsNum(today.race_class);
      if (lwCls !== null && tCls !== null && tCls < lwCls) {
        note.push(`up in class (${lw.race_class} → ${today.race_class})`);
      }
      if (lw && lw.distance_f !== null && Number(lw.distance_f) !== Number(today.distance_f)) {
        note.push(`different trip (won over ${lw.distance_f}f, runs over ${today.distance_f}f)`);
      }
    }

    rows.push({
      drift,
      published: mk.published,
      rank: p.rank,
      horse: today.horse_name,
      course: String(today.course ?? "").replace(/\s*-\s*AW$/i, ""),
      off: String(today.off_time),
      mark,
      distanceF: today.distance_f === null ? null : Number(today.distance_f),
      raceClass: today.race_class,
      raceType: today.race_type,
      lastWin: lw
        ? {
            date: String(lw.race_date).slice(0, 10),
            mark: lastMark,
            distanceF: lw.distance_f === null ? null : Number(lw.distance_f),
            raceClass: lw.race_class,
          }
        : null,
      wonOffThisMark: atOrAbove
        ? {
            date: String(atOrAbove.race_date).slice(0, 10),
            mark: Number(atOrAbove.ofr),
            distanceF: atOrAbove.distance_f === null ? null : Number(atOrAbove.distance_f),
            raceClass: atOrAbove.race_class,
          }
        : null,
      rise,
      note,
    });
  }
  await sql.end();

  rows.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.off.localeCompare(b.off));

  console.log(`\nMARK CHECK — ${date}`);
  console.log("=".repeat(78));
  console.log(`  ${rows.length} selections\n`);

  const flagged = rows.filter((r) => r.note.length);
  const neverWonThisHigh = flagged.filter((r) => !r.wonOffThisMark);

  for (const r of rows) {
    const lw = r.lastWin
      ? `last won off ${r.lastWin.mark} (${r.lastWin.date}, ${r.lastWin.distanceF}f ${r.lastWin.raceClass ?? "?"})`
      : "no win in this code on record";
    const d = r.rise === null ? "  –  " : `${r.rise >= 0 ? "+" : ""}${r.rise}lb`;
    const tag = r.note.length ? (r.wonOffThisMark ? "  ?" : "  !") : "   ";
    console.log(
      `${tag} ${r.rank ? String(r.rank) + "." : "  "} ${r.horse.toUpperCase().padEnd(20)} ` +
        `${r.off} ${r.course.padEnd(14)} off ${String(r.mark ?? "-").padStart(3)}  ${d.padStart(6)}`
    );
    console.log(`      ${r.distanceF}f ${r.raceClass ?? "?"} · ${lw}`);
    if (r.drift) {
      console.log(
        `      ⚑ racecard says ${r.published}; the weights say ${r.mark} ` +
          `(${r.drift > 0 ? "+" : ""}${r.drift}lb) — reassessed since the rating was published`
      );
    }
    for (const n of r.note) console.log(`      → ${n}`);
  }

  console.log("\n" + "=".repeat(78));
  console.log(`  ${flagged.length} of ${rows.length} are ${RISE_FLAG_LBS}lb or more above their last winning mark.`);
  if (neverWonThisHigh.length) {
    console.log(`  ${neverWonThisHigh.length} of those have never won off a mark this high:`);
    for (const r of neverWonThisHigh) {
      console.log(`    ! ${r.horse.toUpperCase()} — ${r.off} ${r.course}, ${r.rise}lb up`);
    }
  } else if (flagged.length) {
    console.log("  All of them have won off a mark at least this high before.");
  }
  console.log("");
}

main().catch((e) => {
  console.error("\nmark check failed:", e?.message ?? e);
  process.exit(1);
});
