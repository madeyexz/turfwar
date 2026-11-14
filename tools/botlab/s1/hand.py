"""How the hand moves with an enemy in sight (mouse players): pitch with yaw, and the lengths of moves and rests. Totals only."""
import sys
import numpy as np
sys.path.insert(0, '/tmp/botlab')
from ds import A, E, OWN, SLOT, load_rows
from metrics import runs_of

rows, _ = load_rows('haim')
run, tc, brk = runs_of(rows)
e0 = rows[:, OWN:OWN + SLOT]
vis0 = (e0[:, E['vis']] > 0) & ~brk
dy, dp = rows[:, A['mdyaw']].astype(np.float64), rows[:, A['mdpitch']].astype(np.float64)
my, mp = np.abs(dy) >= 5e-4, np.abs(dp) >= 5e-4
fire = rows[:, A['fire']] > 0
P = (10, 25, 50, 75, 90)
q = lambda x: ' '.join('%7.4f' % v for v in np.percentile(x, P)) if len(x) else 'none'
for name, m in (('enemy in sight, key up', vis0 & ~fire), ('enemy in sight, key down', vis0 & fire), ('no enemy in sight', ~vis0 & ~brk)):
    print(name, 'n', int(m.sum()))
    print('  yaw moves %.3f  pitch moves %.3f  pitch moves | yaw moves %.3f  pitch moves | yaw still %.3f' % (my[m].mean(), mp[m].mean(), mp[m & my].mean(), mp[m & ~my].mean()))
    b = m & my & mp
    print('  |dp|/|dy| when both move:', q(np.abs(dp[b]) / np.abs(dy[b])), '  |dy| per tick when it moves:', q(np.abs(dy[m & my])), '  |dp| when it moves:', q(np.abs(dp[m & mp])))
# lengths of yaw moves and rests (ticks) inside runs with the enemy in sight
def lengths(flag, ok):
    out = []
    i = 0; n = len(flag)
    idx = np.flatnonzero(ok)
    # split into consecutive stretches of ok rows in one run
    cut = np.flatnonzero((np.diff(idx) != 1) | (run[idx[1:]] != run[idx[:-1]])) + 1
    for seg in np.split(idx, cut):
        if len(seg) < 30: continue
        f = flag[seg].astype(np.int8)
        ch = np.flatnonzero(np.diff(f) != 0) + 1
        parts = np.split(f, ch)
        for p in parts[1:-1]: out.append((int(p[0]), len(p)))
    a = np.array(out)
    return a[a[:, 0] == 1, 1], a[a[:, 0] == 0, 1]
mv, rest = lengths(my, vis0)
print('yaw move length (ticks):', q(mv), ' mean %.2f' % mv.mean(), '  rest length (ticks):', q(rest), ' mean %.2f' % rest.mean())
# the size of one move (rad): sum of |dy| in a move; and the peak share
idx = np.flatnonzero(vis0 & my)
print('share of moving ticks that flip sign against the tick before: %.3f' % ((np.sign(dy[1:]) != np.sign(dy[:-1])) & my[1:] & my[:-1] & vis0[1:]).sum().__truediv__((my[1:] & my[:-1] & vis0[1:]).sum()))
