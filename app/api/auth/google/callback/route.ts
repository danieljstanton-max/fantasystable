import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { consumeGoogleCallback } from "@/lib/auth-google";

/**
 * Google's redirect back to us. Validates the state cookie, exchanges the
 * code for an id_token and signs the user in. Any failure lands them on the
 * sign-in page with a hint — never on a page named by the query string.
 *
 * The origin passed to consumeGoogleCallback must MATCH the one used to start
 * the flow, byte for byte — Google verifies redirect_uri consistency on the
 * token exchange. See the note in ../route.ts about 0.0.0.0-vs-Host-header.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const err = url.searchParams.get("error");

  const origin = await originFromRequest();
  if (err) {
    return NextResponse.redirect(new URL(`/game/sign-in?error=google-cancelled`, origin));
  }

  const userId = await consumeGoogleCallback(origin, code, state);
  return NextResponse.redirect(
    new URL(userId ? "/game" : "/game/sign-in?error=google-failed", origin)
  );
}

async function originFromRequest(): Promise<string> {
  const configured = process.env.PUBLIC_ORIGIN;
  if (configured && process.env.NODE_ENV === "production") return configured;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("192.") ? "http" : "https");
  return `${proto}://${host}`;
}
