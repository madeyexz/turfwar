"""Where the still time and the ally distance of the players come from, by the round clock. Movement rows (10 Hz) of the humans (mouse / touch) and of the recorded bots.
Only tracks that start at the start of the round. Speed is the horizontal speed from vf, vs."""
import sys, json
import numpy as np
from ds import M, NM, load_rows, load_tracks
BINS = [0, 3, 6, 10, 15, 20, 30, 45, 60, 200]
def run(kind, label, pick):
    rows, offs = load_rows(kind)
    tracks = []
    for si, tag in enumerate(('0', '1')):
        for line in open('/tmp/rec/ds/tracks-%s.jsonl' % tag):
            if '"kind":"%s"' % kind not in line: continue
            t = json.loads(line); t['start'] += offs[si]; tracks.append(t)
    acc = np.zeros((len(BINS) - 1, 4)); allyd = [[] for _ in BINS[:-1]]
    tot = [0, 0, 0]
    for t in tracks:
        if not pick(t): continue
        r = rows[t['start']: t['start'] + t['n']]
        if len(r) < 20 or r[0, M['left']] < 85: continue
        clock = r[0, M['left']] - r[:, M['left']]
        speed = np.hypot(r[:, M['vf']], r[:, M['vs']]); still = speed < 0.5
        b = np.digitize(clock, BINS) - 1
        for k in range(len(BINS) - 1):
            m = b == k
            if not m.any(): continue
            acc[k, 0] += m.sum(); acc[k, 1] += still[m].sum(); acc[k, 2] += (still[m] & (r[m, M['nVisible']] > 0)).sum()
            d = r[m, M['ntDist']]; d = d[d > 0]
            if len(d): allyd[k].extend(d[::5].tolist())
        tot[0] += len(r); tot[1] += still.sum(); tot[2] += (still & (clock < 10)).sum()
    print(label, 'rows %d still %.3f; share of the still time in the first 10 s of the round: %.2f' % (tot[0], tot[1] / tot[0], tot[2] / max(1, tot[1])))
    for k in range(len(BINS) - 1):
        if acc[k, 0] < 100: continue
        print('  clock %3d-%3d s: time share %.3f still %.3f (with an enemy in sight %.3f) nearest ally p50 %.1f m' % (BINS[k], BINS[k + 1], acc[k, 0] / acc[:, 0].sum(), acc[k, 1] / acc[k, 0], acc[k, 2] / acc[k, 0], np.median(allyd[k]) if allyd[k] else -1))
which = sys.argv[1] if len(sys.argv) > 1 else 'mouse'
if which == 'mouse': run('hmove', 'human mouse', lambda t: t.get('input') == 'mouse')
elif which == 'touch': run('hmove', 'human touch', lambda t: t.get('input') == 'touch')
else: run('bmove', 'recorded bots', lambda t: True)
