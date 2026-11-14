"""Kills between humans and bots by the human's input, and how the kills are concentrated in players (no player ids are printed)."""
import json, collections
import numpy as np
from ds import load_segs
segs = load_segs()
C = collections.defaultdict(collections.Counter)
per = collections.defaultdict(collections.Counter)
for g in segs:
    S = {s['slot']: s for s in g['soldiers']}
    def cls(s): return 'bot' if s['bot'] else (s.get('input') or 'unknown')
    for s in g['soldiers']:
        if not s['bot']:
            C[cls(s)]['alive'] += s['alive']; per[s['p']]['alive'] += s['alive']; per[s['p']]['input_' + cls(s)] += s['alive']
            if s.get('aim'): C['aimclean']['alive'] += s['alive']
    for k in g['kills']:
        a, b = S.get(k['k']), S.get(k['v'])
        if a is None or b is None or a['team'] == b['team']: continue
        if not a['bot'] and b['bot']:
            C[cls(a)]['kills_bot'] += 1; per[a['p']]['kb'] += 1
            if a.get('aim'): C['aimclean']['kills_bot'] += 1
        if a['bot'] and not b['bot']:
            C[cls(b)]['killed_by_bot'] += 1; per[b['p']]['bk'] += 1
            if b.get('aim'): C['aimclean']['killed_by_bot'] += 1
print('%-10s %8s %10s %12s %7s %14s' % ('input', 'alive h', 'kills bot', 'killed by bot', 'ratio', 'kills/alive h'))
for c, a in sorted(C.items()):
    print('%-10s %8.1f %10d %12d %7.2f %14.1f' % (c, a['alive'] / 3600, a['kills_bot'], a['killed_by_bot'], a['kills_bot'] / max(1, a['killed_by_bot']), a['kills_bot'] / (a['alive'] / 3600)))
# concentration: share of human kills of bots by the top players, and the spread of per-player ratios (mouse, >= 20 decisions)
P = [(v['kb'], v['bk'], v['alive'], max(('mouse', 'touch', 'unknown'), key=lambda i: v['input_' + i])) for v in per.values()]
for inp in ('mouse', 'touch'):
    q = [p for p in P if p[3] == inp]
    kb = np.array([p[0] for p in q]); bk = np.array([p[1] for p in q]); al = np.array([p[2] for p in q])
    o = np.argsort(-kb)
    top = max(1, len(q) // 10)
    print(inp, 'players', len(q), 'kills of bots', int(kb.sum()), 'top 10%% of players have %.2f of kills and %.2f of alive time' % (kb[o[:top]].sum() / kb.sum(), al[o[:top]].sum() / al.sum()))
    m = (kb + bk) >= 20
    r = kb[m] / (kb[m] + bk[m])
    print('  players with >= 20 duels:', int(m.sum()), 'win share p10 %.2f p25 %.2f p50 %.2f p75 %.2f p90 %.2f; win share weighted by duels %.2f' % (*np.percentile(r, [10, 25, 50, 75, 90]), kb[m].sum() / (kb[m] + bk[m]).sum()))
    m2 = ~m
    print('  players with < 20 duels:', int(m2.sum()), 'win share (pooled) %.2f, duels %d' % (kb[m2].sum() / max(1, (kb[m2] + bk[m2]).sum()), int((kb[m2] + bk[m2]).sum())))
