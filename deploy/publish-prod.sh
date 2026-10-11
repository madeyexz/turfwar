#!/bin/bash
# Publish the game module to every production database: Taipei (the default server, a GCP machine,
# deploy/gcp-taipei) and the legacy Maincloud database (`3d-game-c4lhd`, "US East"). Taipei's is named
# `turfwar`. Run before pushing `main`, so the module and the frontend stay compatible.
#   bun run publish:prod          # both
#   bun run publish:prod -- tw    # Taipei only
#
# - The Singapore server (InstaCloud, deploy/instacloud) was retired on 2026-10-11 and is no longer
#   published to; see docs/DEVELOPMENT.md to start it again.
# - Every publish uses --delete-data=never: a change that would need deleting data stops here
#   instead. Nothing in this script can reset a database.
# - The owner identity lives in ~/.config/turfwar (made once by deploy/instacloud/owner.sh <server-url>,
#   the profile is still named `instacloud-cli.toml`). Taipei began as a copy of the Singapore server
#   with its signing keys, so that same owner login publishes to it.
set -euo pipefail
cd "$(dirname "$0")/.."
TW_URL="${TW_URL:-https://tw.turfwar.ianhsiao.me}"
OWNER_CLI="$HOME/.config/turfwar/instacloud-cli.toml"
only="${1:-all}"

[ -f "$OWNER_CLI" ] || { echo "No owner profile ($OWNER_CLI). Run deploy/instacloud/owner.sh <server-url> first." >&2; exit 1; }
cli() { spacetime --config-path "$OWNER_CLI" "$@"; }
# Point a server name in the owner profile at a URL: add it the first time, edit it when the URL moved,
# leave it when it already matches (the CLI refuses an edit that changes nothing).
point() {
  local host line
  host=$(echo "$2" | sed -E 's#^[a-z]+://##; s#/.*##')
  line=$(cli server list 2>/dev/null | awk -v n="$1" '$NF == n')
  if [ -z "$line" ]; then cli server add "$1" --url "$2" --no-fingerprint >/dev/null
  elif ! echo "$line" | grep -qF "$host"; then cli server edit "$1" --url "$2" --no-fingerprint -y >/dev/null
  fi
}

if [ "$only" = all ] || [ "$only" = tw ]; then
  point taipei "$TW_URL"
  curl -fsS -o /dev/null --max-time 15 "$TW_URL/v1/ping" || { echo "Taipei server ($TW_URL) does not answer" >&2; exit 1; }
  echo "Publishing to Taipei (turfwar)…"
  cli publish turfwar --server taipei --module-path spacetimedb --delete-data=never -y
fi

if [ "$only" = all ]; then
  echo "Publishing to Maincloud legacy (3d-game-c4lhd)…"
  spacetime publish 3d-game-c4lhd --server maincloud --module-path spacetimedb --delete-data=never -y
fi
echo "Done. Now merge dev into main and push for the frontend."
