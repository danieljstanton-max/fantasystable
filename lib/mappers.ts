/**
 * API response -> our schema.
 *
 * ⚠ CORRECT THIS FILE AFTER RUNNING `npm run probe`.
 *
 * These mappings were written without a live response to check against. Rather
 * than guessing one field name and breaking on a miss, each field is read
 * through `pick()`, which tries several plausible keys and returns the first
 * that exists. That makes the ingest resilient to being partly wrong, but it is
 * not a substitute for correcting it: silently reading the wrong field is worse
 * than failing loudly. Once probe output confirms the real names, collapse each
 * pick() down to the single correct key.
 */

import { raceSlug, slugify, parseDistanceFurlongs, parseWeightLbs, parseSpDecimal } from "./slug";
import { normaliseGoing, isAllWeather } from "./going";
import { fromZonedTime } from "date-fns-tz";

type Raw = Record<string, any>;

/** First key present and non-empty wins. */
function pick<T = any>(obj: Raw, keys: string[], fallback?: T): T | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return fallback;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

/**
 * Build a real instant from a race date and an off time.
 *
 * UK racing publishes local wall-clock time. Treating "14:00" as UTC puts every
 * summer countdown an hour out, which is exactly the kind of error a punter
 * notices immediately and never forgives.
 */
export function toOffInstant(raceDate: string, offTime: string): Date {
  const time = /^\d{1,2}:\d{2}$/.test(offTime) ? offTime.padStart(5, "0") : "12:00";
  return fromZonedTime(`${raceDate}T${time}:00`, "Europe/London");
}

export function mapCourse(c: Raw) {
  const name = pick<string>(c, ["course", "course_name", "name"]) ?? "Unknown";
  return {
    id: String(pick(c, ["id", "course_id"]) ?? slugify(name)),
    name,
    slug: slugify(name),
    region: pick<string>(c, ["region_code", "region"]) ?? null,
    country: pick<string>(c, ["country"]) ?? null,
  };
}

export function mapRace(r: Raw) {
  const courseName = pick<string>(r, ["course", "course_name"]) ?? "Unknown";
  const courseSlug = slugify(courseName);
  const raceDate = String(pick(r, ["date", "race_date"]) ?? "").slice(0, 10);
  const offTime = String(pick(r, ["off_time", "time", "off"]) ?? "");
  const name = pick<string>(r, ["race_name", "name"]) ?? "Race";
  const distance = pick<string>(r, ["distance", "dist", "distance_f", "distance_round"]) ?? null;
  const going = pick<string>(r, ["going", "going_detailed"]) ?? null;
  const surfaceRaw = pick<string>(r, ["surface", "type"]) ?? null;

  const prize = pick<string>(r, ["prize", "added_money"]) ?? null;

  return {
    id: String(pick(r, ["race_id", "id"])),
    courseId: pick(r, ["course_id"]) ? String(pick(r, ["course_id"])) : null,
    courseName,
    courseSlug,
    raceDate,
    offTime,
    offDt: toOffInstant(raceDate, offTime),
    name,
    slug: raceSlug(offTime, name),
    distance,
    distanceF: parseDistanceFurlongs(distance),
    going,
    goingBand: normaliseGoing(going),
    surface: isAllWeather(surfaceRaw, going) ? "aw" : "turf",
    raceType: pick<string>(r, ["type", "race_type"]) ?? null,
    raceClass: pick<string>(r, ["race_class", "class"]) ?? null,
    pattern: pick<string>(r, ["pattern", "grade"]) ?? null,
    ageBand: pick<string>(r, ["age_band", "age"]) ?? null,
    ratingBand: pick<string>(r, ["rating_band"]) ?? null,
    sexRestriction: pick<string>(r, ["sex_rest", "sex_restriction"]) ?? null,
    prize,
    prizeValue: prize ? int(prize.replace(/[£,]/g, "")) : null,
    fieldSize: int(pick(r, ["field_size", "runners_count"])),
    status: "upcoming" as const,
    raw: r,
  };
}

export function mapRunner(raceId: string, h: Raw) {
  const weight = pick<string>(h, ["lbs", "weight", "weight_lbs"]) ?? null;
  const sp = pick<string>(h, ["sp", "sp_dec", "starting_price"]) ?? null;
  const position = pick<string>(h, ["position", "pos", "finish_position"]) ?? null;
  const posNum = position && /^\d+$/.test(String(position)) ? parseInt(String(position), 10) : null;

  return {
    raceId,
    horseId: String(pick(h, ["horse_id", "id"])),
    horseName: pick<string>(h, ["horse", "horse_name", "name"]) ?? "Unknown",

    jockeyId: pick(h, ["jockey_id"]) ? String(pick(h, ["jockey_id"])) : null,
    jockeyName: pick<string>(h, ["jockey"]) ?? null,
    trainerId: pick(h, ["trainer_id"]) ? String(pick(h, ["trainer_id"])) : null,
    trainerName: pick<string>(h, ["trainer"]) ?? null,
    ownerId: pick(h, ["owner_id"]) ? String(pick(h, ["owner_id"])) : null,
    ownerName: pick<string>(h, ["owner"]) ?? null,

    number: int(pick(h, ["number", "no", "cloth_number"])),
    draw: int(pick(h, ["draw", "stall"])),
    age: int(pick(h, ["age"])),
    weight: typeof weight === "string" ? weight : null,
    weightLbs: typeof weight === "string" ? parseWeightLbs(weight) : int(weight),
    headgear: pick<string>(h, ["headgear", "hg"]) ?? null,
    headgearFirstTime: /1$|first/i.test(String(pick(h, ["headgear_run", "headgear"]) ?? "")),

    ofr: int(pick(h, ["ofr", "or", "official_rating"])),
    rpr: int(pick(h, ["rpr"])),
    ts: int(pick(h, ["ts", "topspeed"])),

    form: pick<string>(h, ["form"]) ?? null,
    lastRun: int(pick(h, ["last_run", "days_since_last_run"])),
    silkUrl: pick<string>(h, ["silk_url", "silk"]) ?? null,
    comment: pick<string>(h, ["comment", "spotlight", "analyst_comment"]) ?? null,

    isNonRunner: Boolean(pick(h, ["is_non_runner", "non_runner"], false)),
    odds: pick(h, ["odds", "prices"]) ?? null,

    position: position ? String(position) : null,
    positionNum: posNum,
    beatenBy: pick<string>(h, ["btn", "beaten_by"]) ?? null,
    ovrBtn: num(pick(h, ["ovr_btn", "overall_beaten"])),
    sp: sp ? String(sp) : null,
    spDec: parseSpDecimal(sp ? String(sp) : null),

    raw: h,
  };
}

/** The runners array has appeared under different keys across tiers. */
export function extractRunners(race: Raw): Raw[] {
  for (const key of ["runners", "horses", "entries", "declarations"]) {
    if (Array.isArray(race?.[key])) return race[key];
  }
  return [];
}

/** The racecards array likewise. */
export function extractRaces(payload: Raw): Raw[] {
  if (Array.isArray(payload)) return payload;
  for (const key of ["racecards", "races", "results", "data"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}
