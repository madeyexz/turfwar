"""Table of the final runs in /tmp/rec/out/sim.jsonl: per configuration (tag before '@') the test team against the reference bots (skill 0.3)."""
import json, sys, collections
import numpy as np
runs = collections.defaultdict(list)
for line in open('/tmp/rec/out/sim.jsonl'):
    d = json.loads(line)
    if '@' not in d.get('tag', ''): continue
    name, side = d['tag'].rsplit('@', 1)
    runs[(name, d['size'], d['mode'])].append((d, int(side)))
only = sys.argv[1:] 
out = {}
print('%-22s %2s %4s %5s  %-13s %-13s %-15s %-13s %9s %7s' % ('config', 'sz', 'runs', 'rnds', 'kill share', 'round share', 'hit rate T / ref', 'dmg share', 'shots/min', 'ttk s'))
for (name, size, mode), rs in runs.items():
    if only and not any(o in name for o in only): continue
    K = D = W = L = sh = hi = osh = ohi = dm = odm = 0; al = 0.0; rounds = 0; ks = []; ws = []; ttk = []
    for d, side in rs:
        T, O = d[f'team{side}'], d[f'team{1 - side}']
        K += T['kills']; D += O['kills']; W += T['wins']; L += O['wins']; sh += T['shots']; hi += T['hits']; osh += O['shots']; ohi += O['hits']; dm += T['damage']; odm += O['damage']; al += T['aliveHours']; rounds += d['rounds']
        ks.append(T['kills'] / max(1, T['kills'] + O['kills'])); ws.append(T['wins'] / max(1, T['wins'] + O['wins'])); ttk.append(T['ttk'][1])
    se = lambda v: float(np.std(v, ddof=1) / np.sqrt(len(v))) if len(v) > 1 else 0.0
    r = {'size': size, 'mode': mode, 'runs': len(rs), 'rounds': rounds, 'kill_share': K / max(1, K + D), 'kill_share_se': se(ks), 'round_share': W / max(1, W + L), 'round_share_se': se(ws), 'hit_rate': hi / max(1, sh), 'ref_hit_rate': ohi / max(1, osh),
         'damage_share': dm / max(1, dm + odm), 'shots_per_min': sh / max(1e-9, al * 60), 'ttk_median': float(np.median(ttk)), 'kills': K, 'deaths': D, 'kill_shares': [round(k, 3) for k in ks]}
    out[f'{name}|{size}|{mode}'] = r
    print('%-22s %2d %4d %5d  %.3f ± %.3f %.3f ± %.3f %.3f / %.3f   %.3f %13.1f %7.2f' % (name, size, len(rs), rounds, r['kill_share'], r['kill_share_se'], r['round_share'], r['round_share_se'], r['hit_rate'], r['ref_hit_rate'], r['damage_share'], r['shots_per_min'], r['ttk_median']))
json.dump(out, open('/tmp/rec/out/final_table.json', 'w'), indent=1)
