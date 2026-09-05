import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, asc } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";

import { db, races } from "@/db";
import { GoingChip } from "@/components/racing";
import { raceUrl } from "@/lib/slug";
import { breadcrumbJsonLd } from "@/lib/schema-org";
import type { GoingBand } from "@/lib/going";

export const revalidate = 300;
export const dynamicParams = true;

type Params = { course: string; date: string };

async function getMeeting({ course, date }: Params) {
  return db
    .select()
    .from(races)
    .where(and(eq(races.courseSlug, course), eq(races.raceDate, date)))
    .orderBy(asc(races.offDt));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const p = await params;
  const meeting = await getMeeting(p);
  if (meeting.length === 0) return { title: "Meeting not found" };

  const first = meeting[0];
  const day = formatInTimeZone(first.offDt, "Europe/London", "EEEE d MMMM yyyy");
  const title = `${first.courseName} Racecards — ${day}`;

  return {
    title,
    description: `All ${meeting.length} races at ${first.courseName} on ${day}. Runners, riders, draw, form and official ratings. Going: ${first.going ?? "TBC"}.`,
    alternates: { canonical: `/racecards/${p.course}/${p.date}` },
    openGraph: { title, type: "website", locale: "en_GB" },
  };
}

export default async function MeetingPage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const meeting = await getMeeting(p);
  if (meeting.length === 0) notFound();

  const first = meeting[0];
  const day = formatInTimeZone(first.offDt, "Europe/London", "EEEE d MMMM yyyy");

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-4 text-[12px] text-muted">
        <Link href="/racecards" className="hover:text-claret">
          Racecards
        </Link>
        <span className="mx-1.5">/</span>
        <span>{first.courseName}</span>
      </nav>

      <header className="mb-6">
        <p className="eyebrow">{day}</p>
        <h1 className="mt-1 text-[36px] sm:text-[46px]">{first.courseName}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          <GoingChip band={(first.goingBand ?? "unknown") as GoingBand} detail={first.going} />
          <span className="text-muted">
            {first.raceType ? `${first.raceType} · ` : ""}
            {meeting.length} races
          </span>
        </div>
      </header>

      <ul className="card divide-y divide-[var(--rule)]">
        {meeting.map((r) => (
          <li key={r.id}>
            <Link
              href={raceUrl(r.courseSlug, r.raceDate, r.slug)}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--paper)]"
            >
              <span className="num w-[52px] shrink-0 text-[18px] font-semibold leading-none">
                {r.offTime}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-[19px] leading-tight">
                  {r.name}
                </span>
                <span className="text-[12px] text-muted">
                  {r.distance ?? ""}
                  {r.raceClass ? ` · ${r.raceClass}` : ""}
                  {r.fieldSize ? ` · ${r.fieldSize} runners` : ""}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbJsonLd([
              { name: "Racecards", url: "/racecards" },
              { name: first.courseName },
            ])
          ),
        }}
      />
    </main>
  );
}
