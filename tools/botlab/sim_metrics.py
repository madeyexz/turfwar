"""Aim metrics of sim row files beside the recorded human and recorded bot values. Usage: sim_metrics.py name[:label] ... [--save out.json]"""
import json, sys
import numpy as np
from ds import NA
from metrics import aim_metrics

KEYS = ['hours', 'vis_share', 'shots_per_min', 'hit_rate', 'head_share_of_hits', 'shots_no_enemy_in_sight', 'time_to_first_shot', 'shot_within_3s_share',
        'time_to_on_target', 'on_target_within_3s_share', 'time_to_first_correction', 'turn_speed_enemy', 'turn_speed_no_enemy', 'still_share_enemy', 'still_share_no_enemy', 'turn_speed_p99', 'turn_speed_p999',
        'peak_speed_off_0.12_0.3', 'shot_lateral_error_m', 'shots_within_0.3m_lateral', 'hit_rate_0_8m', 'hit_rate_8_15m', 'hit_rate_15_30m', 'burst_shots', 'burst_mean', 'burst_1_share', 'pause_between_bursts',
        'recoil_comp_ratio', 'fire_rows_share', 'ads_share_enemy', 'strafe_share_enemy', 'still_body_share_enemy', 'onsets_per_hour']

def load(path):
    a = np.fromfile(path, dtype=np.float32)
    return a[: (a.size // NA) * NA].reshape(-1, NA)

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    save = sys.argv[sys.argv.index('--save') + 1] if '--save' in sys.argv else None
    if save: args = [a for a in args if a != save]
    rec = json.load(open('/tmp/rec/out/metrics_recorded.json'))
    cols = {'human': rec['human_aim'], 'recbot': rec['recbot_aim']}
    for a in args:
        name, _, label = a.partition(':')
        rows = load(name)
        if len(rows) < 1000: print('too few rows', name, len(rows)); continue
        cols[label or name.split('/')[-1]] = aim_metrics(rows, with_recoil='proto' in name)
    names = list(cols)
    print('%-28s' % '' + ''.join('%-44s' % n[:42] for n in names))
    for k in KEYS:
        print('%-28s' % k[:27] + ''.join('%-44s' % (str(cols[n].get(k, ''))[:42]) for n in names))
    if save: json.dump(cols, open(save, 'w'), indent=1)
