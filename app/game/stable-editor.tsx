"use client";

/**
 * Picking a stable.
 *
 * Client-side rules are enforced as you tap so an illegal move can never be
 * offered, and the same rules run again on the server (lib/stable.ts) because
 * none of what happens here can be trusted. The editor is UX; the server is
 * the check that counts.
 *
 * The affordability floor uses the cheapest things ACTUALLY on this card,
 * not the theoretical price constants. On a day when the cheapest jockey is
 * £2.5m, reserving the £2m constant lets you spend down to a £4m bank and
 * find every rider unaffordable — a legal position with no legal team out of
 * it. That is a worse bug than any error message.
 */

import { useMemo, useState, useTransition } from "react";
import type { GameCard, GameJockey, PricedRunner } from "@/lib/game-card";
import { BUDGET, N_HORSES, N_JOCKEYS } from "@/lib/game-pricing";
import { Bench, Pitch } from "@/components/game/pitch-view";
import { PickerSheet } from "@/components/game/picker-sheet";
import { StatBar } from "@/components/game/game-chrome";
import { money } from "@/components/game/format";
import type { SaveStableResponse } from "./actions";
import { SelectionPanel } from "./selection-panel";

type Props = {
  card: GameCard;
  initial: { horseIds: string[]; jockeyIds: string[]; napHorseId: string | null };
  locked: boolean;
  save: (
    date: string,
    selection: { horseIds: string[]; jockeyIds: string[]; napHorseId: string | null }
  ) => Promise<SaveStableResponse>;
};

export function StableEditor({ card, initial, locked, save }: Props) {
  const [horseIds, setHorseIds] = useState<string[]>(initial.horseIds);
  const [jockeyIds, setJockeyIds] = useState<string[]>(initial.jockeyIds);
  const [napHorseId, setNap] = useState<string | null>(initial.napHorseId);
  const [notice, setNotice] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, startSaving] = useTransition();
  const [pickerOpen, setPickerOpen] = useState<null | "horses" | "jockeys">(null);

  const byHorse = useMemo(
    () => new Map(card.races.flatMap((r) => r.runners.map((x) => [x.horseId, x] as const))),
    [card]
  );
  const byJockey = useMemo(() => new Map(card.jockeys.map((j) => [j.id, j] as const)), [card]);

  const runners = useMemo(
    () =>
      card.races.flatMap((race) =>
        race.runners.map((r) => ({ ...r, course: race.course, offTime: race.offTime }))
      ),
    [card]
  );

  const horses = horseIds.map((id) => byHorse.get(id)).filter(Boolean) as PricedRunner[];
  const jockeys = jockeyIds.map((id) => byJockey.get(id)).filter(Boolean) as GameJockey[];
  const spend = horses.reduce((s, h) => s + h.price, 0) + jockeys.reduce((s, j) => s + j.price, 0);
  const bank = Math.round((BUDGET - spend) * 10) / 10;

  const takenRaces = useMemo(
    () => new Map(horses.map((h) => [h.raceId, h.horse] as const)),
    [horses]
  );

  function floorFor(opts: {
    extraHorses?: number;
    extraJockeys?: number;
    skipRaceId?: string;
    skipJockeyId?: string;
    horsesNow?: PricedRunner[];
    jockeysNow?: GameJockey[];
  }) {
    const hs = opts.horsesNow ?? horses;
    const js = opts.jockeysNow ?? jockeys;
    const horseSlots = Math.max(0, N_HORSES - hs.length - (opts.extraHorses ?? 0));
    const jockeySlots = Math.max(0, N_JOCKEYS - js.length - (opts.extraJockeys ?? 0));

    const used = new Set(hs.map((h) => h.raceId));
    if (opts.skipRaceId) used.add(opts.skipRaceId);
    const cheapestPerRace = card.races
      .filter((r) => !used.has(r.raceId) && r.runners.length > 0)
      .map((r) => Math.min(...r.runners.map((x) => x.price)))
      .sort((a, b) => a - b);
    if (cheapestPerRace.length < horseSlots) return Infinity;

    const picked = new Set(js.map((j) => j.id));
    const cheapestJockeys = card.jockeys
      .filter((j) => !picked.has(j.id) && j.id !== opts.skipJockeyId)
      .map((j) => j.price)
      .sort((a, b) => a - b);
    if (cheapestJockeys.length < jockeySlots) return Infinity;

    return (
      cheapestPerRace.slice(0, horseSlots).reduce((s, x) => s + x, 0) +
      cheapestJockeys.slice(0, jockeySlots).reduce((s, x) => s + x, 0)
    );
  }

  const canAffordHorse = (h: PricedRunner) =>
    spend + h.price + floorFor({ extraHorses: 1, skipRaceId: h.raceId }) <= BUDGET + 1e-6;
  const canAffordJockey = (j: GameJockey) =>
    spend + j.price + floorFor({ extraJockeys: 1, skipJockeyId: j.id }) <= BUDGET + 1e-6;

  function toggleHorse(h: PricedRunner) {
    if (locked) return;
    setNotice(null);
    setMessage(null);
    if (horseIds.includes(h.horseId)) {
      setHorseIds((ids) => ids.filter((id) => id !== h.horseId));
      if (napHorseId === h.horseId) setNap(null);
      return;
    }
    const clash = takenRaces.get(h.raceId);
    if (clash) return setNotice(`You already have ${clash} in that race`);
    if (horses.length >= N_HORSES) return setNotice("That is six horses — remove one first");
    if (!canAffordHorse(h)) return setNotice("Not enough left to fill the rest of your stable");
    setHorseIds((ids) => [...ids, h.horseId]);
  }

  function toggleJockey(j: GameJockey) {
    if (locked) return;
    setNotice(null);
    setMessage(null);
    if (jockeyIds.includes(j.id)) return setJockeyIds((ids) => ids.filter((id) => id !== j.id));
    if (jockeys.length >= N_JOCKEYS) return setNotice("Two jockeys is the limit");
    if (!canAffordJockey(j)) return setNotice("Not enough left to fill the rest of your stable");
    setJockeyIds((ids) => [...ids, j.id]);
  }

  function autoPick() {
    if (locked) return;
    setNotice(null);
    setMessage(null);

    const chosenH = [...horses];
    const chosenJ = [...jockeys];
    let running = spend;

    while (chosenH.length < N_HORSES) {
      const used = new Set(chosenH.map((h) => h.raceId));
      const options = runners
        .filter((r) => !used.has(r.raceId))
        .filter(
          (r) =>
            running +
              r.price +
              floorFor({
                extraHorses: 1,
                skipRaceId: r.raceId,
                horsesNow: chosenH,
                jockeysNow: chosenJ,
              }) <=
            BUDGET + 1e-6
        )
        .sort((a, b) => b.price - a.price);
      if (!options.length) break;
      chosenH.push(options[0]);
      running += options[0].price;
    }

    while (chosenJ.length < N_JOCKEYS) {
      const taken = new Set(chosenJ.map((j) => j.id));
      const options = card.jockeys
        .filter((j) => !taken.has(j.id))
        .filter(
          (j) =>
            running +
              j.price +
              floorFor({
                extraJockeys: 1,
                skipJockeyId: j.id,
                horsesNow: chosenH,
                jockeysNow: chosenJ,
              }) <=
            BUDGET + 1e-6
        )
        .sort((a, b) => b.price - a.price);
      if (!options.length) break;
      chosenJ.push(options[0]);
      running += options[0].price;
    }

    setHorseIds(chosenH.map((h) => h.horseId));
    setJockeyIds(chosenJ.map((j) => j.id));
    if (!napHorseId && chosenH.length) {
      setNap(chosenH.reduce((m, h) => (h.price > m.price ? h : m), chosenH[0]).horseId);
    }
  }

  const complete = horses.length === N_HORSES && jockeys.length === N_JOCKEYS && !!napHorseId;

  function onSave() {
    setMessage(null);
    startSaving(async () => {
      const result = await save(card.date, { horseIds, jockeyIds, napHorseId });
      setMessage(
        result.ok
          ? { tone: "ok", text: `Stable saved — £${result.spend?.toFixed(1)}m spent.` }
          : { tone: "bad", text: result.error ?? "Could not save that." }
      );
    });
  }

  return (
    <>
      <StatBar
        cells={[
          { label: "Horses", value: `${horses.length}/${N_HORSES}` },
          { label: "Jockeys", value: `${jockeys.length}/${N_JOCKEYS}` },
          { label: "Bank", value: money(bank), tone: bank < 0 ? "bad" : "go" },
          { label: "Spent", value: money(Math.round(spend * 10) / 10) },
        ]}
      />

      <Pitch
        horses={horses}
        napHorseId={napHorseId}
        horseHandlers={{
          onRemove: locked ? undefined : toggleHorse,
          onNap: locked ? undefined : (h) => setNap(h.horseId),
          onPickEmpty: locked ? undefined : () => setPickerOpen("horses"),
          locked,
        }}
      />

      <Bench
        jockeys={jockeys}
        handlers={{
          onRemove: toggleJockey,
          onPickEmpty: () => setPickerOpen("jockeys"),
          locked,
        }}
      />

      <ActionRow
        onSell={() => setPickerOpen("horses")}
        locked={locked}
      />

      <PickerSheet
        open={pickerOpen !== null}
        onClose={() => setPickerOpen(null)}
        title={pickerOpen === "jockeys" ? "Pick a jockey" : "Pick a horse"}
      >
        <SelectionPanel
          runners={runners}
          jockeys={card.jockeys}
          horseIds={horseIds}
          jockeyIds={jockeyIds}
          takenRaces={takenRaces}
          bank={bank}
          locked={locked}
          canAffordHorse={canAffordHorse}
          canAffordJockey={canAffordJockey}
          horsesFull={horses.length >= N_HORSES}
          jockeysFull={jockeys.length >= N_JOCKEYS}
          onToggleHorse={toggleHorse}
          onToggleJockey={toggleJockey}
          onAutoPick={autoPick}
          notice={notice}
        />
      </PickerSheet>

      <div
        className="sticky bottom-2 z-20 flex items-center gap-2 rounded-[18px] bg-white px-3 py-2 shadow-[0_6px_16px_rgba(23,48,60,0.16)]"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        <div className="min-w-0 flex-1">
          {message ? (
            <p
              className={`truncate text-[12px] font-semibold ${
                message.tone === "ok" ? "text-[var(--go-deep)]" : "text-[#c0392b]"
              }`}
            >
              {message.text}
            </p>
          ) : (
            <p className="truncate text-[12px] text-[var(--slate-soft)]">
              {locked
                ? "The card is locked."
                : !napHorseId && horses.length > 0
                  ? "Tap the yellow NAP? badge on a horse to make it your NAP."
                  : `£${bank.toFixed(1)}m left to spend · tap NAP? on another horse to swap.`}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={!complete || pending || locked}
          className="shrink-0 rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] px-6 py-2.5 text-[13px] font-extrabold text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)] disabled:cursor-not-allowed disabled:bg-none disabled:bg-[#c6d2da] disabled:shadow-none"
        >
          {pending ? "Saving…" : "Save stable"}
        </button>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- action row */

import Link from "next/link";

/**
 * Three buttons under the bench, in the shape Dan asked for:
 *
 *   Sell a horse  ·  My Leagues  ·  My Account
 *
 * "Sell a horse" opens the picker sheet — same target as tapping an empty
 * slot — so the sales mechanic and the pick mechanic share one entry point.
 * Leagues and Account are placeholder links until those pages exist; using
 * real <Link> elements now keeps the interaction pattern honest and the tap
 * targets right rather than showing greyed dummy buttons.
 */
function ActionRow({
  onSell,
  locked,
}: {
  onSell: () => void;
  locked: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 rounded-[22px] bg-white p-2 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
      <Link
        href="/game/sell"
        className={
          "flex flex-col items-center justify-center gap-0.5 rounded-xl bg-[#eef2f6] py-2.5 text-[12px] font-extrabold text-[var(--slate)] " +
          (locked ? "pointer-events-none opacity-50" : "")
        }
      >
        <span className="text-[15px]">£</span>
        Sell a Horse
      </Link>
      <Link
        href="/game/leagues"
        className="flex flex-col items-center justify-center gap-0.5 rounded-xl bg-[#eef2f6] py-2.5 text-[12px] font-extrabold text-[var(--slate)]"
      >
        <TrophyIcon />
        My Leagues
      </Link>
      <Link
        href="/game/account"
        className="flex flex-col items-center justify-center gap-0.5 rounded-xl bg-[#eef2f6] py-2.5 text-[12px] font-extrabold text-[var(--slate)]"
      >
        <UserIcon />
        My Account
      </Link>
    </div>
  );
}

function TrophyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 3h8v5a4 4 0 1 1-8 0V3Z" fill="#c98a12" stroke="#7a5b00" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M10 14h4l.6 3.5h-5.2L10 14Z" fill="#7a5b00"/>
      <rect x="7.5" y="17.5" width="9" height="2.5" rx="1" fill="#c98a12" stroke="#7a5b00" strokeWidth="1.2"/>
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8"/>
      <path d="M4 21c1-4 4-6 8-6s7 2 8 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </svg>
  );
}
