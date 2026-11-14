"""Human fire habits by distance (aim-clean, mouse, automatic weapons): burst length, ADS, body still, strafe, lateral and vertical error at shots. Totals only."""
import numpy as np
from ds import A, E, OWN, SLOT, AUTO, load_rows
from metrics import runs_of
rows, _ = load_rows('haim')
run, tc, brk = runs_of(rows)
e0 = rows[:, OWN:OWN + SLOT]
w = rows[:, A['weapon']].astype(int)
shots = rows[:, A['shots']]
vis = e0[:, E['vis']] > 0
d = e0[:, E['dist']]
k = (shots > 0) & AUTO[w] & vis
lat = np.abs(np.sin(e0[:, E['eyaw']])) * d
ver = e0[:, E['epc']] * d
q = lambda x, ps=(25, 50, 75): ' '.join('%6.2f' % v for v in np.percentile(x, ps)) if len(x) else ''
print('dist      shots  hit   ads  still strafe  lateral m p25 p50 p75   vertical m p25 p50 p75   lateral rad p50  enemy-in-sight ADS / still share')
for lo, hi in ((0, 5), (5, 8), (8, 15), (15, 30), (30, 60), (60, 200)):
    m = k & (d >= lo) & (d < hi); v = vis & (d >= lo) & (d < hi)
    print('%3d-%3d %7d %.3f %.2f  %.2f  %.2f   %s      %s      %.4f    %.2f / %.2f' % (lo, hi, shots[m].sum(), rows[m, A['hits']].sum() / shots[m].sum(), rows[m, A['ads']].mean(), (rows[m, A['speed']] < 0.5).mean(), (np.abs(rows[m, A['vs']]) > 1.5).mean(), q(lat[m]), q(ver[m]), np.median(np.abs(e0[m, E['eyaw']])), rows[v, A['ads']].mean(), (rows[v, A['speed']] < 0.5).mean()))
# bursts by the distance at the first shot
si = np.flatnonzero((shots > 0) & AUTO[w])
newb = np.concatenate([[True], (np.diff(tc[si]) > 0.25) | (np.diff(run[si]) != 0)])
bid = np.cumsum(newb) - 1
blen = np.bincount(bid, weights=shots[si])
first = si[newb]
print('burst shots by distance at its first shot (p25 p50 p75 p90, mean, n); -1 = no enemy in the slots')
dd = np.where(e0[first, E['id']] >= 0, d[first], -1); vv = vis[first]
for lo, hi in ((-2, 0), (0, 5), (5, 8), (8, 15), (15, 30), (30, 60), (60, 200)):
    m = (dd >= lo) & (dd < hi)
    print('%3d-%3d  %s  mean %.1f  n %d  in sight at first shot %.2f' % (lo, hi, q(blen[m], (25, 50, 75, 90)), blen[m].mean(), m.sum(), vv[m].mean()))
# the error at the first shot of a burst against the later shots
ordn = np.zeros(len(si), int); c = 0
for i in range(len(si)):
    c = 0 if newb[i] else c + 1; ordn[i] = c
for a, b in ((0, 1), (1, 3), (3, 6), (6, 12), (12, 99)):
    m = (ordn >= a) & (ordn < b) & vis[si]
    j = si[m]
    print('shot rows %2d-%2d of a burst: lateral p50 %.2f  vertical p25 p50 p75 %s  hit %.3f' % (a, b, np.median(lat[j]), q(ver[j]), rows[j, A['hits']].sum() / shots[j].sum()))
# target speed across the line of sight is not in the rows; own strafe instead
for nm, m in (('own strafe > 1.5', k & (np.abs(rows[:, A['vs']]) > 1.5)), ('own still', k & (rows[:, A['speed']] < 0.5))):
    print('%-18s lateral p50 %.2f hit %.3f' % (nm, np.median(lat[m]), rows[m, A['hits']].sum() / shots[m].sum()))
