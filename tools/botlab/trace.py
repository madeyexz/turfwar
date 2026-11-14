"""Print one stretch of aim rows (a prototype engagement) tick by tick."""
import sys
import numpy as np
from ds import *
a = np.fromfile(sys.argv[1], dtype=np.float32); rows = a[: (a.size // NA) * NA].reshape(-1, NA)
start = int(sys.argv[2]) if len(sys.argv) > 2 else -1
n = int(sys.argv[3]) if len(sys.argv) > 3 else 60
e0 = rows[:, OWN:OWN + SLOT]
vis = e0[:, E['vis']] > 0
if start < 0:
    # the k-th onset of sight
    on = np.flatnonzero(vis[1:] & ~vis[:-1]) + 1
    k = -start - 1
    print('onsets', len(on)); start = int(on[k]) - 3
print('%5s %6s %4s %7s %7s %6s %7s %7s %4s %3s %3s %5s %5s %5s' % ('i', 't', 'nv', 'ey', 'epc', 'dist', 'mdyaw', 'mdpit', 'fire', 'sh', 'hit', 'speed', 'yaw', 'pitch'))
for i in range(start, min(len(rows), start + n)):
    r = rows[i]
    print('%5d %6.2f %4d %7.3f %7.3f %6.1f %7.4f %7.4f %4d %3d %3d %5.1f %5.2f %5.2f' % (i, r[A['t']], r[A['nvis']], e0[i, E['eyaw']], e0[i, E['epc']], e0[i, E['dist']], r[A['mdyaw']], r[A['mdpitch']], r[A['fire']], r[A['shots']], r[A['hits']], r[A['speed']], r[A['yaw']], r[A['pitch']]))
