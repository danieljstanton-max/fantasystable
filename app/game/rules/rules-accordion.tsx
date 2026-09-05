"use client";

/**
 * Rules as an accordion — a long page compressed into a scannable index.
 *
 * Each section title stays visible; the body opens when tapped. First one
 * opens by default so the page doesn't look like a table of contents to
 * empty rooms. Only one section can be open at once — this is a rules
 * document, not a spreadsheet, and reading it sequentially works better
 * than being able to fan the whole thing out.
 *
 * State is client-only; nothing persists. Reload and every section is shut
 * again, which is the right default for a page a player mostly won't return
 * to.
 */

import { useState, type ReactNode } from "react";

export type RuleSection = {
  id: string;
  title: string;
  summary: string;
  body: ReactNode;
};

export function RulesAccordion({ sections }: { sections: RuleSection[] }) {
  const [open, setOpen] = useState<string | null>(sections[0]?.id ?? null);

  return (
    <div className="flex flex-col gap-2">
      {sections.map((s) => {
        const isOpen = open === s.id;
        return (
          <section
            key={s.id}
            className={`rounded-[22px] bg-white shadow-[0_2px_8px_rgba(23,48,60,0.06)] transition-colors ${
              isOpen ? "ring-1 ring-[var(--go-deep)]/25" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : s.id)}
              aria-expanded={isOpen}
              aria-controls={`rule-${s.id}`}
              className="flex w-full items-start gap-3 px-5 py-4 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-extrabold uppercase tracking-tight text-[var(--slate)]">
                  {s.title}
                </div>
                {!isOpen && (
                  <div className="mt-0.5 truncate text-[12.5px] text-[var(--slate-soft)]">
                    {s.summary}
                  </div>
                )}
              </div>
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eef2f6] text-[var(--slate)] transition-transform ${
                  isOpen ? "rotate-45 bg-[var(--go-deep)] text-white" : ""
                }`}
                aria-hidden
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
            </button>

            {isOpen && (
              <div id={`rule-${s.id}`} className="border-t border-[#eef2f6] px-5 py-4">
                {s.body}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------- reusable body parts */

export function P({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-[14px] leading-relaxed text-[var(--slate)] last:mb-0">{children}</p>;
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 rounded-lg bg-[#eef2f6] px-3 py-2 text-[13px] leading-relaxed text-[var(--slate-soft)] last:mb-0">
      <span className="font-bold text-[var(--slate)]">Why:</span> {children}
    </p>
  );
}

export function Example({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 rounded-lg bg-[#fff7dd] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--slate)] last:mb-0">
      <div className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.11em] text-[#7a5b00]">
        For instance
      </div>
      {children}
    </div>
  );
}

export function Table({ rows }: { rows: [string, string][] }) {
  return (
    <div
      className="mb-3 divide-y divide-[#eef2f6] rounded-xl border border-[#eef2f6] last:mb-0"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {rows.map(([left, right]) => (
        <div key={left} className="flex items-center justify-between px-3 py-2">
          <span className="text-[13px] text-[var(--slate)]">{left}</span>
          <span className="text-[13px] font-extrabold text-[var(--slate)]">{right}</span>
        </div>
      ))}
    </div>
  );
}
