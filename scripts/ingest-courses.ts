/**
 * Ingest the course list. Reference data — run once, then weekly.
 *
 *   npm run ingest:courses
 *
 * Hand-curated columns (handedness, surfaceType, notes) are deliberately NOT
 * overwritten on conflict. They are not in the API, they are the thing the
 * course pages will have that a competitor's template does not, and a re-run
 * must never wipe them.
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";

import * as schema from "../db/schema";
import { courses, ingestRuns } from "../db/schema";
import { fetchCourses } from "../lib/racing-api";
import { mapCourse } from "../lib/mappers";

const client = postgres(process.env.DATABASE_URL!, { max: 4 });
const db = drizzle(client, { schema });

function extractCourses(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  const p = payload as Record<string, unknown>;
  for (const key of ["courses", "data", "results"]) {
    if (Array.isArray(p?.[key])) return p[key] as Record<string, unknown>[];
  }
  return [];
}

async function main() {
  const runId = randomUUID();
  await db.insert(ingestRuns).values({ id: runId, job: "courses", status: "running" });

  try {
    const payload = await fetchCourses();
    const raw = extractCourses(payload);

    if (raw.length === 0) {
      console.log("No courses returned — check the response shape with `npm run probe`.");
    } else {
      const rows = raw.map(mapCourse);

      // De-duplicate on id; the API has been known to repeat a course across
      // regions and a duplicate in one statement aborts the whole insert.
      const unique = [...new Map(rows.map((c) => [c.id, c])).values()];

      await db
        .insert(courses)
        .values(unique)
        .onConflictDoUpdate({
          target: courses.id,
          set: {
            name: sql`excluded.name`,
            slug: sql`excluded.slug`,
            region: sql`excluded.region`,
            country: sql`excluded.country`,
          },
        });

      console.log(`${unique.length} courses upserted.`);
    }

    await db
      .update(ingestRuns)
      .set({ status: "ok", finishedAt: new Date() })
      .where(eq(ingestRuns.id, runId));
  } catch (err) {
    await db
      .update(ingestRuns)
      .set({ status: "error", finishedAt: new Date(), error: (err as Error).message })
      .where(eq(ingestRuns.id, runId));
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("\nCourses ingest failed:", e.message);
  process.exit(1);
});
