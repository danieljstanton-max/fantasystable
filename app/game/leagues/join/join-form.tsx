"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { joinLeagueAction } from "../../actions";

const CODE_LEN = 6;
const CODE_RE = /^[A-Z0-9]{6}$/;

export function JoinLeagueForm({ initial }: { initial: string }) {
  const [code, setCode] = useState(normalise(initial));
  const [joined, setJoined] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function normalise(v: string): string {
    // Uppercase, strip anything not a code character, cap at 6.
    return v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LEN);
  }

  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!CODE_RE.test(code)) {
      setError("Codes are six letters and numbers.");
      return;
    }
    startTransition(async () => {
      const result = await joinLeagueAction(code);
      if (result.ok) {
        setJoined(`${result.leagueName} · ${code}${result.alreadyIn ? " · already in" : ""}`);
      } else {
        setError(result.error);
      }
    });
  }

  if (joined) {
    return (
      <div className="mt-5">
        <div className="rounded-xl bg-[#eaf7f0] p-4 text-center">
          <p className="text-[13px] font-bold uppercase tracking-[0.11em] text-[var(--go-deep)]">
            You&rsquo;re in
          </p>
          <p className="mt-1 text-[17px] font-extrabold text-[var(--slate)]">{joined}</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link
            href="/game/leagues"
            className="rounded-xl bg-[#eef2f6] py-3 text-center text-[14px] font-extrabold text-[var(--slate)]"
          >
            My Leagues
          </Link>
          <Link
            href="/game/leaderboard"
            className="rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] py-3 text-center text-[14px] font-extrabold text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)]"
          >
            See the board
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5">
      <label htmlFor="join-code" className="text-[12px] font-bold text-[var(--slate)]">
        League Code
      </label>
      <input
        id="join-code"
        value={code}
        onChange={(e) => setCode(normalise(e.target.value))}
        placeholder="ABCD23"
        autoComplete="off"
        inputMode="text"
        className="mt-1 w-full rounded-xl border-2 border-[#eef2f6] bg-[#fff7dd] px-4 py-4 text-center text-[28px] font-extrabold uppercase tracking-[0.18em] text-[var(--slate)] outline-none focus:border-[var(--go-deep)]"
        style={{ fontVariantNumeric: "tabular-nums" }}
      />
      {error && (
        <p className="mt-2 rounded-lg bg-[#fdecec] px-3 py-2 text-[12.5px] text-[#a3261f]">{error}</p>
      )}
      <button
        type="submit"
        disabled={code.length !== CODE_LEN || pending}
        className="mt-4 w-full rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] py-3 text-[15px] font-extrabold text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)] disabled:opacity-50"
      >
        {pending ? "Joining…" : "Join league"}
      </button>
    </form>
  );
}
