/**
 * The five best bets.
 *
 *   npm run bets                tomorrow
 *   npm run bets -- today
 *   npm run bets -- --n=10
 *
 * One selection per race, ranked by the strength of the evidence and then by
 * how clear-cut the race is. A horse that scores nine and is four points ahead
 * of anything else is a better bet than one that scores nine in a race where
 * three others score eight.
 *
 * NEVER TWO FROM THE SAME RACE. Backing two horses in one contest is not two
 * bets, and an earlier version of the shortlist had Massimo Blue and Jenever
 * side by side in the 20:30 without saying so.
 */

import "dotenv/config";
import postgres from "postgres";

import {
  filterRace, scoreHorse, wellHandicapped,
  type PastRun, type HorseToday, type RaceToday,
} from "../lib/selection";
import { readComment, racePaceShape } from "../lib/form-reading";
import type { GoingBand } from "../lib/going";

const client = postgres(process.env.DATABASE_URL!, { max: 4, ssl: "require" });
const args = process.argv.slice(2);
const arg = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const N = parseInt(arg("n", "5"), 10);

function targetDate(): string {
  const a = args.find((x) => !x.startsWith("--"));
  if (a && /^\d{4}-\d{2}-\d{2}$/.test(a)) return a;
  const d = new Date();
  if (a !== "today") d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const out: string[] = [];
const say = (s = "") => out.push(s);

function prettyDate(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  return `${d.toLocaleDateString("en-GB", { month: "long" })}${
    d.getUTCFullYear() === now.getUTCFullYear() ? "" : ` ${d.getUTCFullYear()}`}`;
}
const humanise = (t: string) =>
  t.replace(/\((\d{4}-\d{2}-\d{2})\)/g, (_, i) => `back in ${prettyDate(i)}`)
   .replace(/on (\d{4}-\d{2}-\d{2})/g, (_, i) => `in ${prettyDate(i)}`);

async function main() {
  const date = targetDate();

  const races: any[] = await client`
    select ra.id, ra.course_name "courseName", ra.course_slug "courseSlug",
           ra.off_time "offTime", ra.name, ra.race_class "raceClass",
           ra.age_band "ageBand", ra.going, ra.going_band "goingBand",
           ra.distance_round "distRound", ra.distance_f "distanceF",
           ra.race_type "raceType", ra.prize
    from races ra where ra.race_date = ${date} order by ra.off_time`;
  if (!races.length) {
    console.log(`No races stored for ${date}.`);
    await client.end();
    return;
  }

  const runners: any[] = await client`
    select r.race_id "raceId", r.horse_id "horseId", r.horse_name "horseName",
           r.age, r.draw, r.ofr, r.last_run "lastRun",
           r.jockey_id "jockeyId", r.jockey_name "jockeyName", r.jockey_claim_lbs "claim",
           r.trainer_name "trainerName", r.best_odds_frac "priceFrac", r.best_odds_dec "priceDec",
           coalesce(r.headgear_first_time,false) "headgearFirst", r.wind_surgery_run "windRun",
           r.is_non_runner "isNonRunner", r.trainer_14_percent "t14Pct",
           r.trainer_14_runs "t14Runs", r.trainer_14_wins "t14Wins"
    from runners r join races ra on ra.id = r.race_id where ra.race_date = ${date}`;

  const ids = [...new Set(runners.map((r) => r.horseId))];
  const hist: any[] = await client`
    select r.horse_id "horseId", ra.race_date::text "raceDate", ra.course_slug "courseSlug",
           ra.distance_f "distanceF", ra.going_band "goingBand", ra.race_type "raceType",
           ra.field_size "fieldSize", r.position_num "positionNum", r.ofr,
           r.jockey_id "jockeyId", r.comment, r.ovr_btn "ovrBtn", r.age,
           (select min(w.ovr_btn) from runners w
             where w.race_id = ra.id and w.position_num = 2) "winMargin"
    from runners r join races ra on ra.id = r.race_id
    where r.horse_id = any(${ids}) and ra.race_date < ${date} and r.position is not null
    order by ra.race_date desc`;

  const byHorse = new Map<string, PastRun[]>();
  for (const h of hist) {
    if (!byHorse.has(h.horseId)) byHorse.set(h.horseId, []);
    const l = byHorse.get(h.horseId)!;
    if (l.length < 30)
      l.push({
        raceDate: h.raceDate, courseSlug: h.courseSlug, distanceF: h.distanceF,
        goingBand: (h.goingBand ?? "unknown") as GoingBand, positionNum: h.positionNum,
        ofr: h.ofr, fieldSize: h.fieldSize, jockeyId: h.jockeyId, comment: h.comment,
        raceType: h.raceType, ovrBtn: h.ovrBtn, age: h.age,
        winMargin: h.positionNum === 1 ? h.winMargin : null,
      });
  }

  const drawMap = new Map<string, number>();
  for (const d of (await client`select * from draw_bias`) as any)
    drawMap.set(`${d.course_slug}|${d.dist_band}|${d.going_band}|${d.draw_band}`, Number(d.impact_value));
  const paceMap = new Map<string, number>();
  for (const p of (await client`select * from pace_bias`) as any)
    paceMap.set(`${p.course_slug}|${p.dist_band}|${p.race_code}|${p.run_style}`, Number(p.impact_value));
  const jkRows: any[] = await client`
    select jockey_id "jockeyId", count(*)::int rides,
           count(*) filter (where position_num=1)::int wins
    from runners where jockey_id is not null and position is not null
    group by 1 having count(*) >= 20`;
  const jkMap = new Map<string, number>();
  for (const j of jkRows) jkMap.set(j.jockeyId, (j.wins / j.rides) * 100);
  const jockeyStrike = (id: string | null) => (id ? jkMap.get(id) ?? null : null);

  const drawDist = (f: number | null) =>
    f === null ? null : f <= 5.5 ? "5f" : f <= 6.5 ? "6f" : f <= 7.5 ? "7f"
      : f <= 8.5 ? "1m" : f <= 10.5 ? "1m1f-1m2f" : f <= 12.5 ? "1m3f-1m4f" : "beyond 1m4f";
  const paceDist = (f: number | null) =>
    f === null ? null : f <= 6.5 ? "sprint" : f <= 8.5 ? "7f-1m" : f <= 12.5 ? "1m1f-1m4f"
      : f <= 17 ? "1m5f-2m" : f <= 22 ? "2m1f-2m6f" : "beyond 2m6f";
  const drawBandOf = (d: number | null, field: number) => {
    if (d === null || field < 6) return null;
    const q = (d - 1) / (field - 1);
    return q <= 1 / 3 ? "low" : q >= 2 / 3 ? "high" : "mid";
  };

  const byRace = new Map<string, any[]>();
  for (const r of runners) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId)!.push(r);
  }

  /* ------------------------------------------------- one pick per race --- */

  interface Candidate {
    race: any; r: any; score: number; clear: number; field: number;
    hcap: ReturnType<typeof wellHandicapped>;
    signals: { label: string; detail: string; weight: number }[];
    pace: string;
  }
  const picks: Candidate[] = [];

  for (const ra of races) {
    const live = (byRace.get(ra.id) ?? []).filter((r) => !r.isNonRunner);
    if (live.length < 5) continue;
    // Only races that pass the filters — the best bets come from the handicaps
    // the method is built for, not from every race on the card.
    if (!filterRace({ raceName: ra.name, ageBand: ra.ageBand, raceClass: ra.raceClass },
      live.map((x) => ({ age: x.age, isNonRunner: x.isNonRunner }))).eligible) continue;

    const raceToday: RaceToday = {
      courseSlug: ra.courseSlug, distanceF: ra.distanceF,
      goingBand: (ra.goingBand ?? "unknown") as GoingBand,
      raceType: ra.raceType, fieldSize: live.length,
    };

    const scored = live.map((r) => {
      const h = byHorse.get(r.horseId) ?? [];
      const band = drawBandOf(r.draw, live.length);
      const dB = drawDist(ra.distanceF);
      const iv = band && dB ? drawMap.get(`${ra.courseSlug}|${dB}|${ra.goingBand ?? "unknown"}|${band}`) ?? null : null;
      const styles = h.slice(0, 5).map((x) => readComment(x.comment).runStyle).filter(Boolean) as string[];
      const cnt = new Map<string, number>();
      for (const st of styles) cnt.set(st, (cnt.get(st) ?? 0) + 1);
      let habit: string | null = null, bn = 0;
      for (const [k, n] of cnt) if (n > bn) { habit = k; bn = n; }
      const pB = paceDist(ra.distanceF);
      const pIv = habit && bn >= 3 && pB && ra.raceType
        ? paceMap.get(`${ra.courseSlug}|${pB}|${ra.raceType}|${habit}`) ?? null : null;

      const today: HorseToday = {
        horseId: r.horseId, horseName: r.horseName, ofr: r.ofr, age: r.age, draw: r.draw,
        jockeyId: r.jockeyId, bestOddsDec: r.priceDec,
        headgearFirstTime: r.headgearFirst, windSurgeryFirstTime: r.windRun === "1",
        daysSinceRun: r.lastRun, trainer14Runs: r.t14Runs,
        trainer14Wins: r.t14Wins, trainer14Percent: r.t14Pct,
      };
      const s = scoreHorse(today, raceToday, h, jockeyStrike, date, () => iv, () => pIv);
      return { r, h, s, hcap: wellHandicapped(today, raceToday, h, date),
               style: h[0] ? readComment(h[0].comment).runStyle : null };
    });

    scored.sort((a, b) => b.s.score - a.s.score);
    const best = scored[0];
    if (!best || best.s.score <= 0) continue;

    picks.push({
      race: ra, r: best.r, score: best.s.score,
      clear: scored.length > 1 ? best.s.score - scored[1].s.score : best.s.score,
      field: live.length, hcap: best.hcap, signals: best.s.signals,
      pace: racePaceShape(scored.map((x) => x.style)).verdict,
    });
  }

  // Strength first, decisiveness second.
  picks.sort((a, b) => b.score - a.score || b.clear - a.clear);
  const top = picks.slice(0, N);

  /* -------------------------------------------------------------- output */

  const d = new Date(date + "T12:00:00Z");
  const pretty = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  say(`TOP ${N} BEST BETS — ${pretty.toUpperCase()}`);
  say("=".repeat(72));
  say();
  say(`One selection per race, from ${picks.length} qualifying handicaps.`);
  say(`Ranked by the weight of evidence, then by how clear-cut the race is.`);
  say(`Prices are best available at the time of writing and will move.`);
  say();

  top.forEach((p, i) => {
    const price = p.r.priceFrac ?? (p.r.priceDec ? p.r.priceDec.toFixed(1) : "no price");
    say("-".repeat(72));
    say(`${i + 1}. ${String(p.r.horseName).toUpperCase()}    ${price}`);
    say(`   ${p.race.offTime} ${p.race.courseName} · ${p.race.distRound} · ${p.race.going} · ${p.field} runners`);
    say(`   ${String(p.race.name).slice(0, 60)}`);
    say(`   ${p.r.trainerName ?? "?"} / ${p.r.jockeyName ?? "?"}${p.r.claim ? ` (${p.r.claim})` : ""}`);
    say();
    say(`   ${p.score} points, ${p.clear} clear of the next in the race${
      p.hcap.qualifies ? `, ${p.hcap.lbsInHand}lb in hand` : ""}${p.hcap.prime ? "   [PRIME]" : ""}`);
    say();

    for (const why of p.hcap.reasons) say(`   * ${humanise(why)}`);
    const support = p.signals
      .filter((s) => s.weight > 0 && !["mark", "plot", "went-close", "won-easily"].includes((s as any).key))
      .map((s) => s.label);
    if (support.length) say(`   + ${support.join(", ")}`);
    const against = p.signals.filter((s) => s.weight < 0);
    for (const a of against) say(`   ! ${a.label}: ${a.detail}`);
    if (p.pace === "lone-leader") say(`   + Only one confirmed front-runner in the race`);
    if (p.pace === "collapse-likely") say(`   ! Several want to lead — the pace may collapse`);
    say();
  });

  say("=".repeat(72));
  say(`18+ · Please gamble responsibly · BeGambleAware.org`);
  say(`Tips are opinion, not guarantees. Never bet more than you can afford to lose.`);
  say();

  console.log(out.join("\n"));
  await client.end();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
