"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, requestSignIn, signOut } from "@/lib/auth";
import { loadCard } from "@/lib/game-data";
import { loadJockeyRecord, type JockeyRecord } from "@/lib/game-stats";
import { db, races } from "@/db";
import { eq, and, asc } from "drizzle-orm";
import { sendSignInLink } from "@/lib/mailer";
import { saveStable, type StableSelection } from "@/lib/stable";
import { sellHorse } from "@/lib/sales";
import { createLeague, joinLeague, normaliseCode } from "@/lib/leagues";
import {
  deleteAccount,
  requestEmailChange,
  signOutEverywhere,
  updateNames,
} from "@/lib/account";

/**
 * Where the sign-in link should point.
 *
 * Taken from the request rather than a build-time constant so a preview
 * deployment mails a link back to itself rather than to production. The host
 * header is attacker-controllable in principle, so it is only trusted when
 * NEXT_PUBLIC_SITE_URL is absent — in production that variable wins, and a
 * poisoned Host cannot redirect anyone's sign-in link off-site.
 */
async function origin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured && process.env.NODE_ENV === "production") return configured;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = host.startsWith("localhost") ? "http" : "https";
  return configured ?? `${proto}://${host}`;
}

export async function requestLinkAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "");
  const ageConfirmed = String(formData.get("age_confirmed") ?? "") === "1";
  const result = await requestSignIn(email, await origin(), ageConfirmed);

  if (!result.ok) {
    redirect(`/game/sign-in?error=${result.reason}`);
  }

  try {
    await sendSignInLink(email.trim().toLowerCase(), result.url);
  } catch {
    redirect("/game/sign-in?error=send-failed");
  }

  // Always the same answer, whether or not that address has an account —
  // otherwise this form tells a stranger who is registered.
  redirect("/game/sign-in?sent=1");
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/game");
}

/* -------------------------------------------------------------- the stable */

export type SaveStableResponse = { ok: boolean; error?: string; spend?: number };

/**
 * Save a stable.
 *
 * Takes ids and a date, nothing else. The card is rebuilt on this side and the
 * prices come from it — see lib/stable.ts for why anything the browser says
 * about cost is ignored.
 */
export async function saveStableAction(
  date: string,
  selection: StableSelection
): Promise<SaveStableResponse> {
  const { gamePaused } = await import("@/lib/pause");
  if (gamePaused()) {
    return { ok: false, error: "Stables open Friday night at 7pm — nothing to save yet." };
  }
  const user = await currentUser();
  if (!user) return { ok: false, error: "Sign in to save a stable." };

  // Ids only, capped in length, before any of it reaches a query.
  const clean: StableSelection = {
    horseIds: selection.horseIds.slice(0, 12).map(String),
    jockeyIds: selection.jockeyIds.slice(0, 4).map(String),
    napHorseId: selection.napHorseId ? String(selection.napHorseId) : null,
  };

  const { card, offDtByRaceId } = await loadCard(date);
  const result = await saveStable(user.id, card, offDtByRaceId, clean);
  if (result.ok) revalidatePath("/game");
  return result.ok ? { ok: true, spend: result.spend } : { ok: false, error: result.error };
}

/* ------------------------------------------------------------------ sales */

export type SellResponse = {
  ok: boolean;
  error?: string;
  boughtM?: number;
  soldM?: number;
  salesLeft?: number;
  bank?: number;
};

/**
 * Sell a horse from the current player's stable, at the horse's current
 * market price. Rules and price both come from the server — the client
 * cannot argue with either.
 */
export async function sellHorseAction(date: string, horseId: string): Promise<SellResponse> {
  const { gamePaused } = await import("@/lib/pause");
  if (gamePaused()) return { ok: false, error: "The auction opens Friday night at 7pm." };
  const user = await currentUser();
  if (!user) return { ok: false, error: "Sign in to sell a horse." };

  const clean = String(horseId).slice(0, 64);
  const { card, offDtByRaceId } = await loadCard(date);
  const result = await sellHorse(user.id, card, offDtByRaceId, clean);
  if (result.ok) revalidatePath("/game");
  return result.ok
    ? { ok: true, boughtM: result.boughtM, soldM: result.soldM, salesLeft: result.salesLeft, bank: result.bank }
    : { ok: false, error: result.error };
}

/* --------------------------------------------------------------- leagues */

export type CreateLeagueResponse =
  | { ok: true; code: string; url: string; name: string; leagueId: string }
  | { ok: false; error: string };

export async function createLeagueAction(name: string): Promise<CreateLeagueResponse> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Sign in to create a league." };
  const clean = String(name).slice(0, 60);
  const result = await createLeague(user.id, await origin(), clean);
  if (result.ok) revalidatePath("/game/leagues");
  return result;
}

export type JoinLeagueResponse =
  | { ok: true; leagueId: string; leagueName: string; alreadyIn: boolean }
  | { ok: false; error: string };

export async function joinLeagueAction(code: string): Promise<JoinLeagueResponse> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Sign in to join a league." };
  const normalised = normaliseCode(String(code));
  const result = await joinLeague(user.id, normalised);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "invalid"
        ? "Codes are six letters and numbers."
        : "That code does not match any league.",
    };
  }
  revalidatePath("/game/leagues");
  return { ok: true, leagueId: result.leagueId, leagueName: result.leagueName, alreadyIn: result.alreadyIn };
}

/* --------------------------------------------------------------- account */

export type SaveNamesResponse = { ok: boolean; error?: string };

export async function saveNamesAction(
  displayName: string,
  stableName: string
): Promise<SaveNamesResponse> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const result = await updateNames(user.id, String(displayName), String(stableName));
  if (result.ok) revalidatePath("/game/account");
  return result;
}

export type ChangeEmailResponse = { ok: boolean; error?: string };

export async function requestEmailChangeAction(newEmail: string): Promise<ChangeEmailResponse> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const result = await requestEmailChange(user.id, await origin(), String(newEmail));
  if (!result.ok) {
    const msg =
      result.error === "invalid"
        ? "That does not look like an email address."
        : result.error === "same-address"
          ? "That is already your sign-in email."
          : "That address is already used by another account.";
    return { ok: false, error: msg };
  }
  // Send the confirmation link to the NEW address so ownership is proven.
  try {
    await sendSignInLink(String(newEmail).trim().toLowerCase(), result.url);
  } catch {
    return { ok: false, error: "We could not send the confirmation. Try again in a moment." };
  }
  return { ok: true };
}

export async function signOutEverywhereAction(): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  await signOutEverywhere(user.id);
  redirect("/game/sign-in?signed-out-everywhere=1");
}

export async function deleteAccountAction(confirmation: string): Promise<{ ok: boolean; error?: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Sign in first." };
  if (confirmation !== "DELETE") return { ok: false, error: "Type DELETE to confirm." };
  await deleteAccount(user.id);
  redirect("/fantasy");
}

/**
 * Fetch a jockey's rolling record — the last 10 completed rides in our DB
 * plus (if we can identify today's course) their all-time record there.
 *
 * Called on demand from the JockeyInfoSheet so we don't pull this for every
 * jockey on every card load.
 */
export async function loadJockeyStatsAction(
  jockeyId: string,
  raceDate: string
): Promise<{ record: JockeyRecord | null; courseName: string | null }> {
  // Find today's ride to know which course to show course-specific stats
  // for. A jockey with rides at more than one meeting on the same card
  // isn't unusual; the FIRST ride we see is fine for "today's course".
  const [today] = await db
    .select({ courseId: races.courseId, courseName: races.courseName })
    .from(races)
    .where(and(eq(races.raceDate, raceDate)))
    .orderBy(asc(races.offDt));
  // We can't scope by jockey_id directly here without another join; the
  // course used for stats is simply the earliest meeting on the card. Good
  // enough: most Saturdays have one flagship course and the stat carries.

  const record = await loadJockeyRecord(jockeyId, today?.courseId ?? null, 10);
  return { record, courseName: today?.courseName ?? null };
}

/**
 * Admin-only: settle every stable for a given race date.
 *
 * Same result as `npm run settle:game -- <date>` from a laptop but reachable
 * from the site, so Dan can trigger a settlement pass from a phone the
 * moment a race lands. Idempotent — safe to hit repeatedly through the
 * afternoon as more results settle.
 */
export async function settleGameAction(
  date: string
): Promise<{ ok: boolean; stables?: number; points?: number; error?: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const { db, users } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const [me] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, user.id)).limit(1);
  if (!me?.isAdmin) return { ok: false, error: "Admin only." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Bad date." };
  const { settleDate } = await import("@/lib/settlement");
  const report = await settleDate(date);
  revalidatePath("/game/admin");
  revalidatePath("/game/leaderboard");
  revalidatePath("/game/results");
  return { ok: true, stables: report.perStable.length, points: report.totalPointsAwarded };
}

/**
 * Admin: sweep non-runners out of every active stable and email the
 * players affected. Idempotent — a second run does nothing.
 */
export async function nrSweepAction(): Promise<{ ok: boolean; swept?: number; emailed?: number; error?: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const { db, users } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const [me] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, user.id)).limit(1);
  if (!me?.isAdmin) return { ok: false, error: "Admin only." };
  const { sweepNonRunners } = await import("@/lib/nr-sweep");
  const r = await sweepNonRunners(await origin());
  revalidatePath("/game/admin");
  return { ok: true, swept: r.swept.length, emailed: r.emailed };
}

/**
 * Admin: post-day recap. Sends every player who saved a stable for the
 * given date a personalised summary with the day's highlights.
 */
export async function recapAction(
  date: string
): Promise<{ ok: boolean; entrants?: number; emailed?: number; winner?: string; error?: string }> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Sign in first." };
  const { db, users } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  const [me] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, user.id)).limit(1);
  if (!me?.isAdmin) return { ok: false, error: "Admin only." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Bad date." };
  const { sendDayRecap } = await import("@/lib/recap");
  const r = await sendDayRecap(date);
  return {
    ok: true,
    entrants: r.entrants,
    emailed: r.emailed,
    winner: r.winner ? `${r.winner.stableName} (${r.winner.points} pts)` : undefined,
  };
}
