/**
 * My Account.
 *
 * Username, personal details, avatar upload, and the security controls that
 * make sense for a magic-link/OAuth account. There is no "password reset"
 * because there is no password — the equivalent controls are:
 *
 *   - Change sign-in email (a new magic link goes to the new address)
 *   - Sign out everywhere (invalidates every session in the sessions table)
 *   - Delete account (removes the user, their stables, their picks)
 *
 * The stable name is important beyond identity: it's what appears on the
 * leaderboard, and it's the one thing a stranger will see. The moderation
 * rules for it live with the back-office work — see [[fantasy-stable-game]].
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db, users } from "@/db";
import { eq } from "drizzle-orm";
import { GameShell, SubpageHeader } from "@/components/game/game-shell";
import { AccountForm } from "./account-form";

export const metadata: Metadata = { title: "My Account — Fantasy Stable" };
export const dynamic = "force-dynamic";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string; "email-changed"?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const preview = !!sp.preview;
  const user =
    (await currentUser()) ??
    (preview
      ? { id: "__preview__", email: "preview@fantasystable.co.uk", displayName: "Preview" }
      : null);
  if (!user) redirect("/game/sign-in");

  // Fetch the full user for stableName / avatarUrl. currentUser() returns a
  // trimmed shape; the account page needs the extras.
  let stableName: string | null = null;
  if (!preview) {
    const rows = await db.select({ stableName: users.stableName }).from(users).where(eq(users.id, user.id)).limit(1);
    stableName = rows[0]?.stableName ?? null;
  }

  const notice =
    sp["email-changed"] === "1"
      ? "Your sign-in email has been updated."
      : sp.error === "email-link"
        ? "That confirmation link had expired or was already used."
        : null;

  return (
    <GameShell>
      <SubpageHeader title="My Account" />
      {notice && (
        <div className="rounded-[22px] bg-[#eaf7f0] px-4 py-3 text-[13px] font-semibold text-[var(--go-deep)] shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
          {notice}
        </div>
      )}
      <AccountForm
        email={user.email}
        displayName={user.displayName ?? user.email.split("@")[0]}
        stableName={stableName}
        preview={preview}
      />
    </GameShell>
  );
}
