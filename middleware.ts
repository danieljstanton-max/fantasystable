import { NextRequest, NextResponse } from "next/server";

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
  if (
    path.startsWith("/game") ||
    path.startsWith("/fantasy") ||
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
