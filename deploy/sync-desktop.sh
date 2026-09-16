#!/bin/bash
# Keep ~/Desktop/Racing Tips and the server in step.
#
# The card moved to the server on 2026-09-08 and the Desktop folder quietly
# stopped updating. Worse, VETOES.txt and PICKS.txt are edited on the Desktop
# and read on the server — so an override written after the move would have
# been silently ignored. This closes both directions:
#
#   UP    VETOES.txt, PICKS.txt   the Mac is where you edit them
#   DOWN  everything else         the server is where the card is built
#
# Never deletes anything on either side. A file is only replaced by a NEWER
# copy (-u), so an edit you are in the middle of on the Desktop is not
# clobbered by the next pull.
#
# Installed to ~/Library/Application Support/hrt/ and run by launchd, because
# macOS blocks launchd-started shells from reading ~/Documents, where the repo
# lives. Edit this copy in the repo, then: bash deploy/install-desktop-sync.sh

HOST="root@89.167.91.132"
REMOTE="/root/racing-tips/"        # symlink to "/root/Racing Tips" — no space for rsync to split on
LOCAL="$HOME/Desktop/Racing Tips/"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=15"

mkdir -p "$LOCAL"
echo "--- $(date '+%F %H:%M:%S') ---"

# Up first, so a veto written a minute before the 18:00 build is there for it.
for f in VETOES.txt PICKS.txt; do
  if [ -f "$LOCAL$f" ]; then
    rsync -tu -e "$SSH" "$LOCAL$f" "$HOST:$REMOTE$f" \
      && echo "  up    $f" || echo "  FAILED up $f"
  fi
done

# Down: the cards, VIP notes and logs.
rsync -rtu -e "$SSH" \
  --exclude 'VETOES.txt' --exclude 'PICKS.txt' --exclude '._*' \
  --itemize-changes \
  "$HOST:$REMOTE" "$LOCAL" \
  | grep -E '^>f' | sed 's/^>f[^ ]* /  down  /' || true

echo "  done"
