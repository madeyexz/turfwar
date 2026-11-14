#!/bin/bash
# q.sh <log> "<common args>" "<variant 1>" ... : quick.sh in the background, two variants at a time.
LOG=$1; shift; common="$1"; shift
cd /tmp/botlab/sim
printf '%s\n' "$@" | xargs -P 2 -I{} ./quick.sh "$common" "{}" >> "$LOG" 2>&1
echo DONE >> "$LOG"
