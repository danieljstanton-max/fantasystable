"use client";

/**
 * Two admin-only ops:
 *
 *   • Sweep NRs — remove non-runners from active stables and email the
 *     players. Safe to hit repeatedly through the buy window.
 *   • Send recap — one summary email per player for a given race date.
 *     Sending twice would double the mail, so this one is not idempotent —
 *     the button is here for the once-a-day send.
 *
 * Kept as one file because both are the same "run a job, show what it did"
 * pattern; a shared button feels wrong when the semantics are so different.
 */

import { useState, useTransition } from "react";
import { nrSweepAction, recapAction } from "../actions";

export function NrSweepButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  function onClick() {
    setMsg(null);
    start(async () => {
      const r = await nrSweepAction();
      setMsg(
        r.ok
          ? { tone: "ok", text: `Swept ${r.swept} stables · emailed ${r.emailed} players.` }
          : { tone: "bad", text: r.error ?? "Sweep failed." }
      );
    });
  }
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="self-start rounded-xl bg-[var(--slate)] px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-50"
      >
        {pending ? "Sweeping…" : "Sweep non-runners now"}
      </button>
      {msg && (
        <p className={`text-[12.5px] font-semibold ${msg.tone === "ok" ? "text-[var(--go-deep)]" : "text-[#a3261f]"}`}>
          {msg.text}
        </p>
      )}
      <p className="text-[11.5px] leading-relaxed text-[var(--slate-soft)]">
        Removes non-runners from every open stable, refunds the price, and emails the player. Safe
        to run repeatedly.
      </p>
    </div>
  );
}

export function RecapButton({ defaultDate }: { defaultDate: string }) {
  const [date, setDate] = useState(defaultDate);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  function onClick() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setMsg(null);
    start(async () => {
      const r = await recapAction(date);
      setMsg(
        r.ok
          ? {
              tone: "ok",
              text: `Sent recap to ${r.emailed} of ${r.entrants} entrants${
                r.winner ? ` — winner: ${r.winner}` : ""
              }.`,
            }
          : { tone: "bad", text: r.error ?? "Recap failed." }
      );
    });
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[var(--slate-soft)]">
            Race date
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setConfirming(false);
            }}
            className="rounded-lg border border-[#eef2f6] px-3 py-2 text-[13px] font-semibold text-[var(--slate)]"
          />
        </label>
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className={`rounded-xl px-4 py-2.5 text-[13px] font-extrabold text-white disabled:opacity-50 ${
            confirming ? "bg-[#a3261f]" : "bg-[linear-gradient(180deg,#1adc86,#04b56b)]"
          }`}
        >
          {pending
            ? "Sending…"
            : confirming
              ? "Tap again to confirm"
              : "Send recap emails"}
        </button>
      </div>
      {msg && (
        <p className={`text-[12.5px] font-semibold ${msg.tone === "ok" ? "text-[var(--go-deep)]" : "text-[#a3261f]"}`}>
          {msg.text}
        </p>
      )}
      <p className="text-[11.5px] leading-relaxed text-[var(--slate-soft)]">
        One personalised summary per player. Two-tap confirmation because sending twice would
        deliver two copies.
      </p>
    </div>
  );
}
