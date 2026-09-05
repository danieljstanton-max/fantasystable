import { NextResponse } from "next/server";
import { settleDate } from "@/lib/settlement";

/**
 * Scheduled settlement.
 *
 *   • Vercel Cron hits this every ~30 minutes during racing hours.
 *   • Idempotent: settling the same day twice writes the same numbers, so a
 *     retrying scheduler cannot corrupt anything.
 *   • Gated by CRON_SECRET so the endpoint cannot be pinged by anyone with
 *     the URL. Vercel Cron sends the secret in the Authorization header.
 *
 * `date` defaults to today (Europe/London). Passing `?date=YYYY-MM-DD` lets
 * us re-settle a past day after a late correction from the results feed.
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
  const report = await settleDate(date);
  return NextResponse.json({ ok: true, ...report });
}

function today(): string {
  // Race dates are always Europe/London wall-clock. Using UTC here would
  // shift the boundary by up to an hour twice a year — the settlement then
  // runs against yesterday's card in the small hours of a Sunday morning.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}
