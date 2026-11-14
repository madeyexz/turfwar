"""Calibration of the render delay and own-pose lag: lateral miss (m) between the crosshair and the nearest visible enemy at rows with a hit."""
import sys, numpy as np
NA = 50
for tag in sys.argv[1:]:
    a = np.fromfile(f'/tmp/rec/ds/haim-{tag}.f32', dtype=np.float32).reshape(-1, NA)
    e = a[:, 26:34]
    hit = (a[:, 8] > 0) & (e[:, 6] > 0) & (a[:, 10] != 3) & (a[:, 10] != 0)
    lat = np.abs(e[hit, 3]) * e[hit, 2]
    mv = hit & (a[:, 13] > 3)
    latm = np.abs(e[mv, 3]) * e[mv, 2]
    sh = (a[:, 7] > 0) & (e[:, 6] > 0)
    print(tag, 'hits', int(hit.sum()), 'lateral m p25/p50/p75/p90', np.round(np.percentile(lat, [25, 50, 75, 90]), 3).tolist(), '| self moving', int(mv.sum()), np.round(np.percentile(latm, [25, 50, 75, 90]), 3).tolist(), '| share within 0.3 m', round(float((lat < 0.3).mean()), 3), 'hits/shots', int(a[:, 8].sum()), int(a[:, 7].sum()))
