import { NextResponse } from "next/server";
import { optOutUser, verifyUnsubscribeToken } from "@/lib/announcements";

/**
 * One-tap unsubscribe.
 *
 * Called two ways:
 *
 *   • GET from the link in the email body — a user clicking Unsubscribe in
 *     a browser. Redirects to a tiny "you're unsubscribed" page.
 *   • POST from mail clients that honour the `List-Unsubscribe` header
 *     one-click flow — Gmail's "Unsubscribe" button and equivalents. These
 *     never open a browser, so we respond with a 200 and no body.
 *
 * The token is HMAC-signed. A guessed or forged token is refused; a valid
 * one flips `announcementsOptOutAt` and every future broadcast skips them.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return NextResponse.redirect(new URL("/fantasy?unsubscribe=bad", request.url));
  await optOutUser(userId);
  return NextResponse.redirect(new URL("/fantasy?unsubscribed=1", request.url));
}

export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return new NextResponse(null, { status: 400 });
  await optOutUser(userId);
  return new NextResponse(null, { status: 200 });
}
