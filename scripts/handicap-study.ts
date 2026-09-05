/**
 * What do handicap winners have in common?
 *
 *   npm run study
 *   npm run study -- --days=190 --type=Flat
 *
 * Every handicap run in the window, with the horse's previous run and its last
 * winning mark attached, then cut by one factor at a time.
 *
 * Two columns matter and they are not the same column.
 *
 *   IV   impact value: how often this group wins against how often an average
 *        runner wins. Above 1.00 is a real pattern in who wins races.
 *
 *   ROI  what backing every horse in the group at SP would have returned.
 *
 * A factor can have a strong IV and a terrible ROI, and most do — that is the
 * market having read the same page. Only a factor with BOTH is worth anything
 * to a tipping model, and there are far fewer of those than a form book would
 * lead you to expect.
 */
import "dotenv/config";
import postgres from "postgres";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;

const DAYS = parseInt(arg("days", "190"), 10);
const TYPE = arg("type", "");

type Run = {
  raceId: string; horseId: string; raceDate: string; raceType: string | null;
  fieldSize: number | null; goingBand: string | null; distanceF: number | null;
  pos: number; sp: number; draw: number | null; ofr: number | null;
  weightLbs: number | null; age: number | null; headgearFirst: boolean;
  prevDate: string | null; prevPos: number | null; prevOfr: number | null;
  prevField: number | null; lastWinDate: string | null; lastWinOfr: number | null;
  marketRank: number; weightRank: number;
  raceClass: string | null; ratingBand: string | null; prevClass: string | null;
  bestClassWon: number | null; winsThisClass: number;
};

const pct = (n: number, d: number) => (d ? (n / d) * 100 : 0);

(async () => {
  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 2 });

  process.stdout.write("loading handicap runs... ");
  const rows: any[] = await sql`
    with hcap as (
      select ra.id as race_id, ra.race_date::text as race_date, ra.race_type,
             ra.field_size, ra.going_band, ra.distance_f,
             r.horse_id, r.position_num as pos, r.sp_dec as sp, r.draw, r.ofr,
             r.weight_lbs, r.age, ra.race_class, ra.rating_band,
             coalesce(r.headgear_first_time, false) as headgear_first
      from races ra
      join runners r on r.race_id = ra.id
      where ra.status = ${"result"}
        and ra.race_date >= current_date - (${DAYS} || ' days')::interval
        and ra.name ilike ${"%handicap%"}
        and r.position_num is not null
        and r.sp_dec is not null
        and coalesce(r.is_non_runner, false) = false
        and (${TYPE}::text = '' or ra.race_type = ${TYPE})
    )
    select h.*,
           p.race_date::text as prev_date, p.pos as prev_pos, p.ofr as prev_ofr,
           p.field_size as prev_field, p.prev_class,
           w.race_date::text as last_win_date, w.ofr as last_win_ofr,
           cw.best_class_won, cw.wins_this_class,
           rank() over (partition by h.race_id order by h.sp)          as market_rank,
           rank() over (partition by h.race_id order by h.weight_lbs desc) as weight_rank
    from hcap h
    left join lateral (
      select ra2.race_date, r2.position_num as pos, r2.ofr, ra2.field_size,
             ra2.race_class as prev_class
      from runners r2 join races ra2 on ra2.id = r2.race_id
      where r2.horse_id = h.horse_id and ra2.status = ${"result"}
        and ra2.race_date < h.race_date::date and r2.position_num is not null
      order by ra2.race_date desc limit 1
    ) p on true
    left join lateral (
      select ra3.race_date, r3.ofr
      from runners r3 join races ra3 on ra3.id = r3.race_id
      where r3.horse_id = h.horse_id and ra3.status = ${"result"}
        and ra3.race_date < h.race_date::date and r3.position_num = 1
      order by ra3.race_date desc limit 1
    ) w on true
    -- Every previous WIN, reduced to the best grade it was won in. A lower
    -- class number is a better race, so the minimum is the highest grade the
    -- horse has ever won in.
    left join lateral (
      select min(nullif(regexp_replace(ra4.race_class, ${"[^0-9]"}, ${""}, ${"g"}), ${""})::int) as best_class_won,
             count(*) filter (
               where nullif(regexp_replace(ra4.race_class, ${"[^0-9]"}, ${""}, ${"g"}), ${""})::int
                     = nullif(regexp_replace(h.race_class, ${"[^0-9]"}, ${""}, ${"g"}), ${""})::int
             )::int as wins_this_class
      from runners r4 join races ra4 on ra4.id = r4.race_id
      where r4.horse_id = h.horse_id and ra4.status = ${"result"}
        and ra4.race_date < h.race_date::date and r4.position_num = 1
        and ra4.race_class is not null and ra4.race_class <> ${""}
    ) cw on true`;

  await sql.end();

  const runs: Run[] = rows.map((r) => ({
    raceId: r.race_id, horseId: r.horse_id, raceDate: r.race_date, raceType: r.race_type,
    fieldSize: r.field_size, goingBand: r.going_band, distanceF: r.distance_f,
    pos: Number(r.pos), sp: Number(r.sp), draw: r.draw, ofr: r.ofr,
    weightLbs: r.weight_lbs, age: r.age, headgearFirst: r.headgear_first,
    prevDate: r.prev_date, prevPos: r.prev_pos, prevOfr: r.prev_ofr, prevField: r.prev_field,
    lastWinDate: r.last_win_date, lastWinOfr: r.last_win_ofr,
    marketRank: Number(r.market_rank), weightRank: Number(r.weight_rank),
    raceClass: r.race_class, ratingBand: r.rating_band, prevClass: r.prev_class,
    bestClassWon: r.best_class_won == null ? null : Number(r.best_class_won),
    winsThisClass: Number(r.wins_this_class ?? 0),
  }));

  const races = new Set(runs.map((r) => r.raceId)).size;
  const wins = runs.filter((r) => r.pos === 1);
  const baseWin = pct(wins.length, runs.length);

  console.log(`${runs.length.toLocaleString()} runs`);
  console.log(`\nHANDICAPS — last ${DAYS} days${TYPE ? `, ${TYPE} only` : ""}`);
  console.log("=".repeat(78));
  console.log(`  ${races.toLocaleString()} races, ${runs.length.toLocaleString()} runners, ${wins.length.toLocaleString()} winners`);
  console.log(`  an average runner wins ${baseWin.toFixed(1)}% of the time\n`);

  /** One factor, cut into named buckets. */
  function cut(title: string, bucket: (r: Run) => string | null, order?: string[]) {
    const groups = new Map<string, Run[]>();
    for (const r of runs) {
      const b = bucket(r);
      if (b === null) continue;
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b)!.push(r);
    }

    const keys = order
      ? order.filter((k) => groups.has(k))
      : [...groups.keys()].sort();

    console.log("-".repeat(78));
    console.log(`  ${title}`);
    console.log(`  ${"".padEnd(24)}${"runners".padStart(9)}${"wins".padStart(7)}${"win%".padStart(8)}${"IV".padStart(7)}${"ROI".padStart(9)}${"of all wins".padStart(13)}`);

    for (const k of keys) {
      const g = groups.get(k)!;
      if (g.length < 150) continue;
      const w = g.filter((r) => r.pos === 1);
      const win = pct(w.length, g.length);
      const iv = baseWin ? win / baseWin : 0;
      const ret = w.reduce((a, r) => a + r.sp, 0);
      const roi = ((ret - g.length) / g.length) * 100;
      const share = pct(w.length, wins.length);

      console.log(
        `  ${k.padEnd(24)}${g.length.toLocaleString().padStart(9)}${String(w.length).padStart(7)}` +
        `${win.toFixed(1).padStart(7)}%${iv.toFixed(2).padStart(7)}` +
        `${(roi >= 0 ? "+" : "") + roi.toFixed(1)}%`.padStart(9) +
        `${share.toFixed(1)}%`.padStart(13)
      );
    }
    console.log("");
  }

  const daysBetween = (a: string | null, b: string) =>
    a === null ? null : Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

  cut("MARKET RANK", (r) =>
    r.marketRank === 1 ? "favourite" :
    r.marketRank === 2 ? "2nd favourite" :
    r.marketRank === 3 ? "3rd favourite" :
    r.marketRank <= 6 ? "4th-6th" : "7th or bigger",
    ["favourite", "2nd favourite", "3rd favourite", "4th-6th", "7th or bigger"]);

  cut("DAYS SINCE LAST RUN", (r) => {
    const d = daysBetween(r.prevDate, r.raceDate);
    if (d === null) return null;
    if (d <= 7) return "within a week";
    if (d <= 14) return "8-14 days";
    if (d <= 30) return "15-30 days";
    if (d <= 60) return "31-60 days";
    if (d <= 180) return "61-180 days";
    return "over 6 months";
  }, ["within a week", "8-14 days", "15-30 days", "31-60 days", "61-180 days", "over 6 months"]);

  cut("LAST TIME OUT", (r) =>
    r.prevPos === null ? null :
    r.prevPos === 1 ? "won" :
    r.prevPos <= 3 ? "placed 2nd-3rd" :
    r.prevPos <= 6 ? "4th-6th" : "7th or worse",
    ["won", "placed 2nd-3rd", "4th-6th", "7th or worse"]);

  cut("MARK vs LAST WINNING MARK", (r) => {
    if (r.ofr === null || r.lastWinOfr === null) return null;
    const d = r.ofr - r.lastWinOfr;
    if (d <= -8) return "8lb+ below";
    if (d <= -4) return "4-7lb below";
    if (d <= -1) return "1-3lb below";
    if (d === 0) return "same mark";
    if (d <= 5) return "1-5lb above";
    return "6lb+ above";
  }, ["8lb+ below", "4-7lb below", "1-3lb below", "same mark", "1-5lb above", "6lb+ above"]);

  cut("TIME SINCE LAST WIN", (r) => {
    if (r.lastWinDate === null) return "never won";
    const d = daysBetween(r.lastWinDate, r.raceDate)!;
    if (d <= 30) return "won within a month";
    if (d <= 90) return "1-3 months";
    if (d <= 365) return "3-12 months";
    return "over a year";
  }, ["won within a month", "1-3 months", "3-12 months", "over a year", "never won"]);

  cut("WEIGHT CARRIED", (r) =>
    r.weightRank === 1 ? "top weight" :
    r.weightRank <= 3 ? "2nd-3rd top" :
    r.weightRank <= 6 ? "4th-6th" : "near the bottom",
    ["top weight", "2nd-3rd top", "4th-6th", "near the bottom"]);

  cut("DRAW (flat only)", (r) => {
    if (r.raceType !== "Flat" || r.draw === null || !r.fieldSize || r.fieldSize < 8) return null;
    const third = r.fieldSize / 3;
    return r.draw <= third ? "low" : r.draw <= third * 2 ? "middle" : "high";
  }, ["low", "middle", "high"]);

  cut("FIELD SIZE", (r) => {
    if (!r.fieldSize) return null;
    if (r.fieldSize <= 7) return "up to 7";
    if (r.fieldSize <= 11) return "8-11";
    if (r.fieldSize <= 15) return "12-15";
    return "16+";
  }, ["up to 7", "8-11", "12-15", "16+"]);

  cut("AGE", (r) =>
    r.age === null ? null :
    r.age <= 3 ? "3yo and under" :
    r.age === 4 ? "4yo" :
    r.age <= 6 ? "5-6yo" : "7yo+",
    ["3yo and under", "4yo", "5-6yo", "7yo+"]);

  cut("FIRST-TIME HEADGEAR", (r) => (r.headgearFirst ? "yes" : "no"), ["yes", "no"]);

  // Class. Captured on every British race and never scored — a lower number is
  // a better race, so dropping in class means today is easier than last time.
  const classNo = (c: string | null) => {
    const m = /(\d)/.exec(String(c ?? ""));
    return m ? parseInt(m[1], 10) : null;
  };

  cut("CLASS OF RACE", (r) => {
    const c = classNo(r.raceClass);
    return c === null ? null : `Class ${c}`;
  }, ["Class 1", "Class 2", "Class 3", "Class 4", "Class 5", "Class 6", "Class 7"]);

  cut("CLASS MOVE SINCE LAST RUN", (r) => {
    const now = classNo(r.raceClass);
    const was = classNo(r.prevClass);
    if (now === null || was === null) return null;
    const d = now - was; // positive = today is a LOWER grade
    if (d >= 2) return "dropped 2+ classes";
    if (d === 1) return "dropped a class";
    if (d === 0) return "same class";
    if (d === -1) return "up a class";
    return "up 2+ classes";
  }, ["dropped 2+ classes", "dropped a class", "same class", "up a class", "up 2+ classes"]);

  /* ------------------------------------------- Dan's hypothesis, tested */

  // "The class is key in handicaps — if the handicapper drops him into a grade
  // where he has won before."
  //
  // Two claims in one, so they are separated: proven at today's grade, and
  // dropped into it. The first is about the horse, the second about the move.
  cut("PROVEN AT TODAY'S CLASS", (r) => {
    if (classNo(r.raceClass) === null) return null;
    if (r.bestClassWon === null) return "never won in any class";
    return r.winsThisClass > 0 ? "has won at this class" : "has not won at this class";
  }, ["has won at this class", "has not won at this class", "never won in any class"]);

  cut("WON AT THIS GRADE OR BETTER", (r) => {
    const c = classNo(r.raceClass);
    if (c === null) return null;
    if (r.bestClassWon === null) return "no class win on record";
    if (r.bestClassWon < c) return "has won in a HIGHER grade";
    if (r.bestClassWon === c) return "best win is at this grade";
    return "has only won lower down";
  }, ["has won in a HIGHER grade", "best win is at this grade", "has only won lower down", "no class win on record"]);

  cut("DROPPED INTO A GRADE HE HAS WON IN", (r) => {
    const now = classNo(r.raceClass);
    const was = classNo(r.prevClass);
    if (now === null || was === null || r.bestClassWon === null) return null;
    const dropped = now > was;
    const proven = r.winsThisClass > 0 || r.bestClassWon <= now;
    if (dropped && proven) return "dropped AND proven here";
    if (dropped) return "dropped, unproven here";
    if (proven) return "no drop, proven here";
    return "no drop, unproven here";
  }, ["dropped AND proven here", "dropped, unproven here", "no drop, proven here", "no drop, unproven here"]);

  /* ------------------------------------------------------ the mark, controlled */

  // "Well handicapped" measures as a NEGATIVE, which is the opposite of what
  // the model assumes. Before believing it, rule out the obvious confound: a
  // horse a stone below its last winning mark may simply be one whose last win
  // was years ago and who has been declining ever since. So the same cut is
  // run again inside horses that won recently, where that cannot be the story.
  const recentWinner = (r: Run) => {
    const d = daysBetween(r.lastWinDate, r.raceDate);
    return d !== null && d <= 365;
  };
  const markBucket = (r: Run) => {
    if (r.ofr === null || r.lastWinOfr === null) return null;
    const d = r.ofr - r.lastWinOfr;
    if (d <= -8) return "8lb+ below";
    if (d <= -4) return "4-7lb below";
    if (d <= -1) return "1-3lb below";
    if (d === 0) return "same mark";
    if (d <= 5) return "1-5lb above";
    return "6lb+ above";
  };
  const ORDER = ["8lb+ below", "4-7lb below", "1-3lb below", "same mark", "1-5lb above", "6lb+ above"];

  const keep = runs;
  const only = (f: (r: Run) => boolean) => {
    const sub = keep.filter(f);
    const base = pct(sub.filter((r) => r.pos === 1).length, sub.length);
    return { sub, base };
  };

  for (const [label, filter] of [
    ["horses that won in the last 12 months", recentWinner],
    ["horses whose last win was over a year ago, or never", (r: Run) => !recentWinner(r)],
  ] as Array<[string, (r: Run) => boolean]>) {
    const { sub, base } = only(filter);
    console.log("-".repeat(78));
    console.log(`  MARK vs LAST WINNING MARK — ${label}`);
    console.log(`  ${"".padEnd(24)}${"runners".padStart(9)}${"wins".padStart(7)}${"win%".padStart(8)}${"IV".padStart(7)}${"ROI".padStart(9)}`);
    for (const k of ORDER) {
      const g = sub.filter((r) => markBucket(r) === k);
      if (g.length < 150) continue;
      const w = g.filter((r) => r.pos === 1);
      const win = pct(w.length, g.length);
      const roi = ((w.reduce((a, r) => a + r.sp, 0) - g.length) / g.length) * 100;
      console.log(
        `  ${k.padEnd(24)}${g.length.toLocaleString().padStart(9)}${String(w.length).padStart(7)}` +
        `${win.toFixed(1).padStart(7)}%${(win / base).toFixed(2).padStart(7)}` +
        `${(roi >= 0 ? "+" : "") + roi.toFixed(1)}%`.padStart(9)
      );
    }
    console.log("");
  }

  /* ---------------------------------------------------------------- profile */

  console.log("=".repeat(78));
  console.log("  WHAT THE WINNERS HAD IN COMMON");
  console.log("=".repeat(78));
  console.log(`  ${"".padEnd(42)}${"winners".padStart(10)}${"all runners".padStart(14)}${"lift".padStart(8)}`);

  const traits: Array<[string, (r: Run) => boolean]> = [
    ["in the first three in the market", (r) => r.marketRank <= 3],
    ["ran within the last 30 days", (r) => { const d = daysBetween(r.prevDate, r.raceDate); return d !== null && d <= 30; }],
    ["placed or won last time", (r) => r.prevPos !== null && r.prevPos <= 3],
    ["at or below its last winning mark", (r) => r.ofr !== null && r.lastWinOfr !== null && r.ofr <= r.lastWinOfr],
    ["has won within the last year", (r) => { const d = daysBetween(r.lastWinDate, r.raceDate); return d !== null && d <= 365; }],
    ["in the top third of the weights", (r) => !!r.fieldSize && r.weightRank <= Math.max(1, r.fieldSize / 3)],
    ["field of 11 or fewer", (r) => !!r.fieldSize && r.fieldSize <= 11],
  ];

  for (const [label, test] of traits) {
    const w = pct(wins.filter(test).length, wins.length);
    const a = pct(runs.filter(test).length, runs.length);
    const lift = a ? w / a : 0;
    console.log(
      `  ${label.padEnd(42)}${w.toFixed(1).padStart(9)}%${a.toFixed(1).padStart(13)}%${lift.toFixed(2).padStart(8)}`
    );
  }
  console.log("");
})();
