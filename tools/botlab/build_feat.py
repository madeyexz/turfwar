import json, sys, time
import numpy as np
from ds import *
import feat
t0 = time.time()
ha, offs = load_rows('haim')
tracks = load_tracks(offs={'haim': offs, 'baim': [0, 0], 'hmove': [0, 0], 'bmove': [0, 0]})['haim']
json.dump(tracks, open('/tmp/rec/ds/feat_haim.tracks.json', 'w'))
n = feat.build_file(ha, tracks, '/tmp/rec/ds/feat_haim')
print('samples', n, 'of', len(ha), 'seconds', round(time.time() - t0, 1))
y = np.fromfile('/tmp/rec/ds/feat_haim.y.i16', dtype=np.int16).reshape(-1, 3)
print('yaw class share', np.round(np.bincount(y[:, 0], minlength=feat.NC) / len(y), 4).tolist())
print('pitch class share', np.round(np.bincount(y[:, 1], minlength=feat.NC) / len(y), 4).tolist())
print('fire share', float(y[:, 2].mean()))
x = np.memmap('/tmp/rec/ds/feat_haim.x.f16', dtype=np.float16, mode='r').reshape(-1, feat.NF)
s = np.asarray(x[::50], dtype=np.float32)
print('feature mean', np.round(s.mean(0), 2).tolist())
print('feature absmax', np.round(np.abs(s).max(0), 2).tolist(), 'nan', int(np.isnan(s).sum()))
