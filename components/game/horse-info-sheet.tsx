"use client";

/**
 * Horse profile — the info drawer that opens when a player taps a horse in
 * their stable.
 *
 * The point isn't to be a racecard; the racecard lives on horseracingtips.io.
 * The point is to remind the player WHY they picked this horse — the form
 * string, the analyst's line on the horse, the ratings, the jockey and
 * trainer, the course/time it's off. Enough to feel like you know your
 * runner, no more.
 *
 * Reads its data straight off the `PricedRunner` we already have on the pitch.
 * No new fetch, no loading spinner — the drawer opens on the info the page
 * loaded with.
 */

import type { PricedRunner } from "@/lib/game-card";
import { PickerSheet } from "./picker-sheet";
import { money } from "./format";

export function HorseInfoSheet({
  runner,
  isNap,
  onClose,
  ownershipPct,
}: {
  runner: PricedRunner | null;
  isNap: boolean;
  onClose: () => void;
  /** Fraction 0..1 — null if we don't have ownership data yet. */
  ownershipPct: number | null;
}) {
  return (
    <PickerSheet open={!!runner} onClose={onClose} title="Horse profile">
      {runner && (
        <div className="flex flex-col gap-4 pt-1">
          <div className="flex items-center gap-4">
            {runner.silkUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={runner.silkUrl}
                alt=""
                width={72}
                height={72}
                className="h-16 w-16 shrink-0 object-contain drop-shadow-[0_2px_3px_rgba(0,0,0,0.2)]"
              />
            ) : (
              <div className="h-16 w-16 shrink-0 rounded-lg bg-[#eef2f6]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-[19px] font-extrabold leading-tight text-[var(--slate)]">
                  {runner.horse}
                </h3>
                {isNap && (
                  <span className="shrink-0 rounded-full bg-[#f7d94a] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--slate)]">
                    NAP
                  </span>
                )}
                <OwnershipChip pct={ownershipPct} />
              </div>
              <p className="mt-0.5 text-[12.5px] font-semibold text-[var(--slate-soft)]">
                {[runner.course, runner.offTime].filter(Boolean).join(" · ") || "Non-runner"}
              </p>
              <p className="mt-1 text-[13px] font-bold text-[var(--go-deep)]">
                {money(runner.price)} · {runner.frac || "—"}
              </p>
            </div>
          </div>

          {/* Form string — the last six starts, right-most is the most recent
              run. Numbers are finishing positions; letters are non-completions
              (F, PU, UR, BD, RR). Kept in tabular figures so the string reads
              as data. */}
          {runner.form && (
            <StatCard label="Recent form" mono>
              <span className="text-[22px] font-extrabold text-[var(--slate)]">
                {runner.form}
              </span>
              {runner.lastRun != null && (
                <span className="ml-3 text-[12px] font-semibold text-[var(--slate-soft)]">
                  last run {runner.lastRun} days ago
                </span>
              )}
            </StatCard>
          )}

          {runner.comment && (
            <StatCard label="What the analyst says">
              <p className="text-[13.5px] leading-relaxed text-[var(--slate)]">
                {runner.comment}
              </p>
            </StatCard>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <MetaCell label="Jockey" value={runner.jockey ?? "—"} />
            <MetaCell label="Trainer" value={runner.trainer ?? "—"} />
            <MetaCell label="Weight" value={runner.weight ?? "—"} mono />
            {runner.headgear && <MetaCell label="Headgear" value={runner.headgear.toUpperCase()} />}
            {runner.ofr != null && <MetaCell label="Official" value={String(runner.ofr)} mono />}
            {runner.rpr != null && <MetaCell label="RPR" value={String(runner.rpr)} mono />}
          </div>

          {runner.raceName && (
            <p className="text-[11.5px] leading-relaxed text-[var(--slate-soft)]">
              Running in the <span className="font-semibold text-[var(--slate)]">{runner.raceName}</span>.
            </p>
          )}
        </div>
      )}
    </PickerSheet>
  );
}

export function OwnershipChip({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const shown = pct >= 0.995 ? "100%" : pct < 0.005 ? "<1%" : `${Math.round(pct * 100)}%`;
  // Colour reads the differential story: below 10% is a differential (green),
  // above 40% is a template pick (slate); everything in between is neutral.
  const tone =
    pct >= 0.4
      ? "bg-[#eef2f6] text-[var(--slate)]"
      : pct <= 0.1
        ? "bg-[#eaf7f0] text-[var(--go-deep)]"
        : "bg-[#fff2d6] text-[#7a5b00]";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] ${tone}`}>
      {shown} picked
    </span>
  );
}

function StatCard({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl bg-[#f6f4f8] px-4 py-3">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[var(--slate-soft)]">
        {label}
      </div>
      <div className={`mt-1 ${mono ? "font-mono tabular-nums" : ""}`}>{children}</div>
    </div>
  );
}

function MetaCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg bg-[#f6f4f8] px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--slate-soft)]">
        {label}
      </div>
      <div
        className={`mt-0.5 truncate text-[13px] font-bold text-[var(--slate)] ${mono ? "tabular-nums" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
