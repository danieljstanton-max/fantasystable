/**
 * RUN THIS FIRST.
 *
 *   npm run probe
 *
 * Calls each endpoint once, writes the raw JSON to ./probe-output/, and prints
 * a field inventory. The mappings in lib/mappers.ts were written without
 * access to a live response, so treat them as a hypothesis until this has
 * confirmed or corrected them.
 *
 * Send the contents of probe-output/FIELD-REPORT.txt back and the mappers can
 * be corrected precisely. That file contains field names and types only — no
 * credentials.
 */

import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { apiGet, endpoints, RacingApiError, REGIONS } from "../lib/racing-api";

const OUT = "./probe-output";
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

type ProbeResult = {
  label: string;
  path: string;
  ok: boolean;
  status?: number;
  note?: string;
  sample?: unknown;
};

/** Describe a value's shape without printing its contents in full. */
function describe(value: unknown, depth = 0, maxDepth = 4): string {
  const pad = "  ".repeat(depth);
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[] (empty)";
    return `array[${value.length}] of:\n${pad}  ${describe(value[0], depth + 1, maxDepth)}`;
  }
  if (typeof value === "object") {
    if (depth >= maxDepth) return "{...}";
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      "{\n" +
      entries
        .map(([k, v]) => {
          const t = Array.isArray(v)
            ? describe(v, depth + 1, maxDepth)
            : v === null
            ? "null"
            : typeof v === "object"
            ? describe(v, depth + 1, maxDepth)
            : `${typeof v}  e.g. ${JSON.stringify(v)}`;
          return `${pad}  ${k}: ${t}`;
        })
        .join("\n") +
      `\n${pad}}`
    );
  }
  return `${typeof value}  e.g. ${JSON.stringify(value)}`;
}

async function probe(
  label: string,
  path: string,
  params: Record<string, string | number | readonly string[]> = {}
): Promise<ProbeResult> {
  process.stdout.write(`  ${label.padEnd(28)} `);
  try {
    const data = await apiGet(path, params);
    const file = `${OUT}/${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
    writeFileSync(file, JSON.stringify(data, null, 2));
    const size = JSON.stringify(data).length;
    console.log(`OK    (${(size / 1024).toFixed(1)} KB -> ${file})`);
    return { label, path, ok: true, sample: data };
  } catch (err) {
    if (err instanceof RacingApiError) {
      const hint =
        err.status === 401
          ? "check credentials"
          : err.status === 403
          ? "not on your plan"
          : err.status === 404
          ? "endpoint path wrong"
          : "";
      console.log(`FAIL  ${err.status} ${hint}`);
      return { label, path, ok: false, status: err.status, note: hint };
    }
    console.log(`FAIL  ${(err as Error).message}`);
    return { label, path, ok: false, note: (err as Error).message };
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  console.log(`\nProbing The Racing API  (date: ${today})\n`);

  const results: ProbeResult[] = [];

  results.push(await probe("courses", endpoints.courses, { region_codes: REGIONS }));
  results.push(await probe("racecards-free", endpoints.racecardsFree, { date: today }));
  results.push(
    await probe("racecards-basic", endpoints.racecardsBasic, { date: today, region_codes: REGIONS })
  );
  results.push(
    await probe("racecards-standard", endpoints.racecardsStandard, {
      date: today,
      region_codes: REGIONS,
    })
  );
  results.push(
    await probe("racecards-pro", endpoints.racecardsPro, { date: today, region_codes: REGIONS })
  );
  results.push(await probe("racecards-summaries", endpoints.racecardsSummaries, { date: today }));
  results.push(await probe("results-today", endpoints.resultsToday, {}));
  results.push(
    await probe("results-range", endpoints.results, {
      start_date: yesterday,
      end_date: yesterday,
      region: REGIONS,
      limit: 5,
    })
  );

  // Build the field report from the richest racecard tier that worked.
  const best =
    results.find((r) => r.label === "racecards-pro" && r.ok) ??
    results.find((r) => r.label === "racecards-standard" && r.ok) ??
    results.find((r) => r.label === "racecards-basic" && r.ok) ??
    results.find((r) => r.label === "racecards-free" && r.ok);

  const lines: string[] = [
    "THE RACING API — FIELD REPORT",
    `Generated ${new Date().toISOString()}`,
    "",
    "ENDPOINT AVAILABILITY",
    "---------------------",
  ];

  for (const r of results) {
    lines.push(
      `${r.ok ? "OK  " : "FAIL"}  ${r.label.padEnd(24)} ${r.path}${
        r.note ? `   (${r.note})` : ""
      }`
    );
  }

  if (best) {
    lines.push("", `RACECARD SHAPE  (from ${best.label})`, "-".repeat(40));
    const payload = best.sample as Record<string, unknown>;
    const cards = (payload.racecards ?? payload.results ?? payload) as unknown;
    const first = Array.isArray(cards) ? cards[0] : cards;
    lines.push(describe(first));

    // Runners get their own section — this is the part most likely to differ
    // from the assumed mapping.
    const runnersKey = ["runners", "horses", "entries"].find(
      (k) => first && typeof first === "object" && k in (first as object)
    );
    if (runnersKey) {
      const runners = (first as Record<string, unknown>)[runnersKey];
      lines.push("", `RUNNER SHAPE  (races[0].${runnersKey}[0])`, "-".repeat(40));
      lines.push(describe(Array.isArray(runners) ? runners[0] : runners));
    } else {
      lines.push("", "!! No runners array found on the race object.");
      lines.push("   Check which key holds the field and update lib/mappers.ts.");
    }
  } else {
    lines.push("", "!! No racecard endpoint responded. Check credentials and plan tier.");
  }

  const report = lines.join("\n");
  writeFileSync(`${OUT}/FIELD-REPORT.txt`, report);
  console.log("\n" + report);
  console.log(`\nWritten to ${OUT}/FIELD-REPORT.txt — safe to share, no credentials in it.\n`);
}

main().catch((e) => {
  console.error("\nProbe failed:", e.message);
  process.exit(1);
});
