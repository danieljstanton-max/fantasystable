/**
 * API response -> our schema.
 *
 * VERIFIED against live responses on 2026-08-26 via `npm run probe`. Every key
 * below was observed in probe-output/. There is no speculative key-guessing
 * left in this file, and there should never be again: if The Racing API
 * changes a field name, this must fail loudly rather than silently read the
 * wrong one.
 *
 * Two shapes, not one
 * -------------------
 * /v1/racecards/pro and /v1/results return genuinely different schemas for the
 * same concepts, so they get separate mappers rather than one lenient mapper
 * that tries to serve both:
 *
 *   racecards            results
 *   ---------            -------
 *   off_time             off
 *   distance / distance_f  dist / dist_f  ("16.5f", with the suffix)
 *   race_class           class
 *   sex_restriction      sex_rest
 *   ofr                  or
 *   ts                   tsr
 *   lbs                  weight_lbs
 *
 * Three traps confirmed by probe
 * ------------------------------
 * 1. `off_time` is 12-hour with NO am/pm: "2:15" is 14:15. Constructing a time
 *    from it puts every afternoon race twelve hours early. `off_dt` is a full
 *    ISO instant with offset and is the only thing we parse.
 * 2. Non-runners carry no boolean. They are flagged by `number === "NR"`.
 *    Today's card had 15 of them; missing this ingests them as live runners.
 * 3. Horse names differ between endpoints — "Goliath Power (FR)" in results,
 *    bare in racecards. Match on horse_id. Never on name.
 */

import { raceSlug, slugify } from "./slug";
import { normaliseGoing, isAllWeather } from "./going";

type Raw = Record<string, any>;

/** Missing values arrive as "" or "-". Both mean null, never 0. */
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "-" ? null : s;
}

function num(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

/** Fail loudly. A race or runner with no id must never reach the database. */
function required(v: unknown, field: string, context: string): string {
  const s = str(v);
  if (s === null) {
    throw new Error(
      `Missing required field "${field}" on ${context}. The API shape has ` +
        `changed — re-run \`npm run probe\` before ingesting.`
    );
  }
  return s;
}

/**
 * The only correct source of race time.
 *
 * `off_dt` looks like "2026-08-26T14:15:00+01:00" — a real instant, offset
 * included. Postgres stores it as timestamptz. We never touch `off_time`.
 */
export function parseOffDt(offDt: unknown, context: string): Date {
  const s = required(offDt, "off_dt", context);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Unparseable off_dt ${JSON.stringify(s)} on ${context}.`);
  }
  return d;
}

/**
 * Convert the published 12-hour off time to 24-hour for display and slugs.
 *
 * UK racecards publish "2:15" meaning 14:15. Derived from off_dt rather than
 * guessed, so the slug and the instant can never disagree.
 */
export function offTime24(offDt: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(offDt);
}

/** "2026-08-26T14:15:00+01:00" -> "2026-08-26" in London terms. */
export function raceDateFromOffDt(offDt: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(offDt);
}

/* -------------------------------------------------------------------------- */
/* Courses                                                                     */
/* -------------------------------------------------------------------------- */

export function mapCourse(c: Raw) {
  const name = required(c.course, "course", "course");
  return {
    id: required(c.id, "id", `course ${name}`),
    name,
    slug: slugify(stripCourseSuffix(name)),
    region: str(c.region_code) ?? str(c.region),
    country: str(c.country),
  };
}

/**
 * "Kempton (AW)" -> "Kempton".
 *
 * The API appends a surface marker to the course name. It must not reach the
 * URL: the slug is generated once and is permanent, and "kempton-aw" would be
 * a different page from "kempton" forever.
 */
export function stripCourseSuffix(name: string): string {
  return name.replace(/\s*\((AW|A\.W\.)\)\s*$/i, "").trim();
}

/* -------------------------------------------------------------------------- */
/* Races — /v1/racecards/pro                                                   */
/* -------------------------------------------------------------------------- */

export function mapRace(r: Raw) {
  const id = required(r.race_id, "race_id", "race");
  const courseRaw = required(r.course, "course", `race ${id}`);
  const courseName = stripCourseSuffix(courseRaw);
  const offDt = parseOffDt(r.off_dt, `race ${id}`);
  const raceDate = raceDateFromOffDt(offDt);
  const offTime = offTime24(offDt);
  const name = required(r.race_name, "race_name", `race ${id}`);

  const going = str(r.going);
  const surfaceRaw = str(r.surface);

  return {
    id,
    courseId: str(r.course_id),
    courseName,
    courseSlug: slugify(courseName),

    raceDate,
    offTime,
    offDt,

    name,
    slug: raceSlug(offTime, name),

    distance: str(r.distance), // "0m5f0y"
    distanceRound: str(r.distance_round), // "5f" — display
    distanceF: num(r.distance_f),

    going,
    goingDetailed: str(r.going_detailed),
    goingBand: normaliseGoing(going),
    surface: isAllWeather(surfaceRaw, going) || /\(AW\)/i.test(courseRaw) ? "aw" : "turf",

    raceType: str(r.type),
    raceClass: str(r.race_class),
    pattern: str(r.pattern),
    ageBand: str(r.age_band),
    ratingBand: str(r.rating_band),
    sexRestriction: str(r.sex_restriction),

    region: str(r.region),
    stalls: str(r.stalls),
    railMovements: str(r.rail_movements),
    weather: str(r.weather),
    jumps: str(r.jumps),

    prize: str(r.prize),
    prizeValue: parsePrizePence(r.prize),
    fieldSize: int(r.field_size),

    raw: r,
  };
}

/** "£5,400" -> 540000 pence. Null rather than 0 when absent. */
export function parsePrizePence(prize: unknown): number | null {
  const s = str(prize);
  if (s === null) return null;
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/* -------------------------------------------------------------------------- */
/* Runners — /v1/racecards/pro                                                 */
/* -------------------------------------------------------------------------- */

export function mapRunner(raceId: string, h: Raw) {
  const horseId = required(h.horse_id, "horse_id", `runner in race ${raceId}`);
  const numberRaw = str(h.number);

  // Confirmed: non-runners are flagged only by number === "NR".
  const isNonRunner = numberRaw !== null && numberRaw.toUpperCase() === "NR";

  const t14 = (h.trainer_14_days ?? {}) as Raw;
  const best = bestOdds(h.odds);
  const jockey = parseJockeyClaim(str(h.jockey));
  const ofr = int(h.ofr);

  return {
    raceId,
    horseId,
    horseName: stripHorseCountry(required(h.horse, "horse", `runner ${horseId}`)),

    jockeyId: str(h.jockey_id),
    jockeyName: jockey.name, // claim stripped — see parseJockeyClaim
    jockeyClaimLbs: jockey.claimLbs,
    trainerId: str(h.trainer_id),
    trainerName: str(h.trainer),
    ownerId: str(h.owner_id),
    ownerName: str(h.owner),

    number: isNonRunner ? null : int(numberRaw),
    draw: int(h.draw),
    age: int(h.age),
    weight: str(h.lbs), // pro racecards publish lbs directly
    weightLbs: int(h.lbs),

    headgear: str(h.headgear),
    // headgear_run is its own field — "1" means first time in this headgear.
    // The old mapper regexed the headgear string itself, which conflated
    // "blinkers1" with any code ending in 1.
    headgearFirstTime: str(h.headgear_run) === "1",

    ofr,
    effectiveMark: effectiveMark(ofr, jockey.claimLbs),
    rpr: int(h.rpr),
    ts: int(h.ts),
    performanceRating: int(h.performance_rating),
    speedRating: int(h.speed_rating),

    form: str(h.form),
    lastRun: int(h.last_run),
    silkUrl: str(h.silk_url),
    comment: str(h.spotlight) ?? str(h.comment),

    trainer14Runs: int(t14.runs),
    trainer14Wins: int(t14.wins),
    trainer14Percent: num(t14.percent),
    trainerRtf: num(h.trainer_rtf),

    windSurgery: str(h.wind_surgery),
    windSurgeryRun: str(h.wind_surgery_run),

    isNonRunner,

    odds: h.odds ?? null,
    bestOddsDec: best.dec,
    bestOddsFrac: best.frac,
    bestOddsBookmaker: best.bookmaker,
    // Proposed opening price. The ingest keeps whichever it already had.
    openingOddsDec: best.dec,
    openingOddsFrac: best.frac,
    openingOddsAt: best.updatedAt ?? new Date(),
    shortestOddsDec: best.dec,
    ewPlaces: best.ewPlaces,
    ewDenom: best.ewDenom,
    oddsUpdatedAt: best.updatedAt,

    raw: h,
  };
}

/**
 * Split an apprentice or conditional claim off a jockey name.
 *
 *   "Alfie Redman(7)"  ->  { name: "Alfie Redman", claimLbs: 7 }
 *
 * The API appends the claim to the name itself. Two reasons this must be
 * separated at ingest:
 *
 * 1. URL permanence. Riders ride OUT their claim over time — 7lb, then 5, then
 *    3, then none. Left in the name, the slug changes with it, and
 *    /jockeys/taryn-langley-5 breaks the day she starts claiming 3. Observed
 *    live: "Taryn Langley(3)" had already been stored with slug
 *    "taryn-langley-5".
 * 2. The effective mark. Dan: "with the apprentice taking off 7lb, he
 *    effectively races from 55." That subtraction needs the claim as a number.
 *
 * Confirmed against the live card: 172 of 719 rides carried a marker, all on
 * the standard ladder (3, 5, 7, 10lb).
 */
export function parseJockeyClaim(name: string | null): { name: string | null; claimLbs: number | null } {
  if (!name) return { name: null, claimLbs: null };
  const m = name.match(/^(.*?)\s*\((\d{1,2})\)\s*$/);
  if (!m) return { name: name.trim(), claimLbs: null };
  const lbs = parseInt(m[2], 10);
  return { name: m[1].trim(), claimLbs: Number.isFinite(lbs) ? lbs : null };
}

/**
 * The mark a horse effectively races off once the claim is deducted.
 *
 * A 55-rated horse with a 7lb claimer runs off an effective 48.
 */
export function effectiveMark(ofr: number | null, claimLbs: number | null): number | null {
  if (ofr === null) return null;
  return claimLbs ? ofr - claimLbs : ofr;
}

/** "Goliath Power (FR)" -> "Goliath Power". Results append origin, racecards don't. */
export function stripHorseCountry(name: string): string {
  return name.replace(/\s*\((?:GB|IRE|FR|USA|GER|ITY|SPA|JPN|AUS|NZ|CAN|ARG|BRZ|SAF|UAE|TUR|POL|CZE|HUN|SWE|NOR|DEN|BEL|NED|SWI|GRE|RUS)\)\s*$/i, "").trim();
}

export interface BestOdds {
  dec: number | null;
  frac: string | null;
  bookmaker: string | null;
  ewPlaces: number | null;
  ewDenom: number | null;
  updatedAt: Date | null;
}

/**
 * Betting exchanges. Excluded from "best price".
 *
 * Probe 2026-08-26 showed these quoting 55.0 on a runner whose best genuine
 * bookmaker price was 25/1. Exchange prices are pre-commission, frequently
 * unmatched at the displayed level on small fields, and their `fractional`
 * field is just the decimal restated ("55", not "55/1"). Publishing one as the
 * price a punter can take would be plainly misleading — and on a gambling
 * affiliate site that is a compliance problem, not just a data problem.
 *
 * They stay in the `odds` jsonb; they simply never become the headline price.
 */
/**
 * Matched on a normalised PREFIX, not an exact string.
 *
 * Dan, 2026-09-08, on Dream Forever advised at 5/1: "I can't see this was ever
 * 5/1... exclude exchanges, it has to be available."
 *
 * It never was. Twenty-two genuine bookmakers had the horse between 3/1 and
 * 7/2 — thirteen of them at 10/3 — and the 5/1 came from one source,
 * "SmarketsSBK", quoting 6.00 to the decimal against Smarkets' own exchange
 * price of 6.00, Betfair Exchange 5.8 and Matchbook 5.4. It sat with the
 * exchanges and a full point clear of every real price.
 *
 * The old test was `EXCHANGES.has(name.toLowerCase())`, an exact match, so
 * "smarketssbk" was not "smarkets" and went through as a bookmaker. Punctuation
 * and spacing are now stripped and the comparison is a prefix, which catches
 * "Smarkets SBK", "SmarketsSBK", "Betfair Exchange", "BetfairExchange" and
 * anything else the feed decides to call them tomorrow.
 */
const EXCHANGES = ["matchbook", "smarkets", "betfair", "betdaq"];

/** Sportsbooks that would otherwise be caught by a Betfair prefix. */
const NOT_EXCHANGES = ["betfairsportsbook"];

function isExchange(bookmaker: string | null): boolean {
  if (bookmaker === null) return false;
  const k = bookmaker.toLowerCase().replace(/[^a-z]/g, "");
  if (NOT_EXCHANGES.includes(k)) return false;
  return EXCHANGES.some((e) => k.startsWith(e));
}

/**
 * Pick the best bookmaker price, and the each-way terms, from the odds array.
 *
 * Each-way terms are taken by consensus rather than from whichever book
 * happens to be top-priced: places and fraction are effectively a property of
 * the race, and the best-priced book often publishes none at all. Taking the
 * modal terms means a runner priced at an exchange-free best of 25/1 still
 * records the 3 places at 1/5 that every sportsbook in the list is offering.
 */
export function bestOdds(odds: unknown): BestOdds {
  const empty: BestOdds = {
    dec: null, frac: null, bookmaker: null,
    ewPlaces: null, ewDenom: null, updatedAt: null,
  };
  if (!Array.isArray(odds) || odds.length === 0) return empty;

  let best: BestOdds = empty;
  const termCounts = new Map<string, number>();

  for (const o of odds as Raw[]) {
    const bookmaker = str(o.bookmaker);
    const dec = num(o.decimal);

    // Consensus each-way terms across every sportsbook that publishes them.
    const places = int(o.ew_places);
    const denom = int(o.ew_denom);
    if (places !== null && places > 0 && denom !== null && denom > 0) {
      const key = `${places}:${denom}`;
      termCounts.set(key, (termCounts.get(key) ?? 0) + 1);
    }

    if (dec === null || dec <= 1) continue;
    if (isExchange(bookmaker)) continue;
    if (best.dec !== null && dec <= best.dec) continue;

    const updated = str(o.updated);
    // "2026-08-26 13:14:08" is London wall-clock with no offset; the space
    // separator also has to become "T" before Date will parse it reliably.
    const updatedAt = updated ? new Date(updated.replace(" ", "T") + "Z") : null;

    best = {
      dec,
      frac: str(o.fractional),
      bookmaker,
      ewPlaces: null,
      ewDenom: null,
      updatedAt: updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null,
    };
  }

  let topTerms: string | null = null;
  let topCount = 0;
  for (const [key, count] of termCounts) {
    if (count > topCount) { topTerms = key; topCount = count; }
  }
  if (topTerms) {
    const [places, denom] = topTerms.split(":").map((n) => parseInt(n, 10));
    best.ewPlaces = places;
    best.ewDenom = denom;
  }

  return best;
}

/* -------------------------------------------------------------------------- */
/* Results — /v1/results                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Result fields for an existing race row.
 *
 * Deliberately partial: it never returns `status: "upcoming"`, never rewrites
 * the slug, and never touches courseSlug/raceDate. A racecard becomes a result
 * in place, on the same URL, and a later racecard sweep must not be able to
 * revert a settled race.
 */
export function mapResultRace(r: Raw) {
  const id = required(r.race_id, "race_id", "result");
  return {
    id,
    going: str(r.going),
    winningTimeDetail: str(r.winning_time_detail),
    nonRunnersText: str(r.non_runners),
    comments: str(r.comments),
    toteWin: str(r.tote_win),
    toteCsf: str(r.tote_csf),
    status: "result" as const,
    resultAt: new Date(),
  };
}

/**
 * Result fields for an existing runner row, matched on (race_id, horse_id).
 *
 * Note the key differences from the racecard shape: `or` not `ofr`, `tsr` not
 * `ts`, `weight_lbs` not `lbs`.
 */
export function mapResultRunner(raceId: string, h: Raw) {
  const horseId = required(h.horse_id, "horse_id", `result runner in race ${raceId}`);
  const position = str(h.position);
  const jockey = parseJockeyClaim(str(h.jockey));
  const ofr = int(h.or);

  // Identity fields are included even though this is usually an UPDATE of an
  // existing runner. The historical backfill INSERTs rows that were never
  // declared here, and horse_name is NOT NULL — omitting it silently failed
  // every historical runner insert while the race insert succeeded, leaving
  // 2,476 races with no field at all.
  return {
    raceId,
    horseId,
    horseName: stripHorseCountry(required(h.horse, "horse", `result runner ${horseId}`)),
    jockeyId: str(h.jockey_id),
    jockeyName: jockey.name,
    trainerId: str(h.trainer_id),
    trainerName: str(h.trainer),
    ownerId: str(h.owner_id),
    ownerName: str(h.owner),
    number: int(h.number),
    draw: int(h.draw),
    age: int(h.age),
    headgear: str(h.headgear),
    silkUrl: str(h.silk_url),
    isNonRunner: false, // it ran; it is in the result
    effectiveMark: effectiveMark(ofr, int(h.jockey_claim_lbs) ?? jockey.claimLbs),
    position,
    positionNum: position && /^\d+$/.test(position) ? parseInt(position, 10) : null,
    beatenBy: str(h.btn),
    ovrBtn: num(h.ovr_btn),
    sp: position === null ? null : str(h.sp), // "9/4F" as published
    spDec: num(h.sp_dec),
    bsp: num(h.bsp),
    prize: str(h.prize),
    ofr,
    rpr: int(h.rpr),
    ts: int(h.tsr),
    performanceRating: int(h.performance_rating),
    speedRating: int(h.speed_rating),
    weight: str(h.weight),
    weightLbs: int(h.weight_lbs),
    jockeyClaimLbs: int(h.jockey_claim_lbs) ?? parseJockeyClaim(str(h.jockey)).claimLbs,
    comment: str(h.comment),
  };
}

/**
 * Strip the favourite marker from an SP.
 *
 * The API returns "9/4F", "5/2JF", "3/1CF". parsePrice() in lib/tips.ts would
 * reject those outright, so the marker comes off before any price parsing.
 */
export function stripFavouriteMarker(sp: string | null): string | null {
  const s = str(sp);
  return s === null ? null : s.replace(/\s*(?:J|C)?F$/i, "").trim() || null;
}

/* -------------------------------------------------------------------------- */
/* Envelopes                                                                   */
/* -------------------------------------------------------------------------- */

/** Confirmed: /racecards/pro returns { racecards: [...] }. */
export function extractRaces(payload: Raw): Raw[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.racecards)) return payload.racecards;
  if (Array.isArray(payload?.results)) return payload.results;
  throw new Error(
    "Unrecognised racecards payload: expected { racecards: [...] } or " +
      `{ results: [...] }, got keys [${Object.keys(payload ?? {}).join(", ")}].`
  );
}

/** Confirmed: runners live under `runners` on both racecards and results. */
export function extractRunners(race: Raw): Raw[] {
  if (Array.isArray(race?.runners)) return race.runners;
  throw new Error(
    `Race ${race?.race_id ?? "?"} has no runners array (keys: ` +
      `[${Object.keys(race ?? {}).join(", ")}]).`
  );
}
