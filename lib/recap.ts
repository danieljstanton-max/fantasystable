/**
 * End-of-day recap.
 *
 * After settlement lands the final numbers, every player who saved a stable
 * for the day gets an email with the story of their race day:
 *
 *   • Their own score and rank.
 *   • The overall winner (stable name + points).
 *   • The best NAP (winner AND highest points among NAPs).
 *   • The highest-priced winner picked and who picked it.
 *   • The most popular horse of the day — how many players had it, how did
 *     it finish, how did their score compare.
 *
 * The version they receive is personal. Kept as one function because a race
 * day is one story: shipping half the highlights would leave the recap
 * lopsided.
 */

import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, runners, stablePicks, stables, users } from "@/db";
import { sendMail } from "./mailer";

export type RecapReport = {
  date: string;
  entrants: number;
  emailed: number;
  winner: { stableName: string; points: number } | null;
  bestNap: { horse: string; points: number; picks: number } | null;
  bigPriceWinner: { horse: string; priceM: number; picks: number } | null;
  mostPopular: { horse: string; picks: number; positionLabel: string | null } | null;
  errors: string[];
};

export async function sendDayRecap(date: string): Promise<RecapReport> {
  const report: RecapReport = {
    date,
    entrants: 0,
    emailed: 0,
    winner: null,
    bestNap: null,
    bigPriceWinner: null,
    mostPopular: null,
    errors: [],
  };

  // Every stable + owner for the date, ordered by points so index 0 is the
  // winner. displayName/stableName give us something friendlier to show
  // than an email address.
  const board = await db
    .select({
      id: stables.id,
      userId: stables.userId,
      points: stables.points,
      napHorseId: stables.napHorseId,
      email: users.email,
      displayName: users.displayName,
      stableName: users.stableName,
    })
    .from(stables)
    .innerJoin(users, eq(users.id, stables.userId))
    .where(eq(stables.raceDate, date))
    .orderBy(desc(stables.points));

  report.entrants = board.length;
  if (board.length === 0) return report;

  // All horse picks for the day, joined onto runners for the finishing
  // position. One query, worked over in memory.
  const picks = await db
    .select({
      stableId: stablePicks.stableId,
      subjectId: stablePicks.subjectId,
      subjectName: stablePicks.subjectName,
      raceId: stablePicks.raceId,
      priceM: stablePicks.priceM,
      points: stablePicks.points,
      positionNum: runners.positionNum,
      positionLabel: runners.position,
    })
    .from(stablePicks)
    .innerJoin(stables, eq(stables.id, stablePicks.stableId))
    .leftJoin(
      runners,
      and(eq(runners.horseId, stablePicks.subjectId), eq(runners.raceId, stablePicks.raceId))
    )
    .where(and(eq(stables.raceDate, date), eq(stablePicks.kind, "horse")));

  // Winner.
  const first = board[0];
  const firstName = displayFor(first);
  report.winner = { stableName: firstName, points: first.points ?? 0 };

  // Best NAP.
  const napHorseByStable = new Map(board.map((s) => [s.id, s.napHorseId]));
  const napRows = picks.filter((p) => napHorseByStable.get(p.stableId) === p.subjectId);
  const bestNap = napRows
    .filter((p) => p.positionNum === 1)
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))[0];
  if (bestNap) {
    const napCount = napRows.filter((p) => p.subjectId === bestNap.subjectId).length;
    report.bestNap = { horse: bestNap.subjectName, points: bestNap.points ?? 0, picks: napCount };
  }

  // Highest-priced winner picked by anyone.
  const winnersByPrice = picks
    .filter((p) => p.positionNum === 1)
    .sort((a, b) => b.priceM - a.priceM);
  if (winnersByPrice[0]) {
    const w = winnersByPrice[0];
    const count = picks.filter((p) => p.subjectId === w.subjectId).length;
    report.bigPriceWinner = { horse: w.subjectName, priceM: w.priceM, picks: count };
  }

  // Most-popular horse of the day.
  const popularity = new Map<string, { name: string; picks: number; positionLabel: string | null }>();
  for (const p of picks) {
    const cur = popularity.get(p.subjectId) ?? {
      name: p.subjectName,
      picks: 0,
      positionLabel: p.positionLabel ?? null,
    };
    cur.picks += 1;
    popularity.set(p.subjectId, cur);
  }
  const mostPopular = [...popularity.values()].sort((a, b) => b.picks - a.picks)[0];
  if (mostPopular && mostPopular.picks > 1) {
    report.mostPopular = {
      horse: mostPopular.name,
      picks: mostPopular.picks,
      positionLabel: mostPopular.positionLabel,
    };
  }

  // Compose + send a personalised email per stable.
  for (let i = 0; i < board.length; i++) {
    const st = board[i];
    const rank = i + 1;
    try {
      await sendMail({
        to: st.email,
        subject: subjectFor(rank, st.points ?? 0, board.length),
        text: renderText(displayFor(st), rank, st.points ?? 0, report),
        html: renderHtml(displayFor(st), rank, st.points ?? 0, report),
      });
      report.emailed += 1;
    } catch (e) {
      report.errors.push(`${st.email}: ${(e as Error).message}`);
    }
  }

  return report;
}

/* ------------------------------------------------------------- helpers */

function displayFor(u: { stableName: string | null; displayName: string | null; email: string }): string {
  if (u.stableName) return u.stableName.replace(/'s Stable$/, "");
  if (u.displayName) return u.displayName;
  return u.email.split("@")[0];
}

function subjectFor(rank: number, points: number, total: number): string {
  if (rank === 1) return `You won this week — ${points} pts`;
  if (rank <= 3) return `You finished ${ord(rank)} — ${points} pts`;
  return `Race day recap — ${points} pts, ${ord(rank)} of ${total}`;
}

function ord(n: number): string {
  const s = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
  return `${n}${s}`;
}

function renderText(name: string, rank: number, points: number, r: RecapReport): string {
  const day = new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const lines: string[] = [
    `Hi ${name},`,
    "",
    rank === 1
      ? `You WON this week's Fantasy Stable — ${points} points, top of ${r.entrants} stables. Take a bow.`
      : `You finished ${ord(rank)} of ${r.entrants} on ${points} points.`,
    "",
    `Race day: ${day}`,
    "",
  ];
  if (r.winner && rank !== 1) {
    lines.push(`Winner: ${r.winner.stableName} — ${r.winner.points} pts`);
  }
  if (r.bestNap) {
    lines.push(`Best NAP: ${r.bestNap.horse} for ${r.bestNap.points} pts (${r.bestNap.picks} ${r.bestNap.picks === 1 ? "player had it" : "players had it"})`);
  }
  if (r.bigPriceWinner) {
    lines.push(`Priciest winner picked: ${r.bigPriceWinner.horse} at £${r.bigPriceWinner.priceM.toFixed(1)}m (${r.bigPriceWinner.picks} ${r.bigPriceWinner.picks === 1 ? "player" : "players"})`);
  }
  if (r.mostPopular) {
    lines.push(`Most popular horse: ${r.mostPopular.horse} — ${r.mostPopular.picks} stables had it (finished ${r.mostPopular.positionLabel ?? "—"})`);
  }
  lines.push("", "New card up on Friday. See you then.", "", "— Fantasy Stable");
  return lines.join("\n");
}

function renderHtml(name: string, rank: number, points: number, r: RecapReport): string {
  const day = new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const highlights: string[] = [];
  if (r.winner && rank !== 1) {
    highlights.push(highlight("🏆 Winner", `${escapeHtml(r.winner.stableName)} — <strong>${r.winner.points} pts</strong>`));
  }
  if (r.bestNap) {
    highlights.push(highlight("⭐ Best NAP", `${escapeHtml(r.bestNap.horse)} for <strong>${r.bestNap.points} pts</strong> · ${r.bestNap.picks} player${r.bestNap.picks === 1 ? "" : "s"} had it`));
  }
  if (r.bigPriceWinner) {
    highlights.push(highlight("💰 Priciest winner", `${escapeHtml(r.bigPriceWinner.horse)} · <strong>£${r.bigPriceWinner.priceM.toFixed(1)}m</strong> · ${r.bigPriceWinner.picks} player${r.bigPriceWinner.picks === 1 ? "" : "s"}`));
  }
  if (r.mostPopular) {
    highlights.push(highlight("👥 Most popular", `${escapeHtml(r.mostPopular.horse)} · <strong>${r.mostPopular.picks} stables</strong> · finished ${escapeHtml(r.mostPopular.positionLabel ?? "—")}`));
  }

  return `
<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;color:#17303c">
  <h1 style="font-size:26px;margin:0 0 4px;font-weight:900">${rank === 1 ? "You won! 🏆" : `You finished ${ord(rank)}`}</h1>
  <p style="font-size:13px;color:#7d919c;margin:0 0 24px">Fantasy Stable · ${day}</p>
  <div style="display:inline-block;padding:10px 20px;background:#eaf7f0;color:#04b56b;font-size:24px;font-weight:900;border-radius:14px;margin-bottom:24px">
    ${points} pts
  </div>
  <p style="font-size:15px;line-height:1.55;margin:0 0 20px">
    Hi ${escapeHtml(name)}, that's ${rank === 1 ? "top of" : `${ord(rank)} of`} <strong>${r.entrants}</strong> stables this week.
  </p>
  ${highlights.join("")}
  <hr style="border:none;border-top:1px solid #eef2f6;margin:24px 0"/>
  <p style="font-size:13px;color:#7d919c;margin:0">New card up on Friday. See you then.</p>
</div>`;
}

function highlight(label: string, body: string): string {
  return `
<div style="padding:14px 16px;background:#f6f4f8;border-radius:12px;margin:0 0 10px">
  <div style="font-size:11px;font-weight:800;color:#7d919c;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${label}</div>
  <div style="font-size:14px;color:#17303c;line-height:1.4">${body}</div>
</div>`;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
