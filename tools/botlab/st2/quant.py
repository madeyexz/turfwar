"""quant.py <model>: what the test loss of a model is with its weights as 8-bit and 16-bit numbers (one scale per layer; biases stay float32)."""
import json, sys
import numpy as np
sys.path.insert(0, '/tmp/botlab')
import feat
name = sys.argv[1]; P = '/tmp/rec/models/' + name
meta = json.load(open(P + '.json')); sizes = meta['sizes']
raw = np.fromfile(P + '.bin', dtype=np.float32)
W, B, o = [], [], 0
for a, b in zip(sizes[:-1], sizes[1:]):
    W.append(raw[o:o + a * b].reshape(b, a)); o += a * b; B.append(raw[o:o + b]); o += b
x = np.memmap('/tmp/rec/ds/feat_haim.x.f16', dtype=np.float16, mode='r').reshape(-1, feat.NF)
y = np.fromfile('/tmp/rec/ds/feat_haim.y.i16', dtype=np.int16).reshape(-1, 3).astype(np.int64)
idx = np.sort(np.random.default_rng(0).choice(len(x), 200000, replace=False))
xb = np.empty((len(idx), sizes[0]), dtype=np.float32); xb[:, :feat.NF] = x[idx]; xb[:, feat.NF] = 2; np.clip(xb, -2, 2, out=xb)
def fwd(W):
    h = xb
    for l, (w, b) in enumerate(zip(W, B)):
        h = h @ w.T + b
        if l + 1 < len(W): h = np.maximum(h, 0)
    return h
def nll(out):
    def ce(lg, t): lg = lg - lg.max(1, keepdims=True); return -(lg[np.arange(len(t)), t] - np.log(np.exp(lg).sum(1))).mean()
    f = out[:, 2 * feat.NC]; yf = y[idx, 2]
    return ce(out[:, :feat.NC], y[idx, 0]), ce(out[:, feat.NC:2 * feat.NC], y[idx, 1]), float(np.mean(np.log1p(np.exp(-np.where(yf > 0, f, -f)))))
ref = fwd(W); print('float32', [round(float(v), 4) for v in nll(ref)], 'max |w| per layer', [round(float(np.abs(w).max()), 2) for w in W])
for bits in (8, 16):
    q = 2 ** (bits - 1) - 1
    Wq = [np.round(w / (np.abs(w).max() / q)) * (np.abs(w).max() / q) for w in W]
    out = fwd([w.astype(np.float32) for w in Wq])
    print('int%d' % bits, [round(float(v), 4) for v in nll(out)], 'largest change of a logit %.4f, mean %.5f' % (np.abs(out - ref).max(), np.abs(out - ref).mean()))
