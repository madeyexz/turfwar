#!/bin/bash
# quick.sh "<common args>" "<variant args 1>" "<variant args 2>" ... : one line per variant
cd /tmp/botlab/sim
common="$1"; shift
for v in "$@"; do
  bun run.ts $common $v 2>&1 | python3 -c "
import sys, json
v = sys.argv[1]
for l in sys.stdin:
    try: d = json.loads(l)
    except Exception: print(l[:300]); continue
    p = d['proto']; a, b = (d['team0'], d['team1'])
    pt, bt = (a, b) if p in ('0', 'both', 'none') else (b, a)
    print('%-46s rounds %3d  P wins %3d  K/D %4d/%4d  hit %.3f vs %.3f  dmg %6d vs %6d  shots/min %5.1f vs %5.1f  ttk %s vs %s  %ss' % (v, d['rounds'], pt['wins'], pt['kills'], pt['deaths'], pt['hitRate'], bt['hitRate'], pt['damage'], bt['damage'], pt['shots'] / max(1e-9, pt['aliveHours'] * 60), bt['shots'] / max(1e-9, bt['aliveHours'] * 60), pt['ttk'][1], bt['ttk'][1], d['wallSeconds']))
" "$v"
done
