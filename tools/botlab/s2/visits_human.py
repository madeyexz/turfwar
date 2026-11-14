"""Human dwell per nav node and per place, Elimination 6v6, by map and team (= base side in Elimination). Totals only.
Writes /tmp/rec/out/visits_elim.npz-like JSON: {map: {team: {'hours':h, 'players':n, 'node': {id: seconds}, 'late': {id: seconds after 10 s}}}}"""
import json, sys, collections
import numpy as np
from ds import M, NM, load_rows, load_tracks
rows, offs = load_rows('hmove')
o = {'hmove': offs, 'bmove': [0, 0], 'haim': [0, 0], 'baim': [0, 0]}
tracks = load_tracks(offs=o)['hmove']
out = collections.defaultdict(lambda: collections.defaultdict(lambda: {'hours': 0.0, 'players': set(), 'node': collections.Counter(), 'late': collections.Counter(), 'cells': collections.defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])}))
CELL = float(sys.argv[1]) if len(sys.argv) > 1 else 6.0
for t in tracks:
    if t['mode'] != 'elimination' or t['size'] != 6: continue
    r = rows[t['start']: t['start'] + t['n']]
    if len(r) < 5: continue
    dt = np.clip(r[:, M['dt']], 0, 0.25); dt[dt <= 0] = 0.1
    c = out[t['map']][t['team']]
    c['hours'] += float(dt.sum()) / 3600; c['players'].add(t['p'])
    node = r[:, M['node']].astype(np.int64)
    clock = r[0, M['left']] - r[:, M['left']] + (120 - r[0, M['left']])  # seconds into the live round (round time 120 s)
    late = clock > 10
    for n, d, l, x, y, z in zip(node.tolist(), dt.tolist(), late.tolist(), r[:, M['x']].tolist(), r[:, M['y']].tolist(), r[:, M['z']].tolist()):
        c['node'][n] += d
        if l:
            c['late'][n] += d
            k = (int(np.floor(x / CELL)), int(np.floor(z / CELL)), int(np.floor((y + 0.5) / 3)))
            a = c['cells'][k]; a[0] += d; a[1] += d * x; a[2] += d * y; a[3] += d * z
res = {}
for mp, sides in sorted(out.items()):
    res[mp] = {}
    for team, c in sorted(sides.items()):
        cells = sorted(c['cells'].values(), key=lambda a: -a[0])
        tot = sum(a[0] for a in cells)
        res[mp][str(team)] = {'hours': round(c['hours'], 3), 'players': len(c['players']), 'node': {str(k): round(v, 2) for k, v in c['node'].items()}, 'late': {str(k): round(v, 2) for k, v in c['late'].items()},
                              'cells': [[round(a[1] / a[0], 2), round(a[2] / a[0], 2), round(a[3] / a[0], 2), round(a[0] / tot, 5)] for a in cells]}
        cum = np.cumsum([a[0] for a in cells]) / tot
        print('%-11s team %s hours %5.2f players %3d nodes %4d cells %4d  top24 share %.2f top48 %.2f  cells for 50%% %d 80%% %d' % (mp, team, c['hours'], len(c['players']), len(c['node']), len(cells), cum[min(23, len(cum) - 1)], cum[min(47, len(cum) - 1)], int(np.searchsorted(cum, 0.5)) + 1, int(np.searchsorted(cum, 0.8)) + 1))
json.dump(res, open('/tmp/rec/out/visits_elim.json', 'w'))
