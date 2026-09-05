/**
 * Build and price a Stable game card.
 *
 *   npm run game            # today
 *   npm run game -- 2026-09-05
 *   npm run game -- 2026-09-05 --races 12 --meetings 4
 *
 * Read-only. This prints what the game would offer; it writes nothing. The
 * snapshot that a live game would actually trade against has to be taken at a
 * fixed moment by a cron, because `runners.opening_odds_at` is "whenever ingest
 * first saw this runner", which varies by hours across a card.
 *
 * A race is only priced if nearly every live runner carries an opening price
 * and the resulting book is sane. A partially-covered race de-overrounds to
 * nonsense — four of twelve runners priced gives a book near 0.35, which turns
 * a 12/1 shot into a 2/1 favourite and puts a £30m price on it. Better to drop
 * the race from the card and say so than to sell someone a fictional horse.
 */
import "dotenv/config";
import postgres from "postgres";
import {
  BUDGET,
  N_HORSES,
  N_JOCKEYS,
  bookPercentage,
  deOverround,
  expectedPoints,
  horsePrice,
  jockeyPrice,
} from "../lib/game-pricing";

const MIN_COVERAGE = 0.95;
/**
 * A book under 100% would be an arbitrage and means the data is wrong, not that
 * the bookmaker is generous. Over 160% means we are almost certainly looking at
 * a partially-priced race that slipped the coverage check. Everything between
 * is priceable — a tight 101% book on a small field is unusual but real, and
 * rejecting it just drops a race the game could have offered.
 */
const MIN_BOOK = 1.0;
const MAX_BOOK = 1.6;

type Row = {
  race_id: string;
  course_name: string;
  race_name: string;
  off_time: string;
  prize_value: number | null;
  horse_id: string;
  horse_name: string;
  jockey_id: string | null;
  jockey_name: string | null;
  trainer_name: string | null;
  opening_odds_dec: number | null;
  opening_odds_frac: string | null;
  best_odds_dec: number | null;
  is_non_runner: boolean;
};

type Priced = {
  horseId: string;
  horse: string;
  jockeyId: string | null;
  jockey: string | null;
  trainer: string | null;
  frac: string;
  oddsDec: number;
  p: number;
  price: number;
};

function arg(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) ? n : fallback;
}

(async () => {
  const dateArg = process.argv.slice(2).find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const date = dateArg ?? new Date().toISOString().slice(0, 10);
  const wantRaces = arg("--races", 12);
  const wantMeetings = arg("--meetings", 4);

  const sql = postgres(process.env.DATABASE_URL!, { ssl: "require", max: 4 });

  const rows = await sql<Row[]>`
    select r.id            as race_id,
           r.course_name,
           r.name          as race_name,
           r.off_time,
           r.prize_value,
           ru.horse_id,
           ru.horse_name,
           ru.jockey_id,
           ru.jockey_name,
           ru.trainer_name,
           ru.opening_odds_dec,
           ru.opening_odds_frac,
           ru.best_odds_dec,
           ru.is_non_runner
    from races r
    join runners ru on ru.race_id = r.id
    where r.race_date = ${date}
      and r.region in ('GB', 'IRE')
    order by r.course_name, r.off_time`;

  if (!rows.length) {
    console.error(`No GB/IRE runners stored for ${date}. Run the racecard ingest first.`);
    await sql.end();
    process.exit(1);
  }

  // Group into races, keeping the meeting metadata alongside.
  const races = new Map<string, { meta: Row; runners: Row[] }>();
  for (const row of rows) {
    const entry = races.get(row.race_id);
    if (entry) entry.runners.push(row);
    else races.set(row.race_id, { meta: row, runners: [row] });
  }

  // Pick the meetings with the most prize money on offer, then the richest
  // races within them. A curated card is the point: six horses from a 400-runner
  // Saturday is a phone book, not a fixture list.
  const meetingPrize = new Map<string, number>();
  for (const { meta } of races.values()) {
    meetingPrize.set(
      meta.course_name,
      (meetingPrize.get(meta.course_name) ?? 0) + (meta.prize_value ?? 0)
    );
  }
  const chosenMeetings = new Set(
    [...meetingPrize.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, wantMeetings)
      .map(([course]) => course)
  );

  const candidates = [...races.values()]
    .filter((r) => chosenMeetings.has(r.meta.course_name))
    .sort((a, b) => (b.meta.prize_value ?? 0) - (a.meta.prize_value ?? 0));

  const card: { meta: Row; priced: Priced[] }[] = [];
  const rejected: { race: string; why: string }[] = [];

  for (const { meta, runners } of candidates) {
    if (card.length >= wantRaces) break;

    const live = runners.filter((r) => !r.is_non_runner);
    const withOpening = live.filter((r) => (r.opening_odds_dec ?? 0) > 1);
    const label = `${meta.course_name} ${meta.off_time}`;

    if (live.length < 4) {
      rejected.push({ race: label, why: `only ${live.length} live runners` });
      continue;
    }
    if (withOpening.length < live.length * MIN_COVERAGE) {
      rejected.push({
        race: label,
        why: `opening prices for ${withOpening.length}/${live.length} runners`,
      });
      continue;
    }
    const book = bookPercentage(withOpening.map((r) => r.opening_odds_dec!));
    if (book < MIN_BOOK || book > MAX_BOOK) {
      rejected.push({ race: label, why: `book is ${(book * 100).toFixed(0)}%` });
      continue;
    }

    const probs = deOverround(withOpening.map((r) => r.opening_odds_dec!));
    const priced = withOpening
      .map((r, i) => ({
        horseId: r.horse_id,
        horse: r.horse_name,
        jockeyId: r.jockey_id,
        jockey: r.jockey_name,
        trainer: r.trainer_name,
        frac: r.opening_odds_frac ?? `${(r.opening_odds_dec! - 1).toFixed(1)}/1`,
        oddsDec: r.opening_odds_dec!,
        p: probs[i],
        price: horsePrice(probs[i]),
      }))
      .sort((a, b) => b.price - a.price);

    card.push({ meta, priced });
  }

  if (card.length < wantRaces) {
    console.error(
      `\nOnly ${card.length} of ${wantRaces} races could be priced for ${date}.` +
        (card.length ? " Printing what there is." : "")
    );
  }
  if (!card.length) {
    await sql.end();
    process.exit(1);
  }

  // Jockeys are priced off their book across the game card only — rides
  // elsewhere on the day do not count, because they cannot score.
  const books = new Map<string, { id: string; name: string; rides: number; strength: number }>();
  for (const { priced } of card) {
    for (const runner of priced) {
      if (!runner.jockey) continue;
      const entry = books.get(runner.jockey) ?? {
        id: runner.jockeyId ?? runner.jockey,
        name: runner.jockey,
        rides: 0,
        strength: 0,
      };
      entry.rides += 1;
      entry.strength += runner.p;
      books.set(runner.jockey, entry);
    }
  }
  const jockeys = [...books.values()]
    .map((j) => ({ ...j, price: jockeyPrice(j.strength) }))
    .sort((a, b) => b.price - a.price);

  // ---- optionally freeze this tick ----------------------------------------
  // Append-only. A re-run at the same second is a no-op rather than an error,
  // so a retrying cron cannot corrupt a card that already priced.
  if (process.argv.includes("--save")) {
    const snapshotAt = new Date();
    const rowsToSave = [
      ...card.flatMap(({ meta, priced }) =>
        priced.map((r) => ({
          race_date: date,
          snapshot_at: snapshotAt,
          kind: "horse",
          subject_id: r.horseId,
          subject_name: r.horse,
          race_id: meta.race_id,
          odds_dec: r.oddsDec,
          strength: r.p,
          price_m: r.price,
        }))
      ),
      ...jockeys.map((j) => ({
        race_date: date,
        snapshot_at: snapshotAt,
        kind: "jockey",
        subject_id: j.id,
        subject_name: j.name,
        race_id: null,
        odds_dec: null,
        strength: j.strength,
        price_m: j.price,
      })),
    ];
    await sql`insert into game_prices ${sql(rowsToSave)} on conflict do nothing`;
    console.log(
      `\n  saved ${rowsToSave.length} prices at ${snapshotAt.toISOString()}`
    );
  }

  // ---- output -------------------------------------------------------------
  const money = (m: number) => `£${m.toFixed(1)}m`;
  console.log(`\n  STABLE — game card for ${date}`);
  console.log(`  ${card.length} races · ${chosenMeetings.size} meetings · budget ${money(BUDGET)}`);
  console.log(`  pick ${N_HORSES} horses (max one per race) and ${N_JOCKEYS} jockeys\n`);

  for (const { meta, priced } of card) {
    const prize = meta.prize_value ? `£${Math.round(meta.prize_value / 100).toLocaleString("en-GB")}` : "—";
    console.log(`  ${meta.off_time}  ${meta.course_name}  ·  ${meta.race_name}  (${prize})`);
    for (const r of priced) {
      console.log(
        `      ${money(r.price).padStart(7)}  ${r.horse.padEnd(24)}` +
          `${r.frac.padStart(8)}  ${(r.jockey ?? "—").padEnd(20)} ${r.trainer ?? "—"}`
      );
    }
    console.log("");
  }

  console.log(`  JOCKEYS — priced on their book across these ${card.length} races\n`);
  for (const j of jockeys.slice(0, 15)) {
    console.log(
      `      ${money(j.price).padStart(7)}  ${j.name.padEnd(24)}` +
        `${String(j.rides).padStart(2)} rides   book strength ${j.strength.toFixed(2)}`
    );
  }

  // A quick playability check: can you actually field a legal stable, and does
  // the budget bind? If the six shortest-priced horses plus the two dearest
  // jockeys fit inside the budget, there is no game.
  const shortest = card
    .map((r) => r.priced[0])
    .sort((a, b) => b.price - a.price)
    .slice(0, N_HORSES);
  const dreamHorses = shortest.reduce((s, r) => s + r.price, 0);
  const dreamJockeys = jockeys.slice(0, N_JOCKEYS).reduce((s, j) => s + j.price, 0);
  const cheapest = card
    .map((r) => r.priced[r.priced.length - 1].price)
    .sort((a, b) => a - b)
    .slice(0, N_HORSES)
    .reduce((s, p) => s + p, 0);

  const everyRunner = card.flatMap((c) => c.priced);
  const dearest = Math.max(...everyRunner.map((r) => r.price));

  console.log(`\n  PLAYABILITY`);
  console.log(`      runners in the pool            ${everyRunner.length}`);
  console.log(`      dearest horse on the card      ${money(dearest)}`);
  console.log(`      six favourites would cost      ${money(dreamHorses)}`);
  console.log(`      + the two dearest jockeys      ${money(dreamHorses + dreamJockeys)}`);
  console.log(
    `      that ${dreamHorses + dreamJockeys > BUDGET ? "does NOT fit" : "FITS"} inside ${money(BUDGET)}` +
      `${dreamHorses + dreamJockeys > BUDGET ? " — good, the budget binds" : " — the budget is too loose"}`
  );
  console.log(`      cheapest legal stable          ${money(cheapest + 2 * 2)}`);

  const bestValue = [...everyRunner].sort(
    (a, b) => expectedPoints(b.p) / b.price - expectedPoints(a.p) / a.price
  )[0];
  console.log(
    `      best points per £m             ${bestValue.horse} at ${money(bestValue.price)} ` +
      `(${(expectedPoints(bestValue.p) / bestValue.price).toFixed(3)} pts/£m)`
  );

  if (rejected.length) {
    console.log(`\n  RACES DROPPED (${rejected.length}) — not priceable`);
    for (const r of rejected.slice(0, 10)) console.log(`      ${r.race.padEnd(28)} ${r.why}`);
    if (rejected.length > 10) console.log(`      ...and ${rejected.length - 10} more`);
  }
  console.log("");

  await sql.end();
})();
