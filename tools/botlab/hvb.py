"""Human kill share against bots in the recordings (totals only). A kill counts when one side is a recorded human and the other a bot."""
import json, collections
import numpy as np
tot = collections.Counter(); per = {}
for f in ('/tmp/rec/ds/segs-0.jsonl', '/tmp/rec/ds/segs-1.jsonl'):
    for line in open(f):
        d = json.loads(line)
        sol = {s['slot']: s for s in d['soldiers']}
        for k in d['kills']:
            a, b = sol.get(k['k']), sol.get(k['v'])
            if not a or not b or a['team'] == b['team']: continue
            if not a['bot'] and b['bot']:
                tot[('hk', a['input'])] += 1; tot[('hk', a['input'], d['size'])] += 1
                p = per.setdefault(a['p'], [0, 0, a['input']]); p[0] += 1
            elif a['bot'] and not b['bot']:
                tot[('hd', b['input'])] += 1; tot[('hd', b['input'], d['size'])] += 1
                p = per.setdefault(b['p'], [0, 0, b['input']]); p[1] += 1
            elif not a['bot'] and not b['bot']: tot['hh'] += 1
            else: tot['bb'] += 1
print('human-human kills', tot['hh'], 'bot-bot kills', tot['bb'])
for inp in sorted({k[1] for k in tot if isinstance(k, tuple)}):
    K, D = tot[('hk', inp)], tot[('hd', inp)]
    print('%-8s human kills of bots %6d, bot kills of humans %6d, human kill share %.3f' % (inp, K, D, K / max(1, K + D)), ' by size:', {s: round(tot[('hk', inp, s)] / max(1, tot[('hk', inp, s)] + tot[('hd', inp, s)]), 3) for s in (1, 6, 24)})
for inp in ('mouse', 'touch'):
    v = np.array([[a, b] for a, b, i in per.values() if i == inp and a + b >= 50])
    if len(v): print(inp, 'players with 50 or more duels:', len(v), 'kill share p10 p25 p50 p75 p90:', np.round(np.percentile(v[:, 0] / v.sum(1), [10, 25, 50, 75, 90]), 3))
