/**
 * Product-level pause switch.
 *
 * Toggled by the `GAME_PAUSED` env var on Vercel. Set it to any truthy value
 * to freeze the game — /game/* routes and /game/sign-in bounce to /paused,
 * and existing sessions cannot save or sell. Delete the var to resume.
 *
 * The homepage and marketing routes stay live so anyone who lands on the
 * domain still sees the game exists, with a "back Saturday" banner instead
 * of a CTA that leads nowhere.
 *
 * Deliberately a single env-var boolean rather than a timestamp. The
 * launch day is a decision, not a countdown — Dan flips it when he's
 * ready. Same reason it doesn't read from the database: the pause must
 * work even if Postgres is down.
 */
export function gamePaused(): boolean {
  const v = (process.env.GAME_PAUSED ?? "").trim().toLowerCase();
  return v !== "" && v !== "0" && v !== "false" && v !== "no";
}
