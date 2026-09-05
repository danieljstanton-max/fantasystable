/**
 * Join a League.
 *
 * Two ways in: type/paste a 6-character code, or arrive here from a shared
 * link (`?code=ABC123`) with the code pre-filled. Same submit either way.
 *
 * Design decision: no separate "paste a URL" input. Users type codes, and
 * they tap links — the URL-arrival path handles the second case with a query
 * param, so the visible form stays a single field.
 */

import type { Metadata } from "next";
import { GameShell, SubpageHeader } from "@/components/game/game-shell";
import { JoinLeagueForm } from "./join-form";

export const metadata: Metadata = { title: "Join a League — Fantasy Stable" };
export const dynamic = "force-dynamic";

export default async function JoinLeaguePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  return (
    <GameShell>
      <SubpageHeader title="Join a League" />

      <div className="rounded-[22px] bg-white p-5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <p className="text-[14px] leading-relaxed text-[var(--slate-soft)]">
          Enter the code your league&rsquo;s creator sent you. It&rsquo;s six characters, and it
          doesn&rsquo;t matter if you type it in caps or lowercase.
        </p>
        <JoinLeagueForm initial={code ?? ""} />
      </div>
    </GameShell>
  );
}
