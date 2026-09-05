import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { googleConfigured, startGoogleFlow } from "@/lib/auth-google";

/**
 * Kick off Google sign-in — a redirect to Google's consent page. We use a
 * GET here because the button is a plain link the user taps.
 *
 * The origin we hand Google (for the redirect_uri) is built from the browser's
 * `Host` header rather than `request.url`. In dev we bind to 0.0.0.0 so a
 * phone on the LAN can reach the server, but Next.js reports `0.0.0.0` as
 * the request origin regardless of what the browser actually typed —
 * which then doesn't match the URIs registered in the Google Cloud console.
 */
export async function GET(request: Request) {
  const origin = await originFromRequest();
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/game/sign-in?error=google-off", origin));
  }
  const u = new URL(request.url);
  const ageConfirmed = u.searchParams.get("age") === "1";
  if (!ageConfirmed) {
    return NextResponse.redirect(new URL("/game/sign-in?error=age-required", origin));
  }
  const url = await startGoogleFlow(origin, ageConfirmed);
  return NextResponse.redirect(url);
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
