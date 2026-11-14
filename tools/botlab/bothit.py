import json, collections
import numpy as np
from ds import *
rows, offs = load_rows('baim')
tracks = load_tracks(offs={'baim': offs, 'haim': [0, 0], 'hmove': [0, 0], 'bmove': [0, 0]})['baim']
e0 = rows[:, OWN:OWN + SLOT]
sh, hi = rows[:, A['shots']], rows[:, A['hits']]
gun = rows[:, A['weapon']] != 0
for name, m in (('target bot', e0[:, E['bot']] > 0), ('target human', (e0[:, E['bot']] == 0) & (e0[:, E['id']] >= 0)), ('no target', e0[:, E['id']] < 0)):
    mm = m & gun
    print(name, 'shots', int(sh[mm].sum()), 'hit rate', round(float(hi[mm].sum() / max(1, sh[mm].sum())), 4))
print('keys', list(tracks[0].keys()))
bymap = collections.defaultdict(lambda: [0, 0]); bysize = collections.defaultdict(lambda: [0, 0]); bymode = collections.defaultdict(lambda: [0, 0])
for t in tracks:
    s = slice(t['start'], t['start'] + t['n'])
    a, b = float(sh[s][gun[s]].sum()), float(hi[s][gun[s]].sum())
    for d, k in ((bymap, t['map']), (bysize, t['size']), (bymode, t['mode'])):
        d[k][0] += a; d[k][1] += b
for d in (bymap, bysize, bymode):
    print({k: (int(v[0]), round(v[1] / max(1, v[0]), 3)) for k, v in sorted(d.items(), key=lambda kv: -kv[1][0])})
w = rows[:, A['weapon']].astype(int)
print({WEAPONS[i]: (int(sh[w == i].sum()), round(float(hi[w == i].sum() / max(1, sh[w == i].sum())), 3)) for i in range(8)})
dist = e0[:, E['dist']]
print('dist of shots', q(dist[(sh > 0) & (e0[:, E['id']] >= 0)]))
dt = rows[:, A['dt']]
print('dt', q(dt[dt > 0], (1, 5, 25, 50, 75, 95, 99)))
