/**
 * Another player's stable, read-only.
 *
 * Only reachable once the card is locked — before then a stable is private
 * so nobody can copy-paste a leader's picks. Uses the same <Pitch> and
 * <Bench> as the owner's view so a player sees an exact visual match to
 * their own screen.
 *
 * Numbers come from the real stable + settlement data, not the optimiser.
 * Rank is the position on THIS WEEK'S leaderboard — there's no cumulative
 * table yet; that only makes sense once we run multi-day festivals. Adding
 * a fake "overall rank" ahead of the mechanic would set an expectation the
 * game can't yet meet.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { GameShell, SubpageHeader } from "@/components/game/game-shell";
import { AutoRefresh } from "@/components/game/auto-refresh";
import { loadCard, mergeSavedIntoCard, nextGameDate } from "@/lib/game-data";
import { cardLockTime, isLocked } from "@/lib/lock";
import type { GameCard, PricedRunner } from "@/lib/game-card";
import { loadStable } from "@/lib/stable";
import { db, stables, users } from "@/db";
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
  const { card: rawCard, offDtByRaceId } = await loadCard(date);

  // Pre-lock privacy: another player's stable is opaque until the card locks.
  const lockTime = cardLockTime(rawCard, offDtByRaceId);
  const locked = lockTime ? isLocked(lockTime) : false;
  if (!locked && !preview) return <LockedNotice date={date} />;
  if (!rawCard.races.length) redirect("/game");

  const [player] = await db
    .select({ id: users.id, email: users.email, displayName: users.displayName, stableName: users.stableName })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!player) redirect("/game/leaderboard");

  const saved = await loadStable(player.id, date);
  if (!saved) return <NoStable name={displayName(player)} />;

  // Same reconciler as the main pitch so non-runners still show with their
  // real silks and prices rather than as a blank tile.
  const card = await mergeSavedIntoCard(rawCard, saved.horseIds, saved.jockeyIds);

  const byHorse = new Map(card.races.flatMap((r) => r.runners.map((x) => [x.horseId, x] as const)));
  const byJockey = new Map(card.jockeys.map((j) => [j.id, j] as const));
  const horses = saved.horseIds
    .map((hid) => byHorse.get(hid))
    .filter(Boolean) as PricedRunner[];
  const jockeys = saved.jockeyIds
    .map((jid) => byJockey.get(jid))
    .filter(Boolean) as GameCard["jockeys"];

  // Leaderboard rank for this race date — 1-indexed on descending points,
  // with a null-safe fallback for stables that haven't been settled yet.
  const ranks = await db
    .select({ userId: stables.userId, points: stables.points })
    .from(stables)
    .where(eq(stables.raceDate, date))
    .orderBy(desc(stables.points));
  const idx = ranks.findIndex((r) => r.userId === player.id);
  const rank = idx >= 0 ? idx + 1 : null;
  const total = ranks.length;
  const points = saved.points ?? 0;

  // NAP hit? The horse's positionNum from the reconciled card runners
  // isn't carried on PricedRunner — we compute the flag from the leaderboard
  // in a follow-up commit. For now the badge shows only when we can prove
  // the NAP horse won: it must be pickable AND its runner is on the card.
  const napHorse = saved.napHorseId ? byHorse.get(saved.napHorseId) ?? null : null;

  return (
    <GameShell>
      <AutoRefresh intervalMs={30_000} />
      <SubpageHeader title={`${displayName(player)}’s Stable`} />

      <div className="rounded-[22px] bg-white p-4 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
              Game Week points
            </p>
            <p
              className="text-[32px] font-extrabold leading-none text-[var(--slate)]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {points}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-bold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
              Rank this week
            </p>
            <p
              className="text-[20px] font-extrabold text-[var(--slate)]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {rank ? `#${rank.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")}` : "—"}
            </p>
          </div>
        </div>
        {napHorse && (
          <p className="mt-3 rounded-lg bg-[#f6f4f8] px-3 py-2 text-[12px] font-semibold text-[var(--slate-soft)]">
            NAP: <span className="font-bold text-[var(--slate)]">{napHorse.horse}</span> — scores double.
          </p>
        )}
      </div>

      <Pitch horses={horses} napHorseId={saved.napHorseId} />
      <Bench jockeys={jockeys} />

      <p className="px-1 pb-2 text-[11px] text-[var(--slate-soft)]">
        Read-only view. Individual race points arrive with settlement — see the Results page for the
        race-by-race breakdown.
      </p>
    </GameShell>
  );
}

function displayName(p: {
  displayName: string | null;
  stableName: string | null;
  email: string;
}): string {
  if (p.stableName) return p.stableName.replace(/'s Stable$/, "");
  if (p.displayName) return p.displayName;
  return p.email.split("@")[0];
}

function NoStable({ name }: { name: string }) {
  return (
    <GameShell>
      <SubpageHeader title={`${name}’s Stable`} />
      <div className="rounded-[22px] bg-white p-8 text-center shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <h1 className="text-[19px] font-extrabold text-[var(--slate)]">
          {name} hasn&rsquo;t built a stable yet
        </h1>
        <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-[var(--slate-soft)]">
          Nothing to show for this game week — check back after the next deadline.
        </p>
      </div>
    </GameShell>
  );
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
