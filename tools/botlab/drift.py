"""How fast the bearing of the slot-0 enemy changes without the shooter's own turn (rad/s), and the shooter's own speed, when the enemy is in sight."""
import sys
import numpy as np
from ds import *
from metrics import runs_of

def stats(rows, label):
    run = runs_of(rows)[0]
    e0 = rows[:, OWN:OWN + SLOT]
    vis = (e0[:, E['vis']] > 0) & (e0[:, E['id']] >= 0)
    same = vis[1:] & vis[:-1] & (e0[1:, E['id']] == e0[:-1, E['id']]) & (run[1:] == run[:-1])
    b = e0[:, E['eyaw']].astype(np.float64) + rows[:, A['yaw']].astype(np.float64)
    d = np.arctan2(np.sin(b[1:] - b[:-1]), np.cos(b[1:] - b[:-1]))[same] * 30
    dy = rows[1:, A['mdyaw']][same] * 30
    ey = e0[:-1, E['eyaw']][same]
    sp = rows[:-1, A['speed']][same]
    dist = e0[:-1, E['dist']][same]
    lat = np.abs(d) * dist
    q = lambda a, p: float(np.percentile(a, p))
    # the share of the offset change that the shooter's own turn removes: regress -d(ey) on turn
    print('%-10s n %8d  |drift| med %.3f p75 %.3f p90 %.3f rad/s  |turn| med %.3f p75 %.3f p90 %.3f  own speed med %.1f p75 %.1f  still<0.5 %.2f  dist med %.1f  lateral m/s med %.2f p75 %.2f  corr(turn, drift) %.2f  corr(turn, ey) %.2f' % (
        label, same.sum(), q(np.abs(d), 50), q(np.abs(d), 75), q(np.abs(d), 90), q(np.abs(dy), 50), q(np.abs(dy), 75), q(np.abs(dy), 90), q(sp, 50), q(sp, 75), (sp < 0.5).mean(), q(dist, 50), q(lat, 50), q(lat, 75),
        np.corrcoef(dy, d)[0, 1], np.corrcoef(dy, ey)[0, 1]))

if __name__ == '__main__':
    for a in sys.argv[1:]:
        name, _, label = a.partition(':')
        if name in ('haim', 'baim'):
            rows, _ = load_rows(name)
            rows = rows[: 1500000]
        else:
            x = np.fromfile(name, dtype=np.float32); rows = x[: (x.size // NA) * NA].reshape(-1, NA)
        stats(np.asarray(rows), label or name)
