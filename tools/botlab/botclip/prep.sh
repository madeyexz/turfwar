#!/bin/bash
# prep.sh <session> <seed> <startTick> <directorFile> : a fresh page, the bot-only seeded match, then <startTick> ticks without a picture.
set -e
S=$1; SEED=$2; START=$3; DIRECTOR=$4
HERE=$(cd "$(dirname "$0")" && pwd)
export AGENT_BROWSER_SESSION=$S
URL="http://localhost:31417/?mode=offline&autostart=1&size=squad&map=taipei&game=elimination&name=Amp&capture&debuginput&lang=en&quality=medium&skill=0.45${EXTRA:-}"
agent-browser open "$URL" >/dev/null 2>&1
agent-browser set viewport 1280 720 1 >/dev/null 2>&1
for i in $(seq 1 30); do r=$(agent-browser eval "!!(window.__lb && window.__lb.game)" 2>/dev/null | tail -1); [ "$r" = "true" ] && break; sleep 1; done
[ "$r" = "true" ] || { echo "no game"; exit 1; }
sed "s/__SEED__/$SEED/" "$HERE/setup.js" | agent-browser eval --stdin 2>&1 | tail -1 | cut -c1-80
agent-browser eval --stdin < "$HERE/clock.js" 2>&1 | tail -1
agent-browser eval --stdin < "$DIRECTOR" 2>&1 | tail -1
left=$START
while [ $left -gt 0 ]; do n=$(( left > 1500 ? 1500 : left )); sed "s/__N__/$n/" "$HERE/dry.js" | agent-browser eval --stdin 2>&1 | tail -1 | cut -c1-110; left=$(( left - n )); done
