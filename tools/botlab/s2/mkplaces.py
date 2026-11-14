"""Lab: write the human places (cells of the late-round dwell, Elimination 6v6) as a TypeScript table for the lab copy.
Usage: python mkplaces.py N out.ts   (the N cells with the most time, per map and team; [x, y, z, share])"""
import json, sys
H = json.load(open('/tmp/rec/out/visits_elim.json')); N = int(sys.argv[1])
out = {}
for mp, sides in H.items():
    out[mp] = {}
    for t, c in sides.items():
        cells = c['cells'][:N]; tot = sum(a[3] for a in cells)
        out[mp][t] = [[a[0], a[1], a[2], round(a[3] / tot, 4)] for a in cells]
open(sys.argv[2], 'w').write('export const PLACES: Record<string, Record<number, number[][]>> = ' + json.dumps(out, separators=(',', ':')) + ';\n')
print('maps', len(out), 'bytes', len(json.dumps(out, separators=(',', ':'))))
