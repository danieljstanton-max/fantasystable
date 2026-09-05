import type { Metadata } from "next";
import Link from "next/link";
import { eq, asc, gte, and } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";

import { db, races } from "@/db";
import { GoingChip } from "@/components/racing";
import { NextOffBoard, type NextOffRace } from "@/components/next-off-board";
import { raceUrl, meetingUrl } from "@/lib/slug";
import type { GoingBand } from "@/lib/going";

/**
 * Revalidate every 5 minutes. The ingest job also calls /api/revalidate on
 * completion, so going changes and non-runners appear immediately rather than
 * waiting out the window — the timer is only a safety net.
 */
export const revalidate = 300;

function todayInLondon(): string {
  return formatInTimeZone(new Date(), "Europe/London", "yyyy-MM-dd");
}

export async function generateMetadata(): Promise<Metadata> {
  const today = todayInLondon();
  const pretty = formatInTimeZone(new Date(), "Europe/London", "EEEE d MMMM yyyy");
  return {
    title: `Today's Racecards — UK & Irish Racing, ${pretty}`,
    description: `Full racecards for every UK and Irish meeting on ${pretty}. Runners, riders, draw, form, official ratings and going for each race.`,
    alternates: { canonical: "/racecards" },
    openGraph: {
      title: `Today's Racecards — ${pretty}`,
      type: "website",
      locale: "en_GB",
    },
  };
}

export default async function RacecardsPage() {
  const today = todayInLondon();

  const todaysRaces = await db
    .select()
    .from(races)
    .where(eq(races.raceDate, today))
    .orderBy(asc(races.offDt));

  // Group into meetings. Meetings are how a card is read — nobody scans a flat
  // list of 180 races.
  const meetings = new Map<string, typeof todaysRaces>();
  for (const r of todaysRaces) {
    const key = r.courseSlug;
    if (!meetings.has(key)) meetings.set(key, []);
    meetings.get(key)!.push(r);
  }

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

  const pretty = formatInTimeZone(new Date(), "Europe/London", "EEEE d MMMM");

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <header className="mb-7">
        <p className="eyebrow">{pretty}</p>
        <h1 className="mt-1 text-[40px] sm:text-[52px]">Today&rsquo;s Racecards</h1>
        <p className="mt-2 max-w-prose text-[15px] text-muted">
          Every UK and Irish meeting, with runners, riders, draw, form and official ratings.
          Non-runners and going changes are updated through the day.
        </p>
      </header>

      <div className="mb-9">
        <NextOffBoard races={nextOff} />
      </div>

      {meetings.size === 0 ? (
        <div className="card p-6">
          <p className="font-display text-[22px]">No cards loaded for today</p>
          <p className="mt-1 text-[14px] text-muted">
            If this is unexpected, check the most recent ingest run — the job may have failed or the
            API mapping may need correcting.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {[...meetings.entries()].map(([slug, meetingRaces]) => {
            const first = meetingRaces[0];
            return (
              <section key={slug} className="card overflow-hidden">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-3">
                  <h2 className="text-[26px]">
                    <Link href={meetingUrl(slug, first.raceDate)} className="hover:text-claret">
                      {first.courseName}
                    </Link>
                  </h2>
                  <GoingChip band={(first.goingBand ?? "unknown") as GoingBand} detail={first.going} />
                  <span className="text-[12px] uppercase tracking-wider text-muted">
                    {first.raceType ?? ""} · {meetingRaces.length} races
                  </span>
                </div>

                <ul className="flex flex-wrap gap-2 p-3">
                  {meetingRaces.map((r) => (
                    <li key={r.id}>
                      <Link
                        href={raceUrl(r.courseSlug, r.raceDate, r.slug)}
                        className="flex flex-col rounded-sm border border-rule px-3 py-2 transition-colors hover:border-claret hover:bg-[var(--paper)]"
                      >
                        <span className="num text-[16px] font-semibold leading-none">
                          {r.offTime}
                        </span>
                        <span className="mt-1 text-[11px] text-muted">
                          {r.fieldSize ?? "—"} runners
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
