"""Compare the bots' visit maps with the human ones (Jensen-Shannon distance in bits, nodes for 90% of the time, overlap), per map side.
Usage: python visits_cmp.py label=/tmp/rec/s2/visits-new.json ... [--late]"""
import json, sys
import numpy as np
H = json.load(open('/tmp/rec/out/visits_elim.json'))
key = 'late' if '--late' in sys.argv else 'node'
def vec(d, n):
    v = np.zeros(n)
    for k, s in d.items():
        if int(k) < n: v[int(k)] = s
    return v
def jsd(p, q):
    m = (p + q) / 2
    def kl(a, b):
        nz = a > 0
        return float((a[nz] * np.log2(a[nz] / b[nz])).sum())
    return (kl(p, m) + kl(q, m)) / 2
def n90(v):
    s = np.sort(v)[::-1]; return int(np.searchsorted(np.cumsum(s), 0.9) + 1)
for a in [x for x in sys.argv[1:] if '=' in x]:
    label, path = a.split('='); B = json.load(open(path)); js = []; ratio = []; ov = []
    line = []
    for mp, sides in B.items():
        for t, b in sides.items():
            h = H.get(mp, {}).get(t)
            if not h: continue
            n = max(max(map(int, h[key])), max(map(int, b[key]))) + 1
            p, q = vec(h[key], n), vec(b[key], n); p /= p.sum(); q /= q.sum()
            j = jsd(p, q); js.append(j); ratio.append(n90(p) / n90(q)); ov.append(float(np.minimum(p, q).sum()))
            line.append('%s%s %.3f' % (mp[:4], t, j))
    print('%-10s JSD mean %.3f  human/bot nodes90 %.2f  overlap %.3f | %s' % (label, np.mean(js), np.median(ratio), np.mean(ov), '  '.join(line)))
