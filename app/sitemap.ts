/**
 * sitemap.xml for fantasystable.co.uk.
 *
 * Every URL a search engine should know about. Kept short on purpose —
 * per-player and per-race pages either aren't shareable content (a stable
 * profile) or come and go too fast to be worth crawling weekly (a Saturday
 * card). The rules page is the workhorse for long-tail intent.
 */

import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.fantasystable.co.uk";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: `${SITE}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${SITE}/game/rules`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${SITE}/game/leaderboard`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${SITE}/game/results`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
  ];
}
