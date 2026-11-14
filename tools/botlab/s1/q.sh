#!/bin/bash
# Quick strength screen: new script (team given by side) against the old script at 0.3; prints the two teams' numbers per map and side.
# Usage: q.sh [rounds=18] [maps="taipei ochre memorial"] [skill=0.3]
R=${1:-18}; MAPS=${2:-"taipei ochre memorial"}; SK=${3:-0.3}
cd /tmp/botlab/sim
K=0; D=0
for m in $MAPS; do for side in 0 1; do
  if [ $side = 0 ]; then bs="$SK,0.3"; else bs="0.3,$SK"; fi
  out=$(timeout 50 bun run.ts --map $m --size 6 --rounds $R --seed $((300+side)) --proto none --oldteam $((1-side)) --botskill $bs --loadout mp5)
  echo "$out" | jq -r --arg s $side --arg m $m '. as $d | ("team"+$s) as $n | ("team"+(1-($s|tonumber)|tostring)) as $o | "\($m) side \($s) wins \($d[$n].wins)/\($d[$o].wins) K/D \($d[$n].kills)/\($d[$n].deaths)\n  new: hit \($d[$n].hitRate) band \($d[$n].band) first \($d[$n].first) wide \($d[$n].firstWide) ads \($d[$n].adsShots) still \($d[$n].stillShots) aware/unaware \($d[$n].killsAware)/\($d[$n].killsUnaware) ttk \($d[$n].ttk) kd \($d[$n].killDist)\n  old: hit \($d[$o].hitRate) band \($d[$o].band) first \($d[$o].first) wide \($d[$o].firstWide) ads \($d[$o].adsShots) still \($d[$o].stillShots) aware/unaware \($d[$o].killsAware)/\($d[$o].killsUnaware) ttk \($d[$o].ttk) kd \($d[$o].killDist)"'
  k=$(echo "$out" | jq -r --arg s $side '.["team"+$s].kills'); d=$(echo "$out" | jq -r --arg s $side '.["team"+$s].deaths')
  K=$((K+k)); D=$((D+d))
done; done
echo "TOTAL kills $K deaths $D share $(echo "scale=3; $K/($K+$D)" | bc)"
