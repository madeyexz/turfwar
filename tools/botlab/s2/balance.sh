#!/bin/bash
# Lab: side balance of a bot script against itself (6v6 Elimination, MP5, skill 0.3): share of the rounds that team 0 wins, per map (2 seeds x ROUNDS).
# Usage: balance.sh v6|v5|old "map1,map2,..." [rounds=36]     (v5 = the repo script without the places table)
V=$1; MAPS=$2; R=${3:-36}
cd /tmp/botlab && s1/sync.sh
[ "$V" = v5 ] && sed -i -E 's/const places = PLACES\[ctx\.map\.id\]\?\.\[sideOf\(state, ctx\.map, bot\.team\)\];/const places = undefined as readonly number[] | undefined;/' sim/shared/match/bots.ts
name=newnew0.3; [ "$V" = old ] && name=oldold0.3
.venv/bin/python final.py $name --rounds $R --size 6 --maps $MAPS --suffix bal$V | grep side | awk -v v=$V '{ m=$2; w=$8; gsub("/", "", w); o=$9; if ($4 == 0) { t0[m]+=w; t1[m]+=o } else { t0[m]+=o; t1[m]+=w } }
  END { for (m in t0) printf "%s %s team0 %d team1 %d share %.3f\n", v, m, t0[m], t1[m], t0[m]/(t0[m]+t1[m]) }'
s1/sync.sh
