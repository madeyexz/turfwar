"""Spread of the human players (aim-clean, mouse): hit rate, hits per alive minute, shots per minute. Quantiles over players only (no ids printed)."""
import numpy as np
from ds import A, E, OWN, load_rows, load_tracks
rows, offs = load_rows('haim')
tr = load_tracks(offs={'haim': offs, 'baim': [0, 0], 'hmove': [0, 0], 'bmove': [0, 0]})['haim']
agg = {}
for t in tr:
    r = rows[t['start']:t['start'] + t['n']]
    a = agg.setdefault(t.get('p', -1), [0.0, 0.0, 0.0, 0.0])
    gun = r[:, A['weapon']] != 0
    a[0] += len(r) / 30 / 60; a[1] += r[gun, A['shots']].sum(); a[2] += r[gun, A['hits']].sum(); a[3] += (r[:, A['nvis']] > 0).sum() / 30 / 60
v = np.array([x for x in agg.values() if x[0] >= 10 and x[1] >= 300])
print('players with 10 min and 300 shots:', len(v), 'of', len(agg), ' minutes share', round(v[:, 0].sum() / sum(x[0] for x in agg.values()), 3))
q = lambda x: ' '.join('%.3f' % z for z in np.percentile(x, [10, 25, 50, 75, 90, 95]))
print('hit rate          p10 p25 p50 p75 p90 p95:', q(v[:, 2] / v[:, 1]))
print('hits per minute   p10 p25 p50 p75 p90 p95:', q(v[:, 2] / v[:, 0]))
print('shots per minute  p10 p25 p50 p75 p90 p95:', q(v[:, 1] / v[:, 0]))
print('hits per minute with an enemy in sight:', q(v[:, 2] / v[:, 3]))
w = v[:, 0]
print('minutes-weighted mean hit rate %.3f hits/min %.2f' % ((v[:, 2].sum() / v[:, 1].sum()), v[:, 2].sum() / v[:, 0].sum()))
