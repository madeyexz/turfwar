import json, collections, math, sys, datetime
Q=[]; segs=0; inputs=set(); checks=collections.Counter()
humans_per_seg=collections.Counter()
for line in open('/tmp/rec/quality.jsonl'):
    o=json.loads(line); q=o['q']; segs+=1
    for k in q.get('inputs',[]): inputs.add(k)
    subj=[x for x in q['qualities'] if x['tier'] in('clean','server-only')]
    exc=[x for x in q['qualities'] if x['tier']=='excluded']
    humans_per_seg[(len(subj),len(exc))]+=1
    for x in q['qualities']: Q.append(x)
H=lambda xs,f: sum(f(x) for x in xs)/3600
subj=[x for x in Q if x['tier'] in('clean','server-only')]
print('segments',segs,'input batches named',len(inputs),'quality rows',len(Q), 'tiers',collections.Counter(x['tier'] for x in Q))
print('aliveLive h %.2f  movement-clean h %.2f  aim-clean h %.2f  server-only h %.2f  excluded-human alive h %.2f'%(H(subj,lambda x:x['aliveLive']),H(subj,lambda x:x['clean']),H(subj,lambda x:x['aimClean']),H([x for x in subj if x['tier']=='server-only'],lambda x:x['aliveLive']),H([x for x in Q if x['tier']=='excluded'],lambda x:x['aliveLive'])))
def table(name,f):
    g=collections.defaultdict(list)
    for x in subj: g[f(x)].append(x)
    print('\n%-18s %8s %8s %8s %7s'%(name,'played','move','aim','rounds'))
    for k,v in sorted(g.items(), key=lambda kv:-H(kv[1],lambda x:x['clean'])):
        print('%-18s %8.2f %8.2f %8.2f %7d'%(str(k)[:18],H(v,lambda x:x['aliveLive']),H(v,lambda x:x['clean']),H(v,lambda x:x['aimClean']),len(v)))
table('input',lambda x:x['input']+('+assist' if x['aimAssist'] else ''))
table('device',lambda x:x['device'] or 'unknown')
table('map',lambda x:x['map']); table('mode',lambda x:x['mode']); table('size',lambda x:x['teamSize']); table('room',lambda x:x['roomKind'])
table('euUk',lambda x:x['euUk'])
# players (opaque keys; never printed)
def conc(field,label):
    by=collections.Counter()
    for x in subj: by[x['pid']]+=x[field]
    v=sorted([h for h in by.values() if h>0],reverse=True); tot=sum(v)
    eff=tot*tot/sum(h*h for h in v)
    cum=0; marks={}
    for i,h in enumerate(v):
        cum+=h
        for m in (1,3,5,10,20,50,100):
            if i+1==m: marks[m]=cum/tot
    print('\n%s: players with >0: %d; total %.2f h; top1 %.1f%% top3 %.1f%% top5 %.1f%% top10 %.1f%% top20 %.1f%% top50 %.1f%% top100 %.1f%%; effective players (inverse Simpson) %.1f'%(label,len(v),tot/3600,*[100*marks.get(m,1) for m in (1,3,5,10,20,50,100)],eff))
    print('  players with >=1h: %d, >=30min: %d, >=10min: %d, >=1min: %d; median player %.1f min'%(sum(h>=3600 for h in v),sum(h>=1800 for h in v),sum(h>=600 for h in v),sum(h>=60 for h in v), v[len(v)//2]/60))
    return v
vm=conc('clean','movement-clean'); va=conc('aimClean','aim-clean')
json.dump({'move':[round(h/3600,4) for h in vm],'aim':[round(h/3600,4) for h in va]},open('/tmp/rec/out/player_hours.json','w'))
# touch with/without assist among aim-clean
print('\naim-clean by input:',{k:round(H([x for x in subj if x['input']==k],lambda x:x['aimClean']),2) for k in('mouse','touch')})
# humans per segment
tot=sum(humans_per_seg.values())
bysub=collections.Counter(); byhum=collections.Counter()
for (s,e),n in humans_per_seg.items(): bysub[s]+=n; byhum[min(s+e,6)]+=n
print('humans (subjects+excluded) per segment:',{k:'%.1f%%'%(100*v/tot) for k,v in sorted(byhum.items())})
print('recorded subjects per segment:',{k:'%.1f%%'%(100*v/tot) for k,v in sorted(bysub.items())})
# day rates
by=collections.defaultdict(lambda:[0,0,0])
for x in subj:
    by[x['date']][0]+=x['clean']/3600; by[x['date']][1]+=x['aimClean']/3600; by[x['date']][2]+=x['aliveLive']/3600
days=sorted(by)
print('\nday        move   aim  played')
for d in days: print(d,'%6.2f %5.2f %6.2f'%tuple(by[d]))
json.dump({d:by[d] for d in days},open('/tmp/rec/out/by_day.json','w'))
