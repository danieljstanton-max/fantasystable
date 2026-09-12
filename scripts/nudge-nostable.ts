/**
 * Race-day nudge: a friendly poke to every user who signed up but hasn't
 * yet saved a stable for the given date. Skips anyone who has already
 * opted out of announcements.
 *
 *   npm run nudge -- 2026-09-12
 *
 * One-off script — not part of the general broadcast pipeline. Uses the
 * same Resend sender as sign-in links so the from address stays consistent.
 */

import "dotenv/config";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db, stables, users } from "../db";
import { sendMail } from "../lib/mailer";

(async () => {
  const date = process.argv[2];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("usage: npm run nudge -- YYYY-MM-DD");
    process.exit(1);
  }

  const withStable = (await db.select({ id: stables.userId }).from(stables).where(eq(stables.raceDate, date))).map((r) => r.id);

  const targets = await db
    .select({ id: users.id, email: users.email, name: users.displayName })
    .from(users)
    .where(
      and(
        isNull(users.announcementsOptOutAt),
        withStable.length > 0 ? notInArray(users.id, withStable) : sql`true`
      )
    );

  console.log(`nudging ${targets.length} users about ${date}`);

  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  let ok = 0;
  const errors: string[] = [];
  for (const u of targets) {
    const name = u.name ?? u.email.split("@")[0];
    const subject = "Two hours to save your stable";
    const text = [
      `Hi ${name},`,
      "",
      `Deadline for ${day} is 12:35 (one hour before Leopardstown opens the card). Two hours out and counting.`,
      "",
      "Six horses. Two jockeys. Name your NAP. £100m. No stake, no cost, weekly bragging rights.",
      "",
      "https://www.fantasystable.co.uk/game",
      "",
      "See you on the leaderboard.",
      "",
      "— Dan",
    ].join("\n");
    const html = `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#17303c">
  <h1 style="font-size:22px;margin:0 0 4px;font-weight:800">Two hours to save your stable</h1>
  <p style="font-size:13px;color:#7d919c;margin:0 0 20px">Fantasy Stable · ${day}</p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 14px">Hi ${escapeHtml(name)},</p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 14px">Deadline is <strong>12:35</strong> — one hour before Leopardstown opens the card. Two hours out and counting.</p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 14px">Six horses. Two jockeys. Name your NAP. £100m. No stake, weekly bragging rights.</p>
  <p style="margin:0 0 24px">
    <a href="https://www.fantasystable.co.uk/game" style="display:inline-block;padding:12px 24px;background:#04b56b;color:#fff;text-decoration:none;border-radius:12px;font-weight:800">Build my stable</a>
  </p>
  <hr style="border:none;border-top:1px solid #eef2f6;margin:24px 0"/>
  <p style="font-size:12px;color:#93a5af;margin:0">See you on the leaderboard — Dan</p>
</div>`;
    try {
      await sendMail({ to: u.email, subject, text, html });
      ok += 1;
    } catch (e) {
      errors.push(`${u.email}: ${(e as Error).message}`);
    }
  }

  console.log(`sent ${ok} of ${targets.length}`);
  for (const e of errors) console.error("  error:", e);
  process.exit(errors.length ? 1 : 0);
})();

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
