#!/bin/bash
# Run SpacetimeDB on the persistent /data volume and keep the volume from filling.
#
# The server compresses sealed commitlog segments (~3x for this game) but never deletes them, and
# 100 players write ~12 GB of log an hour, so the 10 GiB volume needs pruning while the machine is
# up (an idle machine is usually suspended, not restarted). prune-commitlog.sh only runs on a
# stopped server, so this script supervises it:
#   - at boot: prune, then start;
#   - every 30 s: once the data passes PRUNE_IDLE_MB and nothing has been written for
#     IDLE_SECONDS (no room is ticking), restart the server around a prune (a few seconds; the
#     lobby reconnects by itself), once the log has grown GROWTH_MB since the last prune;
#   - past PRUNE_FORCE_MB it restarts even mid-match: a full disk would crash the server.
set -u
ROOT=/data/stdb
DATA="$ROOT/data"
PRUNE_IDLE_MB="${PRUNE_IDLE_MB:-4096}"
PRUNE_FORCE_MB="${PRUNE_FORCE_MB:-8192}"
IDLE_SECONDS="${IDLE_SECONDS:-120}"
GROWTH_MB="${GROWTH_MB:-512}"
SPID=""
AFTER_PRUNE_MB=0

log() { echo "[turfwar] $*"; }
used_mb() { du -sm "$DATA" 2>/dev/null | cut -f1; }

prune() {
  rm -f "$DATA/spacetime.pid"
  if [ -d "$DATA/replicas" ]; then
    /opt/turfwar/prune-commitlog.sh "$DATA" --apply --keep 2 || log "prune skipped (exit $?)"
  fi
  AFTER_PRUNE_MB=$(used_mb)
  log "data ${AFTER_PRUNE_MB} MB after prune"
}

start_server() {
  spacetime --root-dir="$ROOT" start --listen-addr="0.0.0.0:${PORT:-8080}" --non-interactive &
  SPID=$!
  log "server started (pid $SPID)"
}

stop_server() {
  [ -n "$SPID" ] || return 0
  kill -TERM "$SPID" 2>/dev/null
  pkill -TERM -f spacetimedb-standalone 2>/dev/null
  for _ in $(seq 1 30); do
    pgrep -f spacetimedb-standalone >/dev/null 2>&1 || kill -0 "$SPID" 2>/dev/null || break
    sleep 1
  done
  pkill -KILL -f spacetimedb-standalone 2>/dev/null
  kill -KILL "$SPID" 2>/dev/null
  wait "$SPID" 2>/dev/null
  SPID=""
  log "server stopped"
}

# Seconds since the newest commitlog write (large when nothing has been written yet).
idle_for() {
  local newest
  newest=$(ls -t "$DATA"/replicas/*/clog/*.stdb.log 2>/dev/null | head -1)
  [ -n "$newest" ] || { echo 999999; return; }
  echo $(( $(date +%s) - $(stat -c %Y "$newest") ))
}

trap 'stop_server; exit 0' TERM INT

mkdir -p "$DATA"
# Our segment size (small segments mean frequent snapshots, so pruning frees space sooner).
[ -f "$DATA/config.toml" ] || cp /opt/turfwar/config.toml "$DATA/config.toml"
prune
start_server

while true; do
  sleep 30 & wait $!
  if ! kill -0 "$SPID" 2>/dev/null; then
    wait "$SPID"; code=$?
    log "server exited ($code)"; exit "$code"
  fi
  mb=$(used_mb); idle=$(idle_for)
  # Only worth a restart once the log has grown a few segments since the last prune: each new
  # segment brings a snapshot, which is what lets older segments go.
  grown=$(( mb - AFTER_PRUNE_MB ))
  if [ "$grown" -ge "$GROWTH_MB" ] && { { [ "$mb" -ge "$PRUNE_IDLE_MB" ] && [ "$idle" -ge "$IDLE_SECONDS" ]; } || [ "$mb" -ge "$PRUNE_FORCE_MB" ]; }; then
    log "data ${mb} MB (+${grown} since the last prune), idle ${idle}s: restarting around a prune"
    stop_server
    prune
    start_server
  fi
done
