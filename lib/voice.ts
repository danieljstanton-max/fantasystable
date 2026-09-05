/**
 * The phrases the write-ups open a selection with.
 *
 * These live here, in one place, because two things need them and they must
 * never disagree: write-ups.ts generates them, and preflight.ts parses them
 * back out to check that every best bet is also the write-up's selection.
 *
 * When the openers were added to the generator and not to the checker, all
 * five best bets were reported as "not the write-up selection for its race" —
 * the check was not wrong about the data, it simply could not see sentences it
 * had never been told about. That is the same failure as the 60-run history
 * cap: a verifier that shares, or in this case lags, its subject's assumptions
 * is not a verifier.
 *
 * Adding a phrase here adds it to both.
 */

/** The horse is well handicapped AND the conditions match what it wins on. */
export const OPENERS_PRIME = [
  "is the one — exactly the sort of race we are looking for",
  "is the bet, and this is the profile the whole thing is built around",
  "is the one I want to be on here",
  "is the standout, and this is exactly the sort of race to find one",
  "gets the vote, and it is the kind of race we wait for",
];

/** A handicap case, but the conditions are not the full house. */
export const OPENERS_ELIGIBLE = [
  "makes most appeal",
  "is the one I keep coming back to",
  "is the one that stands out",
  "gets the vote",
  "is the one I would be with",
];

/** No handicap case — picked on the rest of the evidence. */
export const OPENERS_PLAIN = [
  "looks the pick of these",
  "looks the one to be on",
  "is the one I would side with",
  "just about gets the nod",
  "looks the most likely of these",
  "is the one I make it",
];

/**
 * The opener for a selection Dan has put in by hand.
 *
 * One phrase, not a list: a hand pick is rare and should sound the same every
 * time, so a reader learns to recognise it.
 *
 * It lives here for the reason this whole module exists. On 2026-09-04 it was
 * written straight into scripts/write-ups.ts, and the pre-flight files-agree
 * check — which finds a selection sentence by matching against these openers —
 * could not see it. The best bet was reported as missing from its own write-up
 * and a clean card was held as a draft. Exactly the failure the comment in
 * preflight.ts already described. Generation and parsing read one list.
 */
export const OPENER_HAND = "is one I have taken on myself here";

export const ALL_OPENERS = [
  ...OPENERS_PRIME,
  ...OPENERS_ELIGIBLE,
  ...OPENERS_PLAIN,
  OPENER_HAND,
];

/**
 * Deterministic choice.
 *
 * Seeded on the horse and the race, never random: the same race produces the
 * same sentence on every run, so republishing a day does not silently reword
 * it. Variety across the card, stability down the day.
 */
export function pickOpener(options: string[], seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return options[h % options.length];
}

/** Alternation for a parser that has to find the opener again. */
export function openerAlternation(): string {
  return ALL_OPENERS
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length)
    .join("|");
}
