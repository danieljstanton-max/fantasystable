"use client";

/**
 * The FPL-style tab strip under the header.
 *
 * Only Stable is functional today; Points, Leagues and Help route to their
 * own placeholder pages so a first-time player sees the SHAPE of where the
 * product goes without being tricked into thinking a tab already works.
 *
 * On mobile it lives right under the header and stays visible in the flow;
 * on desktop it fills the same slot but the layout is wider. No sticky
 * behaviour: this is navigation between pages, not within the pitch.
 */

import Link from "next/link";

const TABS = [
  { label: "Stable", href: "/game", active: true },
  { label: "Points", href: "#", soon: true },
  { label: "Leagues", href: "#", soon: true },
  { label: "Rules", href: "/fantasy" },
] as const;

export function GameTabs() {
  return (
    <nav
      className="overflow-x-auto rounded-[22px] bg-white shadow-[0_2px_8px_rgba(23,48,60,0.06)]"
      aria-label="Fantasy Stable sections"
    >
      <ul className="flex min-w-max px-2 py-1.5">
        {TABS.map((tab) => (
          <li key={tab.label}>
            <Link
              href={tab.href}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-bold uppercase tracking-tight transition-colors ${
                "active" in tab && tab.active
                  ? "bg-[var(--slate)] text-white"
                  : "text-[var(--slate)] hover:bg-[#eef2f6]"
              }`}
            >
              {tab.label}
              {"soon" in tab && tab.soon && (
                <span className="rounded-full bg-[#eef2f6] px-1.5 py-0.5 text-[9px] font-bold text-[var(--slate-soft)]">
                  SOON
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Compact deadline strip. Shown between the header and the pitch — it is the
 * single most important thing a returning player wants to know: when does the
 * card lock, and can I still edit? Uses `nextRaceLabel` so it works before any
 * of the settlement code exists.
 */
export function DeadlineStrip({
  courseAndTime,
  locked,
}: {
  courseAndTime: string;
  locked: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[22px] bg-white px-4 py-2.5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
      <div className="flex items-center gap-2.5">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            locked ? "bg-[#c0392b]" : "bg-[var(--go)] animate-pulse"
          }`}
        />
        <span className="text-[11px] font-bold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
          {locked ? "Locked" : "Deadline"}
        </span>
        <span className="text-[13px] font-extrabold text-[var(--slate)]">{courseAndTime}</span>
      </div>
      <span className="text-[11px] font-semibold text-[var(--slate-soft)]">
        {locked ? "Edits closed" : "First race"}
      </span>
    </div>
  );
}
