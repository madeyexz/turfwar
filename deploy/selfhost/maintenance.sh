#!/usr/bin/env bash
# Nightly maintenance, run as root by spacetimedb-maintenance.timer: wait (up to two hours) until no
# human is in a room, stop SpacetimeDB, prune its commitlog, and start it again. Rooms and career
# stats are durable, so a restart costs only the few seconds it is down.
set -eo pipefail
ROOT="${STDB_ROOT:-/stdb}"
DATABASE="${STDB_DATABASE:-lawbreaker}"
LIB="$(cd "$(dirname "$0")" && pwd)"

humans() {
  sudo -u spacetimedb "$ROOT/spacetime" --root-dir="$ROOT" sql --anonymous --server http://127.0.0.1:3000 \
    "$DATABASE" "SELECT humans FROM match" 2>/dev/null | awk '$1 ~ /^[0-9]+$/ { n += $1 } END { print n + 0 }'
}

for _ in $(seq 1 24); do
  [ "$(humans)" = 0 ] && break
  sleep 300
done

echo "before: $(du -sh "$ROOT/data" | cut -f1)"
systemctl stop spacetimedb
trap 'systemctl start spacetimedb' EXIT
sudo -u spacetimedb "$LIB/prune-commitlog.sh" "$ROOT/data" --apply
echo "after: $(du -sh "$ROOT/data" | cut -f1)"
