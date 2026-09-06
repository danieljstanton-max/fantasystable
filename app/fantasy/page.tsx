/**
 * Fantasy Racing — the game's homepage.
 *
 * A separate route from the stable at /game so signed-out visitors have
 * somewhere to read what the game IS before they are asked for anything. On
 * the game's eventual dedicated domain this content moves to `/`; here it
 * lives at /fantasy so the horseracingtips.io homepage is untouched.
 *
 * Three jobs, in this order:
 *
 *   1. Show what it is. Hero + one-line pitch. If someone bounces after this
 *      it should not be because they were confused about what they were being
 *      offered.
 *   2. Show the rules. Three short lines. Fantasy games fail on rule-page
 *      length far more often than on rule complexity.
 *   3. Ask for the sign-in. One button, above and below the fold. No password,
 *      no form ceremony.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { BUDGET, N_HORSES, N_JOCKEYS } from "@/lib/game-pricing";
import { db, sessions, stables, users } from "@/db";
import { eq, gt, sql } from "drizzle-orm";
import { nextGameDate } from "@/lib/game-data";

export const metadata: Metadata = {
  // `absolute` cancels the "%s | Horse Racing Tips" template inherited from
  // the root layout — this is the Fantasy Stable homepage, not a subpage of
  // the tips site. The opengraph-image.tsx sibling supplies the social card.
  title: {
    absolute: "Fantasy Horse Racing Game UK — Free to Play | Fantasy Stable",
  },
  description:
    "The free-to-play fantasy horse racing game for UK & Irish racing. Pick 6 horses and 2 jockeys from £100m, name your NAP, join mini-leagues with your mates. A new card every Saturday.",
  keywords: [
    "fantasy horse racing",
    "fantasy horse racing game",
    "fantasy horse racing UK",
    "free fantasy horse racing",
    "horse racing fantasy game",
    "fantasy racing UK",
    "fantasy stable",
    "UK fantasy racing game",
    "fantasy premier league for horse racing",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    title: "Fantasy Stable — the UK fantasy horse racing game",
    description:
      "Free-to-play fantasy horse racing. Pick 6 horses, 2 jockeys, name your NAP. A new card every Saturday. Sign in with Google or email — no password.",
    siteName: "Fantasy Stable",
    type: "website",
    locale: "en_GB",
    url: "https://www.fantasystable.co.uk/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fantasy Stable — the UK fantasy horse racing game",
    description:
      "Free-to-play fantasy horse racing. A new card every Saturday.",
  },
};

export const dynamic = "force-dynamic";

export default async function FantasyHome({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const { preview } = await searchParams;
  // The homepage is the front door for everyone — signed-in players see the
  // same page but with a "Go to your stable" CTA in place of "Build your
  // stable". No auto-redirect off the domain root; that was silently
  // hiding the marketing page from anyone with a session cookie.
  const me = preview ? null : await currentUser();
  const stats = await loadHomeStats();

  return (
    <main
      className="min-h-screen bg-[#57b25a] text-[var(--slate)]"
      style={
        {
          fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif",
          "--slate": "#17303c",
          "--slate-soft": "#7d919c",
          "--go": "#12d17c",
          "--go-deep": "#04b56b",
        } as React.CSSProperties
      }
    >
      <StructuredData />
      <Hero signedIn={!!me} />
      <LiveStats stats={stats} />
      <HowItWorks />
      <Faq />
      <SecondCta signedIn={!!me} />
      <Footer />
    </main>
  );
}

/* ------------------------------------------------------ live stats */

async function loadHomeStats(): Promise<HomeStats> {
  // Everything the homepage needs comes from three cheap queries. Kept
  // together so we can Promise.all them and the marketing page never blocks
  // on a slow tab. If any query throws we fall back to a zero'd shape
  // rather than 500 the page — a homepage that renders "0 stables" beats
  // one that renders a red error box.
  try {
    const gameweek = await nextGameDate();
    const activeSince = new Date(Date.now() - 15 * 60_000);
    const [[totalRow], [thisWeekRow], [liveRow]] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(users),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(stables)
        .where(eq(stables.raceDate, gameweek)),
      // "Online now" = a session touched in the last 15 minutes. Close
      // enough for a marketing counter, and doesn't need heartbeat plumbing.
      db
        .select({ n: sql<number>`count(distinct ${sessions.userId})::int` })
        .from(sessions)
        .where(gt(sessions.expiresAt, activeSince)),
    ]);
    return {
      totalStables: totalRow?.n ?? 0,
      thisWeek: thisWeekRow?.n ?? 0,
      onlineNow: liveRow?.n ?? 0,
      gameweek,
    };
  } catch {
    return { totalStables: 0, thisWeek: 0, onlineNow: 0, gameweek: "" };
  }
}

type HomeStats = {
  totalStables: number;
  thisWeek: number;
  onlineNow: number;
  gameweek: string;
};

function LiveStats({ stats }: { stats: HomeStats }) {
  const cells = [
    { label: "Stables joined", value: stats.totalStables },
    { label: "Entered this week", value: stats.thisWeek },
    { label: "Online now", value: stats.onlineNow },
  ];
  return (
    <section className="bg-white px-4 py-8 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          {cells.map((c) => (
            <div
              key={c.label}
              className="rounded-2xl bg-[#f6f4f8] px-3 py-4 text-center shadow-[inset_0_-2px_0_rgba(0,0,0,0.03)] sm:px-5"
            >
              <div className="text-[26px] font-extrabold tabular-nums leading-none text-[var(--slate)] sm:text-[34px]">
                {c.value.toLocaleString("en-GB")}
              </div>
              <div className="mt-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-[var(--slate-soft)] sm:text-[11.5px]">
                {c.label}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-center text-[11.5px] text-[var(--slate-soft)]">
          Updates every time you load the page.
        </p>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- hero */

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section
      className="relative overflow-hidden pb-10 pt-6 sm:pb-16 sm:pt-10"
      style={{
        backgroundImage: "url(/img/track.png)",
        backgroundSize: "100% auto",
        backgroundPosition: "top center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="mx-auto flex max-w-[560px] flex-col items-center px-4 text-center">
        {/* Brand mark sits above the card, on the sky part of the image
            where it reads clearly without any container behind it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/img/logo.png"
          alt="Fantasy Stable"
          className="mb-4 h-24 w-auto sm:mb-5 sm:h-32"
        />

        {/* All copy sits on ONE white card. The racecourse behind is
            decoration; putting text directly on it fights the trees, the
            fence and the ground stripes for contrast. */}
        <div className="w-full rounded-[24px] bg-white/95 px-5 py-6 shadow-[0_8px_28px_rgba(23,48,60,0.18)] backdrop-blur-sm sm:px-8 sm:py-8">
          <div className="inline-block rounded-full bg-[#eaf7f0] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--go-deep)]">
            Free-to-play · New card every Saturday
          </div>

          <h1 className="mt-4 text-[24px] font-extrabold uppercase leading-[1.05] tracking-tight text-[var(--slate)] sm:text-[34px]">
            Build Your Stable.
            <br />
            Beat Your Mates.
            <br />
            Claim the <span className="text-[var(--go-deep)]">BRR-Nagging Rights</span>.
          </h1>

          <p className="mx-auto mt-4 max-w-[440px] text-[14px] leading-relaxed text-[var(--slate-soft)] sm:text-[15px]">
            The free-to-play fantasy horse racing game. Pick your horses, join leagues with your
            mates and compete for weekly bragging rights.
          </p>

          <Link
            href={signedIn ? "/game" : "/game/sign-in"}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] px-7 py-3 text-[14.5px] font-extrabold text-white shadow-[0_4px_14px_rgba(4,181,107,0.35)]"
          >
            {signedIn ? "Go to my stable" : "Build your stable"}
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path d="M4 2.5 7.5 6 4 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </Link>
          {!signedIn && (
            <p className="mt-2.5 text-[11.5px] font-semibold text-[var(--slate-soft)]">
              Sign in with Google or a one-time email link. No password.
            </p>
          )}
        </div>
      </div>

      {/* A gentle vignette at the foot so the illustration blends into the
          green fill below, rather than cutting on a hard edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(180deg,transparent,#57b25a)]"
      />
    </section>
  );
}

/* ------------------------------------------------------------ how it works */

function HowItWorks() {
  const steps = [
    {
      n: 1,
      title: "Build your stable",
      body: `Pick ${N_HORSES} horses (one per race) and ${N_JOCKEYS} jockeys from £${BUDGET}m. Favourites cost dear, longshots leave room to spend on a star.`,
      icon: <HorseIcon />,
    },
    {
      n: 2,
      title: "Name your NAP",
      body: "One of your six is the NAP. It scores double — the swing between right and wrong is where the week is won.",
      icon: <NapIcon />,
    },
    {
      n: 3,
      title: "Race day",
      body: "Points for winners, places and jockey wins. Fallers cost you. Mini-leagues settle live so you can wind up your mates on the way home.",
      icon: <TrophyIcon />,
    },
  ];

  return (
    <section className="bg-white px-4 py-14 sm:py-20">
      <div className="mx-auto max-w-3xl">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[var(--go-deep)]">
          How to play
        </p>
        <h2 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight text-[var(--slate)] sm:text-[34px]">
          Pick 6 Horses. Choose 2 Jockeys. Select Your NAP.{" "}
          <span className="text-[var(--go-deep)]">Let&rsquo;s go, Champ!</span>
        </h2>

        <div className="mt-8 grid gap-3 sm:grid-cols-3 sm:gap-5">
          {steps.map((s) => (
            <div
              key={s.n}
              className="relative overflow-hidden rounded-2xl bg-[#f6f4f8] p-5 sm:p-6"
            >
              {/* Big transparent step number behind the content, so the card
                  reads as a step even at a glance. */}
              <span
                aria-hidden
                className="pointer-events-none absolute -right-3 -top-4 select-none text-[110px] font-extrabold leading-none tracking-tight text-white sm:text-[130px]"
              >
                {s.n}
              </span>
              <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)]">
                {s.icon}
              </div>
              <h3 className="relative mt-4 text-[18px] font-extrabold leading-tight text-[var(--slate)] sm:text-[19px]">
                {s.title}
              </h3>
              <p className="relative mt-1.5 text-[13.5px] leading-relaxed text-[var(--slate-soft)]">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------- step icons */

function HorseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
      <path
        d="M7 27c-.6-4.2.4-7.6 2.2-10.2 1.2-1.7 1.5-2.7 1-4.2-.5-1.5-.2-3 .9-4.3l1.1-1.3c.5-.6 1.4-.6 1.9 0l.7.8 2.6-2.5c.6-.6 1.6-.4 1.9.4l.9 2.4 2.6 1.1c2.4 1 3.9 3.3 3.9 5.9 0 1.6-.6 3-1.7 4.1l-.9.9c-.8.8-1.3 1.9-1.4 3l-.4 3.9h-4l.4-4.2c.05-.6-.6-1-1.1-.6l-2.3 1.8c-.5.4-.8 1-.8 1.6V27H7Z"
        fill="currentColor"
      />
    </svg>
  );
}
function NapIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2 14.9 8.6 22 9.5l-5.4 4.9 1.6 7.1L12 17.8 5.8 21.5 7.4 14.4 2 9.5l7.1-.9L12 2Z"
        fill="currentColor"
      />
    </svg>
  );
}
function TrophyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 4h10v3a5 5 0 0 1-10 0V4Z"
        fill="currentColor"
      />
      <path
        d="M4 5h3v1a3 3 0 0 1-3 3V5Zm16 0h-3v1a3 3 0 0 0 3 3V5Z"
        fill="currentColor"
      />
      <path d="M9 13h6v3l1 4H8l1-4v-3Z" fill="currentColor" />
      <rect x="7" y="20" width="10" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}

/* ------------------------------------------------------------ second CTA */

/* ------------------------------------------------------------ FAQ */

const FAQ = [
  {
    q: "What is Fantasy Stable?",
    a: "Fantasy Stable is a free-to-play fantasy horse racing game for UK and Irish racing. Every Saturday a new card of races is put up. You pick 6 horses (one per race) and 2 jockeys from a £100m budget, name a NAP that scores double, then watch your stable score points through the afternoon as the races run.",
  },
  {
    q: "Is Fantasy Stable really free?",
    a: "Yes. No entry fee, no stake, no cash prize. It's a game of skill — you play for weekly bragging rights and mini-league bragging rights against your mates.",
  },
  {
    q: "How does fantasy horse racing scoring work?",
    a: "Points are awarded for winners, place-getters, and jockey wins. Winners score 25 points plus a longshot bonus that scales with the horse's price. Places pay 12/7/4/2 for 2nd–5th. Fallers and non-completions cost you 5 points. Your NAP scores double. Full rules are on the rules page.",
  },
  {
    q: "How do horse prices work?",
    a: "Prices come off the overnight show every Friday, cost £2m–£109m per horse, and are locked at kick-off. Favourites cost dear, longshots leave room to spend on a star. Jockeys are priced on their book across the whole Saturday card and max out at £30m.",
  },
  {
    q: "When does the game deadline lock?",
    a: "One hour before the first race on Saturday. Ingest updates non-runners through the morning — if one of your picks is withdrawn before the deadline, you're refunded the price and emailed so you can pick a replacement.",
  },
  {
    q: "Can I play with my mates?",
    a: "Yes — mini-leagues are the point. Create a league, share the 6-character code with your mates, and see your private leaderboard week by week. Office leagues, mate groups, family — the code is all anyone needs to join.",
  },
  {
    q: "Do I need a Racing Post or Sporting Life account?",
    a: "No. Fantasy Stable is standalone. Sign in with Google or a one-time email link — no password to remember.",
  },
];

function Faq() {
  return (
    <section className="bg-white px-4 py-14 sm:py-20">
      <div className="mx-auto max-w-3xl">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[var(--go-deep)]">
          Fantasy horse racing FAQ
        </p>
        <h2 className="mt-2 text-[26px] font-extrabold leading-tight tracking-tight text-[var(--slate)] sm:text-[34px]">
          Everything you need to know before you build your first stable.
        </h2>
        <div className="mt-8 divide-y divide-[#eef2f6]">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-[16px] font-bold text-[var(--slate)] [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="text-[var(--slate-soft)] transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--slate-soft)]">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------- structured data (JSON-LD) */

function StructuredData() {
  const site = "https://www.fantasystable.co.uk";
  const orgAndApp = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${site}/#organization`,
        name: "Fantasy Stable",
        url: site,
        logo: `${site}/img/logo.png`,
        description:
          "Free-to-play fantasy horse racing game for UK & Irish racing. A new card every Saturday.",
      },
      {
        "@type": "WebSite",
        "@id": `${site}/#website`,
        url: site,
        name: "Fantasy Stable",
        publisher: { "@id": `${site}/#organization` },
        inLanguage: "en-GB",
      },
      {
        "@type": "SoftwareApplication",
        name: "Fantasy Stable",
        operatingSystem: "Web",
        applicationCategory: "GameApplication",
        applicationSubCategory: "Fantasy Sports",
        description:
          "Pick six horses and two jockeys from a £100m budget on the Saturday card. Name a NAP that scores double, join mini-leagues with your mates, chase weekly bragging rights.",
        offers: { "@type": "Offer", price: 0, priceCurrency: "GBP" },
        url: site,
        publisher: { "@id": `${site}/#organization` },
      },
    ],
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgAndApp) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }}
      />
    </>
  );
}

function SecondCta({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="bg-[#eef2f6] px-4 py-14 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--slate)] sm:text-[34px]">
          {signedIn ? "Card open — head to your stable." : "Ready to build your stable?"}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-[var(--slate-soft)]">
          A card goes up every Saturday. Sign in with Google or a one-time email link.
        </p>
        <Link
          href={signedIn ? "/game" : "/game/sign-in"}
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] px-8 py-3.5 text-[15px] font-extrabold text-white shadow-[0_6px_16px_rgba(4,181,107,0.35)]"
        >
          {signedIn ? "Go to my stable" : "Sign in to play"}
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M4 2.5 7.5 6 4 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </Link>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- footer */

function Footer() {
  return (
    <footer className="bg-[#17303c] px-4 py-8 text-center text-[12px] leading-relaxed text-white/70">
      <p>Fantasy Stable is a free game of skill. No stake, no cash prize.</p>
    </footer>
  );
}
