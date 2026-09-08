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

/**
 * A horse in the middle of a winning run, and the rise that came with it.
 *
 * Dan, 2026-09-08: "a streak needs to be written as — he is in hot form and won
 * his last 2 — a X amount of rise still might not be able to stop him — but mix
 * the wording up so [it is] not so repetitive."
 *
 * Sixteen selections across twelve days were horses on a run of wins where the
 * write-up never mentioned it once, including one that had won its last four.
 * Nothing false was printed; the best fact in the form was simply left out.
 *
 * Written as a positive with the rise acknowledged rather than as a warning —
 * a handicapper putting a horse up is the price of being in form, not evidence
 * against it. Five phrasings, chosen on a seed so the same horse reads the same
 * way on every re-run but a card does not repeat itself.
 *
 * {n} is the streak word ("two", "three"), {lb} the rise in pounds.
 */
export const STREAK_LINES = [
  "He is in hot form, winning his last {n}, and a {lb}lb rise might not be enough to stop him.",
  "He has won his last {n} and is clearly going the right way — the handicapper has taken {lb}lb for it, but a horse in this mood takes some beating.",
  "Winning his last {n} tells you he is thriving, and while {lb}lb more is a real ask, momentum counts for plenty.",
  "He arrives on the back of {n} straight wins. The {lb}lb rise is the obvious worry, though he has been beating that sort of raise all summer.",
  "{n} wins on the bounce, and up {lb}lb for the trouble — but a horse in form is a different animal to one trying to recapture it.",
];

/** "two", "three", … for a streak length. */
export function streakWord(n: number): string {
  return ["", "one", "two", "three", "four", "five", "six"][n] ?? String(n);
}

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
