#!/bin/bash
# v.sh <name> <map> <seed> <extra args...> : one run with the learned aim on team 0 against the new script bots, rows to /tmp/rec/st2/rows/<name>; one result line.
name=$1; map=$2; seed=$3; shift 3
cd /tmp/botlab/sim
bun run.ts --map $map --size 6 --rounds 36 --seed $seed --loadout mp5 --proto 0 --oldteam none --tag $name --rows /tmp/rec/st2/rows/$name-$map "$@" 2>&1 | python3 -c "
import sys, json
for l in sys.stdin:
    try: d = json.loads(l)
    except Exception: print(l[:300]); continue
    a, b = d['team0'], d['team1']
    print('%-22s %-9s wins %2d/%2d K/D %3d/%3d share %.3f hit %.3f vs %.3f shots/min %5.1f vs %5.1f' % (sys.argv[1], d['map'], a['wins'], b['wins'], a['kills'], a['deaths'], a['kills'] / max(1, a['kills'] + b['kills']), a['hitRate'], b['hitRate'], a['shots'] / max(1e-9, a['aliveHours'] * 60), b['shots'] / max(1e-9, b['aliveHours'] * 60)))
" $name
