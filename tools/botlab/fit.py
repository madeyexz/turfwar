"""Power-law fits of the open-loop learning curves: nll(h) = a + b * h^(-c). Extrapolation to more hours with a bootstrap over seeds/points.
Usage: python fit.py  (reads /tmp/rec/out/train.jsonl, writes /tmp/rec/out/fit.json)"""
import json, collections
import numpy as np
from scipy.optimize import curve_fit

rows = [json.loads(l) for l in open('/tmp/rec/out/train.jsonl')]
TARGETS = [40, 115, 200, 1000]


def f(h, a, b, c): return a + b * np.power(h, -c)


def fit(h, v, label):
    h = np.asarray(h, float); v = np.asarray(v, float)
    best = None
    for c0 in (0.2, 0.5, 1.0):
        try:
            p, _ = curve_fit(f, h, v, p0=(v.min() - 0.02, v.max() - v.min(), c0), bounds=([0, 0, 0.02], [v.min(), 10, 3]), maxfev=20000)
            sse = float(((f(h, *p) - v) ** 2).sum())
            if best is None or sse < best[1]: best = (p, sse)
        except Exception as e: pass
    p, sse = best
    # bootstrap: resample the points with replacement
    rng = np.random.default_rng(0); boots = []
    for _ in range(400):
        i = rng.integers(0, len(h), len(h))
        if len(set(np.round(h[i], 1))) < 4: continue
        try:
            q, _ = curve_fit(f, h[i], v[i], p0=p, bounds=([0, 0, 0.02], [v.min(), 10, 3]), maxfev=20000)
            boots.append([q[0]] + [float(f(t, *q)) for t in TARGETS])
        except Exception: pass
    boots = np.array(boots)
    lo, hi = np.percentile(boots, [5, 95], axis=0)
    r = {'label': label, 'a': float(p[0]), 'b': float(p[1]), 'c': float(p[2]), 'rmse': float(np.sqrt(sse / len(h))), 'points': len(h),
         'asymptote_90': [float(lo[0]), float(hi[0])], 'pred': {str(t): {'value': float(f(t, *p)), 'lo': float(lo[k + 1]), 'hi': float(hi[k + 1])} for k, t in enumerate(TARGETS)}}
    # leave out the largest size and predict it (a check of the extrapolation one doubling ahead)
    big = h >= h.max() - 0.5
    try:
        q, _ = curve_fit(f, h[~big], v[~big], p0=p, bounds=([0, 0, 0.02], [v[~big].min(), 10, 3]), maxfev=20000)
        r['holdout_largest'] = {'predicted': float(f(h[big].mean(), *q)), 'actual': float(v[big].mean())}
    except Exception: pass
    return r


out = {}
for exp, keys in (('lc', ('nll', 'nll_yaw', 'nll_pitch', 'nll_fire')), ('ocnoh', ('nll', 'nll_yaw', 'nll_pitch', 'nll_fire'))):
    rs = [r for r in rows if r['exp'] == exp and r['hidden'] == 64 and r['layers'] == 2]
    if len({round(r['hours'], 1) for r in rs}) < 4: continue
    for key in keys:
        out[f'{exp}.{key}'] = fit([r['hours'] for r in rs], [r['test'][key] for r in rs], f'{exp} {key}')
    # press AUC as 1 - auc
    out[f'{exp}.press_err'] = fit([r['hours'] for r in rs], [1 - r['test']['press_auc'] for r in rs], f'{exp} 1 - press AUC')
    pts = collections.defaultdict(list)
    for r in rs: pts[round(r['hours'], 1)].append(r['test']['nll'])
    out[f'{exp}.points'] = {str(k): {'mean': float(np.mean(v)), 'sd': float(np.std(v, ddof=1)) if len(v) > 1 else 0.0, 'n': len(v), 'values': v} for k, v in sorted(pts.items())}
out['prior_nll'] = rows[0]['prior']['nll']
json.dump(out, open('/tmp/rec/out/fit.json', 'w'), indent=1)
for k, r in out.items():
    if isinstance(r, dict) and 'a' in r:
        print('%-18s a %.4f [%.4f, %.4f]  b %.4f  c %.3f  rmse %.4f | ' % (k, r['a'], *r['asymptote_90'], r['b'], r['c'], r['rmse']) + '  '.join(f"{t}h {r['pred'][str(t)]['value']:.4f} [{r['pred'][str(t)]['lo']:.4f},{r['pred'][str(t)]['hi']:.4f}]" for t in TARGETS) + f"  holdout {r.get('holdout_largest')}")
