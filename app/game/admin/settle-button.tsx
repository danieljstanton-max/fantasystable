"use client";

/**
 * Trigger settlement on demand from the admin tab.
 *
 * Same result as `npm run settle:game -- <date>` — idempotent, safe to hit
 * repeatedly as more results settle through the afternoon. The button is
 * disabled while the action is in flight and shows the outcome inline so
 * you don't wonder whether the tap "took".
 */

import { useState, useTransition } from "react";
import { settleGameAction } from "../actions";

export function SettleButton({ defaultDate }: { defaultDate: string }) {
  const [date, setDate] = useState(defaultDate);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  function onClick() {
    setMsg(null);
    start(async () => {
      const r = await settleGameAction(date);
      setMsg(
        r.ok
          ? { tone: "ok", text: `Settled — ${r.stables} stables, ${r.points} pts written.` }
          : { tone: "bad", text: r.error ?? "Settlement failed." }
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
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-[#eef2f6] px-3 py-2 text-[13px] font-semibold text-[var(--slate)]"
          />
        </label>
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className="rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] px-4 py-2.5 text-[13px] font-extrabold text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)] disabled:opacity-50"
        >
          {pending ? "Settling…" : "Settle now"}
        </button>
      </div>
      {msg && (
        <p
          className={`text-[12.5px] font-semibold ${
            msg.tone === "ok" ? "text-[var(--go-deep)]" : "text-[#a3261f]"
          }`}
        >
          {msg.text}
        </p>
      )}
      <p className="text-[11.5px] leading-relaxed text-[var(--slate-soft)]">
        Idempotent — safe to run again as more results come in. Refreshes leaderboard and
        results pages.
      </p>
    </div>
  );
}
