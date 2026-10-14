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
import { readMark } from "../lib/marks";
import { readDraw, drawPhrase, DRAW_AGAINST } from "../lib/draw";
import { chooseFromRace } from "../lib/funnel";

/**
 * What a horse gives up for not being the standout in its own race.
 *
 * In points, the same unit as the score, so the deduction can be read straight
 * off the figures printed beside every selection. Capped at three: beyond
 * "we cannot split this race" there is nothing more to say, and a deeper
 * penalty would start rejecting strong horses in genuinely competitive races
 * rather than ranking them.
 */
export function standoutPenalty(clear: number): number {
  if (clear >= 3) return 0;
  if (clear === 2) return 1;
  if (clear === 1) return 2;
  return 3;
}

import {
  filterRace, scoreHorse, wellHandicapped, groundGate, streakGate,
  type PastRun, type HorseToday, type RaceToday,
} from "../lib/selection";
import { readComment, racePaceShape, runStyleHabit } from "../lib/form-reading";
import type { GoingBand } from "../lib/going";
import { betFor, placeTerms } from "../lib/staking";
import { loadVetoes, isVetoed } from "../lib/vetoes";
import { loadHandPicks, handPickFor } from "../lib/hand-picks";
import { markGate, likesConditions } from "../lib/selection";
import { courseGuide, goingNote, sheetDraw, drawThird } from "../lib/course-guide";
import { projectCard, applyGoingOverrides, bandAtOff, changesDuringCard,
         type GoingProjection } from "../lib/weather";

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
           ra.race_type "raceType", ra.prize, ra.surface
    from races ra where ra.race_date = ${date} order by ra.off_time`;
  if (!races.length) {
    console.log(`No races stored for ${date}.`);
    await client.end();
    return;
  }

  // Project the going before scoring. The card's declared going is what the
  // clerk said when it was published — often the previous morning — and every
  // "proven on the ground" read is made against it.
  const meetings = [...new Map(
    races.map((ra: any) => [String(ra.courseName), {
      course: String(ra.courseName),
      going: ra.going ?? null,
      surface: ra.surface ?? null,
    }])
  ).values()];

  const NO_WEATHER = process.argv.includes("--no-weather");
  const goingProjection: Map<string, GoingProjection> =
    NO_WEATHER ? new Map() : await projectCard(meetings, date);

  // A hand-set going overrules the rainfall read. Someone who knows the track
  // beats a threshold table.
  applyGoingOverrides(goingProjection, process.argv);

  const runners: any[] = await client`
    select r.race_id "raceId", r.horse_id "horseId", r.horse_name "horseName",
           r.age, r.draw, r.ofr, r.weight_lbs "weightLbs", r.last_run "lastRun",
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
           ra.field_size "fieldSize", ra.race_class "raceClass",
           r.position_num "positionNum", r.ofr,
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
    // 30 was too tight. The query counts non-completions as well as finishes,
    // so a jumps horse with a long career lost its oldest runs — which is how
    // "has won here twice" was printed for a horse with three course wins.
    // One day's card is a few hundred horses; 60 costs nothing.
    // No cap — and it has to match write-ups.ts exactly.
    //
    // The cap was lifted there and left at 60 here, so the two scripts scored
    // the same horses off different histories and every one of the five best
    // bets stopped agreeing with its own write-up. Pre-flight's files-agree
    // check caught it, which is precisely what it is for.
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
    rankScore: number;
    handPick: { horse: string; reason: string } | null;
    handPickNap: boolean;
    groundRecord: string;
    groundFail: string | null;
    streakFail: string | null;
    markFail: string | null;
    wonAtTrip: boolean;
    courseWins: number;
    isFlat: boolean;
    goingBand: GoingBand;
    pace: string;
    /** Stall number, and how that side of the track fares here. */
    draw: number | null;
    drawIv: number | null;
    drawIvBand: string | null;
    /** True when the figure is the trip pooled across goings, not today's. */
    drawIvPooled: boolean;
    /**
     * A horse in the same race the score rated higher, and what the funnel
     * failed it on. Printed, because it argues against our selection.
     */
    topSetAside: { horse: string; by: number; why: string | null; others: number } | null;
  }
  const picks: Candidate[] = [];

  // --hotd: every scored runner, not just the top of each race.
  //
  // Dan, 2026-09-03: "who is the best draw, most suited to running style of the
  // track, best handicapped, goes on ground horse of the day?"
  //
  // Four conditions at once, and the horse that satisfies all four is not
  // necessarily the top scorer in its own race — the score weighs a dozen other
  // things. So this mode looks at every runner in every eligible race and ranks
  // on those four alone.
  const handPicks = loadHandPicks();

  const HOTD = process.argv.includes("--hotd");
  const everyRunner: any[] = [];

  for (const ra of races) {
    const live = (byRace.get(ra.id) ?? []).filter((r) => !r.isNonRunner);
    if (live.length < 5) continue;

    // The mark the horse is actually running off.
    //
    // `ofr` goes stale the moment a horse is reassessed for a win — the new
    // figure reaches the weights before it reaches the rating field. On
    // 8 October that understated NOSTRUM by 5lb and ONE NIGHT THUNDER by 10lb,
    // and both were selected BECAUSE the stale mark matched the mark they last
    // won off. The bias runs at us: it only flatters recent winners, and
    // "won last time out" is one of our positive signals.
    //
    // Done here, before scoring, so the handicap angle, the gates, the printed
    // figure and the mark check all see the same number.
    const shape = (r: any) => ({ ofr: r.ofr, weightLbs: r.weightLbs, claim: r.claim });
    const fieldShape = live.map(shape);
    for (const r of live) {
      const m = readMark(fieldShape, shape(r));
      if (m.effective !== null && m.drift) {
        r.ofrPublished = r.ofr;
        r.ofr = m.effective;
        r.ofrDrift = m.drift;
      }
    }

    // A race nobody has priced is a race nobody has declared.
    //
    // 2026-10-05: NIFFLER reached the top five as selection 4 with "no price"
    // beside it. The 16:25 Pontefract had nine runners, no racecard numbers, no
    // jockeys on most of them and not one bookmaker price — The Racing API had
    // re-issued the race under a new id at 16:56 with six declared, and the
    // stale entry stayed on our card looking like a race.
    //
    // Nothing caught it. The staking line reads the price we print, and "no
    // price" is not a price, so there was nothing to check against; preflight's
    // real-runners check asks whether the horse is declared and withdrawn, not
    // whether the race is. A selection we cannot quote a price for is not a bet
    // we can advise, whatever the reason.
    if (!live.some((r) => r.priceDec != null)) continue;
    // Only races that pass the filters — the best bets come from the handicaps
    // the method is built for, not from every race on the card.
    // A hand pick brings its race in with it.
    //
    // Dan, 2026-10-09, naming KING'S SCHOLAR as the NAP: the race is a novices'
    // hurdle, so `filterRace` dropped it before anything was scored and the
    // pick could never reach the five however it was written. He had asked for
    // a NAP and got a write-up. The filter exists to keep the MODEL inside the
    // handicaps it was built for; it has no business overruling a selection
    // Dan has made himself.
    const handHere = handPickFor(handPicks, date, String(ra.offTime), String(ra.courseName));
    if (!handHere &&
        !filterRace({ raceName: ra.name, ageBand: ra.ageBand, raceClass: ra.raceClass },
          live.map((x) => ({ age: x.age, isNonRunner: x.isNonRunner }))).eligible) continue;

    const raceToday: RaceToday = {
      courseSlug: ra.courseSlug, distanceF: ra.distanceF,
      // Score against the projected going. This is the edge: the market prices
      // off the published going for hours after rain has fallen.
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
      // Prefer the projected going, fall back to the declared one, and fall
      // back again to the trip pooled across goings. All three levels, and the
      // rule that a pooled figure is never printed as if measured on today's
      // ground, live in lib/draw.ts — shared, because this ladder and the one
      // in write-ups.ts were separate copies and disagreed on the 17:17 Redcar.
      const projBand = bandAtOff(goingProjection.get(String(ra.courseName)), ra.offTime)
        ?? ra.goingBand ?? "unknown";
      const read = readDraw(drawMap, {
        courseSlug: ra.courseSlug, distanceF: ra.distanceF,
        draw: r.draw, fieldSize: live.length,
        projected: projBand, declared: ra.goingBand ?? "unknown",
      });
      const iv = read.iv;
      const ivBand = read.goingBand;
      const ivPooled = read.pooled;
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
      return { r, h, s, paceIv: pIv, habit, habitSeen: bn,
               hcap: wellHandicapped(today, raceToday, h, date),
               style: runStyleHabit(h.map((x) => x.comment)).style,
               drawIv: iv, drawIvBand: ivBand, drawIvPooled: ivPooled };
    });

    if (HOTD) {
      for (const x of scored) {
        everyRunner.push({
          race: ra, field: live.length, band: raceToday.goingBand,
          r: x.r, h: x.h, s: x.s, hcap: x.hcap, style: x.style,
          drawIv: x.drawIv, drawIvBand: x.drawIvBand, drawIvPooled: x.drawIvPooled,
          paceIv: x.paceIv, habit: x.habit, habitSeen: x.habitSeen,
          groundFail: groundGate(x.h, raceToday.goingBand),
        });
      }
    }

    // Same tie-break as the write-ups, so the two agree on who tops a race.
    scored.sort(
      (a, b) => b.s.score - a.s.score || String(a.r.horseName).localeCompare(String(b.r.horseName))
    );
    // A hand pick replaces the model's choice in its own race. See
    // lib/hand-picks.ts for why this is not the same as vetoing the top scorer.
    const hand = handHere;
    const handRunner = hand
      ? scored.find((x) => String(x.r.horseName).toUpperCase() === hand.horse.toUpperCase())
      : undefined;
    if (hand && !handRunner) {
      console.error(`  PICKS.txt: ${hand.horse} is not a declared runner in the ${hand.time} ${hand.course}`);
    }

    /* ------------------------------------------------- the funnel, per runner
     *
     * Dan, 2026-10-14: "it's starting to annoy me today how out of 100 races
     * only 2 horses fit the criteria and one of them is 50/1."
     *
     * He was right, and the cause was the order these two steps ran in. This
     * line used to read `const best = handRunner ?? scored[0]` — the single
     * highest-scoring horse in the race — and the funnel was applied to that
     * one horse afterwards. So a card of 100+ races was only ever tested 14
     * horses deep, one per race, and a race was discarded whole whenever its
     * top scorer happened to fail. GUNFIGHTER failing on 3lb took the entire
     * 17:30 Kempton with it, including any horse in that race 10lb well in,
     * proven at the trip and drawn on the right side.
     *
     * That is backwards from the method. The method is: find the horses that
     * are well handicapped, go on the ground and have won at the distance —
     * then rank them. The score ranks the qualifiers; it does not choose the
     * candidate the criteria then vet.
     *
     * So the hard tests run on every runner here, and the race offers up its
     * best SURVIVOR. Where nothing survives, the top scorer still goes forward
     * to be set aside downstream, so the set-aside report keeps naming a horse
     * and a reason rather than silently dropping the race.
     */
    const isFlatRace = String(ra.raceType ?? "").toLowerCase() === "flat";
    const funnelFail = (x: (typeof scored)[number]): string | null => {
      if (groundGate(x.h, raceToday.goingBand) !== null) return "ground";
      if (streakGate(x.h, x.r.ofr ?? null, ra.raceType ?? null) !== null) return "streak";
      // x.r.ofr has already been corrected from the weights, so this compares
      // the mark the horse is really running off. See lib/marks.ts.
      if (markGate(x.h, x.r.ofr ?? null, ra.raceType ?? null, String(ra.name ?? "")) !== null)
        return "mark";
      if (!likesConditions(raceToday, x.h).trip) return "trip";
      // A horse with no draw figure is not failed for it — failing the untested
      // would empty the card by absence rather than by evidence.
      if (isFlatRace && x.drawIv !== null && x.drawIv < DRAW_AGAINST) return "draw";
      return null;
    };
    // chooseFromRace() holds the two rules that keep this from becoming the
    // mirror-image bug — a survivor still needs a positive score, and a race
    // with no survivor still reports one. See lib/funnel.ts.
    const choice = chooseFromRace(scored, funnelFail, (x) => x.s.score);
    const best = handRunner ?? choice.chosen;
    if (!best || (!handRunner && best.s.score <= 0)) continue;

    // An inconvenient fact, so it gets printed: a horse the score liked more
    // than ours is in this race and was set aside. House rule — anything that
    // argues against a selection is stated whether or not it moved the score.
    const outranked = handRunner
      ? scored.filter((x) => x !== best && x.s.score > best.s.score)
          .map((x) => ({ item: x, by: x.s.score - best.s.score, why: funnelFail(x) }))
      : choice.outranked;
    const topSetAside = outranked.length
      ? {
          horse: String(outranked[0].item.r.horseName),
          by: outranked[0].by,
          why: outranked[0].why,
          others: outranked.length - 1,
        }
      : null;

    picks.push({
      race: ra, r: best.r, score: best.s.score,
      // A hand pick is ranked on what the RACE is worth, not on its own score,
      // so it holds the slot the selection it replaced would have held. Dan
      // asked for Look Back Smiling to replace Starliner in the five; ranking
      // it on its own 6 points would simply drop it off the list, which is not
      // a replacement, it is a deletion. Its own score is still what gets
      // printed — the file should not pretend the model rated it highly.
      rankScore: handRunner ? scored[0].s.score : best.s.score,
      // How clear-cut the race is, measured against the best OTHER runner in
      // it — not against scored[1]. Now that the pick can be the third-best
      // scorer, scored[1] may be the pick itself, and an ineligible rival is
      // still a rival on the track: it can still beat us. A pick that the
      // score ranks third therefore has a negative `clear` and the standout
      // penalty docks it, which is correct. It must not become a NAP on the
      // strength of being the best of what was left.
      clear: (() => {
        const others = scored.filter((x) => x !== best);
        return others.length ? best.s.score - others[0].s.score : best.s.score;
      })(),
      topSetAside,
      field: live.length, hcap: best.hcap, signals: best.s.signals,
      handPick: handRunner && hand ? { horse: hand.horse, reason: hand.reason } : null,
      handPickNap: Boolean(handRunner && hand?.nap),
      groundRecord: best.s.groundRecord,
      groundFail: groundGate(best.h, raceToday.goingBand),
      streakFail: streakGate(best.h, best.r.ofr ?? null, ra.raceType ?? null),
      // `best.r.ofr` has already been corrected from the weights above, so this
      // compares the mark the horse is really running off.
      markFail: markGate(best.h, best.r.ofr ?? null, ra.raceType ?? null, String(ra.name ?? "")),
      // Dan's funnel, 2026-10-14: "handicap and ground is key along with having
      // won at the distance. Hurdles and jumps we should add course form as a
      // plus mark as well as ground and winning at the distance. With flat,
      // draw has to play a role."
      //
      // `trip` is a WIN within half a furlong of today's distance, which is
      // what "won at the distance" means. `courseWins` is wins at this track.
      wonAtTrip: likesConditions(raceToday, best.h).trip,
      courseWins: likesConditions(raceToday, best.h).courseWins,
      isFlat: String(ra.raceType ?? "").toLowerCase() === "flat",
      goingBand: raceToday.goingBand,
      draw: best.r.draw ?? null, drawIv: best.drawIv ?? null,
      drawIvBand: best.drawIvBand ?? null,
      drawIvPooled: best.drawIvPooled ?? false,
      pace: racePaceShape(scored.map((x) => x.style)).verdict,
    });
  }

  // A severe track-style mismatch is a gate, not a minus.
  //
  // Dan, 2026-08-28:
  //   "if the track is against the way a horse runs why would it make best
  //    bets?"
  //
  // The right answer is that it should not, however many positives it has
  // accumulated. The positives describe the horse; this describes whether it
  // can run its race here at all. The model already treats "well handicapped"
  // as a gate rather than a score component, and this belongs in the same
  // category. Such horses stay in the write-ups — the site commits to every
  // race — but they are not put forward as one of the five.
  const severeStyle = (p: (typeof picks)[number]) =>
    p.signals.some(
      (sg: any) => sg.key === "pace-against" && /wins only 0\.[0-4]\d?x/.test(sg.detail ?? "")
    );

  // And the ones Dan has taken out by hand, for the day being generated.
  const vetoes = loadVetoes(date);

  // Fields of seventeen and over.
  //
  // Dan, 2026-09-02: "based on the results, are there any patterns we are
  // missing." This is the one the data shouted about.
  //
  //   window          all races        excluding 17+     the 17+ alone
  //   Mar-Jun 2026    2,314  -3.4%     2,186  -1.4%      128  -37.8%
  //   Sep-Feb 2026    3,229  -5.3%     3,129  -4.0%      100  -46.2%
  //
  // Both windows, 228 bets, roughly -42%. The model simply does not work in a
  // big field: the strike rate falls to 4.7% and 7.0% against a 15% average.
  //
  // It has to be a gate rather than a weight, and that took a measurement to
  // see. Field size is identical for every horse in a race, so weighting it
  // shifts every score equally and cannot change which horse is picked — tried
  // at 1, 2 and 3 and the ROI did not move a single decimal place. It says
  // which races to leave alone, not which horse to back.
  // Thirteen, not seventeen.
  //
  // Dan, 2026-09-02: "at the end of the day, with all the data we have, we have
  // to run the most profitable model."
  //
  // Sweeping the cap across both windows says the same thing twice: the model
  // is a small-field model and we have been betting it everywhere.
  //
  //   cap        window A              window B              average
  //   all       2,314  15.3%  -2.7%   3,229  15.2%  -4.6%    -3.7%
  //   under 17  2,186  15.9%  -1.4%   3,129  15.5%  -4.0%    -2.7%
  //   under 13  1,598  17.6%  -1.9%   2,338  17.3%  +2.1%    +0.1%
  //   under 10    822  20.7%  +2.8%   1,241  19.4%  -1.1%    +0.9%
  //
  // Under 10 has the better average but is negative in the second window and
  // throws away two thirds of the card. Under 13 is the honest choice: the
  // average turns positive, it is positive outright in one window, and it
  // still leaves enough races to find five bets a day.
  //
  // Neither is a claim of profit. These are SP figures and the edge we have
  // measured is against the closing line, not the starting price.
  const BIG_FIELD = 13;
  const bigField = (p: (typeof picks)[number]) => p.field >= BIG_FIELD;

  // ------------------------------------------------------------------------
  // --hotd — the four-factor horse of the day.
  //
  // Dan asked for one horse that is all four things at once: best drawn, run
  // style suited to the track, best handicapped, and proven on the ground. Each
  // is a hard requirement here rather than a weight, because "mostly drawn well"
  // is not what was asked. What comes out is usually a very short list, and some
  // days it is empty — which is the honest answer on a day when no horse is all
  // four.
  // ------------------------------------------------------------------------
  if (HOTD) {
    const FAV_DRAW = 1.15;   // wins its share by 15%+
    const FAV_PACE = 1.15;   // its habitual run style does the same here

    // The funnel, before the answer. A bare "0 of 180" could mean the day is
    // genuinely bare or that one of the four is never available — and those
    // need completely different responses.
    const passes = {
      handicapped: (x: any) => x.hcap.qualifies,
      ground:      (x: any) => x.groundFail === null && x.s.signals.some((g: any) => g.key === "going"),
      draw:        (x: any) => x.drawIv !== null && x.drawIv >= FAV_DRAW,
      pace:        (x: any) => x.paceIv !== null && x.paceIv >= FAV_PACE,
    };
    const haveData = {
      draw: everyRunner.filter((x) => x.drawIv !== null).length,
      pace: everyRunner.filter((x) => x.paceIv !== null).length,
    };

    const rows = everyRunner
      .filter((x) => x.hcap.qualifies)                       // well handicapped
      .filter((x) => x.groundFail === null)                  // no ground objection
      .filter((x) => x.s.signals.some((g: any) => g.key === "going")) // proven on it
      .filter((x) => x.drawIv !== null && x.drawIv >= FAV_DRAW)
      .filter((x) => x.paceIv !== null && x.paceIv >= FAV_PACE)
      .map((x) => ({
        ...x,
        // Ranked on the three measured edges multiplied together, then by how
        // well handicapped. Multiplying rather than adding is deliberate: a
        // horse that is merely fine on two of them should not out-rank one that
        // is strong on both.
        edge: (x.drawIv as number) * (x.paceIv as number),
      }))
      .sort((a, b) => b.edge - a.edge || b.hcap.lbsInHand - a.hcap.lbsInHand);

    // --race=HH:MM — one race, every runner, on the same four factors.
    //
    // Dan, 2026-09-03: "compare that horse with the other runners in its race,
    // what do you think beats it." A selection is only as good as what it is
    // beating, and the four factors are worth nothing in isolation if a rival
    // has all of them too.
    const wantRace = process.argv.find((a) => a.startsWith("--race="))?.split("=")[1];
    if (wantRace) {
      const field = everyRunner
        .filter((x) => String(x.race.offTime) === wantRace)
        .sort((a, b) => b.s.score - a.s.score
          || (b.hcap.lbsInHand ?? 0) - (a.hcap.lbsInHand ?? 0));

      if (!field.length) {
        say(`No qualifying race at ${wantRace}.`);
        console.log(out.join("\n"));
        await client.end();
        return;
      }

      const r0 = field[0].race;
      say("=".repeat(72));
      say(`${r0.offTime} ${r0.courseName} — ${r0.distRound} · ${String(field[0].band).replace("-", " to ")} · ${field[0].field} runners`);
      say(String(r0.name ?? ""));
      say("=".repeat(72));
      say();

      for (const x of field) {
        const going = x.s.signals.find((g: any) => g.key === "going");
        const neg = x.s.signals.filter((g: any) => g.weight < 0);
        const pos = x.s.signals.filter((g: any) => g.weight > 0).map((g: any) => g.label);

        say("-".repeat(72));
        say(`${String(x.r.horseName).toUpperCase()}   ${x.r.priceFrac ?? "no price"}   score ${x.s.score}`);
        say(`   ${x.r.trainerName ?? "?"} / ${x.r.jockeyName ?? "?"}${x.r.claim ? ` (${x.r.claim})` : ""}   OR ${x.r.ofr ?? "?"}${x.r.ofrDrift ? ` (racecard says ${x.r.ofrPublished}; the weights say ${x.r.ofr})` : ""}   drawn ${x.r.draw ?? "?"}`);
        say(`   HANDICAP  ${x.hcap.qualifies ? `${x.hcap.lbsInHand}lb in hand${x.hcap.standout ? " — STANDOUT" : x.hcap.prime ? " — PRIME" : ""}` : "not well handicapped on our reading"}`);
        if (x.hcap.reasons?.length) say(`             ${humanise(x.hcap.reasons[0])}`);
        say(`   GROUND    ${x.groundFail ? `RULED OUT — ${x.groundFail}` : (going?.detail ?? "no proven form on this ground")}`);
        say(`             ${x.s.groundRecord}`);
        say(`   DRAW      ${x.drawIv === null ? "no data for this course, trip and ground" : `${(x.drawIv as number).toFixed(2)}x its share`}`);
        say(`   PACE      ${x.habit ? `usually ${x.habit} (${x.habitSeen} of 5)` : "no settled style"}${
          x.paceIv === null ? "" : ` — ${(x.paceIv as number).toFixed(2)}x its share here`}`);
        if (pos.length) say(`   +         ${pos.join(", ")}`);
        for (const n of neg) say(`   !         ${n.label}: ${n.detail}`);
        say();
      }

      say("=".repeat(72));
      console.log(out.join("\n"));
      await client.end();
      return;
    }

    say("=".repeat(72));
    say(`HORSE OF THE DAY — ${date}`);
    say("=".repeat(72));
    say();
    say("Every runner in every qualifying handicap, filtered to those that are");
    say("ALL of: well handicapped, proven on today's ground, drawn on the");
    say(`favoured side (IV ${FAV_DRAW}+), and running the style this track and`);
    say(`trip rewards (IV ${FAV_PACE}+).`);
    say();
    say(`${everyRunner.length} runners considered, ${rows.length} met all four.`);
    say();
    say("  each condition on its own:");
    for (const [k, fn] of Object.entries(passes))
      say(`    ${k.padEnd(13)} ${String(everyRunner.filter(fn as any).length).padStart(4)}`);
    say(`  runners with any draw figure at all: ${haveData.draw}`);
    say(`  runners with any pace figure at all: ${haveData.pace}`);
    say();

    // How far the day gets before it runs out.
    const names = Object.keys(passes) as (keyof typeof passes)[];
    const near = everyRunner
      .map((x) => ({ x, met: names.filter((n) => passes[n](x)) }))
      .filter((z) => z.met.length === 3)
      .sort((a, b) => b.x.hcap.lbsInHand - a.x.hcap.lbsInHand);
    if (!rows.length && near.length) {
      say(`  ${near.length} runners meet three of the four:`);
      for (const z of near.slice(0, 8)) {
        const missing = names.filter((n) => !z.met.includes(n))[0];
        say(`    ${String(z.x.r.horseName).toUpperCase().padEnd(20)} ${z.x.race.offTime} ${String(z.x.race.courseName).padEnd(12)} missing: ${missing}`);
      }
      say();
    }

    // Where the draw actually tops out, so "nothing qualifies" can be read as a
    // number rather than taken on trust.
    const drawn = everyRunner.filter((x) => x.drawIv !== null)
      .sort((a, b) => (b.drawIv as number) - (a.drawIv as number));
    if (drawn.length) {
      say("  best draw figures on the card:");
      for (const x of drawn.slice(0, 5))
        say(`    ${(x.drawIv as number).toFixed(4)}x  ${String(x.r.horseName).toUpperCase().padEnd(20)} ${x.race.offTime} ${x.race.courseName}`);
      say();
    }

    if (!rows.length) {
      say("Nothing is all four things today. That is the answer, not a gap —");
      say("forcing a selection by dropping one of the four would be inventing one.");
    }

    // When nothing is all four, show the ones that are three — with the same
    // evidence, and the missing leg named. That is more use than a shrug.
    const show = rows.length ? rows.slice(0, 6) : near.slice(0, 3).map((z) => ({
      ...z.x, edge: (z.x.drawIv ?? 0) * (z.x.paceIv ?? 0),
      missing: (Object.keys(passes) as string[]).filter((n) => !z.met.includes(n as any))[0],
    }));

    show.forEach((x: any, i: number) => {
      const going = x.s.signals.find((g: any) => g.key === "going");
      say("-".repeat(72));
      say(`${i + 1}. ${String(x.r.horseName).toUpperCase()}    ${x.r.priceFrac ?? "no price"}${x.missing ? "   [3 of 4]" : ""}`);
      say(`   ${x.race.offTime} ${x.race.courseName} · ${x.race.distRound} · ${String(x.band).replace("-", " to ")} · ${x.field} runners`);
      say(`   ${x.r.trainerName ?? "?"} / ${x.r.jockeyName ?? "?"}${x.r.claim ? ` (${x.r.claim})` : ""}`);
      say();
      say(`   DRAW      ${x.r.draw} of ${x.field} — ${
        drawPhrase({ iv: x.drawIv, goingBand: x.drawIvBand, pooled: x.drawIvPooled })
        ?? "no draw data for this course, trip or ground"}`);
      say(`   PACE      ${x.habit ? `usually ${x.habit} (${x.habitSeen} of its last 5)` : "no settled run style"}${
        x.paceIv === null ? " — no pace data for this course and trip"
        : ` — ${x.habit} wins ${(x.paceIv as number).toFixed(2)}x its share over this course and trip`}`);
      say(`   HANDICAP  ${x.hcap.lbsInHand}lb in hand${x.hcap.standout ? " — STANDOUT" : x.hcap.prime ? " — PRIME" : ""}`);
      if (x.hcap.reasons?.length) say(`             ${humanise(x.hcap.reasons[0])}`);
      say(`   GROUND    ${going?.detail ?? ""}`);
      say(`             ${x.s.groundRecord}`);
      say();
      if (x.missing) say(`   MISSING   ${x.missing} — meets the other three`);
      say(`   Model score ${x.s.score}`);
      say();
    });

    say("=".repeat(72));
    say("18+ · Please gamble responsibly · BeGambleAware.org");
    console.log(out.join("\n"));
    await client.end();
    return;
  }

  // Dan's ground rule. See groundGate() in lib/selection.ts for what it is and
  // what it costs. Applied after the hand vetoes so a horse is only reported
  // under one heading.
  const wrongGround = (p: (typeof picks)[number]) => p.groundFail !== null;

  const gated = picks.filter(severeStyle);
  const rest = picks.filter(
    (p) => !severeStyle(p) && !isVetoed(vetoes, String(p.r.horseName))
  );
  const vetoed = picks.filter(
    (p) => !severeStyle(p) && isVetoed(vetoes, String(p.r.horseName))
  );
  // Dan's streak rule. See streakGate() in lib/selection.ts.
  const onAStreak = (p: (typeof picks)[number]) => p.streakFail !== null;

  // Dan's mark rule. A handicapper above the mark it last won off is not a
  // well-handicapped horse, which is the whole method. See markGate().
  const aboveItsMark = (p: (typeof picks)[number]) => p.markFail !== null;

  /* ------------------------------------------------------------- the funnel
   *
   * Dan, 2026-10-14: "handicap and ground is key along with having won at the
   * distance. Hurdles and jumps we should add course form as a plus mark as
   * well as ground and winning at the distance. With flat, draw has to play a
   * role."
   *
   * This was always the model. It has been in this file since the start as the
   * --hotd funnel and the daily five was wired to a different path, where the
   * handicap angle was one weighted signal among draw, pace, booking and yard
   * form. That is how a horse 12lb above its winning mark became a NAP, four
   * times in ten days, each one caught by Dan reading the card.
   *
   * Hard for every runner: won at the distance. Handicap and ground are already
   * hard above — markGate and groundGate.
   *
   * Flat only: the draw must not be against us where we have a figure. A horse
   * with no draw data is not failed for it — only 32 of 144 runners had a draw
   * figure on 14 October, so failing the untested would empty the card by
   * absence rather than by evidence.
   *
   * Jumps: course form is a PLUS, not a gate, exactly as asked — it ranks, it
   * does not exclude.
   */
  const notWonAtTrip = (p: (typeof picks)[number]) => !p.wonAtTrip;
  const drawnBadly = (p: (typeof picks)[number]) =>
    p.isFlat && p.drawIv !== null && p.drawIv < DRAW_AGAINST;

  const offGround = rest.filter(wrongGround);
  const streaky = rest.filter((p) => !wrongGround(p) && onAStreak(p));
  const aboveMark = rest.filter((p) => !wrongGround(p) && !onAStreak(p) && aboveItsMark(p));
  const wrongTrip = rest.filter(
    (p) => !wrongGround(p) && !onAStreak(p) && !aboveItsMark(p) && notWonAtTrip(p)
  );
  const badDraw = rest.filter(
    (p) => !wrongGround(p) && !onAStreak(p) && !aboveItsMark(p) && !notWonAtTrip(p) && drawnBadly(p)
  );
  // A hand pick is not set aside for a big field.
  //
  // Dan, 2026-10-10, choosing VOLENTI: told that its race had 14 runners and
  // that our picks in fields of 13+ lose, he picked it anyway. That is the
  // whole point of a hand pick — the field-size rule guards the MODEL from
  // races it cannot read, and it was still quietly removing a horse Dan had
  // named. He was shown the number and made the call.
  //
  // The GATES are a different matter and still apply: the ground rule and the
  // streak gate stop a hand pick like anything else, because those are Dan's
  // own editorial lines rather than guards on the model.
  const crowded = rest.filter(
    (p) => !wrongGround(p) && !onAStreak(p) && !aboveItsMark(p) && !notWonAtTrip(p) &&
      !drawnBadly(p) && bigField(p) && !p.handPick
  );
  const eligible = rest.filter(
    (p) => !wrongGround(p) && !onAStreak(p) && !aboveItsMark(p) && !notWonAtTrip(p) &&
      !drawnBadly(p) && (!bigField(p) || Boolean(p.handPick))
  );

  // Strength first, decisiveness second — but decisiveness is not a tiebreak.
  //
  // Dan, 2026-10-04: "a NAP needs to be the stand out selection in the race. If
  // it's close to another runner in the race then it must be marked down."
  //
  // `clear` was only separating equal scores, so a 14 that was one point ahead
  // of the second-best horse in its own race outranked a 13 that was five
  // clear. That is backwards: the first is a race we can barely split and the
  // second is one we can. On 5 October it made CAPE ASHIZURI the NAP on 14
  // points and one clear, in a race its own write-up warned about on the draw
  // and the pace.
  //
  // The penalty is in the same unit as the score, so it reads off the printed
  // figures: a horse two clear gives up a point, one clear gives up two, and
  // level or behind gives up three. A hand pick can be behind the top-rated in
  // its race, which is a deliberate override and takes the full deduction.
  // A hand pick marked NAP goes first, whatever it scored. Everything else is
  // ranked as usual beneath it. Dan names the horse of the day; the model ranks
  // the rest.
  const top = eligible
    .map((p) => ({ p, standout: p.rankScore - standoutPenalty(p.clear) }))
    .sort(
      (a, b) =>
        // A hand pick marked NAP leads.
        Number(b.p.handPickNap ?? false) - Number(a.p.handPickNap ?? false) ||
        // Then every other hand pick, above anything the model chose.
        //
        // Dan, 2026-10-10, naming five horses: "lets run with those 5." A hand
        // pick that has to out-score the model to reach the card is not an
        // override, it is a suggestion — and these five were chosen precisely
        // because the model did not rate them. If he has named a horse it is
        // on the card; the model ranks what is left.
        Number(Boolean(b.p.handPick)) - Number(Boolean(a.p.handPick)) ||
        b.standout - a.standout ||
        // Over jumps, course form is the tie-breaker Dan asked for: a plus
        // mark, not a gate. On the Flat the draw has already done that work.
        (a.p.isFlat || b.p.isFlat ? 0 : b.p.courseWins - a.p.courseWins) ||
        b.p.clear - a.p.clear ||
        String(a.p.r.horseName).localeCompare(String(b.p.r.horseName))
    )
    .slice(0, N)
    .map((x) => x.p);

  // HRT_STANDOUT_COMPARE=1 prints what the old score-only order would have
  // been, so the change can be measured over past cards instead of argued
  // about. It writes to stderr and never touches the published file.
  if (process.env.HRT_STANDOUT_COMPARE) {
    const before = [...eligible]
      .sort((a, b) => b.rankScore - a.rankScore || b.clear - a.clear ||
        String(a.r.horseName).localeCompare(String(b.r.horseName)))
      .slice(0, N);
    const fmt = (p: any) => `${String(p.r.horseName).toUpperCase()} (${p.rankScore}pts, ${p.clear} clear)`;
    console.error(`COMPARE ${date}`);
    console.error(`  was: ${before.map(fmt).join(" | ")}`);
    console.error(`  now: ${top.map(fmt).join(" | ")}`);
    console.error(`  nap ${before[0] && top[0] && before[0].r.horseName === top[0].r.horseName ? "unchanged" : "CHANGED"}`);
  }

  /* -------------------------------------------------------------- output */

  const d = new Date(date + "T12:00:00Z");
  const pretty = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  say(`TOP ${N} BEST BETS — ${pretty.toUpperCase()}`);
  say("=".repeat(72));
  say();
  say(`One selection per race, from ${picks.length} qualifying handicaps.`);
  say("Staking: 1pt win at 5/1 and under, 0.5pt each-way at 11/2 and bigger.");

  const wet = [...goingProjection.values()].filter((g) => g.changed);
  if (wet.length) {
    say("");
    say("Going watch — rain has moved the ground on these cards, and the");
    say("selections below are made on the projected going, not the declared:");
    for (const g of wet) {
      const offs = races.filter((r: any) => String(r.courseName) === g.course)
        .map((r: any) => String(r.offTime));
      const drift = changesDuringCard(g, offs);

      say(
        `  ${g.course}: ${g.declared ?? "?"} declared, ${g.rain.beforeRacing.toFixed(0)}mm since yesterday, ` +
        `reading it as ${g.projectedBand.replace("-", " to ")}` +
        (drift ? ` (${drift.from.replace("-", " to ")} first race, ${drift.to.replace("-", " to ")} last).` : ".")
      );
    }
  }
  say(`Ranked by the weight of evidence, then by how clear-cut the race is.`);
  say(`Prices are best available at the time of writing and will move.`);
  say();

  top.forEach((p, i) => {
    const price = p.r.priceFrac ?? (p.r.priceDec ? p.r.priceDec.toFixed(1) : "no price");
    say("-".repeat(72));
    const bet = betFor(p.r.priceDec ?? null);
    const terms = bet.type === "ew" ? placeTerms(p.field, true) : null;
    say(`${i + 1}. ${String(p.r.horseName).toUpperCase()}    ${price}    ${bet.label}${terms ? ` (${terms.label})` : ""}`);
    // Going is null on some cards until the morning declarations land. Drop the
    // segment rather than printing "null" — an absent going is information, the
    // word "null" is a bug the reader has to interpret.
    // Show the ground the selection was actually made on. Printing the declared
    // going next to a header saying we read it differently is just confusing.
    const proj = goingProjection.get(String(p.race.courseName));
    const groundLabel = proj?.changed
      ? `${p.race.going ?? "?"} → ${proj.projectedBand.replace("-", " to ")}`
      : p.race.going || null;

    const head = [
      `${p.race.offTime} ${p.race.courseName}`,
      p.race.distRound,
      groundLabel,
      `${p.field} runners`,
    ].filter(Boolean).join(" · ");
    say(`   ${head}`);
    say(`   ${String(p.race.name).slice(0, 60)}`);
    say(`   ${p.r.trainerName ?? "?"} / ${p.r.jockeyName ?? "?"}${p.r.claim ? ` (${p.r.claim})` : ""}`);
    say();
    if (p.draw !== null && p.draw > 0 && p.field >= 6) {
      const iv = p.drawIv;
      // Never print a pooled figure as though it were measured on today's
      // ground. drawPhrase() says "over this trip, across all goings" for one.
      const phrase = drawPhrase({ iv, goingBand: p.drawIvBand, pooled: p.drawIvPooled });
      say(
        `   Drawn ${p.draw} of ${p.field}` +
        (iv !== null && phrase
          ? ` — that side wins ${phrase}${
              iv <= 0.85 ? ", against it" : iv >= 1.3 ? ", in its favour" : ""
            }`
          : " — no draw data for this course, trip or ground")
      );

      // Dan's sheet as a second opinion on the draw, not a replacement.
      //
      // Ours is computed from our own database per course, surface, trip and
      // going; his runs Jun 2023 to Jun 2026 on a coarser split. They usually
      // agree. Where they do not, that is worth a line — two sources pointing
      // opposite ways is a reason to look harder at the race, and quietly
      // picking a favourite between them would hide exactly that.
      const sd = sheetDraw(
        courseGuide(String(p.race.courseName)),
        p.race.surface,
        p.race.distanceF ?? null
      );
      const mine = drawThird(p.draw, p.field);
      if (sd && mine) {
        const ours = p.drawIv;
        const oursFavours = ours !== null && ours >= 1.15;
        const oursAgainst = ours !== null && ours <= 0.85;
        if (sd.third === mine && !oursAgainst)
          say(`   Cheat sheet agrees — ${sd.text} at this trip (${sd.confidence.toLowerCase()} confidence)`);
        else if (sd.third !== mine && oursFavours)
          say(`   Cheat sheet disagrees — it has ${sd.text} at this trip, we make this side ${ours!.toFixed(2)}x`);
        else if (sd.third !== mine)
          say(`   Cheat sheet favours the ${sd.third} draw here (${sd.text}), and this is drawn ${mine}`);
      }
    }
    // A hand pick is usually not the top of its race, so "clear of the next" is
    // negative and reads as a typo. Say what is actually true instead.
    say(`   ${p.score} points, ${p.clear < 0
      ? `${Math.abs(p.clear)} behind the top-rated in the race`
      : `${p.clear} clear of the next in the race`}${
      p.hcap.qualifies ? `, ${p.hcap.lbsInHand}lb in hand` : ""}${
      p.hcap.standout ? "   [STANDOUT]" : p.hcap.prime ? "   [PRIME]" : ""}`);

    // A horse the score rated higher is in this race and the funnel set it
    // aside. That argues against our selection — the score is not the method,
    // but it is evidence, and a reader cannot judge the pick without knowing
    // the model's own favourite was removed and on what grounds.
    if (p.topSetAside) {
      const why = {
        ground: "not proven on this ground", streak: "on a winning run",
        mark: "above the mark it last won off", trip: "has not won at the distance",
        draw: "drawn against",
      }[String(p.topSetAside.why)] ?? "set aside";
      say(
        `   Note: ${p.topSetAside.horse.toUpperCase()} rates ${p.topSetAside.by} higher in this race` +
          ` and is set aside — ${why}` +
          (p.topSetAside.others ? `, as are ${p.topSetAside.others} other${p.topSetAside.others > 1 ? "s" : ""} above us` : "")
      );
    }

    // The standout says WHY it is one. A tag on its own is a label; the line
    // under it is the argument, and it is the argument that gets backed.
    if (p.hcap.standout) say(`   > ${p.hcap.standoutWhy}`);
    say();

    for (const why of p.hcap.reasons) say(`   * ${humanise(why)}`);
    const support = p.signals
      .filter((s) => s.weight > 0 && !["mark", "plot", "went-close", "won-easily"].includes((s as any).key))
      .map((s) => s.label);
    if (support.length) say(`   + ${support.join(", ")}`);
    const against = p.signals.filter((s) => s.weight < 0);
    for (const a of against) say(`   ! ${a.label}: ${a.detail}`);
    // Say when a selection is Dan's rather than the model's, and show the model
    // score beside it. Hiding the disagreement would make the file look like it
    // rated a horse it did not.
    if (p.handPick) {
      say(`   >> SELECTED BY HAND — the model rates this ${p.score}, not the top of its race`);
      say(`      ${p.handPick.reason}`);
    }

    // Printed for every selection, flattering or not. See HorseScore.groundRecord.
    if (p.groundRecord) say(`   Ground: ${p.groundRecord}`);

    // Dan's cheat sheet: what this track does on today's going, and the trap it
    // sets. Prose, not score — see lib/course-guide.ts. It is here so the horse
    // record above is read against the course rather than in the abstract.
    const cg = courseGuide(String(p.race.courseName));
    if (cg) {
      const band = p.goingBand;
      const note = goingNote(cg, band);
      if (note) say(`   ${cg.course} on ${String(band).replace("-", " to ")}: ${note}`);
      if (cg.trap) say(`   Trap here: ${cg.trap}`);
    }
    if (p.pace === "lone-leader") say(`   + Only one confirmed front-runner in the race`);
    if (p.pace === "collapse-likely") say(`   ! Several want to lead — the pace may collapse`);
    say();
  });

  // Same for a hand veto. Silently dropping a horse that scored well would
  // make the file look as though the model never rated it.
  if (vetoed.length) {
    say("-".repeat(72));
    say("SET ASIDE BY HAND");
    say();
    for (const v of vetoed.sort((a, b) => b.score - a.score)) {
      const why = isVetoed(vetoes, String(v.r.horseName));
      say(`${String(v.r.horseName).toUpperCase()}   ${v.race.offTime} ${v.race.courseName}`);
      say(`   ${why?.reason ?? ""}`);
      say(`   Scored ${v.score}, which would otherwise have made the five.`);
      say();
    }
  }

  // Dan's ground rule, stated 2026-09-01. Shown with the record that failed it,
  // because "wrong ground" on its own is an assertion and the record is the
  // argument.
  if (offGround.length) {
    say("-".repeat(72));
    say("SET ASIDE — not proven on this ground");
    say();
    for (const o of offGround.sort((a, b) => b.score - a.score)) {
      say(`${String(o.r.horseName).toUpperCase()}   ${o.race.offTime} ${o.race.courseName}`);
      say(`   ${o.groundFail}`);
      say(`   Ground: ${o.groundRecord}`);
      say(`   Scored ${o.score}, which would otherwise have made the five.`);
      say();
    }
  }

  if (streaky.length) {
    say("-".repeat(72));
    say("SET ASIDE — on a winning run");
    say();
    for (const x of streaky.sort((a, b) => b.score - a.score)) {
      say(`${String(x.r.horseName).toUpperCase()}   ${x.race.offTime} ${x.race.courseName}`);
      say(`   ${x.streakFail}`);
      say(`   Scored ${x.score}, which would otherwise have made the five.`);
      say();
    }
  }

  if (aboveMark.length) {
    say("-".repeat(72));
    say("SET ASIDE — above the mark it last won off");
    say();
    for (const x of aboveMark.sort((a, b) => b.score - a.score)) {
      say(`${String(x.r.horseName).toUpperCase()}   ${x.race.offTime} ${x.race.courseName}`);
      say(`   ${x.markFail}`);
      say(`   Scored ${x.score}, which would otherwise have made the five.`);
      say();
    }
  }

  if (wrongTrip.length) {
    say("-".repeat(72));
    say("SET ASIDE — has not won at the distance");
    say();
    for (const x of wrongTrip.sort((a, b) => b.score - a.score).slice(0, 6)) {
      say(`${String(x.r.horseName).toUpperCase()}   ${x.race.offTime} ${x.race.courseName}`);
      say(`   no win within half a furlong of today's ${x.race.distRound ?? x.race.distanceF + "f"}`);
      say(`   Scored ${x.score}, which would otherwise have made the five.`);
      say();
    }
  }

  if (badDraw.length) {
    say("-".repeat(72));
    say("SET ASIDE — drawn against on the Flat");
    say();
    for (const x of badDraw.sort((a, b) => b.score - a.score).slice(0, 4)) {
      say(`${String(x.r.horseName).toUpperCase()}   ${x.race.offTime} ${x.race.courseName}`);
      say(`   drawn ${x.r.draw} — that side wins ${Number(x.drawIv).toFixed(2)}x its share here`);
      say(`   Scored ${x.score}, which would otherwise have made the five.`);
      say();
    }
  }

  if (crowded.length) {
    say("-".repeat(72));
    say("SET ASIDE — too many runners");
    say();
    for (const c of crowded.sort((a, b) => b.score - a.score).slice(0, 4)) {
      say(`${String(c.r.horseName).toUpperCase()}   ${c.race.offTime} ${c.race.courseName}`);
      say(`   ${c.field} runners. Our picks in fields of ${BIG_FIELD}+ lose across both`);
      say(`   test windows; under ${BIG_FIELD} they average roughly break-even.`);
      say(`   Scored ${c.score}, which would otherwise have made the five.`);
      say();
    }
  }

  // Show what the gate removed. A selection kept out of the five for a stated
  // reason is more useful than one silently absent.
  if (gated.length) {
    say("-".repeat(72));
    say("SET ASIDE — the track is against the way these run");
    say();
    for (const g of gated.sort((a, b) => b.score - a.score).slice(0, 4)) {
      const sg = g.signals.find((x: any) => x.key === "pace-against");
      say(`${String(g.r.horseName).toUpperCase()}   ${g.race.offTime} ${g.race.courseName}`);
      say(`   ${sg?.detail ?? ""}`);
      say(`   Scored ${g.score}, which would otherwise have made the five.`);
      say();
    }
  }

  say("=".repeat(72));
  say(`18+ · Please gamble responsibly · BeGambleAware.org`);
  say(`Tips are opinion, not guarantees. Never bet more than you can afford to lose.`);
  say();

  console.log(out.join("\n"));
  await client.end();
}

main().catch((e) => { console.error("\nFailed:", e.message); process.exit(1); });
