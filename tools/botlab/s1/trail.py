"""Do the players trail a moving enemy? At shots near slot 0: the sideways offset (m) against the enemy's sideways speed across the view (m/s). Totals only."""
import sys
import numpy as np
sys.path.insert(0, '/tmp/botlab')
from ds import A, E, OWN, SLOT, load_rows, wrap
from metrics import runs_of

rows, _ = load_rows('haim')
n = len(rows)
run, tc, brk = runs_of(rows)
e0 = rows[:, OWN:OWN + SLOT]
vis0 = e0[:, E['vis']] > 0
ids = e0[:, E['id']]
dist = e0[:, E['dist']].astype(np.float64)
eyaw = e0[:, E['eyaw']].astype(np.float64)
yaw = rows[:, A['yaw']].astype(np.float64)
bear = yaw + eyaw
K = 3
ok = np.zeros(n, bool)
ok[K:-K] = (run[2 * K:] == run[:-2 * K]) & (ids[2 * K:] == ids[:-2 * K]) & (ids[K:-K] == ids[2 * K:]) & vis0[2 * K:] & vis0[:-2 * K] & vis0[K:-K]
rate = np.zeros(n)
span = np.zeros(n); span[K:-K] = tc[2 * K:] - tc[:-2 * K]
rate[K:-K] = wrap(bear[2 * K:] - bear[:-2 * K]) / np.maximum(span[K:-K], 1e-3)
ok &= (span > 0.15) & (span < 0.3)
shots = rows[:, A['shots']] > 0
gun = rows[:, A['weapon']] != 0
near = np.hypot(eyaw, e0[:, E['epc']]) < 0.25
lat = np.sin(eyaw) * dist
vlat = rate * dist
P = (10, 25, 50, 75, 90)
q = lambda x: ' '.join('%7.3f' % v for v in np.percentile(x, P)) if len(x) else 'none'
print('at shots inside 0.25 rad of the enemy; sideways speed of the enemy across the view (m/s), and the slope of offset on speed (= trail time, s)')
for lo, hi in [(0, 5), (5, 8), (8, 15), (15, 30), (30, 60)]:
    m = ok & shots & gun & near & (dist >= lo) & (dist < hi)
    x, y = vlat[m], lat[m]
    slope = (x * y).sum() / (x * x).sum()
    fast = np.abs(x) > 2
    same = (np.sign(x[fast]) == np.sign(y[fast])).mean() if fast.any() else float('nan')
    print('  %3d-%3d m n %6d  |v| m/s: %s  slope %.3f s  share behind (|v|>2): %.3f (n %d)  |offset| when |v|<1: %s  when |v|>3: %s' % (lo, hi, m.sum(), q(np.abs(x)), slope, same, fast.sum(), q(np.abs(y[np.abs(x) < 1]))[8:32], q(np.abs(y[np.abs(x) > 3]))[8:32]))
