"""Per primary weapon: the time from the first sight of an enemy (after 1 s with none in sight) to the first shot, the share of these sightings that
get a shot inside 4 s, the hit rate of the first shot, and shots per second with an enemy in sight. Humans (aim-clean rows) and bot files."""
import sys
import numpy as np
from ds import A, E, OWN, WEAPONS, load_rows
from disc import load
def table(label, rows):
    t = rows[:, A['t']]; brk = np.r_[True, np.abs(np.diff(t) - rows[1:, A['dt']]) > 0.05]
    vis = rows[:, OWN + E['vis']] > 0; shots = rows[:, A['shots']]; hits = rows[:, A['hits']]; wp = rows[:, A['weapon']].astype(int)
    track = np.cumsum(brk)
    out = []
    n = len(rows)
    # sighting starts: vis now, not vis in the 30 rows before (same track)
    cs = np.cumsum(np.r_[0, vis.astype(int)])
    idx = np.where(vis & ~np.r_[False, vis[:-1]])[0]
    for code in range(1, 6):
        first, got, total, fh = [], 0, 0, []
        for i in idx[wp[idx] == code]:
            if i < 30 or track[i - 30] != track[i] or cs[i] - cs[i - 30] > 0: continue
            j = min(n, i + 120)
            while track[j - 1] != track[i]: j -= 1  # the track ends first (death, or the round's end)
            total += 1
            s = np.where(shots[i:j] > 0)[0]
            if len(s) and wp[i + s[0]] == code:
                got += 1; first.append(float(t[i + s[0]] - t[i])); fh.append(hits[i + s[0]] > 0)
        w = wp == code
        vs = (vis & w).sum()
        if total < 30: continue
        out.append('%-5s sightings %5d shot<4s %.2f first shot p25/50/75 %.2f/%.2f/%.2f s first-shot hit %.2f | shots/s in sight %.2f' % (WEAPONS[code], total, got / total, *np.percentile(first, [25, 50, 75]), np.mean(fh), shots[vis & w].sum() / (rows[vis & w, A['dt']].sum() + 1e-9)))
    print(label + '\n  ' + '\n  '.join(out))
if 'nohuman' not in sys.argv:
    rows, _ = load_rows('haim'); table('human', rows)
for a in sys.argv[1:]:
    if '=' not in a: continue
    label, files = a.split('=')
    table(label, np.concatenate([load(f) for f in files.split(',')]))
