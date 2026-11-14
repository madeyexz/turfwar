"""Loader for the extracted row files (both shards as one array; track starts are made global)."""
import json
import numpy as np

DS = '/tmp/rec/ds/'
NA, NM = 53, 38
OWN, SLOT, SLOTS, OV = 26, 8, 3, 50
A = dict(t=0, dt=1, yaw=2, pitch=3, mdyaw=4, mdpitch=5, fire=6, shots=7, hits=8, heads=9, weapon=10, ads=11, crouch=12, speed=13, vf=14, vs=15,
         grounded=16, health=17, ammo=18, reloading=19, nvis=20, nenemy=21, hurt=22, nframes=23, tick=24, aimkey=25)
# enemy slot fields (offset inside a slot)
E = dict(id=0, bot=1, dist=2, eyaw=3, epc=4, eph=5, vis=6, health=7)
M = dict(t=0, dt=1, x=2, y=3, z=4, yaw=5, pitch=6, vf=7, vs=8, vy=9, flags=10, health=11, weapon=12, nvDist=13, nvBear=14, neDist=15, neBear=16,
         ntDist=17, ntBear=18, nAllies=19, nEnemies=20, nVisible=21, siteA=22, siteABear=23, siteB=24, siteBBear=25, bomb=26, left=27, rays=28, node=36, hurt=37)
WEAPONS = ['knife', 'mp5', 'm4a1', 'm1014', 'm110', 'm249', 'm9a1', 'mp7']
AUTO = np.array([0, 1, 1, 0, 0, 1, 0, 1], dtype=bool)


def load_rows(kind, tags=('0', '1'), width=None, ds=DS):
    """All rows of one kind over the shards (copied into RAM) and the row offset of each shard."""
    width = width or (NA if kind.endswith('aim') else NM)
    parts, offs, n = [], [], 0
    for tag in tags:
        a = np.memmap(f'{ds}{kind}-{tag}.f32', dtype=np.float32, mode='r')
        a = a[: (a.size // width) * width].reshape(-1, width)
        parts.append(a); offs.append(n); n += a.shape[0]
    return (np.concatenate(parts) if len(parts) > 1 else np.array(parts[0])), offs


def load_tracks(tags=('0', '1'), offs=None, ds=DS):
    """Track lines per kind; `start` is made global with the shard offsets in `offs[kind]`."""
    out = {}
    for si, tag in enumerate(tags):
        for line in open(f'{ds}tracks-{tag}.jsonl'):
            t = json.loads(line)
            if offs is not None: t['start'] += offs[t['kind']][si]
            t['shard'] = si
            out.setdefault(t['kind'], []).append(t)
    return out


def load_segs(tags=('0', '1'), ds=DS):
    out = []
    for si, tag in enumerate(tags):
        for line in open(f'{ds}segs-{tag}.jsonl'):
            s = json.loads(line); s['shard'] = si; out.append(s)
    return out


def load_all(kinds=('haim', 'baim', 'hmove', 'bmove'), tags=('0', '1'), ds=DS):
    rows, offs = {}, {}
    for k in kinds:
        rows[k], offs[k] = load_rows(k, tags, ds=ds)
    for k in ('haim', 'baim', 'hmove', 'bmove'):
        offs.setdefault(k, [0] * len(tags))
    tracks = load_tracks(tags, offs, ds=ds)
    return rows, tracks


def q(x, ps=(5, 25, 50, 75, 95), nd=4):
    x = np.asarray(x)
    return np.round(np.percentile(x, ps), nd).tolist() if x.size else []


def wrap(a):
    return np.arctan2(np.sin(a), np.cos(a))
