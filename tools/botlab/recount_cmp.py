import json
proc={}
for line in open('/tmp/rec/quality.jsonl'):
    d=json.loads(line); q=d['q']
    proc[q['segment']]={x['soldierId']:x for x in q['qualities']}
mine={}; errs=0
for s in (0,1):
    for line in open(f'/tmp/rec/out/recount-{s}.jsonl'):
        d=json.loads(line)
        if 'error' in d: errs+=1; continue
        mine[d['key']]={x['id']:x for x in d['q']}
both=[k for k in mine if k in proc]
only_mine=[k for k in mine if k not in proc]; only_proc=[k for k in proc if k not in mine]
mv=sum(x['clean'] for k in mine for x in mine[k].values() if x['tier']=='clean')/3600
am=sum(x['aimClean'] for k in mine for x in mine[k].values() if x['tier']=='clean')/3600
mvb=sum(x['clean'] for k in both for x in mine[k].values() if x['tier']=='clean')/3600
amb=sum(x['aimClean'] for k in both for x in mine[k].values() if x['tier']=='clean')/3600
pmv=sum(x['clean'] for k in proc for x in proc[k].values() if x['tier']=='clean')/3600
pam=sum(x['aimClean'] for k in proc for x in proc[k].values() if x['tier']=='clean')/3600
diff=0; tierdiff=0; n=0; absdiff=0.0
for k in both:
    a=mine[k]; b=proc[k]
    for sid in set(a)|set(b):
        n+=1
        x=a.get(sid); y=b.get(sid)
        if not x or not y: diff+=1; continue
        if x['tier']!=y['tier']: tierdiff+=1
        if abs(x['clean']-y['clean'])>1e-6 or abs(x['aimClean']-y['aimClean'])>1e-6: diff+=1; absdiff+=abs(x['clean']-y['clean'])
admin=json.load(open('/tmp/rec/stats/clean-hours.json'))
print(json.dumps(dict(segments_recounted=len(mine), errors=errs, segments_in_processor=len(proc), only_recount=len(only_mine), only_processor=len(only_proc),
  recount_movement_h=round(mv,3), recount_aim_h=round(am,3), recount_movement_h_same_segments=round(mvb,3), recount_aim_h_same_segments=round(amb,3),
  processor_movement_h=round(pmv,3), processor_aim_h=round(pam,3), admin_movement_h=round(admin['movementHours'],3), admin_aim_h=round(admin['aimHours'],3),
  subject_rounds_compared=n, subject_rounds_different=diff, tier_different=tierdiff, abs_diff_h=round(absdiff/3600,4)), indent=1))
