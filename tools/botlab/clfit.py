"""Closed-loop learning curve: kill share of the prototype aim (outcome input, no own-aim history, skill 1, ADS rule) against the
reference bots (skill 0.3), by the hours of aim-clean data that trained it. 3 maps x 2 sides x 36 rounds per point and seed.
Fit: ks(h) = K - b * h^-c, bootstrap over the map-side cells (the same cells for all sizes).
Usage: python clfit.py   (reads /tmp/rec/out/sim.jsonl, writes /tmp/rec/out/clfit.json)"""
import json, collections
import numpy as np
from scipy.optimize import curve_fit

cells = collections.defaultdict(dict)   # (hours, seed) -> {(map, side): (kills, deaths, wins, losses, shots, hits)}
for line in open('/tmp/rec/out/sim.jsonl'):
    d = json.loads(line)
    tag = d.get('tag', '')
    if '@' not in tag or d['size'] != 6: continue
    name, side = tag.rsplit('@', 1); side = int(side)
    if name == 'both1+ads' and d['seed'] < 200: key = (29.7, 0)
    elif name.startswith('lc') and name.endswith('@1'):
        h, s = name[2:-2].split('s'); key = (float(h), int(s))
    else: continue
    T, O = d[f'team{side}'], d[f'team{1 - side}']
    cells[key][(d['map'], side)] = (T['kills'], O['kills'], T['wins'], O['wins'], T['shots'], T['hits'])
CELLS = sorted({c for v in cells.values() for c in v})
keys = sorted(cells)
assert all(len(cells[k]) == len(CELLS) for k in keys), {k: len(v) for k, v in cells.items()}
K = np.array([[cells[k][c][0] for c in CELLS] for k in keys], float); D = np.array([[cells[k][c][1] for c in CELLS] for k in keys], float)
W = np.array([[cells[k][c][2] for c in CELLS] for k in keys], float); L = np.array([[cells[k][c][3] for c in CELLS] for k in keys], float)
H = np.array([k[0] for k in keys])
TARGETS = [40, 115, 200, 1000]
f = lambda h, a, b, c: a - b * np.power(h, -c)


def fit(h, v):
    best = None
    for c0 in (0.3, 0.7, 1.2):
        try:
            p, _ = curve_fit(f, h, v, p0=(v.max() + 0.02, v.max() - v.min(), c0), bounds=([v.max() - 0.05, 0, 0.05], [1, 5, 3]), maxfev=20000)
            sse = float(((f(h, *p) - v) ** 2).sum())
            if best is None or sse < best[1]: best = (p, sse)
        except Exception: pass
    return best


ks = K.sum(1) / (K.sum(1) + D.sum(1)); ws = W.sum(1) / (W.sum(1) + L.sum(1))
p, sse = fit(H, ks)
rng = np.random.default_rng(0); boots = []
for _ in range(1000):
    i = rng.integers(0, len(CELLS), len(CELLS))
    v = K[:, i].sum(1) / (K[:, i].sum(1) + D[:, i].sum(1))
    r = fit(H, v)
    if r: boots.append([r[0][0]] + [float(f(t, *r[0])) for t in TARGETS])
boots = np.array(boots); lo, hi = np.percentile(boots, [5, 95], axis=0)
out = {'cells': [f'{m}@{s}' for m, s in CELLS], 'points': [{'hours': k[0], 'seed': k[1], 'kill_share': float(a), 'round_share': float(b), 'cell_kill_share': (K[j] / (K[j] + D[j])).round(3).tolist()} for j, (k, a, b) in enumerate(zip(keys, ks, ws))],
       'fit': {'K': float(p[0]), 'b': float(p[1]), 'c': float(p[2]), 'rmse': float(np.sqrt(sse / len(H))), 'K_90': [float(lo[0]), float(hi[0])],
               'pred': {str(t): {'value': float(f(t, *p)), 'lo': float(lo[k + 1]), 'hi': float(hi[k + 1])} for k, t in enumerate(TARGETS)}}}
# paired differences between sizes (per cell kill share, mean of the two seeds)
by_h = {}
for j, k in enumerate(keys): by_h.setdefault(k[0], []).append(K[j] / (K[j] + D[j]))
by_h = {h: np.mean(v, 0) for h, v in by_h.items()}
hs = sorted(by_h)
out['paired_gain'] = {f'{a}->{b}': {'mean': float((by_h[b] - by_h[a]).mean()), 'se': float((by_h[b] - by_h[a]).std(ddof=1) / np.sqrt(len(CELLS)))} for a, b in zip(hs[:-1], hs[1:])}
out['by_hours'] = {str(h): {'kill_share_mean_of_cells': float(v.mean()), 'cells': v.round(3).tolist()} for h, v in by_h.items()}
json.dump(out, open('/tmp/rec/out/clfit.json', 'w'), indent=1)
for q in out['points']: print('h %5.1f seed %d  kill share %.3f  round share %.3f  cells %s' % (q['hours'], q['seed'], q['kill_share'], q['round_share'], q['cell_kill_share']))
print('cells', out['cells'])
print('fit', json.dumps(out['fit']))
print('paired', json.dumps(out['paired_gain']))
