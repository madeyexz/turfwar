"""The hand table for the recorded mouse players or for bot rows of the lab: python s1/hand2.py [file.f32[,file2]]. Totals only."""
import sys
import numpy as np
sys.path.insert(0, '/tmp/botlab')
from ds import A, E, OWN, SLOT, NA, load_rows
from metrics import runs_of

if len(sys.argv) > 1:
    parts = []
    for f in sys.argv[1].split(','):
        a = np.fromfile(f, dtype=np.float32); parts.append(a[: (a.size // NA) * NA].reshape(-1, NA))
    rows = np.concatenate(parts)
else:
    rows, _ = load_rows('haim')
only = rows[:, A['weapon']] == 1
run, tc, brk = runs_of(rows)
e0 = rows[:, OWN:OWN + SLOT]
vis0 = (e0[:, E['vis']] > 0) & ~brk & only
dy, dp = rows[:, A['mdyaw']].astype(np.float64), rows[:, A['mdpitch']].astype(np.float64)
my, mp = np.abs(dy) >= 5e-4, np.abs(dp) >= 5e-4
fire = rows[:, A['fire']] > 0
P = (10, 25, 50, 75, 90)
q = lambda x: ' '.join('%6.4f' % v for v in np.percentile(x, P)) if len(x) else 'none'
def lengths(flag, ok):
    out = []
    idx = np.flatnonzero(ok)
    cut = np.flatnonzero((np.diff(idx) != 1) | (run[idx[1:]] != run[idx[:-1]])) + 1
    for seg in np.split(idx, cut):
        if len(seg) < 30: continue
        f = flag[seg].astype(np.int8)
        ch = np.flatnonzero(np.diff(f) != 0) + 1
        for p in np.split(f, ch)[1:-1]: out.append((int(p[0]), len(p)))
    a = np.array(out) if out else np.zeros((0, 2), int)
    return a[a[:, 0] == 1, 1], a[a[:, 0] == 0, 1]
for name, m in (('sight, key up', vis0 & ~fire), ('sight, key down', vis0 & fire), ('no enemy in sight', ~(e0[:, E['vis']] > 0) & ~brk & only)):
    if m.sum() < 100: continue
    b = m & my & mp
    rough = np.abs(np.diff(dy))[m[1:] & m[:-1]].mean() / np.abs(dy[m]).mean()
    print('%-18s n %7d yawmv %.2f pitmv %.2f pit|yaw %.2f pit|still %.2f rough %.2f' % (name, int(m.sum()), my[m].mean(), mp[m].mean(), mp[m & my].mean(), mp[m & ~my].mean(), rough))
    print('   |dp|/|dy| %s   |dy| %s   |dp| %s' % (q(np.abs(dp[b]) / np.abs(dy[b])), q(np.abs(dy[m & my])), q(np.abs(dp[m & mp]))))
    mv, rest = lengths(my, m)
    if len(mv) and len(rest): print('   move ticks %s mean %.1f   rest ticks %s mean %.1f' % (q(mv)[:0] + ' '.join('%d' % v for v in np.percentile(mv, P)), mv.mean(), ' '.join('%d' % v for v in np.percentile(rest, P)), rest.mean()))
    pm, pr = lengths(mp, m)
    if len(pm) and len(pr): print('   pitch move ticks %s mean %.1f   rest %s mean %.1f' % (' '.join('%d' % v for v in np.percentile(pm, P)), pm.mean(), ' '.join('%d' % v for v in np.percentile(pr, P)), pr.mean()))
