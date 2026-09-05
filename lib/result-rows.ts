/**
 * Turning one result payload into the rows we store.
 *
 * Shared because two jobs need exactly the same shape and must not drift: the
 * historical backfill, which walks a year of results and horse form lines, and
 * the daily results ingest, which settles yesterday's racing. If those two
 * built rows differently, a race would mean one thing depending on which job
 * happened to reach it first.
 *
 * A result is not a racecard. `/results` names the same concepts differently —
 * `off`/`dist`/`class` rather than `off_time`/`distance_f`/`race_class` — which
 * is why the mapping lives in mapResultRace/mapResultRunner and the race row is
 * assembled from what a result actually carries rather than by pretending it is
 * a card.
 */
import { mapResultRace, mapResultRunner, offTime24, raceDateFromOffDt, stripCourseSuffix } from "./mappers";
import { slugify, raceSlug } from "./slug";
import { normaliseGoing } from "./going";

export type ResultRows = { race: Record<string, unknown>; runners: Record<string, unknown>[] };

/**
 * Build the race and runner rows for one settled race.
 *
 * Returns null when the payload has no usable off time — without it we cannot
 * place the race on a day, and a race with the wrong date is worse than one we
 * skipped and picked up on the next sweep.
 */
export function buildResultRows(raw: any): ResultRows | null {
  const result = mapResultRace(raw);
  const runners = (raw.runners ?? []).map((h: any) => mapResultRunner(result.id, h));

  const offDt = raw.off_dt ? new Date(raw.off_dt) : null;
  if (!offDt || Number.isNaN(offDt.getTime())) return null;

  const courseName = stripCourseSuffix(raw.course ?? "Unknown");
  const offTime = offTime24(offDt);

  return {
    race: {
      id: result.id,
      courseId: raw.course_id ?? null,
      courseName,
      courseSlug: slugify(courseName),
      raceDate: raceDateFromOffDt(offDt),
      offTime,
      offDt,
      name: raw.race_name ?? "Race",

      // The slug is generated once and stored. A race URL that changes after
      // Google has indexed it costs the page, so this is only ever used for a
      // race we have not seen before — the upsert below never overwrites it.
      slug: raceSlug(offTime, raw.race_name ?? "Race"),

      distance: raw.dist ?? null,
      distanceF: raw.dist_f ? parseFloat(String(raw.dist_f)) : null,
      going: raw.going ?? null,
      goingBand: normaliseGoing(raw.going),
      surface: /aw|polytrack|tapeta|fibresand/i.test(raw.surface ?? "") ? "aw" : "turf",
      raceType: raw.type ?? null,
      raceClass: raw.class ?? null,
      pattern: raw.pattern ?? null,
      ageBand: raw.age_band ?? null,
      ratingBand: raw.rating_band ?? null,
      sexRestriction: raw.sex_rest ?? null,
      region: raw.region ?? null,
      fieldSize: (raw.runners ?? []).length,
      status: "result",
      resultAt: new Date(),
      winningTimeDetail: raw.winning_time_detail ?? null,
      nonRunnersText: raw.non_runners ?? null,
      comments: raw.comments ?? null,
      raw,
    },
    runners,
  };
}
