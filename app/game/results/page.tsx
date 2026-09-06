/**
 * Results.
 *
 * The race-by-race breakdown of what a player's picks did. Big total up top;
 * then every race that was on the card with the horse the player picked in
 * it (or "No pick" if they didn't), the finishing position, and the points
 * that horse earned. Jockey rides sit under the horse rows in their own
 * section.
 *
 * Rendering strategy: for every race on the game card, look up the runner
 * with the horse this player picked. If we have `positionNum`, we compute
 * the points inline via `horsePoints`; if not, we mark the race as pending.
 * That means the same page works before, during, and after the day — it just
 * gets progressively more filled in.
 *
 * Everything on this page runs off real Racing API data — no mocks. The
 * numbers come from the same functions the leaderboard will use when
 * settlement is wired.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { GameShell, SubpageHeader } from "@/components/game/game-shell";
import { AutoRefresh } from "@/components/game/auto-refresh";
import { loadCard, raceWeekFor, today } from "@/lib/game-data";
import { loadStable } from "@/lib/stable";
import {
  horsePoints,
  jockeyPoints,
  NAP_MULTIPLIER,
  type RunnerResult,
} from "@/lib/game-pricing";
import { pickStable, type GameCard, type PricedRunner } from "@/lib/game-card";
import { db, runners as runnersT } from "@/db";
import { and, eq, inArray } from "drizzle-orm";

export const metadata: Metadata = { title: "Results — Fantasy Stable" };
export const dynamic = "force-dynamic";

type RaceRow = {
  raceId: string;
  course: string;
  offTime: string;
  raceName: string;
  pick: PricedRunner | null;
  result: RunnerResult | null;
  points: number | null;
  isNap: boolean;
  deadHeat?: boolean;
};

export default async function ResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string; date?: string }>;
}) {
  const { preview, date: dateParam } = await searchParams;
  const date = dateParam ?? today();
  const user =
    (await currentUser()) ??
    (preview ? { id: "__preview__", email: "preview@fantasystable.co.uk", displayName: "Preview" } : null);
  if (!user) redirect("/game/sign-in");

  const { card } = await loadCard(date);
  const saved = user.id === "__preview__" ? null : await loadStable(user.id, date);

  // Preview: use the optimiser's team so we see a full breakdown even without
  // a saved stable.
  const example = !saved ? pickStable(card) : null;
  const horseIds = saved?.horseIds ?? example?.horses.map((h) => h.horseId) ?? [];
  const jockeyIds = saved?.jockeyIds ?? example?.jockeys.map((j) => j.id) ?? [];
  const napId = saved?.napHorseId ?? example?.nap?.horseId ?? null;

  // For every horse in the stable, fetch its finishing position from the
  // runners table. `resultByHorse` maps horseId → RunnerResult; missing means
  // the race hasn't been settled yet.
  const resultByHorse = new Map<string, RunnerResult & { raceId: string }>();
  const cardRaceIdList = card.races.map((r) => r.raceId);
  const positionCounts = new Map<string, number>(); // raceId|position -> N
  if (horseIds.length && cardRaceIdList.length) {
    const rows = await db
      .select({
        raceId: runnersT.raceId,
        horseId: runnersT.horseId,
        positionNum: runnersT.positionNum,
        position: runnersT.position,
        spDec: runnersT.spDec,
        isNonRunner: runnersT.isNonRunner,
      })
      .from(runnersT)
      .where(
        and(
          inArray(runnersT.horseId, horseIds),
          inArray(runnersT.raceId, cardRaceIdList)
        )
      );
    for (const r of rows) {
      resultByHorse.set(r.horseId, {
        raceId: r.raceId,
        positionNum: r.positionNum,
        position: r.position,
        spDec: r.spDec,
        isNonRunner: r.isNonRunner ?? false,
      });
    }
    // Full field for each race we care about, to count ties
    const raceIds = [...new Set(rows.map((r) => r.raceId))];
    if (raceIds.length) {
      const full = await db
        .select({ raceId: runnersT.raceId, positionNum: runnersT.positionNum })
        .from(runnersT)
        .where(inArray(runnersT.raceId, raceIds));
      for (const r of full) {
        if (r.positionNum == null) continue;
        const key = `${r.raceId}|${r.positionNum}`;
        positionCounts.set(key, (positionCounts.get(key) ?? 0) + 1);
      }
    }
  }

  // Race-by-race table: every race on the game card, with the picked horse if
  // any, and the points it scored.
  const raceRows: (RaceRow & { deadHeat: boolean })[] = card.races.map((race) => {
    const pick = race.runners.find((r) => horseIds.includes(r.horseId)) ?? null;
    const result = pick ? resultByHorse.get(pick.horseId) ?? null : null;
    const share = result && result.positionNum != null
      ? positionCounts.get(`${race.raceId}|${result.positionNum}`) ?? 1
      : 1;
    const rawPoints = result ? horsePoints(result, share) : null;
    const isNap = pick?.horseId === napId;
    const points = rawPoints === null ? null : isNap ? rawPoints * NAP_MULTIPLIER : rawPoints;
    return {
      raceId: race.raceId,
      course: race.course,
      offTime: race.offTime,
      raceName: race.name,
      pick,
      result,
      points,
      isNap,
      deadHeat: share > 1,
    };
  });

  // Jockey scoring: fetch every ride each of the player's jockeys had TODAY,
  // then apply jockeyPoints. Rides outside the game card don't count.
  const jockeyRides = await db
    .select({
      jockeyId: runnersT.jockeyId,
      raceId: runnersT.raceId,
      positionNum: runnersT.positionNum,
      position: runnersT.position,
      spDec: runnersT.spDec,
      isNonRunner: runnersT.isNonRunner,
      horseName: runnersT.horseName,
    })
    .from(runnersT)
    .where(
      jockeyIds.length && cardRaceIdList.length
        ? and(inArray(runnersT.jockeyId, jockeyIds), inArray(runnersT.raceId, cardRaceIdList))
        : eq(runnersT.raceId, "__none__")
    );

  const cardRaceIds = new Set(card.races.map((r) => r.raceId));
  type JockeyLine = {
    id: string;
    name: string;
    rides: { horseName: string; race: string; positionNum: number | null; position: string | null; points: number }[];
    total: number;
  };
  const jockeyLines = new Map<string, JockeyLine>();
  const jockeyNameById = new Map(card.jockeys.map((j) => [j.id, j.name] as const));
  for (const id of jockeyIds) {
    jockeyLines.set(id, {
      id,
      name: jockeyNameById.get(id) ?? id,
      rides: [],
      total: 0,
    });
  }
  // Add ride races to positionCounts if not already present
  const rideRaces = [...new Set(jockeyRides.map((r) => r.raceId))];
  const missing = rideRaces.filter((id) => ![...positionCounts.keys()].some((k) => k.startsWith(`${id}|`)));
  if (missing.length) {
    const extras = await db
      .select({ raceId: runnersT.raceId, positionNum: runnersT.positionNum })
      .from(runnersT)
      .where(inArray(runnersT.raceId, missing));
    for (const e of extras) {
      if (e.positionNum == null) continue;
      const key = `${e.raceId}|${e.positionNum}`;
      positionCounts.set(key, (positionCounts.get(key) ?? 0) + 1);
    }
  }
  for (const r of jockeyRides) {
    if (!r.jockeyId || !cardRaceIds.has(r.raceId)) continue;
    const line = jockeyLines.get(r.jockeyId);
    if (!line) continue;
    const share = r.positionNum != null
      ? positionCounts.get(`${r.raceId}|${r.positionNum}`) ?? 1
      : 1;
    const pts = jockeyPoints([
      { positionNum: r.positionNum, position: r.position, spDec: r.spDec, isNonRunner: r.isNonRunner ?? false, deadHeatShare: share },
    ]);
    line.rides.push({
      horseName: r.horseName,
      race: card.races.find((race) => race.raceId === r.raceId)?.offTime ?? "",
      positionNum: r.positionNum,
      position: r.position,
      points: pts,
    });
    line.total += pts;
  }

  const anySettled =
    raceRows.some((r) => r.points !== null) || [...jockeyLines.values()].some((j) => j.total > 0);
  const totalHorsePoints = raceRows.reduce((s, r) => s + (r.points ?? 0), 0);
  const totalJockeyPoints = [...jockeyLines.values()].reduce((s, j) => s + j.total, 0);
  const total = totalHorsePoints + totalJockeyPoints;

  return (
    <GameShell>
      <AutoRefresh intervalMs={30_000} />
      <SubpageHeader title={`Results · Race Week ${raceWeekFor(date)}`} />

      {/* Total */}
      <section className="rounded-[22px] bg-[linear-gradient(180deg,#fff7dd,#ffffff)] p-6 text-center shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <p className="text-[11px] font-bold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
          Your total
        </p>
        <p
          className="mt-1 text-[52px] font-extrabold leading-none text-[var(--slate)]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {anySettled ? total : "—"}
        </p>
        <p className="mt-1 text-[13px] text-[var(--slate-soft)]">
          {anySettled ? "points" : "Results land as each race settles."}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-white p-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
              Horses
            </div>
            <div
              className="text-[20px] font-extrabold leading-none text-[var(--slate)]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {totalHorsePoints}
            </div>
          </div>
          <div className="border-l border-[#f0eaf2] pl-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
              Jockeys
            </div>
            <div
              className="text-[20px] font-extrabold leading-none text-[var(--slate)]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {totalJockeyPoints}
            </div>
          </div>
        </div>
      </section>

      {/* Horses — race-by-race */}
      <RaceList rows={raceRows} card={card} />

      {/* Jockeys — ride-by-ride */}
      <JockeyList lines={[...jockeyLines.values()]} />

      <p className="px-1 pb-2 text-[11px] leading-relaxed text-[var(--slate-soft)]">
        Points update as each race is called. NAP scores double. Non-runners score zero. Fallers,
        pulled-up and unseated score −5.
      </p>
    </GameShell>
  );
}

/* ----------------------------------------------------------------- races */

function RaceList({ rows, card }: { rows: RaceRow[]; card: GameCard }) {
  const cardName = new Set(card.races.map((r) => r.raceId));
  const _ = cardName; // silence unused warning
  return (
    <section className="rounded-[22px] bg-white p-3 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
      <h2 className="px-2 pb-1 pt-1 text-[15px] font-extrabold uppercase tracking-tight text-[var(--slate)]">
        Race by race
      </h2>
      <div className="divide-y divide-[#eef2f6]">
        {rows.map((row) => (
          <RaceRow key={row.raceId} row={row} />
        ))}
      </div>
    </section>
  );
}

function RaceRow({ row }: { row: RaceRow }) {
  const position = row.result?.positionNum ?? null;
  const posLabel =
    row.result?.isNonRunner
      ? "NR"
      : position
        ? (row.deadHeat ? `=${position}` : String(position))
        : row.result?.position ?? "—";
  const pending = row.result === null && row.pick !== null;
  const noPick = row.pick === null;
  const points = row.points;

  return (
    <div className="grid grid-cols-[46px_1fr_44px_60px] items-center gap-3 px-2 py-2.5">
      <div className="num text-[11px] font-bold text-[var(--slate)]" style={{ fontVariantNumeric: "tabular-nums" }}>
        {row.offTime}
        <div className="text-[9.5px] font-semibold text-[var(--slate-soft)]">{row.course}</div>
      </div>
      <div className="min-w-0">
        {row.pick ? (
          <div className="flex items-center gap-2">
            {row.pick.silkUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={row.pick.silkUrl} alt="" width={26} height={26} className="h-6 w-6 shrink-0 object-contain" />
            )}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-bold text-[var(--slate)]">
                {row.pick.horse}
                {row.isNap && (
                  <span className="ml-1.5 rounded-full bg-[var(--go-deep)] px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-white">
                    NAP
                  </span>
                )}
              </div>
              <div className="truncate text-[10.5px] text-[var(--slate-soft)]">{row.pick.frac}</div>
            </div>
          </div>
        ) : (
          <div className="text-[12.5px] italic text-[var(--slate-soft)]">No pick in this race</div>
        )}
      </div>
      <div className="text-center">
        <span
          className={`inline-flex h-8 min-w-[32px] items-center justify-center rounded-full px-2 text-[13px] font-extrabold ${
            position === 1
              ? "bg-[#fff2d6] text-[#7a5b00]"
              : position && position <= 5
                ? "bg-[#eaf7f0] text-[var(--go-deep)]"
                : posLabel === "NR"
                  ? "bg-[#f0eaf2] text-[var(--slate-soft)]"
                  : "bg-[#eef2f6] text-[var(--slate-soft)]"
          }`}
        >
          {posLabel}
        </span>
      </div>
      <div className="text-right">
        {pending ? (
          <span className="text-[11px] font-semibold text-[var(--slate-soft)]">pending</span>
        ) : noPick ? (
          <span className="text-[11px] text-[var(--slate-soft)]">0</span>
        ) : (
          <span
            className={`text-[17px] font-extrabold ${
              points === null || points === 0
                ? "text-[var(--slate-soft)]"
                : points > 0
                  ? "text-[var(--slate)]"
                  : "text-[#c0392b]"
            }`}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {points === null ? "—" : points > 0 ? `+${points}` : points}
          </span>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- jockeys */

function JockeyList({
  lines,
}: {
  lines: {
    id: string;
    name: string;
    rides: { horseName: string; race: string; positionNum: number | null; position: string | null; points: number }[];
    total: number;
  }[];
}) {
  if (!lines.length) return null;
  return (
    <section className="rounded-[22px] bg-white p-3 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
      <h2 className="px-2 pb-2 pt-1 text-[15px] font-extrabold uppercase tracking-tight text-[var(--slate)]">
        Jockey rides
      </h2>
      <div className="divide-y divide-[#eef2f6]">
        {lines.map((line) => (
          <div key={line.id} className="px-2 py-3">
            <div className="flex items-center justify-between">
              <div className="text-[14px] font-extrabold text-[var(--slate)]">{line.name}</div>
              <div
                className="text-[18px] font-extrabold text-[var(--slate)]"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {line.total}
                <span className="ml-1 text-[10px] font-semibold text-[var(--slate-soft)]">pts</span>
              </div>
            </div>
            {line.rides.length === 0 ? (
              <p className="mt-1 text-[11.5px] italic text-[var(--slate-soft)]">
                No scoring rides on the card.
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-[12px] text-[var(--slate-soft)]">
                {line.rides.map((r, i) => (
                  <li
                    key={i}
                    className="grid grid-cols-[44px_1fr_28px_44px] items-center gap-2"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    <span>{r.race}</span>
                    <span className="truncate text-[var(--slate)]">{r.horseName}</span>
                    <span className="text-center">{r.positionNum ?? r.position ?? "—"}</span>
                    <span className={`text-right font-extrabold ${r.points > 0 ? "text-[var(--slate)]" : ""}`}>
                      {r.points > 0 ? `+${r.points}` : r.points || "0"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
