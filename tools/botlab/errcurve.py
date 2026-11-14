"""Aim error against the first enemy in sight as a function of the time since first sight (on-screen onsets with a first offset of 0.12-0.8 rad)."""
import json, sys
import numpy as np
from ds import *
from metrics import runs_of, onsets, windows

def curve(rows, W=75):
    run, tc, brk = runs_of(rows)
    on = onsets(rows, run, tc)
    n = len(rows)
    ix, ok = windows(on, run, n, W)
    e0 = rows[:, OWN:OWN + SLOT]
    tid = e0[on, E['id']]
    ey0, ep0, d0 = e0[on, E['eyaw']], e0[on, E['epc']], e0[on, E['dist']]
    off0 = np.hypot(ey0, ep0)
    sel = (np.abs(ey0) < 0.75) & (np.abs(ep0) < 0.45) & (off0 > 0.12) & (off0 < 0.8) & (rows[on, A['weapon']] != 0)
    same = ok & (e0[ix, E['id']] == tid[:, None]) & (e0[ix, E['vis']] > 0)
    err = np.hypot(e0[ix, E['eyaw']], e0[ix, E['epc']])
    lat = np.abs(np.sin(e0[ix, E['eyaw']])) * e0[ix, E['dist']]
    fire = rows[ix, A['fire']] > 0
    out = {'n': int(sel.sum()), 't': [], 'err_med': [], 'err_p25': [], 'err_p75': [], 'lat_med': [], 'visible_share': [], 'fire_share': [], 'rel_med': []}
    for k in range(0, W, 3):
        m = sel & same[:, k]
        if m.sum() < 30: break
        out['t'].append(round(k / 30, 3)); out['err_med'].append(round(float(np.median(err[m, k])), 4)); out['err_p25'].append(round(float(np.percentile(err[m, k], 25)), 4)); out['err_p75'].append(round(float(np.percentile(err[m, k], 75)), 4))
        out['lat_med'].append(round(float(np.median(lat[m, k])), 3)); out['visible_share'].append(round(float(m.sum() / max(1, sel.sum())), 3)); out['fire_share'].append(round(float(fire[m, k].mean()), 3))
        out['rel_med'].append(round(float(np.median(err[m, k] / off0[m])), 3))
    return out

if __name__ == '__main__':
    res = {}
    for a in sys.argv[1:]:
        name, _, label = a.partition(':')
        if name in ('haim', 'baim'):
            rows, _ = load_rows(name)
        else:
            x = np.fromfile(name, dtype=np.float32); rows = x[: (x.size // NA) * NA].reshape(-1, NA)
        res[label or name] = c = curve(rows)
        print(label or name, 'n', c['n'])
        for key in ('t', 'err_med', 'rel_med', 'lat_med', 'visible_share', 'fire_share'):
            print('  %-14s' % key, ' '.join('%6.3f' % v for v in c[key][:25]))
    json.dump(res, open('/tmp/rec/out/errcurve.json', 'w'))
