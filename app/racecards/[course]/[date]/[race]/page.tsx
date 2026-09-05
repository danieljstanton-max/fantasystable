import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, asc } from "drizzle-orm";
import { formatInTimeZone } from "date-fns-tz";

import { db, races, runners } from "@/db";
import { GoingChip, RunnerTable, type RunnerView } from "@/components/racing";
import { meetingUrl } from "@/lib/slug";
import { sportsEventJsonLd, breadcrumbJsonLd } from "@/lib/schema-org";
import type { GoingBand } from "@/lib/going";

export const revalidate = 300;
export const dynamicParams = true;

type Params = { course: string; date: string; race: string };

async function getRace({ course, date, race }: Params) {
  const [row] = await db
    .select()
    .from(races)
    .where(and(eq(races.courseSlug, course), eq(races.raceDate, date), eq(races.slug, race)))
    .limit(1);
  return row ?? null;
}

/**
 * Pre-render today's and tomorrow's races at build time; everything else is
 * generated on demand and cached. Pre-building the full historical archive
 * would make deploys take hours for pages that get little traffic.
 */
export async function generateStaticParams() {
  const today = formatInTimeZone(new Date(), "Europe/London", "yyyy-MM-dd");
  const rows = await db
    .select({ course: races.courseSlug, date: races.raceDate, race: races.slug })
    .from(races)
    .where(eq(races.raceDate, today));
  return rows.map((r) => ({ course: r.course, date: r.date, race: r.race }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const p = await params;
  const race = await getRace(p);
  if (!race) return { title: "Race not found" };

  const day = formatInTimeZone(race.offDt, "Europe/London", "EEEE d MMMM yyyy");
  const settled = race.status === "result";

  // The title changes when the race settles. Same URL, same page — but the
  // query behind it shifts from "racecard" to "result", and the title should
  // follow the intent.
  const title = settled
    ? `${race.courseName} ${race.offTime} Result — ${day}`
    : `${race.courseName} ${race.offTime} Racecard — ${day}`;

  const description = settled
    ? `Full result for the ${race.offTime} at ${race.courseName} on ${day}. Finishing positions, starting prices and distances.`
    : `Racecard for the ${race.offTime} ${race.name} at ${race.courseName}, ${day}. ${
        race.fieldSize ?? ""
      } declared runners with form, draw, official ratings and going (${race.going ?? "TBC"}).`;

  const canonical = `/racecards/${p.course}/${p.date}/${p.race}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, type: "article", locale: "en_GB" },
    // Historical racecards stay indexed — they are the archive that horse and
    // trainer profile pages link into. Only abandoned meetings get dropped.
    robots: race.status === "abandoned" ? { index: false, follow: true } : undefined,
  };
}

export default async function RacePage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const race = await getRace(p);
  if (!race) notFound();

  const rows = await db
    .select()
    .from(runners)
    .where(eq(runners.raceId, race.id))
    .orderBy(asc(runners.number));

  const view: RunnerView[] = rows.map((r) => ({
    horseId: r.horseId,
    horseName: r.horseName,
    number: r.number,
    draw: r.draw,
    age: r.age,
    weight: r.weight,
    jockeyName: r.jockeyName,
    trainerName: r.trainerName,
    form: r.form,
    ofr: r.ofr,
    rpr: r.rpr,
    headgear: r.headgear,
    silkUrl: r.silkUrl,
    isNonRunner: r.isNonRunner,
    comment: r.comment,
  }));

  const day = formatInTimeZone(race.offDt, "Europe/London", "EEEE d MMMM yyyy");
  const nonRunners = view.filter((r) => r.isNonRunner).length;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="mb-4 text-[12px] text-muted">
        <Link href="/racecards" className="hover:text-claret">
          Racecards
        </Link>
        <span className="mx-1.5">/</span>
        <Link href={meetingUrl(race.courseSlug, race.raceDate)} className="hover:text-claret">
          {race.courseName}
        </Link>
        <span className="mx-1.5">/</span>
        <span>{race.offTime}</span>
      </nav>

      <header className="mb-6">
        <p className="eyebrow">
          {race.courseName} · {day}
        </p>
        <h1 className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[34px] sm:text-[44px]">
          <span className="num tabular-nums">{race.offTime}</span>
          <span>{race.name}</span>
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
          <GoingChip band={(race.goingBand ?? "unknown") as GoingBand} detail={race.going} />
          {race.distance && (
            <span className="rounded-sm border border-rule px-2 py-[3px] font-semibold">
              {race.distance}
            </span>
          )}
          {race.raceClass && (
            <span className="rounded-sm border border-rule px-2 py-[3px]">{race.raceClass}</span>
          )}
          {race.ageBand && (
            <span className="rounded-sm border border-rule px-2 py-[3px]">{race.ageBand}</span>
          )}
          {race.prize && <span className="text-muted">{race.prize}</span>}
        </div>

        {nonRunners > 0 && (
          <p className="mt-3 rounded-sm border-l-2 border-[var(--brass)] bg-white px-3 py-2 text-[13px]">
            {nonRunners} non-runner{nonRunners > 1 ? "s" : ""} declared. Rule 4 deductions may apply.
          </p>
        )}
      </header>

      <div className="card overflow-x-auto p-2 sm:p-4">
        <RunnerTable runners={view} />
      </div>

      <p className="mt-4 text-[12px] text-muted">
        Racecard data updates through the day. Last checked{" "}
        <time dateTime={race.ingestedAt.toISOString()}>
          {formatInTimeZone(race.ingestedAt, "Europe/London", "HH:mm")}
        </time>
        .
      </p>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(sportsEventJsonLd(race)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            breadcrumbJsonLd([
              { name: "Racecards", url: "/racecards" },
              {
                name: race.courseName,
                url: meetingUrl(race.courseSlug, race.raceDate),
              },
              { name: `${race.offTime} ${race.name}` },
            ])
          ),
        }}
      />
    </main>
  );
}
