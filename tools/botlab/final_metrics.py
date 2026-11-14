"""Final metric table and a graded human-likeness distance on the same row files as the human-or-agent test.
- aim_metrics per agent (the files of one agent are joined; each file starts a new run).
- distance: for each aim window feature, the Wasserstein-1 distance between the agent's windows and the human windows,
  divided by the human standard deviation of that feature; the mean over the features. Control = held-out players against the other players.
Usage: python final_metrics.py label=f1,f2,... [...] --save out.json"""
import json, sys
import numpy as np
from scipy.stats import wasserstein_distance
from ds import NA
from metrics import aim_metrics
from disc import feats, load, recorded, AIM, STATE

KEYS = ['hours', 'vis_share', 'shots_per_min', 'hit_rate', 'head_share_of_hits', 'shots_no_enemy_in_sight', 'time_to_first_shot', 'shot_within_3s_share',
        'time_to_on_target', 'on_target_within_3s_share', 'time_to_first_correction', 'turn_speed_enemy', 'still_share_enemy', 'turn_speed_p99', 'turn_speed_p999',
        'shot_lateral_error_m', 'shots_within_0.3m_lateral', 'hit_rate_0_8m', 'hit_rate_8_15m', 'hit_rate_15_30m', 'burst_shots', 'burst_mean', 'pause_between_bursts',
        'recoil_comp_ratio', 'fire_rows_share', 'ads_share_enemy', 'strafe_share_enemy', 'still_body_share_enemy', 'onsets_per_hour']


def dist(xa, xh, sd, cols):
    d = [wasserstein_distance(xa[:, i], xh[:, i]) / sd[i] for i in cols]
    return float(np.mean(d)), d


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if '=' in a]
    save = sys.argv[sys.argv.index('--save') + 1] if '--save' in sys.argv else None
    xh, ph, _ = recorded('haim')
    players = np.unique(ph); rng = np.random.default_rng(7); rng.shuffle(players)
    te_p = set(players[: len(players) // 3].tolist())
    is_te = np.array([p in te_p for p in ph])
    sd = xh.std(0) + 1e-9
    aim_cols = list(range(len(AIM)))
    xb, _, _ = recorded('baim')
    out = {'features': AIM, 'agents': {}}
    c, cd = dist(xh[is_te], xh[~is_te], sd, aim_cols)
    # the spread of the control over random player splits
    ctl = []
    for s in range(20):
        r = np.random.default_rng(100 + s); pl = players.copy(); r.shuffle(pl); g = set(pl[: len(pl) // 3].tolist()); m = np.array([p in g for p in ph])
        ctl.append(dist(xh[m], xh[~m], sd, aim_cols)[0])
    out['control'] = {'distance': round(c, 4), 'splits_mean': round(float(np.mean(ctl)), 4), 'splits_p05_p95': [round(float(np.percentile(ctl, 5)), 4), round(float(np.percentile(ctl, 95)), 4)]}
    print('control (held-out players against the others): %.3f; 20 random splits mean %.3f, p05-p95 %.3f-%.3f' % (c, np.mean(ctl), np.percentile(ctl, 5), np.percentile(ctl, 95)), flush=True)
    b, bd = dist(xb, xh, sd, aim_cols)
    out['agents']['recorded bots'] = {'distance': round(b, 4), 'windows': int(len(xb)), 'worst': [AIM[i] for i in np.argsort(bd)[::-1][:5]]}
    print('%-22s distance %.3f  worst %s' % ('recorded bots', b, out['agents']['recorded bots']['worst']), flush=True)
    rec = json.load(open('/tmp/rec/out/metrics_recorded.json'))
    cols = {'human': rec['human_aim'], 'recbot': rec['recbot_aim']}
    for a in args:
        label, files = a.split('=')
        fs = files.split(',')
        rows = np.concatenate([load(f) for f in fs])
        x = feats(rows)[0]
        d, dd = dist(x, xh, sd, aim_cols)
        halves = [dist(feats(load(f))[0], xh, sd, aim_cols)[0] for f in fs]
        out['agents'][label] = {'distance': round(d, 4), 'per_file': [round(v, 4) for v in halves], 'windows': int(len(x)), 'worst': [AIM[i] for i in np.argsort(dd)[::-1][:5]], 'per_feature': [round(v, 3) for v in dd]}
        print('%-22s distance %.3f  per file %s  windows %d  worst %s' % (label, d, [round(v, 3) for v in halves], len(x), out['agents'][label]['worst']), flush=True)
        cols[label] = aim_metrics(rows, with_recoil='proto' in fs[0])
    names = list(cols)
    print()
    print('%-28s' % '' + ''.join('%-34s' % n[:32] for n in names))
    for k in KEYS:
        print('%-28s' % k[:27] + ''.join('%-34s' % (str(cols[n].get(k, ''))[:32]) for n in names))
    out['metrics'] = cols
    if save: json.dump(out, open(save, 'w'), indent=1)
