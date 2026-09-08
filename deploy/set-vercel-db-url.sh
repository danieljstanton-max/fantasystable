#!/usr/bin/env bash
# Put the current Neon connection string into Vercel, without it passing
# through a chat window, a shell history file, or a commit.
#
# Dan rotated the Neon password on 2026-09-08. The Mac and the tips server
# were updated; Vercel was not, so every /game route started returning 500
# while /paused — the one page that touches no database — stayed up.
#
# Usage:  bash deploy/set-vercel-db-url.sh
set -euo pipefail

command -v vercel >/dev/null || { echo "vercel CLI not found: npm i -g vercel"; exit 1; }

if [ ! -f .vercel/project.json ]; then
  echo "This repo isn't linked to a Vercel project yet."
  echo "Running 'vercel link' — pick the fantasystable project when asked."
  vercel link
fi

printf 'Paste the Neon connection string (input is hidden), then press return:\n> '
read -rs URL
echo

case "$URL" in
  postgres://*|postgresql://*) ;;
  *) echo "That doesn't look like a Postgres URL. Nothing changed."; exit 1 ;;
esac

# Prove it works BEFORE putting it anywhere. A bad string that deploys is
# worse than no change: the build succeeds and every page 500s.
echo "Testing against Neon..."
# Written to a real .mts file rather than passed to `tsx --eval`: --eval
# compiles to CommonJS, which rejects the top-level await this needs, and
# reports it as a connection failure. It is not one.
# Must live inside the repo: a file in /tmp cannot resolve "postgres" from
# the project's node_modules and fails as ERR_MODULE_NOT_FOUND, which again
# looks like a bad password and is not.
TEST_TS=".neon-check.$$.mts"
trap 'rm -f "$TEST_TS"' EXIT
cat > "$TEST_TS" <<'TS'
import postgres from "postgres";
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });
  const r = await sql`select count(*)::int n from races`;
  console.log("  connected — " + r[0].n + " races visible");
  await sql.end();
}
main().catch((e) => { console.error("  " + (e?.message ?? e)); process.exit(1); });
TS

DATABASE_URL="$URL" npx tsx "$TEST_TS" || {
  echo "Could not connect. Nothing changed."
  exit 1
}

for env in production preview development; do
  vercel env rm DATABASE_URL "$env" --yes >/dev/null 2>&1 || true
  printf '%s' "$URL" | vercel env add DATABASE_URL "$env" >/dev/null
  echo "  set for $env"
done

unset URL
echo
echo "Stored. Now redeploy so the running app picks it up:"
echo "    vercel --prod"
