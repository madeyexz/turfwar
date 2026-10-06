import { describe, expect, it } from 'vitest';
import { MAP_IDS, loadMap } from '../../shared/maps/index';
import { LAYER_STEP, separateCoplanar, type DrawnBox } from './coplanar';

/** Pairs of faces that share a plane and a direction and overlap: what the GPU z-fights on. */
function flush(boxes: DrawnBox[]) {
  let n = 0;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    for (let axis = 0; axis < 3; axis++) for (const side of [0, 1]) {
      if (axis === 1 && side === 0) continue;
      const pa = side ? a.max[axis] : a.min[axis], pb = side ? b.max[axis] : b.min[axis];
      if (Math.abs(pa - pb) > 0.0005) continue;
      const [u, v] = [0, 1, 2].filter(k => k !== axis);
      const ou = Math.min(a.max[u], b.max[u]) - Math.max(a.min[u], b.min[u]);
      const ov = Math.min(a.max[v], b.max[v]) - Math.max(a.min[v], b.min[v]);
      if (ou > 0.03 && ov > 0.03) n++; // a few-mm sliver where a pushed face now laps a neighbour is invisible
    }
  }
  return n;
}

function mapBoxes(id: string): DrawnBox[] {
  const { def } = loadMap(id);
  const boxes: DrawnBox[] = [];
  for (const d of def.decor) {
    if (d.kind === 'block') { const s = def.solids[d.solid]; boxes.push({ min: [s.minX, s.minY, s.minZ], max: [s.maxX, s.maxY, s.maxZ] }); }
    else if (d.kind === 'shape') boxes.push({ min: [...d.min], max: [...d.max] });
    else if (d.kind === 'detail') boxes.push({ min: [d.x - d.w / 2, d.y, d.z - d.d / 2], max: [d.x + d.w / 2, d.y + d.h, d.z + d.d / 2] });
  }
  return boxes;
}

describe('coplanar overlays', () => {
  it('stands a flush stripe off its panel, on the faces they share', () => {
    // Taipei's riot panel: a white 2 m panel with a blue band of the same thickness across it.
    const panel = { min: [0, 0.1, 0], max: [2.2, 1.95, 0.4] }, band = { min: [0, 0.75, 0], max: [2.2, 1.2, 0.4] };
    const [p, b] = separateCoplanar([panel, band]);
    expect(p).toEqual(panel);
    expect(b.min[2]).toBeCloseTo(-LAYER_STEP, 6);
    expect(b.max[2]).toBeCloseTo(0.4 + LAYER_STEP, 6);
    expect(b.min[0]).toBeCloseTo(-LAYER_STEP, 6);
    expect(b.max[0]).toBeCloseTo(2.2 + LAYER_STEP, 6);
    expect(b.min[1]).toBe(0.75);
    expect(b.max[1]).toBe(1.2);
    expect(flush([p, b])).toBe(0);
  });

  it('stacks overlays in layers and leaves boxes that only touch alone', () => {
    const wall = { min: [0, 0, 0], max: [4, 3, 0.2] }, sign = { min: [1, 1, 0], max: [3, 2, 0.2] }, logo = { min: [1.5, 1.2, 0], max: [2.5, 1.8, 0.2] };
    const out = separateCoplanar([wall, sign, logo]);
    expect(out[1].max[2]).toBeCloseTo(0.2 + LAYER_STEP, 6);
    expect(out[2].max[2]).toBeCloseTo(0.2 + 2 * LAYER_STEP, 6);
    expect(flush(out)).toBe(0);
    const left = { min: [0, 0, 0], max: [1, 1, 1] }, right = { min: [1, 0, 0], max: [2, 1, 1] };
    expect(separateCoplanar([left, right])).toEqual([left, right]);
  });

  it.each(['taipei', 'xinyi', 'warehouse', 'meridian'])('leaves no flush overlapping faces on %s', id => {
    const boxes = mapBoxes(id);
    const t = performance.now();
    const out = separateCoplanar(boxes);
    expect(performance.now() - t).toBeLessThan(500);
    expect(flush(out)).toBe(0);
  });
});

// Every map builds through the same pass in the renderer; keep it cheap there too.
it('separates every map quickly', () => {
  for (const id of MAP_IDS) {
    const boxes = mapBoxes(id), t = performance.now();
    separateCoplanar(boxes);
    expect(performance.now() - t, id).toBeLessThan(500);
  }
});
