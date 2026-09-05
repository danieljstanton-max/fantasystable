/**
 * Client for The Racing API.
 *
 * Auth is HTTP Basic using the username/password pair from your dashboard.
 * Credentials come from environment variables and are never logged — if you
 * add debug logging here, redact the Authorization header.
 */

const BASE = process.env.RACING_API_BASE ?? "https://api.theracingapi.com";

/**
 * The regions we cover. Passed as an array so apiGet repeats the parameter —
 * the API rejects a comma-joined value outright. Leaving the filter off
 * entirely also returns French racing, which we do not want.
 */
export const REGIONS = ["gb", "ire"] as const;

function authHeader(): string {
  const user = process.env.RACING_API_USERNAME;
  const pass = process.env.RACING_API_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      "RACING_API_USERNAME and RACING_API_PASSWORD must be set. Copy .env.example to .env.local."
    );
  }
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export class RacingApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public path: string,
    public body?: string
  ) {
    super(message);
    this.name = "RacingApiError";
  }
}

let lastCallAt = 0;
const MIN_GAP_MS = 300; // stay comfortably inside per-endpoint rate limits

async function throttle() {
  const wait = MIN_GAP_MS - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

export async function apiGet<T = unknown>(
  path: string,
  params: Record<string, string | number | readonly string[] | undefined> = {},
  { retries = 3 }: { retries?: number } = {}
): Promise<T> {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    // Multi-value params MUST be repeated, not comma-joined. Confirmed
    // 2026-08-26: `region_codes=gb,ire` returns
    //   422 {"detail":"Validation error - unrecognised region code, gb,ire"}
    // while `region_codes=gb&region_codes=ire` returns GB and Irish cards.
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== undefined && item !== null && item !== "") {
          url.searchParams.append(k, String(item));
        }
      }
    } else {
      url.searchParams.set(k, String(v));
    }
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, {
        headers: { Authorization: authHeader(), Accept: "application/json" },
        cache: "no-store",
      });

      if (res.status === 429) {
        // Rate limited — back off and retry rather than dropping the race.
        const retryAfter = Number(res.headers.get("retry-after") ?? 0);
        const delay = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new RacingApiError(
          `${res.status} ${res.statusText} for ${url.pathname}`,
          res.status,
          url.pathname,
          body.slice(0, 500)
        );
      }

      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      // 4xx other than 429 is a real error — our request is wrong, retrying
      // will not fix it.
      if (err instanceof RacingApiError && err.status < 500 && err.status !== 429) throw err;
      if (attempt === retries) break;
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    }
  }
  throw lastErr;
}

/**
 * Endpoint paths.
 *
 * VERIFY THESE against https://api.theracingapi.com/documentation for your
 * plan. `npm run probe` reports which of these actually respond on your
 * subscription — some are Pro-only.
 */
export const endpoints = {
  courses: "/v1/courses",
  courseRegions: "/v1/courses/regions",

  racecardsFree: "/v1/racecards/free",
  racecardsBasic: "/v1/racecards/basic",
  racecardsStandard: "/v1/racecards/standard",
  racecardsPro: "/v1/racecards/pro",
  racecardsSummaries: "/v1/racecards/summaries",
  raceProById: (raceId: string) => `/v1/racecards/${raceId}/pro`,
  raceStandardById: (raceId: string) => `/v1/racecards/${raceId}/standard`,

  results: "/v1/results",
  resultsToday: "/v1/results/today",
  resultById: (raceId: string) => `/v1/results/${raceId}`,

  horseResults: (horseId: string) => `/v1/horses/${horseId}/results`,
  horseSearch: "/v1/horses/search",
  jockeySearch: "/v1/jockeys/search",
  trainerSearch: "/v1/trainers/search",
} as const;

/** Today's (or a given date's) full racecards. Pro where available. */
export async function fetchRacecards(date: string, tier: "pro" | "standard" | "basic" = "pro") {
  const path =
    tier === "pro"
      ? endpoints.racecardsPro
      : tier === "standard"
      ? endpoints.racecardsStandard
      : endpoints.racecardsBasic;
  return apiGet<{ racecards?: unknown[]; results?: unknown[] }>(path, {
    date,
    region_codes: REGIONS,
  });
}

export async function fetchResults(startDate: string, endDate: string, limit = 200, skip = 0) {
  return apiGet<{ results?: unknown[]; total?: number }>(endpoints.results, {
    start_date: startDate,
    end_date: endDate,
    region: REGIONS,
    limit,
    skip,
  });
}

export async function fetchCourses() {
  return apiGet<{ courses?: unknown[] }>(endpoints.courses, { region_codes: REGIONS });
}
