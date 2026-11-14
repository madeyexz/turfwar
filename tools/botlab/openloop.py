"""Open loop: the human's aim change toward the slot-0 enemy and the model's expected one, by the yaw offset, the aim key and the enemies in sight (test players)."""
import json, sys
import numpy as np
import feat, train
from ds import *

def net(prefix):
    meta = json.load(open(prefix + '.json')); a = np.fromfile(prefix + '.bin', dtype=np.float32)
    W = []; o = 0; s = meta['sizes']
    for l in range(len(s) - 1):
        w = a[o:o + s[l] * s[l + 1]].reshape(s[l + 1], s[l]); o += w.size; b = a[o:o + s[l + 1]]; o += b.size; W.append((w, b))
    def fwd(x):
        h = np.clip(x, -2, 2)
        for i, (w, b) in enumerate(W):
            h = h @ w.T + b
            if i < len(W) - 1: h = np.maximum(h, 0)
        return h
    return fwd

def softmax(z):
    z = z - z.max(1, keepdims=True); e = np.exp(z); return e / e.sum(1, keepdims=True)

if __name__ == '__main__':
    x, y, m, tracks = train.load()
    part, hrs = train.split(tracks)
    skill = train.player_skill(tracks)
    te = np.flatnonzero(np.array([part[p] == 'test' for p in m[:, 2]]))
    te = te[::2]
    X = np.asarray(x[te], dtype=np.float32); Y = y[te]
    sk = np.array([skill[int(p)] for p in m[te, 2]], dtype=np.float32)
    f = net('/tmp/rec/models/lc-h29.7-s0-64x2')
    L = f(np.concatenate([X, sk[:, None]], 1))
    c = feat.class_centres()
    py = softmax(L[:, :35]); ey_model = py @ c
    hy = c[Y[:, 0]]
    s0_in = X[:, 21] > 0; ey = X[:, 26] * np.pi          # slot 0: in sight, ey / pi
    ads = X[:, 8] > 0.5; nv = np.rint(X[:, 18] * 3).astype(int)
    sgn = np.sign(ey)
    print('samples', len(te), 'slot 0 in sight', round(float(s0_in.mean()), 3))
    print('%-16s %-10s %8s %10s %10s %10s %10s %10s' % ('|ey| bin', 'cond', 'n', 'human', 'model', 'h zero', 'm zero', 'h fire'))
    pf = 1 / (1 + np.exp(-L[:, 70]))
    for lo, hi in ((0.0, 0.03), (0.03, 0.08), (0.08, 0.15), (0.15, 0.3), (0.3, 0.6), (0.6, 1.2), (1.2, 3.2)):
        for name, cond in (('all', np.ones(len(te), bool)), ('ads', ads), ('hip', ~ads), ('1 vis', nv == 1), ('3 vis', nv >= 3)):
            k = s0_in & (np.abs(ey) >= lo) & (np.abs(ey) < hi) & cond
            if k.sum() < 200: continue
            print('%-16s %-10s %8d %10.4f %10.4f %10.3f %10.3f %10.3f' % (f'{lo}-{hi}', name, k.sum(), (hy[k] * sgn[k]).mean() * 30, (ey_model[k] * sgn[k]).mean() * 30, (Y[k, 0] == 0).mean(), py[k, 0].mean(), Y[k, 2].mean()))
