/**
 * Push settled results to horseracingtips.io.
 *
 *   npm run publish:results -- 2026-08-29
 *   npm run publish:results -- 2026-08-29 --dry
 *
 * A racecard becomes a result in place, on the same URL. This posts the
 * finishing order for every race that has returned, and the running comment
 * under each runner — the line that is the difference between "finished
 * fourth" and "was going best when short of room two out".
 *
 * Our own selections are flagged from the files that went out, not from the
 * model, so the page shows what was actually advised. Safe to run repeatedly:
 * races that have not returned yet are skipped and picked up on the next pass.
 */
import "dotenv/config";
import { fetchResults } from "../lib/racing-api";
import { withRetry } from "../lib/retry";
import { stripHorseCountry, stripCourseSuffix, offTime24, parseOffDt } from "../lib/mappers";
import { parseBestBets, parseWriteUps } from "../lib/published";

const norm = (s: string) =>
  stripHorseCountry(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Course names are compared with any parenthetical dropped. The API says
 * "Down Royal (IRE)"; the write-ups say "DOWN ROYAL". Without this every Irish
 * card fell back to the loose horse-only match, or missed entirely.
 */
const courseKey = (s: string) => norm(s.replace(/\s*\([^)]*\)\s*/g, " "));

type ResultRunner = {
  pos: string; draw: string | null; btn: string | null; ovrBtn: string | null;
  silk: string | null; number: string | null; horse: string; sp: string | null;
  jockey: string | null; trainer: string | null;
  age: string | null; weight: string | null;
  or: string | null; ts: string | null; rpr: string | null;
  comment: string | null; ours: boolean;
};

type ResultRace = {
  /** The Racing API's own race id. The only key both endpoints agree on. */
  id: string;
  course: string; time: string; name: string;
  note: string; runners: ResultRunner[];
};

const str = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v);
  return s === "" || s === "-" ? null : s;
};

/**
 * Position as it should read on the page. The API returns "1", "2", "PU",
 * "F", "UR" — and non-completions are printed as they stand rather than
 * silently blanked, because a punter needs to know the horse fell.
 */
function positionLabel(raw: unknown): string {
  const s = str(raw);
  return s ? s.toUpperCase() : "";
}

/** "3m 53.58s, going Good To Firm" — whatever the API gives, tidied. */
function raceNote(r: any): string {
  const bits = [
    str(r.winning_time_detail) ? `Winning time ${str(r.winning_time_detail)}` : null,
    str(r.going) ? `Going ${str(r.going)}` : null,
    str(r.non_runners) ? `Non-runners: ${str(r.non_runners)}` : null,
    str(r.tote_win) ? `Tote win ${str(r.tote_win)}` : null,
  ].filter(Boolean);
  return bits.join(" · ");
}

(async () => {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run publish:results -- YYYY-MM-DD [--dry]");
    process.exit(1);
  }
  const dry = process.argv.includes("--dry");

  // Everything we advised that day, keyed loosely on the horse and tightly on
  // course + time where we have it. A horse can run twice in a day at two
  // different meetings; the course/time key stops the wrong run being tagged.
  const picks = [...parseBestBets(date), ...parseWriteUps(date)];
  const oursExact = new Set<string>();
  const oursLoose = new Set<string>();
  for (const p of picks) {
    if (p.course && p.offTime) oursExact.add(`${courseKey(p.course)}|${p.offTime}|${norm(p.horse)}`);
    else oursLoose.add(norm(p.horse));
  }

  if (!picks.length) {
    console.log(`No published files for ${date} — results will go up untagged.`);
  }

  // Results are paginated and the API caps `limit` at 100 — asking for more
  // returns a 422 rather than clamping.
  const races: ResultRace[] = [];
  let skip = 0;
  for (;;) {
    // The API works in UTC and refuses a date it considers still to come.
    //
    // Dan's machine runs CEST, so between midnight and 02:00 local the local
    // date is a day ahead of UTC and "today" comes back 422. That threw, and
    // because push-results.sh runs under set -e it took the rest of the sweep
    // down with it — including the month push, which is what keeps the figures
    // on the homepage moving. A day that has not started yet has nothing to
    // settle, which is a normal state, not an error.
    let page: any;
    try {
      page = await withRetry(
        `results ${date} (from ${skip})`,
        () => fetchResults(date, date, 100, skip)
      );
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (/cannot be in the future/i.test(msg) || /\b422\b/.test(msg)) {
        console.log(`${date} has not started yet as far as the API is concerned — nothing to settle.`);
        return;
      }
      throw e;
    }
    const batch: any[] = page?.results ?? [];
    if (!batch.length) break;

    for (const r of batch) {
      const course = stripCourseSuffix(str(r.course) ?? "");
      const off = str(r.off_dt) ? offTime24(parseOffDt(r.off_dt, `result ${r.race_id}`)) : null;
      if (!course || !off) continue;

      const runners: ResultRunner[] = (r.runners ?? [])
        .map((h: any) => {
          const horse = stripHorseCountry(str(h.horse) ?? "");
          const ours =
            oursExact.has(`${courseKey(course)}|${off}|${norm(horse)}`) ||
            oursLoose.has(norm(horse));

          return {
            pos: positionLabel(h.position),
            draw: str(h.draw),
            btn: str(h.btn),
            ovrBtn: str(h.ovr_btn),
            silk: str(h.silk_url),
            number: str(h.number),
            horse,
            sp: str(h.sp),
            jockey: str(h.jockey),
            trainer: str(h.trainer),
            age: str(h.age),
            weight: str(h.weight),
            or: str(h.or),
            ts: str(h.tsr),
            rpr: str(h.rpr),
            comment: str(h.comment),
            ours,
          };
        })
        // Finishing order, with non-completions after the runners that
        // completed. A blank position means the race has not been settled.
        .sort((a: ResultRunner, b: ResultRunner) => {
          const n = (p: string) => (/^\d+$/.test(p) ? parseInt(p, 10) : 999);
          return n(a.pos) - n(b.pos);
        });

      // A race with no finishing positions has not returned yet. Skipping it
      // leaves the racecard in place rather than replacing it with a blank
      // table.
      if (!runners.some((x) => /^\d+$/.test(x.pos))) continue;

      races.push({
        id: String(r.race_id ?? ""),
        course,
        time: off,
        name: str(r.race_name) ?? "",
        note: raceNote(r),
        runners,
      });
    }

    if (batch.length < 100) break;
    skip += 100;
  }

  const tagged = races.reduce((n, r) => n + r.runners.filter((x) => x.ours).length, 0);

  console.log(`\n${date} — ${races.length} settled races, ${tagged} of our selections tagged`);

  if (dry) {
    for (const r of races) {
      const win = r.runners.find((x) => x.pos === "1");
      console.log(`  ${r.time} ${r.course}  ${win?.horse ?? "?"} ${win?.sp ?? ""}`
        + `  (${r.runners.length} ran, ${r.runners.filter((x) => x.comment).length} comments)`);
    }
    return;
  }

  const site = process.env.HRT_URL || process.env.WP_URL;
  const token = process.env.HRT_TOKEN;
  if (!site || !token) {
    console.error("\nMissing HRT_URL / HRT_TOKEN in .env.local.\n");
    process.exit(1);
  }

  if (!races.length) {
    console.log("Nothing settled yet — nothing sent.\n");
    return;
  }

  const url = `${site.replace(/\/$/, "")}/wp-json/hrt/v1/day/${date}/result`;
  const res = await withRetry(`push results ${date}`, () =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-HRT-Token": token },
      body: JSON.stringify({ date, races }),
    })
  );

  const text = await res.text();
  if (!res.ok) {
    console.error(`Failed (${res.status}):`);
    console.error(text.slice(0, 600));
    process.exit(1);
  }

  const json = JSON.parse(text);
  console.log(`  ${json.races} race pages updated`);
  if (json.missed) {
    console.log(`  ${json.missed} settled races had no page on the site — not published yet`);
  }
  console.log("");
})();
