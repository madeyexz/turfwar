"""Per-feature comparison of an agent's aim windows with the human windows: p10/p50/p90 and the distance (W1 / human SD).
Usage: python featcmp.py label=f1,f2 [label2=...]"""
import sys
import numpy as np
from scipy.stats import wasserstein_distance
from disc import feats, load, AIM, STATE
d = np.load('/tmp/rec/out/human_windows.npz'); xh = d['x']
sd = xh.std(0) + 1e-9
names = AIM + STATE
agents = {}
for a in sys.argv[1:]:
    label, files = a.split('=')
    agents[label] = np.concatenate([feats(load(f))[0] for f in files.split(',')])
q = lambda x: ' '.join('%7.3f' % v for v in np.percentile(x, [10, 50, 90]))
print('%-16s %-25s' % ('feature', 'human p10 p50 p90') + ''.join('| %-34s' % (l[:20] + ' (n=%d)' % len(x)) for l, x in agents.items()))
tot = {l: [] for l in agents}
for i, k in enumerate(names):
    line = '%-16s %s  ' % (k, q(xh[:, i]))
    for l, x in agents.items():
        w = wasserstein_distance(x[:, i], xh[:, i]) / sd[i]
        if i < len(AIM): tot[l].append(w)
        line += '| %s  d=%5.2f ' % (q(x[:, i]), w)
    print(line)
print('distance (26 aim features): ' + '  '.join('%s %.3f' % (l, np.mean(v)) for l, v in tot.items()))
