"""How often a human engages an enemy that comes into sight, by distance and by the first angle from the crosshair (aim-clean, mouse).
Engaged = a shot inside 3 s, or the aim inside max(0.03 rad, 0.35 m / distance) of the chest inside 3 s. Totals only."""
import sys
import numpy as np
from ds import A, E, OWN, SLOT, load_rows
from metrics import runs_of, onsets, windows, first_true
kind = sys.argv[1] if len(sys.argv) > 1 else 'haim'
if kind.endswith('.f32'):
    from disc import load
    rows = np.concatenate([load(f) for f in kind.split(',')])
else:
    rows, _ = load_rows(kind)
n = len(rows)
run, tc, brk = runs_of(rows)
e0 = rows[:, OWN:OWN + SLOT]
shots = rows[:, A['shots']]
on = onsets(rows, run, tc)
ix, okw = windows(on, run, n, 100)
t = tc[ix] - tc[on][:, None]
okw &= t <= 3.0
tid = e0[on, E['id']]
same = okw & (e0[ix, E['id']] == tid[:, None])
ey0, ep0, d0 = e0[on, E['eyaw']], e0[on, E['epc']], e0[on, E['dist']]
off0 = np.hypot(ey0, ep0)
visw = e0[ix, E['vis']] > 0
err = np.hypot(e0[ix, E['eyaw']], e0[ix, E['epc']])
tol = np.maximum(0.03, 0.35 / np.maximum(d0, 1.0))
k_on = first_true(same & visw & (err < tol[:, None]))
k_shot = first_true((shots[ix] > 0) & okw)
# shot counts as at this target only when the aim is inside 0.25 rad of it at the shot
near = err[np.arange(len(on)), np.maximum(k_shot, 0)] < 0.25
shot = (k_shot >= 0) & near
eng = shot | (k_on >= 0)
vis_time = (visw & same).sum(1) / 30
print(kind, 'onsets', len(on))
db = [(0, 8), (8, 15), (15, 30), (30, 60), (60, 200)]
ob = [(0, 0.12), (0.12, 0.3), (0.3, 0.75), (0.75, 1.6), (1.6, 3.2)]
print('share engaged (n); rows = distance m, columns = first angle rad ' + '  '.join('%g-%g' % o for o in ob))
for lo, hi in db:
    line = '%3d-%3d m ' % (lo, hi)
    for a, b in ob:
        m = (d0 >= lo) & (d0 < hi) & (off0 >= a) & (off0 < b)
        line += '  %.2f/%.2f (%5d)' % (eng[m].mean() if m.any() else 0, shot[m].mean() if m.any() else 0, m.sum())
    print(line)
print('median seconds in sight inside 3 s, by distance:', [round(float(np.median(vis_time[(d0 >= lo) & (d0 < hi)])), 2) for lo, hi in db])
print('share of onsets by distance:', [round(float(((d0 >= lo) & (d0 < hi)).mean()), 3) for lo, hi in db])
# time to the shot for the engaged ones, by angle
for a, b in ob[:4]:
    m = shot & (off0 >= a) & (off0 < b)
    tt = t[np.arange(len(on)), np.maximum(k_shot, 0)][m]
    print('first shot time, angle %g-%g: p25 %.2f p50 %.2f p75 %.2f (n %d)' % (a, b, *np.percentile(tt, [25, 50, 75]), m.sum()))
