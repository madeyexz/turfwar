#!/usr/bin/env bash
# Local SpacetimeDB for development and previews: starts the standalone server and
# (re)publishes the Lawbreaker module. Match data here is disposable development state.
set -euo pipefail
cd "$(dirname "$0")/.."
SPACETIME="${SPACETIME:-$(command -v spacetime || echo "$HOME/.local/bin/spacetime")}"
PORT="${PORT:-3000}"
DATABASE="${STDB_DATABASE:-turfwar}"
"$SPACETIME" start --listen-addr "127.0.0.1:$PORT" --non-interactive &
server=$!
trap 'kill "$server" 2>/dev/null || true' EXIT
for _ in $(seq 1 120); do curl -sf "http://127.0.0.1:$PORT/v1/ping" >/dev/null && break; sleep 0.5; done
"$SPACETIME" publish "$DATABASE" --module-path spacetimedb --server "http://127.0.0.1:$PORT" --delete-data=on-conflict --yes
echo "SpacetimeDB ready: database $DATABASE on 127.0.0.1:$PORT"
wait "$server"
