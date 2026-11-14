"""Movement next-step model on the 10 Hz movement rows (humans, movement-clean), players held out.

Sample: the state at row o predicts row o+1 (0.1 s later): the move direction relative to the view (still or 8 directions),
the turn (7 classes), and the sprint, ADS and in-air flags. Small MLP, same recipe as the aim model.
Usage: python mtrain.py EXP [--hours ..] [--seeds ..] [--zero hist|pos|hist+pos] [--train all|mouse|touch] [--max_steps N]
Results: /tmp/rec/out/mtrain.jsonl"""
import argparse, json, os, time
import numpy as np
import torch
import torch.nn as nn
from ds import M, NM, WEAPONS, load_tracks

DS = '/tmp/rec/ds/'; MV = '/tmp/rec/mv/'; OUT = '/tmp/rec/out/mtrain.jsonl'
torch.set_num_threads(int(os.environ.get("TORCH_THREADS", "1")))
MAPS = ['taipei', 'warehouse', 'taipei101', 'citadel', 'skyline', 'pipeline', 'ochre', 'memorial', 'railyard', 'timbertown', 'sanchong', 'meridian', 'xinyi']
ND, NT = 9, 7
TURN_EDGES = np.array([0.02, 0.1, 0.4])
# feature groups (start, end)
G = {}
NF = 0
for name, n in (('weapon', 8), ('motion', 7), ('own', 6), ('enemy', 5), ('team', 6), ('objective', 14), ('time', 1), ('rays', 16), ('hurt', 2), ('lags', 6), ('pos', 16), ('touch', 1)):
    G[name] = (NF, NF + n); NF += n
NOUT = ND + NT + 3


def dir_class(vf, vs):
    sp = np.hypot(vf, vs)
    k = (np.round(np.arctan2(vs, vf) / (np.pi / 4)).astype(int) % 8) + 1
    return np.where(sp < 0.5, 0, k)


def turn_class(d):
    k = np.searchsorted(TURN_EDGES, np.abs(d), side='right')
    return np.where(k == 0, 0, np.where(d > 0, k, k + 3))


def build():
    """Features and targets for all valid transitions; cached under /tmp/rec/mv/."""
    if os.path.exists(MV + 'x.f16'): return
    parts, offs, n = [], [], 0
    for tag in ('0', '1'):
        a = np.memmap(f'{DS}hmove-{tag}.f32', dtype=np.float32, mode='r'); a = a[: (a.size // NM) * NM].reshape(-1, NM)
        parts.append(a); offs.append(n); n += a.shape[0]
    tracks = load_tracks(offs={'hmove': offs, 'bmove': [0, 0], 'haim': [0, 0], 'baim': [0, 0]})['hmove']
    tid = np.full(n, -1, np.int32)
    for i, t in enumerate(tracks): tid[t['start']:t['start'] + t['n']] = i
    xs, ys, ms = open(MV + 'x.f16', 'wb'), open(MV + 'y.i8', 'wb'), open(MV + 'm.i32', 'wb')
    total = 0
    for si, a in enumerate(parts):
        r = np.array(a); nr = len(r); base = offs[si]
        t_id = tid[base:base + nr]
        dt = r[:, M['dt']].astype(np.float64)
        first = dt <= 0
        run = np.cumsum(first | (dt > 0.25))

        def lag(v, L, fill=0.0):
            out = np.full_like(v, fill); out[L:] = v[:-L]
            ok = np.zeros(nr, bool); ok[L:] = run[L:] == run[:-L]
            return np.where(ok, out, fill)
        f = np.zeros((nr, NF), np.float32)
        fl = r[:, M['flags']].astype(int)
        vf, vs, vy = r[:, M['vf']], r[:, M['vs']], r[:, M['vy']]
        yaw = r[:, M['yaw']].astype(np.float64)
        c = G['weapon'][0]; w = r[:, M['weapon']].astype(int)
        for k in range(8): f[:, c + k] = w == k
        c = G['motion'][0]
        for k, v in enumerate((vf / 8, vs / 8, vy / 8, np.hypot(vf, vs) / 8, (fl & 2) > 0, (fl & 4) > 0, (fl & 16) > 0)): f[:, c + k] = v
        c = G['own'][0]
        for k, v in enumerate(((fl & 8) > 0, (fl & 32) > 0, (fl & 64) > 0, (fl & 128) > 0, r[:, M['health']] / 100, r[:, M['pitch']] / 1.3)): f[:, c + k] = v
        c = G['enemy'][0]; has = r[:, M['nvDist']] >= 0
        for k, v in enumerate((has, np.where(has, np.log1p(np.maximum(r[:, M['nvDist']], 0)) / 5, 0), np.where(has, np.sin(r[:, M['nvBear']]), 0), np.where(has, np.cos(r[:, M['nvBear']]), 0), np.minimum(r[:, M['nVisible']], 3) / 3)): f[:, c + k] = v
        c = G['team'][0]; has = r[:, M['ntDist']] >= 0
        for k, v in enumerate((has, np.where(has, np.log1p(np.maximum(r[:, M['ntDist']], 0)) / 5, 0), np.where(has, np.sin(r[:, M['ntBear']]), 0), np.where(has, np.cos(r[:, M['ntBear']]), 0), np.minimum(r[:, M['nAllies']], 12) / 6, np.minimum(r[:, M['nEnemies']], 12) / 6)): f[:, c + k] = v
        c = G['objective'][0]
        for s, (dk, bk) in enumerate((('siteA', 'siteABear'), ('siteB', 'siteBBear'))):
            has = r[:, M[dk]] >= 0
            for k, v in enumerate((has, np.where(has, np.log1p(np.maximum(r[:, M[dk]], 0)) / 5, 0), np.where(has, np.sin(r[:, M[bk]]), 0), np.where(has, np.cos(r[:, M[bk]]), 0))): f[:, c + s * 4 + k] = v
        bomb = r[:, M['bomb']]
        f[:, c + 8] = bomb > 0; f[:, c + 9] = bomb < 0; f[:, c + 10] = np.where(bomb != 0, (np.abs(bomb) - 1) * 2 - 1, 0)
        mode = np.array([t['mode'] == 'sabotage' for t in tracks] + [False])[t_id]; team = np.array([t['team'] for t in tracks] + [0])[t_id]; size = np.array([t['size'] for t in tracks] + [6])[t_id]
        f[:, c + 11] = mode; f[:, c + 12] = team; f[:, c + 13] = size / 24
        f[:, G['time'][0]] = np.clip(r[:, M['left']] / 120, 0, 2)
        c = G['rays'][0]
        for k in range(8):
            ray = np.minimum(r[:, M['rays'] + k], 40); f[:, c + k * 2] = ray / 40; f[:, c + k * 2 + 1] = np.tanh(ray / 3)
        c = G['hurt'][0]; hurt = r[:, M['hurt']].astype(np.float64); h10 = hurt.copy()
        for L in range(1, 10): h10 += lag(hurt, L)
        f[:, c] = np.minimum(hurt, 100) / 100; f[:, c + 1] = np.minimum(h10, 200) / 100
        c = G['lags'][0]
        dy = np.arctan2(np.sin(yaw - lag(yaw, 1, np.nan)), np.cos(yaw - lag(yaw, 1, np.nan))); dy = np.nan_to_num(dy)
        dy3 = np.arctan2(np.sin(yaw - lag(yaw, 3, np.nan)), np.cos(yaw - lag(yaw, 3, np.nan))); dy3 = np.nan_to_num(dy3)
        for k, v in enumerate((lag(vf, 1) / 8, lag(vs, 1) / 8, lag(vf, 3) / 8, lag(vs, 3) / 8, np.tanh(dy / 0.3), np.tanh(dy3 / 0.6))): f[:, c + k] = v
        c = G['pos'][0]; mp = np.array([MAPS.index(t['map']) for t in tracks] + [0])[t_id]
        f[np.arange(nr), c + mp] = 1
        f[:, c + 13] = r[:, M['x']] / 100; f[:, c + 14] = r[:, M['y']] / 10; f[:, c + 15] = r[:, M['z']] / 100
        f[:, G['touch'][0]] = np.array([t['input'] == 'touch' for t in tracks] + [False])[t_id]
        # targets from the next row of the same run
        valid = np.zeros(nr, bool); valid[:-1] = (run[1:] == run[:-1]) & (t_id[1:] == t_id[:-1]) & (t_id[:-1] >= 0)
        y = np.zeros((nr, 7), np.int8)
        dnow = dir_class(vf, vs)
        dnext = np.zeros(nr, int); dnext[:-1] = dnow[1:]
        dyn = np.zeros(nr); dyn[:-1] = np.arctan2(np.sin(yaw[1:] - yaw[:-1]), np.cos(yaw[1:] - yaw[:-1])) * 0.1 / np.maximum(dt[1:], 0.05)
        y[:, 0] = dnext; y[:, 1] = turn_class(dyn)
        y[:-1, 2] = (fl[1:] & 4) > 0; y[:-1, 3] = (fl[1:] & 8) > 0; y[:-1, 4] = (fl[1:] & 2) == 0
        y[:, 5] = dnow; y[:, 6] = turn_class(dy)   # the classes now (for the copy baseline)
        idx = np.flatnonzero(valid)
        for a0 in range(0, len(idx), 200_000): np.clip(f[idx[a0:a0 + 200_000]], -4, 4).astype(np.float16).tofile(xs)
        y[idx].tofile(ys)
        pl = np.array([t['p'] for t in tracks] + [-1])[t_id]
        np.stack([idx + base, t_id[idx], pl[idx]], 1).astype(np.int32).tofile(ms)
        total += len(idx)
        del r, f
    for h in (xs, ys, ms): h.close()
    json.dump([{k: t[k] for k in ('p', 'n', 'input', 'map', 'mode', 'team', 'size')} for t in tracks], open(MV + 'tracks.json', 'w'))
    print('built', total, 'samples', flush=True)


class Net(nn.Module):
    def __init__(self, hidden=64, layers=2):
        super().__init__()
        seq, d = [], NF
        for _ in range(layers): seq += [nn.Linear(d, hidden), nn.ReLU()]; d = hidden
        seq.append(nn.Linear(d, NOUT)); self.net = nn.Sequential(*seq)

    def forward(self, x): return self.net(x)


ZERO = []


def batch(x, idx):
    xb = np.asarray(x[idx], dtype=np.float32)
    for a, b in ZERO: xb[:, a:b] = 0
    return torch.from_numpy(xb)


def losses(out, y):
    ce = nn.functional.cross_entropy; bce = nn.functional.binary_cross_entropy_with_logits
    return [ce(out[:, :ND], y[:, 0], reduction='none'), ce(out[:, ND:ND + NT], y[:, 1], reduction='none')] + [bce(out[:, ND + NT + k], y[:, 2 + k].float(), reduction='none') for k in range(3)]


@torch.no_grad()
def evaluate(model, x, y, idx, full=False):
    model.eval(); tot = np.zeros(5); n = 0; pd, pt = [], []
    for a in range(0, len(idx), 65536):
        i = idx[a:a + 65536]; out = model(batch(x, i)); yb = torch.from_numpy(y[i].astype(np.int64))
        tot += [l.sum().item() for l in losses(out, yb)]; n += len(i)
        if full: pd.append(torch.softmax(out[:, :ND], 1).numpy()); pt.append(torch.softmax(out[:, ND:ND + NT], 1).numpy())
    r = {'nll_dir': tot[0] / n, 'nll_turn': tot[1] / n, 'nll_flags': float(tot[2:].sum() / n), 'nll': float(tot.sum() / n), 'n': n}
    if full and n:
        from sklearn.metrics import roc_auc_score
        pd = np.concatenate(pd); pt = np.concatenate(pt); yy = y[idx]
        r['dir_top1'] = float((pd.argmax(1) == yy[:, 0]).mean()); r['dir_copy_acc'] = float((yy[:, 5] == yy[:, 0]).mean())
        ch = yy[:, 5] != yy[:, 0]
        r['dir_change_share'] = float(ch.mean())
        r['dir_change_auc'] = float(roc_auc_score(ch, 1 - pd[np.arange(len(yy)), yy[:, 5]]))
        # on the rows where the direction changes: is the new direction the model's first choice other than the direction now?
        p2 = pd[ch].copy(); p2[np.arange(ch.sum()), yy[ch, 5]] = -1
        r['dir_new_top1'] = float((p2.argmax(1) == yy[ch, 0]).mean())
        r['turn_top1'] = float((pt.argmax(1) == yy[:, 1]).mean())
        side = yy[:, 1] != 0
        pos = (yy[:, 1] >= 1) & (yy[:, 1] <= 3)
        r['turn_side_acc'] = float((((pt[:, 1:4].sum(1) - pt[:, 4:7].sum(1)) > 0)[side] == pos[side]).mean())
    return r


def train(x, y, tr, va, hidden, layers, seed, max_steps, bs=1024, lr=2e-3):
    torch.manual_seed(seed); rng = np.random.default_rng(seed)
    model = Net(hidden, layers); opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    every = int(min(600, max(100, len(tr) // bs)))
    best, best_state, bad, drops, step = 1e9, None, 0, 0, 0
    perm = rng.permutation(len(tr)); at = 0; t0 = time.time()
    va_s = va if len(va) <= 150_000 else np.sort(np.random.default_rng(5).choice(va, 150_000, replace=False))
    while step < max_steps:
        model.train()
        for _ in range(every):
            if at + bs > len(perm): perm = rng.permutation(len(tr)); at = 0
            i = np.sort(tr[perm[at:at + bs]]); at += bs
            loss = sum(losses(model(batch(x, i)), torch.from_numpy(y[i].astype(np.int64)))).mean()
            opt.zero_grad(); loss.backward(); opt.step(); step += 1
        v = evaluate(model, x, y, va_s)['nll']
        if v < best - 1e-4: best, bad = v, 0; best_state = {k: t.clone() for k, t in model.state_dict().items()}
        else:
            bad += 1
            if bad >= 3:
                drops += 1; bad = 0
                if drops > 2: break
                for g in opt.param_groups: g['lr'] *= 0.3
    model.load_state_dict(best_state)
    return model, {'steps': step, 'val_nll': best, 'seconds': round(time.time() - t0, 1)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('exp'); ap.add_argument('--hours', type=float, nargs='*', default=[0]); ap.add_argument('--seeds', type=int, nargs='*', default=[0])
    ap.add_argument('--hidden', type=int, default=64); ap.add_argument('--layers', type=int, default=2); ap.add_argument('--zero', default=''); ap.add_argument('--train', default='all'); ap.add_argument('--max_steps', type=int, default=15000)
    a = ap.parse_args()
    build()
    x = np.memmap(MV + 'x.f16', dtype=np.float16, mode='r').reshape(-1, NF); x = np.array(x)
    y = np.fromfile(MV + 'y.i8', dtype=np.int8).reshape(-1, 7); m = np.fromfile(MV + 'm.i32', dtype=np.int32).reshape(-1, 3)
    tracks = json.load(open(MV + 'tracks.json'))
    global ZERO
    ZERO = []
    for z in filter(None, a.zero.split('+')):
        ZERO += {'hist': [G['motion'], G['lags']], 'pos': [G['pos']], 'touch': [G['touch']]}[z]
    hrs = {}
    for t in tracks: hrs[t['p']] = hrs.get(t['p'], 0) + t['n'] / 36000
    order = sorted(hrs, key=lambda p: -hrs[p])
    part = {p: ('test' if r % 5 == 2 else 'val' if r % 10 == 4 else 'train') for r, p in enumerate(order)}
    touch = np.array([t['input'] == 'touch' for t in tracks]); tin = touch[m[:, 1]]
    pp = np.array([{'train': 0, 'val': 1, 'test': 2}[part[p]] for p in m[:, 2]])
    ok_in = np.ones(len(tracks), bool) if a.train == 'all' else (touch if a.train == 'touch' else ~touch)
    va = np.flatnonzero((pp == 1) & ok_in[m[:, 1]]); te = np.flatnonzero(pp == 2)
    te_mouse, te_touch = te[~tin[te]], te[tin[te]]
    tr_tracks = np.array([i for i, t in enumerate(tracks) if part[t['p']] == 'train' and ok_in[i]])
    th = np.array([tracks[i]['n'] / 36000 for i in tr_tracks])
    info = {'train_hours': float(th.sum()), 'test_hours_mouse': len(te_mouse) / 36000, 'test_hours_touch': len(te_touch) / 36000, 'players': {k: sum(1 for p in part if part[p] == k) for k in ('train', 'val', 'test')}}
    print('split', json.dumps(info), flush=True)
    ytr = y[(pp == 0)]
    prior = {}
    for name, idx in (('mouse', te_mouse), ('touch', te_touch)):
        pr = 0.0
        for k, nc in ((0, ND), (1, NT)):
            p = np.bincount(ytr[:, k], minlength=nc) / len(ytr); pr += float(-np.log(np.maximum(p[y[idx, k]], 1e-9)).mean())
        for k in (2, 3, 4):
            pf = ytr[:, k].mean(); pr += float(-(y[idx, k] * np.log(pf) + (1 - y[idx, k]) * np.log(1 - pf)).mean())
        prior[name] = pr
    print('prior', prior, flush=True)
    tid = m[:, 1]
    for seed in a.seeds:
        od = np.random.default_rng(1000 + seed).permutation(len(tr_tracks)); cum = np.cumsum(th[od])
        for hours in a.hours:
            if hours <= 0 or hours >= th.sum(): chosen, got = tr_tracks, float(th.sum())
            else:
                k = int(np.searchsorted(cum, hours)) + 1; chosen, got = tr_tracks[od[:k]], float(cum[k - 1])
            tr = np.flatnonzero((pp == 0) & np.isin(tid, chosen))
            n_pl = len({tracks[i]['p'] for i in chosen})
            model, st = train(x, y, tr, va, a.hidden, a.layers, seed, a.max_steps)
            rec = {'exp': a.exp, 'seed': seed, 'hours': got, 'players': n_pl, 'samples': int(len(tr)), 'hidden': a.hidden, 'layers': a.layers, 'zero': a.zero, 'train': a.train, **st,
                   'mouse': evaluate(model, x, y, te_mouse, True), 'touch': evaluate(model, x, y, te_touch, True), 'prior': prior, 'split': info}
            open(OUT, 'a').write(json.dumps(rec) + '\n')
            print(f"RESULT {a.exp} seed {seed} hours {got:.2f} players {n_pl} steps {st['steps']} {st['seconds']}s  mouse nll {rec['mouse']['nll']:.4f} dir {rec['mouse']['nll_dir']:.4f} new_top1 {rec['mouse']['dir_new_top1']:.3f} chgAUC {rec['mouse']['dir_change_auc']:.3f} | touch nll {rec['touch']['nll']:.4f} dir {rec['touch']['nll_dir']:.4f} new_top1 {rec['touch']['dir_new_top1']:.3f}", flush=True)
    print('DONE', a.exp, flush=True)


if __name__ == '__main__':
    main()
