"use client";

/**
 * Jockey profile — opens when a player taps a jockey in their stable.
 *
 * The horse sheet is served from data we already loaded with the card. The
 * jockey sheet's stats aren't cheap to compute (they scan historical rides),
 * so they load on demand via a server action once the sheet is open. Empty
 * state while it loads; graceful fallback if we have no history yet.
 */

import { useEffect, useState } from "react";
import type { GameJockey } from "@/lib/game-card";
import { PickerSheet } from "./picker-sheet";
import { JockeySilk } from "./jockey-silk";
import { money } from "./format";
import { OwnershipChip } from "./horse-info-sheet";
import { loadJockeyStatsAction } from "../../app/game/actions";
import type { JockeyRecord } from "@/lib/game-stats";

export function JockeyInfoSheet({
  jockey,
  raceDate,
  onClose,
  ownershipPct,
}: {
  jockey: GameJockey | null;
  raceDate: string;
  onClose: () => void;
  ownershipPct: number | null;
}) {
  const [state, setState] = useState<{
    loading: boolean;
    record: JockeyRecord | null;
    courseName: string | null;
  }>({ loading: false, record: null, courseName: null });

  useEffect(() => {
    if (!jockey) return;
    setState({ loading: true, record: null, courseName: null });
    let cancelled = false;
    loadJockeyStatsAction(jockey.id, raceDate)
      .then((res) => {
        if (cancelled) return;
        setState({ loading: false, record: res.record, courseName: res.courseName });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ loading: false, record: null, courseName: null });
      });
    return () => {
      cancelled = true;
    };
  }, [jockey, raceDate]);

  return (
    <PickerSheet open={!!jockey} onClose={onClose} title="Jockey profile">
      {jockey && (
        <div className="flex flex-col gap-4 pt-1">
          <div className="flex items-center gap-4">
            <div className="h-16 w-16 shrink-0">
              <JockeySilk id={jockey.id} size={64} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-[19px] font-extrabold leading-tight text-[var(--slate)]">
                  {jockey.name}
                </h3>
                <OwnershipChip pct={ownershipPct} />
              </div>
              <p className="mt-0.5 text-[12.5px] font-semibold text-[var(--slate-soft)]">
                {jockey.rides} ride{jockey.rides === 1 ? "" : "s"} on today&rsquo;s card
              </p>
              <p className="mt-1 text-[13px] font-bold text-[var(--go-deep)]">
                {money(jockey.price)}
              </p>
            </div>
          </div>

          {state.loading && (
            <div className="rounded-xl bg-[#f6f4f8] px-4 py-3 text-[12.5px] text-[var(--slate-soft)]">
              Pulling their recent rides…
            </div>
          )}

          {!state.loading && state.record && (
            <>
              <StatCard label="Last 10 rides">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[22px] font-extrabold tabular-nums text-[var(--slate)]">
                    {state.record.wins}<span className="text-[13px] font-bold text-[var(--slate-soft)]">/{state.record.rides}</span>
                  </span>
                  <span className="text-[12px] font-semibold text-[var(--slate-soft)]">
                    Wins · {pct(state.record.winPct)} strike rate
                  </span>
                </div>
                <div className="mt-1 text-[12px] font-semibold text-[var(--slate-soft)]">
                  Top 3: {state.record.places} · {pct(state.record.placePct)}
                </div>
              </StatCard>

              {state.record.courseRides != null && state.courseName && (
                <StatCard label={`At ${state.courseName}`}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[22px] font-extrabold tabular-nums text-[var(--slate)]">
                      {state.record.courseWins}<span className="text-[13px] font-bold text-[var(--slate-soft)]">/{state.record.courseRides}</span>
                    </span>
                    <span className="text-[12px] font-semibold text-[var(--slate-soft)]">
                      Lifetime · {pct(state.record.courseWinPct!)} strike rate
                    </span>
                  </div>
                </StatCard>
              )}
            </>
          )}

          {!state.loading && !state.record && (
            <div className="rounded-xl bg-[#f6f4f8] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--slate-soft)]">
              No completed rides on record yet — a fresh face on the game or a rider whose form
              we&rsquo;ll pick up as more results settle.
            </div>
          )}
        </div>
      )}
    </PickerSheet>
  );
}

function pct(n: number): string {
  if (n >= 0.995) return "100%";
  if (n < 0.005) return "0%";
  return `${Math.round(n * 100)}%`;
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-[#f6f4f8] px-4 py-3">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[var(--slate-soft)]">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
