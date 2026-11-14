#!/bin/bash
# One weapon for all: the new script (one team) against the old script at 0.3, on each map and side. Prints kill share and hit rates.
# Usage: wq.sh WEAPON [rounds=18] [maps="taipei ochre"] [skill=0.3] [extra run.ts arguments]
W=$1; R=${2:-18}; MAPS=${3:-"taipei ochre"}; SK=${4:-0.3}; EXTRA=$5
cd /tmp/botlab/sim
K=0; D=0; NS=0; NH=0; OS=0; OH=0; WN=0; WO=0
for m in $MAPS; do for side in 0 1; do
  if [ $side = 0 ]; then bs="$SK,0.3"; else bs="0.3,$SK"; fi
  lo=""; [ "$W" != "all" ] && lo="--loadout $W"
  out=$(timeout 50 bun run.ts --map $m --size 6 --rounds $R --seed $((${SEEDBASE:-300}+side)) --proto none --oldteam $((1-side)) --botskill $bs $lo $EXTRA | tail -1)
  n="team$side"; o="team$((1-side))"
  read k d ns nh os oh wn wo <<<$(echo "$out" | jq -r --arg n $n --arg o $o '[.[$n].kills, .[$n].deaths, .[$n].shots, .[$n].hits, .[$o].shots, .[$o].hits, .[$n].wins, .[$o].wins] | @tsv')
  K=$((K+k)); D=$((D+d)); NS=$((NS+ns)); NH=$((NH+nh)); OS=$((OS+os)); OH=$((OH+oh)); WN=$((WN+wn)); WO=$((WO+wo))
done; done
echo "$W skill $SK: share $(echo "scale=3; $K/($K+$D)" | bc) (K $K D $D) wins $WN/$WO | hit new $(echo "scale=3; $NH/$NS" | bc) ($NS shots) old $(echo "scale=3; $OH/$OS" | bc) ($OS shots)"
