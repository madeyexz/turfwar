"""The state at each shot: shooter speed, ADS, distance, aim error against the slot-0 enemy; and the hit rate given the aim error (a check of the sim's fire model against the recorded game)."""
import sys, json
import numpy as np
from ds import *

def stats(rows, label, sight_col=False):
    e0 = rows[:, OWN:OWN + SLOT]
    sh = rows[:, A['shots']] > 0
    gun = np.isin(rows[:, A['weapon']].astype(int), [1, 2, 5, 7])       # automatic weapons
    k = sh & gun
    vis = (e0[:, E['vis']] > 0)
    n = rows[k, A['shots']].sum()
    lat = np.abs(np.sin(e0[:, E['eyaw']])) * e0[:, E['dist']]
    ver = np.tan(e0[:, E['epc']]) * e0[:, E['dist']]
    sp = rows[:, A['speed']]
    out = {'shots': int(n), 'hit_rate': float(rows[k, A['hits']].sum() / n), 'moving_share': float((sp[k] > 1.5).mean()), 'still_share': float((sp[k] < 0.5).mean()), 'ads_share': float((rows[k, A['ads']] > 0).mean()),
           'crouch_share': float((rows[k, A['crouch']] > 0.5).mean()), 'in_sight_share': float(vis[k].mean()), 'dist_med': float(np.median(e0[k & vis, E['dist']])), 'lat_med': float(np.median(lat[k & vis]))}
    print('%-10s shots %7d  hit %.3f  moving %.2f  still %.2f  ads %.2f  crouch %.2f  enemy in sight %.2f  dist med %.1f  lateral err med %.2f' % (label, n, out['hit_rate'], out['moving_share'], out['still_share'], out['ads_share'], out['crouch_share'], out['in_sight_share'], out['dist_med'], out['lat_med']))
    # hit rate by lateral error, when the vertical error is inside the body (-1.1 m .. +0.55 m from the chest)
    body = k & vis & (ver > -1.1) & (ver < 0.5)
    line = []
    out['by_lat'] = {}
    for lo, hi in ((0, 0.1), (0.1, 0.2), (0.2, 0.35), (0.35, 0.6), (0.6, 1.0), (1.0, 2.0), (2.0, 99)):
        m = body & (lat >= lo) & (lat < hi)
        s = rows[m, A['shots']].sum()
        hr = float(rows[m, A['hits']].sum() / max(1, s)); out['by_lat']['%.2f-%.2f' % (lo, hi)] = [hr, int(s)]
        line.append('%.2f-%.2f m: %.3f (%d)' % (lo, hi, hr, s))
    print('   hit rate by lateral error:', '  '.join(line))
    for name, cond in (('moving', sp > 1.5), ('still', sp < 0.5), ('ads', rows[:, A['ads']] > 0), ('hip', rows[:, A['ads']] <= 0)):
        m = k & cond; s = rows[m, A['shots']].sum()
        out['hit_' + name] = float(rows[m, A['hits']].sum() / max(1, s))
    print('   hit rate moving %.3f  still %.3f  ads %.3f  hip %.3f' % (out['hit_moving'], out['hit_still'], out['hit_ads'], out['hit_hip']))
    return out

if __name__ == '__main__':
    res = {}
    for a in sys.argv[1:]:
        name, _, label = a.partition(':')
        if name in ('haim', 'baim'): rows, _ = load_rows(name)
        else:
            x = np.fromfile(name, dtype=np.float32); rows = x[: (x.size // NA) * NA].reshape(-1, NA)
        res[label or name] = stats(rows, label or name)
    json.dump(res, open('/tmp/rec/out/shotcond.json', 'w'), indent=1)
