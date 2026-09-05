"use client";

import { useState, useTransition } from "react";
import { createLeagueAction } from "../../actions";

export function CreateLeagueForm() {
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ code: string; url: string; name: string } | null>(null);
  const [copied, setCopied] = useState<"code" | "url" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createLeagueAction(name.trim());
      if (result.ok) {
        setCreated({ code: result.code, url: result.url, name: result.name });
      } else {
        setError(result.error);
      }
    });
  }

  async function copy(what: "code" | "url", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard blocked in the browser (rare in HTTPS contexts). Fall back
      // to selecting the text so the user can copy manually.
    }
  }

  if (created) {
    return (
      <>
        <p className="mt-5 rounded-xl bg-[#eaf7f0] px-3 py-2 text-[13px] font-semibold text-[var(--go-deep)]">
          <span className="mr-1">✓</span> League created — <span className="font-extrabold">{created.name}</span>
        </p>

        <div className="mt-4">
          <label className="text-[11px] font-bold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
            League Code
          </label>
          <div className="mt-1 flex items-center gap-2 rounded-xl border-2 border-dashed border-[var(--slate)]/20 bg-[#fff7dd] px-4 py-4">
            <span
              className="flex-1 text-center text-[30px] font-extrabold tracking-[0.18em] text-[var(--slate)]"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {created.code}
            </span>
            <button
              type="button"
              onClick={() => copy("code", created.code)}
              className="rounded-lg bg-[var(--slate)] px-3 py-2 text-[11px] font-extrabold text-white"
            >
              {copied === "code" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div className="mt-4">
          <label className="text-[11px] font-bold uppercase tracking-[0.11em] text-[var(--slate-soft)]">
            Shareable link
          </label>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-[#eef2f6] bg-white px-3 py-2.5">
            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--slate)]">
              {created.url}
            </span>
            <button
              type="button"
              onClick={() => copy("url", created.url)}
              className="rounded-lg bg-[#eef2f6] px-3 py-1.5 text-[11px] font-extrabold text-[var(--slate)]"
            >
              {copied === "url" ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(
              `Join my ${name} league on Fantasy Stable — code ${created.code} · ${created.url}`
            )}`}
            target="_blank"
            rel="noopener"
            className="flex items-center justify-center gap-2 rounded-xl bg-[#25D366] px-3 py-2.5 text-[13px] font-extrabold text-white"
          >
            Share on WhatsApp
          </a>
          <a
            href={`sms:?&body=${encodeURIComponent(
              `Join my ${name} league on Fantasy Stable — code ${created.code} · ${created.url}`
            )}`}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#eef2f6] px-3 py-2.5 text-[13px] font-extrabold text-[var(--slate)]"
          >
            Text a mate
          </a>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-3">
      <div>
        <label htmlFor="league-name" className="text-[12px] font-bold text-[var(--slate)]">
          League Name
        </label>
        <input
          id="league-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="e.g. Wednesday Night Boys"
          className="mt-1 w-full rounded-xl border border-[#eef2f6] px-3.5 py-3 text-[15px] text-[var(--slate)] outline-none focus:border-[var(--go-deep)] focus:ring-2 focus:ring-[var(--go-deep)]/25"
        />
      </div>
      {error && (
        <p className="rounded-lg bg-[#fdecec] px-3 py-2 text-[13px] text-[#a3261f]">{error}</p>
      )}
      <button
        type="submit"
        disabled={!name.trim() || pending}
        className="w-full rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] py-3 text-[15px] font-extrabold text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)] disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create league"}
      </button>
    </form>
  );
}
