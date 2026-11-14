"""Final headless runs: each named configuration on 3 maps x 2 sides, appended to /tmp/rec/out/sim.jsonl (tag = name@testTeam).
Usage: python final.py NAME [NAME ...] [--rounds 36] [--size 6] [--maps taipei,ochre,memorial] [--rows 1] [--extra "..."]"""
import subprocess, sys, json, os, time, argparse
OCN = '--model ocnoh-h29.7-s0-64x2 --zero 91:111'
CFG = {
    'bots0.3': ('none', '0.3'), 'bots0.15': ('none', '0.15'), 'bots0.45': ('none', '0.45'), 'bots0.6': ('none', '0.6'), 'bots0.9': ('none', '0.9'),
    # The new bot script (the repository's bots.ts) on the test side against the old script at 0.3, and against itself.
    'new0.15': ('new', '0.15'), 'new0.3': ('new', '0.3'), 'new0.45': ('new', '0.45'), 'new0.6': ('new', '0.6'), 'new0.9': ('new', '0.9'),
    'newnew0.3': ('newnew', '0.3'), 'newnew0.45': ('newnew', '0.45'), 'newnew0.6': ('newnew', '0.6'), 'newnew0.9': ('newnew', '0.9'), 'newnew0.15': ('newnew', '0.15'),
    'oldold0.3': ('none', '0.3'),
    'bc': ('proto', '--model lc-h29.7-s0-64x2'),
    'bc+rules': ('proto', '--model lc-h29.7-s0-64x2 --ads 1 --still 0'),
    'nohist': ('proto', '--model noh-h29.7-s0-64x2 --zero 91:111'),
    'outcome1': ('proto', '--model oc-h29.7-s0-64x2 --skill 1'),
    'both0': ('proto', OCN + ' --skill 0'),
    'both1': ('proto', OCN + ' --skill 1'),
    'both2': ('proto', OCN + ' --skill 2'),
    'both-1+ads': ('proto', OCN + ' --skill -1 --ads 1'),
    'both0+ads': ('proto', OCN + ' --skill 0 --ads 1'),
    'both1+ads': ('proto', OCN + ' --skill 1 --ads 1'),
    'both1+rules': ('proto', OCN + ' --skill 1 --ads 1 --still 0'),
    'both2+ads': ('proto', OCN + ' --skill 2 --ads 1'),
    'both2+rules': ('proto', OCN + ' --skill 2 --ads 1 --still 0'),
    'both3+rules': ('proto', OCN + ' --skill 3 --ads 1 --still 0'),
}
for h in ('0.5', '2.0', '8.0', '29.7'):
    for s in (0, 1):
        m = f'--model ocnoh-h{h}-s{s}-64x2 --zero 91:111'
        CFG[f'lc{h}s{s}@1'] = ('proto', m + ' --skill 1 --ads 1')
        CFG[f'lc{h}s{s}@2'] = ('proto', m + ' --skill 2 --ads 1 --still 0')
for h in ('0.5', '2.0', '8.0'):
    CFG[f'bch{h}'] = ('proto', f'--model lc-h{h}-s0-64x2')
ap = argparse.ArgumentParser(); ap.add_argument('names', nargs='+'); ap.add_argument('--rounds', type=int, default=36); ap.add_argument('--size', type=int, default=6)
ap.add_argument('--maps', default='taipei,ochre,memorial'); ap.add_argument('--rows', type=int, default=0); ap.add_argument('--extra', default=''); ap.add_argument('--suffix', default=''); ap.add_argument('--mode', default='elimination'); ap.add_argument('--loadout', default='mp5'); ap.add_argument('--seedbase', type=int, default=100)
a = ap.parse_args()
t0 = time.time()
for name in a.names:
    kind, spec = CFG[name]
    for mi, mp in enumerate(a.maps.split(',')):
        for side in (0, 1):
            seed = a.seedbase + mi * 10 + side
            cmd = f'bun run.ts --map {mp} --mode {a.mode} --size {a.size} --rounds {a.rounds} --seed {seed} --out /tmp/rec/out/sim.jsonl --tag {name}{a.suffix}@{side} {a.extra}'
            if a.loadout: cmd += f' --loadout {a.loadout}'
            if kind == 'none': cmd += ' --proto none --oldteam both --botskill ' + (f'{spec},0.3' if side == 0 else f'0.3,{spec}')
            elif kind == 'new': cmd += f' --proto none --oldteam {1 - side} --rowteam {side} --botskill ' + (f'{spec},0.3' if side == 0 else f'0.3,{spec}')
            elif kind == 'newnew': cmd += f' --proto none --oldteam none --botskill {spec},{spec}'
            else: cmd += f' --proto {side} {spec}'
            if a.rows and mp == 'taipei': cmd += f' --rows /tmp/rec/final/{name}{a.suffix}-{a.seedbase}-{side}'
            r = subprocess.run(cmd, shell=True, cwd='/tmp/botlab/sim', capture_output=True, text=True)
            try:
                d = json.loads(r.stdout.strip().splitlines()[-1]); T, O = d[f'team{side}'], d[f'team{1 - side}']
                print(f'{name}{a.suffix:8s} {mp:9s} side {side} rounds {d["rounds"]:3d} wins {T["wins"]:3d}/{O["wins"]:3d} K/D {T["kills"]:4d}/{T["deaths"]:4d} hit {T["hitRate"]:.3f} vs {O["hitRate"]:.3f} {d["wallSeconds"]}s  [{time.time() - t0:.0f}s]', flush=True)
            except Exception as e:
                print('FAILED', name, mp, side, r.stdout[-300:], r.stderr[-600:], flush=True)
print('DONE', flush=True)
