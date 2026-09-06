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
  title: "Fantasy Stable — pick 6 horses, chase glory",
  description:
    "A free-to-play Saturday fantasy game. Pick 6 horses and 2 jockeys from £100m, score when they run, climb the leaderboard.",
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
      <Hero signedIn={!!me} />
      <LiveStats stats={stats} />
      <HowItWorks />
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

          <h1 className="mt-4 text-[22px] font-extrabold uppercase leading-[1.05] tracking-tight text-[var(--slate)] sm:text-[30px]">
            Pick 6 Horses.
            <br />
            Choose 2 Jockeys.
            <br />
            Select Your NAP.
            <br />
            <span className="text-[var(--go-deep)]">Let&rsquo;s go, Champ!</span>
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
        <h2 className="mt-2 text-[28px] font-extrabold leading-tight tracking-tight text-[var(--slate)] sm:text-[36px]">
          Six horses. One NAP. One Saturday.
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
