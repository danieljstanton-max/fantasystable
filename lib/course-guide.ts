/**
 * Dan's course and going cheat sheet, as a lookup.
 *
 * Dan, 2026-09-01: "I have built a course and going cheat sheet - please use
 * this moving forward daily and write into our model."
 *
 * What this is and is not. The sheet is prose: track shape, how a course rides
 * on each going band, the main trap, the quick angle. None of it is a number
 * that can be added to a score, and pretending otherwise would mean inventing
 * weights the sheet does not contain. So it does not touch scoring. It is
 * carried into the files so that every selection is read next to what its track
 * actually does — which is exactly the gap that let Annandale become a NAP on
 * Hamilton heavy without anyone seeing the problem.
 *
 * The draw section is deliberately kept as a cross-check rather than a
 * replacement. We compute draw IV ourselves from our own database, per course,
 * surface, distance and going. Dan's runs 1 Jun 2023 to 9 Jun 2026 over a
 * coarser split. Two sources disagreeing is information; silently preferring
 * one of them is not.
 *
 * Regenerate with:
 *   python3 scripts/import-course-guide.py ~/Downloads/UK_Ireland_Racecourse_Cheat_Sheet.xlsx
 */
import guide from "../data/course-guide.json";
import type { GoingBand } from "./going";

export interface CourseDraw {
  surface: string;
  races: string;
  sprint: string;
  mile: string;
  middle: string;
  staying: string;
  confidence: string;
  reading: string;
}

export interface CourseGuide {
  course: string;
  nation: string;
  code: string;
  surfaces: string;
  direction: string;
  profile: string;
  pace: string;
  drawHeadline: string;
  angle: string;
  trap: string;
  groundNote: string;
  confidence: string;
  going: { firm: string; good: string; soft: string; heavy: string };
  draw: CourseDraw[];
}

const COURSES = (guide as { courses: CourseGuide[] }).courses;

/**
 * Match our course names to the sheet's.
 *
 * The API gives us "Navan (IRE)" and "Newmarket (July)"; the sheet lists plain
 * "Navan" and a single "Newmarket". Country and meeting suffixes are stripped,
 * and a small table covers the handful of genuine name differences. Anything
 * still unmatched returns null rather than guessing — a wrong course note is
 * worse than none, because it reads as authoritative.
 */
const ALIASES: Record<string, string> = {
  "the curragh": "Curragh",
  "bangor on dee": "Bangor-on-Dee",
  "bangor": "Bangor-on-Dee",
  "chelmsford": "Chelmsford City",
  "ffos las": "Ffos Las",
  "gowran": "Gowran Park",
  "market rasen": "Market Rasen",
  "newton abbot": "Newton Abbot",
  "down royal": "Down Royal",
  // The API calls it Epsom Downs; the sheet, and everyone else, calls it Epsom.
  "epsom downs": "Epsom",
};

const key = (s: string) =>
  s.toLowerCase()
    .replace(/\s*\((?:ire|gb|uk|fr|usa|aus|sa|uae|july|rowley|aw|all[- ]weather)\)\s*/gi, " ")
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const BY_KEY = new Map<string, CourseGuide>();
for (const c of COURSES) BY_KEY.set(key(c.course), c);

export function courseGuide(courseName?: string | null): CourseGuide | null {
  if (!courseName) return null;
  const k = key(courseName);
  return BY_KEY.get(k) ?? BY_KEY.get(key(ALIASES[k] ?? "")) ?? null;
}

/**
 * What the sheet says about this course on today's ground.
 *
 * The sheet has four turf columns. Our bands are finer, so good-to-firm reads
 * off "firm / fast" and good-to-soft off "good" — easing ground is not yet the
 * stamina test the "soft" column describes, and claiming it is would overstate
 * the case. All-weather has no turf column at all: the sheet's own Read Me says
 * to use the surface note there, so that is what comes back.
 */
export function goingNote(g: CourseGuide | null, band: GoingBand): string | null {
  if (!g) return null;
  const col =
    band === "heavy" ? g.going.heavy
    : band === "soft" ? g.going.soft
    : band === "good-soft" || band === "good" ? g.going.good
    : band === "good-firm" || band === "firm" ? g.going.firm
    : null;
  return (col || g.groundNote || null) || null;
}

/**
 * Which draw third Dan's sheet favours at this course and trip, if any.
 *
 * Returns the third ("low" | "middle" | "high") and the sheet's IV, or null
 * where the sheet has no row, no surface match, or a dash for that distance.
 * Rows read "Low 1.24", "High 1.16", occasionally "Low/Mid 1.11" — the first
 * named third is taken and the pair is reported as it is written.
 */
export function sheetDraw(
  g: CourseGuide | null,
  surface: string | null | undefined,
  furlongs: number | null
): { third: "low" | "middle" | "high"; iv: number; text: string; confidence: string } | null {
  if (!g || !g.draw.length || furlongs === null) return null;

  // A course can appear more than once — Lingfield turf and Lingfield Polytrack
  // are different tracks wearing one name, and the sheet's own stated trap at
  // Newcastle is "using old turf-flat draw assumptions on Tapeta". So the
  // surface is matched by kind, never by string overlap: the API says "turf" or
  // "aw", the sheet says Turf, Polytrack or Tapeta.
  //
  // No fallback to "the only row" once the surface is known. A course with a
  // single Turf row that we are racing on the all-weather returns nothing,
  // which is the correct answer — the earlier version got Newcastle right by
  // accident because its one row happened to be the Tapeta one.
  const want = (surface ?? "").toLowerCase();
  const isTurfRow = (d: CourseDraw) => d.surface.toLowerCase().includes("turf");
  const row =
    want === "turf" ? g.draw.find(isTurfRow) ?? null
    : want === "aw" ? g.draw.find((d) => !isTurfRow(d)) ?? null
    : g.draw.length === 1 ? g.draw[0]
    : null;
  if (!row) return null;

  const cell =
    furlongs <= 6.5 ? row.sprint
    : furlongs <= 8.5 ? row.mile
    : furlongs <= 12.5 ? row.middle
    : row.staying;
  if (!cell || cell === "—" || cell === "-") return null;

  const m = /^(low|mid(?:dle)?|high)/i.exec(cell.trim());
  const iv = Number(/([\d.]+)\s*$/.exec(cell)?.[1] ?? NaN);
  if (!m || !Number.isFinite(iv)) return null;
  const word = m[1].toLowerCase();
  return {
    third: word === "high" ? "high" : word === "low" ? "low" : "middle",
    iv,
    text: cell.trim(),
    confidence: row.confidence,
  };
}

/** Which third of the field a stall sits in. */
export function drawThird(draw: number, field: number): "low" | "middle" | "high" | null {
  if (!Number.isFinite(draw) || draw < 1 || field < 6) return null;
  const t = Math.ceil((draw / field) * 3);
  return t <= 1 ? "low" : t === 2 ? "middle" : "high";
}
