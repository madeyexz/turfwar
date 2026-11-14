import json, sys, time
import numpy as np
from ds import *
from metrics import aim_metrics, move_metrics
t0 = time.time()
rows, tracks = load_all()
res = {}
res['human_aim'] = aim_metrics(rows['haim'])
res['recbot_aim'] = aim_metrics(rows['baim'], with_recoil=False)
# humans by input for movement
hm = rows['hmove']; T = tracks['hmove']
sel = {'mouse': np.zeros(len(hm), bool), 'touch': np.zeros(len(hm), bool)}
for t in T: sel[t['input'] if t['input'] in sel else 'touch'][t['start']:t['start'] + t['n']] = True
res['human_move_mouse'] = move_metrics(hm[sel['mouse']])
res['human_move_touch'] = move_metrics(hm[sel['touch']])
res['recbot_move'] = move_metrics(rows['bmove'])
json.dump(res, open('/tmp/rec/out/metrics_recorded.json', 'w'), indent=1)
keys = sorted(set(res['human_aim']) | set(res['recbot_aim']))
print('AIM  %-34s %-44s %s' % ('', 'human', 'recorded bot'))
for k in keys: print('  %-34s %-44s %s' % (k, res['human_aim'].get(k), res['recbot_aim'].get(k)))
keys = sorted(res['human_move_mouse'])
print('MOVE %-28s %-40s %-40s %s' % ('', 'mouse', 'touch', 'recorded bot'))
for k in keys: print('  %-28s %-40s %-40s %s' % (k, res['human_move_mouse'].get(k), res['human_move_touch'].get(k), res['recbot_move'].get(k)))
print('seconds', round(time.time() - t0, 1))
