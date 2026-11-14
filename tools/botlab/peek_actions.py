import numpy as np
from ds import *
ha, _ = load_rows('haim')
dt = ha[:, A['dt']]
ok = dt > 0
for name in ('mdyaw', 'mdpitch'):
    x = ha[ok, A[name]].astype(np.float64)
    ax = np.abs(x)
    print(name, 'zero share', float((ax < 1e-6).mean()), 'nonzero quantiles', np.round(np.percentile(ax[ax >= 1e-6], [1, 5, 10, 25, 50, 75, 90, 95, 99, 99.9, 99.99]), 5).tolist(), 'max', float(ax.max()), 'mean signed', float(x.mean()))
    # mass by magnitude decade
    edges = [1e-6, 1e-4, 3e-4, 1e-3, 2e-3, 4e-3, 8e-3, 0.016, 0.032, 0.064, 0.128, 0.256, 0.512, 10]
    h = np.histogram(ax, edges)[0] / len(ax)
    print('  mass', np.round(h, 4).tolist())
    vals, cnt = np.unique(np.round(ax[(ax > 0) & (ax < 0.01)], 5), return_counts=True)
    top = np.argsort(-cnt)[:12]
    print('  most common small values', [(float(vals[i]), int(cnt[i])) for i in sorted(top)])
print('dt values', np.unique(np.round(dt[ok], 4), return_counts=True))
print('nframes', np.unique(ha[:, A['nframes']], return_counts=True))
