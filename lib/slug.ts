/**
 * URL slugs. These become permanent — a race URL that changes after Google has
 * indexed it costs you the page. Generate once at ingest, store in the DB,
 * never recompute at render time.
 */

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Race slug: "14-00-coral-handicap-chase"
 *
 * Time first, because it makes the URL self-sorting and it is what a punter
 * recognises. Sponsor names are stripped — they change annually and would
 * otherwise force a new URL every season for the same race.
 */
const SPONSOR_NOISE =
  /\b(bet365|betfair|coral|ladbrokes|william ?hill|paddy ?power|sky ?bet|betvictor|unibet|boylesports|quinnbet|midnite|tote|racing ?tv|attheraces|sponsored by|in association with)\b/gi;

export function raceSlug(offTime: string, raceName: string): string {
  const time = offTime.replace(":", "-").padStart(5, "0");
  const cleaned = raceName
    .replace(SPONSOR_NOISE, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Cap length. Long race titles produce unwieldy URLs with no ranking benefit.
  const words = slugify(cleaned).split("-").filter(Boolean).slice(0, 7);
  const tail = words.join("-");
  return tail ? `${time}-${tail}` : time;
}

export function raceUrl(courseSlug: string, raceDate: string, slug: string): string {
  return `/racecards/${courseSlug}/${raceDate}/${slug}`;
}

export function meetingUrl(courseSlug: string, raceDate: string): string {
  return `/racecards/${courseSlug}/${raceDate}`;
}

/** Parse "1m 2f 42y" or "6f" or "2m4f" into decimal furlongs. */
export function parseDistanceFurlongs(distance?: string | null): number | null {
  if (!distance) return null;
  const s = distance.toLowerCase();
  const miles = /(\d+(?:\.\d+)?)\s*m(?![a-z])/.exec(s);
  const furlongs = /(\d+(?:\.\d+)?)\s*f/.exec(s);
  const yards = /(\d+(?:\.\d+)?)\s*y/.exec(s);
  if (!miles && !furlongs && !yards) return null;
  return (
    (miles ? parseFloat(miles[1]) * 8 : 0) +
    (furlongs ? parseFloat(furlongs[1]) : 0) +
    (yards ? parseFloat(yards[1]) / 220 : 0)
  );
}

/** Parse "9-07" (stone-pounds) into total pounds. */
export function parseWeightLbs(weight?: string | null): number | null {
  if (!weight) return null;
  const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(weight.trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 14 + parseInt(m[2], 10);
}

/** Fractional or decimal SP -> decimal. "11/2" -> 6.5, "evens" -> 2.0 */
export function parseSpDecimal(sp?: string | null): number | null {
  if (!sp) return null;
  const s = sp.trim().toLowerCase();
  if (s === "evens" || s === "evs" || s === "1/1") return 2;
  const frac = /^(\d+)\s*[/-]\s*(\d+)$/.exec(s);
  if (frac) return parseInt(frac[1], 10) / parseInt(frac[2], 10) + 1;
  const dec = parseFloat(s);
  return Number.isFinite(dec) ? dec : null;
}
