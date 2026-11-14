#!/bin/bash
# Lab-only ablation: sync the repo bots, apply sed expressions to the lab copy, run the quick screen. Usage: abl.sh label rounds "maps" 'sed-expr' ...
label=$1; R=$2; MAPS=$3; shift 3
/tmp/botlab/s1/sync.sh
for e in "$@"; do sed -i -E "$e" /tmp/botlab/sim/shared/match/bots.ts; done
out=$(/tmp/botlab/s1/q.sh $R "$MAPS")
echo "$label: $(echo "$out" | grep -E 'side' | awk '{printf "%s%s %s | ", $1, $3, $7}') $(echo "$out" | grep TOTAL)"
echo "$out" | grep -E '^  new' | sed -E 's/first.*aware/aware/' | cut -c1-150
/tmp/botlab/s1/sync.sh
