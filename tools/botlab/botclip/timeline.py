import json, sys, collections
D = '/tmp/botclip/'
log = json.load(open(D + 'dry-log.json'))
S = []
for a in (0, 3100, 6200): S += json.load(open(D + f'dry-samples-{a}.json'))
names = {13:'Atlas',14:'Orrin',15:'Dagger',16:'Kestrel',17:'Sable',18:'Juno',19:'Vex',20:'Shrike',21:'Wren',22:'Marrow',23:'Halcyon',24:'Quill'}
team = {i: 0 if i <= 18 else 1 for i in names}
n = lambda i: f"{names.get(i, i)}({team.get(i,'?')})"
print('ROUNDS')
for e in log:
    if e['type'] in ('round', 'phase'): print(f"  t{e['tick']:5d} {e['tick']/30:6.1f}s {e['type']} {e.get('phase')} round {e.get('round')} winner {e.get('winner')} {e.get('reason','')}")
print('KILLS')
for e in log:
    if e['type'] == 'kill': print(f"  t{e['tick']:5d} {e['tick']/30:6.1f}s {n(e['killer'])} -> {n(e['victim'])} {e['weapon']} {'HEAD' if e['head'] else ''}")
# per soldier, per round: shots, hits, damage, kills
rounds = [(e['tick'], e['round']) for e in log if e['type'] == 'round' and e['phase'] == 'freeze']
def round_of(t):
    r = 0
    for tk, rd in rounds:
        if t >= tk: r = rd
    return r
st = collections.defaultdict(lambda: collections.Counter())
for e in log:
    r = round_of(e['tick'])
    if e['type'] == 'shot': st[(r, e['shooter'])]['shots'] += 1; st[(r, e['shooter'])]['hits'] += 1 if e['hit'] else 0
    if e['type'] == 'damage': st[(r, e['attacker'])]['dmg'] += e['amount']
    if e['type'] == 'kill': st[(r, e['killer'])]['kills'] += 1; st[(r, e['victim'])]['died'] = e['tick']
print('PER ROUND / SOLDIER: shots hits dmg kills died')
for (r, i), c in sorted(st.items()):
    print(f"  r{r} {n(i):12s} shots {c['shots']:3d} hits {c['hits']:3d} dmg {c['dmg']:4.0f} kills {c['kills']} died {c['died'] or '-'}")
# engagement intervals: target >= 0
print('ENGAGEMENTS (target>=0), merged gaps < 20 ticks')
eng = collections.defaultdict(list)
cur = {}
for tick, rd, ph, clock, sol in S:
    for s in sol:
        i, alive, tgt = s[0], s[1], s[7]
        on = alive and tgt >= 0
        if on:
            if i in cur and tick - cur[i][1] < 20 : cur[i][1] = tick; cur[i][2].add(tgt)
            else:
                if i in cur: eng[i].append(cur[i])
                cur[i] = [tick, tick, {tgt}]
for i in cur: eng[i].append(cur[i])
shots_at = collections.defaultdict(list)
for e in log:
    if e['type'] == 'shot': shots_at[e['shooter']].append(e['tick'])
for i in sorted(eng):
    for a, b, tg in eng[i]:
        if b - a < 15: continue
        sh = sum(1 for t in shots_at[i] if a <= t <= b + 5)
        ks = [n(e['victim']) for e in log if e['type'] == 'kill' and e['killer'] == i and a <= e['tick'] <= b + 5]
        died = any(e['type'] == 'kill' and e['victim'] == i and a <= e['tick'] <= b + 5 for e in log)
        print(f"  {n(i):12s} t{a:5d}-{b:5d} ({a/30:6.1f}-{b/30:6.1f}s, {(b-a)/30:4.1f}s) r{round_of(a)} targets {[names[t] for t in tg]} shots {sh:3d} kills {ks} {'DIED' if died else ''}")
