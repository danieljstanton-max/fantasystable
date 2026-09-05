import { NextResponse } from "next/server";
import { consumeSignIn } from "@/lib/auth";

/**
 * The far end of a sign-in link.
 *
 * A GET, because that is what an email client will follow. That makes it
 * inherently vulnerable to a link being fetched by something other than the
 * person who was sent it — a scanner in a corporate mail gateway, say — which
 * is exactly why the token is single-use and short-lived rather than a
 * long-lived credential. A prefetched link burns and the user asks for
 * another; a prefetched password would be a breach.
 *
 * Never redirect to a URL taken from the query string. That is the standard
 * open-redirect in a sign-in flow: a link that authenticates you and then
 * bounces you to an attacker's page looks entirely legitimate.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const userId = await consumeSignIn(token);

  const destination = new URL(userId ? "/game" : "/game/sign-in?error=expired", request.url);
  return NextResponse.redirect(destination);
}
