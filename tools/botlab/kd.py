"""Strength of recorded humans against the production bots, from the per-segment summaries (no player ids are printed)."""
import json, collections
import numpy as np
from ds import load_segs
segs = load_segs()
agg = collections.defaultdict(lambda: collections.Counter())
mat = collections.Counter()
for g in segs:
    S = {s['slot']: s for s in g['soldiers']}
    def cls(s):
        if s['bot']: return 'bot'
        return 'human_' + (s.get('input') or 'unknown')
    for s in g['soldiers']:
        c = cls(s); a = agg[c]
        a['n'] += 1; a['alive'] += s['alive']; a['dmg'] += s['dmg']; a['taken'] += s['taken']; a['shots'] += s['shots']; a['hits'] += s['hits']; a['kills'] += s.get('kills', 0); a['deaths'] += s.get('deaths', 0)
        if not s['bot'] and s.get('aim'): 
            a2 = agg['human_aimclean']; a2['n'] += 1; a2['alive'] += s['alive']; a2['dmg'] += s['dmg']; a2['taken'] += s['taken']; a2['shots'] += s['shots']; a2['hits'] += s['hits']; a2['kills'] += s.get('kills', 0); a2['deaths'] += s.get('deaths', 0)
    for k in g['kills']:
        a, b = S.get(k['k']), S.get(k['v'])
        if a is None or b is None: continue
        mat[('bot' if a['bot'] else 'human', 'bot' if b['bot'] else 'human', 'same' if a['team'] == b['team'] else 'enemy')] += 1
print('class                n      alive h   dmg/min  taken/min  shots/min  hit    kills  deaths')
for c, a in sorted(agg.items()):
    m = a['alive'] / 60
    print('%-18s %7d %8.1f %8.1f %9.1f %9.1f  %.3f %7d %7d' % (c, a['n'], a['alive'] / 3600, a['dmg'] / m, a['taken'] / m, a['shots'] / m, a['hits'] / max(1, a['shots']), a['kills'], a['deaths']))
print('kills (killer, victim, team):', dict(mat))
hb, bh = mat[('human', 'bot', 'enemy')], mat[('bot', 'human', 'enemy')]
print('human kills of bots', hb, 'bot kills of humans', bh, 'ratio', round(hb / max(1, bh), 2))
# per-capita: kills per alive hour by class against the other class
print('human kills of enemies per alive hour', round((hb + mat[('human', 'human', 'enemy')]) / (sum(a['alive'] for c, a in agg.items() if c.startswith('human_') and c != 'human_aimclean') / 3600), 1),
      'bot kills per alive hour', round((bh + mat[('bot', 'bot', 'enemy')]) / (agg['bot']['alive'] / 3600), 1))
