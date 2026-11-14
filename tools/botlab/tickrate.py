import json, collections, statistics
rows=[]
for line in open('/tmp/rec/quality.jsonl'):
    d=json.loads(line); q=d['q']; c=q['checks']
    qs=q['qualities']
    ts=qs[0]['teamSize'] if qs else None
    date=qs[0]['date'] if qs else d['key'].split('dt=')[1][:10]
    clean=sum(x['clean'] for x in qs if x['tier']=='clean')
    rows.append((c['ticksPerSecond'], c['frames'], ts, date, clean, len(qs)))
def wq(vals, wts, q):
    s=sorted(zip(vals,wts)); tot=sum(wts); acc=0
    for v,w in s:
        acc+=w
        if acc>=q*tot: return v
print('segments', len(rows))
tps=[r[0] for r in rows]; fr=[r[1] for r in rows]
print('ticks/s weighted by frames: p05 %.1f p25 %.1f p50 %.1f p75 %.1f p95 %.1f mean %.2f' % (*[wq(tps,fr,q) for q in (.05,.25,.5,.75,.95)], sum(a*b for a,b in zip(tps,fr))/sum(fr)))
for ts in (1,6,24):
    sub=[r for r in rows if r[2]==ts]
    if sub: print('teamSize',ts,'n',len(sub),'p50 %.1f p05 %.1f'%(wq([r[0] for r in sub],[r[1] for r in sub],.5), wq([r[0] for r in sub],[r[1] for r in sub],.05)))
by=collections.defaultdict(list)
for r in rows: by[r[3]].append(r)
for d in sorted(by):
    sub=by[d]; print(d, 'n',len(sub), 'p50 %.1f'%wq([r[0] for r in sub],[r[1] for r in sub],.5), 'p05 %.1f'%wq([r[0] for r in sub],[r[1] for r in sub],.05))
# wall-clock vs tick-count hours: clean seconds are ticks/30; wall seconds = ticks/tps
tick_h=sum(r[4] for r in rows)/3600
wall_h=sum(r[4]*30/r[0] for r in rows if r[0]>0)/3600
print('movement-clean hours counted as ticks/30: %.2f ; as wall-clock: %.2f'%(tick_h, wall_h))
