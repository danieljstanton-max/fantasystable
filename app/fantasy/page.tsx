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
import { redirect } from "next/navigation";
import { BUDGET, N_HORSES, N_JOCKEYS } from "@/lib/game-pricing";

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
  // A signed-in visitor has no reason to see the pitch — send them to their
  // stable. `?preview=1` bypasses the redirect while we're iterating on the
  // marketing copy from a signed-in session.
  if (!preview && (await currentUser())) redirect("/game");

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
      <Hero />
      <HowItWorks />
      <SecondCta />
      <Footer />
    </main>
  );
}

/* ---------------------------------------------------------------- hero */

function Hero() {
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
      <div className="mx-auto flex max-w-3xl flex-col items-center px-4 text-center">
        <div className="rounded-full bg-white px-4 py-1.5 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[var(--slate)] shadow-[0_2px_8px_rgba(23,48,60,0.08)]">
          A new card every Saturday
        </div>

        <h1 className="mt-4 text-[38px] font-extrabold uppercase leading-[0.95] tracking-tight text-[var(--slate)] drop-shadow-[0_2px_2px_rgba(255,255,255,0.6)] sm:text-[56px]">
          Fantasy
          <br />
          Stable
        </h1>

        <p className="mt-3 max-w-[440px] text-[16px] font-semibold leading-snug text-[var(--slate)] drop-shadow-[0_1px_1px_rgba(255,255,255,0.6)] sm:text-[18px]">
          Pick {N_HORSES} horses and {N_JOCKEYS} jockeys from £{BUDGET}m.
          <br className="hidden sm:block" /> Score when they run. Chase glory.
        </p>

        <Link
          href="/game/sign-in"
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] px-8 py-3.5 text-[15px] font-extrabold text-white shadow-[0_6px_16px_rgba(4,181,107,0.35)]"
        >
          Sign in and pick your stable
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M4 2.5 7.5 6 4 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </Link>
        <p className="mt-3 text-[12px] font-semibold text-[var(--slate)] opacity-70">
          No password. A one-time link to your email.
        </p>
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
      n: "01",
      title: "Build your stable",
      body: `Pick ${N_HORSES} horses (one per race) and ${N_JOCKEYS} jockeys from a £${BUDGET}m budget. Prices come off the overnight show — favourites cost dear, longer prices leave you room to spend on a star.`,
    },
    {
      n: "02",
      title: "Name a NAP",
      body: "One of your six is the NAP and scores double. Get it right and you set the tone for the week; get it wrong and there's no hiding it.",
    },
    {
      n: "03",
      title: "Watch it run",
      body: "Points for winners, place-getters and jockey wins. Fallers cost you. The leaderboard settles when the last race is off — mini-leagues too, so you can play against your mates or your office.",
    },
  ];

  return (
    <section className="bg-white px-4 py-14 sm:py-20">
      <div className="mx-auto max-w-3xl">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-[var(--go-deep)]">
          How it works
        </p>
        <h2 className="mt-2 text-[28px] font-extrabold leading-tight tracking-tight text-[var(--slate)] sm:text-[36px]">
          Three rules, one team, one Saturday.
        </h2>

        <div className="mt-8 grid gap-4 sm:grid-cols-3 sm:gap-5">
          {steps.map((s) => (
            <div key={s.n} className="rounded-2xl border border-[#eef2f6] bg-white p-5">
              <div className="text-[11px] font-extrabold tracking-wider text-[var(--go-deep)]">
                {s.n}
              </div>
              <h3 className="mt-1 text-[19px] font-extrabold leading-tight text-[var(--slate)]">
                {s.title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--slate-soft)]">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ second CTA */

function SecondCta() {
  return (
    <section className="bg-[#eef2f6] px-4 py-14 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-[26px] font-extrabold leading-tight tracking-tight text-[var(--slate)] sm:text-[34px]">
          Ready to build your stable?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-[var(--slate-soft)]">
          A card goes up every Saturday. Sign in with your email — the link is single-use and
          expires in fifteen minutes.
        </p>
        <Link
          href="/game/sign-in"
          className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] px-8 py-3.5 text-[15px] font-extrabold text-white shadow-[0_6px_16px_rgba(4,181,107,0.35)]"
        >
          Sign in to play
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
