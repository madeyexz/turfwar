"""dist.py label=rowsfile[,rowsfile] ... : the graded distance of each agent's aim windows to the players' windows (26 features),
with the distance of each feature. Uses the saved human windows (/tmp/rec/out/human_windows.npz)."""
import sys
import numpy as np
from scipy.stats import wasserstein_distance
sys.path.insert(0, '/tmp/botlab')
from disc import feats, load, AIM
from metrics import aim_metrics
xh = np.load('/tmp/rec/out/human_windows.npz')['x'][:, :len(AIM)].astype(np.float64)
sd = xh.std(0) + 1e-9
res = {}
for a in sys.argv[1:]:
    label, files = a.split('=')
    rows = np.concatenate([load(f) for f in files.split(',')])
    x = feats(rows)[0]
    d = [wasserstein_distance(x[:, i], xh[:, i]) / sd[i] for i in range(len(AIM))]
    m = aim_metrics(rows, with_recoil='proto' in files)
    res[label] = (float(np.mean(d)), d, len(x), m)
labels = list(res)
print('%-18s' % 'feature' + ''.join('%-16s' % l[:15] for l in labels))
for i, f in enumerate(AIM): print('%-18s' % f + ''.join('%-16.2f' % res[l][1][i] for l in labels))
print('%-18s' % 'DISTANCE' + ''.join('%-16.3f' % res[l][0] for l in labels))
print('%-18s' % 'windows' + ''.join('%-16d' % res[l][2] for l in labels))
for k in ('shots_per_min', 'hit_rate', 'time_to_first_shot', 'shot_lateral_error_m', 'burst_shots', 'ads_share_enemy', 'still_body_share_enemy', 'turn_speed_p999'):
    def fmt(v): return ('%.3f' % v if isinstance(v, float) else '/'.join('%.2f' % u for u in v) if isinstance(v, list) else str(v))[:15]
    print('%-18s' % k[:17] + ''.join('%-16s' % fmt(res[l][3].get(k, '')) for l in labels))
