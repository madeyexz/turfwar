"""Smoothness of the aim path in 3 s engaged windows (the disc.py features) of row files. Usage: smooth.py label=file ..."""
import sys, numpy as np
from disc import feats, load, AIM, STATE
K = ['autocorr_yaw', 'flip_rate', 'rough', 'zero_yaw', 'p90_yaw', 'max_yaw', 'fire_share', 'shots', 'on_target', 'med_off', 'fire_off_target', 'hold_on_target', 'follow', 'crossings', 'path_ratio']
print('%-34s %6s ' % ('', 'n') + ' '.join('%8s' % k[:8] for k in K))
print('%-34s %6s ' % ('human (taipei, mp5)', '2203') + ' '.join('%8.3f' % v for v in [0.731, 0.0, 0.711, 0.367, -1.252, -0.669, 0.144, 4, 0.075, -0.749, 0.0, 0.111, 0.025, 0.043, 0.424]))
for a in sys.argv[1:]:
    label, f = a.split('=')
    x = feats(load(f))[0]
    print('%-34s %6d ' % (label[:34], len(x)) + ' '.join('%8.3f' % float(np.median(x[:, (AIM + STATE).index(k)])) for k in K))
