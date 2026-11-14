"""Aim error curves after first sight by the distance and the bearing drift of the target (humans, recorded bots, sim rows)."""
import json, sys
import numpy as np
from ds import *
from metrics import runs_of, onsets, windows

def curves(rows, label, W=61):
    run, tc, brk = runs_of(rows)
    on = onsets(rows, run, tc)
    n = len(rows)
    ix, ok = windows(on, run, n, W)
    e0 = rows[:, OWN:OWN + SLOT]
    tid = e0[on, E['id']]
    ey0, ep0, d0 = e0[on, E['eyaw']], e0[on, E['epc']], e0[on, E['dist']]
    off0 = np.hypot(ey0, ep0)
    sel = (np.abs(ey0) < 0.75) & (np.abs(ep0) < 0.45) & (off0 > 0.12) & (off0 < 0.8) & (rows[on, A['weapon']] != 0)
    same = ok & (e0[ix, E['id']] == tid[:, None]) & (e0[ix, E['vis']] > 0)
    err = np.hypot(e0[ix, E['eyaw']], e0[ix, E['epc']])
    b = (e0[:, E['eyaw']].astype(np.float64) + rows[:, A['yaw']].astype(np.float64))[ix]
    # mean |drift| of the target's bearing over the first 0.5 s it stays in sight
    db = np.abs(np.arctan2(np.sin(b[:, 1:16] - b[:, :15]), np.cos(b[:, 1:16] - b[:, :15]))) * 30
    okd = same[:, 1:16] & same[:, :15]
    drift = np.where(okd.sum(1) >= 5, (db * okd).sum(1) / np.maximum(1, okd.sum(1)), np.nan)
    hits = rows[ix, A['hits']]; shots = rows[ix, A['shots']]
    res = {}
    def one(name, m):
        m = m & sel
        r = {'n': int(m.sum())}
        for k in (15, 30, 45, 60):
            mm = m & same[:, k]
            r['rel_%.1f' % (k / 30)] = round(float(np.median(err[mm, k] / off0[mm])), 3) if mm.sum() >= 20 else None
            r['vis_%.1f' % (k / 30)] = round(float(mm.sum() / max(1, m.sum())), 3)
        sh = shots[m][:, :W].sum(); r['hit_rate_2s'] = round(float(hits[m][:, :W].sum() / max(1, sh)), 3); r['shots_per_onset'] = round(float(sh / max(1, m.sum())), 2)
        r['hits_per_onset_2s'] = round(float(hits[m][:, :W].sum() / max(1, m.sum())), 3)
        res[name] = r
        print('%-8s %-22s n %6d  rel err 0.5 s %s  1 s %s  1.5 s %s  2 s %s   in sight at 1 s %.2f   shots %.2f  hits %.3f per onset, hit rate %.3f' % (label, name, r['n'], r['rel_0.5'], r['rel_1.0'], r['rel_1.5'], r['rel_2.0'], r['vis_1.0'], r['shots_per_onset'], r['hits_per_onset_2s'], r['hit_rate_2s']))
    one('all', np.ones(len(on), bool))
    for lo, hi in ((0, 8), (8, 15), (15, 30), (30, 200)): one('dist %d-%d m' % (lo, hi), (d0 >= lo) & (d0 < hi))
    for lo, hi in ((0, 0.1), (0.1, 0.25), (0.25, 0.5), (0.5, 9)): one('drift %.2f-%.2f' % (lo, hi), (drift >= lo) & (drift < hi))
    one('dist<15 & drift>0.25', (d0 < 15) & (drift > 0.25))
    return res

if __name__ == '__main__':
    out = {}
    for a in sys.argv[1:]:
        name, _, label = a.partition(':')
        if name in ('haim', 'baim'): rows, _ = load_rows(name)
        else:
            x = np.fromfile(name, dtype=np.float32); rows = x[: (x.size // NA) * NA].reshape(-1, NA)
        out[label or name] = curves(rows, label or name)
        print()
    json.dump(out, open('/tmp/rec/out/errcond.json', 'w'), indent=1)
