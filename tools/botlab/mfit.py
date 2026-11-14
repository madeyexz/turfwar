"""Fits of the movement learning curve (mvnh: no own-motion inputs, all inputs train, test on held-out mouse and touch players).
Two forms: a power law with an asymptote, nll = a + b * h^-c, and a line in log(hours), nll = a - k * log4(h).
Also: how many mouse hours the touch hours are worth for the mouse test.
Usage: python mfit.py   (reads /tmp/rec/out/mtrain.jsonl, writes /tmp/rec/out/mfit.json)"""
import json
import numpy as np
from scipy.optimize import curve_fit

rows = [json.loads(l) for l in open('/tmp/rec/out/mtrain.jsonl')]
TARGETS = [40, 82, 115, 200, 1000]
f = lambda h, a, b, c: a + b * np.power(h, -c)


def pts(exp, key, sub='nll', drop_capped=True):
    out = {}
    for r in rows:
        if r['exp'] not in exp or r['hidden'] != 64 or r['layers'] != 2: continue
        k = (round(r['hours'], 1), r['seed'])
        # the same seed and size can be in two experiments: keep the run with more steps allowed (the lower value)
        v = r[key][sub]
        if k not in out or v < out[k]: out[k] = v
    return np.array([k[0] for k in out]), np.array(list(out.values()))


def fits(h, v):
    r = {}
    # line in log4(hours)
    A = np.stack([np.ones_like(h), -np.log(h) / np.log(4)], 1)
    (a, k), res, *_ = np.linalg.lstsq(A, v, rcond=None)
    r['loglin'] = {'a': float(a), 'per_4x': float(k), 'rmse': float(np.sqrt(((A @ [a, k] - v) ** 2).mean())), 'pred': {str(t): float(a - k * np.log(t) / np.log(4)) for t in TARGETS}}
    best = None
    for c0 in (0.1, 0.3, 0.6, 1.0):
        try:
            p, _ = curve_fit(f, h, v, p0=(v.min() - 0.1, v.max() - v.min(), c0), bounds=([0, 0, 0.02], [v.min(), 10, 3]), maxfev=40000)
            sse = float(((f(h, *p) - v) ** 2).sum())
            if best is None or sse < best[1]: best = (p, sse)
        except Exception: pass
    p, sse = best
    rng = np.random.default_rng(0); boots = []
    for _ in range(400):
        i = rng.integers(0, len(h), len(h))
        if len(set(np.round(h[i], 0))) < 4: continue
        try:
            q, _ = curve_fit(f, h[i], v[i], p0=p, bounds=([0, 0, 0.02], [v.min(), 10, 3]), maxfev=40000)
            boots.append([q[0]] + [float(f(t, *q)) for t in TARGETS])
        except Exception: pass
    boots = np.array(boots); lo, hi = np.percentile(boots, [5, 95], axis=0)
    r['power'] = {'a': float(p[0]), 'b': float(p[1]), 'c': float(p[2]), 'rmse': float(np.sqrt(sse / len(h))), 'asymptote_90': [float(lo[0]), float(hi[0])],
                  'pred': {str(t): {'value': float(f(t, *p)), 'lo': float(lo[k + 1]), 'hi': float(hi[k + 1])} for k, t in enumerate(TARGETS)}}
    # check: fit without the largest size, predict it
    big = h >= h.max() - 0.5
    A2 = A[~big]; (a2, k2), *_ = np.linalg.lstsq(A2, v[~big], rcond=None)
    q, _ = curve_fit(f, h[~big], v[~big], p0=p, bounds=([0, 0, 0.02], [v[~big].min(), 10, 3]), maxfev=40000)
    r['holdout_largest'] = {'hours': float(h[big].mean()), 'actual': float(v[big].mean()), 'loglin': float(a2 - k2 * np.log(h[big].mean()) / np.log(4)), 'power': float(f(h[big].mean(), *q))}
    return r


out = {'prior': rows[0]['prior'], 'split': rows[0]['split']}
for test in ('mouse', 'touch'):
    for sub in ('nll', 'nll_dir', 'nll_turn', 'nll_flags'):
        h, v = pts(('mvnh', 'mvnh-long'), test, sub)
        o = np.argsort(h); h, v = h[o], v[o]
        out[f'mvnh.{test}.{sub}'] = {'hours': h.tolist(), 'values': v.tolist(), **fits(h, v)}
# other measures by hours (mean over seeds)
tab = {}
for r in rows:
    if r['exp'] in ('mvnh', 'mvnh-long') and r['hidden'] == 64:
        k = round(r['hours'])
        tab.setdefault(k, []).append(r)
out['mvnh.by_hours'] = {str(k): {'n': len(v), 'mouse_nll': float(np.mean([min(x['mouse']['nll'] for x in v if x['seed'] == s) for s in {x['seed'] for x in v}])),
                                   'touch_nll': float(np.mean([min(x['touch']['nll'] for x in v if x['seed'] == s) for s in {x['seed'] for x in v}])),
                                   'mouse_new_top1': float(np.mean([x['mouse']['dir_new_top1'] for x in v])), 'mouse_change_auc': float(np.mean([x['mouse']['dir_change_auc'] for x in v])),
                                   'mouse_dir_top1': float(np.mean([x['mouse']['dir_top1'] for x in v])), 'touch_new_top1': float(np.mean([x['touch']['dir_new_top1'] for x in v]))} for k, v in sorted(tab.items())}
# the worth of touch hours for the mouse test: mouse-only curve (line in log hours through its points), solve for the all-inputs value at the same step limit
mh, mv = pts(('mvnh-mouse',), 'mouse'); o = np.argsort(mh); mh, mv = mh[o], mv[o]
allv = [r for r in rows if r['exp'] == 'mvnh' and r['seed'] == 0 and r['hours'] > 80][0]
k = (mv[-2] - mv[-1]) / (np.log(mh[-1] / mh[-2]) / np.log(4))   # the slope of the last two mouse-only points
need = mv[-1] - allv['mouse']['nll']
equiv = mh[-1] * 4 ** (need / k)
touch_h = allv['hours'] - mh[-1]
out['touch_worth'] = {'mouse_only_hours': mh.tolist(), 'mouse_only_nll': mv.tolist(), 'all_hours': allv['hours'], 'all_mouse_nll': allv['mouse']['nll'], 'mouse_only_slope_per_4x': float(k),
                      'mouse_hours_equivalent': float(equiv), 'touch_hours_added': float(touch_h), 'one_touch_hour_in_mouse_hours': float((equiv - mh[-1]) / touch_h)}
for name in ('mvnh-touch', 'mvnh-nopos', 'mvnh-big', 'mv'):
    out[name] = [{'hours': r['hours'], 'hidden': r['hidden'], 'layers': r['layers'], 'mouse_nll': r['mouse']['nll'], 'touch_nll': r['touch']['nll'], 'mouse_new_top1': r['mouse']['dir_new_top1'], 'mouse_change_auc': r['mouse']['dir_change_auc'], 'mouse_dir_top1': r['mouse']['dir_top1']} for r in rows if r['exp'] == name]
out['copy_baseline'] = {'mouse_dir_copy_acc': rows[0]['mouse']['dir_copy_acc'], 'mouse_dir_change_share': rows[0]['mouse']['dir_change_share'], 'touch_dir_copy_acc': rows[0]['touch']['dir_copy_acc']}
json.dump(out, open('/tmp/rec/out/mfit.json', 'w'), indent=1)
for key in ('mvnh.mouse.nll', 'mvnh.touch.nll', 'mvnh.mouse.nll_dir'):
    r = out[key]
    print(key, 'points', list(zip(r['hours'], [round(x, 4) for x in r['values']])))
    print('  loglin: a %.4f, %.4f per 4x, rmse %.4f | ' % (r['loglin']['a'], r['loglin']['per_4x'], r['loglin']['rmse']) + '  '.join(f"{t}h {r['loglin']['pred'][str(t)]:.3f}" for t in TARGETS))
    p = r['power']
    print('  power:  a %.4f [%.3f, %.3f] b %.4f c %.3f rmse %.4f | ' % (p['a'], *p['asymptote_90'], p['b'], p['c'], p['rmse']) + '  '.join(f"{t}h {p['pred'][str(t)]['value']:.3f} [{p['pred'][str(t)]['lo']:.3f},{p['pred'][str(t)]['hi']:.3f}]" for t in TARGETS))
    print('  holdout largest', r['holdout_largest'])
print('by hours', json.dumps(out['mvnh.by_hours'], indent=0)[:1500])
print('touch worth', out['touch_worth'])
