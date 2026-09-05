/**
 * A write-up for every race on the card.
 *
 *   npm run writeups                 tomorrow
 *   npm run writeups -- today
 *   npm run writeups -- 2026-08-28
 *
 * Plain text, every race, grouped by meeting — not just the handicaps that
 * qualify for a bet. The site covers the whole card, so the whole card needs
 * copy; the betting filter decides which races get a selection, not which get
 * written about.
 *
 * THE MODEL SELECTS, THE PROSE ONLY NARRATES. Every sentence here is generated
 * from a computed feature. Nothing is invented to fill space: where a race
 * cannot be solved from the data — a two-year-old maiden with no form, a field
 * of first-time runners — it says so instead of padding, which is both more
 * honest and closer to how Dan writes ("a horrible race on paper").
 */

import "dotenv/config";
import postgres from "postgres";

import {
  filterRace, scoreHorse, wellHandicapped, REJECT_LABELS,
  type PastRun, type HorseToday, type RaceToday,
} from "../lib/selection";
import { readComment, racePaceShape } from "../lib/form-reading";
import type { GoingBand } from "../lib/going";

const client = postgres(process.env.DATABASE_URL!, { max: 4, ssl: "require" });

function targetDate(): string {
  const a = process.argv.slice(2).find((x) => !x.startsWith("--"));
  if (a && /^\d{4}-\d{2}-\d{2}$/.test(a)) return a;
  const d = new Date();
  if (a !== "today") d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const out: string[] = [];
const say = (s = "") => out.push(s);

/** "12/1" -> readable. Falls back to the decimal if no fraction is stored. */
function price(frac: string | null, dec: number | null): string {
  if (frac) return frac;
  if (dec) return `${dec.toFixed(1)}`;
  return "no price yet";
}

/** "2026-05-21" -> "in May" or "on 21 May" — dates in prose, not ISO strings. */
function prettyDate(iso: string, withDay = false): string {
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  const month = d.toLocaleDateString("en-GB", { month: "long" });
  const now = new Date();
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  if (withDay) return `on ${d.getUTCDate()} ${month}${sameYear ? "" : ` ${d.getUTCFullYear()}`}`;
  return `${sameYear ? "in" : "back in"} ${month}${sameYear ? "" : ` ${d.getUTCFullYear()}`}`;
}

/** Replace any ISO date inside a generated detail string. */
function humaniseDates(t: string): string {
  return t
    .replace(/\((\d{4}-\d{2}-\d{2})\)/g, (_, iso) => prettyDate(iso))
    .replace(/on (\d{4}-\d{2}-\d{2})/g, (_, iso) => prettyDate(iso, true));
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

async function main() {
  const date = targetDate();

  const races: any[] = await client`
    select ra.id, ra.course_name "courseName", ra.course_slug "courseSlug",
           ra.off_time "offTime", ra.name, ra.race_class "raceClass",
           ra.age_band "ageBand", ra.going, ra.going_detailed "goingDetailed",
           ra.going_band "goingBand", ra.distance_round "distRound",
           ra.distance_f "distanceF", ra.race_type "raceType", ra.prize,
           ra.field_size "fieldSize", ra.pattern
    from races ra where ra.race_date = ${date} order by ra.course_name, ra.off_time`;

  if (!races.length) {
    console.log(`No races stored for ${date}. Run: npm run ingest:racecards -- ${date}`);
    await client.end();
    return;
  }

  const runners: any[] = await client`
    select r.race_id "raceId", r.horse_id "horseId", r.horse_name "horseName",
           r.age, r.draw, r.ofr, r.number, r.form, r.last_run "lastRun",
           r.jockey_id "jockeyId", r.jockey_name "jockeyName",
           r.jockey_claim_lbs "claim", r.trainer_name "trainerName",
           r.best_odds_frac "priceFrac", r.best_odds_dec "priceDec",
           r.headgear, coalesce(r.headgear_first_time,false) "headgearFirst",
           r.wind_surgery_run "windRun", r.is_non_runner "isNonRunner",
           r.trainer_14_percent "t14Pct", r.trainer_14_runs "t14Runs",
           r.trainer_14_wins "t14Wins"
    from runners r join races ra on ra.id = r.race_id
    where ra.race_date = ${date}`;

  const ids = [...new Set(runners.map((r) => r.horseId))];
  const histRows: any[] = await client`
    select r.horse_id "horseId", ra.race_date::text "raceDate", ra.course_slug "courseSlug",
           ra.distance_f "distanceF", ra.going_band "goingBand", ra.race_type "raceType",
           ra.field_size "fieldSize", r.position_num "positionNum", r.ofr,
           r.jockey_id "jockeyId", r.comment, r.ovr_btn "ovrBtn", r.age
    from runners r join races ra on ra.id = r.race_id
    where r.horse_id = any(${ids}) and ra.race_date < ${date} and r.position is not null
    order by ra.race_date desc`;

  const byHorse = new Map<string, PastRun[]>();
  for (const h of histRows) {
    if (!byHorse.has(h.horseId)) byHorse.set(h.horseId, []);
    const l = byHorse.get(h.horseId)!;
    if (l.length < 30)
      l.push({
        raceDate: h.raceDate, courseSlug: h.courseSlug, distanceF: h.distanceF,
        goingBand: (h.goingBand ?? "unknown") as GoingBand, positionNum: h.positionNum,
        ofr: h.ofr, fieldSize: h.fieldSize, jockeyId: h.jockeyId, comment: h.comment,
        raceType: h.raceType, ovrBtn: h.ovrBtn, age: h.age, winMargin: null,
      });
  }

  const drawMap = new Map<string, number>();
  for (const d of (await client`select * from draw_bias`) as any)
    drawMap.set(`${d.course_slug}|${d.dist_band}|${d.going_band}|${d.draw_band}`, Number(d.impact_value));
  const jkRows: any[] = await client`
    select jockey_id "jockeyId", count(*)::int rides,
           count(*) filter (where position_num=1)::int wins
    from runners where jockey_id is not null and position is not null
    group by 1 having count(*) >= 20`;
  const jkMap = new Map<string, number>();
  for (const j of jkRows) jkMap.set(j.jockeyId, (j.wins / j.rides) * 100);
  const jockeyStrike = (id: string | null) => (id ? jkMap.get(id) ?? null : null);

  const byRace = new Map<string, any[]>();
  for (const r of runners) {
    if (!byRace.has(r.raceId)) byRace.set(r.raceId, []);
    byRace.get(r.raceId)!.push(r);
  }

  /* --------------------------------------------------------------- header */

  const d = new Date(date + "T12:00:00Z");
  const pretty = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const meetings = [...new Set(races.map((r) => r.courseName))];

  say(`HORSE RACING TIPS — ${pretty.toUpperCase()}`);
  say("=".repeat(74));
  say();
  say(`${races.length} races across ${meetings.length} meetings: ${listNames(meetings)}.`);
  say();

  const qualifying = races.filter((ra) => {
    const rs = (byRace.get(ra.id) ?? []).filter((x) => !x.isNonRunner);
    return filterRace({ raceName: ra.name, ageBand: ra.ageBand, raceClass: ra.raceClass },
      rs.map((x) => ({ age: x.age, isNonRunner: x.isNonRunner }))).eligible;
  }).length;

  say(`${qualifying} of them are handicaps worth a bet by our criteria. The rest are`);
  say(`covered below but are not races we would be having a bet in.`);
  say();
  say(`Good luck if you're having a bet.`);
  say();

  /* ---------------------------------------------------------- each race -- */

  let currentCourse = "";
  for (const ra of races) {
    if (ra.courseName !== currentCourse) {
      currentCourse = ra.courseName;
      say();
      say("=".repeat(74));
      say(`${String(currentCourse).toUpperCase()} RACING TIPS`);
      say("=".repeat(74));
    }

    const all = byRace.get(ra.id) ?? [];
    const live = all.filter((r) => !r.isNonRunner);
    const nr = all.filter((r) => r.isNonRunner);

    say();
    say(`${ra.offTime}  ${ra.name}`);
    say(
      `${ra.distRound ?? "?"} · ${ra.raceType ?? "?"} · ${ra.raceClass ?? "no class"} · ` +
        `${ra.ageBand ?? ""} · ${ra.going ?? "?"} · ${live.length} runners` +
        (ra.prize ? ` · ${ra.prize}` : "")
    );
    say("-".repeat(74));

    if (live.length < 2) { say(`Not enough declared runners to preview.`); continue; }

    const verdict = filterRace(
      { raceName: ra.name, ageBand: ra.ageBand, raceClass: ra.raceClass },
      live.map((x) => ({ age: x.age, isNonRunner: x.isNonRunner }))
    );

    // Score everything we can, whether or not the race qualifies for a bet.
    const raceToday: RaceToday = {
      courseSlug: ra.courseSlug, distanceF: ra.distanceF,
      goingBand: (ra.goingBand ?? "unknown") as GoingBand,
      raceType: ra.raceType, fieldSize: live.length,
    };
    const scored = live.map((r) => {
      const h = byHorse.get(r.horseId) ?? [];
      const today: HorseToday = {
        horseId: r.horseId, horseName: r.horseName, ofr: r.ofr, age: r.age, draw: r.draw,
        jockeyId: r.jockeyId, bestOddsDec: r.priceDec,
        headgearFirstTime: r.headgearFirst, windSurgeryFirstTime: r.windRun === "1",
        daysSinceRun: r.lastRun, trainer14Runs: r.t14Runs,
        trainer14Wins: r.t14Wins, trainer14Percent: r.t14Pct,
      };
      const s = scoreHorse(today, raceToday, h, jockeyStrike, date);
      const hcap = wellHandicapped(today, raceToday, h, date);
      return { r, h, s, hcap, style: h[0] ? readComment(h[0].comment).runStyle : null };
    });

    const shape = racePaceShape(scored.map((x) => x.style));
    const byPrice = [...scored].filter((x) => x.r.priceDec).sort((a, b) => a.r.priceDec - b.r.priceDec);
    const bySc = [...scored].sort((a, b) => b.s.score - a.s.score);
    const top = bySc[0];
    const experienced = scored.filter((x) => x.h.length >= 3).length;

    /* ---- the paragraph ---- */

    // A race we would not bet in still gets covered, but the copy says why.
    if (!verdict.eligible) {
      const why = REJECT_LABELS[verdict.reason!];
      if (verdict.reason === "not-a-handicap") {
        say(`Not a handicap, so it falls outside what we bet, but worth a look.`);
      } else {
        say(`One we leave alone — ${why.toLowerCase()}.`);
      }
    }

    if (experienced < 3) {
      // Nothing to read. Say so rather than invent.
      const fav = byPrice[0];
      say(
        `Very little to go on here with most of these lightly raced or unraced.` +
          (fav ? ` ${String(fav.r.horseName).toUpperCase()} heads the market at ${price(fav.r.priceFrac, fav.r.priceDec)}` +
            `${fav.r.trainerName ? ` for ${fav.r.trainerName}` : ""}.` : "")
      );
      const hotYard = scored.find((x) => (x.r.t14Runs ?? 0) >= 10 && (x.r.t14Pct ?? 0) >= 20);
      if (hotYard)
        say(`${hotYard.r.trainerName} is in good form at ${hotYard.r.t14Pct}% over the last fortnight, ` +
            `which is worth noting with ${String(hotYard.r.horseName).toUpperCase()}.`);
      say(`Not one for us.`);
      continue;
    }

    // Pace, where it is readable and decisive. One sentence, not two.
    if (shape.verdict === "lone-leader")
      say(`There looks to be only one confirmed front-runner in here and an uncontested lead could be worth plenty.`);
    else if (shape.verdict === "collapse-likely")
      say(`${shape.leaders} of these want to be on the pace, which usually means they go too quick and it falls to something coming from behind.`);

    // The main case.
    const sig = top.s.signals.filter((x) => x.weight > 0);
    const neg = top.s.signals.filter((x) => x.weight < 0);
    const name = String(top.r.horseName).toUpperCase();
    const pr = price(top.r.priceFrac, top.r.priceDec);

    if (!sig.length) {
      say(`A hard race to solve and nothing stands out on our figures.`);
      const fav = byPrice[0];
      if (fav) say(`${String(fav.r.horseName).toUpperCase()} is favourite at ${price(fav.r.priceFrac, fav.r.priceDec)}.`);
      say(`One to watch rather than bet.`);
      continue;
    }

    // Build the case from the DISTINCTIVE evidence, not the commonplace.
    //
    // "Proven on the ground" and "proven at the trip" fire on most of the
    // field in most races, so leading with them produced the same sentence
    // every time. They are mentioned only when little else is there.
    const COMMON = new Set(["going", "trip", "jockey"]);
    const distinctive = sig.filter((x) => !COMMON.has(x.key));
    const commonplace = sig.filter((x) => COMMON.has(x.key));

    const phrase = (key: string, label: string, detail: string): string => {
      switch (key) {
        case "mark": return `races off a mark ${detail.replace(/^(\d+)lb below its \w* ?winning mark of (\d+).*/, "$1lb below the $2 it won off")}`;
        case "plot": return `has had its mark eased — ${detail}`;
        case "went-close": return `went close off this sort of rating, ${detail}`;
        case "won-easily": return `${detail}`;
        case "course": return detail.includes("1 time") ? `has won here` : `has won here ${detail.replace("won here ", "")}`;
        case "trainer-hot": return `comes from a yard in good heart at ${detail.split(" ")[0]}`;
        case "headgear": return `wears headgear for the first time`;
        case "wind": return `makes its first start since a wind operation`;
        case "quick-turnaround": return `is back quickly, ${detail}`;
        case "last-run-easy": return `was not given a hard time of it last time`;
        case "last-run-positive": return `was staying on at the finish last time`;
        case "last-run-trouble": return `met trouble last time`;
        case "fell-going-well": return `was going well when coming down last time`;
        case "draw-good": return `has the right side of the draw`;
        case "pace-suits": return `runs a style that suits this track`;
        default: return label.toLowerCase();
      }
    };

    const parts: string[] = [];
    if (top.hcap.qualifies && top.hcap.reasons.length) {
      // The reason already states the pounds, so do not say it twice.
      parts.push(humaniseDates(
        top.hcap.reasons[0]
          .replace(/^(\d+)lb below its \w* ?winning mark of (\d+)/, "races off a mark $1lb below the $2 it won from")
          .replace(/^beaten ([\d.]+)L off (\d+)/, "was beaten $1 lengths off $2")
          .replace(/^won by ([\d.]+)L .*?raised (-?\d+)lb — ([\d.]+)lb in hand/,
            "won by $1 lengths and was raised only $2lb for it, leaving $3lb in hand")
      ));
    }
    for (const x of distinctive.slice(0, 3)) {
      if (["mark", "plot", "went-close", "won-easily"].includes(x.key) && parts.length) continue;
      parts.push(humaniseDates(phrase(x.key, x.label, x.detail)));
    }
    if (parts.length < 2)
      for (const x of commonplace.slice(0, 2)) parts.push(humaniseDates(phrase(x.key, x.label, x.detail)));

    const opener = top.hcap.prime
      ? `${name} is the one, and this is the sort of race we are looking for`
      : verdict.eligible
      ? `${name} makes most appeal`
      : `${name} looks the pick of these`;

    say(
      `${opener}${top.r.trainerName ? ` for ${top.r.trainerName}` : ""}` +
        `${top.r.jockeyName ? `, ${top.r.claim ? `with ${top.r.jockeyName} taking off ${top.r.claim}lb` : `ridden by ${top.r.jockeyName}`}` : ""}. ` +
        (parts.length ? `It ${listNames(parts.slice(0, 3))}.` : "")
    );
    if (neg.length) say(`The negatives: ${listNames(neg.map((n) => n.label.toLowerCase()))}.`);

    // Dangers, described by what separates THEM rather than the same two
    // signals every time.
    const dangers = bySc.slice(1, 3).filter((x) => x.s.score > 0);
    if (dangers.length) {
      // Short reasons only. A danger described in a full clause each turns the
      // sentence into a paragraph and buries the selection.
      const SHORT: Record<string, string> = {
        mark: "well handicapped", plot: "on a falling mark", "went-close": "went close off this mark",
        "won-easily": "won with plenty in hand", course: "a course winner",
        "trainer-hot": "from a yard in form", headgear: "in first-time headgear",
        wind: "after a wind operation", "quick-turnaround": "back quickly",
        "last-run-easy": "not hard ridden last time", "last-run-positive": "staying on last time",
        "last-run-trouble": "unlucky last time", "fell-going-well": "fell when going well",
        "draw-good": "well drawn", "pace-suits": "suited by the track",
      };
      const bits = dangers.map((x) => {
        const own = x.s.signals.filter((y) => y.weight > 0 && SHORT[y.key]).slice(0, 1);
        const why = own.length ? SHORT[own[0].key] : null;
        return `${String(x.r.horseName).toUpperCase()} at ${price(x.r.priceFrac, x.r.priceDec)}` +
          (why ? ` (${why})` : "");
      });
      say(`${dangers.length > 1 ? "The dangers are" : "The main danger is"} ${listNames(bits)}.`);
    }

    if (nr.length) say(`Non-runners: ${listNames(nr.map((x) => String(x.horseName)))}.`);

    if (verdict.eligible) {
      say(`VERDICT: ${name} ${pr}${top.hcap.prime ? " — our strongest type of race, conditions all proven" : ""}`);
    }
  }

  say();
  say("=".repeat(74));
  say(`18+ · Please gamble responsibly · BeGambleAware.org`);
  say(`Tips are opinion, not guarantees. Never bet more than you can afford to lose.`);
  say();

  console.log(out.join("\n"));
  await client.end();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
