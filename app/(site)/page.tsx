import Link from "next/link";
import { eq, asc } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";

import { db, races } from "@/db";
import { NextOffBoard, type NextOffRace } from "@/components/next-off-board";
import { raceUrl, meetingUrl } from "@/lib/slug";

export const revalidate = 300;

/**
 * The homepage answers the same question the racecards hub does — what is off
 * next — but stops short of the full card list, so the two pages are not
 * near-duplicates competing for the same query.
 */
export default async function HomePage() {
  const today = formatInTimeZone(new Date(), "Europe/London", "yyyy-MM-dd");

  const todaysRaces = await db
    .select()
    .from(races)
    .where(eq(races.raceDate, today))
    .orderBy(asc(races.offDt));

  const now = Date.now();
  const nextOff: NextOffRace[] = todaysRaces
    .filter((r) => r.offDt.getTime() > now - 5 * 60_000)
    .slice(0, 6)
    .map((r) => ({
      id: r.id,
      courseName: r.courseName,
      offTime: r.offTime,
      offIso: r.offDt.toISOString(),
      url: raceUrl(r.courseSlug, r.raceDate, r.slug),
      fieldSize: r.fieldSize,
      surface: r.surface,
    }));

  const courses = [...new Map(todaysRaces.map((r) => [r.courseSlug, r])).values()];
  const pretty = formatInTimeZone(new Date(), "Europe/London", "EEEE d MMMM");

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-7">
        <p className="eyebrow">{pretty}</p>
        <h1 className="mt-1 text-[40px] sm:text-[52px]">Horse Racing Tips</h1>
        <p className="mt-2 max-w-prose text-[15px] text-muted">
          Every UK and Irish card, with form, official ratings and going. Non-runners and going
          changes are updated through the day.
        </p>
      </header>

      <div className="mb-9">
        <NextOffBoard races={nextOff} />
      </div>

      {courses.length > 0 && (
        <section>
          <h2 className="eyebrow mb-3">Today&rsquo;s meetings</h2>
          <ul className="flex flex-wrap gap-2">
            {courses.map((r) => (
              <li key={r.courseSlug}>
                <Link
                  href={meetingUrl(r.courseSlug, r.raceDate)}
                  className="inline-block rounded-sm border border-rule px-3 py-2 text-[14px] transition-colors hover:border-claret hover:bg-[var(--paper)]"
                >
                  {r.courseName}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-5">
            <Link href="/racecards" className="text-claret underline underline-offset-2">
              All of today&rsquo;s racecards
            </Link>
          </p>
        </section>
      )}
    </main>
  );
}
