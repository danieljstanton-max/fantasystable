/**
 * VIP note — a detailed case for one horse.
 *
 *   npm run vip -- 2026-08-28 16:38
 *   npm run vip -- 2026-08-28 16:38 "Bobby Bennu"
 *   npm run vip -- 2026-08-28 16:38 "Bobby Bennu" --stake "1pt each-way"
 *
 * The free write-ups commit to every race in three sentences. This is the paid
 * product: one horse, the full argument, and every figure traceable to a run in
 * the database.
 *
 * It builds the case the way a form book is actually read — dismiss the run
 * that misleads, lead on the run that matters, show the mark it was achieved
 * off against today's, then state the worry rather than hiding it. A paid note
 * that omits the negative is the one that loses the subscriber.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import postgres from "postgres";
import { readComment } from "../lib/form-reading";
import { betFor, placeTerms } from "../lib/staking";
import { isHandicap, drawDistBand } from "../lib/selection";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};

const ordinal = (n: number) =>
  n === 1 ? "won" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;

/** "Sat Jun 27" -> "27th June", which is how Dan writes a date. */
const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const longDate = (d: any) => {
  const t = new Date(String(d));
  if (Number.isNaN(t.getTime())) return String(d);
  const n = t.getUTCDate();
  const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd"
                : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${suffix} ${MONTHS[t.getUTCMonth()]}`;
};

const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => (n >= 1 && n <= 10 && Number.isInteger(n) ? WORDS[n] : String(n));

/** Margins the way they are spoken, not the way they are stored. */
const lengths = (n: number) => {
  if (n === 0) return "dead-heat";
  if (n <= 0.15) return "a nose";
  if (n <= 0.3) return "a head";
  if (n <= 0.45) return "a neck";
  if (n <= 0.6) return "half a length";
  if (n <= 0.85) return "three parts of a length";
  if (n <= 1.1) return "a length";
  if (n <= 1.35) return "a length and a quarter";
  if (n <= 1.6) return "a length and a half";
  if (n <= 1.85) return "a length and three quarters";
  const whole = Math.floor(n);
  const frac = n - whole;
  const half = frac >= 0.4 && frac <= 0.6 ? " and a half" : "";
  return `${word(whole)}${half} lengths`;
};

(async () => {
  const date = process.argv[2];
  const off = process.argv[3];
  const wanted = process.argv[4] && !process.argv[4].startsWith("--") ? process.argv[4] : null;

  if (!date || !off) {
    console.error('usage: npm run vip -- YYYY-MM-DD HH:MM ["Horse Name"] [--stake "1pt each-way"] [--save]');
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require" });

  const [race] = await sql`
    select ra.id, ra.name, ra.off_time "off", ra.course_name "course", ra.course_slug "slug",
           ra.distance_round "dist", ra.distance_f "df", ra.going, ra.going_band "gb",
           ra.race_class "cls", ra.age_band "age", ra.field_size "fs", ra.prize, ra.race_type "type",
           ra.rating_band "band"
    from races ra where ra.race_date = ${date} and ra.off_time = ${off}`;

  if (!race) { console.error(`No race at ${off} on ${date}`); process.exit(1); }

  const field = await sql`
    select r.horse_id "id", r.horse_name "name", r.ofr, r.draw, r.jockey_name "jk",
           r.jockey_claim_lbs "claim", r.trainer_name "tr",
           r.best_odds_frac "priceFrac", r.best_odds_dec "priceDec"
    from runners r where r.race_id = ${race.id} and r.is_non_runner = false
    order by r.best_odds_dec nulls last`;

  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const horse = wanted
    ? (field as any[]).find((r) => norm(r.name) === norm(wanted))
    : (field as any[])[0];

  if (!horse) {
    console.error(`"${wanted}" is not a declared runner. Field: ${(field as any[]).map((r) => r.name).join(", ")}`);
    process.exit(1);
  }

  const runs = (await sql`
    select ra.race_date "d", ra.course_name "c", ra.course_slug "slug", ra.distance_round "dist",
           ra.distance_f "df", ra.going, ra.going_band "gb", ra.race_class "cls",
           ra.field_size "fs", ra.name "raceName",
           r.position_num "pos", r.ofr, r.ovr_btn "btn", r.comment, r.sp
    from runners r join races ra on ra.id = r.race_id
    where r.horse_id = ${horse.id} and ra.race_date < ${date} and r.position is not null
    order by ra.race_date desc limit 60`) as any[];

  const today = Number(horse.ofr);
  const L: string[] = [];
  const say = (s = "") => L.push(s);

  /* ------------------------------------------------------------- header */
  //
  // Dan's own voice, from the note he wrote on 2026-08-28. First person,
  // flowing paragraphs, no section headings, the horse is "he". The earlier
  // version read as a report — right structure, wrong register, and the
  // register is what a subscriber is paying for.

  const price = horse.priceFrac ?? (horse.priceDec ? String(horse.priceDec) : "no price");
  const bet = betFor(horse.priceDec ? Number(horse.priceDec) : null);
  const terms = placeTerms(Number(race.fs), isHandicap(String(race.name)));
  const stake = arg("stake") ?? (bet.type === "ew" && terms ? `${bet.label}, ${terms.label}` : bet.label);
  const NAME = String(horse.name).toUpperCase();

  const tag = process.argv.includes("--nap") ? "NAP" : "VIP PLAY";
  say(`${tag} — ${race.off} ${race.course} — ${NAME} — ${price} — ${stake}`);
  say();

  /* ---------------------------------------------------------------------- *
   * The case, in two paragraphs.
   *
   * Dan rewrote one of these by hand on 2026-08-30 and the difference was not
   * the facts, it was the packing. The generated version put one fact in each
   * paragraph and ran to eight; his put the whole handicap case in the first
   * and the whole race-day case in the second, and read half as long while
   * saying more.
   *
   *   1  the recent form dismissed in a clause, the mark, and the evidence
   *      that the mark is generous — placed marks listed as bare numbers,
   *      wins off higher marks counted
   *
   *   2  the last run as it actually ran, the grade, the booking, the ground,
   *      and a conditional close rather than an instruction
   *
   * He also never itemises. "Placed off marks of 97, 99 and 87" replaces three
   * clauses each naming a course and a beaten distance.
   * ---------------------------------------------------------------------- */

  const inFrame = (r: any) => r.pos !== null && Number(r.pos) <= 3;
  const recent = runs.slice(0, 3);
  const poorRun = recent.filter((r) => !inFrame(r)).length;

  // Dan, 2026-09-01, on the Cosmos Raj NAP: "these write-ups don't make any
  // sense — he won the last race."
  //
  // He did, and the note opened "you can pretty much draw a line through the
  // last couple of runs because he just hasn't looked quite at the top of his
  // game". The count was right — two of the last three were out of the frame —
  // but counting the last three treats a win eight days ago the same as a win
  // eight months ago. Nothing about a horse's recent form can be dismissed
  // when the most recent thing it did was win.
  const wonLast = runs.length > 0 && Number(runs[0].pos) === 1;
  const lastInFrame = runs.length > 0 && inFrame(runs[0]);

  /* --------------------------------------------- paragraph 1: the handicap */
  const p1: string[] = [];

  if (wonLast) {
    p1.push(
      `He goes into this off the back of a win, and the handicapper has still ` +
      `left him with a chance.`
    );
  } else if (poorRun >= 2 && !lastInFrame) {
    p1.push(
      `I think you can pretty much draw a line through the last couple of runs because ` +
      `he just hasn't looked quite at the top of his game, but the handicapper has ` +
      `definitely given him a chance now.`
    );
  } else if (poorRun === 1 && !lastInFrame) {
    p1.push(
      `I'm happy to draw a line through the last run, and the handicapper has given ` +
      `him a chance here.`
    );
  }

  // The win that sets the mark, phrased as a gain rather than a report.
  // The win that sets the mark, from inside the last 18 months.
  //
  // Without a window this reaches for the highest mark a horse ever won off,
  // and a Class 2 win from September 2024 gets quoted as the reason it is well
  // treated today. That is the mistake wonOffHigherMark() already guards
  // against — four years of decline reading as a plot — and the same window
  // applies here. If nothing inside the window qualifies, the most recent win
  // is used instead, because a recent smaller win argues better than an old
  // big one.
  const wins = runs.filter((r) => Number(r.pos) === 1 && r.ofr !== null);
  const monthsBackFrom = (d: any) =>
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(String(d))) / 2_629_800_000;

  const recentWins = wins.filter((r) => monthsBackFrom(r.d) <= 18);
  const bestWin = recentWins.length
    ? recentWins.reduce((a, b) => (Number(b.ofr) > Number(a.ofr) ? b : a))
    : wins.length
    ? wins[0]
    : null;

  if (bestWin) {
    const diff = Number(bestWin.ofr) - today;
    const grade = bestWin.cls ? String(bestWin.cls) : "handicap";
    const where = String(bestWin.slug) === String(race.slug)
      ? `here at ${race.course}`
      : `at ${bestWin.c}`;

    // "Back in September" reads as five weeks ago when it is eleven months. The
    // year goes in once the win is far enough back to be a different season.
    const winDate = new Date(String(bestWin.d));
    const whenWon = MONTHS[winDate.getUTCMonth()] +
      (monthsBackFrom(bestWin.d) >= 10 ? ` ${winDate.getUTCFullYear()}` : "");

    p1.push(
      `He was winning a ${grade} ${where} off ${bestWin.ofr} back in ${whenWon}` +
      (diff > 0
        ? `, and gets in here off ${today}, so he's ${diff}lb lower now.`
        : diff === 0
        ? `, and runs off exactly the same mark today.`
        : `, and the handicapper has put him up ${Math.abs(diff)}lb since.`)
    );
  }

  // Placed off big marks, as bare numbers. Three clauses become one.
  const placedMarks = [
    ...new Set(
      runs
        .filter((r) => Number(r.pos) >= 2 && Number(r.pos) <= 3 && Number(r.ofr ?? -1) >= today)
        .map((r) => Number(r.ofr))
    ),
  ]
    .sort((a, b) => b - a)
    .slice(0, 4);

  const winsOffHigher = runs.filter((r) => Number(r.pos) === 1 && Number(r.ofr ?? -1) > today).length;

  const evidence: string[] = [];
  if (placedMarks.length >= 2) {
    const list = placedMarks.length > 1
      ? `${placedMarks.slice(0, -1).join(", ")} and ${placedMarks[placedMarks.length - 1]}`
      : String(placedMarks[0]);
    evidence.push(`he's also been placed off marks of ${list}`);
  }
  if (winsOffHigher > 1) {
    evidence.push(`has won ${word(winsOffHigher)} times off higher marks than this`);
  }

  if (evidence.length) {
    p1.push(
      `${evidence.join(" and ").replace(/^he's/, "He's")}, so there's no doubt he's very ` +
      // "if the spark comes back" is a doubt about the horse's form, and the
      // last of three places to assume that form is bad. A winner does not
      // need its spark to come back.
      `well treated${poorRun >= 2 && !lastInFrame ? " if the spark comes back" : ""}.`
    );
  }

  if (p1.length) { say(p1.join(" ")); say(); }

  /* ------------------------------------------- paragraph 2: the race today */
  const p2: string[] = [];
  const last = runs[0];

  if (last) {
    // "Yesterday", "On Tuesday", "Last month" — how a person says it.
    const days = Math.round(
      (Date.parse(`${date}T00:00:00Z`) - Date.parse(String(last.d))) / 86_400_000
    );
    const when =
      days <= 1 ? "Yesterday" :
      days <= 6 ? `On ${new Date(String(last.d)).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}` :
      days <= 45 ? "Last time" : `Back in ${MONTHS[new Date(String(last.d)).getUTCMonth()]}`;

    // How it ran, from the comment, in plain words.
    //
    // Word boundaries throughout. Without them /led/ matched "Settled", so a
    // horse held up off the pace was described as racing up with it — the same
    // substring bug that once turned "finished well beaten" into "finished
    // well". Every pattern here is anchored.
    const c = String(last.comment ?? "").toLowerCase();
    const beats: string[] = [];

    if (/\bheld up\b|towards the (back|rear)|\bin rear\b|off the pace|settled (in|towards) the (pack|rear)/.test(c))
      beats.push("was held up");
    else if (/\bmidfield\b|mid-division|\bmidpack\b|mid-pack|\bin the pack\b/.test(c))
      beats.push("raced in midfield");
    else if (/\bled\b|\bmade all\b|front rank|\bprominent\b|\bracing prominently\b|\bpace early\b/.test(c))
      beats.push("raced up with the pace");

    // Where the effort came, in furlongs.
    if (/pushed along|\bridden\b|\bdriven\b|niggled|urged forward|shaken up/.test(c)) {
      const at = /(?:^|[^\d])(\d)f (?:out|left|remaining)/.exec(c);
      // Every beat has to read as a verb phrase following "he ...", or the
      // sentence breaks the moment this one comes first: "Last time he ridden
      // over 2f out". The doubled "was" is tidied when they are joined.
      beats.push(at ? `was ridden over ${at[1]}f out` : "was pushed along");
    }

    // And how it finished.
    //
    // A win is read from the position, not from the comment. The comment
    // phrases describe a horse being beaten — "just plugged on", "never got
    // into it" — and running them on a winner produced "Last time was pushed
    // along and finished won": ungrammatical, and it argued the opposite of
    // what happened.
    if (Number(last.pos) === 1) {
      beats.push("won");
    } else if (/\bkept on\b|stayed on|plugged on|\brallied\b/.test(c)) {
      beats.push("just plugged on");
    } else if (/no impression|one pace|one gear|same gear|never a threat|unable to (close|quicken)/.test(c)) {
      beats.push("never got into it");
    } else if (/weakened|faded|dropped away|dropped back|lost ground|\bbeaten off\b|no extra/.test(c)) {
      beats.push("dropped out of it late on");
    } else if (last.pos !== null) {
      beats.push(`finished ${ordinal(Number(last.pos))}`);
    }

    // The close has to follow the run. "I wouldn't be writing him off" is a
    // defence, and a horse that won last time needs defending from nothing.
    const close = Number(last.pos) === 1
      ? ", and did it well enough to suggest there is more to come."
      : ", but I wouldn't be writing him off at all.";

    // "he was held up, was ridden over 2f out and won" is grammatical but
    // clumsy; once the first clause has established the auxiliary the later
    // ones do not need to repeat it.
    const tidied = beats.map((b, i) =>
      i > 0 && b.startsWith("was ") && beats.slice(0, i).some((x) => x.startsWith("was "))
        ? b.slice(4)
        : b
    );

    const how = tidied.length > 1
      ? tidied.slice(0, -1).join(", ") + " and " + tidied[tidied.length - 1]
      : tidied[0];

    p2.push(
      beats.length
        ? `${when} he ${how}${close}`
        : `${when} he was well beaten, but I wouldn't be writing him off at all.`
    );
  }

  // The grade. Dan cites the band, not the class: "This is a 0-95, so he's
  // still in a decent enough race."
  const band = String(race.band ?? "").trim();
  if (band) {
    p2.push(`This is a ${band}, so he's still in a decent enough race,`);
  }

  const positives: string[] = [];
  if (horse.jk) positives.push(`${horse.jk} taking the ride catches the eye`);

  const goingWins = runs.filter((r) => Number(r.pos) === 1 && r.gb === race.gb).length;
  if (goingWins) {
    const soft = ["heavy", "soft", "good-soft"].includes(String(race.gb));
    positives.push(soft ? "he handles testing ground really well" : `he's won on this ground before`);
  }

  if (positives.length) {
    const joined = positives.join(" and ");
    p2.push(band ? `but ${joined}.` : `${joined.replace(/^./, (x) => x.toUpperCase())}.`);
  }

  /* ------------------------------------------------- the close, conditional */
  //
  // "Well treated" is a claim and it needs evidence: a run of merit off a mark
  // at or above today's. Without one the horse is not well in, and saying so
  // anyway is how a note loses its credibility.
  //
  // Dan closes on what the horse would have to do, not on an instruction to
  // back it — "if he can just find a bit more than he has shown on the last
  // couple of starts, then off this mark he's definitely capable of getting
  // involved." That is a harder thing to write and a more honest one to read,
  // because it names the condition the bet depends on.
  const provenOffMark = runs.some(
    (r) => Number(r.ofr ?? -999) >= today &&
           r.pos !== null && (Number(r.pos) === 1 || (Number(r.pos) <= 3 && Number(r.btn ?? 99) <= 3))
  );
  const rise = bestWin ? today - Number(bestWin.ofr ?? today) : 0;

  // A horse that won last time is not being asked to "find a bit more than he
  // has shown" — it showed it. Same fault as the opening: poorRun counts the
  // last three runs and cannot tell that the most recent one was a win.
  if (provenOffMark && poorRun >= 2 && !lastInFrame) {
    p2.push(
      `If he can just find a bit more than he has shown on the last couple of starts, ` +
      `then off this mark he's definitely capable of getting involved.`
    );
  } else if (provenOffMark) {
    p2.push(
      `Off this mark, and running the way he has been, he looks the one to be with ` +
      `at ${price}${terms && bet.type === "ew" ? ` with ${terms.places} places` : ""}.`
    );
  } else if (rise > 0) {
    p2.push(
      `The one thing I can't get away from is the mark. He's ${rise}lb higher than when he ` +
      `won and there's nothing in his form to say he's won off this sort of rating before, ` +
      `so he has to improve for it rather than just repeat what he did.`
    );
  } else {
    p2.push(
      `He's got a bit to find on these terms and the case rests on him being better than ` +
      `the bare form, so it's a watching brief rather than a play.`
    );
  }

  if (p2.length) { say(p2.join(" ")); say(); }

  say();
  // The sign-off has to agree with the note. Stamping "VIP PLAY" on an argument
  // that has just talked the horse down is the kind of contradiction a paying
  // subscriber notices immediately.
  say(
    provenOffMark
      ? `${tag} — ${NAME} — ${price} — ${stake}`
      : `NOT A ${tag} — ${NAME} — ${price} — one to watch rather than back`
  );

  const out = L.join("\n");
  console.log("\n" + out + "\n");

  if (process.argv.includes("--save")) {
    const p = join(homedir(), "Desktop", "Racing Tips", `${date} VIP ${off.replace(":", "")} ${horse.name}.txt`);
    writeFileSync(p, out + "\n");
    console.log(`saved: ${p}\n`);
  }

  await sql.end();
})();
