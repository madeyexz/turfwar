/**
 * What a dressing set's cut and clear boxes (Decor kind 'dressing') take away, shared by the
 * renderer (src/render/dressing.ts) and the map tests, so a test sees exactly what is drawn.
 */

/** Point test against cut boxes (minX, minY, minZ, maxX, maxY, maxZ, map coordinates). */
export type Cut = (x: number, y: number, z: number) => boolean;

export function cutTest(c: number[]): Cut {
  return (x, y, z) => {
    for (let i = 0; i < c.length; i += 6) if (x > c[i] && x < c[i + 3] && y > c[i + 1] && y < c[i + 4] && z > c[i + 2] && z < c[i + 5]) return true;
    return false;
  };
}

/** Points about a metre round a model's foot: a model goes when any of them is in a cut. */
const MODEL_REACH = [[0, 0], [0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]];

/** True when a model with its foot at (x, y, z), map coordinates, is cut (the renderer drops it). */
export function modelCut(cut: Cut, x: number, y: number, z: number) {
  return MODEL_REACH.some(([dx, dz]) => cut(x + dx, y + 0.1, z + dz));
}
