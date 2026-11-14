"""Sanity checks on the test extraction (shard 0, 60 segments)."""
import json, sys
import numpy as np

DS = '/tmp/rec/ds/'
tag = sys.argv[1] if len(sys.argv) > 1 else 'test0'
NA, NM = 53, 38
A = dict(t=0, dt=1, yaw=2, pitch=3, mdyaw=4, mdpitch=5, fire=6, shots=7, hits=8, heads=9, weapon=10, ads=11, crouch=12, speed=13, vf=14, vs=15, grounded=16, health=17, ammo=18, reloading=19, nvis=20, nenemy=21, hurt=22, nframes=23, tick=24, aimkey=25)
ha = np.fromfile(DS + f'haim-{tag}.f32', dtype=np.float32).reshape(-1, NA)
ba = np.fromfile(DS + f'baim-{tag}.f32', dtype=np.float32).reshape(-1, NA)
hm = np.fromfile(DS + f'hmove-{tag}.f32', dtype=np.float32).reshape(-1, NM)
bm = np.fromfile(DS + f'bmove-{tag}.f32', dtype=np.float32).reshape(-1, NM)
tracks = [json.loads(l) for l in open(DS + f'tracks-{tag}.jsonl')]
print('rows', ha.shape, ba.shape, hm.shape, bm.shape, 'tracks', len(tracks))
kinds = {}
for t in tracks: kinds[t['kind']] = kinds.get(t['kind'], 0) + 1
print('track kinds', kinds)
print('haim lag', [t['lag'] for t in tracks if t['kind'] == 'haim'][:30])
print('haim resid/rtt/fps', [(t['resid'], t['rtt'], t['fps']) for t in tracks if t['kind'] == 'haim'][:10])

def q(x, ps=(5, 25, 50, 75, 95)): return np.round(np.percentile(x, ps), 4).tolist() if len(x) else []
for name, a in (('human', ha), ('bot', ba)):
    print('==', name)
    dt = a[:, A['dt']]
    print(' dt', q(dt[dt > 0]), 'dt==0 share', float((dt == 0).mean()))
    print(' nframes', q(a[:, A['nframes']]))
    # yaw change vs mouse part where consecutive rows and no shots
    cont = a[1:, A['dt']] > 0
    dy = np.arctan2(np.sin(a[1:, A['yaw']] - a[:-1, A['yaw']]), np.cos(a[1:, A['yaw']] - a[:-1, A['yaw']]))
    dp = a[1:, A['pitch']] - a[:-1, A['pitch']]
    md = a[1:, A['mdyaw']]; mp = a[1:, A['mdpitch']]
    cont1 = cont & (np.abs(a[1:, A['dt']] - 1 / 30) < 0.002)
    quiet = cont1 & (a[1:, A['shots']] == 0) & (a[1:, A['fire']] == 0) & (a[:-1, A['fire']] == 0)
    print(' quiet rows', int(quiet.sum()), 'yaw resid (dy-md) abs', q(np.abs(dy - md)[quiet]), 'pitch resid', q(np.abs(dp - mp)[quiet]))
    fir = cont1 & (a[1:, A['shots']] > 0)
    print(' shot rows', int(fir.sum()), 'pitch resid (recoil) ', q((dp - mp)[fir]), 'yaw resid', q((dy - md)[fir]))
    print(' |dyaw| per row', q(np.abs(dy[cont1])), 'fire share', float(a[:, A['fire']].mean()), 'shots', float(a[:, A['shots']].sum()), 'hits', float(a[:, A['hits']].sum()), 'heads', float(a[:, A['heads']].sum()))
    print(' nvis>0 share', float((a[:, A['nvis']] > 0).mean()), 'nenemy', q(a[:, A['nenemy']]))
    e0 = a[:, 26:34]
    vis = e0[:, 6] > 0
    print(' slot0 present', float((e0[:, 0] >= 0).mean()), 'visible', float(vis.mean()), 'dist(vis)', q(e0[vis, 2]), 'eyaw(vis)', q(e0[vis, 3]), 'epitchChest(vis)', q(e0[vis, 4]))
    sh = (a[:, A['shots']] > 0) & vis
    print(' at shots: eyaw', q(e0[sh, 3]), 'epitchChest', q(e0[sh, 4]), 'epitchHead', q(e0[sh, 5]))
    hit = (a[:, A['hits']] > 0) & vis
    print(' at hits: |eyaw|', q(np.abs(e0[hit, 3])), 'epitchChest', q(e0[hit, 4]), 'n', int(hit.sum()))
    w = a[:, A['weapon']].astype(int)
    print(' weapons', np.bincount(w, minlength=8).tolist(), 'ads', float(a[:, A['ads']].mean()), 'speed', q(a[:, A['speed']]), 'health', q(a[:, A['health']]))
M = dict(t=0, dt=1, x=2, y=3, z=4, yaw=5, pitch=6, vf=7, vs=8, vy=9, flags=10, health=11, weapon=12, nvDist=13, nvBear=14, neDist=15, neBear=16, ntDist=17, ntBear=18, nAllies=19, nEnemies=20, nVisible=21, siteA=22, siteABear=23, siteB=24, siteBBear=25, bomb=26, left=27, rays=28, node=36, hurt=37)
for name, a in (('human', hm), ('bot', bm)):
    print('== move', name)
    dt = a[:, M['dt']]
    print(' dt', q(dt[dt > 0]), 'first share', float((dt == 0).mean()))
    print(' speed', q(np.hypot(a[:, M['vf']], a[:, M['vs']])), 'vf', q(a[:, M['vf']]), 'vs', q(a[:, M['vs']]))
    print(' rays0 (ahead)', q(a[:, M['rays']]), 'rays4 (behind)', q(a[:, M['rays'] + 4]))
    print(' nvis>0', float((a[:, M['nVisible']] > 0).mean()), 'neDist', q(a[:, M['neDist']]), 'ntDist', q(a[:, M['ntDist']]), 'siteA', q(a[:, M['siteA']]))
    print(' node', q(a[:, M['node']]), 'bomb vals', np.unique(a[:, M['bomb']]).tolist(), 'hurt sum', float(a[:, M['hurt']].sum()), 'left', q(a[:, M['left']]))
    fl = a[:, M['flags']].astype(int)
    print(' sprint', float(((fl & 4) > 0).mean()), 'ads', float(((fl & 8) > 0).mean()), 'crouchflag slide', float(((fl & 16) > 0).mean()), 'grounded', float(((fl & 2) > 0).mean()))
segs = [json.loads(l) for l in open(DS + f'segs-{tag}.jsonl')]
print('segs', len(segs), 'sample', json.dumps(segs[0])[:1500])
