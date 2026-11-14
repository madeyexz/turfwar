"""Feature shift: engaged samples of the sim prototype rows against a sample of the human training features."""
import sys
import numpy as np
from ds import *
import feat
from metrics import runs_of
names = ['w_' + w for w in WEAPONS] + ['ads', 'crouch', 'speed', 'vf', 'vs', 'grounded', 'health', 'ammo', 'empty', 'reloading', 'nvis', 'pitch', 'hurt15']
for j in range(3): names += [f's{j}_' + k for k in ('in', 'chest', 'head', 'ey.06', 'ey.4', 'ey/pi', 'ep.06', 'ep.4', 'headgap', 'logdist', 'hp')]
for L in feat.HIST: names += [f'h{L}_in', f'h{L}_ey', f'h{L}_ep']
for L in feat.VEL: names += [f'v{L}_y', f'v{L}_p']
names += ['tsv', 'tsv3', 'tsv6', 'tsv9', 'tsv12', 'tsv18', 'since']
for k in range(4): names += [f'a{k}_y.01', f'a{k}_y.1', f'a{k}_p.01', f'a{k}_p.1']
names += ['sum4_y', 'sum4_p', 'sum8_y', 'sum8_p', 'f0', 'f1', 'f2', 'firerun', 'sincefire', 'shot', 'shots15']
assert len(names) == feat.NF, len(names)
x = np.memmap('/tmp/rec/ds/feat_haim.x.f16', dtype=np.float16, mode='r').reshape(-1, feat.NF)
H = np.clip(np.asarray(x[::20], dtype=np.float32), -2, 2)
a = np.fromfile(sys.argv[1], dtype=np.float32); rows = a[: (a.size // NA) * NA].reshape(-1, NA)
f, y, valid, eng = feat.build(rows, runs_of(rows)[0])
S = np.clip(f[valid & eng], -2, 2)
print('human samples', len(H), 'sim samples', len(S), 'engaged share of sim rows', round(float(eng.mean()), 3))
mh, sh, ms, ss = H.mean(0), H.std(0) + 1e-3, S.mean(0), S.std(0)
z = (ms - mh) / sh
order = np.argsort(-np.abs(z))
print('%-12s %8s %8s %8s %8s %7s' % ('feature', 'human', 'h std', 'sim', 's std', 'z'))
for i in order[:45]: print('%-12s %8.3f %8.3f %8.3f %8.3f %7.2f' % (names[i], mh[i], sh[i], ms[i], ss[i], z[i]))
# action marginals in the sim (what the model did) against the human targets
yh = np.fromfile('/tmp/rec/ds/feat_haim.y.i16', dtype=np.int16).reshape(-1, 3)[::20]
ys = y[valid & eng]
print('zero yaw class share human %.3f sim %.3f; fire share human %.3f sim %.3f' % ((yh[:, 0] == 0).mean(), (ys[:, 0] == 0).mean(), yh[:, 2].mean(), ys[:, 2].mean()))
c = feat.class_centres()
print('mean |dyaw| human %.4f sim %.4f' % (np.abs(c[yh[:, 0]]).mean(), np.abs(c[ys[:, 0]]).mean()))
