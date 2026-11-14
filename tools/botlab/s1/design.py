"""Extra human totals for the Stage 1 design (aim-clean rows, mouse). Totals only."""
import sys
import numpy as np
sys.path.insert(0, '/tmp/botlab')
from ds import A, E, OWN, SLOT, AUTO, load_rows
from metrics import runs_of, onsets, windows, first_true

rows, _ = load_rows('haim')
n = len(rows)
run, tc, brk = runs_of(rows)
e0 = rows[:, OWN:OWN + SLOT]
vis0 = e0[:, E['vis']] > 0
anyvis = rows[:, A['nvis']] > 0
shots = rows[:, A['shots']]
w = rows[:, A['weapon']].astype(int)
gun = w != 0
dist = e0[:, E['dist']]
P = (10, 25, 50, 75, 90)
q = lambda x, ps=P: ' '.join('%7.3f' % v for v in np.percentile(x, ps)) if len(x) else 'none'
db = [(0, 5), (5, 8), (8, 15), (15, 30), (30, 60), (60, 200)]

print('own pitch, no enemy in sight (rad):', q(rows[~anyvis, A['pitch']]))
print('own pitch, enemy in sight (rad):   ', q(rows[anyvis, A['pitch']]))
sh = (shots > 0) & vis0 & gun
lat = np.sin(e0[:, E['eyaw']]) * dist
ver = e0[:, E['epc']] * dist
print('at shots, slot 0 in sight: n', int(sh.sum()))
for lo, hi in db:
    m = sh & (dist >= lo) & (dist < hi)
    print('  %3d-%3d m n %6d  |lateral| m: %s   |eyaw| rad: %s   vertical m (negative = above the chest): %s' % (lo, hi, m.sum(), q(np.abs(lat[m])), q(np.abs(e0[m, E['eyaw']])), q(ver[m])))
# the same for the shots where the aim is inside 0.25 rad of the enemy (shots at this enemy)
near = sh & (np.hypot(e0[:, E['eyaw']], e0[:, E['epc']]) < 0.25)
print('at shots inside 0.25 rad of slot 0: share', round(float(near.sum() / sh.sum()), 3))
for lo, hi in db:
    m = near & (dist >= lo) & (dist < hi)
    print('  %3d-%3d m n %6d  |lateral| m: %s   vertical m: %s' % (lo, hi, m.sum(), q(np.abs(lat[m])), q(ver[m])))
# while the fire key is down and the enemy is in sight: the yaw speed
dt = np.where(brk, np.nan, rows[:, A['dt']].astype(np.float64))
sp = np.abs(rows[:, A['mdyaw']]) / dt
spp = np.abs(rows[:, A['mdpitch']]) / dt
fire = rows[:, A['fire']] > 0
ok = ~brk
print('yaw speed rad/s, fire key down, enemy in sight:', q(sp[ok & fire & vis0]), ' zero share %.3f' % (sp[ok & fire & vis0] < 0.015).mean())
print('yaw speed rad/s, key up, enemy in sight:      ', q(sp[ok & ~fire & vis0]), ' zero share %.3f' % (sp[ok & ~fire & vis0] < 0.015).mean())
print('pitch speed rad/s, fire key down, in sight:   ', q(spp[ok & fire & vis0]))
print('pitch speed rad/s, key up, in sight:          ', q(spp[ok & ~fire & vis0]))
print('mouse pitch rad/s signed, fire key down:      ', q((rows[:, A['mdpitch']] / dt)[ok & fire & vis0]))
# bursts by the distance at the first shot (automatic weapons)
si = np.flatnonzero((shots > 0) & AUTO[w])
newb = np.concatenate([[True], (np.diff(tc[si]) > 0.25) | (np.diff(run[si]) != 0)])
bid = np.cumsum(newb) - 1
blen = np.bincount(bid, weights=shots[si])
first = si[newb]
for lo, hi in db:
    m = vis0[first] & (dist[first] >= lo) & (dist[first] < hi)
    print('burst shots, first shot at %3d-%3d m: n %5d  %s  mean %.1f' % (lo, hi, m.sum(), q(blen[m]), blen[m].mean() if m.any() else 0))
m = ~anyvis[first]
print('burst shots, no enemy in sight at the first shot: n %5d  %s  mean %.1f' % (m.sum(), q(blen[m]), blen[m].mean()))
# engaged time course: after an onset with an engagement, the |eyaw| in metres over time (median), for onsets at 8-30 m
on = onsets(rows, run, tc)
ix, okw = windows(on, run, n, 100)
t = tc[ix] - tc[on][:, None]
okw &= t <= 3.0
tid = e0[on, E['id']]
same = okw & (e0[ix, E['id']] == tid[:, None]) & (e0[ix, E['vis']] > 0)
k_shot = first_true((shots[ix] > 0) & okw)
d0 = e0[on, E['dist']]
latw = np.abs(np.sin(e0[ix, E['eyaw']])) * e0[ix, E['dist']]
m = (k_shot >= 0) & (d0 >= 8) & (d0 < 30)
print('onsets with a shot at 8-30 m:', int(m.sum()))
rel = np.arange(100)[None, :] - k_shot[:, None]
for a, b in ((-15, -8), (-8, -3), (-3, 0), (0, 3), (3, 8), (8, 15), (15, 30), (30, 60)):
    mm = m[:, None] & same & (rel >= a) & (rel < b)
    print('  ticks %4d..%4d from the first shot: |lateral| m %s  (n %d)' % (a, b, q(latw[mm]), mm.sum()))
# stance while the fire key is down, by distance
for lo, hi in db:
    m = ok & fire & vis0 & (dist >= lo) & (dist < hi)
    if m.sum() < 50: continue
    print('fire key down at %3d-%3d m: ads %.2f  still %.2f  strafing %.2f  crouch %.2f  forward(vf>1.5) %.2f back(vf<-1.5) %.2f' % (
        lo, hi, rows[m, A['ads']].mean(), (rows[m, A['speed']] < 0.5).mean(), (np.abs(rows[m, A['vs']]) > 1.5).mean(), (rows[m, A['crouch']] > 0.5).mean(), (rows[m, A['vf']] > 1.5).mean(), (rows[m, A['vf']] < -1.5).mean()))
m = ok & anyvis & ~fire
print('enemy in sight, key up: ads %.2f still %.2f strafing %.2f sprint-like (speed>6.2) %.2f' % (rows[m, A['ads']].mean(), (rows[m, A['speed']] < 0.5).mean(), (np.abs(rows[m, A['vs']]) > 1.5).mean(), (rows[m, A['speed']] > 6.2).mean()))
m = ok & ~anyvis
print('no enemy in sight: still %.2f strafing %.2f speed>6.2 %.2f ads %.2f' % ((rows[m, A['speed']] < 0.5).mean(), (np.abs(rows[m, A['vs']]) > 1.5).mean(), (rows[m, A['speed']] > 6.2).mean(), rows[m, A['ads']].mean()))
