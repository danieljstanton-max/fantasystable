"use client";

/**
 * The interactive part of the Sell page — six horses laid out as a grid, and
 * an auction-hammer sheet that opens when one is tapped.
 *
 * A sale isn't wired to the server yet — this is the design pass. When
 * settlement and the sales action land, the "Confirm sale" button posts to a
 * server action that:
 *
 *   1. Verifies the stable isn't locked
 *   2. Decrements the sales counter
 *   3. Removes the pick from `stable_picks` and returns the money to the bank
 *   4. Records the sale in a `stable_sales` table for the receipt
 */

import { useState } from "react";
import type { PricedRunner } from "@/lib/game-card";

const money = (m: number) => (Number.isInteger(m) ? `${m}m` : `${m.toFixed(1)}m`);

export type SellAction = (
  date: string,
  horseId: string
) => Promise<{ ok: boolean; error?: string; salesLeft?: number; bank?: number; soldM?: number }>;

export function SellFloor({
  horses,
  boughtAt,
  preview,
  date,
  sell,
}: {
  horses: PricedRunner[];
  boughtAt: Record<string, number>;
  preview: boolean;
  date: string;
  sell: SellAction;
}) {
  const [selected, setSelected] = useState<PricedRunner | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sold, setSold] = useState<Set<string>>(new Set());
  const [receipt, setReceipt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function open(h: PricedRunner) {
    setSelected(h);
    setConfirming(false);
  }

  async function confirm() {
    if (!selected) return;
    setError(null);
    if (preview) {
      setSold((s) => new Set(s).add(selected.horseId));
      setReceipt(`Preview: ${selected.horse} sold for £${money(selected.price)}. Not saved.`);
      setSelected(null);
      return;
    }
    setConfirming(true);
    try {
      const result = await sell(date, selected.horseId);
      if (result.ok) {
        setSold((s) => new Set(s).add(selected!.horseId));
        setReceipt(
          `${selected!.horse} sold for £${money(selected!.price)} · ${result.salesLeft ?? 0} sales left · bank £${(result.bank ?? 0).toFixed(1)}m`
        );
        setSelected(null);
      } else {
        setError(result.error ?? "Could not sell.");
      }
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      {receipt && (
        <div className="rounded-[22px] bg-[#eaf7f0] px-4 py-2.5 text-[12.5px] font-semibold text-[var(--go-deep)] shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
          {receipt}
        </div>
      )}
      {error && (
        <div className="rounded-[22px] bg-[#fdecec] px-4 py-2.5 text-[12.5px] font-semibold text-[#c0392b] shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
          {error}
        </div>
      )}
      <section className="grid grid-cols-3 gap-2 rounded-[22px] bg-white/90 p-3 shadow-[0_2px_8px_rgba(23,48,60,0.06)] sm:gap-3">
        {horses.map((h) => {
          const isSold = sold.has(h.horseId);
          return (
            <button
              key={h.horseId}
              type="button"
              onClick={() => open(h)}
              disabled={isSold}
              className={
                "relative flex flex-col overflow-hidden rounded-[14px] bg-[#3f9d4a] text-left shadow-[0_3px_10px_rgba(23,48,60,0.25)] transition-transform " +
                (isSold ? "opacity-30" : "hover:-translate-y-0.5 hover:shadow-[0_5px_14px_rgba(23,48,60,0.30)]")
              }
              style={{ aspectRatio: "4/5" }}
            >
              {isSold && (
                <span className="absolute right-2 top-2 z-10 rounded-full bg-white px-2 py-0.5 text-[10px] font-extrabold text-[#c0392b]">
                  SOLD
                </span>
              )}
              <div className="flex flex-1 items-center justify-center px-1.5 pt-2" style={{ minHeight: 0 }}>
                {h.silkUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={h.silkUrl}
                    alt=""
                    width={96}
                    height={96}
                    className="max-h-full max-w-full object-contain drop-shadow-[0_2px_3px_rgba(0,0,0,0.25)]"
                  />
                ) : (
                  <div className="h-[70%] w-[52%] rounded bg-white/30" />
                )}
              </div>
              <div className="bg-white px-1.5 pb-1.5 pt-1 text-center">
                <div className="truncate text-[12px] font-semibold leading-tight text-[var(--slate)]">
                  {h.horse}
                </div>
                <div
                  className="text-[18px] font-extrabold leading-none tracking-tight text-[var(--slate)]"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {money(h.price)}
                </div>
              </div>
            </button>
          );
        })}
      </section>

      {selected && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setSelected(null)}>
          <div
            className="w-full max-w-[420px] rounded-t-[22px] bg-white p-6 shadow-[0_-8px_24px_rgba(0,0,0,0.20)] sm:rounded-[22px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#fff2d6]">
              <Hammer />
            </div>
            <h2 className="mt-4 text-center text-[19px] font-extrabold text-[var(--slate)]">
              Sell {selected.horse}?
            </h2>
            <p className="mx-auto mt-1 max-w-[300px] text-center text-[13px] text-[var(--slate-soft)]">
              At the current market price, this horse will fetch:
            </p>
            <p
              className="mt-3 text-center text-[42px] font-extrabold leading-none text-[var(--go-deep)]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              £{money(selected.price)}
            </p>
            <p className="mt-1 text-center text-[11.5px] font-semibold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
              → straight to your bank
            </p>

            <ProfitLoss
              paid={boughtAt[selected.horseId] ?? selected.price}
              nowValue={selected.price}
            />

            <div className="mt-6 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-xl bg-[#eef2f6] py-3 text-[14px] font-extrabold text-[var(--slate)]"
              >
                Keep the horse
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={confirming}
                className="rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] py-3 text-[14px] font-extrabold text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)] disabled:opacity-60"
              >
                {confirming ? "Selling…" : "Confirm sale"}
              </button>
            </div>

            {preview && (
              <p className="mt-4 text-center text-[11px] italic text-[var(--slate-soft)]">
                Preview mode — sale is not saved.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Hammer() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10l8-6 8 6-2 2-6-4-6 4-2-2Z" fill="#c98a12" stroke="#7a5b00" strokeWidth="1.2" strokeLinejoin="round"/>
      <rect x="10" y="10" width="4" height="10" rx="1" fill="#7a5b00"/>
      <rect x="6" y="19" width="12" height="3" rx="1" fill="#7a5b00"/>
    </svg>
  );
}

function ProfitLoss({ paid, nowValue }: { paid: number; nowValue: number }) {
  const delta = Math.round((nowValue - paid) * 10) / 10;
  if (Math.abs(delta) < 0.05) {
    return (
      <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-[#eef2f6] px-3 py-2 text-[12px] font-semibold text-[var(--slate-soft)]">
        Bought at £{money(paid)} · No change
      </div>
    );
  }
  const profit = delta > 0;
  return (
    <div
      className={`mt-4 flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 ${
        profit ? "bg-[#eaf7f0]" : "bg-[#fdecec]"
      }`}
    >
      <div className="text-[11px] font-bold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
        Bought at £{money(paid)}
      </div>
      <div className={`text-[15px] font-extrabold ${profit ? "text-[var(--go-deep)]" : "text-[#c0392b]"}`}>
        {profit ? "▲" : "▼"} £{money(Math.abs(delta))} {profit ? "profit" : "loss"}
      </div>
    </div>
  );
}
