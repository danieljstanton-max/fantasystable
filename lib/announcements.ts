/**
 * Broadcast an announcement to every registered player.
 *
 * Uses Resend's batch endpoint — up to 100 messages per API call — so a
 * broadcast to a few thousand players is a handful of network trips, not
 * one per user.
 *
 * Two things are load-bearing here:
 *
 * - Every recipient gets a UNIQUE unsubscribe link, signed with an HMAC
 *   over their user id. That means no shared "opt out for this address"
 *   URL that anyone could guess — a leaked link only opts out its own user.
 * - Anyone with `announcementsOptOutAt` set is skipped at the query stage.
 *   The count of skipped users is recorded on the row so the archive of
 *   sends is honest about deliverability, not just intent.
 *
 * PECR / ePrivacy compliance: every announcement email carries the
 * unsubscribe link in the body. First send to a newly registered player
 * counts as legitimate transactional-adjacent under service-related
 * messaging, and the opt-out is honoured on any subsequent send.
 */

import { and, eq, isNull, or, sql as raw } from "drizzle-orm";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { announcements, db, users } from "@/db";

const FROM = process.env.MAIL_FROM ?? "Fantasy Stable <noreply@fantasystable.co.uk>";
const BATCH = 100;

export type Recipient = { id: string; email: string; displayName: string | null };

export type SendReport = {
  announcementId: string;
  recipients: number;
  delivered: number;
  optedOut: number;
};

/**
 * Pull every user who hasn't opted out. Query-level filtering means an
 * opted-out player is never seen by the sender — no chance of a stale
 * cache slipping through.
 */
export async function loadRecipients(): Promise<Recipient[]> {
  return await db
    .select({ id: users.id, email: users.email, displayName: users.displayName })
    .from(users)
    .where(isNull(users.announcementsOptOutAt));
}

/** How many people would be skipped from a send right now? */
export async function optedOutCount(): Promise<number> {
  const [{ n }] = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(users)
    .where(or(eq(users.announcementsOptOutAt, users.announcementsOptOutAt), raw`false`))
    // The above `where` is intentionally a null-safe test that always evaluates
    // the column — we could equivalently drop the where. Kept for clarity.
    ;
  // Simpler direct count:
  const [{ n2 }] = await db
    .select({ n2: raw<number>`count(*) filter (where ${users.announcementsOptOutAt} is not null)::int` })
    .from(users);
  return n2 ?? n;
}

/**
 * Send an announcement to every eligible player. Writes a row to
 * `announcements` recording what was sent and how it landed.
 */
export async function sendAnnouncement(
  subject: string,
  bodyMarkdown: string,
  sentBy: string,
  origin: string
): Promise<SendReport> {
  const id = randomBytes(16).toString("hex");
  const recipients = await loadRecipients();
  const optedOut = await optedOutCount();

  await db.insert(announcements).values({
    id,
    subject,
    body: bodyMarkdown,
    sentBy,
    recipients: recipients.length,
    delivered: 0,
    optedOut,
  });

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Dev fallback: print the first three recipients to the log and record
    // zero deliveries. Same shape as the mailer, so `npm run announce` in
    // dev doesn't need a real key to test the flow.
    console.warn(
      "\n  ┌─ NO RESEND_API_KEY — announcement not emailed ─────────────" +
        `\n  │  id:    ${id}` +
        `\n  │  subj:  ${subject}` +
        `\n  │  would send to: ${recipients.length} recipients (${optedOut} opted out)` +
        `\n  │  first 3: ${recipients.slice(0, 3).map((r) => r.email).join(", ")}` +
        "\n  └────────────────────────────────────────────────────────────\n"
    );
    return { announcementId: id, recipients: recipients.length, delivered: 0, optedOut };
  }

  let delivered = 0;
  for (let i = 0; i < recipients.length; i += BATCH) {
    const chunk = recipients.slice(i, i + BATCH);
    const body = chunk.map((r) => ({
      from: FROM,
      to: [r.email],
      subject,
      text: renderText(bodyMarkdown, unsubscribeUrl(origin, r.id)),
      html: renderHtml(subject, bodyMarkdown, unsubscribeUrl(origin, r.id)),
      // Also drop a proper List-Unsubscribe header. Mail clients honour it
      // for a one-tap unsubscribe button that never opens a browser.
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl(origin, r.id)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }));

    const response = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) {
      const json = (await response.json()) as { data?: unknown[] };
      delivered += json.data?.length ?? chunk.length;
    } else {
      // A single batch failing isn't a reason to abort the whole send. Log
      // and keep going; the delivered count in the archive is honest.
      console.warn(`announcement batch ${i / BATCH + 1} rejected: ${response.status}`);
    }
  }

  await db.update(announcements).set({ delivered }).where(eq(announcements.id, id));
  return { announcementId: id, recipients: recipients.length, delivered, optedOut };
}

/* ---------------------------------------------------------- unsubscribe */

/**
 * Signed unsubscribe token. HMAC over the user id with the app's secret so
 * an attacker cannot forge a link to opt someone else out. If UNSUBSCRIBE_SECRET
 * is missing we fall back to CRON_SECRET so a fresh dev environment doesn't
 * refuse to send.
 */
function secret(): string {
  return process.env.UNSUBSCRIBE_SECRET ?? process.env.CRON_SECRET ?? "insecure-dev-only";
}
export function unsubscribeToken(userId: string): string {
  const mac = createHmac("sha256", secret()).update(userId).digest("base64url");
  return `${userId}.${mac}`;
}
export function verifyUnsubscribeToken(token: string): string | null {
  const [userId, mac] = token.split(".");
  if (!userId || !mac) return null;
  const expected = createHmac("sha256", secret()).update(userId).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? userId : null;
}
export function unsubscribeUrl(origin: string, userId: string): string {
  const url = new URL("/api/announce/unsubscribe", origin);
  url.searchParams.set("t", unsubscribeToken(userId));
  return url.toString();
}

export async function optOutUser(userId: string): Promise<void> {
  await db.update(users).set({ announcementsOptOutAt: new Date() }).where(eq(users.id, userId));
}

/* -------------------------------------------------------------- render */

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Very small "markdown". Blank-line separates paragraphs, single-line
 * separates line breaks. No bold/italic — an announcement doesn't need it.
 * Anything more expressive should be its own HTML template.
 */
function renderText(md: string, unsub: string): string {
  return `${md.trim()}\n\n—\nFantasy Stable · a game of skill · unsubscribe: ${unsub}`;
}
function renderHtml(subject: string, md: string, unsub: string): string {
  const body = md
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p style="font-size:15px;line-height:1.55;margin:0 0 16px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#17303c">
  <h1 style="font-size:22px;margin:0 0 4px;font-weight:800">${escapeHtml(subject)}</h1>
  <p style="font-size:13px;color:#7d919c;margin:0 0 20px">Fantasy Stable</p>
  ${body}
  <hr style="border:none;border-top:1px solid #eef2f6;margin:24px 0"/>
  <p style="font-size:12px;color:#93a5af;margin:0">
    You&rsquo;re getting this because you signed up for Fantasy Stable. Not for you?
    <a href="${unsub}" style="color:#04b56b;text-decoration:underline">Unsubscribe</a> — one tap, no forms.
  </p>
</div>`;
}
