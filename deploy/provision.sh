#!/usr/bin/env bash
#
# Stand up the racing-site scheduler on a fresh Hetzner box.
#
# Dan, 2026-09-08, after a week of the site going stale whenever his Mac slept:
# "what can I buy so it updates if my laptop is not on?"
#
# Run FROM the Mac:   ./deploy/provision.sh <server-ip>
#
# Idempotent — safe to run again after a change. It does not copy .env.local;
# that is a separate deliberate step so credentials never pass through a chat
# window or a script argument.
set -euo pipefail

IP="${1:-}"
[ -n "$IP" ] || { echo "usage: ./deploy/provision.sh <server-ip>"; exit 1; }
SSH="ssh -o StrictHostKeyChecking=accept-new root@${IP}"

echo "==> 1/7  base packages"
$SSH bash -s <<'EOF'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates ufw tzdata >/dev/null
timedatectl set-timezone Europe/London
EOF

echo "==> 2/7  swap (the nightly job asks for a 4GB heap on a 2GB box)"
$SSH bash -s <<'EOF'
set -euo pipefail
if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
free -h | sed 's/^/    /'
EOF

echo "==> 3/7  firewall: ssh only"
$SSH bash -s <<'EOF'
set -euo pipefail
ufw allow OpenSSH >/dev/null
ufw --force enable >/dev/null
ufw status | sed 's/^/    /'
EOF

echo "==> 4/7  node 22"
$SSH bash -s <<'EOF'
set -euo pipefail
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi
echo "    node $(node -v), npm $(npm -v)"
EOF

echo "==> 5/7  the repo"
$SSH bash -s <<'EOF'
set -euo pipefail
mkdir -p /opt
if [ -d /opt/racing-site/.git ]; then
  cd /opt/racing-site && git pull --ff-only 2>/dev/null || true
fi
mkdir -p /opt/racing-site "/root/Racing Tips"
EOF

echo "==> 6/7  sending the working tree (excluding secrets and junk)"
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude '.next' \
  --exclude '.env.local' --exclude 'probe-output' \
  ./ "root@${IP}:/opt/racing-site/"
$SSH bash -s <<'EOF'
set -euo pipefail
cd /opt/racing-site
# NOT --omit=dev. The scheduler runs TypeScript through tsx, and tsx, typescript
# and the drizzle tooling all live in devDependencies. Installing production-only
# gave a box that looked provisioned and could not run a single script.
npm ci --silent 2>/dev/null || npm install --silent
EOF

echo "==> 7/7  schedule"
$SSH bash -s <<'EOF'
set -euo pipefail
cat > /etc/cron.d/racing-site <<'CRON'
# The racing-site scheduler. London time — the box is set to Europe/London.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Card, prices and results every ten minutes through racing hours.
*/10 7-23 * * *  root  cd /opt/racing-site && /usr/bin/npm run --silent sweep >> "/root/Racing Tips/_results-log.txt" 2>&1

# Tomorrow's card, once, after the last race has settled.
15 22 * * *      root  cd /opt/racing-site && /usr/bin/npm run --silent daily >> "/root/Racing Tips/_log.txt" 2>&1
CRON
chmod 644 /etc/cron.d/racing-site
systemctl restart cron
echo "    installed:"
sed -n '5,20p' /etc/cron.d/racing-site | sed 's/^/    /'
EOF

echo
echo "Done — except the one thing that must not go through a script argument."
echo
echo "  Copy your env file across, from the Mac:"
echo "    scp .env.local root@${IP}:/opt/racing-site/.env.local"
echo
echo "  Then check it runs:"
echo "    ssh root@${IP} 'cd /opt/racing-site && npm run sweep -- --now'"
