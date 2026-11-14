#!/bin/bash
# clips.sh <session> <seed> <outroot> <start1> <frames1> [<start2> <frames2> ...] : the seeded bot match once, each clip a run of pictures.
S=$1; SEED=$2; ROOT=$3; shift 3
HERE=$(cd "$(dirname "$0")" && pwd)
export AGENT_BROWSER_SESSION=$S
skip() { left=$1; while [ $left -gt 0 ]; do n=$(( left > 1500 ? 1500 : left )); sed "s/__N__/$n/" "$HERE/dry.js" | agent-browser eval --stdin 2>&1 | tail -1 | cut -c1-110; left=$(( left - n )); done; }
tick() { agent-browser eval "window.__lb.game.link.state().tick" 2>/dev/null | tail -1; }
echo "$(date +%T) prep"; "$HERE/prep.sh" "$S" "$SEED" 0 "${DIRECTOR:-$HERE/director-all.js}" || exit 1
echo "$(date +%T) quality"; agent-browser eval --stdin < "$HERE/quality.js" 2>&1 | tail -1
for i in $(seq 1 60); do t=$(tick); [[ "$t" =~ ^[0-9]+$ ]] && break; sleep 5; done
echo "$(date +%T) page answers, tick $t"
k=0
while [ $# -ge 2 ]; do
  START=$1; N=$2; shift 2; k=$((k + 1))
  now=$(tick); echo "$(date +%T) clip $k: skip $now -> $START"; skip $(( START - now ))
  echo "$(date +%T) clip $k: render $N frames from tick $(tick)"
  "$HERE/render.sh" "$S" "$ROOT/c$k" "$N" 50 || exit 1
done
agent-browser eval "JSON.stringify(window.__clipLog.filter(e => e.type === 'kill').map(e => [e.tick, e.killer, e.victim, e.weapon]))" 2>/dev/null | tail -1 > "$ROOT/kills.json"
echo "$(date +%T) ALL DONE, tick $(tick)"
