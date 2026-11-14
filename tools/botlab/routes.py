"""Where humans and recorded bots spend live time on each map (nav-node visit shares), and how many hours make that picture stable.

Per (map, team): the visit share over the nav nodes for humans (two disjoint player halves) and for the recorded bots.
JSD(human half A, human half B) is the noise floor; JSD(humans, bots) is the route gap. A learning curve gives the held-out
log-likelihood of human positions under the visit map estimated from k hours of other players (add-one smoothing)."""
import json, sys, collections
import numpy as np
from ds import M, NM, load_rows, load_tracks

rows = {}; offs = {}
for k in ('hmove', 'bmove'):
    rows[k], offs[k] = load_rows(k)
for k in ('haim', 'baim'): offs[k] = [0, 0]
tracks = load_tracks(offs=offs)
node = {k: rows[k][:, M['node']].astype(np.int32) for k in rows}
dt = {k: np.clip(rows[k][:, M['dt']], 0, 0.25) for k in rows}
for k in rows: dt[k][dt[k] <= 0] = 0.1  # the first row of a run counts as one step


def jsd(p, q):
    m = (p + q) / 2
    def kl(a, b):
        nz = a > 0
        return float((a[nz] * np.log2(a[nz] / b[nz])).sum())
    return (kl(p, m) + kl(q, m)) / 2


cells = collections.defaultdict(lambda: {'h': collections.defaultdict(list), 'b': []})
for t in tracks['hmove']: cells[(t['map'], t['team'])]['h'][t['p']].append(t)
for t in tracks['bmove']: cells[(t['map'], t['team'])]['b'].append(t)


def hist(ts, kind, nn):
    h = np.zeros(nn)
    for t in ts:
        s = slice(t['start'], t['start'] + t['n'])
        np.add.at(h, node[kind][s], dt[kind][s])
    return h


out = {'cells': [], 'curve': {}}
rng = np.random.default_rng(0)
curve_h = [0.125, 0.25, 0.5, 1, 2, 4, 8]
curve = collections.defaultdict(list)
for (mp, team), c in sorted(cells.items()):
    nn = int(max(max((node['hmove'][t['start']:t['start'] + t['n']].max() for ts in c['h'].values() for t in ts), default=0),
                 max((node['bmove'][t['start']:t['start'] + t['n']].max() for t in c['b']), default=0))) + 1
    per = {p: hist(ts, 'hmove', nn) for p, ts in c['h'].items()}
    hours = {p: v.sum() / 3600 for p, v in per.items()}
    tot_h = sum(hours.values())
    if tot_h < 1.5 or not c['b']: continue
    # two halves with about the same hours: players in order of hours, alternating
    order = sorted(per, key=lambda p: -hours[p])
    A = sum((per[p] for p in order[0::2]), np.zeros(nn)); B = sum((per[p] for p in order[1::2]), np.zeros(nn))
    H = A + B
    Bt = hist(c['b'], 'bmove', nn)
    # bots split in two halves by track for their own floor
    bi = rng.permutation(len(c['b']))
    B1 = hist([c['b'][i] for i in bi[0::2]], 'bmove', nn); B2 = hist([c['b'][i] for i in bi[1::2]], 'bmove', nn)
    n = lambda v: v / v.sum()
    # nodes that hold 90% of the time
    def n90(v):
        s = np.sort(n(v))[::-1]; return int(np.searchsorted(np.cumsum(s), 0.9) + 1)
    overlap = float(np.minimum(n(H), n(Bt)).sum())
    r = {'map': mp, 'team': team, 'nodes': nn, 'human_hours': round(tot_h, 2), 'players': len(per), 'bot_hours': round(Bt.sum() / 3600, 2), 'halves_hours': [round(A.sum() / 3600, 2), round(B.sum() / 3600, 2)],
         'jsd_human_halves': round(jsd(n(A), n(B)), 4), 'jsd_bot_halves': round(jsd(n(B1), n(B2)), 4), 'jsd_human_bot': round(jsd(n(H), n(Bt)), 4),
         'jsd_halfA_bot': round(jsd(n(A), n(Bt)), 4), 'jsd_halfB_bot': round(jsd(n(B), n(Bt)), 4), 'overlap_human_bot': round(overlap, 3), 'overlap_human_halves': round(float(np.minimum(n(A), n(B)).sum()), 3),
         'nodes90_human': n90(H), 'nodes90_bot': n90(Bt)}
    out['cells'].append(r)
    # learning curve: test = half B (as a distribution), train = k hours of half-A players (random order of players, whole players until k hours)
    pa = order[0::2]
    for k in curve_h:
        if A.sum() / 3600 < k: continue
        for rep in range(6):
            perm = rng.permutation(len(pa)); acc = np.zeros(nn); got = 0.0
            for i in perm:
                v = per[pa[i]]; need = k * 3600 - got
                if v.sum() <= need: acc += v; got += v.sum()
                else: acc += v * (need / v.sum()); got += need
                if got >= k * 3600 - 1e-6: break
            q = (acc / 0.1 + 1.0); q /= q.sum()   # add-one smoothing on 0.1 s steps
            ce = float(-(n(B) * np.log2(q)).sum())  # bits per step on the held-out half
            curve[k].append((ce, float(-(n(B)[n(B) > 0] * np.log2(n(B)[n(B) > 0])).sum()), np.log2(nn), jsd(n(acc), n(B)), (mp, team)))
for k in curve_h:
    v = curve[k]
    if not v: continue
    out['curve'][str(k)] = {'cells': len({x[4] for x in v}), 'cross_entropy_bits': round(float(np.mean([x[0] for x in v])), 4), 'test_entropy_bits': round(float(np.mean([x[1] for x in v])), 4), 'uniform_bits': round(float(np.mean([x[2] for x in v])), 4), 'jsd_to_test': round(float(np.mean([x[3] for x in v])), 4)}
# the same cells at every k (cells with 8 h or more in half A are rare): the curve over the cells that reach 2 h
keep = {x[4] for x in curve[2]}
out['curve_same_cells'] = {str(k): {'cells': len(keep), 'cross_entropy_bits': round(float(np.mean([x[0] for x in curve[k] if x[4] in keep])), 4), 'jsd_to_test': round(float(np.mean([x[3] for x in curve[k] if x[4] in keep])), 4)} for k in curve_h if k <= 2}
w = np.array([r['human_hours'] for r in out['cells']])
for key in ('jsd_human_halves', 'jsd_bot_halves', 'jsd_human_bot', 'overlap_human_bot', 'overlap_human_halves'):
    out['mean_' + key] = round(float(np.average([r[key] for r in out['cells']], weights=w)), 4)
json.dump(out, open('/tmp/rec/out/routes.json', 'w'), indent=1)
print('%-10s %1s %5s %6s %4s %6s  %-8s %-8s %-8s %-7s %-7s %s' % ('map', 't', 'nodes', 'humanH', 'pl', 'botH', 'jsd h|h', 'jsd b|b', 'jsd h|b', 'ovl h|b', 'ovl h|h', 'n90 h/b'))
for r in out['cells']:
    print('%-10s %d %5d %6.2f %4d %6.2f  %.4f   %.4f   %.4f   %.3f   %.3f   %d/%d' % (r['map'], r['team'], r['nodes'], r['human_hours'], r['players'], r['bot_hours'], r['jsd_human_halves'], r['jsd_bot_halves'], r['jsd_human_bot'], r['overlap_human_bot'], r['overlap_human_halves'], r['nodes90_human'], r['nodes90_bot']))
print({k: v for k, v in out.items() if k.startswith('mean_')})
print('curve', json.dumps(out['curve'], indent=0))
print('same cells', json.dumps(out['curve_same_cells']))
