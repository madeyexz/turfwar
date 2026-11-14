// Check policy.ts against feat.py and the PyTorch model on recorded rows; also time the feature build and the forward pass.
import { AimNet, AimState, NA, NF, A } from './policy';
const N = Number(process.argv[2] ?? 300000);
const buf = await Bun.file('/tmp/rec/ds/haim-0.f32').slice(0, N * NA * 4).arrayBuffer();
const rows = new Float32Array(buf);
const n = rows.length / NA;
const net = new AimNet('/tmp/rec/models/lc-h29.7-s0-64x2');
const st = new AimState();
const F = new Float32Array(n * NF), L = new Float32Array(n * 71);
for (let i = 0; i < n; i++) {
  const dt = rows[i * NA + A.dt];
  const o = st.push(dt <= 0 || dt > 0.25);
  st.rows.set(rows.subarray(i * NA, i * NA + NA), o);
  st.features(net.x); net.x[NF] = 0.3;
  F.set(net.x.subarray(0, NF), i * NF);
  L.set(net.forward(), i * 71);
}
await Bun.write('/tmp/rec/out/parity-feat.f32', new Uint8Array(F.buffer));
await Bun.write('/tmp/rec/out/parity-logit.f32', new Uint8Array(L.buffer));
// Timing: the features and the forward pass, per call.
const reps = 3;
let tf = 0, tn = 0;
for (let r = 0; r < reps; r++) {
  st.reset();
  let t0 = Bun.nanoseconds();
  for (let i = 0; i < n; i++) { const dt = rows[i * NA + A.dt]; const o = st.push(dt <= 0 || dt > 0.25); st.rows.set(rows.subarray(i * NA, i * NA + NA), o); st.features(net.x); }
  tf += Bun.nanoseconds() - t0;
  t0 = Bun.nanoseconds();
  let s = 0;
  for (let i = 0; i < n; i++) { net.x.set(F.subarray(i * NF, i * NF + NF)); net.x[NF] = 0.3; s += net.forward()[70]; }
  tn += Bun.nanoseconds() - t0;
  void s;
}
console.log(JSON.stringify({ rows: n, params: net.params, features_us: tf / reps / n / 1000, forward_us: tn / reps / n / 1000 }));
