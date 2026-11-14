import json, sys
R = '/home/user/workspace/repo/.amp/in/orb-backup/modcost/results/'
L = lambda n: json.load(open(R + n))
mod = L('module-deltas.json')
bun = {('m24','orb'): L('orb-paced-meridian.json'), ('m24','vm'): L('vm-paced-meridian.json'),
       ('t6','orb'): L('orb-paced-taipei.json'), ('t6','vm'): L('vm-paced-taipei.json')}
TICK = 1e6 / 30
out = {}
for room in ('m24', 't6'):
    o, v = bun[(room,'orb')], bun[(room,'vm')]
    simr = v['simUs']['mean'] / o['simUs']['mean']
    base_orb = mod[room]['off']['tick'] / mod[room]['off']['ticks']
    base_vm = base_orb * simr
    print(f"\n== {room}: Bun sim orb {o['simUs']['mean']} vm {v['simUs']['mean']} ratio {simr:.3f}; vm sim p95 {v['simUs']['p95']} p99 {v['simUs']['p99']}; late {v['lateTicks']}")
    print(f"module base tick orb {base_orb:.0f} us -> vm est {base_vm:.0f} us ({base_vm/TICK*100:.1f}% of tick)")
    out[room] = {'baseOrb': round(base_orb), 'baseVm': round(base_vm), 'simRatio': round(simr, 3), 'modes': {}}
    for m in ('rows1','rows6','full1','full6','all6','cap6'):
        d = mod[room][m]
        hook_orb = d['hook'] / d['ticks']; rows = d['rows'] / d['ticks']
        tick_orb = d['tick'] / d['ticks']
        bo, bv = o['aim']['modes'][m], v['aim']['modes'][m]
        r = bv['hookUs'] / bo['hookUs']
        # per-row ratio is the fairer one: both hosts ran the same match, so rows are the same
        hook_vm = hook_orb * r
        per_row_orb = hook_orb / rows; per_row_vm = per_row_orb * r
        tot = base_vm + hook_vm
        print(f"{m:6s} module orb: tick {tick_orb:6.0f} hook {hook_orb:6.0f} rows {rows:5.1f} ({per_row_orb:5.1f}/row) | bun hook orb {bo['hookUs']:7.1f} vm {bv['hookUs']:7.1f} ratio {r:.3f} | bun/row orb {bo['hookUs']/bo['rowsPerTick']:5.1f} vm {bv['hookUs']/bv['rowsPerTick']:5.1f} | module/bun per row (orb) {per_row_orb/(bo['hookUs']/bo['rowsPerTick']):.2f} | VM est hook {hook_vm:6.0f} ({per_row_vm:5.1f}/row) total {tot:6.0f} us = {tot/TICK*100:4.1f}% tick, {tot/TICK/0.5*100:4.0f}% of 0.5 vCPU")
        out[room]['modes'][m] = {'hookOrb': round(hook_orb), 'rows': round(rows,1), 'perRowOrb': round(per_row_orb,1), 'ratio': round(r,3), 'hookVm': round(hook_vm), 'perRowVm': round(per_row_vm,1), 'totalVm': round(tot), 'tickShare': round(tot/TICK,3)}
json.dump(out, open(R + 'vm-estimate.json', 'w'), indent=1)
# worst case: every bot alive
for room, n in (('m24', 47), ('t6', 11)):
    for m in ('full6','all6','cap6'):
        pr = out[room]['modes'][m]['perRowVm']
        print(f"{room} {m} all {n} bots alive: hook {pr*n:6.0f} us, total {out[room]['baseVm'] + pr*n:6.0f} us = {(out[room]['baseVm'] + pr*n)/TICK*100:4.1f}% tick")
