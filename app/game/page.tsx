/**
 * The game's front door.
 *
 * Signed out, the pitch shows an optimiser-built example so the page is a
 * demonstration of what the game IS rather than a form asking for an email.
 * Signed in, the editor takes over.
 *
 * The whole design is scoped to /game — the tokens set on <main> below never
 * reach the racecards. This is a distinct product with its own visual language,
 * the way FPL looks nothing like a Premier League club site.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { pickStable, type GameCard } from "@/lib/game-card";
import { loadCard, mergeSavedIntoCard, nextGameDate, raceWeekFor } from "@/lib/game-data";
import { cardLockTime, isLocked, lockLabel } from "@/lib/lock";
import { loadStable } from "@/lib/stable";
import { loadHorseOwnership, loadJockeyOwnership } from "@/lib/game-stats";
import { loadHorseResults } from "@/lib/game-data";
import type { HorseResult } from "@/lib/game-data";
import { db, stables, users } from "@/db";
import { desc, eq } from "drizzle-orm";
import { Bench, Pitch } from "@/components/game/pitch-view";
import { Header, StatBar, TrophyMark } from "@/components/game/game-chrome";
import { AutoRefresh } from "@/components/game/auto-refresh";
import { GameSidebar } from "@/components/game/game-sidebar";
import { money } from "@/components/game/format";
import { BUDGET } from "@/lib/game-pricing";
import { saveStableAction, signOutAction } from "./actions";
import { StableEditor } from "./stable-editor";

export const metadata: Metadata = {
  title: "Stable — Fantasy Racing",
  description:
    "Pick six horses and two jockeys from £100m. A new card every Saturday, priced off the overnight show.",
};

/** Never cached — the page depends on who is signed in. */
export const dynamic = "force-dynamic";

export default async function GamePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; preview?: string }>;
}) {
  const { date: requested, preview } = await searchParams;
  // Default to the next race day that's still open for building, not to
  // "today" — the game is a build-then-lock flow and once today's deadline
  // has passed, a signed-in player wants tomorrow's card ready to work on.
  const date = requested ?? (await nextGameDate());

  const realUser = await currentUser();
  // Design-time bypass: `?preview=1` renders the signed-in shell against a
  // fake user so we can see the full UI (sidebar, action buttons, editor)
  // without a real session cookie. NEVER read the stable table for a preview
  // user — the row doesn't exist and would 404. Preview cannot save.
  const user =
    realUser ??
    (preview
      ? { id: "__preview__", email: "preview@fantasystable.co.uk", displayName: "Preview" }
      : null);
  const { card: rawCard, offDtByRaceId } = await loadCard(date);
  const saved = realUser ? await loadStable(realUser.id, date) : null;
  // Reconcile: if a saved horse dropped off the current card (its race was
  // filtered for coverage, or the horse became a non-runner), pull the
  // horse's details from the database and splice them back in. Without
  // this, a saved horse silently vanishes from the pitch even though the
  // pick is still on the DB — non-runners are marked, not deleted.
  const card = saved ? await mergeSavedIntoCard(rawCard, saved.horseIds, saved.jockeyIds) : rawCard;
  // Ownership snapshots so the profile drawers can show "picked by X% of
  // stables this week" — the social differential signal that makes a
  // fantasy pick interesting.
  const [horseOwnership, jockeyOwnership] = await Promise.all([
    loadHorseOwnership(date),
    loadJockeyOwnership(date),
  ]);

  // My rank on this week's board — 1-indexed, null while I have no stable
  // or the board is empty. Points come off the saved row (settlement writes
  // them there). Total is shown alongside so "8 of 13" reads honestly on a
  // small board rather than "rank 8" out of context.
  let myPoints: number | null = null;
  let myRank: number | null = null;
  let boardTotal = 0;
  if (realUser && saved) {
    const ranks = await db
      .select({ userId: stables.userId, points: stables.points })
      .from(stables)
      .where(eq(stables.raceDate, date))
      .orderBy(desc(stables.points));
    boardTotal = ranks.length;
    const idx = ranks.findIndex((r) => r.userId === realUser.id);
    if (idx >= 0) myRank = idx + 1;
    myPoints = saved.points;
  }

  // Per-horse results: has it run, what did it finish, how many points?
  // Loaded only when the user has a stable; the horse card overlays this
  // to dim finished picks and show the score.
  let horseResults: Record<string, HorseResult> = {};
  if (saved) {
    // Find each pick's raceId by scanning the reconciled card — same map
    // the pitch uses, so what we pass to HorseCard matches what it draws.
    const raceByHorse = new Map(
      card.races.flatMap((r) => r.runners.map((x) => [x.horseId, r.raceId] as const))
    );
    const pairs = saved.horseIds
      .map((hid) => ({ horseId: hid, raceId: raceByHorse.get(hid) ?? "" }))
      .filter((p) => p.raceId);
    const map = await loadHorseResults(saved.id, pairs);
    horseResults = Object.fromEntries(map);
  }
  // Admin pill in the header nav is opt-in per user — fetched here so the
  // Header component (which is a client component) doesn't have to touch
  // the database itself.
  const isAdmin = realUser
    ? (
        await db
          .select({ isAdmin: users.isAdmin })
          .from(users)
          .where(eq(users.id, realUser.id))
          .limit(1)
      )[0]?.isAdmin ?? false
    : false;

  if (!card.races.length) return <NoCard date={date} />;

  const lockTime = cardLockTime(card, offDtByRaceId);
  // Preview mode ignores the lock so we can test the picker/search flow at
  // any hour. Real sessions still honour the deadline.
  const locked = preview
    ? false
    : (saved?.lockedAt != null) || (lockTime ? isLocked(lockTime) : false);
  const deadlineLabel = lockTime ? lockLabel(lockTime) : null;


  return (
    <main
      className="relative min-h-screen bg-[#57b25a] px-3 py-3 sm:px-4 sm:py-4"
      style={
        {
          backgroundColor: "#57b25a",
          backgroundImage: "url(/img/track.png)",
          backgroundSize: "100% auto",
          backgroundPosition: "top center",
          backgroundRepeat: "no-repeat",
          // One typeface, one tabular numeral treatment, no monospace. Font
          // mixing is the loudest AI tell in a UI.
          fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, -apple-system, sans-serif",
          "--slate": "#17303c",
          "--slate-soft": "#7d919c",
          "--go": "#12d17c",
          "--go-deep": "#04b56b",
          "--pl-purple": "#37003c",
        } as React.CSSProperties
      }
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2.5">
        {locked && <AutoRefresh intervalMs={30_000} />}
        <Header
          date={date}
          raceweekLabel={`Race Week ${raceWeekFor(date)}`}
          deadlineLabel={deadlineLabel}
          locked={locked}
          session={
            user
              ? {
                  kind: "signed-in",
                  email: user.email,
                  isAdmin,
                  signOut: (
                    <form action={signOutAction} className="hidden sm:block">
                      <button
                        type="submit"
                        className="text-[11px] font-semibold text-[var(--slate-soft)] underline underline-offset-2"
                      >
                        Sign out
                      </button>
                    </form>
                  ),
                }
              : { kind: "signed-out" }
          }
        />

        {/* Two-column layout on desktop only when signed in — otherwise the
            single column stays centred and the pitch keeps its width. Rendering
            the grid with an empty sidebar slot would push the main content
            into the 320px column and cramp it. */}
        {user ? (
          <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
            <GameSidebar
              stableName={(user.displayName ?? user.email.split("@")[0]) + "’s Stable"}
              ownerEmail={user.email}
              bank={saved?.spendM != null ? Math.round((BUDGET - saved.spendM) * 10) / 10 : BUDGET}
              spent={saved?.spendM ?? 0}
              xPts={0}
              budget={BUDGET}
            />
            <div className="flex min-w-0 flex-col gap-2.5">
              {locked && myPoints != null && (
                <ScoreStrip points={myPoints} rank={myRank} total={boardTotal} />
              )}
              <StableEditor
                card={card}
                initial={{
                  horseIds: saved?.horseIds ?? [],
                  jockeyIds: saved?.jockeyIds ?? [],
                  napHorseId: saved?.napHorseId ?? null,
                }}
                locked={locked}
                save={saveStableAction}
                horseOwnership={Object.fromEntries(horseOwnership)}
                jockeyOwnership={Object.fromEntries(jockeyOwnership)}
                horseResults={horseResults}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <SignedOut card={card} />
          </div>
        )}

        {/* Below-the-pitch content. These sections mean /game reads as a home
            for the whole product — not just the picker. A signed-in player
            can scroll to see standings and the rulebook without hunting for a
            nav link, which was the biggest missing piece before this. */}
        {user && (
          <>
            <LeaderboardPreview date={date} />
            <RulesPreview />
          </>
        )}

      </div>
    </main>
  );
}

/* ------------------------------------------------------- home sections */

async function LeaderboardPreview({ date }: { date: string }) {
  // Top five stables on this card, ordered by settled points. Zero rows is
  // the normal state until deadline passes — say so honestly rather than
  // hide the section.
  const rows = await db
    .select({
      stableId: stables.id,
      userId: stables.userId,
      points: stables.points,
      email: users.email,
      displayName: users.displayName,
    })
    .from(stables)
    .innerJoin(users, eq(users.id, stables.userId))
    .where(eq(stables.raceDate, date))
    .orderBy(desc(stables.points))
    .limit(5);

  return (
    <section className="rounded-[22px] bg-white p-5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-extrabold uppercase tracking-tight text-[var(--slate)]">
          Leaderboard
        </h2>
        <Link
          href="/game/leaderboard"
          className="text-[12px] font-bold text-[var(--go-deep)]"
        >
          Full board →
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--slate-soft)]">
          The board fills in as each race settles on Saturday afternoon.
        </p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {rows.map((r, i) => {
            const name = r.displayName ?? r.email.split("@")[0];
            return (
              <li
                key={r.stableId}
                className="flex items-center justify-between rounded-lg bg-[#f6f4f8] px-3 py-2 text-[13px]"
              >
                <span className="flex items-center gap-3">
                  <span className="w-5 text-right font-extrabold tabular-nums text-[var(--slate-soft)]">
                    {i + 1}
                  </span>
                  <span className="font-bold text-[var(--slate)]">{name}</span>
                </span>
                <span className="font-extrabold tabular-nums text-[var(--slate)]">
                  {r.points ?? 0}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function RulesPreview() {
  return (
    <section className="rounded-[22px] bg-white p-5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-extrabold uppercase tracking-tight text-[var(--slate)]">
          How Scoring Works
        </h2>
        <Link
          href="/game/rules"
          className="text-[12px] font-bold text-[var(--go-deep)]"
        >
          Full rules →
        </Link>
      </div>
      <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-[var(--slate-soft)]">
        <li>Win: 25 pts + place bonus depending on price</li>
        <li>Place: 12 / 7 / 4 / 2 for 2nd → 5th</li>
        <li>Non-completion (F, PU, UR): −5</li>
        <li>Your NAP scores double</li>
        <li>Jockey wins: 8 pts each</li>
        <li>2 sales per race week at live market price</li>
      </ul>
    </section>
  );
}

/* --------------------------------------------------------------- signed out */

function SignedOut({ card }: { card: GameCard }) {
  const example = pickStable(card);

  return (
    <>
      <StatBar
        cells={[
          { label: "Sales", value: "0 / 2" },
          { label: "Bank", value: money(0), tone: "go" },
          { label: "xPts", value: example.expectedPoints.toFixed(1) },
          {
            label: "",
            value: "",
            slot: (
              <div className="mx-auto mt-0.5 flex max-w-[140px] items-center gap-1.5">
                <TrophyMark />
                <span className="text-left text-[11.5px] font-semibold leading-tight text-[var(--slate-soft)]">
                  Build Your
                  <br />
                  Winning Stable
                </span>
              </div>
            ),
          },
        ]}
      />

      <Pitch horses={example.horses} napHorseId={example.nap?.horseId ?? null} />
      <Bench jockeys={example.jockeys} />

      {/* Same three action buttons the signed-in view has, so the layout is
          honest about what the game offers before anyone signs in. They all
          route to sign-in — you cannot sell, join a league or manage an
          account without an account. */}
      <div className="grid grid-cols-3 gap-2 rounded-[22px] bg-white p-2 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <Link
          href="/game/sign-in"
          className="flex flex-col items-center justify-center gap-0.5 rounded-xl bg-[#eef2f6] py-2.5 text-[12px] font-extrabold text-[var(--slate)]"
        >
          <span className="text-[15px]">£</span>
          Sell a Horse
        </Link>
        <Link
          href="/game/sign-in"
          className="flex flex-col items-center justify-center gap-0.5 rounded-xl bg-[#eef2f6] py-2.5 text-[12px] font-extrabold text-[var(--slate)]"
        >
          <span className="text-[15px]">🏆</span>
          My Leagues
        </Link>
        <Link
          href="/game/sign-in"
          className="flex flex-col items-center justify-center gap-0.5 rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] py-2.5 text-[12px] font-extrabold text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)]"
        >
          <span className="text-[15px]">→</span>
          Sign in
        </Link>
      </div>
    </>
  );
}

function NoCard({ date }: { date: string }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-3xl font-extrabold text-[var(--pl-purple)]">No card for {date}</h1>
      <p className="mt-3 text-[var(--slate-soft)]">
        The game needs opening prices for nearly every runner in a race. Run the racecard ingest or
        try another date with <code>?date=YYYY-MM-DD</code>.
      </p>
    </main>
  );
}

/* -------------------------------------------------------- score strip */

function ScoreStrip({
  points,
  rank,
  total,
}: {
  points: number;
  rank: number | null;
  total: number;
}) {
  return (
    <section className="grid grid-cols-2 rounded-[22px] bg-white px-4 py-3 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
      <div>
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[var(--slate-soft)]">
          Race Week points
        </div>
        <div
          className="mt-0.5 text-[26px] font-extrabold leading-none text-[var(--slate)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {points}
        </div>
      </div>
      <div className="text-right">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[var(--slate-soft)]">
          Rank this week
        </div>
        <div
          className="mt-0.5 text-[16px] font-extrabold text-[var(--slate)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {rank ? `#${rank.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")}` : "—"}
        </div>
      </div>
    </section>
  );
}
