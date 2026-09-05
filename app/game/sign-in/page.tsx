/**
 * Sign in.
 *
 * The front door for every player. Sits on the same racecourse background
 * as the rest of the game so signing in feels like being IN the game rather
 * than passing through a form. Two paths in — Google (if configured) and a
 * one-time email link.
 *
 * The 18+ confirmation lives here rather than as a separate step so a new
 * player only sees one screen before their inbox. The checkbox is enforced
 * server-side too: the auth callbacks refuse to stamp a user without it.
 *
 * Signed-in users bounce straight to `/game`. This page never renders for
 * an authenticated request.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { googleConfigured } from "@/lib/auth-google";
import { GameShell } from "@/components/game/game-shell";
import { SignInBody } from "./sign-in-body";

export const metadata: Metadata = { title: "Sign in — Fantasy Stable" };

const MESSAGES: Record<string, string> = {
  invalid: "That does not look like an email address.",
  "rate-limited": "Too many links requested. Give it fifteen minutes.",
  "send-failed": "We could not send that just now. Try again in a moment.",
  expired: "That link had expired or had already been used. Here is a fresh one.",
  "age-required": "Confirm you're 18 or over to continue.",
  "google-off": "Google sign-in isn’t set up on this deploy yet.",
  "google-cancelled": "Sign-in with Google was cancelled.",
  "google-failed": "We couldn’t verify that Google account. Try again.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; "signed-out-everywhere"?: string; g?: string }>;
}) {
  if (await currentUser()) redirect("/game");
  const sp = await searchParams;
  // `?g=1` previews the Google-primary layout without real Google creds so
  // we can iterate on the design before Google Cloud is set up. The button
  // still routes to /api/auth/google which returns "google-off" — proof the
  // preview is a design toy, not a real sign-in.
  const google = googleConfigured() || sp.g === "1";
  const errorMsg = sp.error ? (MESSAGES[sp.error] ?? "Something went wrong. Try again.") : null;
  const intro = google
    ? "One tap with Google and you're in — no password to remember."
    : "No password to remember — a one-time link goes to your inbox.";

  return (
    <GameShell>
      <div className="mx-auto mt-4 w-full max-w-[420px]">
        <div className="mb-5 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/img/logo.png" alt="Fantasy Stable" className="h-32 w-auto sm:h-36" />
        </div>

        {sp["signed-out-everywhere"] === "1" && (
          <div className="mb-3 rounded-2xl bg-[#fff2d6] px-4 py-3 text-center text-[13px] font-semibold text-[#7a5b00] shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
            Signed out of every device — sign in again to carry on.
          </div>
        )}

        <div className="rounded-[22px] bg-white p-6 shadow-[0_2px_12px_rgba(23,48,60,0.10)]">
          {sp.sent ? <SentState /> : <SignInBody error={errorMsg} google={google} intro={intro} />}
        </div>

        <div className="mt-4 flex justify-center gap-4 text-[12px] font-semibold text-white/85">
          <Link href="/fantasy" className="underline underline-offset-2">
            How it works
          </Link>
          <span aria-hidden>·</span>
          <Link href="/game/rules" className="underline underline-offset-2">
            Rules
          </Link>
          <span aria-hidden>·</span>
          <Link href="/game" className="underline underline-offset-2">
            Back to card
          </Link>
        </div>
      </div>
    </GameShell>
  );
}

function SentState() {
  return (
    <div className="text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#eaf7f0]">
        <EnvelopeCheck />
      </div>
      <h2 className="mt-3 text-[19px] font-extrabold text-[var(--slate)]">Check your email</h2>
      <p className="mx-auto mt-1 max-w-[300px] text-[13.5px] leading-relaxed text-[var(--slate-soft)]">
        If that address is valid we&rsquo;ve sent a sign-in link. It works once and expires in
        fifteen minutes.
      </p>
      <p className="mt-4 text-[11.5px] text-[var(--slate-soft)]">
        Nothing arrives? Check spam. If you&rsquo;ve moved inbox, put the new one in and try again.
      </p>
    </div>
  );
}

function EnvelopeCheck() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-11Z"
        stroke="#04b56b"
        strokeWidth="1.8"
      />
      <path d="M4 7l8 6 8-6" stroke="#04b56b" strokeWidth="1.8" strokeLinecap="round" />
      <path d="m9 13 2 2 4-4" stroke="#04b56b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
