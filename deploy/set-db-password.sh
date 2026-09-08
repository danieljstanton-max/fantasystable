#!/usr/bin/env bash
#
# Swap the password inside DATABASE_URL, then push .env.local to the server.
#
# Dan, 2026-09-08, pasted a fresh Neon password into the chat window while
# rotating the one that had already leaked there. The rule in CLAUDE.md is that
# credentials never go through a chat, so the fix is to make the safe path the
# easy one: the password is typed into a hidden prompt on his own machine and
# goes straight into the file.
#
#   ./deploy/set-db-password.sh [server-ip]
set -euo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"
IP="${1:-89.167.91.132}"

[ -f "$ENV_FILE" ] || { echo "no .env.local at $ENV_FILE"; exit 1; }

printf 'Paste the new Neon password (it will not be shown): '
read -rs PW
echo
[ -n "$PW" ] || { echo "nothing entered — no change made"; exit 1; }

cp "$ENV_FILE" "$ENV_FILE.bak"

PW="$PW" python3 - "$ENV_FILE" <<'PY'
import os, re, sys, pathlib
pw = os.environ["PW"]
p = pathlib.Path(sys.argv[1])
s = p.read_text()
new, n = re.subn(
    r'(DATABASE_URL="?postgres(?:ql)?://[^:]+:)([^@]+)(@)',
    lambda m: m.group(1) + pw + m.group(3),
    s,
    count=1,
)
if n != 1:
    print("  could not find DATABASE_URL — nothing changed"); sys.exit(1)
p.write_text(new)
print("  .env.local updated (backup at .env.local.bak)")
PY

echo "  testing the new password against Neon..."
if npx tsx --env-file=.env.local -e "
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });
const r = await sql\`select 1 as ok\`;
console.log('  connected:', r[0].ok === 1 ? 'yes' : 'no');
await sql.end();
" 2>/dev/null; then
  echo "  password works"
else
  echo "  COULD NOT CONNECT — the password may be wrong."
  echo "  Your previous file is at .env.local.bak; restore it with:"
  echo "    mv .env.local.bak .env.local"
  exit 1
fi

echo "  copying to the server..."
scp -q "$ENV_FILE" "root@${IP}:/opt/racing-site/.env.local"
echo "  done — server has the new credentials"
