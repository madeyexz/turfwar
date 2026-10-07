#!/bin/bash
# Publish the game module to every production database: Taipei (the default server, a GCP machine,
# deploy/gcp-taipei), Singapore (InstaCloud) and the legacy Maincloud database (`3d-game-c4lhd`,
# "US East"). All three are named `turfwar` but the last. Run before pushing `main`, so the module
# and the frontend stay compatible.
#   bun run publish:prod          # all three
#   bun run publish:prod -- tw    # Taipei only
#   bun run publish:prod -- sg    # Singapore only
#
# - Taipei is always on. Singapore sleeps when idle: it is woken first, waiting up to 3 minutes.
# - Every publish uses --delete-data=never: a change that would need deleting data stops here
#   instead. Nothing in this script can reset a database.
# - The owner identity lives in ~/.config/turfwar (made once by owner.sh). Taipei began as a copy of
#   Singapore with its signing keys, so the same owner login publishes to both.
set -euo pipefail
cd "$(dirname "$0")/../.."
TW_URL="${TW_URL:-https://tw.turfwar.ianhsiao.me}"
SG_URL="${SG_URL:-https://play.turfwar.ianhsiao.me}"
SG_FALLBACK="https://prod-main-stdb-2b7636-205bvw6d002.compute.instacloud-edge.com"
OWNER_CLI="$HOME/.config/turfwar/instacloud-cli.toml"
only="${1:-all}"

[ -f "$OWNER_CLI" ] || { echo "No owner profile ($OWNER_CLI). Run deploy/instacloud/owner.sh first." >&2; exit 1; }
cli() { spacetime --config-path "$OWNER_CLI" "$@"; }
# Point a server name in the owner profile at a URL (adding it the first time).
point() { cli server edit "$1" --url "$2" --no-fingerprint -y >/dev/null 2>&1 || cli server add "$1" --url "$2" --no-fingerprint >/dev/null; }

if [ "$only" = all ] || [ "$only" = tw ]; then
  point taipei "$TW_URL"
  curl -fsS -o /dev/null --max-time 15 "$TW_URL/v1/ping" || { echo "Taipei server ($TW_URL) does not answer" >&2; exit 1; }
  echo "Publishing to Taipei (turfwar)…"
  cli publish turfwar --server taipei --module-path spacetimedb --delete-data=never -y
fi

if [ "$only" = all ] || [ "$only" = sg ]; then
  # The custom domain until its certificate is live; the platform URL works either way.
  if ! curl -fsS -o /dev/null --max-time 15 "$SG_URL/v1/ping" 2>/dev/null; then
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SG_URL/v1/ping" || true)
    if [ "$code" = "000" ]; then SG_URL="$SG_FALLBACK"; fi
  fi
  point instacloud "$SG_URL"
  echo "Waking the Singapore server ($SG_URL)…"
  for i in $(seq 1 90); do
    if curl -fsS -o /dev/null --max-time 10 "$SG_URL/v1/ping"; then echo "  up after ~$((i * 2)) s"; break; fi
    [ "$i" = 90 ] && { echo "Singapore server did not wake in 3 minutes" >&2; exit 1; }
    sleep 2
  done
  echo "Publishing to Singapore (turfwar)…"
  cli publish turfwar --server instacloud --module-path spacetimedb --delete-data=never -y
fi

if [ "$only" = all ]; then
  echo "Publishing to Maincloud legacy (3d-game-c4lhd)…"
  spacetime publish 3d-game-c4lhd --server maincloud --module-path spacetimedb --delete-data=never -y
fi
echo "Done. Now merge dev into main and push for the frontend."
