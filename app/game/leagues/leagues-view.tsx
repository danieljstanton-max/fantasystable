"use client";

import { useState } from "react";
import Link from "next/link";

type League = {
  code?: string;
  name: string;
  rank: number;
  lastRank: number;
  players: number;
  isOverall?: boolean;
};

type Festival = {
  slug: string;
  name: string;
  starts: string; // "18 Nov"
  days: number;
  joined: boolean;
};

export function LeaguesView({
  leagues,
  festivals,
}: {
  leagues: League[];
  festivals: Festival[];
}) {
  const [tab, setTab] = useState<"leagues" | "festivals">("leagues");

  return (
    <>
      <div className="rounded-[22px] bg-white/95 p-4 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <div className="mb-4 flex gap-1 rounded-xl bg-[#eef2f6] p-1">
          <TabButton active={tab === "leagues"} onClick={() => setTab("leagues")}>
            Leagues
          </TabButton>
          <TabButton active={tab === "festivals"} onClick={() => setTab("festivals")}>
            Festivals
          </TabButton>
        </div>

        {tab === "leagues" && (
          <div className="grid gap-2">
            <Link
              href="/game/leagues/join"
              className="flex items-center justify-center gap-2 rounded-2xl bg-[var(--slate)] px-4 py-3.5 text-[14px] font-extrabold text-white"
            >
              <EnterIcon /> Join a League
            </Link>
            <Link
              href="/game/leagues/create"
              className="flex items-center justify-center gap-2 rounded-2xl bg-[var(--slate)] px-4 py-3.5 text-[14px] font-extrabold text-white"
            >
              <PlusIcon /> Create a League
            </Link>
          </div>
        )}

        {tab === "festivals" && (
          <p className="text-[13px] leading-relaxed text-[var(--slate-soft)]">
            Big meetings get their own leaderboard, scored over the whole festival — three days at
            Cheltenham, four at Royal Ascot. Enter one and every stable you save that week counts.
          </p>
        )}
      </div>

      {tab === "leagues" && leagues.length === 0 && (
        <div className="rounded-[22px] bg-white/95 p-6 text-center shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
          <p className="text-[15px] font-bold text-[var(--slate)]">You&rsquo;re not in any leagues yet.</p>
          <p className="mx-auto mt-2 max-w-[300px] text-[13px] text-[var(--slate-soft)]">
            Create one and share the code with your mates — or paste a code someone sent you into Join a League.
          </p>
        </div>
      )}

      {tab === "leagues" && leagues.length > 0 && (
        <div className="rounded-[22px] bg-white/95 p-4 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
          <h2 className="text-[18px] font-extrabold text-[var(--slate)]">Your Leagues</h2>
          <div className="mt-4 divide-y divide-[#eef2f6]">
            <header className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 pb-2 text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--slate-soft)]">
              <span>League</span>
              <span className="w-16 text-right">Rank</span>
              <span className="w-16 text-right">Last</span>
              <span className="w-8" />
            </header>
            {leagues.map((l) => {
              const better = l.lastRank > l.rank;
              const worse = l.lastRank < l.rank;
              return (
                <div key={l.name} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-bold text-[var(--slate)]">
                      {l.name}
                      {l.isOverall && (
                        <span className="ml-2 rounded-full bg-[#eef2f6] px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-[var(--slate-soft)]">
                          Global
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-[var(--slate-soft)]">
                      {l.players.toLocaleString("en-GB")} players
                    </div>
                  </div>
                  <div
                    className="w-16 text-right text-[15px] font-extrabold text-[var(--slate)]"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {l.rank.toLocaleString("en-GB")}
                  </div>
                  <div
                    className="w-16 text-right text-[13px] font-semibold text-[var(--slate-soft)]"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    <span className="inline-flex items-center gap-1">
                      {better && <ArrowUp />}
                      {worse && <ArrowDown />}
                      {l.lastRank.toLocaleString("en-GB")}
                    </span>
                  </div>
                  <Link
                    href={l.code ? `/game/leaderboard?league=${l.code}` : "#"}
                    aria-label={`Open ${l.name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[#eef2f6] text-[var(--slate)]"
                  >
                    ›
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "festivals" && (
        <div className="rounded-[22px] bg-white/95 p-4 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
          <h2 className="text-[18px] font-extrabold text-[var(--slate)]">Upcoming Festivals</h2>
          <div className="mt-4 divide-y divide-[#eef2f6]">
            {festivals.map((f) => (
              <div key={f.slug} className="grid grid-cols-[1fr_auto] items-center gap-3 py-3">
                <div className="min-w-0">
                  <div className="truncate text-[14px] font-bold text-[var(--slate)]">{f.name}</div>
                  <div className="text-[11.5px] text-[var(--slate-soft)]">
                    Starts {f.starts} · {f.days} days · one leaderboard for the whole festival
                  </div>
                </div>
                <button
                  type="button"
                  className={`rounded-xl px-3.5 py-2 text-[12px] font-extrabold ${
                    f.joined
                      ? "bg-[#eaf7f0] text-[var(--go-deep)]"
                      : "bg-[var(--slate)] text-white"
                  }`}
                >
                  {f.joined ? "Joined" : "Enter"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ parts */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg py-2 text-[14px] font-extrabold transition-colors ${
        active ? "bg-white text-[var(--slate)] shadow-sm" : "text-[var(--slate-soft)]"
      }`}
    >
      {children}
    </button>
  );
}

function EnterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M6 12h12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ArrowUp() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M6 3l4 5H2l4-5Z" fill="#0b8a4e" />
    </svg>
  );
}

function ArrowDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M6 9l-4-5h8L6 9Z" fill="#c0392b" />
    </svg>
  );
}
