"use client";

/**
 * The pitch — a stable on the turf, and the jockeys on the bench beneath.
 *
 * Shared between the signed-in editor and the signed-out example, so the two
 * cannot drift apart visually. Every player pixel lives here; if the pitch
 * looks wrong, this is the one file to look at.
 *
 * Design notes worth keeping:
 *
 * - One typeface only. FPL's own screen mixes families deliberately, but with
 *   inferior fonts it reads as design-by-committee. Plus Jakarta Sans carries
 *   the whole thing, with `font-variant-numeric: tabular-nums` doing the work
 *   a monospaced face would otherwise do — same alignment, none of the
 *   "developer console" character.
 *
 * - The silk is the card. In the reference the silk fills the top two-thirds
 *   and the name-and-price plate is a much smaller pedestal beneath it. That
 *   is what makes a stable feel like a stable rather than a form.
 *
 * - No odds on the pitch. The price is the number that matters here; odds are
 *   a courtesy inside the picker where you are choosing, not on the pitch
 *   where you have chosen.
 */

import { JockeySilk } from "./jockey-silk";
import type { GameJockey, PricedRunner } from "@/lib/game-card";
import { N_HORSES, N_JOCKEYS } from "@/lib/game-pricing";

const money = (m: number) => (Number.isInteger(m) ? `${m}m` : `${m.toFixed(1)}m`);

type HorseHandlers = {
  onRemove?: (h: PricedRunner) => void;
  onNap?: (h: PricedRunner) => void;
  onPickEmpty?: () => void;
  onSwap?: (h: PricedRunner) => void;
  locked?: boolean;
};

type JockeyHandlers = {
  onRemove?: (j: GameJockey) => void;
  onPickEmpty?: () => void;
  locked?: boolean;
};

export function Pitch({
  horses,
  napHorseId,
  horseHandlers,
}: {
  horses: PricedRunner[];
  napHorseId: string | null;
  horseHandlers?: HorseHandlers;
}) {
  return (
    <section
      className="relative aspect-[6/5] overflow-hidden rounded-[22px] sm:aspect-[16/9]"
      aria-label="Your stable"
    >
      {/* Pitch panel is transparent — the illustrated racecourse is the page
          background. The overlay is left in as a subtle wash to keep the white
          card plates legible over the brightest part of the turf. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,40,20,0.10),transparent_30%,transparent_70%,rgba(10,40,20,0.12))]"
      />

      <div className="absolute inset-x-[3%] top-[18%] bottom-[10%] z-10 grid grid-cols-3 grid-rows-2 gap-2.5 sm:gap-3.5">
        {Array.from({ length: N_HORSES }, (_, i) => {
          const h = horses[i];
          return h ? (
            <HorseCard
              key={h.horseId}
              runner={h}
              isNap={h.horseId === napHorseId}
              handlers={horseHandlers}
            />
          ) : (
            <EmptyHorse key={`empty-${i}`} onClick={horseHandlers?.onPickEmpty} />
          );
        })}
      </div>
    </section>
  );
}

export function Bench({
  jockeys,
  handlers,
}: {
  jockeys: GameJockey[];
  handlers?: JockeyHandlers;
}) {
  return (
    <section className="rounded-[22px] bg-white/90 px-3 py-2.5 shadow-[0_2px_8px_rgba(23,48,60,0.06)] backdrop-blur-sm">
      <div className="mb-2 flex items-center justify-center gap-2.5">
        <span className="h-px w-6 bg-[#c8d3dd]" />
        <span className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-[var(--slate-soft)]">
          Stable Jockeys
        </span>
        <span className="h-px w-6 bg-[#c8d3dd]" />
      </div>
      <div className="flex justify-center gap-3">
        {Array.from({ length: N_JOCKEYS }, (_, i) => {
          const j = jockeys[i];
          return j ? (
            <JockeyCard key={j.id} jockey={j} handlers={handlers} />
          ) : (
            <EmptyJockey key={`empty-${i}`} onClick={handlers?.onPickEmpty} />
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- horse card */

function HorseCard({
  runner,
  isNap,
  handlers,
}: {
  runner: PricedRunner;
  isNap: boolean;
  handlers?: HorseHandlers;
}) {
  const interactive = !!handlers?.onRemove && !handlers.locked;
  return (
    <article
      className="relative grid h-full overflow-hidden rounded-[14px] bg-[#3f9d4a] shadow-[0_3px_10px_rgba(23,48,60,0.25)]"
      style={{ gridTemplateRows: "1fr auto" }}
    >
      <div className="absolute left-1.5 top-1.5 z-10 flex flex-col gap-1">
        <NapBadge
          active={isNap}
          onClick={handlers?.onNap ? () => handlers.onNap!(runner) : undefined}
        />
        <RemoveBadge
          onClick={interactive ? () => handlers.onRemove!(runner) : undefined}
        />
      </div>
      <InfoDot />

      {/* The card is a two-row grid: silks in the top 1fr, plate at the
          bottom sized to its content. `min-h-0` on the silk row lets the img
          shrink below its intrinsic size inside overflow-hidden, which flex
          layouts refuse to do on their own — a plate that overflows the card
          gets clipped, and the price is what disappears. */}
      <div className="flex min-h-0 items-center justify-center px-1.5 pt-2">
        {runner.silkUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={runner.silkUrl}
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
        <div className="truncate text-[11.5px] font-semibold leading-tight text-[var(--slate)] sm:text-[13px]">
          {runner.horse}
        </div>
        <div
          className="text-[18px] font-extrabold leading-none tracking-tight text-[var(--slate)] sm:text-[22px]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {money(runner.price)}
        </div>
      </div>
    </article>
  );
}

function EmptyHorse({ onClick }: { onClick?: () => void }) {
  const cls = "flex h-full items-center justify-center rounded-[14px] border-2 border-dashed border-white/70 bg-black/10 text-[12px] font-semibold text-white/85";
  return onClick ? (
    <button type="button" onClick={onClick} className={cls + " hover:bg-black/20"}>+ Pick a horse</button>
  ) : (
    <div className={cls}>Pick a horse</div>
  );
}

/* ------------------------------------------------------------ jockey card */

function JockeyCard({
  jockey,
  handlers,
}: {
  jockey: GameJockey;
  handlers?: JockeyHandlers;
}) {
  const interactive = !!handlers?.onRemove && !handlers.locked;
  return (
    <article
      className="relative grid h-[128px] w-[112px] overflow-hidden rounded-[14px] bg-[#3f9d4a] shadow-[0_3px_10px_rgba(23,48,60,0.25)]"
      style={{ gridTemplateRows: "1fr auto" }}
    >
      {/* Same corner controls as the horse card, minus the NAP toggle.
          Removing the redundant "picked ✓" — the jockey being IN the stable
          IS the signal; a green tick just adds visual noise. */}
      <div className="absolute left-1.5 top-1.5 z-10 flex flex-col gap-1">
        <RemoveBadge
          onClick={interactive ? () => handlers.onRemove!(jockey) : undefined}
        />
      </div>
      <InfoDot />

      <div className="flex min-h-0 items-center justify-center px-1.5 pt-2">
        <JockeySilk id={jockey.id} size={72} />
      </div>

      <div className="bg-white px-1.5 pb-1.5 pt-1 text-center">
        <div className="truncate text-[11.5px] font-semibold leading-tight text-[var(--slate)] sm:text-[13px]">
          {jockeyLabel(jockey.name)}
        </div>
        <div
          className="text-[18px] font-extrabold leading-none tracking-tight text-[var(--slate)] sm:text-[22px]"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {money(jockey.price)}
        </div>
      </div>
    </article>
  );
}

function EmptyJockey({ onClick }: { onClick?: () => void }) {
  const cls = "flex h-[128px] w-[112px] items-center justify-center rounded-[14px] border-2 border-dashed border-white/70 bg-black/10 text-[12px] font-semibold text-white/85";
  if (onClick) return (
    <button type="button" onClick={onClick} className={cls + " hover:bg-white/40"}>+ Pick a jockey</button>
  );
  return (
    <div className={cls}>
      Pick a jockey
    </div>
  );
}

/**
 * "William Buick" → "W. Buick". Two forenames get the first initial only.
 * Jockey names on real cards run long; the plate is 148px and one word looks
 * cramped rather than fills it. FPL uses the same convention with players.
 */
function jockeyLabel(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  const surname = parts[parts.length - 1];
  const initial = parts[0][0];
  return `${initial}. ${surname}`;
}

/* -------------------------------------------------------------- ornaments */

function InfoDot() {
  return (
    <button
      type="button"
      aria-label="Details"
      className="absolute right-1.5 top-1.5 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white text-[10px] font-bold italic text-[var(--slate)] shadow-sm"
    >
      i
    </button>
  );
}

/**
 * The badge that promotes a horse to NAP.
 *
 * On the current NAP: solid green pill saying "NAP".
 * On every other horse: yellow pill with "NAP?" — same shape and colour so the
 * mechanic reads as one control across all six cards. Tapping any yellow "NAP?"
 * demotes the previous NAP and promotes the tapped horse. That is how you
 * change it; there is no separate settings screen.
 *
 * Earlier version showed a bare tick, which read as decoration rather than an
 * action — the "?" makes the invitation explicit and matches the "NAP" label
 * so the state change reads at a glance.
 */
function NapBadge({ active, onClick }: { active: boolean; onClick?: () => void }) {
  // Active NAP always shows — that horse is scoring double whether the stable
  // is editable or locked, and the player needs to know which one it is.
  if (active) {
    return (
      <span className="flex h-[18px] items-center rounded-full bg-[var(--go-deep)] px-2 text-[9px] font-extrabold uppercase leading-none tracking-wider text-white shadow-sm">
        NAP
      </span>
    );
  }
  // "NAP?" prompts only appear while onClick is wired — i.e. while the stable
  // is editable. Once locked the editor stops passing onNap, and this returns
  // nothing so the pitch reads as final rather than still-being-decided.
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Make this horse your NAP"
      className="flex h-[18px] items-center rounded-full bg-[#ffd21e] px-1.5 text-[9px] font-extrabold uppercase leading-none tracking-wider text-[#7a5b00] shadow-sm hover:brightness-105"
    >
      NAP?
    </button>
  );
}

function RemoveBadge({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label="Remove"
      className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#e64545] text-[10px] font-bold text-white shadow-sm disabled:opacity-70 hover:brightness-105"
    >
      ×
    </button>
  );
}

function Dot({
  tone,
  children,
}: {
  tone: "go" | "warn" | "red";
  children: React.ReactNode;
}) {
  const bg =
    tone === "go" ? "bg-[var(--go-deep)]" : tone === "warn" ? "bg-[#ffd21e]" : "bg-[#e64545]";
  const fg = tone === "warn" ? "text-[#7a5b00]" : "text-white";
  return (
    <span
      className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ${bg} ${fg} text-[10px] font-bold leading-none shadow-sm`}
    >
      {children}
    </span>
  );
}
