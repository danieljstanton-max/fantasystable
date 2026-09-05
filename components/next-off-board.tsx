"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * The signature element.
 *
 * A punter arriving at 13:56 has one question, and it is not "what is your
 * value proposition" — it is "what's off next and can I still get on". So the
 * hero is not a marketing headline, it is the board: the next races in time
 * order, counting down.
 *
 * The countdown is the one place motion is used on the page. It earns it by
 * carrying real information that changes.
 */

export type NextOffRace = {
  id: string;
  courseName: string;
  offTime: string;
  offIso: string;
  url: string;
  fieldSize: number | null;
  surface: string | null;
};

function timeToOff(iso: string, now: number): { label: string; urgent: boolean; off: boolean } {
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return { label: "Off", urgent: false, off: true };
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return { label: `${mins}m`, urgent: mins <= 10, off: false };
  const hrs = Math.floor(mins / 60);
  return { label: `${hrs}h ${mins % 60}m`, urgent: false, off: false };
}

export function NextOffBoard({ races }: { races: NextOffRace[] }) {
  // Start from null so server and client render the same markup, then fill in
  // on mount. Rendering a live countdown during SSR guarantees a hydration
  // mismatch every time.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);

  if (races.length === 0) {
    return (
      <div className="card p-6">
        <p className="font-display text-[22px]">No racing scheduled</p>
        <p className="mt-1 text-[14px] text-muted">
          British and Irish cards resume shortly. Check{" "}
          <Link href="/racecards" className="text-claret underline underline-offset-2">
            tomorrow&rsquo;s racecards
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <section aria-labelledby="next-off-heading" className="card overflow-hidden">
      <div className="flex items-baseline justify-between border-b border-rule bg-[var(--claret)] px-4 py-2.5">
        <h2 id="next-off-heading" className="eyebrow !text-[var(--brass-light)]">
          Next off
        </h2>
        <span className="text-[11px] uppercase tracking-wider text-[var(--brass-light)]">
          UK &amp; Ireland
        </span>
      </div>

      <ul className="divide-y divide-[var(--rule)]">
        {races.slice(0, 6).map((r) => {
          const t = now === null ? null : timeToOff(r.offIso, now);
          return (
            <li key={r.id}>
              <Link
                href={r.url}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--paper)]"
              >
                <span className="num w-[52px] shrink-0 text-[18px] font-semibold leading-none">
                  {r.offTime}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-[18px] leading-tight">
                    {r.courseName}
                  </span>
                  <span className="text-[12px] text-muted">
                    {r.fieldSize ? `${r.fieldSize} runners` : "Declarations pending"}
                    {r.surface === "aw" && " · All-weather"}
                  </span>
                </span>

                <span
                  className="num shrink-0 rounded-sm px-2 py-1 text-[12px] font-semibold tabular-nums"
                  style={
                    t?.urgent
                      ? { background: "var(--live)", color: "#fff" }
                      : { background: "var(--rule)", color: "var(--ink-muted)" }
                  }
                  suppressHydrationWarning
                >
                  {t ? t.label : r.offTime}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
