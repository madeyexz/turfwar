"""Dataset summary of the full extraction (hours by kind, splits, players)."""
import json, sys, collections
import numpy as np
from ds import *
rows, tracks = load_all()
for k in rows: print(k, rows[k].shape, 'tracks', len(tracks[k]))
ha = rows['haim']
print('haim hours (rows/30)', ha.shape[0] / 30 / 3600, 'baim hours (sum dt)', float(rows['baim'][:, A['dt']].sum()) / 3600, 'hmove hours', rows['hmove'].shape[0] / 10 / 3600, 'bmove hours', rows['bmove'].shape[0] / 10 / 3600)
# haim per player, map, mode, size, weapon
T = tracks['haim']
byp = collections.Counter(); bymap = collections.Counter(); bymode = collections.Counter(); bysize = collections.Counter(); exp = 0
for t in T:
    h = t['n'] / 30 / 3600
    byp[t['p']] += h; bymap[t['map']] += h; bymode[t['mode']] += h; bysize[t['size']] += h; exp += h * t['exp']
hrs = np.array(sorted(byp.values(), reverse=True))
print('haim players', len(hrs), 'top10 share', hrs[:10].sum() / hrs.sum(), 'top1', hrs[0], 'eff players', hrs.sum() ** 2 / (hrs ** 2).sum(), 'players>=1h', int((hrs >= 1).sum()), '>=0.25h', int((hrs >= 0.25).sum()), 'export h', exp)
print(' by map', {k: round(v, 2) for k, v in bymap.most_common()})
print(' by mode', {k: round(v, 2) for k, v in bymode.items()}, 'by size', {k: round(v, 2) for k, v in bysize.items()})
print(' lag', collections.Counter(t['lag'] for t in T).most_common(8), 'fps', q([t['fps'] for t in T]), 'rtt', q([t['rtt'] for t in T]), 'sens', q([t['sens'] for t in T]), 'fov', q([t['fov'] for t in T]))
w = ha[:, A['weapon']].astype(int)
print(' weapon rows share', dict(zip(WEAPONS, np.round(np.bincount(w, minlength=8) / len(w), 3).tolist())))
sh = ha[:, A['shots']]
print(' shots', float(sh.sum()), 'hits', float(ha[:, A['hits']].sum()), 'heads', float(ha[:, A['heads']].sum()), 'rows with enemy visible', float((ha[:, A['nvis']] > 0).mean()), 'fire key share', float(ha[:, A['fire']].mean()))
for wi in range(8):
    m = w == wi
    print('  ', WEAPONS[wi], 'shots', int(sh[m].sum()), 'hit rate', round(float(ha[m, A['hits']].sum() / max(1, sh[m].sum())), 3), 'head share', round(float(ha[m, A['heads']].sum() / max(1, ha[m, A['hits']].sum())), 3))
ba = rows['baim']; wb = ba[:, A['weapon']].astype(int)
print('baim shots', float(ba[:, A['shots']].sum()), 'hits', float(ba[:, A['hits']].sum()), 'heads', float(ba[:, A['heads']].sum()), 'vis share', float((ba[:, A['nvis']] > 0).mean()))
for wi in range(8):
    m = wb == wi
    print('  ', WEAPONS[wi], 'shots', int(ba[m, A['shots']].sum()), 'hit rate', round(float(ba[m, A['hits']].sum() / max(1, ba[m, A['shots']].sum())), 3))
# hmove by input
T = tracks['hmove']
byin = collections.Counter(); bypm = collections.Counter(); bymapm = collections.Counter()
for t in T:
    h = t['n'] / 10 / 3600
    byin[(t['input'], t['assist'])] += h; bypm[t['p']] += h; bymapm[t['map']] += h
print('hmove by input', {str(k): round(v, 2) for k, v in byin.items()}, 'players', len(bypm))
print(' by map', {k: round(v, 2) for k, v in bymapm.most_common()})
hm = rows['hmove']
print(' hmove dt', q(hm[:, M['dt']][hm[:, M['dt']] > 0]))
segs = load_segs()
print('segs', len(segs), 'humans per seg', collections.Counter(sum(1 for s in g['soldiers'] if not s['bot']) for g in segs).most_common(8))
