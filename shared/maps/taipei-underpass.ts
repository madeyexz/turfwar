import type { MapBuilder } from './builder';
import type { Shift } from './taipei-decor';

/**
 * The Ximen station underpass (a gameplay addition): a ticket concourse under Zhongxiao W. Rd
 * between Hanzhong St and Zhonghua Rd, reached by a stair down from each sidewalk, so the
 * Ximending side and the Red House side connect underground as well as across the road.
 *
 * The map's ground is a 4 m heightfield, so the concourse is a pit in it: the ground drops to the
 * concourse floor on the grid points inside FLOOR, a solid fill ring (out to the next grid line)
 * covers the slopes round it, and the road and sidewalks are slabs over it. The stair wells are
 * holes in the sidewalk paving (HOLES), with rails round them.
 *
 * Coordinates are the source's (x east, z south). FLOOR lies on the map's ground grid (map x =
 * source x + 781.5, z = source z + 183, grid lines every 4 m from -193).
 */
export const FLOOR_Y = -4.4;
/** Flat concourse floor: x0, z0, x1, z1 (grid lines). */
export const FLOOR = [-734.5, -176, -714.5, -144] as const;
const G = 4;
/** Stair wells in the sidewalks: x0, z0, x1, z1 (stairs climb toward +x). */
export const HOLES: [number, number, number, number][] = [[-734.2, -175.8, -725, -172.9], [-734.2, -147.3, -725, -144.4]];
const KERB = 0.15;

/** Ground height (map coordinates) for the builder: the concourse floor inside FLOOR, else 0. */
export function underpassGround(s: Shift) {
  const [x0, z0, x1, z1] = [s.X(FLOOR[0]), s.Z(FLOOR[1]), s.X(FLOOR[2]), s.Z(FLOOR[3])];
  return (x: number, z: number) => (x >= x0 - 0.01 && x <= x1 + 0.01 && z >= z0 - 0.01 && z <= z1 + 0.01 ? FLOOR_Y : 0);
}

/** Split a rect around holes (all [x0, z0, x1, z1]); returns the pieces left. */
export function minusHoles(r: [number, number, number, number], holes = HOLES) {
  let parts = [r];
  for (const [hx0, hz0, hx1, hz1] of holes) {
    const next: [number, number, number, number][] = [];
    for (const [x0, z0, x1, z1] of parts) {
      if (hx1 <= x0 || hx0 >= x1 || hz1 <= z0 || hz0 >= z1) { next.push([x0, z0, x1, z1]); continue; }
      if (hz0 > z0) next.push([x0, z0, x1, hz0]);
      if (hz1 < z1) next.push([x0, hz1, x1, z1]);
      const a = Math.max(z0, hz0), c = Math.min(z1, hz1);
      if (hx0 > x0) next.push([x0, a, hx0, c]);
      if (hx1 < x1) next.push([hx1, a, x1, c]);
    }
    parts = next;
  }
  return parts;
}

/** Build the concourse; returns cut boxes (map coordinates) where the street dressing must not stand. */
export function underpass(b: MapBuilder, s: Shift, roadZ: [number, number]): number[] {
  const [fx0, fz0, fx1, fz1] = FLOOR, y = FLOOR_Y;
  const box = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, style: Parameters<MapBuilder['box']>[6], color?: number) => {
    const i = b.box(s.X((x0 + x1) / 2), y0, s.Z((z0 + z1) / 2), x1 - x0, y1 - y0, z1 - z0, style);
    if (color !== undefined && style !== 'invisible') b.paint(i, color);
  };
  const shape = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, style: Parameters<MapBuilder['shape']>[6], color?: number) =>
    b.shape(s.X((x0 + x1) / 2), y0, s.Z((z0 + z1) / 2), x1 - x0, y1 - y0, z1 - z0, style, color);
  // Fill ring over the ground's slopes, from the floor's edge out to the next grid line.
  const ring: [number, number, number, number][] = [[fx0 - G, fz0 - G, fx1 + G, fz0], [fx0 - G, fz1, fx1 + G, fz1 + G], [fx0 - G, fz0, fx0, fz1], [fx1, fz0, fx1 + G, fz1]];
  for (const [x0, z0, x1, z1] of ring) box(x0, z0, x1, z1, y - 0.2, 0, 'invisible');
  // The road over the concourse (its asphalt is drawn by the map), lit tiles under it.
  box(fx0, roadZ[0], fx1, roadZ[1], -0.45, 0, 'invisible');
  for (const [x0, z0, x1, z1] of minusHoles([fx0, fz0, fx1, fz1])) shape(x0, z0, x1, z1, -0.5, -0.45, 'painted', 0xe8e6e0);
  // Walls in white tile with a blue line (Bannan line), the floor in polished tile.
  const T = 0.2;
  for (const [x0, z0, x1, z1] of [[fx0, fz0, fx1, fz0 + T], [fx0, fz1 - T, fx1, fz1], [fx0, fz0, fx0 + T, fz1], [fx1 - T, fz0, fx1, fz1]] as const) {
    shape(x0, z0, x1, z1, y, -0.5, 'mosaic', 0xf2f2ee);
    shape(x0 - 0.01, z0 - 0.01, x1 + 0.01, z1 + 0.01, y + 1.6, y + 1.9, 'painted', 0x0070bd);
  }
  shape(fx0, fz0, fx1, fz1, y, y + 0.02, 'tile');
  for (let x = fx0 + 2; x < fx1 - 1; x += 4) for (let z = fz0 + 6; z < fz1 - 5; z += 4) shape(x - 0.6, z - 0.25, x + 0.6, z + 0.25, -0.56, -0.5, 'light');
  // Two rows of square columns hold up the road: cover down the hall.
  for (const z of [-166.75, -153.25]) for (const x of [-729.75, -722.25]) box(x - 0.45, z - 0.45, x + 0.45, z + 0.45, y, -0.45, 'mosaic', 0xe8e8e2);
  // The fare gates across the middle (a gap every other gate) and the ticket machines on the walls.
  for (let x = fx0 + 1.2; x < fx1 - 1; x += 2.5) {
    if (Math.round((x - fx0) / 2.5) % 2 === 1) continue;
    box(x - 0.25, -160.3, x + 0.25, -159.7, y, y + 1.05, 'painted', 0xc8ccd0);
    shape(x - 0.2, -160.25, x + 0.2, -159.75, y + 1.05, y + 1.1, 'light');
  }
  for (const x of [-731.5, -729, -719, -716.5]) box(x - 0.55, fz1 - 4.2 - 0.6, x + 0.55, fz1 - 4.2, y, y + 1.8, 'painted', 0x2a5aa8);
  b.raw({ kind: 'sign', style: 'board', x: s.X(-724.5), y: y + 2.9, z: s.Z(-160), rotY: 0, w: 6, h: 0.7, text: '捷運西門站 板南線 · 松山新店線', sub: 'MRT XIMEN STATION · BL11 · G12', bg: '#0a5aa8', fg: '#ffffff' });
  b.raw({ kind: 'sign', style: 'board', x: s.X(-724.5), y: y + 2.9, z: s.Z(-160), rotY: Math.PI, w: 6, h: 0.7, text: '出口 往 西門町 · 紅樓', sub: 'EXITS · XIMENDING · RED HOUSE', bg: '#0a5aa8', fg: '#ffffff' });
  // Stairs from the floor to each sidewalk, rails round each well, an MRT sign at the top.
  const cuts: number[] = [];
  for (const [x0, z0, x1, z1] of HOLES) {
    b.stairs(s.X((x0 + x1) / 2), s.Z((z0 + z1) / 2), x1 - x0, z1 - z0, y, KERB, 0);
    for (const [a, c] of [[z0 - 0.1, z0], [z1, z1 + 0.1]]) { box(x0 - 0.1, a, x1, c, KERB, KERB + 1.05, 'glass'); shape(x0 - 0.1, a, x1, c, KERB + 1.05, KERB + 1.12, 'painted', 0xb8bcc0); }
    box(x0 - 0.1, z0 - 0.1, x0, z1 + 0.1, KERB, KERB + 1.05, 'glass');
    // Side walls of the well down to the floor.
    shape(x0, z0 - 0.02, x1, z0, y, KERB, 'mosaic', 0xf2f2ee);
    shape(x0, z1, x1, z1 + 0.02, y, KERB, 'mosaic', 0xf2f2ee);
    b.raw({ kind: 'sign', style: 'board', x: s.X(x0 + 0.02), y: KERB + 1.6, z: s.Z((z0 + z1) / 2), rotY: Math.PI / 2, w: 2.6, h: 0.5, text: 'Ⓜ 西門站', sub: 'MRT XIMEN', bg: '#0a5aa8', fg: '#ffffff' });
    box(x0 - 0.3, (z0 + z1) / 2 - 0.08, x0 - 0.15, (z0 + z1) / 2 + 0.08, KERB, KERB + 2.0, 'steel', 0x5a6068);
    cuts.push(s.X(x0) - 0.6, 0.05, s.Z(z0) - 0.6, s.X(x1) + 0.6, 3.2, s.Z(z1) + 0.6);
  }
  return cuts;
}
