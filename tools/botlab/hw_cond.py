"""Human windows by fire: medians (p10 p50 p90) of each feature for windows with and without shots, and by shots bins."""
import numpy as np
from disc import AIM, STATE
d = np.load('/tmp/rec/out/human_windows.npz'); x = d['x']
names = AIM + STATE
sh = x[:, names.index('shots')]
groups = {'shots=0': sh == 0, '1-5': (sh >= 1) & (sh <= 5), '6-15': (sh >= 6) & (sh <= 15), '16+': sh >= 16}
print('n', len(x), {k: int(v.sum()) for k, v in groups.items()})
q = lambda v: ' '.join('%7.3f' % t for t in np.percentile(v, [10, 50, 90]))
print('%-16s ' % 'feature' + ' | '.join('%-23s' % k for k in groups))
for i, k in enumerate(names):
    print('%-16s ' % k + ' | '.join(q(x[m, i]) for m in groups.values()))
