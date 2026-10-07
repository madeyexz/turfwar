#!/bin/bash
# One-time: mint the owner identity for the InstaCloud SpacetimeDB server and store it in its own CLI
# profile, so the Maincloud login in the default spacetime config is never touched. The identity that
# first publishes a database owns it; keep ~/.config/turfwar/ private and backed up.
#   deploy/instacloud/owner.sh <server-url>
set -euo pipefail
URL="${1:?usage: owner.sh <server-url>}"
DIR="$HOME/.config/turfwar"
CLI="$DIR/instacloud-cli.toml"
OWNER="$DIR/instacloud-owner.json"
mkdir -p "$DIR" && chmod 700 "$DIR"
if [ ! -s "$OWNER" ]; then
  curl -fsS -X POST "$URL/v1/identity" > "$OWNER"
  chmod 600 "$OWNER"
fi
TOKEN=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['token'])" "$OWNER")
spacetime --config-path "$CLI" server add instacloud --url "$URL" --default --no-fingerprint 2>/dev/null \
  || spacetime --config-path "$CLI" server edit instacloud --url "$URL" --no-fingerprint -y >/dev/null
spacetime --config-path "$CLI" login --token "$TOKEN" >/dev/null
chmod 600 "$CLI"
python3 -c "import json,sys; print('owner identity', json.load(open(sys.argv[1]))['identity'])" "$OWNER"
