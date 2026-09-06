/**
 * The pause holding page.
 *
 * Shown while `GAME_PAUSED` is set on Vercel. Anyone who hits /game/*,
 * /game/sign-in, or any deep link into the game routes lands here rather
 * than on a broken pitch or a "sorry we're testing" 500. The homepage stays
 * live behind the middleware so a first-time visitor still sees what the
 * game is and can come back Saturday.
 */

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: { absolute: "Fantasy Stable — back Saturday for kick-off" },
  description:
    "The launch card goes up this Saturday. See you on race day.",
};

export const dynamic = "force-dynamic";

export default function PausedPage() {
  return (
    <main
      className="min-h-screen"
      style={{
        fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif",
        background:
          "linear-gradient(180deg, #7cc4f0 0%, #a7dbf5 45%, #6fbf6b 55%, #4c9d4c 100%)",
        color: "#17303c",
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center px-6 py-12 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/img/logo.png"
          alt="Fantasy Stable"
          className="mb-6 h-28 w-auto sm:h-32"
        />

        <div className="w-full rounded-[24px] bg-white/95 px-6 py-8 shadow-[0_8px_28px_rgba(23,48,60,0.18)] backdrop-blur-sm sm:px-8 sm:py-10">
          <div className="inline-block rounded-full bg-[#eaf7f0] px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#04b56b]">
            Kick-off Saturday
          </div>
          <h1 className="mt-4 text-[26px] font-extrabold uppercase leading-tight tracking-tight sm:text-[34px]">
            Back this Saturday
            <br />
            for the real thing.
          </h1>
          <p className="mx-auto mt-4 max-w-[420px] text-[14.5px] leading-relaxed text-[#7d919c]">
            The launch card goes up on Saturday morning. Testing wrapped today — we&rsquo;re
            putting the finishing touches on for the first proper race week.
          </p>
          <p className="mx-auto mt-3 max-w-[420px] text-[13px] leading-relaxed text-[#7d919c]">
            Already tested? Your sign-in still works on Saturday morning — no need to do
            anything.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] px-6 py-2.5 text-[13.5px] font-extrabold text-white shadow-[0_4px_14px_rgba(4,181,107,0.35)]"
          >
            Back to homepage
          </Link>
        </div>
      </div>
    </main>
  );
}
