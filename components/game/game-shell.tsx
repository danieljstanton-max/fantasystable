/**
 * The wrapper every /game/* page uses so they share one background, one
 * palette, one header. If a page renders inside this it inherits the
 * racecourse illustration and cannot look like a separate site.
 *
 * The header takes an optional `back` prop so pages under /game/... can render
 * a back arrow to /game instead of the Results pill; the pitch itself keeps
 * the Results pill.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { gamePaused } from "@/lib/pause";
import { LaunchBanner } from "./launch-banner";

const TRACK_IMAGE = "/img/track.png";

export function GameShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <main
      className="relative min-h-screen bg-[#57b25a] px-3 py-3 sm:px-4 sm:py-4"
      style={
        {
          backgroundColor: "#57b25a",
          backgroundImage: `url(${TRACK_IMAGE})`,
          backgroundSize: "100% auto",
          backgroundPosition: "top center",
          backgroundRepeat: "no-repeat",
          fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif",
          "--slate": "#17303c",
          "--slate-soft": "#7d919c",
          "--go": "#12d17c",
          "--go-deep": "#04b56b",
        } as React.CSSProperties
      }
    >
      <div className={`mx-auto flex flex-col gap-2.5 ${wide ? "max-w-6xl" : "max-w-2xl"}`}>
        {gamePaused() && <LaunchBanner />}
        {children}
      </div>
    </main>
  );
}

/**
 * A slim header for /game/* subpages — logo on the left, page title in the
 * middle, back arrow to the pitch on the right. Distinct from the main /game
 * header (which carries Results and Sign out) so a player never wonders
 * whether they're on the pitch or on a sub-screen.
 */
export function SubpageHeader({ title }: { title: string }) {
  return (
    <header className="flex items-center gap-3 rounded-[22px] bg-white px-4 py-3 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
      <Link href="/game" aria-label="Back to Stable" className="flex items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/img/logo.png" alt="Fantasy Stable" className="h-8 w-auto sm:h-10" />
      </Link>
      <div className="min-w-0 flex-1 text-center">
        <div className="text-[15px] font-extrabold uppercase tracking-tight text-[var(--slate)]">
          {title}
        </div>
      </div>
      <Link
        href="/game"
        className="inline-flex items-center gap-1.5 rounded-[14px] bg-[#eef2f6] px-3 py-2 text-[11.5px] font-extrabold uppercase tracking-wide text-[var(--slate)]"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M8 2.5 4.5 6 8 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Stable
      </Link>
    </header>
  );
}
