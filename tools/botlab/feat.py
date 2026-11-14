"""Aim-policy features and targets from aim rows. The TypeScript twin is /tmp/botlab/policy.ts (same order, same numbers).

Sample at observation row o (the state at the end of tick o) predicts the action of row o+1:
mouse yaw change, mouse pitch change (both without recoil) and the fire key.
Only enemies in sight give numbers to the model (no positions through walls)."""
import numpy as np
from ds import A, E, OWN, SLOT, SLOTS

NF = 118
HIST = [1, 2, 3, 4, 6, 8, 11, 15]
VEL = [1, 3, 6]
EDGES = np.array([0.0005, 0.0033, 0.0055, 0.0077, 0.0099, 0.0143, 0.02, 0.028, 0.04, 0.056, 0.08, 0.112, 0.16, 0.224, 0.32, 0.45, 0.64, 1.0])
NB = len(EDGES) - 1          # 17 magnitude bins
NC = 1 + 2 * NB              # 35 classes: 0 zero, 1..17 positive, 18..34 negative
CONTEXT = 46


def to_class(x):
    ax = np.abs(x)
    k = np.clip(np.searchsorted(EDGES, ax, side='right'), 0, NB)  # 0 below the first edge
    return np.where(k == 0, 0, np.where(x > 0, k, k + NB)).astype(np.int16)


def class_centres():
    c = np.zeros(NC)
    mid = np.sqrt(EDGES[:-1] * EDGES[1:])
    c[1:1 + NB] = mid; c[1 + NB:] = -mid
    return c


def build(rows, run):
    """Features (n, NF) float32 at each observation row, targets (n, 3) int16 for the next row, and masks: valid (a next row exists in the run) and engaged."""
    n = len(rows)
    f = np.zeros((n, NF), dtype=np.float32)

    def lag(arr, L, fill=0):
        if L == 0: return arr, np.ones(n, bool)
        out = np.empty_like(arr); out[:L] = fill; out[L:] = arr[:-L]
        ok = np.zeros(n, bool); ok[L:] = run[L:] == run[:-L]
        if arr.ndim == 1: out = np.where(ok, out, fill)
        else: out = np.where(ok[:, None], out, fill)
        return out, ok

    yaw, pitch = rows[:, A['yaw']].astype(np.float64), rows[:, A['pitch']].astype(np.float64)
    mdy, mdp = rows[:, A['mdyaw']].astype(np.float64), rows[:, A['mdpitch']].astype(np.float64)
    fire = (rows[:, A['fire']] > 0).astype(np.float32)
    shots = rows[:, A['shots']].astype(np.float32)
    S = rows[:, OWN:OWN + SLOTS * SLOT].reshape(n, SLOTS, SLOT)
    ids = S[:, :, E['id']]
    vis = (S[:, :, E['vis']] > 0) & (ids >= 0)
    eyaw, epc, eph, dist, hp = (S[:, :, E[k]].astype(np.float64) for k in ('eyaw', 'epc', 'eph', 'dist', 'health'))
    c = 0
    # 1. weapon one-hot (8)
    w = rows[:, A['weapon']].astype(int)
    for k in range(8): f[:, c + k] = w == k
    c += 8
    # 2. own state (13)
    hurt15 = np.zeros(n); shots15 = np.zeros(n)
    for L in range(15):
        hurt15 += lag(rows[:, A['hurt']].astype(np.float64), L)[0]; shots15 += lag(shots.astype(np.float64), L)[0]
    own = [rows[:, A['ads']], rows[:, A['crouch']], rows[:, A['speed']] / 8, rows[:, A['vf']] / 8, rows[:, A['vs']] / 8, rows[:, A['grounded']], rows[:, A['health']] / 100,
           np.minimum(rows[:, A['ammo']], 100) / 100, rows[:, A['ammo']] <= 0, rows[:, A['reloading']], np.minimum(rows[:, A['nvis']], 3) / 3, pitch / 1.3, np.minimum(hurt15, 100) / 100]
    for k, v in enumerate(own): f[:, c + k] = v
    c += 13
    # 3. enemy slots, only those in sight (3 x 11)
    for j in range(SLOTS):
        v = vis[:, j]
        cols = [v, (S[:, j, E['vis']].astype(int) & 1) > 0, (S[:, j, E['vis']].astype(int) & 2) > 0, np.tanh(eyaw[:, j] / 0.06), np.tanh(eyaw[:, j] / 0.4), eyaw[:, j] / np.pi,
                np.tanh(epc[:, j] / 0.06), np.tanh(epc[:, j] / 0.4), np.clip((eph[:, j] - epc[:, j]) / 0.1, 0, 3) / 3, np.log1p(dist[:, j]) / 5, hp[:, j] / 100]
        for k, x in enumerate(cols): f[:, c + k] = np.where(v, x, 0)
        c += 11
    # 4. the slot-0 enemy in earlier rows (8 x 3), 5. its angular speed (6), 6. sight timing (7)
    id0 = ids[:, 0]
    has0 = id0 >= 0
    seen = {}  # lag -> (in sight then, eyaw then, epc then)
    for L in range(30):
        idsL, ok = lag(ids, L, -1); visL, _ = lag(vis, L, False); eyL, _ = lag(eyaw, L); epL, _ = lag(epc, L)
        m = (idsL == id0[:, None]) & visL & has0[:, None] & ok[:, None]
        seen[L] = (m.any(1), (m * eyL).sum(1), (m * epL).sum(1))
    for L in HIST:
        s, ey, ep = seen[L]
        f[:, c] = s; f[:, c + 1] = np.where(s, np.tanh(ey / 0.2), 0); f[:, c + 2] = np.where(s, np.tanh(ep / 0.2), 0)
        c += 3
    s0, ey0, ep0 = seen[0]
    for L in VEL:
        s, ey, ep = seen[L]
        yawL, _ = lag(yaw, L); pitL, _ = lag(pitch, L)
        both = s0 & s
        vy = np.arctan2(np.sin((yaw + ey0) - (yawL + ey)), np.cos((yaw + ey0) - (yawL + ey))) * 30 / L
        vp = ((pitch + ep0) - (pitL + ep)) * 30 / L
        f[:, c] = np.where(both, np.tanh(vy / 1.5), 0); f[:, c + 1] = np.where(both, np.tanh(vp / 1.5), 0)
        c += 2
    tsv = np.zeros(n); alive = np.ones(n, bool)
    for L in range(30):
        alive &= seen[L][0]; tsv += alive
    anyvis = rows[:, A['nvis']] > 0
    since_any = np.full(n, 30.0)
    for L in range(29, -1, -1):
        a, ok = lag(anyvis, L, False)
        since_any = np.where(a & ok, L, since_any)
    f[:, c] = tsv / 30
    for k, th in enumerate((3, 6, 9, 12, 18)): f[:, c + 1 + k] = tsv >= th
    f[:, c + 6] = since_any / 30
    c += 7
    # 7. own aim changes before (20)
    for k in range(4):
        a, _ = lag(mdy, k); b, _ = lag(mdp, k)
        f[:, c] = np.tanh(a / 0.01); f[:, c + 1] = np.tanh(a / 0.1); f[:, c + 2] = np.tanh(b / 0.01); f[:, c + 3] = np.tanh(b / 0.1)
        c += 4
    for lo, hi, sc in ((4, 8, 0.1), (8, 16, 0.2)):
        sy = np.zeros(n); sp = np.zeros(n)
        for L in range(lo, hi): sy += lag(mdy, L)[0]; sp += lag(mdp, L)[0]
        f[:, c] = np.tanh(sy / sc); f[:, c + 1] = np.tanh(sp / sc)
        c += 2
    # 8. fire key before (7)
    for k in range(3): f[:, c + k] = lag(fire, k)[0]
    run_len = np.zeros(n); on = np.ones(n, bool); since_fire = np.full(n, 45.0)
    for L in range(45):
        fl, ok = lag(fire, L)
        on &= (fl > 0) & ok; run_len += on
    for L in range(44, -1, -1):
        fl, ok = lag(fire, L)
        since_fire = np.where((fl > 0) & ok, L, since_fire)
    f[:, c + 3] = run_len / 45; f[:, c + 4] = since_fire / 45; f[:, c + 5] = shots > 0; f[:, c + 6] = np.minimum(shots15 / 10, 2)
    c += 7
    assert c == NF, c
    # targets from the next row
    y = np.zeros((n, 3), dtype=np.int16)
    valid = np.zeros(n, bool); valid[:-1] = run[1:] == run[:-1]
    y[:-1, 0] = to_class(np.clip(mdy[1:], -1, 1)); y[:-1, 1] = to_class(np.clip(mdp[1:], -1, 1)); y[:-1, 2] = fire[1:] > 0
    engaged = since_any < 30
    return f, y, valid, engaged


def build_file(rows, tracks, out_prefix, chunk=400_000, only_engaged=True):
    """Features of all rows (in chunks) to <out_prefix>.x.f16 / .y.i16 / .m.i32 (row index, track index, player)."""
    from metrics import runs_of
    n = len(rows)
    run = runs_of(rows)[0]
    tid = np.full(n, -1, dtype=np.int32); pid = np.full(n, -1, dtype=np.int32)
    for i, t in enumerate(tracks):
        tid[t['start']:t['start'] + t['n']] = i; pid[t['start']:t['start'] + t['n']] = t['p']
    xs, ys, ms = open(out_prefix + '.x.f16', 'wb'), open(out_prefix + '.y.i16', 'wb'), open(out_prefix + '.m.i32', 'wb')
    total = 0
    for a in range(0, n, chunk):
        lo = max(0, a - CONTEXT); b = min(n, a + chunk + 1)  # one more row for the last target
        f, y, valid, eng = build(np.asarray(rows[lo:b]), run[lo:b])
        keep = valid & (eng if only_engaged else True)
        keep[: a - lo] = False
        if b < n: keep[-1] = False  # its target is in the next chunk; that chunk has it as context
        idx = np.flatnonzero(keep)
        f[idx].astype(np.float16).tofile(xs); y[idx].tofile(ys)
        g = idx + lo
        np.stack([g, tid[g], pid[g]], 1).astype(np.int32).tofile(ms)
        total += len(idx)
    xs.close(); ys.close(); ms.close()
    return total
