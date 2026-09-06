/**
 * robots.txt for fantasystable.co.uk.
 *
 * Allow everything crawlable, block the app-internal routes that don't need
 * indexing (admin, sign-in, API), and point at the sitemap so a fresh crawl
 * knows where to look. Deliberately not gated on GAME_PAUSED — the game
 * being on a launch hold shouldn't stop Google indexing the marketing page
 * or the rules.
 */

import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.fantasystable.co.uk";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/game/admin",
          "/game/account",
          "/game/sign-in",
          "/game/player/",
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
    host: SITE,
  };
}
