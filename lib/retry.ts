/**
 * Retry a network call that failed for a reason that is likely temporary.
 *
 * Dan, 2026-08-31: the Lucky 15 stopped settling. The cause was the results
 * agent dying on `[TypeError: fetch failed] ... read ECONNRESET` — one dropped
 * TLS connection to the API and the whole run aborted, so nothing was pushed
 * and every widget stayed on yesterday's state until the next tick happened to
 * succeed.
 *
 * A ten-minute loop hides this most of the time, which is what makes it worth
 * fixing: the failures are invisible until a race sits unsettled for an hour
 * and someone notices on the site rather than in a log.
 *
 * Only connection-level failures are retried. An HTTP error is the server
 * telling us something true, and repeating the request will not change it.
 */
export async function withRetry<T>(
  what: string,
  fn: () => Promise<T>,
  attempts = 3
): Promise<T> {
  let last: unknown;

  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = String((e as Error)?.message ?? e);
      const cause = String((e as any)?.cause?.code ?? "");
      const transient =
        /fetch failed|network|socket|timeout|EAI_AGAIN/i.test(msg) ||
        ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "ENOTFOUND"].includes(cause);

      if (!transient || i === attempts) break;

      // Back off, so a wobbling connection is not hammered.
      const wait = 2000 * i;
      console.error(`  ${what}: ${cause || msg} — retrying in ${wait / 1000}s (${i}/${attempts - 1})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw last;
}
