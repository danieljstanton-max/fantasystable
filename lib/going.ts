/**
 * The going scale.
 *
 * Going is the single most decisive variable in British racing and it is the
 * thing every punter checks first. It is also an ordered scale, which means it
 * can carry colour meaningfully rather than decoratively: the chips run wet-to-
 * dry, so a card can be read for ground at a glance without reading a word.
 *
 * This is the site's signature UI element. It is used consistently everywhere
 * going appears — meeting headers, race headers, and later the model's
 * going-preference indicator on each runner.
 */

export type GoingBand =
  | "heavy"
  | "soft"
  | "good-soft"
  | "good"
  | "good-firm"
  | "firm"
  | "standard"
  | "unknown";

export const GOING_ORDER: GoingBand[] = [
  "heavy",
  "soft",
  "good-soft",
  "good",
  "good-firm",
  "firm",
  "standard",
];

/** Normalise the many published variants into a fixed band. */
export function normaliseGoing(going?: string | null): GoingBand {
  if (!going) return "unknown";
  const s = going.toLowerCase().replace(/[()]/g, " ").replace(/\s+/g, " ").trim();

  // All-weather surfaces publish standard / standard to slow / standard to fast
  if (s.includes("standard")) return "standard";
  if (s.includes("slow")) return "standard";
  if (s.includes("fast")) return "standard";

  if (s.includes("heavy")) return "heavy";
  if (s.includes("good to firm") || s.includes("good/firm")) return "good-firm";
  if (s.includes("good to soft") || s.includes("good/soft")) return "good-soft";
  if (s.includes("firm")) return "firm";
  if (s.includes("soft")) return "soft";
  if (s.includes("yielding")) return "good-soft"; // Irish
  if (s.includes("good")) return "good";
  return "unknown";
}

export const GOING_LABEL: Record<GoingBand, string> = {
  heavy: "Heavy",
  soft: "Soft",
  "good-soft": "Good to soft",
  good: "Good",
  "good-firm": "Good to firm",
  firm: "Firm",
  standard: "Standard",
  unknown: "Going TBC",
};

/**
 * Wet ground is dark and saturated; dry ground is pale and dusty. All-weather
 * sits outside the turf scale entirely, so it gets the neutral slate rather
 * than a position on it — pretending Tapeta belongs on the same axis as turf
 * would be a lie the colour system tells.
 */
export const GOING_STYLE: Record<GoingBand, { bg: string; fg: string }> = {
  heavy: { bg: "#2F3D2A", fg: "#E8EDE2" },
  soft: { bg: "#4E6238", fg: "#F0F4E8" },
  "good-soft": { bg: "#7C8F4E", fg: "#1B1F14" },
  good: { bg: "#A8B06A", fg: "#1B1F14" },
  "good-firm": { bg: "#D2C285", fg: "#2A2415" },
  firm: { bg: "#E8D9A8", fg: "#3A3116" },
  standard: { bg: "#5A6570", fg: "#EEF2F5" },
  unknown: { bg: "#D8D4CC", fg: "#4A453C" },
};

export function isAllWeather(surface?: string | null, going?: string | null): boolean {
  const s = `${surface ?? ""} ${going ?? ""}`.toLowerCase();
  return /tapeta|polytrack|fibresand|all.?weather|\baw\b|standard/.test(s);
}
