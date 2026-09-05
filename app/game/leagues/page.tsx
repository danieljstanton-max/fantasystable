/**
 * My Leagues.
 *
 * Modelled on the FPL "Leagues & Cups" screen — a tabbed segment at the top,
 * three big action buttons underneath, and a table of the mini-leagues the
 * player is in. The rows show current and previous rank so movement is
 * legible at a glance.
 *
 * Everything below the buttons is mock data until the leagues schema and
 * leaderboard exist. Rendering it now sets the shape so later work has
 * somewhere to slot in and so we know if the page holds up before we invest
 * in the backend.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GameShell, SubpageHeader } from "@/components/game/game-shell";
import { LeaguesView } from "./leagues-view";
import { currentUser } from "@/lib/auth";
import { loadMyLeagues } from "@/lib/leagues";

export const metadata: Metadata = { title: "My Leagues — Fantasy Stable" };
export const dynamic = "force-dynamic";

export default async function LeaguesPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const { preview } = await searchParams;
  const user = await currentUser();
  if (!user && !preview) redirect("/game/sign-in");

  // Real leagues if signed in; empty state otherwise. Preview mode gets a
  // small mocked set so the design can be reviewed on the phone.
  const rows = user ? await loadMyLeagues(user.id) : [];
  const leagues = rows.length
    ? rows.map((r) => ({
        code: r.code,
        name: r.name,
        rank: 0, // ranks come from the leaderboard join, plumbed later
        lastRank: 0,
        players: r.members,
      }))
    : preview
      ? [
          { code: "H2H4X9", name: "Ivy Sports Bar FL", rank: 6, lastRank: 6, players: 42 },
          { code: "TUR7W2", name: "H2H £200 Challenge", rank: 2, lastRank: 3, players: 128 },
        ]
      : [];

  const mockFestivals = [
    { slug: "cheltenham-2027", name: "The Cheltenham Festival", starts: "16 Mar", days: 4, joined: false },
    { slug: "royal-ascot-2027", name: "Royal Ascot", starts: "15 Jun", days: 5, joined: true },
    { slug: "goodwood-2027", name: "Glorious Goodwood", starts: "27 Jul", days: 5, joined: false },
    { slug: "aintree-2027", name: "The Grand National Meeting", starts: "8 Apr", days: 3, joined: false },
  ];

  return (
    <GameShell>
      <SubpageHeader title="Leagues & Festivals" />
      <LeaguesView leagues={leagues} festivals={mockFestivals} />
    </GameShell>
  );
}
