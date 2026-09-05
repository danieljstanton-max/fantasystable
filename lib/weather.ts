/**
 * Rainfall, and what it is likely to do to the ground.
 *
 * The racecard's going is whatever the clerk said when the card was published,
 * frequently the previous morning. On a wet night that reading is stale for the
 * whole meeting, and every "proven on the ground" signal inherits the error.
 *
 * There is also an edge in it. The market prices off the published going for
 * some hours after rain has fallen. Knowing a Good card will ride Soft before
 * the clerk says so is worth a price.
 *
 * This does not predict the going. Ground response depends on drainage,
 * watering and how dry it was underneath, none of which we hold. It projects
 * from rainfall against thresholds, marks the result as a projection, and
 * leaves the clerk's own update as the authority.
 *
 * Rainfall from Open-Meteo — no key, CC-BY.
 */
import { GOING_ORDER, normaliseGoing, isAllWeather, type GoingBand } from "./going";

/**
 * Course positions, approximate to the track. Rainfall is reported on a grid
 * far coarser than the distance from a grandstand to a back straight.
 */
export const COURSE_LATLON: Record<string, [number, number]> = {
  "ascot": [51.410, -0.680], "ayr": [55.450, -4.610], "bangor-on-dee": [52.990, -2.920],
  "bath": [51.400, -2.420], "beverley": [53.850, -0.450], "brighton": [50.830, -0.100],
  "carlisle": [54.910, -2.960], "cartmel": [54.200, -2.960], "catterick": [54.380, -1.630],
  "chelmsford": [51.740, 0.470], "cheltenham": [51.930, -2.060], "chepstow": [51.640, -2.680],
  "chester": [53.190, -2.900], "doncaster": [53.510, -1.100], "epsom": [51.310, -0.250],
  "exeter": [50.680, -3.480], "ffos las": [51.730, -4.260], "fontwell": [50.850, -0.650],
  "goodwood": [50.890, -0.750], "hamilton": [55.790, -4.050], "haydock": [53.480, -2.630],
  "hexham": [54.970, -2.130], "huntingdon": [52.340, -0.180], "kempton": [51.410, -0.410],
  "leicester": [52.600, -1.080], "lingfield": [51.170, -0.010], "ludlow": [52.390, -2.720],
  "market rasen": [53.390, -0.330], "musselburgh": [55.940, -3.050], "newbury": [51.400, -1.300],
  "newcastle": [55.010, -1.660], "newmarket": [52.240, 0.400], "newton abbot": [50.530, -3.610],
  "nottingham": [52.940, -1.100], "perth": [56.420, -3.440], "plumpton": [50.920, -0.070],
  "pontefract": [53.700, -1.310], "redcar": [54.610, -1.070], "ripon": [54.140, -1.520],
  "salisbury": [51.060, -1.830], "sandown": [51.390, -0.360], "sedgefield": [54.650, -1.440],
  "southwell": [53.080, -0.930], "stratford": [52.180, -1.710], "taunton": [51.010, -3.110],
  "thirsk": [54.230, -1.350], "uttoxeter": [52.900, -1.870], "warwick": [52.280, -1.600],
  "wetherby": [53.930, -1.380], "wincanton": [51.050, -2.400], "windsor": [51.480, -0.620],
  "wolverhampton": [52.590, -2.130], "worcester": [52.200, -2.230], "yarmouth": [52.610, 1.710],
  "york": [53.950, -1.100],

  "ballinrobe": [53.630, -9.220], "bellewstown": [53.680, -6.310], "clonmel": [52.340, -7.720],
  "cork": [51.910, -8.700], "curragh": [53.160, -6.840], "down royal": [54.510, -6.090],
  "downpatrick": [54.350, -5.720], "dundalk": [53.980, -6.440], "fairyhouse": [53.480, -6.480],
  "galway": [53.270, -9.020], "gowran park": [52.630, -7.070], "kilbeggan": [53.370, -7.500],
  "killarney": [52.060, -9.520], "leopardstown": [53.270, -6.190], "limerick": [52.590, -8.500],
  "listowel": [52.450, -9.480], "naas": [53.210, -6.680], "navan": [53.660, -6.700],
  "punchestown": [53.180, -6.640], "roscommon": [53.630, -8.200], "sligo": [54.270, -8.480],
  "tipperary": [52.470, -8.140], "tramore": [52.170, -7.150], "wexford": [52.340, -6.480],
};

export type Rainfall = {
  yesterday: number;
  overnight: number;
  morning: number;
  duringRacing: number;
  /** Everything that has fallen before the first race. */
  beforeRacing: number;
  /** The two days before yesterday — how wet the ground already was. */
  priorDays: number;
  /**
   * What the ground has effectively taken. Rain falling on already-wet ground
   * moves the going further than the same rain on dry ground, so earlier
   * rainfall carries at half weight rather than being ignored.
   */
  effective: number;
};

export type GoingProjection = {
  course: string;
  declared: string | null;
  declaredBand: GoingBand;
  projectedBand: GoingBand;
  /** How many steps wetter, on the turf scale. */
  steps: number;
  rain: Rainfall;
  allWeather: boolean;
  note: string;
  /** True where the projection differs from what was declared. */
  changed: boolean;
  /**
   * Cumulative effective millimetres by hour on raceday, "HH:00" -> mm.
   *
   * Rain during the card matters: an afternoon of it means the last race is not
   * run on the ground the first was. One going per meeting is wrong whenever it
   * rains after the first, and wrong in the direction that costs money — the
   * later races ride softer than the card says.
   */
  byHour: Record<string, number>;
};

/**
 * Rainfall thresholds, in effective millimetres.
 *
 * The earlier version treated 12–25mm as a single step, which read 19mm at
 * Wexford as good-to-soft when the ground was going to ride soft. Two things
 * were wrong: the bands were too wide, and rain falling on already-wet ground
 * was counted the same as rain on dry ground.
 *
 * These are the numbers to argue with. Ground response varies enormously by
 * track — a free-draining course takes 15mm without blinking, a heavy-clay one
 * changes on 8mm — and we hold no drainage data, so this is a single curve for
 * every course. Where it is wrong for a track you know, --going overrules it.
 */
function stepsFor(mm: number): { steps: number; note: string } {
  if (mm < 2) return { steps: 0, note: "negligible rain" };
  if (mm < 5) return { steps: 0, note: "light rain, may ease the surface without changing the description" };
  if (mm < 12) return { steps: 1, note: "enough rain to move the going a step" };
  if (mm < 25) return { steps: 2, note: "sustained rain, two steps — good becomes soft" };
  if (mm < 40) return { steps: 3, note: "heavy rain, three steps" };
  return { steps: 4, note: "very heavy rain, bottomless ground likely" };
}

/** One step wetter on the turf scale. Standard (all-weather) never moves. */
function wetter(band: GoingBand, steps: number): GoingBand {
  if (steps <= 0 || band === "standard" || band === "unknown") return band;
  const i = GOING_ORDER.indexOf(band);
  if (i === -1) return band;
  // GOING_ORDER runs heavy -> firm, so wetter means a lower index.
  return GOING_ORDER[Math.max(0, i - steps)] ?? band;
}

async function fetchRain(
  lat: number,
  lon: number,
  date: string
): Promise<{ rain: Rainfall; byHour: Record<string, number> }> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=precipitation&past_days=3&forecast_days=3&timezone=Europe%2FLondon`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);

  const j: any = await res.json();
  const times: string[] = j.hourly.time;
  const mm: number[] = j.hourly.precipitation;

  const sum = (from: string, to: string) =>
    times.reduce((a, t, i) => (t >= from && t < to ? a + (mm[i] ?? 0) : a), 0);

  const prev = new Date(new Date(`${date}T00:00:00Z`).getTime() - 86400000)
    .toISOString().slice(0, 10);

  const yesterday = sum(`${prev}T00:00`, `${prev}T18:00`);
  const overnight = sum(`${prev}T18:00`, `${date}T07:00`);
  const morning = sum(`${date}T07:00`, `${date}T13:00`);
  const duringRacing = sum(`${date}T13:00`, `${date}T22:00`);

  const twoBefore = new Date(new Date(`${date}T00:00:00Z`).getTime() - 3 * 86400000)
    .toISOString().slice(0, 10);
  const priorDays = sum(`${twoBefore}T00:00`, `${prev}T00:00`);

  const beforeRacing = yesterday + overnight + morning;

  // Cumulative effective mm at each hour of raceday, from 12:00 to 22:00.
  // Everything before the card is already in; racing-hour rain accumulates.
  const byHour: Record<string, number> = {};
  const carried = beforeRacing + priorDays * 0.5;

  for (let h = 12; h <= 22; h++) {
    const hh = String(h).padStart(2, "0");
    byHour[`${hh}:00`] = carried + sum(`${date}T13:00`, `${date}T${hh}:00`);
  }

  return {
    rain: {
      yesterday, overnight, morning, duringRacing, beforeRacing, priorDays,
      effective: carried,
    },
    byHour,
  };
}

/**
 * Project the going for one course.
 *
 * Returns the declared band unchanged where there is no rain, no coordinates,
 * or the surface is all-weather.
 */
export async function projectGoing(
  course: string,
  declared: string | null,
  surface: string | null,
  date: string
): Promise<GoingProjection> {

  const declaredBand = normaliseGoing(declared);
  const allWeather = isAllWeather(surface, declared);

  const zero: Rainfall = {
    yesterday: 0, overnight: 0, morning: 0, duringRacing: 0,
    beforeRacing: 0, priorDays: 0, effective: 0,
  };
  const base: GoingProjection = {
    course, declared, declaredBand, projectedBand: declaredBand,
    steps: 0, rain: zero, allWeather, note: "", changed: false, byHour: {},
  };

  const pos = COURSE_LATLON[course.trim().toLowerCase()];
  if (!pos) return { ...base, note: "no coordinates on file" };

  let rain: Rainfall;
  let byHour: Record<string, number>;
  try {
    const r = await fetchRain(pos[0], pos[1], date);
    rain = r.rain;
    byHour = r.byHour;
  } catch (e) {
    // A weather outage must never stop the day's tips being written.
    return { ...base, note: `rainfall unavailable (${(e as Error).message})` };
  }

  if (allWeather) {
    return { ...base, rain, byHour, note: "all-weather — rain does not change the surface" };
  }

  const { steps, note } = stepsFor(rain.effective);
  const projectedBand = wetter(declaredBand, steps);

  return {
    ...base,
    rain,
    byHour,
    steps,
    projectedBand,
    note,
    changed: projectedBand !== declaredBand,
  };
}

/** Project every course on a card, in parallel. */
export async function projectCard(
  meetings: { course: string; going: string | null; surface: string | null }[],
  date: string
): Promise<Map<string, GoingProjection>> {
  const out = new Map<string, GoingProjection>();
  const results = await Promise.all(
    meetings.map((m) => projectGoing(m.course, m.going, m.surface, date))
  );
  results.forEach((r) => out.set(r.course, r));
  return out;
}

/**
 * Apply manual going overrides.
 *
 *   --going "Wexford=soft" --going "Ffos Las=good-soft"
 *
 * A rainfall model does not know how a track drains, whether it has been
 * watered, or what the clerk walked this morning. Someone who knows the course
 * should be able to overrule it, and that judgement should flow through the
 * scoring exactly as the projection does — not be patched in afterwards.
 */
export function applyGoingOverrides(
  projections: Map<string, GoingProjection>,
  argv: string[]
): Map<string, GoingProjection> {

  const pairs: [string, string][] = [];
  argv.forEach((a, i) => {
    const raw = a === "--going" ? argv[i + 1] : a.startsWith("--going=") ? a.slice(8) : null;
    if (!raw) return;
    const eq = raw.lastIndexOf("=");
    if (eq > 0) pairs.push([raw.slice(0, eq).trim(), raw.slice(eq + 1).trim()]);
  });

  for (const [course, wanted] of pairs) {
    const band = normaliseGoing(wanted);
    if (band === "unknown") {
      console.error(`  going override ignored — "${wanted}" is not a going I recognise`);
      continue;
    }

    const key = [...projections.keys()].find(
      (k) => k.toLowerCase() === course.toLowerCase()
    );

    const existing = key ? projections.get(key)! : null;

    const next: GoingProjection = existing
      ? { ...existing, projectedBand: band, changed: band !== existing.declaredBand,
          // Clearing byHour makes bandAtOff fall back to this single value, so
          // a hand-set going is not silently overridden by the hourly curve.
          byHour: {},
          note: `set by hand (rainfall read ${existing.projectedBand})` }
      : { course, declared: null, declaredBand: "unknown", projectedBand: band,
          steps: 0, allWeather: false, changed: true, note: "set by hand", byHour: {},
          rain: { yesterday: 0, overnight: 0, morning: 0, duringRacing: 0,
                  beforeRacing: 0, priorDays: 0, effective: 0 } };

    projections.set(key ?? course, next);
  }

  return projections;
}

/**
 * The going projected for one race, by its off time.
 *
 * Falls back to the meeting-wide projection where there is no hourly data —
 * a weather outage, an all-weather card, or a course with no coordinates.
 */
export function bandAtOff(
  projection: GoingProjection | undefined,
  offTime: string | null
): GoingBand | null {
  if (!projection) return null;
  if (projection.allWeather) return projection.declaredBand;
  if (!offTime || !Object.keys(projection.byHour).length) return projection.projectedBand;

  const hour = parseInt(offTime.slice(0, 2), 10);
  if (!Number.isFinite(hour)) return projection.projectedBand;

  // Clamp to the hours we hold; a 12:20 race uses the pre-racing total.
  const hh = String(Math.min(22, Math.max(12, hour))).padStart(2, "0");
  const mm = projection.byHour[`${hh}:00`];
  if (mm === undefined) return projection.projectedBand;

  return wetter(projection.declaredBand, stepsFor(mm).steps);
}

/**
 * Does the ground change across the card?
 *
 * Returns the first and last projected bands where they differ, so a write-up
 * can warn that the last race will not be run on the ground of the first.
 */
export function changesDuringCard(
  projection: GoingProjection,
  offTimes: string[]
): { from: GoingBand; to: GoingBand } | null {
  if (projection.allWeather || offTimes.length < 2) return null;

  const sorted = [...offTimes].sort();
  const first = bandAtOff(projection, sorted[0]);
  const last = bandAtOff(projection, sorted[sorted.length - 1]);

  return first && last && first !== last ? { from: first, to: last } : null;
}
