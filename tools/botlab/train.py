"""Behavior cloning of the mouse aim change and the fire key (small MLP), with players held out.

Usage: python train.py <experiment> [options]. Results go to /tmp/rec/out/train.jsonl, weights to /tmp/rec/models/."""
import argparse, json, os, time
import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import roc_auc_score, average_precision_score
import feat
from ds import A, NA, WEAPONS

P = '/tmp/rec/ds/feat_haim'
OUT = '/tmp/rec/out/train.jsonl'
MODELS = '/tmp/rec/models/'
os.makedirs(MODELS, exist_ok=True)
torch.set_num_threads(2)
NIN = feat.NF + 1  # the features and the skill input
ZERO = None  # (a, b): feature columns set to zero in training and test (an ablation)
ADS = False  # a fourth output: the sights key of the next row
HISTDROP = 0.0  # share of the training samples whose own aim changes before (columns 91:111) are set to zero

# Features that change sign when the scene is mirrored left to right (see feat.py for the order).
FLIP = np.ones(NIN, dtype=np.float32)
FLIP[12] = -1
for j in range(3):
    for k in (3, 4, 5): FLIP[21 + j * 11 + k] = -1
for k in range(8): FLIP[54 + k * 3 + 1] = -1
for k in range(3): FLIP[78 + k * 2] = -1
for k in range(4): FLIP[91 + k * 4] = -1; FLIP[91 + k * 4 + 1] = -1
for k in range(2): FLIP[107 + k * 2] = -1
PERM = np.arange(feat.NC); PERM[1:1 + feat.NB] = np.arange(1 + feat.NB, feat.NC); PERM[1 + feat.NB:] = np.arange(1, 1 + feat.NB)


def load():
    x = np.fromfile(P + '.x.f16', dtype=np.float16).reshape(-1, feat.NF)
    y = np.fromfile(P + '.y.i16', dtype=np.int16).reshape(-1, 3).astype(np.int64)
    m = np.fromfile(P + '.m.i32', dtype=np.int32).reshape(-1, 3)
    tracks = json.load(open('/tmp/rec/ds/feat_haim.tracks.json'))
    return x, y, m, tracks


def player_skill(tracks):
    """One number per player in [-1, 1]: the rank of the hit rate against the rate expected from the weapons used (weighted by rows)."""
    path = '/tmp/rec/ds/skill.json'
    if os.path.exists(path): return {int(k): v for k, v in json.load(open(path)).items()}
    rows = []
    for tag in ('0', '1'):
        a = np.memmap(f'/tmp/rec/ds/haim-{tag}.f32', dtype=np.float32, mode='r').reshape(-1, NA)
        rows.append(np.array(a[:, [A['shots'], A['hits'], A['weapon']]]))
    r = np.concatenate(rows)
    w = r[:, 2].astype(int)
    rate = np.array([r[w == k, 1].sum() / max(1.0, r[w == k, 0].sum()) for k in range(8)])
    exp_row = r[:, 0] * rate[w]
    hit, exp, n = {}, {}, {}
    for t in tracks:
        s = slice(t['start'], t['start'] + t['n'])
        p = t['p']
        hit[p] = hit.get(p, 0) + float(r[s, 1].sum()); exp[p] = exp.get(p, 0) + float(exp_row[s].sum()); n[p] = n.get(p, 0) + t['n']
    ps = sorted(hit)
    ratio = np.array([(hit[p] + 5) / (exp[p] + 5) for p in ps]); wgt = np.array([n[p] for p in ps], dtype=np.float64)
    order = np.argsort(ratio)
    cum = (np.cumsum(wgt[order]) - wgt[order] / 2) / wgt.sum()
    skill = np.empty(len(ps)); skill[order] = cum * 2 - 1
    out = {int(p): round(float(s), 4) for p, s in zip(ps, skill)}
    json.dump(out, open(path, 'w'))
    json.dump({'weapon_rate': rate.tolist(), 'ratio_quantiles': np.percentile(ratio, [5, 25, 50, 75, 95]).tolist()}, open('/tmp/rec/ds/skill_meta.json', 'w'))
    return out


def split(tracks):
    """Players by hours, in order: every fifth to the test set, every tenth to validation, the others to training."""
    hrs = {}
    for t in tracks: hrs[t['p']] = hrs.get(t['p'], 0) + t['n'] / 108000
    order = sorted(hrs, key=lambda p: -hrs[p])
    part = {}
    for r, p in enumerate(order): part[p] = 'test' if r % 5 == 2 else 'val' if r % 10 == 4 else 'train'
    return part, hrs


def outcome(m, tracks, horizon, need):
    """Per sample: the hits in the next `horizon` rows of the same track, scaled to [-1, 1] (+1 at `need` hits or more)."""
    parts = []
    for tag in ('0', '1'):
        a = np.memmap(f'/tmp/rec/ds/haim-{tag}.f32', dtype=np.float32, mode='r').reshape(-1, NA)
        parts.append(np.array(a[:, A['hits']], dtype=np.float64))
    cs = np.concatenate([[0.0], np.cumsum(np.concatenate(parts))])
    end = np.array([t['start'] + t['n'] for t in tracks], dtype=np.int64)[m[:, 1]]
    g = m[:, 0].astype(np.int64)
    fut = cs[np.minimum(g + 1 + horizon, end)] - cs[np.minimum(g + 1, end)]
    return (np.clip(fut / need, 0, 1) * 2 - 1).astype(np.float32), fut


class Net(nn.Module):
    def __init__(self, hidden=64, layers=2):
        super().__init__()
        seq, d = [], NIN
        for _ in range(layers): seq += [nn.Linear(d, hidden), nn.ReLU()]; d = hidden
        seq.append(nn.Linear(d, 2 * feat.NC + (2 if ADS else 1)))
        self.net = nn.Sequential(*seq)

    def forward(self, x): return self.net(x)


def batch(x, sk, idx, mirror=None):
    xb = np.empty((len(idx), NIN), dtype=np.float32)
    xb[:, :feat.NF] = x[idx]; xb[:, feat.NF] = sk[idx]
    np.clip(xb, -2, 2, out=xb)
    if ZERO: xb[:, ZERO[0]:ZERO[1]] = 0
    if mirror is not None: xb[mirror] *= FLIP
    return torch.from_numpy(xb)


def losses(out, y):
    ce = nn.functional.cross_entropy
    bce = nn.functional.binary_cross_entropy_with_logits
    lf = bce(out[:, 2 * feat.NC], y[:, 2].float(), reduction='none')
    if ADS: lf = lf + bce(out[:, 2 * feat.NC + 1], y[:, 3].float(), reduction='none')
    return ce(out[:, :feat.NC], y[:, 0], reduction='none'), ce(out[:, feat.NC:2 * feat.NC], y[:, 1], reduction='none'), lf


@torch.no_grad()
def evaluate(model, x, y, sk, idx, full=False):
    model.eval()
    tot = np.zeros(3); n = 0
    pf, sy, py = [], [], []
    for a in range(0, len(idx), 65536):
        i = idx[a:a + 65536]
        out = model(batch(x, sk, i)); yb = torch.from_numpy(y[i])
        ly, lp, lf = losses(out, yb)
        tot += [ly.sum().item(), lp.sum().item(), lf.sum().item()]; n += len(i)
        if full:
            pf.append(torch.sigmoid(out[:, 2 * feat.NC]).numpy())
            pr = torch.softmax(out[:, :feat.NC], 1).numpy()
            sy.append(pr[:, 1:1 + feat.NB].sum(1) - pr[:, 1 + feat.NB:].sum(1)); py.append(pr.argmax(1))
    r = {'nll_yaw': tot[0] / n, 'nll_pitch': tot[1] / n, 'nll_fire': tot[2] / n, 'nll': tot.sum() / n, 'n': n}
    if full:
        pf, sy, py = np.concatenate(pf), np.concatenate(sy), np.concatenate(py)
        yy = y[idx]; xf = x[idx]
        up = xf[:, 111] == 0  # the fire key is up now: does it go down in the next row?
        r['fire_auc'] = float(roc_auc_score(yy[:, 2], pf))
        r['press_auc'] = float(roc_auc_score(yy[up, 2], pf[up])); r['press_ap'] = float(average_precision_score(yy[up, 2], pf[up])); r['press_base'] = float(yy[up, 2].mean())
        dn = ~up
        r['release_auc'] = float(roc_auc_score(1 - yy[dn, 2], 1 - pf[dn]))
        r['yaw_top1'] = float((py == yy[:, 0]).mean())
        # the side of the yaw change when the first enemy is in sight and off the crosshair
        off = (xf[:, 21] > 0) & (np.abs(xf[:, 26].astype(np.float32)) * np.pi > 0.05) & (yy[:, 0] != 0)
        pos = (yy[:, 0] >= 1) & (yy[:, 0] <= feat.NB)
        r['yaw_side_acc'] = float(((sy[off] > 0) == pos[off]).mean()); r['yaw_side_n'] = int(off.sum())
        toward = np.sign(xf[off, 26].astype(np.float32)) > 0
        r['human_toward_share'] = float((toward == pos[off]).mean())
    return r


def train(x, y, sk, tr, va, hidden=64, layers=2, seed=0, mirror=False, bs=1024, lr=2e-3, max_steps=30000, log=None):
    torch.manual_seed(seed); rng = np.random.default_rng(seed)
    model = Net(hidden, layers)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    every = int(min(600, max(100, len(tr) // bs)))
    best, best_state, bad, drops, step = 1e9, None, 0, 0, 0
    perm = rng.permutation(len(tr)); at = 0
    yperm = torch.from_numpy(PERM)
    t0 = time.time()
    while step < max_steps:
        model.train()
        for _ in range(every):
            if at + bs > len(perm): perm = rng.permutation(len(tr)); at = 0
            i = np.sort(tr[perm[at:at + bs]]); at += bs
            mm = rng.random(len(i)) < 0.5 if mirror else None
            xb = batch(x, sk, i, mm); yb = torch.from_numpy(y[i])
            if HISTDROP > 0: xb[torch.from_numpy(rng.random(len(i)) < HISTDROP), 91:111] = 0
            if mirror: yb[:, 0] = torch.where(torch.from_numpy(mm), yperm[yb[:, 0]], yb[:, 0])
            ly, lp, lf = losses(model(xb), yb)
            loss = (ly + lp + lf).mean()
            opt.zero_grad(); loss.backward(); opt.step(); step += 1
        v = evaluate(model, x, y, sk, va)['nll']
        if v < best - 1e-4: best, bad = v, 0; best_state = {k: t.clone() for k, t in model.state_dict().items()}
        else:
            bad += 1
            if bad >= 3:
                drops += 1; bad = 0
                if drops > 2: break
                for g in opt.param_groups: g['lr'] *= 0.3
        if log: log(f'  step {step} val {v:.4f} best {best:.4f} lr {opt.param_groups[0]["lr"]:.5f} {time.time() - t0:.0f}s')
    model.load_state_dict(best_state)
    return model, {'steps': step, 'val_nll': best, 'seconds': round(time.time() - t0, 1)}


def export(model, name, meta):
    """Weights as one float32 file (each layer: weights row by row, then the biases) and a JSON with the sizes."""
    lin = [m for m in model.net if isinstance(m, nn.Linear)]
    parts = []
    for l in lin: parts += [l.weight.detach().numpy().astype(np.float32).ravel(), l.bias.detach().numpy().astype(np.float32)]
    np.concatenate(parts).tofile(MODELS + name + '.bin')
    json.dump({'sizes': [NIN] + [l.out_features for l in lin], 'ads': ADS, 'nc': feat.NC, 'nb': feat.NB, 'edges': feat.EDGES.tolist(), **meta}, open(MODELS + name + '.json', 'w'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('exp'); ap.add_argument('--hours', type=float, nargs='*', default=[0]); ap.add_argument('--hidden', type=int, default=64); ap.add_argument('--layers', type=int, default=2)
    ap.add_argument('--seeds', type=int, nargs='*', default=[0]); ap.add_argument('--mirror', type=int, default=0); ap.add_argument('--max_steps', type=int, default=30000); ap.add_argument('--save', type=int, default=1)
    ap.add_argument('--zero', default=''); ap.add_argument('--cond', default='skill'); ap.add_argument('--horizon', type=int, default=45); ap.add_argument('--need', type=float, default=3); ap.add_argument('--histdrop', type=float, default=0); ap.add_argument('--ads', type=int, default=0)
    a = ap.parse_args()
    x, y, m, tracks = load()
    skill = player_skill(tracks)
    part, hrs = split(tracks)
    sk = np.array([skill[p] for p in m[:, 2]], dtype=np.float32)
    global ZERO, HISTDROP, ADS
    HISTDROP = a.histdrop; ADS = bool(a.ads)
    if ADS:
        # the sights key of the row after each sample's row
        key = np.concatenate([np.array(np.memmap(f'/tmp/rec/ds/haim-{tag}.f32', dtype=np.float32, mode='r').reshape(-1, NA)[:, A['aimkey']]) for tag in ('0', '1')])
        y = np.concatenate([y, (key[m[:, 0].astype(np.int64) + 1] > 0).astype(np.int64)[:, None]], 1)
        print('ads key share', round(float(y[:, 3].mean()), 4), 'changes per 1000 rows', round(float((y[:, 3] != (x[:, 8] > 0)).mean() * 1000), 2), flush=True)
    if a.zero: ZERO = tuple(int(v) for v in a.zero.split(':')); print('zero features', ZERO, flush=True)
    if a.cond == 'outcome':
        sk, fut = outcome(m, tracks, a.horizon, a.need)
        print('outcome: horizon', a.horizon, 'need', a.need, 'share with 1+ hits', round(float((fut >= 1).mean()), 4), 'with need+', round(float((fut >= a.need).mean()), 4), 'mean input', round(float(sk.mean()), 4), flush=True)
    pp = np.array([{'train': 0, 'val': 1, 'test': 2}[part[p]] for p in m[:, 2]])
    va, te = np.flatnonzero(pp == 1), np.flatnonzero(pp == 2)
    tr_tracks = [i for i, t in enumerate(tracks) if part[t['p']] == 'train']
    th = np.array([tracks[i]['n'] / 108000 for i in tr_tracks])
    info = {'train_hours': float(th.sum()), 'val_hours': sum(h for p, h in hrs.items() if part[p] == 'val'), 'test_hours': sum(h for p, h in hrs.items() if part[p] == 'test'),
            'players': {k: sum(1 for p in part if part[p] == k) for k in ('train', 'val', 'test')}, 'samples': {'train': int((pp == 0).sum()), 'val': len(va), 'test': len(te)}}
    print('split', json.dumps(info), flush=True)
    # the losses of the class shares alone (no input)
    ytr = y[pp == 0]
    prior = {}
    for k, name in ((0, 'yaw'), (1, 'pitch')):
        p = np.bincount(ytr[:, k], minlength=feat.NC) / len(ytr); prior['nll_' + name] = float(-np.log(np.maximum(p[y[te, k]], 1e-9)).mean())
    pf = ytr[:, 2].mean(); prior['nll_fire'] = float(-(y[te, 2] * np.log(pf) + (1 - y[te, 2]) * np.log(1 - pf)).mean()); prior['nll'] = prior['nll_yaw'] + prior['nll_pitch'] + prior['nll_fire']
    # copy the fire key of the row before
    prior['fire_copy_acc'] = float(((x[te, 111] > 0) == (y[te, 2] > 0)).mean())
    print('prior', json.dumps(prior), flush=True)
    tid = m[:, 1]
    for seed in a.seeds:
        order = np.random.default_rng(1000 + seed).permutation(len(tr_tracks))
        cum = np.cumsum(th[order])
        for hours in a.hours:
            if hours <= 0 or hours >= th.sum(): chosen, got = set(tr_tracks), float(th.sum())
            else:
                k = int(np.searchsorted(cum, hours)) + 1
                chosen, got = set(np.array(tr_tracks)[order[:k]].tolist()), float(cum[k - 1])
            tr = np.flatnonzero((pp == 0) & np.isin(tid, np.fromiter(chosen, dtype=np.int64)))
            n_pl = len({tracks[i]['p'] for i in chosen})
            print(f'{a.exp} seed {seed} hours {got:.2f} tracks {len(chosen)} players {n_pl} samples {len(tr)} hidden {a.hidden}x{a.layers} mirror {a.mirror}', flush=True)
            model, st = train(x, y, sk, tr, va, a.hidden, a.layers, seed, bool(a.mirror), max_steps=a.max_steps, log=lambda s: print(s, flush=True))
            r = evaluate(model, x, y, sk, te, full=True)
            params = sum(p.numel() for p in model.parameters())
            rec = {'exp': a.exp, 'seed': seed, 'hours': got, 'tracks': len(chosen), 'players': n_pl, 'samples': int(len(tr)), 'hidden': a.hidden, 'layers': a.layers, 'mirror': a.mirror, 'zero': a.zero, 'cond': a.cond, 'horizon': a.horizon, 'need': a.need, 'params': params, **st, 'test': r, 'prior': prior, 'split': info}
            open(OUT, 'a').write(json.dumps(rec) + '\n')
            print('RESULT', json.dumps({k: (round(v, 4) if isinstance(v, float) else v) for k, v in r.items()}), st, flush=True)
            if a.save: export(model, f'{a.exp}-h{got:.1f}-s{seed}-{a.hidden}x{a.layers}', {'hours': got, 'test': r})
    print('DONE', a.exp, flush=True)


if __name__ == '__main__':
    main()
