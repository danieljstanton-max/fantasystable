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
  filterRace, scoreHorse, wellHandicapped, groundGate, isHandicap, REJECT_LABELS,
  type PastRun, type HorseToday, type RaceToday,
} from "../lib/selection";
import { readComment, racePaceShape, runStyleHabit } from "../lib/form-reading";
import type { GoingBand } from "../lib/going";
import { betFor, placeTerms } from "../lib/staking";
import { OPENERS_PRIME, OPENERS_ELIGIBLE, OPENERS_PLAIN, pickOpener, OPENER_HAND } from "../lib/voice";
import { courseGuide, goingNote } from "../lib/course-guide";
import { loadHandPicks, handPickFor } from "../lib/hand-picks";
import { projectCard, applyGoingOverrides, bandAtOff, changesDuringCard,
         type GoingProjection } from "../lib/weather";

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
           ra.field_size "fieldSize", ra.pattern, ra.surface
    from races ra where ra.race_date = ${date} order by ra.course_name, ra.off_time`;

  if (!races.length) {
    console.log(`No races stored for ${date}. Run: npm run ingest:racecards -- ${date}`);
    await client.end();
    return;
  }

  // Project the going before scoring. The card's declared going is what the
  // clerk said when it was published — often the previous morning — and every
  // "proven on the ground" read is made against it.
  const courseList = [...new Map(
    races.map((ra: any) => [String(ra.courseName), {
      course: String(ra.courseName),
      going: ra.going ?? null,
      surface: ra.surface ?? null,
    }])
  ).values()];

  // --no-weather scores against the declared going instead. Kept so the effect
  // of the projection can be measured rather than assumed.
  const NO_WEATHER = process.argv.includes("--no-weather");
  const goingProjection: Map<string, GoingProjection> =
    NO_WEATHER ? new Map() : await projectCard(courseList, date);

  // A hand-set going overrules the rainfall read. Someone who knows the track
  // beats a threshold table.
  applyGoingOverrides(goingProjection, process.argv);

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
           ra.field_size "fieldSize", ra.race_class "raceClass",
           r.position_num "positionNum", r.ofr,
           r.jockey_id "jockeyId", r.comment, r.ovr_btn "ovrBtn", r.age,
           (select min(w.ovr_btn) from runners w
             where w.race_id = ra.id and w.position_num = 2) "winMargin"
    from runners r join races ra on ra.id = r.race_id
    where r.horse_id = any(${ids}) and ra.race_date < ${date} and r.position is not null
    order by ra.race_date desc`;

  const byHorse = new Map<string, PastRun[]>();
  for (const h of histRows) {
    if (!byHorse.has(h.horseId)) byHorse.set(h.horseId, []);
    const l = byHorse.get(h.horseId)!;
    // No cap.
    //
    // This was 30, then 60, and the comment that raised it said "60 costs
    // nothing". It cost Cosmos Raj a course win: 75 runs on record, the oldest
    // 15 dropped, and the write-up printed "has won here 4 times" for a horse
    // with five Ripon wins. Exactly the failure the previous comment described,
    // one cap higher.
    //
    // A cap chosen to be "big enough" is a bug waiting for a longer career, so
    // there is no number to pick — the query is already scoped to one day's
    // declared runners, which is a few hundred horses whose records are bounded
    // by how many times a horse can physically run.
    if (true)
      l.push({
        raceDate: h.raceDate, courseSlug: h.courseSlug, distanceF: h.distanceF,
        goingBand: (h.goingBand ?? "unknown") as GoingBand, positionNum: h.positionNum,
        ofr: h.ofr, fieldSize: h.fieldSize, jockeyId: h.jockeyId, comment: h.comment,
        raceType: h.raceType, ovrBtn: h.ovrBtn, age: h.age,
        // Selected but never carried across, so class-drop could not fire
        // outside the backtest — which is why it changed the ROI in the
        // measurement and nothing at all on the card.
        raceClass: h.raceClass,
        // Only meaningful when this horse won; it is the runner-up's deficit.
        // Hardcoding null here made the write-ups disagree with the analysis:
        // "won by more than the handicapper took" could never fire, so the
        // 20:30 Southwell named a different horse in each file.
        winMargin: h.positionNum === 1 ? h.winMargin : null,
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

  const paceMap = new Map<string, number>();
  for (const p of (await client`select * from pace_bias`) as any)
    paceMap.set(`${p.course_slug}|${p.dist_band}|${p.race_code}|${p.run_style}`, Number(p.impact_value));

  const drawDist = (f: number | null) =>
    f === null ? null : f <= 5.5 ? "5f" : f <= 6.5 ? "6f" : f <= 7.5 ? "7f"
      : f <= 8.5 ? "1m" : f <= 10.5 ? "1m1f-1m2f" : f <= 12.5 ? "1m3f-1m4f" : "beyond 1m4f";
  const paceDist = (f: number | null) =>
    f === null ? null : f <= 6.5 ? "sprint" : f <= 8.5 ? "7f-1m" : f <= 12.5 ? "1m1f-1m4f"
      : f <= 17 ? "1m5f-2m" : f <= 22 ? "2m1f-2m6f" : "beyond 2m6f";
  const drawBand = (d: number | null, field: number) => {
    if (d === null || field < 6) return null;
    const q = (d - 1) / (field - 1);
    return q <= 1 / 3 ? "low" : q >= 2 / 3 ? "high" : "mid";
  };

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

  // A whole meeting with no market is the bookmakers, not the model — evening
  // Irish and Northern Irish cards are often priced only on the morning. Saying
  // so stops "no price yet" reading as a failure of the analysis.
  const unpricedMeetings = [...new Set(
    races
      .filter((ra: any) =>
        runners.some((r: any) => r.raceId === ra.id && !r.isNonRunner) &&
        !runners.some((r: any) => r.raceId === ra.id && !r.isNonRunner && r.priceDec != null))
      .map((ra: any) => String(ra.courseName))
  )];

  // Where rain has moved the ground, say so at the top. This is the part the
  // market has not caught up with yet.
  const wetCards = [...goingProjection.values()].filter(
    (g) => g.changed || changesDuringCard(g, races.filter((r: any) =>
      String(r.courseName) === g.course).map((r: any) => String(r.offTime)))
  );

  if (wetCards.length) {
    say("");
    say("GOING WATCH");
    for (const g of wetCards) {
      const offs = races
        .filter((r: any) => String(r.courseName) === g.course)
        .map((r: any) => String(r.offTime));
      const drift = changesDuringCard(g, offs);

      say(
        `  ${g.course}: declared ${g.declared ?? "?"}, ` +
        `${g.rain.beforeRacing.toFixed(0)}mm of rain before the first — ` +
        `we are reading it as ${g.projectedBand.replace("-", " to ")}.`
      );

      // Rain during the card is the part a single going per meeting hides.
      if (drift) {
        say(
          `    Rain through the afternoon: ${drift.from.replace("-", " to ")} for the first, ` +
          `${drift.to.replace("-", " to ")} by the last. Each race below is read on the ` +
          `ground at its own off time.`
        );
      } else if (g.rain.duringRacing > 2) {
        say(`    A further ${g.rain.duringRacing.toFixed(0)}mm is forecast during racing.`);
      }
    }
    say("");
    say("  Selections on those cards are made on the projected ground, not the");
    say("  declared going. The clerk's own update is the authority — check it.");
  }

  if (unpricedMeetings.length) {
    say("");
    say(
      `No prices yet at ${listNames(unpricedMeetings)} — the market has not opened on ` +
      `${unpricedMeetings.length > 1 ? "those cards" : "that card"}. The selections stand; ` +
      `the stake follows once a price exists.`
    );
  }
  say();

  const qualifying = races.filter((ra) => {
    const rs = (byRace.get(ra.id) ?? []).filter((x) => !x.isNonRunner);
    return filterRace({ raceName: ra.name, ageBand: ra.ageBand, raceClass: ra.raceClass },
      rs.map((x) => ({ age: x.age, isNonRunner: x.isNonRunner }))).eligible;
  }).length;

  say(`Every race is previewed below with a selection and a verdict.`);
  say();
  say(`Good luck if you're having a bet.`);
  say();

  /* ---------------------------------------------------------- each race -- */

  let currentCourse = "";
  // Rotates the wording of the commonest clauses. Deterministic, so the same
  // card always reads the same way, but no single phrase opens a quarter of the
  // file. Meaning is identical across variants — only the words move.
  let raceNo = 0;
  const pick = <T>(opts: T[]) => opts[raceNo % opts.length];

  const handPicks = loadHandPicks();

  for (const ra of races) {
    raceNo++;
    if (ra.courseName !== currentCourse) {
      currentCourse = ra.courseName;
      say();
      say("=".repeat(74));
      say(`${String(currentCourse).toUpperCase()} RACING TIPS`);
      say("=".repeat(74));

      // Dan's cheat sheet, once at the top of each meeting rather than on every
      // race — the track's character does not change between the 2:10 and the
      // 3:45, and repeating it fifteen times would train the reader to skip it.
      //
      // Dan, 2026-09-01: "I have built a course and going cheat sheet - please
      // use this moving forward daily and write into our model."
      const cg = courseGuide(String(currentCourse));
      if (cg) {
        const band = bandAtOff(goingProjection.get(String(currentCourse)), ra.offTime)
          ?? ra.goingBand ?? "unknown";
        say();
        if (cg.profile) say(`The track: ${cg.profile}.`);
        if (cg.pace) say(`How it is ridden: ${cg.pace}.`);
        const gn = goingNote(cg, band as GoingBand);
        if (gn) say(`On ${String(band).replace("-", " to ")}: ${gn}`);
        if (cg.trap) say(`The trap: ${cg.trap}.`);
      }
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
      // The ground at this race's off time, not the meeting's. Rain during the
      // card means the last race is not run on the ground of the first.
      goingBand: (bandAtOff(goingProjection.get(String(ra.courseName)), ra.offTime)
        ?? ra.goingBand ?? "unknown") as GoingBand,
      raceType: ra.raceType, fieldSize: live.length,
      // Today's grade. Without it classNumber() returns null and every
      // class signal is silently inert — which is why class-drop moved the
      // backtest and nothing at all on the card.
      raceClass: ra.raceClass ?? null,
      raceName: ra.name ?? null,
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
      const band = drawBand(r.draw, live.length);
      const dB = drawDist(ra.distanceF);
      const iv = band && dB
        ? drawMap.get(`${ra.courseSlug}|${dB}|${ra.goingBand ?? "unknown"}|${band}`) ?? null : null;
      const styles = h.slice(0, 5).map((x) => readComment(x.comment).runStyle).filter(Boolean) as string[];
      const cnt = new Map<string, number>();
      for (const st of styles) cnt.set(st, (cnt.get(st) ?? 0) + 1);
      let habit: string | null = null, bn = 0;
      for (const [k, n] of cnt) if (n > bn) { habit = k; bn = n; }
      const pB = paceDist(ra.distanceF);
      const pIv = habit && bn >= 3 && pB && ra.raceType
        ? paceMap.get(`${ra.courseSlug}|${pB}|${ra.raceType}|${habit}`) ?? null : null;

      const s = scoreHorse(today, raceToday, h, jockeyStrike, date, () => iv, () => pIv);
      const hcap = wellHandicapped(today, raceToday, h, date);
      return { r, h, s, hcap, style: runStyleHabit(h.map((x) => x.comment)).style };
    });

    const shape = racePaceShape(scored.map((x) => x.style));
    const byPrice = [...scored].filter((x) => x.r.priceDec).sort((a, b) => a.r.priceDec - b.r.priceDec);

    // Ties broken by name, in both scripts, so they cannot disagree.
    //
    // Scores are small integers and ties are common — the Cork 17:15 on
    // 2026-08-30 had two horses on the same mark at the top. Both scripts
    // sorted on score alone, which leaves the winner to whatever order Postgres
    // returned the field in, and the two processes got different answers: the
    // write-up named Miss Australie and the best bets named Preparations for
    // the same race. The pre-flight caught it, which is what it is for, but the
    // fix is that a tie has a defined outcome rather than an arbitrary one.
    const bySc = [...scored].sort(
      (a, b) => b.s.score - a.s.score || String(a.r.horseName).localeCompare(String(b.r.horseName))
    );

    // Dan's ground rule applies to the tip in every race, not just to the five.
    //
    // Dan, 2026-09-01: "if a horse has never won or placed on soft or heavy it
    // can't be picked." The first pass only gated the best-bets list, which
    // left the 19:50 Hamilton race page still tipping Annandale while the
    // best-bets file set him aside for the ground — the two documents arguing
    // with each other, which is the exact failure the pre-flight exists to stop.
    //
    // A gated horse is demoted below every horse that passes, rather than
    // deleted: if nothing in the race qualifies we still owe the reader a
    // selection, and the write-up says plainly that none of them has proved it
    // on the ground.
    const groundFails = new Map(
      scored.map((x) => [x.r.horseId, groundGate(x.h, raceToday.goingBand)] as const)
    );
    const passes = (x: (typeof scored)[number]) => groundFails.get(x.r.horseId) === null;
    const cleared = bySc.filter(passes);
    const noneProven = cleared.length === 0;

    // A hand pick wins over everything, including the ground rule — Dan is
    // overriding the model knowingly, and a gate that silently reversed him
    // would be worse than no override at all. It has to be a declared runner.
    const hand = handPickFor(handPicks, date, String(ra.offTime), String(ra.courseName));
    const handRunner = hand
      ? scored.find((x) => String(x.r.horseName).toUpperCase() === hand.horse.toUpperCase())
      : undefined;

    const top = handRunner ?? cleared[0] ?? bySc[0];
    const experienced = scored.filter((x) => x.h.length >= 3).length;

    /* ---- the paragraph ---- */

    // EVERY race gets a selection. This is site copy, not a betting sheet:
    // a preview that shrugs at two thirds of the card is no use to a reader.
    // Where the handicap angles do not apply we say what the race is and pick
    // on what IS there — market, stable form, the booking — rather than
    // declining to have an opinion.
    if (experienced < 3) {
      // Maidens and novices: little or no form to read.
      //
      // The ground rule applies here too, but gently: in a race where most have
      // barely run, "never won or placed on soft" is usually just "never run".
      // So the gate filters the shortlist where it leaves anyone standing, and
      // is stood down where it would empty the race.
      const ok = <T extends { r: { horseId: string } }>(xs: T[]) => {
        const kept = xs.filter((x) => groundFails.get(x.r.horseId) === null);
        return kept.length ? kept : xs;
      };
      const fav = ok(byPrice)[0];
      const hotYard = ok(scored
        .filter((x) => (x.r.t14Runs ?? 0) >= 10 && (x.r.t14Pct ?? 0) >= 18)
        .sort((a, b) => (b.r.t14Pct ?? 0) - (a.r.t14Pct ?? 0)))[0];
      const goodJock = scored
        .map((x) => ({ x, sr: jockeyStrike(x.r.jockeyId) }))
        .filter((y) => (y.sr ?? 0) >= 15)
        .sort((a, b) => (b.sr ?? 0) - (a.sr ?? 0))[0];

      // Five races on one card opened with this exact sentence.
      const openSeed = `${ra.courseName ?? ""}|${ra.offTime ?? ""}`;
      let oh = 0;
      for (let i = 0; i < openSeed.length; i++) oh = (oh * 31 + openSeed.charCodeAt(i)) >>> 0;
      const unexposed = [
        `A hard race to weigh up with most of these unexposed, so the yard and the booking count for more than the form book.`,
        `Not much to go on here with these largely unexposed, so I am leaning on the yard and who is riding.`,
        `A tricky one to unpick — most of these have barely been seen, so the stable and the booking matter more than the figures.`,
        `Hard to be confident with this many unexposed, so the yard and the jockey are doing most of the talking.`,
        `Little to separate them on form because most are unexposed, so it comes down to the yard and the booking.`,
      ];
      say(unexposed[oh % unexposed.length]);

      // Pick on stable form first, then the market.
      const pickWrap = hotYard ?? fav ?? scored[0];
      const pk = pickWrap.r;
      const pkName = String(pk.horseName).toUpperCase();
      const reasons: string[] = [];
      if (hotYard && pk === hotYard.r)
        reasons.push(`${pk.trainerName} is running at ${pk.t14Pct}% over the past fortnight`);
      if (goodJock && goodJock.x.r === pk)
        reasons.push(`${pk.jockeyName} is a ${Math.round(goodJock.sr as number)}% rider`);
      if (fav && fav.r === pk) reasons.push(`the market makes it favourite`);
      if (pk.headgearFirst) reasons.push(`it wears headgear for the first time`);

      say(
        `${pkName} gets the vote at ${price(pk.priceFrac, pk.priceDec)}${pk.trainerName ? ` for ${pk.trainerName}` : ""}` +
          `${pk.jockeyName ? `, ridden by ${pk.jockeyName}` : ""}.` +
          (reasons.length ? ` ${reasons[0].charAt(0).toUpperCase()}${reasons.slice(0, 2).join(", and ").slice(1)}.` : "")
      );

      const others = byPrice.filter((x) => x.r !== pk).slice(0, 2);
      if (others.length)
        say(
          `${others.length > 1 ? "The dangers are" : "The main danger is"} ` +
            listNames(others.map((x) => `${String(x.r.horseName).toUpperCase()} at ${price(x.r.priceFrac, x.r.priceDec)}`)) + `.`
        );
      if (nr.length) say(`Non-runners: ${listNames(nr.map((x) => String(x.horseName)))}.`);
      say(`VERDICT: ${pkName} ${price(pk.priceFrac, pk.priceDec)}${stakeSuffix(pk, ra)}`);
      continue;
    }

    // Pace, where it is readable and decisive — and only where the track
    // actually rewards it.
    //
    // A lone leader is worth something at Lingfield over a sprint, where
    // front-runners win 2.7 times their share of races. It is worth much less
    // where that figure is 1.4. Asserting "an uncontested lead could be worth
    // plenty" everywhere was stating a conclusion the data does not support at
    // most tracks, and it opened a quarter of the write-ups identically.
    if (shape.verdict === "lone-leader") {
      const band = paceDist(ra.distanceF);
      const ledIv = band && ra.raceType
        ? paceMap.get(`${ra.courseSlug}|${band}|${ra.raceType}|led`) ?? null
        : null;

      // Name the horse, and say whose advantage it is.
      //
      // Dan, 2026-09-02: the 15:00 Bath opened "Only one confirmed
      // front-runner ... an uncontested lead could be decisive" and then tipped
      // Rogue Rebellion — a horse that had led 0 times in 13 runs. The note is
      // about the RACE, but sitting immediately above the selection it reads as
      // an argument for it, and here it was an argument for a rival.
      //
      // So the horse is named. If it is ours the lead is a point in favour; if
      // it is not, it is a warning, and a warning is worth more to a reader
      // than a fact they will misattribute.
      const leader = scored.find((x) => x.style === "led");
      const leadName = leader ? String(leader.r.horseName).toUpperCase() : null;
      const ours = leader && top && leader.r.horseId === top.r.horseId;

      if (leadName) {
        const who = ours
          ? `${leadName} is the only confirmed front-runner`
          : `${leadName} is the only confirmed front-runner, and he is not our selection`;

        if (ledIv !== null && ledIv >= 2.2) {
          say(
            `${who} — and this is a track where that matters: front-runners here win ` +
            `${ledIv.toFixed(1)} times their share of these races. An uncontested lead ` +
            `could be decisive${ours ? "" : ", which is the risk to ours"}.`
          );
        } else if (ledIv !== null && ledIv >= 1.8) {
          say(
            `${who}, at a track where making the running is worth a little ` +
            `(front-runners win ${ledIv.toFixed(1)} times their share).`
          );
        } else if (ledIv !== null) {
          say(`${who}, though an uncontested lead counts for less here than it does elsewhere.`);
        }
      }
      // No pace data for this course and distance, or no readable leader: say
      // nothing rather than assert an edge we cannot evidence.
    }
    else if (shape.verdict === "collapse-likely")
      say(`${shape.leaders} of these want to be on the pace, which usually means they go too quick and it falls to something coming from behind.`);

    // The main case.
    const sig = top.s.signals.filter((x) => x.weight > 0);
    const neg = top.s.signals.filter((x) => x.weight < 0);
    const name = String(top.r.horseName).toUpperCase();
    const pr = price(top.r.priceFrac, top.r.priceDec);

    if (!sig.length) {
      // Still commit. The top of the market with the best stable behind it is
      // a defensible call, and saying nothing is not.
      const fav = byPrice[0] ?? scored[0];
      const nm = String(fav.r.horseName).toUpperCase();
      say(`A tricky race on paper with little between them on our figures.`);
      say(
        `${nm} makes most appeal at ${price(fav.r.priceFrac, fav.r.priceDec)}` +
          `${fav.r.trainerName ? ` for ${fav.r.trainerName}` : ""}` +
          `${(fav.r.t14Runs ?? 0) >= 10 && (fav.r.t14Pct ?? 0) >= 18 ? `, whose yard is running at ${fav.r.t14Pct}%` : ""}.`
      );
      const others = byPrice.slice(1, 3);
      if (others.length)
        say(`${others.length > 1 ? "The dangers are" : "The main danger is"} ` +
            listNames(others.map((x) => `${String(x.r.horseName).toUpperCase()} at ${price(x.r.priceFrac, x.r.priceDec)}`)) + `.`);
      if (nr.length) say(`Non-runners: ${listNames(nr.map((x) => String(x.horseName)))}.`);
      say(`VERDICT: ${nm} ${price(fav.r.priceFrac, fav.r.priceDec)}${stakeSuffix(fav.r, ra)}`);
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
        case "plot": return `has had his mark eased — ${detail}`;
        case "went-close":
          return pick([
            `went close off this sort of rating, ${detail}`,
            `was only just denied off a similar mark, ${detail}`,
            `has already run to within touching distance off this sort of figure, ${detail}`,
            `ran a big race off much the same mark, ${detail}`,
          ]);
        case "won-easily": return `${detail}`;
        case "course": {
          const n = parseInt((detail.match(/won here (\d+)/) ?? [])[1] ?? "1", 10);
          if (n === 1)
            return pick([
              `has won here`,
              `has already won around this track`,
              `has a course win to his name`,
              `knows how to win round here`,
            ]);
          const times = n === 2 ? "twice" : `${n} times`;
          return pick([
            `has won here ${times}`,
            `has already won round this track ${times}`,
            `is a ${times}-winner over this course`,
          ]);
        }
        case "trainer-hot": return `comes from a yard in good heart at ${detail.split(" ")[0]}`;
        case "headgear": return `wears headgear for the first time`;
        case "wind": return `makes his first start since a wind operation`;
        case "quick-turnaround": return `is back quickly, ${detail}`;
        case "last-run-easy": return `was not given a hard time of it last time`;
        case "last-run-positive": return `was staying on at the finish last time`;
        case "last-run-won": return `won last time out`;
        case "last-run-trouble": return `met trouble last time`;
        case "fell-going-well": return `was going well when coming down last time`;
        case "draw-good": return `has the right side of the draw`;
        case "pace-suits": return `runs a style that suits this track`;

        // These three follow "It ...", so they need verb phrases. Falling
        // through to the label produced "It proven at the trip and significant
        // booking" — the raw signal name dropped into a sentence.
        // Dan, 2026-08-28: "a lot of horses saying has won on this sort of
        // ground, we need to say the ground will suit or something"
        //
        // State the record instead of repeating the same clause. Nine of the
        // fifty-three write-ups carried the identical phrase; giving the actual
        // figures makes each one different because each horse's record is.
        case "going": {
          // Every phrase here follows "It ...", so it must read as a verb
          // phrase. "the ground will suit" has its own subject and produced
          // "It the ground should suit".
          const m = detail.match(/^(\d+)w (\d+)p from (\d+)[^]*? of (\d+)$/)
            ?? detail.match(/^(\d+)w (\d+)p from (\d+)/);
          if (!m) return `should be suited by the ground`;

          const w = Number(m[1]), pl = Number(m[2]), runs = Number(m[3]);
          const career = m[4] ? Number(m[4]) : 0;
          const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

          if (w > 0)
            return `handles the ground, with ${w === 1 ? "a win" : `${w} wins`} from ${runs} on it`;
          if (pl > 0) {
            // One run on the ground out of a long career is not a small
            // sample, it is a yard that has kept the horse off it. Rating was
            // 1 from 33 and the sentence read "was placed on its only start",
            // which sounds like a lightly raced horse.
            if (runs === 1 && career >= 8)
              return `has been tried on this ground once in ${career} starts, and was placed`;
            return runs === 1
              ? `was placed on its only start on this ground`
              : `should be suited by the ground, placed ${times(pl)} from ${runs} on it`;
          }
          return `should be suited by the ground`;
        }
        case "class-drop": return detail
          ? `drops in grade after ${detail.replace(/^(won|\d+(?:st|nd|rd|th))/, "running $1")}`
          : `drops in grade after a good run`;
        case "course-specialist": return detail
          ? `only wins here — ${detail}`
          : `has won here and nowhere else`;
        case "trip": return `gets a trip he has won over`;
        case "jockey": return detail ? `has a telling booking — ${detail}` : `has a telling booking`;

        default:
          // Anything without a phrase is omitted rather than rendered as a bare
          // label. A missing clause reads fine; a broken one does not.
          return "";
      }
    };

    const parts: string[] = [];
    if (top.hcap.qualifies && top.hcap.reasons.length) {
      // The reason already states the pounds, so do not say it twice.
      // Each reason has to read as a verb phrase, because it follows "It ...".
      // The mark-drop reason arrives as a bare noun phrase ("2 of the last 4
      // starts on the wrong ground, mark down 2lb") and produced "It 2 of the
      // last 4 starts..." until it was given one.
      parts.push(humaniseDates(
        top.hcap.reasons[0]
          .replace(/^(\d+)lb below its \w* ?winning mark of (\d+)/, "races off a mark $1lb below the $2 it won from")
          .replace(/^beaten ([\d.]+)L off (\d+)/, (_m, l, o) => `was beaten ${l} ${Number(l) === 1 ? "length" : "lengths"} off ${o}`)
          .replace(/^won by ([\d.]+)L \(~[\d.]+lb\) and escapes a penalty — ([\d.]+)lb in hand/,
            (_m, l, h) => `won by ${l} ${Number(l) === 1 ? "length" : "lengths"} and escapes a penalty, leaving ${h}lb in hand`)
          .replace(/^won by ([\d.]+)L .*?raised (-?\d+)lb — ([\d.]+)lb in hand/,
            (_m, l, r, h) => `won by ${l} ${Number(l) === 1 ? "length" : "lengths"} and was raised only ${r}lb for it, leaving ${h}lb in hand`)
          .replace(/^(\d+) of the last (\d+) starts on the wrong (.+?), mark down (\d+)lb/,
            "has had $1 of his last $2 starts on the wrong $3 and his mark is $4lb lower for it")
      ));
    }
    for (const x of distinctive.slice(0, 3)) {
      if (["mark", "plot", "went-close", "won-easily"].includes(x.key) && parts.length) continue;

      // "won by 3.75 lengths and was raised only 0lb for it ... and won last
      // time out" describes one race twice. If the handicap reason already
      // says it won, the win signal adds nothing.
      if (x.key === "last-run-won" && parts.some((pt) => /^won by /.test(pt))) continue;

      const ph = phrase(x.key, x.label, x.detail);
      if (ph) parts.push(humaniseDates(ph));
    }
    if (parts.length < 2)
      for (const x of commonplace.slice(0, 2)) {
        const ph = phrase(x.key, x.label, x.detail);
        if (ph) parts.push(humaniseDates(ph));
      }

    // Dan, 2026-09-01: "we can't use the same phrasing for lots of races, put
    // a line through last run always gets used."
    //
    // Measured on this file before the change: "looks the pick of these" in 20
    // of 38 races, and three other stock lines five times each. Three openers
    // chosen by condition means every race meeting that condition gets the
    // same sentence, and a card read top to bottom sounds like a form.
    //
    // Seeded on the horse and the off time, not random: the same race produces
    // the same sentence on every re-run, so republishing a day does not
    // silently reword it. Variety across the card, stability down the day.
    const seed = `${name}|${ra.offTime ?? ""}|${ra.courseName ?? ""}`;

    const who =
      `${name} at ${pr}` +
      (top.r.trainerName ? `, ${top.r.trainerName}` : "") +
      (top.r.jockeyName
        ? `${top.r.claim ? ` with ${top.r.jockeyName} taking off ${top.r.claim}lb` : ` and ${top.r.jockeyName}`}`
        : "");

    // A hand pick states its own case in Dan's words and does not borrow the
    // model's. The score in the best-bets file says something different about
    // this horse, and a reader who notices deserves the honest explanation
    // rather than generated confidence.
    const opener = handRunner && hand
      ? `${who}, ${OPENER_HAND}.`
      : top.hcap.prime
      ? `${who}, ${pickOpener(OPENERS_PRIME, seed)}.`
      : verdict.eligible
      ? `${who}, ${pickOpener(OPENERS_ELIGIBLE, seed)}.`
      : `${who}, ${pickOpener(OPENERS_PLAIN, seed)}.`;

    // Dan, 2026-08-28, after supplying a sample of his own writing:
    //   "please learn from this and mark my daily write ups in same tone"
    //
    // The horse is "he", never "it". That one pronoun is most of the difference
    // between a form-book readout and a person talking about a horse.
    say(opener + (parts.length ? ` He ${listNames(parts.slice(0, 3))}.` : ""));
    if (handRunner && hand && hand.reason) {
      say(hand.reason);
    }
    if (neg.length) say(`The one worry is ${listNames(neg.map((n) => n.label.toLowerCase()))}.`);

    // Where the ground rule moved the tip off the top-scorer, say so and name
    // the horse it moved off. A selection that quietly differs from the score
    // reads as an error; a selection that explains itself reads as a judgement.
    const displaced = bySc[0] && bySc[0] !== top ? bySc[0] : null;
    if (displaced && groundFails.get(displaced.r.horseId)) {
      say(
        `${String(displaced.r.horseName).toUpperCase()} rates higher on our figures but is passed over on the ground — ` +
        `${String(groundFails.get(displaced.r.horseId)).toLowerCase()}.`
      );
    } else if (noneProven) {
      say(`One to be careful with: none of these has won or been placed on this ground.`);
    }

    // Dangers, described by what separates THEM rather than the same two
    // signals every time.
    // Anyone but the selection. This used to be bySc.slice(1), which assumed
    // the tip was always the top-scorer — once the ground rule could move the
    // tip further down, the 19:50 Hamilton listed DANDY'S ANGEL as a danger to
    // DANDY'S ANGEL. A horse is never a danger to itself.
    // Anyone but the selection, and nobody the ground rule has just ruled out.
    //
    // This used to be bySc.slice(1), which assumed the tip was always the
    // top-scorer — once the ground rule could move the tip further down, the
    // 19:50 Hamilton listed DANDY'S ANGEL as a danger to DANDY'S ANGEL. A horse
    // is never a danger to itself. Gated horses come out too: having just
    // written "ANNANDALE is passed over on the ground", following it with "the
    // dangers are ANNANDALE" reads as the file forgetting its own argument.
    // Each horse is named once, in one role.
    const dangers = bySc
      .filter((x) => x !== top && x.s.score > 0 && groundFails.get(x.r.horseId) === null)
      .slice(0, 2);
    if (dangers.length) {
      // Short reasons only. A danger described in a full clause each turns the
      // sentence into a paragraph and buries the selection.
      const SHORT: Record<string, string> = {
        mark: "well handicapped", plot: "on a falling mark", "went-close": "went close off this mark",
        "won-easily": "won with plenty in hand", course: "a course winner",
        "trainer-hot": "from a yard in form", headgear: "in first-time headgear",
        wind: "after a wind operation", "quick-turnaround": "back quickly",
        "last-run-easy": "not hard ridden last time", "last-run-positive": "staying on last time",
        "last-run-won": "won last time",
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

    // No best-bet marker here. The write-ups are the site's preview of the
    // whole card; the selections live in their own file.
    say(`VERDICT: ${name} ${pr}${stakeSuffix(top.r, ra)}`);
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

/**
 * The stake, appended to a verdict line.
 *
 * Reads lib/staking, so the write-up, the best-bets file and the settler can
 * never disagree about what was advised. Returns an empty string where there is
 * no price — a stake cannot be set without one.
 */
function stakeSuffix(pk: any, ra: any): string {
  const bet = betFor(pk?.priceDec ?? null);
  if (bet.type === "none") return "";
  if (bet.type === "win") return ` \u2014 ${bet.label}`;

  const terms = placeTerms(Number(ra?.fieldSize ?? 0), isHandicap(String(ra?.name ?? "")));
  return terms ? ` \u2014 ${bet.label}, ${terms.label}` : ` \u2014 ${bet.label}`;
}
