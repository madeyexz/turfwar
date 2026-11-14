// The learned aim policy in TypeScript: the feature twin of /tmp/botlab/feat.py and the forward pass of the small MLP.
// One AimNet is shared by all soldiers; each soldier has one AimState (a ring of its last aim rows).
import { readFileSync } from 'node:fs';

// Aim row layout (the same as /tmp/botlab/rows.ts).
export const OWN = 26, SLOTS = 3, SLOT = 8, OV = OWN + SLOTS * SLOT, NA = OV + 3;
export const A = {
  t: 0, dt: 1, yaw: 2, pitch: 3, mdyaw: 4, mdpitch: 5, fire: 6, shots: 7, hits: 8, heads: 9, weapon: 10, ads: 11, crouch: 12, speed: 13,
  vf: 14, vs: 15, grounded: 16, health: 17, ammo: 18, reloading: 19, nvis: 20, nenemy: 21, hurt: 22, nframes: 23, tick: 24, aimkey: 25,
} as const;

export const NF = 118;
const HIST = [1, 2, 3, 4, 6, 8, 11, 15], VEL = [1, 3, 6];
const CAP = 48; // rows kept per soldier (the features look back 45 rows)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The weights of one model: layers of (out x in) weights row by row, then the biases. */
export class AimNet {
  sizes: number[]; w: Float32Array[] = []; b: Float32Array[] = []; nc: number; nb: number; edges: number[]; logEdges: number[];
  private h: Float32Array[]; x: Float32Array;
  constructor(prefix: string) {
    const meta = JSON.parse(readFileSync(prefix + '.json', 'utf8'));
    this.sizes = meta.sizes; this.nc = meta.nc; this.nb = meta.nb; this.edges = meta.edges; this.logEdges = this.edges.map((e: number) => Math.log(e));
    const buf = readFileSync(prefix + '.bin');
    const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2);
    let o = 0;
    for (let l = 0; l + 1 < this.sizes.length; l++) {
      const nin = this.sizes[l], nout = this.sizes[l + 1];
      this.w.push(all.slice(o, o + nin * nout)); o += nin * nout;
      this.b.push(all.slice(o, o + nout)); o += nout;
    }
    if (o !== all.length) throw new Error(`weights: ${o} of ${all.length} floats read`);
    this.h = this.sizes.slice(1).map(n => new Float32Array(n));
    this.x = new Float32Array(this.sizes[0]);
  }
  get params() { return this.w.reduce((n, a) => n + a.length, 0) + this.b.reduce((n, a) => n + a.length, 0); }
  /** Forward pass on `this.x` (features, then the skill input; clipped to +-2 here). Returns the output logits (2 * nc + 1). */
  forward(): Float32Array {
    const x = this.x;
    for (let i = 0; i < x.length; i++) x[i] = x[i] > 2 ? 2 : x[i] < -2 ? -2 : x[i];
    let input: Float32Array = x;
    const last = this.w.length - 1;
    for (let l = 0; l <= last; l++) {
      const w = this.w[l], b = this.b[l], out = this.h[l], nin = input.length, nout = out.length;
      for (let j = 0, o = 0; j < nout; j++, o += nin) {
        let s = b[j];
        for (let i = 0; i < nin; i++) s += w[o + i] * input[i];
        out[j] = l < last && s < 0 ? 0 : s;
      }
      input = out;
    }
    return input;
  }
  /** Sample one class of `n` logits at `off` with temperature `temp`; `u` is uniform in [0, 1). */
  sampleClass(logits: Float32Array, off: number, temp: number, u: number): number {
    const n = this.nc;
    let mx = -Infinity;
    for (let i = 0; i < n; i++) if (logits[off + i] > mx) mx = logits[off + i];
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.exp((logits[off + i] - mx) / temp);
    let acc = 0; const want = u * sum;
    for (let i = 0; i < n; i++) { acc += Math.exp((logits[off + i] - mx) / temp); if (acc >= want) return i; }
    return n - 1;
  }
  /** As sampleClass, but the classes are walked from the largest negative change to the largest positive one: `u` is a quantile of the change. */
  sampleOrdered(logits: Float32Array, off: number, temp: number, u: number): number {
    const n = this.nc, nb = this.nb;
    let mx = -Infinity;
    for (let i = 0; i < n; i++) if (logits[off + i] > mx) mx = logits[off + i];
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.exp((logits[off + i] - mx) / temp);
    let acc = 0; const want = u * sum;
    for (let j = 0; j < n; j++) {
      const i = j < nb ? n - 1 - j : j === nb ? 0 : j - nb;
      acc += Math.exp((logits[off + i] - mx) / temp); if (acc >= want) return i;
    }
    return nb;
  }
  /** The aim change (rad) of class `k`; `u` in [0, 1) places it inside the class's bin on a log scale. */
  classValue(k: number, u: number): number {
    if (k === 0) return 0;
    const neg = k > this.nb, i = (neg ? k - this.nb : k) - 1;
    const v = Math.exp(this.logEdges[i] + (this.logEdges[i + 1] - this.logEdges[i]) * u);
    return neg ? -v : v;
  }
}

/** One soldier's history of aim rows and the features made from it. */
export class AimState {
  rows = new Float32Array(CAP * NA); head = -1; len = 0;
  private seenS = new Uint8Array(30); private seenEy = new Float64Array(30); private seenEp = new Float64Array(30);
  /** Rows since an enemy was last in sight (30 = none in the last second). */
  sinceAny = 30;
  reset() { this.len = 0; this.head = -1; this.sinceAny = 30; }
  /** The slot for the next row (the caller fills NA floats at the returned offset of `this.rows`). `newRun` drops the history. */
  push(newRun: boolean): number {
    if (newRun) this.len = 0;
    this.head = (this.head + 1) % CAP;
    if (this.len < CAP) this.len++;
    return this.head * NA;
  }
  private at(L: number) { return ((this.head - L + CAP * 2) % CAP) * NA; }
  /** Fill `out[0..NF)` from the rows; returns false when there is no row. */
  features(out: Float32Array): boolean {
    const n = this.len;
    if (n <= 0) return false;
    const R = this.rows, r0 = this.at(0);
    out.fill(0, 0, NF);
    // 1. weapon
    const w = R[r0 + A.weapon] | 0;
    if (w >= 0 && w < 8) out[w] = 1;
    let c = 8;
    // 2. own state
    let hurt15 = 0, shots15 = 0;
    for (let L = 0; L < 15 && L < n; L++) { const o = this.at(L); hurt15 += R[o + A.hurt]; shots15 += R[o + A.shots]; }
    const ammo = R[r0 + A.ammo], pitch0 = R[r0 + A.pitch], yaw0 = R[r0 + A.yaw];
    out[c] = R[r0 + A.ads]; out[c + 1] = R[r0 + A.crouch]; out[c + 2] = R[r0 + A.speed] / 8; out[c + 3] = R[r0 + A.vf] / 8; out[c + 4] = R[r0 + A.vs] / 8;
    out[c + 5] = R[r0 + A.grounded]; out[c + 6] = R[r0 + A.health] / 100; out[c + 7] = Math.min(ammo, 100) / 100; out[c + 8] = ammo <= 0 ? 1 : 0; out[c + 9] = R[r0 + A.reloading];
    out[c + 10] = Math.min(R[r0 + A.nvis], 3) / 3; out[c + 11] = pitch0 / 1.3; out[c + 12] = Math.min(hurt15, 100) / 100;
    c += 13;
    // 3. enemy slots in sight
    for (let j = 0; j < SLOTS; j++, c += 11) {
      const p = r0 + OWN + j * SLOT, vis = R[p + 6] | 0;
      if (!(vis > 0 && R[p] >= 0)) continue;
      const ey = R[p + 3], epc = R[p + 4], eph = R[p + 5];
      out[c] = 1; out[c + 1] = vis & 1 ? 1 : 0; out[c + 2] = vis & 2 ? 1 : 0;
      out[c + 3] = Math.tanh(ey / 0.06); out[c + 4] = Math.tanh(ey / 0.4); out[c + 5] = ey / Math.PI;
      out[c + 6] = Math.tanh(epc / 0.06); out[c + 7] = Math.tanh(epc / 0.4);
      out[c + 8] = Math.min(3, Math.max(0, (eph - epc) / 0.1)) / 3; out[c + 9] = Math.log1p(R[p + 2]) / 5; out[c + 10] = R[p + 7] / 100;
    }
    // 4. the slot-0 enemy in earlier rows
    const id0 = R[r0 + OWN], has0 = id0 >= 0, S = this.seenS, EY = this.seenEy, EP = this.seenEp;
    for (let L = 0; L < 30; L++) {
      S[L] = 0;
      if (!has0 || L >= n) continue;
      const o = this.at(L) + OWN;
      for (let j = 0; j < SLOTS; j++) {
        const p = o + j * SLOT;
        if (R[p] === id0 && R[p + 6] > 0) { S[L] = 1; EY[L] = R[p + 3]; EP[L] = R[p + 4]; break; }
      }
    }
    for (const L of HIST) {
      if (S[L]) { out[c] = 1; out[c + 1] = Math.tanh(EY[L] / 0.2); out[c + 2] = Math.tanh(EP[L] / 0.2); }
      c += 3;
    }
    // 5. its angular speed
    for (const L of VEL) {
      if (S[0] && S[L]) {
        const o = this.at(L);
        out[c] = Math.tanh(wrap((yaw0 + EY[0]) - (R[o + A.yaw] + EY[L])) * 30 / L / 1.5);
        out[c + 1] = Math.tanh(((pitch0 + EP[0]) - (R[o + A.pitch] + EP[L])) * 30 / L / 1.5);
      }
      c += 2;
    }
    // 6. sight timing
    let tsv = 0;
    while (tsv < 30 && S[tsv]) tsv++;
    let since = 30;
    for (let L = 0; L < 30 && L < n; L++) if (R[this.at(L) + A.nvis] > 0) { since = L; break; }
    this.sinceAny = since;
    out[c] = tsv / 30; out[c + 1] = tsv >= 3 ? 1 : 0; out[c + 2] = tsv >= 6 ? 1 : 0; out[c + 3] = tsv >= 9 ? 1 : 0; out[c + 4] = tsv >= 12 ? 1 : 0; out[c + 5] = tsv >= 18 ? 1 : 0;
    out[c + 6] = since / 30;
    c += 7;
    // 7. own aim changes before
    for (let k = 0; k < 4; k++, c += 4) {
      if (k >= n) continue;
      const o = this.at(k), a = R[o + A.mdyaw], b = R[o + A.mdpitch];
      out[c] = Math.tanh(a / 0.01); out[c + 1] = Math.tanh(a / 0.1); out[c + 2] = Math.tanh(b / 0.01); out[c + 3] = Math.tanh(b / 0.1);
    }
    let sy = 0, sp = 0;
    for (let L = 4; L < 8 && L < n; L++) { const o = this.at(L); sy += R[o + A.mdyaw]; sp += R[o + A.mdpitch]; }
    out[c] = Math.tanh(sy / 0.1); out[c + 1] = Math.tanh(sp / 0.1);
    sy = 0; sp = 0;
    for (let L = 8; L < 16 && L < n; L++) { const o = this.at(L); sy += R[o + A.mdyaw]; sp += R[o + A.mdpitch]; }
    out[c + 2] = Math.tanh(sy / 0.2); out[c + 3] = Math.tanh(sp / 0.2);
    c += 4;
    // 8. fire key before
    for (let k = 0; k < 3 && k < n; k++) out[c + k] = R[this.at(k) + A.fire] > 0 ? 1 : 0;
    let run = 0;
    while (run < 45 && run < n && R[this.at(run) + A.fire] > 0) run++;
    let sinceFire = 45;
    for (let L = 0; L < 45 && L < n; L++) if (R[this.at(L) + A.fire] > 0) { sinceFire = L; break; }
    out[c + 3] = run / 45; out[c + 4] = sinceFire / 45; out[c + 5] = R[r0 + A.shots] > 0 ? 1 : 0; out[c + 6] = Math.min(shots15 / 10, 2);
    c += 7;
    if (c !== NF) throw new Error('feature count ' + c);
    return true;
  }
}
