import { NextResponse } from "next/server";
import { db, gamePrices } from "@/db";
import { and, eq, inArray } from "drizzle-orm";
import { loadCard, today } from "@/lib/game-data";

/**
 * Frozen price tick for the game.
 *
 * Runs every 15 minutes from Friday evening through Saturday morning. Each
 * call snapshots the entire game card at ONE instant so the pricing player
 * saw at 12:15 is exactly what settlement will use for that tick — the
 * `opening_odds_at` timestamps on the racecards table are per-runner and
 * can vary by hours, which is not a snapshot.
 *
 * Writes are append-only. A duplicate tick within the same second is a
 * no-op via the composite primary key.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }

  const date = new URL(request.url).searchParams.get("date") ?? today();
  const { card } = await loadCard(date);
  if (!card.races.length) return NextResponse.json({ ok: true, snapshotted: 0, date });

  const snapshotAt = new Date();
  const rows = [
    ...card.races.flatMap((race) =>
      race.runners.map((r) => ({
        raceDate: date,
        snapshotAt,
        kind: "horse",
        subjectId: r.horseId,
        subjectName: r.horse,
        raceId: race.raceId,
        oddsDec: r.oddsDec,
        strength: r.p,
        priceM: r.price,
      }))
    ),
    ...card.jockeys.map((j) => ({
      raceDate: date,
      snapshotAt,
      kind: "jockey",
      subjectId: j.id,
      subjectName: j.name,
      raceId: null as string | null,
      oddsDec: null as number | null,
      strength: j.strength,
      priceM: j.price,
    })),
  ];

  await db.insert(gamePrices).values(rows).onConflictDoNothing();
  return NextResponse.json({
    ok: true,
    date,
    snapshotAt: snapshotAt.toISOString(),
    snapshotted: rows.length,
  });
}
