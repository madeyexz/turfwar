"""export_ts.py <model> <out.ts> : write a trained aim network as a TypeScript module (16-bit weights as base64) for shared/match/aimnet.ts."""
import base64, json, sys
import numpy as np
name, out = sys.argv[1], sys.argv[2]
P = '/tmp/rec/models/' + name
meta = json.load(open(P + '.json')); sizes = meta['sizes']
raw = np.fromfile(P + '.bin', dtype=np.float32)
parts, wu, bu, o = [], [], [], 0
for a, b in zip(sizes[:-1], sizes[1:]):
    w = raw[o:o + a * b]; o += a * b; bias = raw[o:o + b]; o += b
    for v, units in ((w, wu), (bias, bu)):
        unit = float(np.abs(v).max()) / 32767
        units.append(unit); parts.append(np.round(v / unit).astype('<i2'))
assert o == len(raw)
data = base64.b64encode(np.concatenate(parts).tobytes()).decode()
r = lambda v: float('%.9g' % v)
ts = f'''/**
 * The weights of the learned aim (aim.ts). Generated on {sys.argv[3] if len(sys.argv) > 3 else 'an unknown date'}; do not edit by hand.
 *
 * A network of {' x '.join(str(s) for s in sizes)} numbers ({len(raw):,} weights), trained on {meta['hours']:.1f} hours of aim-clean play of
 * {meta.get('players', 184)} recorded mouse players (clean-v2 recordings of 2026-10-15 to 2026-11-10, docs/RECORDING.md), with other players
 * held out to test it. It holds weights only: no recording, no player ID and no row of one player.
 */
export const AIM_NET = {{
  /** The number of inputs, of units in each hidden layer, and of outputs. */
  sizes: {json.dumps(sizes)},
  /** The edges (rad) between the sizes of an aim change in one tick; a change below the first edge is none. */
  edges: {json.dumps(meta['edges'])},
  /** What one step of a stored weight is worth, and of a stored bias, for each layer. */
  weightUnit: {json.dumps([r(v) for v in wu])},
  biasUnit: {json.dumps([r(v) for v in bu])},
  /** For each layer its weights (unit by unit), then its biases: 16-bit numbers, low byte first, as base64. */
  data: '{data}',
}};
'''
open(out, 'w').write(ts)
print('wrote', out, len(ts), 'bytes;', len(raw), 'weights')
