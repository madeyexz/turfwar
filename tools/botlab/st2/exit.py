import json, sys, glob, subprocess
import numpy as np
name = sys.argv[1]; O = '/tmp/rec/st2/exit/'
runs = [json.loads(l) for l in open(O + name + '.jsonl')]
share, wins, rounds, bymap = [], 0, 0, {}
for d in runs:
    side = int(d['tag'].split('@')[1]); T, E = d[f'team{side}'], d[f'team{1 - side}']
    s = T['kills'] / max(1, T['kills'] + E['kills']); share.append(s); wins += T['wins']; rounds += d['rounds']
    bymap.setdefault(d['map'], []).append(s)
share = np.array(share)
print('%-14s runs %d kill share %.3f +- %.3f  rounds won %d/%d (%.3f)  %s' % (name, len(runs), share.mean(), share.std(ddof=1) / np.sqrt(len(share)), wins, rounds, wins / rounds, ' '.join('%s %.3f' % (m, np.mean(v)) for m, v in bymap.items())), flush=True)
files = sorted(glob.glob(O + name + '-*-proto.f32'))
if files and '--nodist' not in sys.argv:
    out = subprocess.run(['/tmp/botlab/.venv/bin/python', '/tmp/botlab/st2/dist.py', name + '=' + ','.join(files)], capture_output=True, text=True).stdout
    keep = ('DISTANCE', 'windows', 'shots_per_min', 'hit_rate', 'time_to_first', 'shot_lateral', 'burst_shots', 'ads_share', 'still_body', 'turn_speed')
    print('\n'.join(l for l in out.splitlines() if l.startswith(keep)))
