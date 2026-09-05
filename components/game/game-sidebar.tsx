"use client";

/**
 * The desktop sidebar.
 *
 * Follows the FPL "Pick Team" layout: on wide screens the primary content is
 * the pitch, but a fixed column on the left carries everything a player wants
 * to see WITHOUT leaving the page — their stable identity, points and rank,
 * their mini-leagues, and a compact rules refresher.
 *
 * Hidden on mobile — the stack there stays vertical. The pitch is the whole
 * story on a phone, and any of this content that matters would be a separate
 * tab or a swipe-in drawer, not a second column.
 *
 * Most of the numbers are placeholders until settlement and leaderboards are
 * built. Rendering them now sets the visual shape so those pieces have
 * somewhere to slot in, and so the design decisions we make on the pitch don't
 * assume the sidebar isn't there.
 */

import Link from "next/link";

type Props = {
  stableName: string;
  ownerEmail: string;
  bank: number;
  spent: number;
  xPts: number;
  budget: number;
};

const money = (m: number) => (Number.isInteger(m) ? `${m}m` : `${m.toFixed(1)}m`);
const tnum = { fontVariantNumeric: "tabular-nums" as const };

export function GameSidebar({ stableName, ownerEmail, bank, spent, xPts, budget }: Props) {
  return (
    <aside className="hidden lg:flex lg:flex-col lg:gap-3">
      {/* Identity */}
      <div className="rounded-[22px] bg-white p-5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <div className="flex items-start gap-3">
          <StableShield />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[19px] font-extrabold leading-tight tracking-tight text-[var(--slate)]">
              {stableName}
            </div>
            <div className="truncate text-[12.5px] text-[var(--slate-soft)]">{ownerEmail}</div>
          </div>
        </div>
      </div>

      {/* Points & Rankings */}
      <div className="rounded-[22px] bg-white p-5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <SectionHead
          title="Points & Rankings"
          right={<span className="text-[11.5px] font-semibold text-[var(--slate-soft)]">Season</span>}
        />
        <dl className="mt-4 space-y-2.5 text-[13.5px]" style={tnum}>
          <Row label="Overall points" value="—" hint="First card not yet settled" />
          <Row label="Overall rank" value="—" />
          <Row label="Last week" value="—" />
        </dl>
      </div>

      {/* Bank & spend, so the top stat bar can be minimal */}
      <div className="rounded-[22px] bg-white p-5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <SectionHead title="This Card" />
        <dl className="mt-4 space-y-2.5 text-[13.5px]" style={tnum}>
          <Row label="Budget" value={money(budget)} />
          <Row label="Spent" value={money(spent)} />
          <Row
            label="Bank"
            value={money(bank)}
            valueClass={bank < 0 ? "text-[#c0392b]" : "text-[var(--go-deep)]"}
          />
          <Row label="Expected xPts" value={xPts.toFixed(1)} />
        </dl>
      </div>

      {/* Mini-leagues — placeholder until the schema and pages exist */}
      <div className="rounded-[22px] bg-white p-5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <SectionHead
          title="Mini-Leagues"
          right={
            <Link href="#" className="text-[11.5px] font-bold text-[var(--go-deep)]">
              New +
            </Link>
          }
        />
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--slate-soft)]">
          You’re not in any leagues yet. Start one with your mates, or your office — a code they
          can join with.
        </p>
      </div>

      {/* Compact rules refresher */}
      <div className="rounded-[22px] bg-white p-5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <SectionHead title="How Scoring Works" />
        <ul className="mt-3 space-y-1.5 text-[12.5px] leading-relaxed text-[var(--slate-soft)]">
          <li>Win: 25 pts + longshot bonus</li>
          <li>Place: 12 / 7 / 4 / 2 for 2nd–5th</li>
          <li>Non-completion (F, PU, UR): −5</li>
          <li>NAP scores double</li>
          <li>Jockey wins: 8 pts each</li>
        </ul>
        <Link
          href="/game/rules"
          className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-[var(--go-deep)]"
        >
          Full rules
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M4 2.5 7.5 6 4 9.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>
    </aside>
  );
}

/* --------------------------------------------------------------- helpers */

function SectionHead({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="text-[15px] font-extrabold text-[var(--slate)]">{title}</h3>
      {right}
    </div>
  );
}

function Row({
  label,
  value,
  valueClass,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--slate-soft)]">
        {label}
        {hint && <span className="ml-1 text-[11px] opacity-70">· {hint}</span>}
      </dt>
      <dd className={`font-bold text-[var(--slate)] ${valueClass ?? ""}`}>{value}</dd>
    </div>
  );
}

function StableShield() {
  return (
    <svg width="42" height="42" viewBox="0 0 42 42" aria-hidden className="shrink-0">
      <path
        d="M21 3l14 4v11c0 9.5-6 16-14 20-8-4-14-10.5-14-20V7l14-4Z"
        fill="none"
        stroke="var(--slate)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <text
        x="21"
        y="26"
        textAnchor="middle"
        fill="var(--slate)"
        fontFamily="'Plus Jakarta Sans', sans-serif"
        fontSize="14"
        fontWeight="800"
      >
        +
      </text>
    </svg>
  );
}
