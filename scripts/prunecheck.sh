#!/usr/bin/env bash
# Local check of deploy/selfhost/prune-commitlog.sh against a real server: run a busy Online load,
# stop the server, prune its commitlog, restart, and expect identical career stats, a database that
# still ticks, and the log back under its prune floor. Twice, so a second prune of an already
# pruned log is covered too. Uses a scratch data dir with 8 MiB segments (a snapshot per segment).
#
#   scripts/prunecheck.sh [clients=100] [seconds=60]     (PORT=3100 by default; local only)
set -euo pipefail
cd "$(dirname "$0")/.."
CLIENTS="${1:-100}"; SECONDS_LOAD="${2:-60}"; PORT="${PORT:-3100}"; DB=prunecheck
SPACETIME="${SPACETIME:-$(command -v spacetime || echo "$HOME/.local/bin/spacetime")}"
URL="http://127.0.0.1:$PORT"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/prunecheck.XXXXXX")"
data="$scratch/data"; mkdir -p "$data"
printf '[commitlog]\nmax-segment-size = 8388608\n' > "$data/config.toml"
server=""

fail() { echo "FAIL: $*" >&2; exit 1; }
start() {
  "$SPACETIME" start --listen-addr "127.0.0.1:$PORT" --data-dir "$data" --non-interactive >> "$scratch/server.log" 2>&1 &
  server=$!
  for _ in $(seq 1 120); do curl -sf "$URL/v1/ping" >/dev/null && return; sleep 0.5; done
  fail "server did not start (see $scratch/server.log)"
}
stop() { kill -INT "$server"; wait "$server" 2>/dev/null || true; server=""; }
cleanup() { [ -n "$server" ] && kill -INT "$server" 2>/dev/null; wait 2>/dev/null; rm -rf "$scratch"; }
trap cleanup EXIT

stats() { "$SPACETIME" sql --server "$URL" "$DB" "SELECT * FROM profile" | sort | shasum | cut -c1-12; }
segments() { ls "$data"/replicas/*/clog/*.stdb.log | wc -l | tr -d ' '; }
mb() { du -sm "$data/replicas" | cut -f1; }
load() {
  bun scripts/loadtest.ts --uri "ws://127.0.0.1:$PORT" --db "$DB" --clients "$1" --procs 4 --seconds "$2" --size 6 > "$scratch/load.json"
  grep -E '"(joined|rooms|serverTicksPerSecond|kBytesPerClientPerSecond|corrections)"' "$scratch/load.json" | tr -d ' ,\n'; echo
}

start
"$SPACETIME" publish "$DB" --module-path spacetimedb --server "$URL" --delete-data=on-conflict --yes > /dev/null
for round in 1 2; do
  echo "round $round: $CLIENTS clients for ${SECONDS_LOAD}s"
  load "$CLIENTS" "$SECONDS_LOAD"
  before=$(stats); stop
  had=$(segments)
  echo "  stopped: $had segments, $(mb) MB, stats $before"
  deploy/selfhost/prune-commitlog.sh "$data" --apply
  echo "  pruned:  $(segments) segments, $(mb) MB"
  [ "$(segments)" -ge 1 ] || fail "prune left no log segments"
  [ "$had" -le 3 ] || [ "$(segments)" -lt "$had" ] || fail "prune removed no segments out of $had"
  started=$(date +%s); start
  after=$(stats)
  echo "  restarted in $(( $(date +%s) - started ))s, stats $after"
  [ "$before" = "$after" ] || fail "career stats changed across prune and restart"
  load 12 15 | grep -qE '"serverTicksPerSecond":(2[5-9]|3[0-9])' || fail "database did not tick after restart"
  echo "  ticks again after restart"
done
if grep -qiE 'NoConnectedSnapshot|panicked' "$scratch/server.log"; then fail "server log has restore errors"; fi
echo "prunecheck passed"
