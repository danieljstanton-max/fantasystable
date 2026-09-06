"use client";

/**
 * Poll router.refresh() on an interval so a server-rendered page rehydrates
 * with new data without a hard reload.
 *
 * Costs one server-round-trip per interval per open tab — cheap for a
 * leaderboard where late-Saturday-afternoon page-glue is the whole point.
 * Skips the refresh when the tab is hidden so a phone locked in a pocket
 * isn't hammering the server.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
