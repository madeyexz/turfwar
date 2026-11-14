"""Write the committed human table of the bot bench: quantiles of the 26 aim-window features (taipei, MP5, mouse players),
their standard deviations, the human-against-human control, and the human totals of the headline measures.
Totals over players only: no player, segment or room identifier leaves this script."""
import json, sys
import numpy as np
from scipy.stats import wasserstein_distance
from disc import recorded, AIM, STATE
Q = 200
xh, ph, _ = recorded('haim')
np.savez('/tmp/rec/out/human_windows.npz', x=xh, p=ph)
u = (np.arange(Q) + 0.5) / Q
quant = np.quantile(xh.astype(np.float64), u, axis=0)  # (Q, 30)
sd = xh.std(0).astype(np.float64) + 1e-9
players = np.unique(ph)
ctl = []
for s in range(20):
    r = np.random.default_rng(100 + s); pl = players.copy(); r.shuffle(pl); g = set(pl[: len(pl) // 3].tolist()); m = np.array([p in g for p in ph])
    ctl.append(float(np.mean([wasserstein_distance(xh[m][:, i], xh[~m][:, i]) / sd[i] for i in range(len(AIM))])))
rec = json.load(open('/tmp/rec/out/metrics_recorded.json'))
dec = json.load(open('/tmp/rec/out/decisions.json'))
h, mm, mt = rec['human_aim'], rec['human_move_mouse'], rec['human_move_touch']
out = {
    'about': 'Human totals for scripts/botbench.ts, from the clean-v2 recordings of 2026-10-15 to 2026-11-10 (docs/RECORDING.md). Aim: mouse players, aim-clean. Totals only; no player data.',
    'windows': {'map': 'taipei', 'weapon': 'mp5', 'ticks': 90, 'step': 45, 'minVisible': 15, 'count': int(len(xh)), 'players': int(len(players))},
    'control': {'mean': round(float(np.mean(ctl)), 4), 'p05': round(float(np.percentile(ctl, 5)), 4), 'p95': round(float(np.percentile(ctl, 95)), 4)},
    'features': AIM,
    'sd': [round(float(v), 5) for v in sd[: len(AIM)]],
    'quantiles': [[round(float(v), 4) for v in quant[:, i]] for i in range(len(AIM))],
    'aim': {
        'hours': h['hours'], 'hitRate': h['hit_rate'], 'headShareOfHits': h['head_share_of_hits'], 'shotsPerMinute': h['shots_per_min'], 'shotsNoEnemyInSight': h['shots_no_enemy_in_sight'],
        'timeToFirstShot': h['time_to_first_shot'][2], 'timeToFirstCorrection': h['time_to_first_correction'][2], 'timeToOnTarget': h['time_to_on_target'][2], 'onTargetWithin3s': h['on_target_within_3s_share'],
        'turnSpeedEnemyMedian': h['turn_speed_enemy'][2], 'turnSpeedP999': h['turn_speed_p999'], 'aimStillShareEnemy': h['still_share_enemy'],
        'shotLateralErrorMedian': h['shot_lateral_error_m'][2], 'burstMedian': h['burst_shots'][2], 'burstP90': h['burst_shots'][4], 'pauseBetweenBursts': h['pause_between_bursts'][2],
        'adsShareEnemy': h['ads_share_enemy'], 'strafeShareEnemy': h['strafe_share_enemy'], 'stillBodyShareEnemy': h['still_body_share_enemy'],
    },
    'buy': {'soldierRounds': dec['rounds_with_loadout'], 'primaryShare': dec['primary_share'], 'changeShare': round(dec['primary_changes'] / dec['consecutive_round_pairs'], 4)},
    'move': {k: {'hours': m['hours'], 'stillShare': m['still_share'], 'sprintShare': m['sprint_share'], 'strafeFlipsPerSecondEnemy': m['strafe_flips_per_s_enemy'], 'nearestAllyMedian': m['nearest_ally_m'][2]} for k, m in (('mouse', mm), ('touch', mt))},
}
json.dump(out, open(sys.argv[1], 'w'), separators=(',', ':'))
print('windows', len(xh), 'players', len(players), 'control', out['control'])
