/**
 * Another player's stable, read-only.
 *
 * Only reachable once the card is locked — before then a stable is private
 * so nobody can copy-paste a leader's picks. This page renders the same
 * <Pitch> and <Bench> components the owner uses, so a player looking at
 * someone else's team sees an EXACT visual match to their own screen — no
 * "am I seeing what they saw" ambiguity.
 *
 * All numbers here will come from the settlement pipeline once it lands.
 * Today the page reads from real card data but uses the optimiser's stable
 * as a stand-in for another player's picks.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GameShell, SubpageHeader } from "@/components/game/game-shell";
import { loadCard, nextGameDate } from "@/lib/game-data";
import { cardLockTime, isLocked } from "@/lib/lock";
import { pickStable } from "@/lib/game-card";
import { Bench, Pitch } from "@/components/game/pitch-view";

export const metadata: Metadata = { title: "Player Stable — Fantasy Stable" };
export const dynamic = "force-dynamic";

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { id } = await params;
  const { preview } = await searchParams;
  const date = await nextGameDate();
  const { card, offDtByRaceId } = await loadCard(date);

  // Pre-lock privacy: another player's stable is opaque until the card locks.
  // Preview mode bypasses this so we can iterate on the design at any hour.
  const lockTime = cardLockTime(card, offDtByRaceId);
  const locked = lockTime ? isLocked(lockTime) : false;
  if (!locked && !preview) return <LockedNotice date={date} />;
  if (!card.races.length) redirect("/game");

  const example = pickStable(card);
  const mockName = mockNameFor(id);

  const totalPoints = 87;
  const napHit = true;

  return (
    <GameShell>
      <SubpageHeader title={`${mockName}’s Stable`} />

      <div className="rounded-[22px] bg-white p-4 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
              Race Week points
            </p>
            <p
              className="text-[32px] font-extrabold leading-none text-[var(--slate)]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {totalPoints}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
              Overall rank
            </p>
            <p
              className="text-[20px] font-extrabold text-[var(--slate)]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              #4,318
            </p>
          </div>
        </div>
        {napHit && (
          <p className="mt-3 rounded-lg bg-[#eaf7f0] px-3 py-2 text-[12px] font-semibold text-[var(--go-deep)]">
            NAP hit — {example.nap?.horse} scored double.
          </p>
        )}
      </div>

      <Pitch horses={example.horses} napHorseId={example.nap?.horseId ?? null} />
      <Bench jockeys={example.jockeys} />

      <p className="px-1 pb-2 text-[11px] text-[var(--slate-soft)]">
        Read-only view. Individual race points arrive with settlement — see the Results page for
        the race-by-race breakdown.
      </p>
    </GameShell>
  );
}

function mockNameFor(id: string): string {
  // Deterministic fake so links from the leaderboard show a plausible name
  const names = [
    "Frankie's Boys",
    "Willie’s Way",
    "The Turf Cartel",
    "Northern Rock",
    "Small Stakes Gang",
    "Point To Point",
    "Bunbury Yard",
    "Ivy Sports Bar FL Champs",
  ];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return names[Math.abs(h) % names.length];
}

function LockedNotice({ date }: { date: string }) {
  return (
    <GameShell>
      <SubpageHeader title="Stable is private" />
      <div className="rounded-[22px] bg-white p-8 text-center shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <h1 className="text-[19px] font-extrabold text-[var(--slate)]">
          Stables lock at the deadline
        </h1>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-[var(--slate-soft)]">
          Nobody sees anyone else's picks until the card is locked — that's one hour before the
          first race. Come back when the deadline has passed for {date}.
        </p>
      </div>
    </GameShell>
  );
}
