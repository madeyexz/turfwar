"""How much decision data the recordings hold: rounds, buys, bomb actions, site choices, and rounds with human team mates."""
import json, collections
import numpy as np
from ds import load_segs
segs = load_segs()
C = collections.Counter
out = {'segments': len(segs)}
hum = lambda s: [x for x in s['soldiers'] if not x['bot']]
out['human_soldier_rounds'] = sum(len(hum(s)) for s in segs)
out['human_soldier_rounds_clean'] = sum(1 for s in segs for x in hum(s) if x['tier'] == 'clean')
out['human_rounds_by_mode'] = dict(C(s['mode'] for s in segs for x in hum(s)))
out['human_rounds_by_input'] = dict(C(x.get('input') for s in segs for x in hum(s)))
# bomb actions
acts = C(); by = C(); site = collections.defaultdict(C); plant_t = {'human': [], 'bot': []}
sab = [s for s in segs if s['mode'] == 'sabotage']
att_h = def_h = 0
for s in sab:
    slot = {x['slot']: x for x in s['soldiers']}
    for x in hum(s):
        if x['team'] == s['attacker']: att_h += 1
        else: def_h += 1
    for b in s['bomb']:
        acts[b['a']] += 1
        who = slot.get(b['by'])
        if who is None: continue
        k = 'bot' if who['bot'] else 'human'
        by[(b['a'], k)] += 1
        if b['a'] == 'armed':
            site[(s['map'], k)][b['site']] += 1; plant_t[k].append(b['t'])
out['sabotage_segments'] = len(sab); out['bomb_actions'] = dict(acts); out['bomb_actions_by'] = {f'{a}/{k}': v for (a, k), v in by.items()}
out['human_attacker_rounds'] = att_h; out['human_defender_rounds'] = def_h
out['plant_time_median'] = {k: float(np.median(v)) if v else None for k, v in plant_t.items()}
out['human_plants_by_map_site'] = {m: dict(c) for (m, k), c in sorted(site.items()) if k == 'human'}
out['bot_plants_by_map_site'] = {m: dict(c) for (m, k), c in sorted(site.items()) if k == 'bot'}
# buys: the primary weapon of one player in consecutive rounds of one match (a change is a buy or a pick-up)
seq = collections.defaultdict(list)
for s in segs:
    for x in hum(s):
        if x.get('w0') is not None: seq[(s['match'], x['p'])].append((s['round'], x['w0'], x['w1'], x.get('att', 0), x['money0'], x['money1'], x.get('input')))
rounds_with_loadout = sum(len(v) for v in seq.values())
chg = C(); first = C(); n_pairs = 0; att_up = 0; money = []
for v in seq.values():
    v.sort()
    first[v[0][1]] += 1
    for a, b in zip(v, v[1:]):
        if b[0] != a[0] + 1: continue
        n_pairs += 1
        if b[1] != a[1]: chg[(a[1], b[1])] += 1
        if b[3] > a[3]: att_up += 1
    money += [r[4] for r in v]
out['player_matches'] = len(seq); out['rounds_with_loadout'] = rounds_with_loadout; out['consecutive_round_pairs'] = n_pairs
out['primary_changes'] = int(sum(chg.values())); out['primary_changes_top'] = {f'{a}>{b}': n for (a, b), n in chg.most_common(8)}
out['attachment_increases'] = att_up
out['primary_share'] = {k: round(v / rounds_with_loadout, 3) for k, v in C(r[1] for v in seq.values() for r in v).most_common()}
out['money_start_quantiles'] = np.percentile(money, [10, 50, 90]).tolist()
out['rounds_per_player_match_median'] = float(np.median([len(v) for v in seq.values()]))
# team play: humans on one team in one round
tm = C(); tm_h = C()
for s in segs:
    n = C(x['team'] for x in hum(s))
    k = max(n.values()) if n else 0
    tm[min(k, 4)] += 1; tm_h[min(k, 4)] += s['live'] * sum(n.values()) / 3600
out['segments_by_max_humans_on_a_team'] = dict(sorted(tm.items())); out['human_live_hours_by_max_humans_on_a_team'] = {k: round(v, 1) for k, v in sorted(tm_h.items())}
hh = C()
for s in segs:
    n = len(hum(s)); t = C(x['team'] for x in hum(s))
    if len(t) == 2: hh['humans on both teams'] += 1
    else: hh['humans on one team'] += 1
out['segments_humans_vs'] = dict(hh)
json.dump(out, open('/tmp/rec/out/decisions.json', 'w'), indent=1)
print(json.dumps(out, indent=1))
