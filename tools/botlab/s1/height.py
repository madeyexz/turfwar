"""Where the view is on the enemy, up and down, in the ticks with the trigger down and the enemy in sight: metres above the chest's middle
(from the pitch offset and the distance), by distance band; and the head share of the hits. Humans (aim-clean rows) and bot files."""
import sys
import numpy as np
from ds import A, E, OWN, NA, load_rows
from disc import load
def table(label, rows):
    w = rows[:, A['weapon']] == 1
    fire = (rows[:, A['fire']] > 0) & (rows[:, OWN + E['vis']] > 0) & w
    d = rows[:, OWN + E['dist']]; epc = rows[:, OWN + E['epc']]; eph = rows[:, OWN + E['eph']]
    sgn = np.sign(np.nanmedian((eph - epc)[fire]))  # the head is above the chest: this gives the sign of "target minus view"
    up = -sgn * epc * d  # metres of the view above the chest's middle
    hits, heads = rows[w, A['hits']].sum(), rows[w, A['heads']].sum()
    out = '%-10s head share of hits %.3f (hits %d) sign %+d |' % (label, heads / max(1, hits), hits, sgn)
    for lo, hi in ((0, 5), (5, 8), (8, 15), (15, 30)):
        m = fire & (d >= lo) & (d < hi)
        q = np.percentile(up[m], [25, 50, 75]) if m.sum() > 50 else [np.nan] * 3
        out += ' %d-%dm n=%d %.2f/%.2f/%.2f |' % (lo, hi, m.sum(), *q)
    print(out)
    m = fire & (d < 15)
    print('   head minus chest height (m), median: %.2f' % np.nanmedian((sgn * (eph - epc) * d)[m]))
rows, _ = load_rows('haim'); table('human', rows)
for a in sys.argv[1:]:
    label, files = a.split('=')
    table(label, np.concatenate([load(f) for f in files.split(',')]))
