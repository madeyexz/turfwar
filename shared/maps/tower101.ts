/**
 * Taipei 101 (台北101), authored here from the tower's public outline: 508 m to the tip of its
 * spire, a mall podium and a base that tapers over the first 25 or so storeys, then eight
 * 8-storey modules that flare outward as they rise (the stacked-pagoda or bamboo-joint look), each
 * ending in a lit eave, a stepped crown, and the needle. Its plan is a square with each corner
 * stepped in twice (the sawtooth corners). The numbers are this project's own approximation, used
 * by the Xinyi map, the 88F map and the skyline of every Taipei map; nothing here is measured from
 * another game or a survey. Heights are metres above the plaza; half-sizes are half the width.
 */

/** A lofted section: y0..y1, the half-size and corner step at each end, its paint and glow (≥ 2.5: lit gold). */
export type Loft = [y0: number, y1: number, half0: number, notch0: number, half1: number, notch1: number, color: number, glow: number];
/** A decorative disc: centre, facing normal, half-extents, depth, paint. */
export type Disc = [x: number, y: number, z: number, nx: number, ny: number, nz: number, rx: number, ry: number, depth: number, color: number];

export const TOWER = {
  /** The base's top, where the first module starts; the modules' pitch; their number. */
  baseTop: 112, segH: 35.2, segCount: 8,
  /** The base's half-size at its foot and at its top. */
  baseHalf0: 31.5, baseHalf1: 24.5,
  /** A module's half-size at its foot and under its eave. */
  segHalf0: 21.5, segHalf1: 26.2,
  /** The roof of the last module's crown, and the tip of the spire. */
  crownTop: 449, spireTop: 508,
} as const;

export const GLASS = 0xe6fbf6, GOLD = 0xd9e0e0, STEEL = 0x9aa6a6;

/** Tower sections bottom to top. */
export function towerLofts(): Loft[] {
  const T = TOWER, out: Loft[] = [];
  // The base: a long taper from the plaza to the first module.
  out.push([0.2, 12, T.baseHalf0, 1.9, T.baseHalf0 - 0.5, 1.9, GLASS, 1.3]);
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    const y0 = 12 + (T.baseTop - 12) * i / steps, y1 = 12 + (T.baseTop - 12) * (i + 1) / steps;
    const h = (y: number) => (T.baseHalf0 - 0.5) + (T.baseHalf1 - T.baseHalf0 + 0.5) * (y - 12) / (T.baseTop - 12);
    out.push([y0, y1, h(y0), 1.85 - 0.06 * i, h(y1), 1.85 - 0.06 * (i + 1), GLASS, 0.5]);
  }
  // Eight modules, each flaring out to a lit eave; the step back between them is a steel ring.
  for (let k = 0; k < T.segCount; k++) {
    const y0 = T.baseTop + k * T.segH, eave = y0 + T.segH - 2.2, y1 = y0 + T.segH;
    out.push([y0, y0, k === 0 ? T.baseHalf1 : T.segHalf1, 1.6, T.segHalf0, 1.6, STEEL, 0]);
    out.push([y0, eave, T.segHalf0, 1.6, T.segHalf1 - 0.35, 1.6, GLASS, 0.5]);
    out.push([eave, y1, T.segHalf1 - 0.35, 1.6, T.segHalf1, 1.6, GOLD, 3]);
  }
  // The crown: four setbacks under a flat roof.
  let y = T.baseTop + T.segCount * T.segH;
  out.push([y, y, T.segHalf1, 1.6, 17.5, 1.5, STEEL, 0]);
  for (const [h, from, to] of [[13.6, 17.5, 18.3], [13.8, 14.6, 15.2], [14, 11.8, 12.3], [14, 9, 9.4]] as const) {
    out.push([y, y + h, from, 1.4, to, 1.4, GLASS, 0.5]);
    y += h;
    out.push([y - 1, y, to, 1.4, to + 0.3, 1.4, GOLD, 3]);
  }
  return out;
}

/** The needle: stacked cylinders (x, z, r at the foot, r at the top, y0, y1, paint, glow), centred on the tower. */
export function towerNeedle(): [r0: number, r1: number, y0: number, y1: number, color: number, glow: number][] {
  return [
    [3, 2.4, 449, 459, 0xc9ced0, 0.8], [2, 1.4, 459, 479, 0xc9ced0, 0.8], [1.2, 0.6, 479, 497, 0xc9ced0, 0.8], [0.45, 0.12, 497, 508, 0xc9ced0, 0.8],
    [2.5, 2.5, 459.5, 460.5, STEEL, 0], [2.5, 2.5, 469.5, 470.5, STEEL, 0], [1.6, 1.6, 479.5, 480.5, STEEL, 0], [1.6, 1.6, 489.5, 490.5, STEEL, 0],
    [0.75, 0.6, 492, 494.6, GOLD, 6],
  ];
}

/** Red aviation beacons: offsets from the tower's axis, height and radius. */
export function towerBeacons(): [dx: number, y: number, dz: number, r: number][] {
  const out: [number, number, number, number][] = [[0, 508.4, 0, 0.9]];
  for (const [y, d] of [[480, 1.1], [450, 4.2], [395, 18]] as const) for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) out.push([sx * d, y, sz * d, 0.7]);
  return out;
}

/** Gold ruyi (如意) discs on the four faces: under the base's top, and at the foot of every module. */
export function towerOrnaments(): Disc[] {
  const T = TOWER, out: Disc[] = [], GOLD_PAINT = 0xe8b848;
  const faces: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (const [nx, nz] of faces) out.push([nx * (T.baseHalf1 + 0.8), T.baseTop - 9, nz * (T.baseHalf1 + 0.8), nx, 0.05, nz, 6, 6, 1.2, GOLD_PAINT]);
  for (let k = 0; k < T.segCount; k++) {
    const y = T.baseTop + k * T.segH + 10;
    const half = T.segHalf0 + (T.segHalf1 - T.segHalf0) * (10 / (T.segH - 2.2));
    for (const [nx, nz] of faces) out.push([nx * (half + 0.6), y, nz * (half + 0.6), nx, 0, nz, 3.6, 4.8, 0.9, GOLD_PAINT]);
  }
  return out;
}

/**
 * The height at which the last module is `half` wide (the 88F floor plate: 50 m across at 25),
 * and the floor's own y.
 */
export function heightAtHalf(half: number): number {
  const T = TOWER, y0 = T.baseTop + (T.segCount - 1) * T.segH, eave = T.segH - 2.2;
  return y0 + eave * (half - T.segHalf0) / (T.segHalf1 - 0.35 - T.segHalf0);
}
