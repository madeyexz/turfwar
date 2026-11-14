"""Human-or-agent test: a classifier two-sample test on 3 s aim windows (one weapon, one map, an enemy in sight for 0.5 s or more).
AUC 0.5 = the classifier cannot tell the agent from held-out humans; 1.0 = it always can.
Usage: python disc.py label=fileA[,fileB] ... [--save out.json]   (each agent: files of side 0 train the classifier, files of side 1 test it)"""
import json, sys
import numpy as np
import lightgbm as lgb
from sklearn.metrics import roc_auc_score
from ds import A, E, OWN, NA, load_rows, load_tracks
from metrics import runs_of

L, STEP, MINVIS, WEAPON, MAP = 90, 45, 15, 1, 'taipei'
AIM = ['zero_yaw', 'p50_yaw', 'p75_yaw', 'p90_yaw', 'max_yaw', 'mean_yaw', 'zero_pitch', 'p90_pitch', 'mean_pitch', 'autocorr_yaw', 'flip_rate', 'rough', 'fire_share', 'presses', 'longest_press', 'shots',
       'med_off', 'p10_off', 'on_target', 'med_off_pitch', 'follow', 'crossings', 'fire_off_target', 'hold_on_target', 'net_turn', 'path_ratio']
STATE = ['ads', 'speed', 'still', 'crouch']


def feats(rows, keep_rows=None):
    """Window features (n, len(AIM) + len(STATE)) and the first row of each window."""
    run = runs_of(rows)[0]
    n = len(rows)
    st = np.arange(0, n - L, STEP)
    st = st[run[st] == run[st + L - 1]]
    if keep_rows is not None: st = st[keep_rows[st] & keep_rows[st + L - 1]]
    ix = st[:, None] + np.arange(L)[None, :]
    vis = (rows[:, OWN + E['vis']] > 0)[ix]
    keep = (rows[:, A['weapon']][ix] == WEAPON).all(1) & (vis.sum(1) >= MINVIS)
    ix, vis, st = ix[keep], vis[keep], st[keep]
    g = lambda k: rows[:, k][ix].astype(np.float64)
    dy, dp = g(A['mdyaw']), g(A['mdpitch'])
    ay, apv = np.abs(dy), np.abs(dp)
    fire = g(A['fire']) > 0
    ey, ep = g(OWN + E['eyaw']), g(OWN + E['epc'])
    lg = lambda x: np.log10(x + 1e-4)
    f = {}
    f['zero_yaw'] = (ay < 5e-4).mean(1); f['p50_yaw'] = lg(np.percentile(ay, 50, axis=1)); f['p75_yaw'] = lg(np.percentile(ay, 75, axis=1)); f['p90_yaw'] = lg(np.percentile(ay, 90, axis=1))
    f['max_yaw'] = lg(ay.max(1)); f['mean_yaw'] = lg(ay.mean(1)); f['zero_pitch'] = (apv < 5e-4).mean(1); f['p90_pitch'] = lg(np.percentile(apv, 90, axis=1)); f['mean_pitch'] = lg(apv.mean(1))
    a, b = dy[:, :-1] - dy[:, :-1].mean(1, keepdims=True), dy[:, 1:] - dy[:, 1:].mean(1, keepdims=True)
    f['autocorr_yaw'] = (a * b).sum(1) / (np.sqrt((a * a).sum(1) * (b * b).sum(1)) + 1e-12)
    nz = (ay[:, :-1] >= 5e-4) & (ay[:, 1:] >= 5e-4)
    f['flip_rate'] = ((np.sign(dy[:, :-1]) != np.sign(dy[:, 1:])) & nz).sum(1) / np.maximum(1, nz.sum(1))
    f['rough'] = np.abs(np.diff(dy, axis=1)).mean(1) / (ay.mean(1) + 1e-4)
    f['fire_share'] = fire.mean(1); pr = (fire[:, 1:] & ~fire[:, :-1]).sum(1) + fire[:, 0]; f['presses'] = pr
    runlen = np.zeros(len(ix)); best = np.zeros(len(ix))
    for t in range(L): runlen = np.where(fire[:, t], runlen + 1, 0); best = np.maximum(best, runlen)
    f['longest_press'] = best / L; f['shots'] = g(A['shots']).sum(1)
    aey = np.where(vis, np.abs(ey), np.nan); aep = np.where(vis, np.abs(ep), np.nan)
    f['med_off'] = lg(np.nanmedian(aey, 1)); f['p10_off'] = lg(np.nanpercentile(aey, 10, axis=1)); f['on_target'] = np.nanmean(np.where(vis, np.abs(ey) < 0.03, np.nan), 1); f['med_off_pitch'] = lg(np.nanmedian(aep, 1))
    both = vis[:, :-1] & vis[:, 1:]
    x, y = np.where(both, ey[:, :-1], 0), np.where(both, dy[:, 1:], 0)
    f['follow'] = (x * y).sum(1) / ((x * x).sum(1) + 1e-6)  # the share of the yaw offset that the next tick's turn removes
    f['crossings'] = ((np.sign(ey[:, :-1]) != np.sign(ey[:, 1:])) & both).sum(1) / np.maximum(1, both.sum(1))
    f['fire_off_target'] = (fire & vis & (np.abs(ey) > 0.1)).sum(1) / np.maximum(1, (fire & vis).sum(1))
    on = vis & (np.abs(ey) < 0.03); f['hold_on_target'] = (on & ~fire).sum(1) / np.maximum(1, on.sum(1))
    f['net_turn'] = lg(np.abs(dy.sum(1))); f['path_ratio'] = np.abs(dy.sum(1)) / (ay.sum(1) + 1e-4)
    sp = g(A['speed'])
    f['ads'] = g(A['ads']).mean(1); f['speed'] = sp.mean(1); f['still'] = (sp < 0.5).mean(1); f['crouch'] = (g(A['crouch']) > 0.5).mean(1)
    return np.stack([f[k] for k in AIM + STATE], 1).astype(np.float32), st


def load(path):
    a = np.fromfile(path, dtype=np.float32)
    return a[: (a.size // NA) * NA].reshape(-1, NA)


def recorded(kind):
    """Windows of recorded rows on the map, with the player of each window (-1 for bots)."""
    rows, offs = load_rows(kind)
    tr = load_tracks(offs={'haim': offs if kind == 'haim' else [0, 0], 'baim': offs if kind == 'baim' else [0, 0], 'hmove': [0, 0], 'bmove': [0, 0]})[kind]
    keep = np.zeros(len(rows), bool); pid = np.full(len(rows), -1, dtype=np.int32); seg = np.zeros(len(rows), dtype=np.int32)
    for i, t in enumerate(tr):
        if t['map'] == MAP: keep[t['start']:t['start'] + t['n']] = True
        pid[t['start']:t['start'] + t['n']] = t.get('p', -1); seg[t['start']:t['start'] + t['n']] = i
    x, st = feats(rows, keep)
    return x, pid[st], seg[st]


def c2st(xh_tr, xh_te, xa_tr, xa_te, cols, seed=0):
    rng = np.random.default_rng(seed)
    def bal(a, b):
        n = min(len(a), len(b)); return a[rng.choice(len(a), n, replace=False)], b[rng.choice(len(b), n, replace=False)]
    a, b = bal(xh_tr, xa_tr); c, d = bal(xh_te, xa_te)
    X = np.concatenate([a, b])[:, cols]; y = np.r_[np.ones(len(a)), np.zeros(len(b))]
    Xt = np.concatenate([c, d])[:, cols]; yt = np.r_[np.ones(len(c)), np.zeros(len(d))]
    m = lgb.LGBMClassifier(n_estimators=200, learning_rate=0.05, num_leaves=15, min_child_samples=20, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, verbose=-1, random_state=seed, n_jobs=2)
    m.fit(X, y)
    p = m.predict_proba(Xt)[:, 1]
    auc = float(roc_auc_score(yt, p))
    thr = float(np.median(p[yt == 1]))  # half of the held-out human windows score above this
    imp = sorted(zip(m.feature_importances_.tolist(), [(AIM + STATE)[k] for k in cols]), reverse=True)[:5]
    return {'auc': round(auc, 4), 'pass_at_human_median': round(float((p[yt == 0] >= thr).mean()), 4), 'n_train': len(y), 'n_test': len(yt), 'top': [k for _, k in imp]}


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if '=' in a]
    save = sys.argv[sys.argv.index('--save') + 1] if '--save' in sys.argv else None
    xh, ph, _ = recorded('haim')
    players = np.unique(ph); rng = np.random.default_rng(7); rng.shuffle(players)
    te_p = set(players[: len(players) // 3].tolist())
    is_te = np.array([p in te_p for p in ph])
    print('human windows', len(xh), 'players', len(players), 'test players', len(te_p), 'test windows', int(is_te.sum()), flush=True)
    xb, _, sb = recorded('baim')
    half = sb % 2 == 0
    agents = {'recorded bots': (xb[half], xb[~half])}
    for a in args:
        label, files = a.split('=')
        fs = files.split(',')
        tr = np.concatenate([feats(load(f))[0] for f in fs[: max(1, len(fs) // 2)]]); te = np.concatenate([feats(load(f))[0] for f in fs[len(fs) // 2:]]) if len(fs) > 1 else None
        if te is None: h = len(tr) // 2; tr, te = tr[:h], tr[h:]
        agents[label] = (tr, te)
    out = {'human_windows': int(len(xh)), 'human_players': int(len(players))}
    aim_cols = list(range(len(AIM))); all_cols = list(range(len(AIM) + len(STATE)))
    # control: held-out humans against the other humans (labels by player group; the AUC must be near 0.5)
    tr_p = [p for p in players if p not in te_p]; ga = set(tr_p[::2]); gb = set(te_p)
    xa_tr = xh[np.array([p in ga for p in ph])]; xo_tr = xh[np.array([(p not in ga) and (p not in te_p) for p in ph])]
    te_list = sorted(te_p); g1 = set(te_list[::2])
    xa_te = xh[np.array([p in g1 for p in ph])]; xo_te = xh[np.array([(p in te_p) and (p not in g1) for p in ph])]
    out['other humans (control)'] = {'aim': c2st(xo_tr, xo_te, xa_tr, xa_te, aim_cols), 'aim+state': c2st(xo_tr, xo_te, xa_tr, xa_te, all_cols)}
    print('%-26s windows %6d/%6d  AUC aim %.3f  aim+state %.3f' % ('other humans (control)', len(xa_tr), len(xa_te), out['other humans (control)']['aim']['auc'], out['other humans (control)']['aim+state']['auc']), flush=True)
    for label, (tr, te) in agents.items():
        r = {'aim': c2st(xh[~is_te], xh[is_te], tr, te, aim_cols), 'aim+state': c2st(xh[~is_te], xh[is_te], tr, te, all_cols), 'windows': [int(len(tr)), int(len(te))],
             'medians': {k: round(float(np.median(np.concatenate([tr, te])[:, i])), 4) for i, k in enumerate(AIM + STATE)}}
        out[label] = r
        print('%-26s windows %6d/%6d  AUC aim %.3f (pass %.2f)  aim+state %.3f (pass %.2f)  top %s' % (label, len(tr), len(te), r['aim']['auc'], r['aim']['pass_at_human_median'], r['aim+state']['auc'], r['aim+state']['pass_at_human_median'], r['aim']['top']), flush=True)
    out['human_medians'] = {k: round(float(np.median(xh[:, i])), 4) for i, k in enumerate(AIM + STATE)}
    if save: json.dump(out, open(save, 'w'), indent=1)
