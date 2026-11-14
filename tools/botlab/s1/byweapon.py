"""Per primary weapon: shots, hit rate, the sideways error at a shot (m, median, enemy in sight), the share of the shots in ADS and with the body still. Humans (aim-clean rows) and bot files."""
import sys
import numpy as np
from ds import A, E, OWN, load_rows
from disc import load
def table(label, rows):
    out = []
    for code in np.unique(rows[:, A['weapon']]).astype(int):
        w = rows[:, A['weapon']] == code
        shots, hits = rows[w, A['shots']].sum(), rows[w, A['hits']].sum()
        if shots < 300: continue
        m = w & (rows[:, A['shots']] > 0) & (rows[:, OWN + E['vis']] > 0)
        err = np.abs(rows[m, OWN + E['eyaw']]) * rows[m, OWN + E['dist']]
        d = rows[m, OWN + E['dist']]
        out.append('w%d: shots %d hit %.3f err p50 %.2f m (n %d) dist p50 %.1f ads %.2f still %.2f time share %.3f' % (code, shots, hits / shots, np.median(err) if len(err) else np.nan, m.sum(), np.median(d) if len(d) else np.nan, rows[m, A['ads']].mean() if m.sum() else np.nan, (rows[m, A['speed']] < 0.5).mean() if m.sum() else np.nan, w.mean()))
    print(label + '\n  ' + '\n  '.join(out))
rows, _ = load_rows('haim'); table('human', rows)
for a in sys.argv[1:]:
    label, files = a.split('=')
    table(label, np.concatenate([load(f) for f in files.split(',')]))
