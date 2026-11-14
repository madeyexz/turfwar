#!/bin/bash
# render.sh <session> <outdir> <frames> [batch] : one tick, one picture, <frames> times.
S=$1; OUT=$2; N=$3; B=${4:-50}
export AGENT_BROWSER_SESSION=$S AGENT_BROWSER_SCREENSHOT_FORMAT=jpeg AGENT_BROWSER_SCREENSHOT_QUALITY=95
mkdir -p "$OUT"
i=0
while [ $i -lt $N ]; do
  python3 -c "
import sys, json
out, i, b, n = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
cmds = []
for k in range(i, min(n, i + b)):
    cmds.append(['eval', 'window.__clipFrame()'])
    cmds.append(['screenshot', f'{out}/f{k:05d}.jpg'])
print(json.dumps(cmds))" "$OUT" $i $B $N | agent-browser batch --bail > "$OUT/batch.log" 2>&1 || { echo "batch failed at $i"; tail -3 "$OUT/batch.log"; exit 1; }
  i=$((i + B)); echo "$(date +%T) $i / $N"
done
echo DONE
