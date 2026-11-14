"""Closed loop: the prototype's aim change toward the slot-0 enemy in the sim, by yaw offset, and which inputs change it (ablations on the sim features)."""
import json, sys
import numpy as np
import feat
from ds import *
from metrics import runs_of
from openloop import net, softmax

def table(X, act, f, label, skill=0.0, edit=None):
    X = X.copy()
    if edit: edit(X)
    L = f(np.concatenate([X, np.full((len(X), 1), skill, np.float32)], 1))
    c = feat.class_centres()
    py = softmax(L[:, :35]); m = py @ c
    s0 = X[:, 21] > 0; ey = X[:, 26] * np.pi; sgn = np.sign(ey)
    out = []
    for lo, hi in ((0.0, 0.03), (0.03, 0.08), (0.08, 0.15), (0.15, 0.3), (0.3, 0.6), (0.6, 1.2)):
        k = s0 & (np.abs(ey) >= lo) & (np.abs(ey) < hi)
        if k.sum() < 50: out.append('      -'); continue
        out.append('%7.3f' % ((m[k] * sgn[k]).mean() * 30))
    print('%-34s' % label, ' '.join(out))
    return m

if __name__ == '__main__':
    path = sys.argv[1]
    a = np.fromfile(path, dtype=np.float32); rows = a[: (a.size // NA) * NA].reshape(-1, NA)
    X, y, valid, eng = feat.build(rows, runs_of(rows)[0])
    k = valid & eng
    X = np.clip(X[k], -2, 2); y = y[k]
    f = net('/tmp/rec/models/' + (sys.argv[2] if len(sys.argv) > 2 else 'lc-h29.7-s0-64x2'))
    c = feat.class_centres()
    s0 = X[:, 21] > 0; ey = X[:, 26] * np.pi; sgn = np.sign(ey)
    print('samples', len(X), 'slot 0 in sight', round(float(s0.mean()), 3))
    print('%-34s' % 'rad/s toward slot 0, |ey| bin:', '  0-.03 .03-.08 .08-.15 .15-.3  .3-.6  .6-1.2')
    out = []
    for lo, hi in ((0.0, 0.03), (0.03, 0.08), (0.08, 0.15), (0.15, 0.3), (0.3, 0.6), (0.6, 1.2)):
        kk = s0 & (np.abs(ey) >= lo) & (np.abs(ey) < hi)
        out.append('%7.3f' % ((c[y[kk, 0]] * sgn[kk]).mean() * 30) if kk.sum() >= 50 else '      -')
    print('%-34s' % 'action taken in the sim', ' '.join(out), ' n', [int((s0 & (np.abs(ey) >= lo) & (np.abs(ey) < hi)).sum()) for lo, hi in ((0.0, 0.03), (0.03, 0.08), (0.08, 0.15), (0.15, 0.3), (0.3, 0.6), (0.6, 1.2))])
    table(X, y, f, 'model mean on the sim features')
    def z(cols, v=0.0):
        def e(X): X[:, cols] = v
        return e
    table(X, y, f, 'ads = 1', edit=z([8], 1.0))
    table(X, y, f, 'speed, vf, vs = 0', edit=z([10, 11, 12]))
    table(X, y, f, 'vs = 0', edit=z([12]))
    table(X, y, f, 'vf = 0.5, vs = 0, speed = .5', edit=lambda X: (X.__setitem__((slice(None), 10), 0.5), X.__setitem__((slice(None), 11), 0.5), X.__setitem__((slice(None), 12), 0.0)))
    table(X, y, f, 'slots 1, 2 empty, nvis 1/3', edit=lambda X: (X.__setitem__((slice(None), slice(32, 54)), 0.0), X.__setitem__((slice(None), 18), np.minimum(X[:, 18], 1 / 3))))
    table(X, y, f, 'own aim history = 0', edit=z(list(range(91, 111))))
    table(X, y, f, 'fire history = 0', edit=z(list(range(111, 118))))
    table(X, y, f, 'slot-0 history = now', edit=None)
    table(X, y, f, 'hurt15 = 0', edit=z([20]))
    table(X, y, f, 'health = 1', edit=z([14], 1.0))
    table(X, y, f, 'pitch = 0', edit=z([19]))
    for s in (-1, 1, 2): table(X, y, f, 'skill %d' % s, skill=float(s))
