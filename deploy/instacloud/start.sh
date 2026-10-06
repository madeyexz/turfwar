#!/bin/sh
# Start SpacetimeDB on the persistent /data volume. Each (cold) start first drops the commitlog
# segments and snapshots a restore no longer needs, so the volume does not fill: the server
# compresses old segments but never deletes them (see prune-commitlog.sh).
set -e
ROOT=/data/stdb
DATA="$ROOT/data"
mkdir -p "$DATA"
# Our segment size (small segments mean frequent snapshots, so pruning frees space sooner).
[ -f "$DATA/config.toml" ] || cp /opt/turfwar/config.toml "$DATA/config.toml"
# Nothing else runs in this container, so a pid file left by a stopped machine is stale.
rm -f "$DATA/spacetime.pid"
if [ -d "$DATA/replicas" ]; then
  /opt/turfwar/prune-commitlog.sh "$DATA" --apply --keep 2 || echo "prune skipped (exit $?)"
fi
du -sh "$DATA" 2>/dev/null || true
exec spacetime --root-dir="$ROOT" start --listen-addr="0.0.0.0:${PORT:-8080}" --non-interactive
