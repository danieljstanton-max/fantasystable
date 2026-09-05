/**
 * Money formatting for the game — a plain module (no "use client") so it can
 * be called from Server Components too. Living inside game-chrome.tsx meant
 * a server render like `moneyValue(0)` in SignedOut hit Next 15's rule that
 * client exports cannot be invoked on the server. One helper, two callers,
 * one home outside the client boundary.
 */
export const money = (m: number): string =>
  Number.isInteger(m) ? `${m}m` : `${m.toFixed(1)}m`;
