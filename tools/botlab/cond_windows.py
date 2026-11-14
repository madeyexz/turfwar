"""Human aim windows split by 'fired in the window' (totals only), next to an agent's windows."""
import sys
import numpy as np
from disc import feats, load, AIM, STATE
d = np.load('/tmp/rec/out/human_windows.npz'); xh = d['x']
names = AIM + STATE
ag = None
if len(sys.argv) > 1:
    ag = np.concatenate([feats(load(f))[0] for f in sys.argv[1].split(',')])
si = names.index('shots')
def tab(x, label):
    fired = x[:, si] > 0
    print('%s: windows %d, fired share %.3f' % (label, len(x), fired.mean()))
    return fired
fh = tab(xh, 'human')
fa = tab(ag, 'agent') if ag is not None else None
q = lambda x: ' '.join('%7.3f' % v for v in np.percentile(x, [10, 50, 90])) if len(x) else ' ' * 23
print('%-16s %-24s %-24s' % ('feature', 'human fired', 'human not fired') + ('%-24s %-24s' % ('agent fired', 'agent not fired') if ag is not None else ''))
for i, k in enumerate(names):
    line = '%-16s %s | %s' % (k, q(xh[fh, i]), q(xh[~fh, i]))
    if ag is not None: line += ' | %s | %s' % (q(ag[fa, i]), q(ag[~fa, i]))
    print(line)
