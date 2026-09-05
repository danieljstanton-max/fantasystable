"use client";

/**
 * The header and the bottom toolbar for the game.
 *
 * The reference these are matched to: FPL-style furniture at the top and
 * bottom, everything set in one geometric sans, numbers heavier than labels,
 * one accent green throughout. Both bars are cards — no borders, one shadow,
 * one radius — because the loudest AI tell is inconsistency in the small
 * things.
 */

import Link from "next/link";
import { N_HORSES } from "@/lib/game-pricing";

import { money } from "./format";
const tabular = { fontVariantNumeric: "tabular-nums" as const };

type HeaderProps = {
  date: string;
  raceweekLabel?: string;
  deadlineLabel?: string | null;
  locked?: boolean;
  onNextRace?: () => void;
  session:
    | { kind: "signed-in"; email: string; signOut: React.ReactNode }
    | { kind: "signed-out" };
};

export function Header({ date, raceweekLabel, deadlineLabel, locked, onNextRace, session }: HeaderProps) {
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  const centre = raceweekLabel ?? day.toUpperCase();
  // centre is the primary line; day is the muted secondary

  return (
    <header
      className="rounded-[22px] bg-white px-4 py-3.5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
        {/* left — brand */}
        <Link href="/game" className="flex items-center" aria-label="Fantasy Stable — home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/logo.png" alt="Fantasy Stable" className="h-11 w-auto sm:h-14" />
        </Link>

        {/* centre — always visible; a returning player wants to know which
            race week they are on before anything else */}
        <div className="hidden text-center sm:block">
          <div className="text-[16px] font-extrabold uppercase tracking-tight text-[var(--slate)]">
            {centre}
          </div>
          <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.11em]">
            <span className="text-[var(--slate-soft)]">{day}</span>
            {deadlineLabel && (
              <>
                <span className="text-[#dbe0e6]">·</span>
                <span className={locked ? "text-[#c0392b]" : "text-[var(--go-deep)]"}>
                  {deadlineLabel}
                </span>
              </>
            )}
          </div>
        </div>

        {/* right — session action */}
        <div className="justify-self-end">
          <div className="flex items-center gap-2">
            <ResultsPill href="/game/results" />
            {session.kind === "signed-in" ? session.signOut : null}
          </div>
        </div>
      </div>

      {/* Secondary nav — the only place a signed-in player can reach the
          rest of the game from the pitch. Kept as pills for consistency
          with the Results button; scrolls horizontally on narrow screens
          rather than wrapping so the row height stays fixed. */}
      {session.kind === "signed-in" && (
        <nav
          aria-label="Game sections"
          className="-mx-1 mt-3 flex items-center gap-1.5 overflow-x-auto pb-0.5 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <NavPill href="/game" label="Stable" />
          <NavPill href="/game/sell" label="Sell" />
          <NavPill href="/game/leaderboard" label="Leaderboard" />
          <NavPill href="/game/leagues" label="Leagues" />
          <NavPill href="/game/rules" label="Rules" />
          <NavPill href="/game/account" label="Account" />
        </nav>
      )}
    </header>
  );
}

function NavPill({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="shrink-0 rounded-full bg-[#f2edf4] px-3.5 py-1.5 text-[12px] font-bold text-[var(--slate)] transition-colors hover:bg-[#e8e0eb]"
    >
      {label}
    </Link>
  );
}

export function ResultsPill({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-[14px] bg-[linear-gradient(180deg,#1adc86,#04b56b)] px-4 py-2.5 text-[12.5px] font-extrabold uppercase tracking-wide text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)]"
    >
      Results
      <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d="M4 2.5 7.5 6 4 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

export function NextRacePill({ onClick, href }: { onClick?: () => void; href?: string }) {
  const label = (
    <>
      Next Race
      <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden>
        <path d="M4 2.5 7.5 6 4 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );
  const cls =
    "inline-flex items-center gap-1.5 rounded-[14px] bg-[linear-gradient(180deg,#1adc86,#04b56b)] px-4 py-2.5 text-[12.5px] font-extrabold uppercase tracking-wide text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)]";
  if (href) return <Link href={href} className={cls}>{label}</Link>;
  return (
    <button type="button" onClick={onClick} className={cls}>
      {label}
    </button>
  );
}

export function StatBar({
  cells,
}: {
  cells: { label: string; value: string; tone?: "go" | "bad"; slot?: React.ReactNode }[];
}) {
  return (
    <div
      className="grid grid-cols-4 items-center rounded-[22px] bg-white px-2 py-3 shadow-[0_2px_8px_rgba(23,48,60,0.06)] sm:px-4"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {cells.map((cell, i) => (
        <div key={cell.label} className={`text-center ${i > 0 ? "border-l border-[#f0eaf2]" : ""}`}>
          <div className="text-[11px] font-medium text-[var(--slate-soft)]">{cell.label}</div>
          {cell.slot ?? (
            <div
              className={`text-[26px] font-extrabold leading-none tracking-tight sm:text-[32px] ${
                cell.tone === "go"
                  ? "text-[var(--go-deep)]"
                  : cell.tone === "bad"
                    ? "text-[#c0392b]"
                    : "text-[var(--slate)]"
              }`}
            >
              {cell.value}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export const numeric = tabular;


export function BottomToolbar({
  active,
  onOptimise,
  optimiseDisabled,
  optimising,
  scoring = "xPts",
  onToggleView,
}: {
  active: "track" | "list";
  onOptimise: () => void;
  optimiseDisabled?: boolean;
  optimising?: boolean;
  scoring?: string;
  onToggleView?: (view: "track" | "list") => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-[22px] bg-white px-3 py-2.5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
      <div className="flex rounded-xl bg-[#f2edf4] p-0.5">
        {(["track", "list"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onToggleView?.(v)}
            className={`rounded-lg px-3.5 py-1.5 text-[12.5px] font-bold capitalize transition-colors ${
              active === v
                ? "bg-white text-[var(--slate)] shadow-sm"
                : "text-[var(--slate-soft)]"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onOptimise}
        disabled={optimiseDisabled}
        className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] px-4 py-2.5 text-[13px] font-extrabold text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)] disabled:cursor-not-allowed disabled:bg-none disabled:bg-[#c6d2da] disabled:shadow-none"
      >
        <SparkleIcon />
        {optimising ? "Optimising…" : "Optimise Stable"}
      </button>

      <div className="hidden items-center gap-1.5 rounded-xl border border-[#eef2f6] px-3 py-2 sm:flex">
        <span className="text-[11px] font-medium text-[var(--slate-soft)]">Scoring</span>
        <span className="text-[12.5px] font-bold text-[var(--slate)]">{scoring}</span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path d="M3 4.5 6 8l3-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- marks */

function HorseMark() {
  return (
    <svg width="36" height="36" viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <path
        fill="var(--slate)"
        d="M7 27c-.6-4.2.4-7.6 2.2-10.2 1.2-1.7 1.5-2.7 1-4.2-.5-1.5-.2-3 .9-4.3l1.1-1.3c.5-.6 1.4-.6 1.9 0l.7.8 2.6-2.5c.6-.6 1.6-.4 1.9.4l.9 2.4 2.6 1.1c2.4 1 3.9 3.3 3.9 5.9 0 1.6-.6 3-1.7 4.1l-.9.9c-.8.8-1.3 1.9-1.4 3l-.4 3.9h-4l.4-4.2c.05-.6-.6-1-1.1-.6l-2.3 1.8c-.5.4-.8 1-.8 1.6V27H7Z"
      />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0.5 9.6 5.2 14.5 6.4 11 9.8l.9 4.9L8 12.4 4.1 14.7 5 9.8 1.5 6.4l4.9-1.2L8 .5Z" />
    </svg>
  );
}

export function TrophyMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 4h10v5a5 5 0 0 1-10 0V4Z"
        fill="#f0b429"
        stroke="#c98a12"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M7 5.5H5a2.5 2.5 0 0 0 2.5 2.5M17 5.5h2A2.5 2.5 0 0 1 16.5 8"
        stroke="#c98a12"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path d="M10 14h4l.6 3.5h-5.2L10 14Z" fill="#c98a12" />
      <rect x="7.5" y="17.5" width="9" height="2.5" rx="1" fill="#f0b429" stroke="#c98a12" strokeWidth="1.2" />
    </svg>
  );
}
