import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

/**
 * Called by the ingest job when it finishes, so a going change or a withdrawal
 * shows up immediately instead of waiting out the 5-minute ISR window.
 *
 *   curl -X POST "$SITE/api/revalidate?secret=$REVALIDATE_SECRET&path=/racecards"
 *
 * The secret is compared in constant time. A plain === leaks the secret one
 * character at a time to anyone willing to measure the response.
 */

export const dynamic = "force-dynamic";

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(request: Request) {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "REVALIDATE_SECRET is not configured" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const provided = searchParams.get("secret") ?? "";
  if (!safeEqual(provided, expected)) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  // Default to the hub; pass ?path= repeatedly to target specific races.
  const paths = searchParams.getAll("path");
  const targets = paths.length ? paths : ["/", "/racecards"];

  for (const path of targets) {
    if (!path.startsWith("/")) continue;
    revalidatePath(path);
  }

  return NextResponse.json({ revalidated: targets, at: new Date().toISOString() });
}
