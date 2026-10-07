#!/bin/bash
# Publish the game module to production: the InstaCloud server in Singapore (database `turfwar`) and,
# while it is still around, the legacy Maincloud database (`3d-game-c4lhd`). Run before pushing
# `main`, so the module and the frontend stay compatible.
#   bun run publish:prod          # both
#   bun run publish:prod -- sg    # Singapore only
#
# - It wakes the Singapore server first (it sleeps when idle), waiting up to 3 minutes.
# - Every publish uses --delete-data=never: a change that would need deleting data stops here
#   instead. Nothing in this script can reset a database.
# - The Singapore owner identity lives in ~/.config/turfwar (made once by owner.sh).
set -euo pipefail
cd "$(dirname "$0")/../.."
SG_URL="${SG_URL:-https://play.turfwar.ianhsiao.me}"
SG_FALLBACK="https://prod-main-stdb-2b7636-205bvw6d002.compute.instacloud-edge.com"
SG_CLI="$HOME/.config/turfwar/instacloud-cli.toml"
only="${1:-all}"

[ -f "$SG_CLI" ] || { echo "No Singapore owner profile ($SG_CLI). Run deploy/instacloud/owner.sh first." >&2; exit 1; }

# The custom domain until its certificate is live; the platform URL works either way.
if ! curl -fsS -o /dev/null --max-time 15 "$SG_URL/v1/ping" 2>/dev/null; then
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SG_URL/v1/ping" || true)
  if [ "$code" = "000" ]; then SG_URL="$SG_FALLBACK"; fi
fi
spacetime --config-path "$SG_CLI" server edit instacloud --url "$SG_URL" --no-fingerprint -y >/dev/null 2>&1 || true

echo "Waking the Singapore server ($SG_URL)…"
for i in $(seq 1 90); do
  if curl -fsS -o /dev/null --max-time 10 "$SG_URL/v1/ping"; then echo "  up after ~$((i * 2)) s"; break; fi
  [ "$i" = 90 ] && { echo "Singapore server did not wake in 3 minutes" >&2; exit 1; }
  sleep 2
done

echo "Publishing to Singapore (turfwar)…"
spacetime --config-path "$SG_CLI" publish turfwar --server instacloud --module-path spacetimedb --delete-data=never -y

if [ "$only" != "sg" ]; then
  echo "Publishing to Maincloud legacy (3d-game-c4lhd)…"
  spacetime publish 3d-game-c4lhd --server maincloud --module-path spacetimedb --delete-data=never -y
fi
echo "Done. Now merge dev into main and push for the frontend."
