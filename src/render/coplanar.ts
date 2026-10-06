/** An axis-aligned box as drawn: [x, y, z] corners. */
export interface DrawnBox { min: number[]; max: number[] }

/** How far each layer stands out (m): enough for the depth buffer at street distances, too little to see. */
export const LAYER_STEP = 0.004;
const MAX_LAYERS = 6;

/**
 * Z-fighting fix: where boxes have faces in the same plane, facing the same way and overlapping (a
 * stripe painted flush on a panel, a trim flush with a wall), the GPU cannot order the equal depths
 * and both colours flicker through each other. Each such face of the smaller box (the overlay) is
 * moved outward by a few millimetres per layer, so the overlay always wins. Bottom faces are left
 * alone (they rest on floors). Returns new boxes; the input (often collision solids) is not touched.
 */
export function separateCoplanar(boxes: DrawnBox[], step = LAYER_STEP): DrawnBox[] {
  const out = boxes.map(b => ({ min: [...b.min], max: [...b.max] }));
  const buckets = new Map<string, number[]>();
  boxes.forEach((b, i) => {
    for (let axis = 0; axis < 3; axis++) for (const side of [0, 1]) {
      if (axis === 1 && side === 0) continue;
      const key = `${axis}:${side}:${Math.round((side ? b.max[axis] : b.min[axis]) * 1000)}`;
      const list = buckets.get(key);
      if (list) list.push(i); else buckets.set(key, [i]);
    }
  });
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    const axis = +key[0], side = +key[2];
    const [u, v] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    const area = (i: number) => (boxes[i].max[u] - boxes[i].min[u]) * (boxes[i].max[v] - boxes[i].min[v]);
    // Larger faces underneath, overlays on top; ties go to the box declared later.
    const order = [...list].sort((a, b) => area(b) - area(a) || a - b);
    const layer = new Map<number, number>();
    for (let k = 0; k < order.length; k++) {
      const a = boxes[order[k]];
      let l = 0;
      for (let j = 0; j < k; j++) {
        const b = boxes[order[j]];
        const ou = Math.min(a.max[u], b.max[u]) - Math.max(a.min[u], b.min[u]);
        const ov = Math.min(a.max[v], b.max[v]) - Math.max(a.min[v], b.min[v]);
        if (ou > 0.001 && ov > 0.001) l = Math.max(l, layer.get(order[j])! + 1);
      }
      layer.set(order[k], l);
      if (!l) continue;
      const push = Math.min(l, MAX_LAYERS) * step;
      if (side) out[order[k]].max[axis] += push; else out[order[k]].min[axis] -= push;
    }
  }
  return out;
}
