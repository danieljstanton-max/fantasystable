"use client";

/**
 * Sign-in body — client component so the 18+ checkbox can gate both auth
 * paths without a page reload.
 *
 * The gate is client-side for UX (fast, no round trip). It's ALSO enforced
 * server-side: `requestSignIn` and `startGoogleFlow` receive an `ageConfirmed`
 * argument and only stamp the user record if it's true, and the sign-in
 * routes refuse to progress a user without it stamped. A client-only gate
 * would be a suggestion, not a rule.
 */

import { useState, type ReactNode } from "react";
import { requestLinkAction } from "../actions";

export function SignInBody({
  error,
  google,
  intro,
}: {
  error: string | null;
  google: boolean;
  intro: string;
}) {
  const [ageOk, setAgeOk] = useState(false);
  const [showEmail, setShowEmail] = useState(!google);

  return (
    <>
      <h1 className="text-[22px] font-extrabold uppercase tracking-tight text-[var(--slate)]">
        Sign in
      </h1>
      <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--slate-soft)]">{intro}</p>

      {error && (
        <p className="mt-4 rounded-lg bg-[#fdecec] px-3 py-2 text-[13px] font-semibold text-[#a3261f]">
          {error}
        </p>
      )}

      {/* 18+ gate. Sits above the auth buttons and disables them until ticked.
          A one-time confirmation — once stamped on the user, never asked again. */}
      <label
        className={`mt-5 flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
          ageOk ? "border-[var(--go-deep)]/40 bg-[#eaf7f0]" : "border-[#eef2f6] bg-white"
        }`}
      >
        <input
          type="checkbox"
          checked={ageOk}
          onChange={(e) => setAgeOk(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--go-deep)]"
        />
        <span className="text-[13px] leading-snug text-[var(--slate)]">
          <span className="font-bold">I&rsquo;m 18 or over</span> and I understand this is a game of
          skill — no stake, no cash prize.
        </span>
      </label>

      {google ? (
        <>
          <a
            href={ageOk ? "/api/auth/google?age=1" : "#"}
            aria-disabled={!ageOk}
            onClick={(e) => !ageOk && e.preventDefault()}
            className={`mt-5 flex w-full items-center justify-center gap-2.5 rounded-xl bg-white px-4 py-3.5 text-[15px] font-extrabold text-[var(--slate)] shadow-[0_2px_10px_rgba(23,48,60,0.10)] ring-1 ring-[#dbe4ec] transition-transform ${
              ageOk ? "hover:-translate-y-0.5" : "cursor-not-allowed opacity-50"
            }`}
          >
            <GoogleG /> Continue with Google
          </a>
          <p className="mt-2 text-center text-[11.5px] text-[var(--slate-soft)]">
            Fastest way in. Nothing goes to your Google account.
          </p>

          {!showEmail ? (
            <div className="mt-6 text-center">
              <button
                type="button"
                onClick={() => setShowEmail(true)}
                className="text-[12.5px] font-bold text-[var(--slate-soft)] underline underline-offset-[3px]"
              >
                or use email instead
              </button>
            </div>
          ) : (
            <div className="mt-5 border-t border-[#eef2f6] pt-4">
              <EmailForm ageOk={ageOk} secondary />
            </div>
          )}
        </>
      ) : (
        <EmailForm ageOk={ageOk} secondary={false} />
      )}
    </>
  );
}

function EmailForm({ ageOk, secondary }: { ageOk: boolean; secondary: boolean }) {
  return (
    <form action={requestLinkAction} className={secondary ? "" : "mt-5"}>
      <input type="hidden" name="age_confirmed" value={ageOk ? "1" : "0"} />
      <label htmlFor="email" className="text-[12px] font-bold text-[var(--slate)]">
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        className="mt-1 w-full rounded-xl border border-[#eef2f6] px-3.5 py-3 text-[15px] text-[var(--slate)] outline-none focus:border-[var(--go-deep)] focus:ring-2 focus:ring-[var(--go-deep)]/25"
      />
      <button
        type="submit"
        disabled={!ageOk}
        className={
          secondary
            ? "mt-3 w-full rounded-xl bg-[var(--slate)] py-2.5 text-[14px] font-extrabold text-white disabled:opacity-50"
            : "mt-3 w-full rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] py-3 text-[15px] font-extrabold text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)] disabled:opacity-50"
        }
      >
        Send me a link
      </button>
    </form>
  );
}

function GoogleG(): ReactNode {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.3 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.6-4.9 7.3l7.7 6c4.5-4.2 7-10.3 7-17.8z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.7-2.9-.7-4.6s.3-3.2.7-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.8 2.3-8.2 2.3-6.3 0-11.7-4.1-13.6-9.9l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
