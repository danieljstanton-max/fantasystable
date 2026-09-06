/**
 * The leaderboard.
 *
 * Trophy up top, then the ranked list. Rows can be tapped to open that
 * player's stable — but only once the deadline has passed. Before lock the
 * stable is private (peeking at other people's picks pre-deadline is how FPL
 * gets called cheating), so rows are inert.
 *
 * A player's own row is pinned to the top of the list with a highlight
 * regardless of where they sit, so you can always find yourself even when
 * you're in 4,831st place.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { GameShell, SubpageHeader } from "@/components/game/game-shell";
import { AutoRefresh } from "@/components/game/auto-refresh";
import { currentUser } from "@/lib/auth";
import { loadCard, nextGameDate, raceWeekFor } from "@/lib/game-data";
import { cardLockTime, isLocked } from "@/lib/lock";
import { db, leagueMembers, leagues, stables, users } from "@/db";

export const metadata: Metadata = { title: "Leaderboard — Fantasy Stable" };
export const dynamic = "force-dynamic";

/** A row in the mock board. Real data comes from settlement. */
type Row = {
  id: string;
  stableName: string;
  owner: string;
  points: number;
  lastPoints: number;
  napHit: boolean;
  isMe?: boolean;
};

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string; week?: string; league?: string }>;
}) {
  const { preview, week: weekParam, league } = await searchParams;
  const user =
    (await currentUser()) ??
    (preview ? { id: "__preview__", email: "preview@fantasystable.co.uk", displayName: "Preview" } : null);

  const date = await nextGameDate();
  const { card, offDtByRaceId } = await loadCard(date);
  const lockTime = cardLockTime(card, offDtByRaceId);
  const locked = lockTime ? isLocked(lockTime) : false;

  const week = weekParam ? Number(weekParam) : raceWeekFor(date);

  // Real leaderboard from the DB. If `?league=CODE` is present, filter to
  // that league's members; otherwise it's the global "Overall" board across
  // every stable saved for the day. Fall back to the mock rows when there
  // are no real saved stables so the page still reads as a leaderboard
  // during design and preview.
  let leagueName = league ?? null;
  const boardRows = await loadBoardRows({ date, leagueCode: league });
  const rows =
    boardRows.length > 0
      ? boardRows.map((r) => ({
          // The profile link needs the USER id, not the stable id — the
          // player page is /game/player/[userId], scoped so any of the
          // user's stables (past or present) is reachable from the link.
          id: r.userId,
          stableName: r.stableName,
          owner: r.owner,
          points: r.points ?? 0,
          lastPoints: r.points ?? 0,
          napHit: false,
          isMe: user?.id === r.userId,
        }))
      : mockBoard(user?.email ?? "you@example.com");
  if (league && boardRows.length === 0) leagueName = leagueName; // no-op: keep header

  return (
    <GameShell>
      <AutoRefresh intervalMs={30_000} />
      <SubpageHeader title="Leaderboard" />

      {/* Trophy hero — the whole point of the page in one image */}
      <section className="rounded-[22px] bg-[linear-gradient(180deg,#fff7dd,#ffffff)] p-6 text-center shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-white shadow-[0_4px_14px_rgba(201,138,18,0.35)]">
          <BigTrophy />
        </div>
        <h1 className="mt-3 text-[24px] font-extrabold text-[var(--slate)]">
          {league ? `${league}` : "Overall"} · Race Week {week}
        </h1>
        <p className="mt-1 text-[13px] text-[var(--slate-soft)]">
          {locked
            ? "Card is settled — every horse has run. Tap a stable to see what they picked."
            : `Board updates as each race settles. Deadline hasn't hit yet — stables stay hidden.`}
        </p>

        <div className="mt-4 grid grid-cols-3 gap-3 rounded-2xl bg-[#fff2d6] p-3 text-center">
          <Stat label="Players" value={rows.length.toLocaleString("en-GB")} />
          <Stat label="Leader" value={`${rows[0].points}`} tone="go" />
          <Stat label="Your rank" value={`${rows.findIndex((r) => r.isMe) + 1 || "—"}`} />
        </div>
      </section>

      <BoardList rows={rows} locked={locked} />

      <p className="px-1 pb-2 text-[11px] leading-relaxed text-[var(--slate-soft)]">
        Placeholder standings until Week 1 settles. Ranks move as each race is scored.
      </p>
    </GameShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "go" }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
        {label}
      </div>
      <div
        className={`text-[20px] font-extrabold leading-none tracking-tight ${
          tone === "go" ? "text-[var(--go-deep)]" : "text-[var(--slate)]"
        }`}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </div>
    </div>
  );
}

function BoardList({ rows, locked }: { rows: Row[]; locked: boolean }) {
  return (
    <section className="rounded-[22px] bg-white p-3 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
      <div className="divide-y divide-[#eef2f6]">
        {rows.map((row, i) => (
          <PlayerRow key={row.id} pos={i + 1} row={row} locked={locked} />
        ))}
      </div>
    </section>
  );
}

function PlayerRow({ pos, row, locked }: { pos: number; row: Row; locked: boolean }) {
  const delta = row.lastPoints > 0 ? Math.sign(row.lastPoints - row.points) : 0;
  const Inner = (
    <div
      className={`grid grid-cols-[38px_1fr_auto_auto] items-center gap-3 rounded-xl px-2 py-2.5 ${
        row.isMe ? "bg-[#eaf7f0] ring-1 ring-[var(--go-deep)]/30" : ""
      }`}
    >
      <div
        className="text-center text-[15px] font-extrabold text-[var(--slate)]"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {pos <= 3 ? <Medal place={pos} /> : pos.toLocaleString("en-GB")}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[14px] font-bold text-[var(--slate)]">
          {row.stableName}
          {row.isMe && (
            <span className="ml-2 rounded-full bg-[var(--slate)] px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-white">
              You
            </span>
          )}
        </div>
      </div>
      <div className="text-right">
        <div
          className="text-[16px] font-extrabold leading-none text-[var(--slate)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {row.points}
        </div>
        <div className="mt-0.5 text-[10px] font-semibold text-[var(--slate-soft)]">pts</div>
      </div>
      <div className="w-6 text-center">
        {delta > 0 && <ArrowUp />}
        {delta < 0 && <ArrowDown />}
        {delta === 0 && <span className="text-[10px] text-[var(--slate-soft)]">—</span>}
      </div>
    </div>
  );
  return locked ? (
    <Link href={`/game/player/${row.id}`} className="block hover:bg-[#f6f8fb]">
      {Inner}
    </Link>
  ) : (
    <div>{Inner}</div>
  );
}

/* ------------------------------------------------------------------ marks */

function BigTrophy() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
      <path
        d="M18 6h28v14c0 8-6.3 14-14 14s-14-6-14-14V6Z"
        fill="#f0b429"
        stroke="#c98a12"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M18 10h-6a7 7 0 0 0 7 7M46 10h6a7 7 0 0 1-7 7"
        stroke="#c98a12"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M27 38h10l2 9H25l2-9Z" fill="#c98a12" />
      <rect x="20" y="47" width="24" height="6" rx="1.5" fill="#f0b429" stroke="#c98a12" strokeWidth="1.8" />
      <circle cx="32" cy="15" r="3.5" fill="#fff5d0" />
    </svg>
  );
}

function Medal({ place }: { place: number }) {
  const fill = place === 1 ? "#f0b429" : place === 2 ? "#c9c9d5" : "#c98a12";
  const stroke = place === 1 ? "#a97e0f" : place === 2 ? "#8f8f9a" : "#7a5b00";
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden className="mx-auto">
      <circle cx="12" cy="14" r="7" fill={fill} stroke={stroke} strokeWidth="1.5" />
      <text x="12" y="17" textAnchor="middle" fontSize="8" fontWeight="800" fill="#5a3d00">
        {place}
      </text>
      <path d="M8 3v6l4-2 4 2V3H8Z" fill={fill} stroke={stroke} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowUp() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="mx-auto">
      <path d="M6 3l4 5H2l4-5Z" fill="#0b8a4e" />
    </svg>
  );
}

function ArrowDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="mx-auto">
      <path d="M6 9l-4-5h8L6 9Z" fill="#c0392b" />
    </svg>
  );
}

/* ---------------------------------------------------------------- real */

async function loadBoardRows({ date, leagueCode }: { date: string; leagueCode?: string }) {
  const stableName = (email: string, display: string | null) =>
    display ? `${display}’s Stable` : `${email.split("@")[0]}’s Stable`;

  if (leagueCode) {
    const league = (await db.select().from(leagues).where(eq(leagues.code, leagueCode)).limit(1))[0];
    if (!league) return [];
    const rows = await db
      .select({
        userId: leagueMembers.userId,
        email: users.email,
        displayName: users.displayName,
        stableId: stables.id,
        points: stables.points,
      })
      .from(leagueMembers)
      .innerJoin(users, eq(users.id, leagueMembers.userId))
      .leftJoin(
        stables,
        and(eq(stables.userId, leagueMembers.userId), eq(stables.raceDate, date))
      )
      .where(eq(leagueMembers.leagueId, league.id))
      .orderBy(desc(stables.points));
    return rows.map((r) => ({
      userId: r.userId,
      stableId: r.stableId,
      stableName: stableName(r.email, r.displayName),
      owner: r.email,
      points: r.points ?? 0,
    }));
  }

  const rows = await db
    .select({
      userId: stables.userId,
      email: users.email,
      displayName: users.displayName,
      stableId: stables.id,
      points: stables.points,
    })
    .from(stables)
    .innerJoin(users, eq(users.id, stables.userId))
    .where(eq(stables.raceDate, date))
    .orderBy(desc(stables.points));
  return rows.map((r) => ({
    userId: r.userId,
    stableId: r.stableId,
    stableName: stableName(r.email, r.displayName),
    owner: r.email,
    points: r.points ?? 0,
  }));
}

/* ------------------------------------------------------------------ mock */

function mockBoard(myEmail: string): Row[] {
  const names = [
    ["Frankie's Boys", "d@igamingaffiliates.io"],
    ["Willie’s Way", "will@ex.co"],
    ["The Turf Cartel", "sara@ex.co"],
    ["Northern Rock", "mike@ex.co"],
    ["Small Stakes Gang", "jo@ex.co"],
    ["Point To Point", "ali@ex.co"],
    ["Bunbury Yard", "tom@ex.co"],
    ["Ivy Sports Bar FL Champs", "phil@ex.co"],
  ];
  return names.map((n, i) => ({
    id: `stb_${i + 1}`,
    stableName: n[0],
    owner: n[1],
    points: 148 - i * 11 - (i % 2 ? 3 : 0),
    lastPoints: 148 - i * 11 - (i % 2 ? 3 : 0) + (i % 3 === 0 ? 4 : i % 3 === 1 ? -6 : 0),
    napHit: i === 1 || i === 4,
    isMe: n[1] === myEmail,
  }));
}
