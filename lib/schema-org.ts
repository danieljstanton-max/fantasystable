/**
 * JSON-LD builders.
 *
 * SportsEvent is the correct type for a race and is well understood by Google.
 * Nothing here is invented: every field maps to data we actually hold. Padding
 * structured data with values you cannot substantiate is how sites end up with
 * structured-data manual actions.
 */

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://horseracingtips.io";

const abs = (path: string) => (path.startsWith("http") ? path : `${SITE}${path}`);

type RaceLike = {
  name: string;
  offTime: string;
  courseName: string;
  courseSlug: string;
  raceDate: string;
  slug: string;
  offDt: Date;
  fieldSize: number | null;
  status: string;
};

export function sportsEventJsonLd(race: RaceLike) {
  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${race.offTime} ${race.name}`.trim(),
    startDate: race.offDt.toISOString(),
    eventStatus:
      race.status === "abandoned"
        ? "https://schema.org/EventCancelled"
        : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    sport: "Horse racing",
    url: abs(`/racecards/${race.courseSlug}/${race.raceDate}/${race.slug}`),
    location: {
      "@type": "Place",
      name: `${race.courseName} Racecourse`,
      url: abs(`/racecourses/${race.courseSlug}`),
    },
  };
}

export function breadcrumbJsonLd(items: { name: string; url?: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      ...(item.url ? { item: abs(item.url) } : {}),
    })),
  };
}

export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Horse Racing Tips",
    url: SITE,
    // Fill these in — a half-populated Organization block is worse than none.
    // legalName, address, sameAs, logo
  };
}
