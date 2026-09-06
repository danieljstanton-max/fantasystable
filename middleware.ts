import { NextRequest, NextResponse } from "next/server";
import { gamePaused } from "@/lib/pause";

/**
 * Domain-scoped visibility.
 *
 * This repo hosts two products in one Next.js app: the horse-racing tips
 * site (horseracingtips.io) and the Fantasy Stable game (fantasystable.co.uk).
 * They share layout/utility code but their audiences are completely
 * separate — a fantasy player typing `fantasystable.co.uk` should never see
 * the racecards homepage, and a tips reader should never see a fantasy
 * pitch on the tips domain.
 *
 * Rather than split the repo (which would fork all the shared code), we
 * decide per request which product this host belongs to and hide the other.
 *
 * On the fantasy domain:
 *   • Anything under `/game`, `/fantasy`, `/api`, or the framework paths
 *     is served as-is.
 *   • Everything else redirects to `/game`. That covers the root URL,
 *     `/racecards/*`, and any stray tips-site page.
 *
 * On any other host (including horseracingtips.io and the naked vercel.app
 * previews) nothing is rewritten — the tips site behaves as before.
 */
export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  const isFantasy = host === "fantasystable.co.uk" || host === "www.fantasystable.co.uk";
  if (!isFantasy) return NextResponse.next();

  const path = req.nextUrl.pathname;

  // Product-level pause: if GAME_PAUSED is set on Vercel, every game route
  // (pitch, sign-in, admin, results, leagues) redirects to the holding
  // page. The homepage stays live so the domain still explains what the
  // game is and when it's coming back. Static assets and the paused route
  // itself pass through.
  if (
    gamePaused() &&
    (path === "/game" || path.startsWith("/game/")) &&
    !path.startsWith("/api") &&
    !path.startsWith("/_next")
  ) {
    const url = req.nextUrl.clone();
    url.pathname = "/paused";
    url.search = "";
    return NextResponse.redirect(url, 307);
  }

  if (
    path.startsWith("/game") ||
    path.startsWith("/fantasy") ||
    path.startsWith("/paused") ||
    path.startsWith("/api") ||
    path.startsWith("/_next") ||
    path.startsWith("/img") ||
    path === "/favicon.ico" ||
    path === "/robots.txt" ||
    path === "/sitemap.xml"
  ) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  // Root URL routing depends on session: signed-out visitors (Instagram
  // traffic, mostly) land on the marketing homepage; signed-in players skip
  // straight to the pitch. Middleware can only see cookie presence, not
  // validity — good enough as a hint; /fantasy still bounces stale cookies
  // to /game and vice versa via its own guard.
  if (path === "/") {
    // Rewrite (not redirect) so the URL stays as `/` — the fantasy landing
    // page lives on the code path at /fantasy but the browser bar reads as
    // the domain root, which is where an Instagram click actually lands.
    url.pathname = "/fantasy";
    return NextResponse.rewrite(url);
  }
  url.pathname = "/game";
  url.search = "";
  return NextResponse.redirect(url, 308);
}

/**
 * Match everything that isn't already a static asset. The exclusions here
 * are a belt-and-braces companion to the path checks inside the middleware —
 * cheaper to skip a request entirely than to run the function and no-op.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
