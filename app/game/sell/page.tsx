/**
 * Sell a Horse.
 *
 * The same six horses that sit on the pitch, but tapping one opens an auction
 * hammer sheet with the sale price. Two sales per race day; each sale frees
 * budget to buy someone else. The mechanic is deliberately identical to the
 * Sales concept in the pricing memory — see [[fantasy-stable-game]].
 *
 * For now the sale price equals the current price on the card (the same
 * number the horse shows on the pitch). When live-refreshed prices are in,
 * the "sell price" is whatever the horse is trading at at the moment you tap
 * — no commission, no spread.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadCard, nextGameDate } from "@/lib/game-data";
import { loadStable } from "@/lib/stable";
import { loadSales } from "@/lib/sales";
import { GameShell, SubpageHeader } from "@/components/game/game-shell";
import { N_SALES } from "@/lib/game-pricing";
import { SellFloor } from "./sell-floor";
import { sellHorseAction } from "../actions";

export const metadata: Metadata = { title: "Sell a Horse — Fantasy Stable" };
export const dynamic = "force-dynamic";

export default async function SellPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const { preview } = await searchParams;
  const user = (await currentUser()) ?? (preview ? { id: "__preview__", email: "preview@fantasystable.co.uk", displayName: "Preview" } : null);
  if (!user) redirect("/game/sign-in");

  // Same rule as /game: the sell floor operates on the next open card, not
  // literally today. Otherwise the moment the deadline passes we'd offer
  // horses from a stable that no longer exists to sell against.
  const date = await nextGameDate();
  const { card } = await loadCard(date);
  const saved = user.id === "__preview__" ? null : await loadStable(user.id, date);
  // Actual sales already made against this stable. Preview mode has no
  // stable row so it's always zero — the sheet is a design demonstrator.
  const madeSales = saved ? await loadSales(saved.id) : [];
  const salesLeft = Math.max(0, N_SALES - madeSales.length);

  // Real stables only. Falling back to a preview stable of "horses from
  // the card" was actively misleading — a player who hadn't saved would
  // see six horses that weren't theirs and tap Sell, which the server
  // then correctly refuses. Preview mode still uses a demo stable so the
  // design can be inspected without a real save.
  const horses = saved?.horseIds ?? [];
  const stableRunners = horses
    .map((id) => card.races.flatMap((r) => r.runners).find((r) => r.horseId === id))
    .filter(Boolean) as ReturnType<typeof extractRunners>[number][];

  const example =
    stableRunners.length > 0 ? stableRunners : preview ? previewStable(card) : [];

  // What each horse cost the player when they bought it. For preview mode we
  // fabricate a slight discount so the profit/loss UI has something to show.
  const boughtAt: Record<string, number> = {};
  for (const h of example) {
    if (preview) {
      // Preview: pretend they bought each horse at the opening show, but a
      // shade cheaper for some so the profit/loss chip has variety.
      const drift = ((h.horseId.charCodeAt(0) % 5) - 2) * 1.5;
      boughtAt[h.horseId] = Math.max(2.5, Math.round((h.price + drift) * 2) / 2);
    } else {
      boughtAt[h.horseId] = h.price;
    }
  }

  return (
    <GameShell>
      <SubpageHeader title="Sell a Horse" />

      <div className="rounded-[22px] bg-white px-4 py-4 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
              This game week
            </p>
            <p className="text-[15px] font-extrabold text-[var(--slate)]">
              Sales left: {salesLeft} of {N_SALES}
            </p>
          </div>
          <TrophyHammer />
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--slate-soft)]">
          Tap a horse to see what it will fetch at auction. You can sell up to {N_SALES} horses per
          game week — the money goes back into your bank so you can buy an upgrade.
        </p>
        {madeSales.length > 0 && (
          <ul className="mt-3 divide-y divide-[#eef2f6] border-t border-[#eef2f6] pt-2">
            {madeSales.map((s) => {
              const pl = Math.round((s.soldM - s.boughtM) * 10) / 10;
              const plTone = pl >= 0 ? "text-[var(--go-deep)]" : "text-[#c0392b]";
              return (
                <li key={s.id} className="flex items-baseline justify-between py-1.5 text-[12.5px]">
                  <span className="text-[var(--slate)]">
                    Sale {s.saleIndex}: <span className="font-bold">{s.horseName}</span>
                  </span>
                  <span className={`font-extrabold tabular-nums ${plTone}`}>
                    {pl >= 0 ? "+" : ""}
                    £{pl.toFixed(1)}m
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {example.length === 0 ? (
        <div className="rounded-[22px] bg-white p-6 text-center shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
          <p className="text-[14.5px] font-extrabold text-[var(--slate)]">
            Nothing to sell yet.
          </p>
          <p className="mx-auto mt-1 max-w-[320px] text-[12.5px] leading-relaxed text-[var(--slate-soft)]">
            Build your stable first — the auction opens as soon as you&rsquo;ve got horses in there.
          </p>
          <a
            href="/game"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] px-5 py-2.5 text-[13px] font-extrabold text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)]"
          >
            Build my stable
          </a>
        </div>
      ) : salesLeft <= 0 ? (
        <div className="rounded-[22px] bg-white p-5 text-center shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
          <p className="text-[13.5px] font-bold text-[var(--slate)]">
            You&rsquo;ve used both sales this week.
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--slate-soft)]">
            The auction reopens with next week&rsquo;s card.
          </p>
        </div>
      ) : (
        <SellFloor horses={example} boughtAt={boughtAt} preview={!!preview} date={date} sell={sellHorseAction} />
      )}
    </GameShell>
  );
}

function extractRunners(): [] {
  return [];
}

function previewStable(card: Awaited<ReturnType<typeof loadCard>>["card"]) {
  return card.races.slice(0, 6).map((r) => r.runners[0]).filter(Boolean);
}

function TrophyHammer() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10l8-6 8 6-2 2-6-4-6 4-2-2Z" fill="#c98a12" stroke="#7a5b00" strokeWidth="1.2" strokeLinejoin="round"/>
      <rect x="10" y="10" width="4" height="10" rx="1" fill="#7a5b00"/>
      <rect x="6" y="19" width="12" height="3" rx="1" fill="#7a5b00"/>
    </svg>
  );
}
