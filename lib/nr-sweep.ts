/**
 * Non-runner sweep.
 *
 * When a horse in a saved stable is flagged as a non-runner AND the card
 * hasn't yet locked, the pick is:
 *
 *   1. Removed from the stable — the price the player paid is refunded
 *      back into the bank so they can buy someone else.
 *   2. Emailed to the player with the time they have left to replace it.
 *
 * The pick's absence is the log — a second sweep won't re-email because
 * there's no pick to act on. Post-lock non-runners are left alone; those
 * settle to zero points and the player already had the full deadline to
 * decide whether to swap.
 */

import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { db, races, runners, stablePicks, stables, users } from "@/db";
import { LOCK_OFFSET_MS } from "./lock";
import { today } from "./game-data";
import { sendMail } from "./mailer";

export type NrSweepReport = {
  swept: {
    userId: string;
    email: string;
    raceDate: string;
    horses: { name: string; refunded: number }[];
    newBank: number;
    deadline: Date | null;
  }[];
  emailed: number;
  errors: string[];
};

export async function sweepNonRunners(origin: string): Promise<NrSweepReport> {
  const report: NrSweepReport = { swept: [], emailed: 0, errors: [] };

  // Active stables — race date today or later, not manually locked. Any
  // stable whose card first-off is already inside the lock window is
  // filtered out below (once we know its off time).
  const active = await db
    .select({
      id: stables.id,
      userId: stables.userId,
      raceDate: stables.raceDate,
      spendM: stables.spendM,
      napHorseId: stables.napHorseId,
    })
    .from(stables)
    .where(and(gte(stables.raceDate, today()), isNull(stables.lockedAt)));

  const now = Date.now();
  for (const st of active) {
    const [first] = await db
      .select({ offDt: races.offDt })
      .from(races)
      .where(eq(races.raceDate, st.raceDate))
      .orderBy(asc(races.offDt))
      .limit(1);
    if (!first?.offDt) continue;
    // Skip if the card has effectively locked — post-lock NRs stay in the
    // stable and settle to zero.
    const deadline = new Date(first.offDt.getTime() - LOCK_OFFSET_MS);
    if (deadline.getTime() <= now) continue;

    const nrPicks = await db
      .select({
        subjectId: stablePicks.subjectId,
        subjectName: stablePicks.subjectName,
        raceId: stablePicks.raceId,
        priceM: stablePicks.priceM,
      })
      .from(stablePicks)
      .innerJoin(
        runners,
        and(
          eq(runners.horseId, stablePicks.subjectId),
          eq(runners.raceId, stablePicks.raceId)
        )
      )
      .where(
        and(
          eq(stablePicks.stableId, st.id),
          eq(stablePicks.kind, "horse"),
          eq(runners.isNonRunner, true)
        )
      );
    if (nrPicks.length === 0) continue;

    const removedNames: { name: string; refunded: number }[] = [];
    let newSpend = st.spendM;
    let napWiped = false;
    await db.transaction(async (tx) => {
      for (const p of nrPicks) {
        await tx
          .delete(stablePicks)
          .where(
            and(
              eq(stablePicks.stableId, st.id),
              eq(stablePicks.kind, "horse"),
              eq(stablePicks.subjectId, p.subjectId)
            )
          );
        newSpend = Math.round((newSpend - p.priceM) * 10) / 10;
        removedNames.push({ name: p.subjectName, refunded: p.priceM });
        if (st.napHorseId === p.subjectId) napWiped = true;
      }
      const patch: Record<string, unknown> = { spendM: newSpend, updatedAt: new Date() };
      if (napWiped) patch.napHorseId = null;
      await tx.update(stables).set(patch).where(eq(stables.id, st.id));
    });

    // Look up the player's email for the notification. This is a one-per-
    // stable query on purpose — the sweep is small (dozens, not thousands)
    // and joining ahead of time complicates the drizzle types.
    const [u] = await db
      .select({ email: users.email, displayName: users.displayName })
      .from(users)
      .where(eq(users.id, st.userId))
      .limit(1);
    if (!u) {
      report.errors.push(`no user for stable ${st.id}`);
      continue;
    }

    const newBank = Math.round((100 - newSpend) * 10) / 10;
    report.swept.push({
      userId: st.userId,
      email: u.email,
      raceDate: st.raceDate,
      horses: removedNames,
      newBank,
      deadline,
    });

    try {
      await sendNrEmail({
        to: u.email,
        name: u.displayName ?? u.email.split("@")[0],
        raceDate: st.raceDate,
        removed: removedNames,
        newBank,
        deadline,
        napWiped,
        origin,
      });
      report.emailed += 1;
    } catch (e) {
      report.errors.push(`email failed for ${u.email}: ${(e as Error).message}`);
    }
  }

  return report;
}

/* ---------------------------------------------------------- email body */

async function sendNrEmail(opts: {
  to: string;
  name: string;
  raceDate: string;
  removed: { name: string; refunded: number }[];
  newBank: number;
  deadline: Date;
  napWiped: boolean;
  origin: string;
}): Promise<void> {
  const { to, name, raceDate, removed, newBank, deadline, napWiped, origin } = opts;
  const day = new Date(`${raceDate}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const deadlineLabel = deadline.toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const horseList = removed.map((h) => `${h.name} (£${h.refunded.toFixed(1)}m refunded)`).join(", ");
  const singular = removed.length === 1;
  const subject = singular
    ? `Non-runner: ${removed[0].name} is out`
    : `${removed.length} non-runners in your stable`;
  const link = `${origin}/game?date=${raceDate}`;

  const text = [
    `Hi ${name},`,
    "",
    `Heads up — ${singular ? "one of your picks" : `${removed.length} of your picks`} for ${day} ${singular ? "is" : "are"} a non-runner: ${horseList}.`,
    "",
    `We've refunded ${singular ? "that horse's price" : "those horses' prices"} to your bank — you now have £${newBank.toFixed(1)}m to spend.`,
    napWiped
      ? "That was your NAP too, so pick a new one before the deadline."
      : "",
    "",
    `Deadline: ${deadlineLabel}.`,
    "",
    `Head to ${link} to pick a replacement.`,
    "",
    "— Fantasy Stable",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#17303c">
  <h1 style="font-size:22px;margin:0 0 4px;font-weight:800">Non-runner${singular ? "" : "s"} in your stable</h1>
  <p style="font-size:13px;color:#7d919c;margin:0 0 20px">Fantasy Stable · ${day}</p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 12px">
    Hi ${escapeHtml(name)},
  </p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 12px">
    ${singular ? "One of your picks is" : `${removed.length} of your picks are`} a non-runner:
    <strong>${escapeHtml(horseList)}</strong>.
  </p>
  <p style="font-size:15px;line-height:1.55;margin:0 0 12px">
    We've refunded ${singular ? "that price" : "those prices"} to your bank. You now have
    <strong style="color:#04b56b">£${newBank.toFixed(1)}m</strong> to spend on a replacement.
  </p>
  ${napWiped ? '<p style="font-size:15px;line-height:1.55;margin:0 0 12px;color:#a3261f"><strong>That was your NAP too — pick a new one before the deadline.</strong></p>' : ""}
  <p style="font-size:15px;line-height:1.55;margin:0 0 20px">
    Deadline: <strong>${escapeHtml(deadlineLabel)}</strong>.
  </p>
  <p style="margin:0 0 24px">
    <a href="${link}" style="display:inline-block;padding:12px 24px;background:#04b56b;color:#fff;text-decoration:none;border-radius:12px;font-weight:800">Pick a replacement</a>
  </p>
  <hr style="border:none;border-top:1px solid #eef2f6;margin:24px 0"/>
  <p style="font-size:12px;color:#93a5af;margin:0">This is a service email about your stable — non-runner alerts always go out.</p>
</div>`;

  await sendMail({ to, subject, text, html });
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
