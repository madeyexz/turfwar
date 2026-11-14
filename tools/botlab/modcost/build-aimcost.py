# Makes spacetimedb/src/aimcost.ts of the lab tree from the prototype's policy.ts and rows.ts (verbatim classes) and hook.ts.part.
# Usage: python3 -I build-aimcost.py <policy.ts> <rows.ts> <hook.ts.part> <out.ts>
import re, sys
policy = open(sys.argv[1]).read().split('\n')
rows = open(sys.argv[2]).read().split('\n')
hook = open(sys.argv[3]).read()
def find(lines, start):
    for i, l in enumerate(lines):
        if l.startswith(start): return i
    raise SystemExit('missing: ' + start)
head = '''// LAB ONLY (not for release): the learned aim's work for each living bot, run after the tick to measure its cost in the module.
// It makes the enemy rows, the features and the forward pass, and samples an action. The action is not applied: the bots stay on the script.
// The classes are the prototype's (policy.ts, rows.ts), unchanged but for the weights loader.
import { eyeOf, weaponOf, smokeBlocks, type SimContext } from '../../shared/match/combat';
import type { CollisionWorld } from '../../shared/collision';
import type { MatchState } from '../../shared/match/state';
import { WEAPON_IDS } from '../../shared/weapons';
import { MODELS } from './weights';
'''
consts = policy[find(policy, '// Aim row layout'):find(policy, '/** The weights of one model')]
net = policy[find(policy, '/** The weights of one model'):find(policy, "/** One soldier's history")]
c0 = find(net, '  constructor(prefix'); c1 = find(net, '  get params')
ctor = '''  constructor(m: { sizes: number[]; nc: number; nb: number; edges: number[]; hex: string }) {
    this.sizes = m.sizes; this.nc = m.nc; this.nb = m.nb; this.edges = m.edges; this.logEdges = this.edges.map((e: number) => Math.log(e));
    const hex = m.hex, nbytes = hex.length >> 1, bytes = new Uint8Array(nbytes);
    const hv = (c: number) => (c <= 57 ? c - 48 : c - 87);
    for (let i = 0; i < nbytes; i++) bytes[i] = (hv(hex.charCodeAt(2 * i)) << 4) | hv(hex.charCodeAt(2 * i + 1));
    const all = new Float32Array(bytes.buffer, 0, nbytes >> 2);
    let o = 0;
    for (let l = 0; l + 1 < this.sizes.length; l++) {
      const nin = this.sizes[l], nout = this.sizes[l + 1];
      this.w.push(all.slice(o, o + nin * nout)); o += nin * nout;
      this.b.push(all.slice(o, o + nout)); o += nout;
    }
    if (o !== all.length) throw new Error(`weights: ${o} of ${all.length} floats read`);
    this.h = this.sizes.slice(1).map(n => new Float32Array(n));
    this.x = new Float32Array(this.sizes[0]);
  }'''.split('\n')
net = net[:c0] + ctor + net[c1:]
state = policy[find(policy, "/** One soldier's history"):]
fe = rows[find(rows, 'export interface Seen'):find(rows, 'const PH')]
fe = '\n'.join(fe).replace('wrap(', 'wrapPi(')
# count the candidates that get line-of-sight rays
fe = fe.replace('  let nvis = 0;\n', '  let nvis = 0;\n  candCount += cands.length;\n', 1)
assert 'candCount += cands.length' in fe
out = head + '\n' + '\n'.join(consts) + '\nconst wrapPi = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };\n\n' + '\n'.join(net) + '\n' + '\n'.join(state) + '\n' + fe + '\n' + hook
open(sys.argv[4], 'w').write(out)
print('wrote', sys.argv[4], len(out.split('\n')), 'lines')
