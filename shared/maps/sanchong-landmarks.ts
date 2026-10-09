import { van } from './sanchong-blocks';
import { C, Town, type R } from './sanchong-kit';
import { DECK, DECK_SOFFIT, DECK_STAIR, DECK_X0, HALL, LEVEE_X, RAMP_X0, SHED_ROOF, SQUARE, STAGE, STAGE_Y, TEMPLE, WORKSHOP, YARD } from './sanchong-plan';

/**
 * Sanchong's landmarks (sanchong.ts): the Taipei Bridge approach with its scooter ramp, the temple
 * and its square (site A), the covered market, the ironworks yard (site B), the river levee with
 * its pump station, and the two bases. Everything a soldier can reach has a collider.
 */

// ---- Taipei Bridge approach (台北橋引道) ------------------------------------------------------------
export function bridge(t: Town) {
  const y = DECK, s = DECK_SOFFIT, [sx0, sz0, sx1, sz1] = DECK_STAIR;
  // The scooter ramp (機車引道), rising east from the north-west corner to the deck: an embankment
  // under a smooth slope, with parapet walls either side.
  t.flight([RAMP_X0, -63.6, DECK_X0, -58.4], 0, y, 0, { steps: 64, base: 0, style: 'asphalt', color: 0x9a9a9a });
  t.cheek([RAMP_X0, -64, DECK_X0, -63.6], 0, 0, y, 0, 8, C.concrete, 1.1);
  t.cheek([RAMP_X0, -58.4, DECK_X0, -58], 0, 0, y, 0, 8, C.concrete, 1.1);
  // The deck: a concrete slab with asphalt on top, open over the stair to the east.
  const slab = (r: R) => { t.box(r, s, y, 'slab', 0xb8b4ac); t.shape([r[0], Math.max(r[1], -63.6), r[2], Math.min(r[3], -55.4)], y - 0.02, y + 0.012, 'asphalt', 0x8c8c8c); };
  slab([DECK_X0, -64, sx0, -55]); slab([sx0, -64, sx1, sz0]); slab([sx1, -64, LEVEE_X, -55]);
  // Parapets: north all along, south up to the stair and past it; the deck's west edge over the lane.
  const parapet = (r: R) => { t.box(r, y, y + 1.1, 'painted', C.concrete); t.shape([r[0] - 0.05, r[1] - 0.05, r[2] + 0.05, r[3] + 0.05], y + 1.1, y + 1.2, 'painted', 0xd8d4cc); };
  parapet([DECK_X0, -64, LEVEE_X, -63.6]);
  parapet([DECK_X0, -55.4, sx0, -55]); parapet([sx1, -55.4, LEVEE_X, -55]);
  parapet([DECK_X0, -58, DECK_X0 + 0.4, -55.4]);
  // The east stair, from the under-bridge lane up to the deck (rising west), railed both sides.
  t.flight([sx0, sz0 + 0.4, sx1, sz1 - 0.4], 0, y, 2, { base: 0, style: 'slab', color: 0xc4c0b8 });
  t.cheek([sx0, sz0, sx1, sz0 + 0.4], 0, 0, y, 2, 6, C.concrete, 1.0);
  t.cheek([sx0, sz1 - 0.4, sx1, sz1], 0, 0, y, 2, 6, C.concrete, 1.0);
  // Piers under the deck (cover in the lane below).
  for (const x of [-18, -6, 6, 18, 50, 62]) {
    t.box([x - 0.6, -60.1, x + 0.6, -58.9], 0, s, 'concrete', 0xb0aca4);
    t.shape([x - 0.9, -60.4, x + 0.9, -58.6], s - 0.5, s, 'painted', 0xa8a49c);
  }
  // Breaks on the deck: a stalled truck (north side) and the road works' site office (south side).
  t.box([-4, -63.4, 4, -58.2], y + 0.35, y + 2.9, 'painted', 0x2f6aa8);
  t.block([-3.6, -63, 3.6, -58.6], y, y + 0.35, 'metal');
  t.box([4, -63.2, 6, -58.4], y + 0.35, y + 2.4, 'painted', 0xe8e8e0);
  t.shape([5.98, -62.8, 6.02, -58.8], y + 1.4, y + 2.2, 'painted', 0x20262c);
  for (const x of [-2.5, 2.5, 4.9]) for (const z of [-63.45, -58.15]) t.shape([x - 0.4, z - 0.1, x + 0.4, z + 0.1], y, y + 0.8, 'painted', 0x1a1a1a);
  t.box([18, -61, 24, -55.4], y, y + 2.8, 'roof', 0xffffff);
  t.shape([17.9, -61.1, 24.1, -55.3], y + 2.8, y + 2.95, 'roof', C.tinBlue);
  t.shape([19, -61.06, 21, -61.0], y + 1.2, y + 2.2, 'painted', 0x30383e);
  t.sign('board', 21, y + 2.25, -55.33, Math.PI, 4.5, 0.6, '台北橋改善工程', '#1a5a2a', '#ffffff');
  // Road-works barriers and cones by the office.
  for (const x of [25.6, 27.2]) t.box([x, -56.4, x + 1.2, -55.8], y, y + 0.9, 'concrete', 0xd8d4cc);
  // The hoarding that closes the deck east of the stair (the bridge beyond is shut for works).
  t.box([43.6, -63.6, 44, -55.4], y, y + 3, 'painted', 0x2a6a3a);
  t.sign('billboard', 43.55, y + 1.7, -59.5, -Math.PI / 2, 7.4, 2.2, '施工中 請改道', '#2a6a3a', '#ffffff', 'BRIDGE WORKS · DETOUR');
  // Lamp standards along the parapets and the overhead sign gantry: green route signs.
  for (const x of [-20, -8, 8, 26, 38]) {
    t.shape([x - 0.1, -63.9, x + 0.1, -63.7], y + 1.1, y + 8, 'steel', 0x8a9096);
    t.shape([x - 0.1, -63.9, x + 0.1, -61.6], y + 7.9, y + 8.05, 'steel', 0x8a9096);
    t.shape([x - 0.25, -61.9, x + 0.25, -61.3], y + 7.75, y + 7.9, 'neon', 0xffe0b0);
  }
  t.shape([9.6, -64, 10.0, -55], y + 6.2, y + 6.5, 'steel', 0x8a9096);
  for (const z of [-63.8, -55.2]) t.shape([9.6, z - 0.2, 10.0, z + 0.2], y + 1.1, y + 6.5, 'steel', 0x8a9096);
  t.sign('board', 9.55, y + 5.3, -61.5, -Math.PI / 2, 4.6, 1.6, '台北橋 →', '#1a6a3a', '#ffffff', 'TAIPEI BRIDGE · 往台北');
  t.sign('board', 9.55, y + 5.3, -57.2, -Math.PI / 2, 3.6, 1.6, '機車專用', '#1d4fa8', '#ffffff', 'SCOOTERS ONLY');
  // The ramp's foot: a scooter-lane sign on a post and the arrow paint at the bottom.
  t.box([RAMP_X0 - 1.2, -59.6, RAMP_X0 - 0.9, -59.3], 0, 3.2, 'steel', 0x8a9096);
  t.sign('board', RAMP_X0 - 1.05, 3.6, -59.45, -Math.PI / 2, 2.4, 1.0, '機車引道', '#1d4fa8', '#ffffff', '台北橋');
  for (let i = 0; i < 3; i++) t.raw({ kind: 'marking', x: RAMP_X0 - 4 - i * 2.4, y: 0.02, z: -61, w: 1.4, d: 0.5, color: 0xf0f0e8 });
  // The bridge past the levee, over the river to Taipei (backdrop): deck, parapets, lamps and piers.
  for (const [x0, x1] of [[LEVEE_X, 160], [160, 262]]) {
    t.shape([x0, -64, x1, -55], s, y, 'slab', 0xb8b4ac);
    t.shape([x0, -64, x1, -63.6], y, y + 1.1, 'painted', C.concrete);
    t.shape([x0, -55.4, x1, -55], y, y + 1.1, 'painted', C.concrete);
  }
  for (const x of [100, 140, 180, 220]) t.shape([x - 1.5, -61.5, x + 1.5, -57.5], -2, s, 'concrete', 0xa8a49c);
  for (let x = 80; x < 262; x += 16) t.shape([x - 0.25, -63.9, x + 0.25, -63.7], y + 1.1, y + 7, 'neon', 0xffe0b0);
  // The under-bridge lane (橋下): breaks staggered across it (a kiosk, a scooter shop's cage, a
  // recycling pile, a stack of tyres), every one cover.
  under(t);
}

function under(t: Town) {
  // The lane's concrete floor.
  t.shape([-62, -64, 71, -53], -0.02, 0.012, 'slab', 0xa8a49c);
  // A betel-nut and drinks kiosk beside the ramp's wall.
  t.box([-44, -56.2, -40, -53], 0, 2.6, 'painted', 0xe8e4dc);
  t.shape([-44.05, -56.25, -39.95, -56.2], 0.9, 2.3, 'neon', 0x4affa0);
  t.box([-44.2, -56.5, -39.8, -53], 2.6, 2.85, 'roof', 0x60e090);
  t.sign('board', -42, 3.25, -56.52, 0, 4, 0.7, '檳榔 香菸 飲料', '#18a050', '#ffffff');
  // A parked mini truck (發財車) by the deck's west end.
  van(t, [-23, -56, -18.5, -53.8], 0x3a6ab0, true);
  // A scooter repair shop's cage under the deck (機車行): mesh walls, tyres, a work stand.
  t.box([-12, -64, -8, -55.5], 0, 2.6, 'steel', 0x5a6066);
  t.shape([-12.05, -55.55, -7.95, -55.45], 0.1, 2.5, 'painted', 0x2a2e32);
  for (let i = 0; i < 3; i++) t.raw({ kind: 'cylinder', x: -7.55, y: i * 0.25, z: -58 - i * 0.05, radius: 0.32, height: 0.24, axis: 'y', style: 'painted', color: 0x1c1c1c, sides: 10 });
  t.block([-7.95, -58.4, -7.15, -57.6], 0, 0.75, 'metal');
  t.sign('board', -10, 3.0, -55.4, Math.PI, 3.6, 0.7, '機車行', '#c8141e', '#ffffff', '修理 · 保養');
  // A recycling collector's pile: bales of cardboard and a cart (south side).
  t.box([22, -60.5, 26, -53], 0, 1.9, 'painted', 0xb89a6a);
  t.box([22.4, -59.9, 25.4, -54], 1.9, 2.6, 'painted', 0xa88a5a);
  t.shape([21.9, -60.55, 26.1, -52.95], 1.0, 1.05, 'painted', 0x2a2a2a);
  // Stacked tyres and drums (north side, east).
  t.box([48, -64, 52, -57.5], 0, 2.4, 'painted', 0x2a2a2c);
  t.shape([47.95, -57.55, 52.05, -57.5], 0.2, 2.2, 'painted', 0x3a3a3c);
}

// ---- The temple (神農宮) and its square (廟口): site A -----------------------------------------------
export function temple(t: Town) {
  const [x0, z0, x1, z1] = TEMPLE, H = 5.2, wall = 0.5;
  t.shape(SQUARE, -0.02, 0.014, 'cobble', 0xc4beb4);
  t.shape([x0, z0, x1, z1], -0.02, 0.016, 'slab', 0xb87a5a);
  // Walls: the front (west) wall behind the portico with the door on the temple's axis (z = -45),
  // the solid north and south walls, the back wall with a door onto the east main street (z = -40).
  const front = x0 + 2.5;
  t.wall('z', front + wall / 2, z0, z1, 0, H, [{ at: -45, width: 3, top: 3.6 }], 'painted', C.red, wall);
  t.wall('x', z0 + wall / 2, x0, x1, 0, H, [], 'painted', C.redDeep, wall);
  t.wall('x', z1 - wall / 2, x0, x1, 0, H, [], 'painted', C.redDeep, wall);
  t.wall('z', x1 - wall / 2, z0 + wall, z1 - wall, 0, H, [{ at: -40, width: 3, top: 3.4 }], 'painted', C.redDeep, wall);
  // Stone dado round the outside and the window grilles (carved stone, drawn as bars).
  for (const r of [[front - 0.02, z0, front + wall + 0.02, z1], [x0, z0 - 0.02, x1, z0 + wall + 0.02], [x0, z1 - wall - 0.02, x1, z1 + 0.02], [x1 - wall - 0.02, z0, x1 + 0.02, z1]] as R[]) t.shape(r, 0, 0.9, 'painted', C.stone);
  // Carved stone windows (solid: the temple is no see-through), drawn as a dark panel behind bars.
  for (const zc of [-49.5, -40.5]) {
    t.shape([front - 0.03, zc - 0.8, front, zc + 0.8], 1.1, 2.5, 'painted', 0x2a1a14);
    for (let k = -2; k <= 2; k++) t.shape([front - 0.07, zc + k * 0.3 - 0.04, front - 0.03, zc + k * 0.3 + 0.04], 1.1, 2.5, 'painted', C.stone);
  }
  // Ceiling over the hall.
  t.box([front, z0, x1, z1], H, H + 0.3, 'painted', 0x6a2a20);
  // The portico (三川殿 front): red columns (cover), stone lions either side of the door, lanterns.
  for (const z of [-50.5, -47.5, -42.5, -39.5]) t.b.cylinder(x0 + 0.5, 0, z, 0.3, 4.6, 'painted', 'y', C.red);
  t.shape([x0 - 0.6, z0 - 0.4, front, z1 + 0.4], 4.6, 4.9, 'painted', 0x6a2a20);
  for (const z of [-47.2, -42.8]) {
    t.box([front - 1.3, z - 0.45, front - 0.4, z + 0.45], 0, 0.7, 'painted', C.stone);
    t.box([front - 1.25, z - 0.35, front - 0.45, z + 0.35], 0.7, 1.5, 'painted', 0x8a8884);
    t.raw({ kind: 'ball', x: front - 0.85, y: 1.75, z, radius: 0.36, style: 'painted', color: 0x8a8884 });
  }
  for (const z of [-49, -45, -41]) t.raw({ kind: 'cylinder', x: x0 + 0.9, y: 3.5, z, radius: 0.34, height: 0.7, axis: 'y', style: 'neon', color: 0xff3020, sides: 10 });
  // Door leaves standing open (door gods, 門神) and the name board over the door.
  for (const z of [-47.2, -42.8]) t.shape([front - 0.04, z - 0.4, front, z + 0.4], 1.5, 3.4, 'painted', 0xc8321e);
  t.sign('board', front - 0.04, 4.15, -45, -Math.PI / 2, 3.2, 0.9, '神農宮', '#14306a', '#f0c050');
  t.sign('blade', x0 + 0.9, 2.6, -36.9, -Math.PI / 2, 0.5, 1.6, '風調雨順', '#c8141e', '#ffe08a');
  // Inside: the main altar (cover) with the deity and offerings, a kneeling table, red pillars.
  t.box([22, -49, 24.5, -41], 0, 1.1, 'painted', 0x8a2a1a);
  t.shape([21.95, -49.05, 24.55, -40.95], 1.05, 1.15, 'painted', C.gold);
  t.box([23.2, -46.2, 24.4, -43.8], 1.1, 2.6, 'painted', 0x5a1a10);
  t.raw({ kind: 'cylinder', x: 23.6, y: 1.1, z: -45, radius: 0.45, height: 1.3, axis: 'y', style: 'painted', color: C.gold, sides: 10 });
  t.raw({ kind: 'ball', x: 23.6, y: 2.75, z: -45, radius: 0.32, style: 'painted', color: C.gold });
  t.box([19.6, -46.5, 20.6, -43.5], 0, 0.85, 'painted', 0x6a1a10);
  for (const z of [-48, -46, -44, -42]) t.shape([20.8, z - 0.15, 21.4, z + 0.15], 1.0, 1.3, 'painted', [0xe86a2a, 0xf0d040, 0xd83a2a, 0x7ab040][(z + 48) / 2]);
  for (const [x, z] of [[19, -50.5], [19, -38], [24, -38]]) t.b.cylinder(x, 0, z, 0.28, H, 'painted', 'y', C.red);
  for (const z of [-48, -44, -40]) t.raw({ kind: 'cylinder', x: 21, y: 4.1, z, radius: 0.3, height: 0.6, axis: 'y', style: 'neon', color: 0xff4a20, sides: 10 });
  t.shape([24.6, -48.5, 25.4, -41.5], 2.8, 4.6, 'painted', C.gold);
  // The roof: stepped glazed-tile tiers, a ridge along the front with swallowtail ends (燕尾) and
  // its figures (剪黏): dragons either side of a pearl.
  t.shape([x0 - 0.8, z0 - 1, x1, z1], H + 0.3, H + 0.6, 'roof', C.roofOrange);
  t.shape([front - 0.2, z0 + 0.2, x1 - 0.2, z1 - 0.2], H + 0.6, H + 1.6, 'roof', C.roofOrange);
  t.shape([front + 1.5, z0 + 1.6, x1 - 1.6, z1 - 1.6], H + 1.6, H + 2.4, 'roof', C.roofOrange);
  t.shape([x0 - 0.4, z0 + 0.6, front + 0.2, z1 - 0.6], 4.9, 5.4, 'roof', C.roofGreen);
  const rx = (front + 1.5 + x1 - 1.6) / 2, ry = H + 2.4;
  t.shape([rx - 0.45, z0 + 1.3, rx + 0.45, z1 - 1.3], ry, ry + 0.55, 'painted', 0xc8401e);
  for (const s of [-1, 1]) {
    const end = s < 0 ? z0 + 1.3 : z1 - 1.3;
    t.shape([rx - 0.4, Math.min(end, end + s * 0.9), rx + 0.4, Math.max(end, end + s * 0.9)], ry + 0.35, ry + 0.85, 'painted', 0xc8401e);
    t.shape([rx - 0.32, Math.min(end + s * 0.9, end + s * 1.6), rx + 0.32, Math.max(end + s * 0.9, end + s * 1.6)], ry + 0.75, ry + 1.4, 'painted', 0xc8401e);
    t.shape([rx - 0.25, Math.min(end + s * 1.6, end + s * 2.1), rx + 0.25, Math.max(end + s * 1.6, end + s * 2.1)], ry + 1.3, ry + 1.9, 'painted', 0xc8401e);
    // A dragon: body, head and tail in green and gold.
    const dz = -44 + s * 2.4;
    t.shape([rx - 0.18, dz - 1.2, rx + 0.18, dz + 1.2], ry + 0.55, ry + 0.95, 'painted', 0x2a9a5a);
    t.shape([rx - 0.2, dz - s * 1.5 - 0.3, rx + 0.2, dz - s * 1.5 + 0.3], ry + 0.7, ry + 1.25, 'painted', C.gold);
    t.shape([rx - 0.12, dz + s * 1.2, rx + 0.12, dz + s * 1.7], ry + 0.8, ry + 1.4, 'painted', 0x2a9a5a);
  }
  t.raw({ kind: 'ball', x: rx, y: ry + 1.15, z: -44, radius: 0.38, style: 'painted', color: C.gold });
  // Square: the incense burner (香爐) on the temple's axis, the gold furnace (金爐), offering
  // tables, lantern strings, and the opera stage (戲台) facing the temple.
  t.box([6.6, -45.9, 8.4, -44.1], 0, 0.6, 'painted', C.stone);
  t.b.cylinder(7.5, 0.6, -45, 0.8, 1.0, 'painted', 'y', 0x4a3a2a);
  t.raw({ kind: 'cylinder', x: 7.5, y: 1.6, z: -45, radius: 0.95, height: 0.12, axis: 'y', style: 'painted', color: 0x3a2a1a, sides: 16 });
  t.raw({ kind: 'cylinder', x: 7.5, y: 1.72, z: -45, radius: 0.55, height: 0.6, axis: 'y', style: 'painted', color: 0x4a3a2a, sides: 12, top: 0.2 });
  t.raw({ kind: 'ball', x: 7.5, y: 2.45, z: -45, radius: 0.18, style: 'painted', color: C.gold });
  t.block([6.9, -45.6, 8.1, -44.4], 1.6, 2.3, 'metal');
  for (let i = 0; i < 5; i++) t.shape([7.3 + i * 0.1, -45.05, 7.33 + i * 0.1, -44.95], 1.6, 2.3 + (i % 2) * 0.2, 'neon', 0xff8040);
  // Gold furnace: a brick oven with a tiled roof and a chimney.
  t.box([10, -52.6, 13, -49.6], 0, 2.4, 'brick', 0xc87a5a);
  t.shape([11.1, -51.5, 11.9, -50.7], 1.0, 1.6, 'neon', 0xff7020);
  t.shape([9.7, -52.9, 13.3, -49.3], 2.4, 2.7, 'roof', C.roofOrange);
  t.box([11.1, -51.6, 11.9, -50.6], 2.7, 5.8, 'brick', 0xb86a4a);
  t.shape([10.95, -51.75, 12.05, -50.45], 5.8, 6.0, 'roof', C.roofOrange);
  // Offering tables in front of the portico (red cloths, fruit, incense).
  for (const z of [-48, -42]) {
    t.box([11.2, z - 1.5, 12.4, z + 1.5], 0, 0.85, 'painted', 0xb8201a);
    for (let k = 0; k < 4; k++) t.shape([11.45, z - 1.2 + k * 0.7, 12.15, z - 0.75 + k * 0.7], 0.85, 1.1, 'painted', [0xf0a020, 0xd84030, 0x7ab040, 0xf0e0c0][k]);
  }
  // Lantern strings across the square on two poles.
  for (const z of [-52.4, -37]) t.box([12.9, z - 0.15, 13.2, z + 0.15], 0, 6.5, 'steel', C.iron);
  for (const x of [-3.6, 12.9]) t.shape([x, -52.4, x + 0.05, -37], 5.9, 5.95, 'painted', 0x18181a);
  for (let i = 0; i < 9; i++) {
    for (const x of [-3.6, 12.9]) t.raw({ kind: 'cylinder', x: x + 0.02, y: 5.35, z: -51.6 + i * 1.75, radius: 0.22, height: 0.45, axis: 'y', style: 'neon', color: i % 3 === 1 ? 0xffd040 : 0xff3020, sides: 8 });
  }
  t.shape([-3.6, -52.4, 12.9, -52.35], 6.2, 6.25, 'painted', 0x18181a);
  stage(t);
  // Plastic stools stacked by the stage and a tea table (knee-high cover).
  t.box([1.6, -44.4, 3.0, -43.2], 0, 0.9, 'painted', 0xd8302a);
  t.box([-3.4, -44.4, -1.8, -43.4], 0, 0.75, 'painted', 0x2a6ab8);
}

/** The opera stage (戲台): a raised platform on the square's west side, roofed, facing the temple. */
function stage(t: Town) {
  const [x0, z0, x1, z1] = STAGE, y = STAGE_Y;
  t.box(STAGE, 0, y, 'painted', 0x6a2a20);
  t.shape([x1, z0 + 0.1, x1 + 0.03, z1 - 0.1], 0.1, y - 0.1, 'painted', 0xb8201a);
  t.sign('board', x1 + 0.05, 0.65, (z0 + z1) / 2 + 1.2, Math.PI / 2, 3.8, 0.8, '酬神謝戲', '#b8201a', '#ffe08a');
  // Steps up the front at the north end.
  t.flight([x1, -52.5, x1 + 2.5, -49.5], 0, y, 2, { base: 0, style: 'painted', color: 0x7a3a2a });
  // Back wall (the painted backdrop), the north side wall, posts and the roof.
  t.box([x0, z0, x0 + 0.3, z1], y, 5.4, 'painted', 0x7a2a20);
  t.sign('billboard', x0 + 0.33, 3.4, (z0 + z1) / 2, Math.PI / 2, 6.6, 3.0, '歌仔戲', '#8a1a20', '#ffd860', '今晚 七點 · 廟口');
  t.box([x0 + 0.3, z0, x1, z0 + 0.3], y, 5.4, 'painted', 0x7a2a20);
  for (const z of [z1 - 0.15]) t.box([x1 - 0.3, z - 0.15, x1, z + 0.15], y, 5.4, 'painted', C.red);
  t.box([x1 - 0.3, z0, x1, z0 + 0.3], y, 5.4, 'painted', C.red);
  t.shape([x0 - 0.4, z0 - 0.4, x1 + 0.6, z1 + 0.4], 5.4, 5.7, 'roof', C.roofOrange);
  t.shape([x0 + 1.5, z0 + 0.4, x1 - 1, z1 - 0.4], 5.7, 6.2, 'roof', C.roofOrange);
  // A valance and footlights.
  t.shape([x1 - 0.05, z0 + 0.3, x1 + 0.05, z1 - 0.3], 4.7, 5.4, 'painted', 0xc8201a);
  t.shape([x1 - 0.2, z0 + 0.4, x1 - 0.1, z1 - 0.4], y, y + 0.08, 'neon', 0xffe8b0);
}

// ---- The covered market (市場) --------------------------------------------------------------------
export function market(t: Town) {
  const { x0, x1, roof } = HALL;
  // Wet concrete floor, the roof (corrugated, galvanised) and its raised skylight, tube lights.
  t.shape([x0, -6.5, x1, 6.5], -0.02, 0.014, 'slab', 0xd0d4cc);
  // Bare bulbs under red shades hanging over the aisles.
  for (let x = x0 + 2.2; x < x1; x += 3.3) for (const z of [-3.4, 3.4]) {
    t.shape([x - 0.01, z - 0.01, x + 0.01, z + 0.01], 3.0, roof, 'painted', 0x18181a);
    t.raw({ kind: 'cylinder', x, y: 2.75, z, radius: 0.24, height: 0.25, axis: 'y', style: 'painted', color: 0xc8281e, sides: 8, top: 0.08 });
    t.shape([x - 0.08, z - 0.08, x + 0.08, z + 0.08], 2.62, 2.78, 'neon', 0xffe8b0);
  }
  t.box([x0, -6.5, x1, 6.5], roof, roof + 0.25, 'roof', 0xe0e8ec);
  t.shape([x0, -1.4, x1, 1.4], roof + 0.25, roof + 0.95, 'roof', 0xf4f8fc);
  for (let x = x0 + 3; x < x1; x += 4.5) for (const z of [-3.4, 3.4]) t.shape([x - 0.6, z - 0.05, x + 0.6, z + 0.05], roof - 0.3, roof - 0.24, 'neon', 0xf0f4ff);
  for (let x = x0 + 1; x < x1; x += 6) t.shape([x - 0.1, -1.3, x + 0.1, 1.3], roof - 0.25, roof, 'steel', C.iron);
  // The hall's end walls, gabled above the roof: one door each, into the north aisle at the west
  // end and the south aisle at the east end (no view runs through the hall), the gate signs above.
  for (const [x, door, rot] of [[x0 + 0.2, -3.5, -Math.PI / 2], [x1 - 0.2, 3.5, Math.PI / 2]] as [number, number, number][]) {
    t.wall('z', x, -6.5, 6.5, 0, roof + 1.8, [{ at: door, width: 4, top: 3.4 }], 'painted', 0xd8ccb8, 0.4);
    t.shape([x - 0.25, -6.6, x + 0.25, 6.6], roof + 1.8, roof + 2.0, 'painted', 0x8a2a20);
    const face = x + (rot > 0 ? 0.24 : -0.24);
    t.sign('gate', face, roof + 0.4, door, rot, 4.6, 1.3, '三重市場', '#8a1a14', '#ffffff', 'SANCHONG MARKET');
    t.sign('board', face, 2.0, -door * 0.6, rot, 3.6, 0.9, rot > 0 ? '生鮮 · 熟食' : '傳統市場', '#1d5fa8', '#ffffff');
  }
  // Centre row: four islands of stalls with racks of hanging goods (eye-high cover), crossings at
  // x = -15, 0 and 15.
  const goods = [[0xd84a2a, 0xf0c040, 0x7ab040], [0xe8d8c8, 0xc8a080, 0xf0f0e8], [0x5a9a3a, 0x8ac050, 0x3a7a2a], [0xc83a3a, 0xf0e0d0, 0xe89060]];
  const islands: [number, number][] = [[-28, -16.5], [-13.5, -1.5], [1.5, 13.5], [16.5, 28]];
  islands.forEach(([a, c], i) => {
    t.stall([a, -1.25, c, 1.25], [C.tarpRed, C.tarpBlue, C.tarpYellow, C.tarpGreen][i], goods[i]);
    // A back rack of crates and shelves up the island's middle (eye-high cover), goods on its shelves.
    t.box([a + 0.3, -0.7, c - 0.3, 0.7], 0.95, 2.1, 'wood', 0x9a7a58);
    t.shape([a + 0.25, -1.0, c - 0.25, 1.0], 1.5, 1.56, 'wood', 0x7a5a40);
    t.shape([a + 0.25, -1.0, c - 0.25, 1.0], 2.1, 2.16, 'wood', 0x7a5a40);
    const hues = [0xd84a4a, 0xf0a030, 0xf0d060, 0x8ac050, 0xe8e0d0, 0x5a9a5a, 0xc86a9a];
    for (let x = a + 0.6; x < c - 0.5; x += 0.55) for (const [z, y] of [[-0.95, 1.56], [0.62, 1.56], [-0.95, 2.16], [0.62, 2.16]]) {
      const k = Math.floor(Math.abs(x * 11 + y * 3 + z)) % hues.length;
      if (k === 3 && y > 2) continue;
      t.shape([x - 0.2, z, x + 0.2, z + 0.33], y, y + 0.22 + (k % 3) * 0.06, 'painted', hues[k]);
    }
  });
  // A stall across each aisle: the north aisle (in from the west door) is shut east of the -15
  // crossing, the south aisle (in from the east door) west of the 15 crossing, so a run through
  // the hall weaves from aisle to aisle.
  const across: [number, number, number, number, number][] = [[-10, -7, -6.5, -1.25, C.tarpBlue], [10.5, 13.5, 1.25, 6.5, C.tarpGreen]];
  for (const [a, c, za, zc, col] of across) {
    t.box([a, za, c, zc], 0, 2.4, 'wood', C.wood);
    t.shape([a - 0.3, za, c + 0.3, zc], 2.4, 2.48, 'painted', col);
    for (let z = za + 0.4; z < zc - 0.3; z += 0.8) t.shape([a - 0.06, z, a - 0.02, z + 0.5], 1.0, 2.2, 'painted', 0xe8e0d0);
  }
  // Counters along both walls (open where the lanes and gates come in).
  const north: [number, number][] = [[x0 + 0.4, -10], [-7, 3], [7, x1 - 0.4]];
  const south: [number, number][] = [[-27.5, -12], [-8, 5.5], [13.5, 27.5]];
  north.forEach(([a, c], i) => t.stall([a + 0.2, -6.5, c - 0.2, -5.6], [C.tarpGreen, C.tarpRed, C.tarpBlue, C.tarpYellow][i % 4], goods[(i + 1) % 4]));
  south.forEach(([a, c], i) => t.stall([a + 0.2, 5.6, c - 0.2, 6.5], [C.tarpYellow, C.tarpBlue, C.tarpRed, C.tarpGreen, C.tarpBlue][i % 5], goods[(i + 2) % 4]));
  // Hanging boards over the stalls.
  const names = ['豬肉', '魚貨', '青菜', '水果', '雞鴨', '熟食', '南北貨', '早點'];
  names.forEach((n, i) => {
    const x = x0 + 4 + i * 7.4, z = i % 2 ? 3.4 : -3.4;
    t.sign('board', x, 3.5, z, Math.PI / 2, 1.8, 0.6, n, i % 2 ? '#c8141e' : '#1d5fa8', '#ffffff');
  });
  // The open-air ends: stall sheds that close half the street in front of each door (west on the
  // north side, east on the south), umbrellas and parked carts.
  shed(t, [-46, -6.5, -42, 0.5], C.tinBlue, '水果', true);
  shed(t, [42, -0.5, 46, 6.5], C.tinRust, '涼麵', false);
  for (const [x, z] of [[-37, -4.5], [-50, 4.5], [37, 4.5], [50, -4.5]]) {
    t.box([x - 0.9, z - 0.6, x + 0.9, z + 0.6], 0, 0.95, 'wood', C.wood);
    t.shape([x - 0.03, z - 0.03, x + 0.03, z + 0.03], 0.95, 2.4, 'steel', C.iron);
    t.raw({ kind: 'cylinder', x, y: 2.35, z, radius: 1.4, height: 0.35, axis: 'y', style: 'painted', color: x < 0 ? C.tarpRed : C.tarpBlue, sides: 8, top: 0.1 });
  }
}

/** A tin stall shed (cover): walls of corrugated sheet, a counter, a sign on its front. */
function shed(t: Town, r: R, tin: number, name: string, north: boolean) {
  const [x0, z0, x1, z1] = r;
  t.box(r, 0, 2.6, 'roof', tin);
  t.shape([x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3], 2.6, 2.7, 'roof', 0xf4f4f4);
  const face = north ? z1 : z0;
  t.box([x0 + 0.2, north ? face : face - 0.6, x1 - 0.2, north ? face + 0.6 : face], 0, 0.95, 'wood', C.wood);
  t.sign('board', (x0 + x1) / 2, 2.15, north ? face + 0.02 : face - 0.02, north ? Math.PI : 0, x1 - x0 - 0.4, 0.7, name, '#c8141e', '#ffffff');
}

// ---- The ironworks (鐵工廠): site B ---------------------------------------------------------------
export function factory(t: Town) {
  const [wx0, wz0, wx1, wz1] = WORKSHOP, h = SHED_ROOF, tin = 0xb8d0ec, w = 0.3;
  // The workshop: tin walls on a brick plinth, doors west (lane) and east (yard), a walkable roof.
  t.shape([wx0, wz0, wx1, wz1], -0.02, 0.016, 'slab', 0x8a8a84);
  t.wall('z', wx0 + w / 2, wz0, wz1, 0, h, [{ at: 17.5, width: 3, top: 3.4 }], 'roof', tin, w);
  t.wall('z', wx1 - w / 2, wz0, wz1, 0, h, [{ at: 12.5, width: 3, top: 3.4 }, { at: 22.5, width: 3, top: 3.4 }], 'roof', tin, w);
  t.wall('x', wz0 + w / 2, wx0 + w, wx1 - w, 0, h, [], 'roof', tin, w);
  t.wall('x', wz1 - w / 2, wx0 + w, wx1 - w, 0, h, [], 'roof', tin, w);
  t.box([wx0, wz0, wx1, wz1], h, h + 0.3, 'roof', 0xd8e4ee);
  // Rails round the roof (open where the ladder arrives), and a tall sign board on its north edge
  // (it keeps the market roof out of reach).
  const top = h + 0.3, rail = (r: R) => t.box(r, top, top + 1.1, 'steel', 0x6a7076);
  // Roof plant: an extractor fan's housing and a water tank on its stand (cover up here).
  t.box([-5.6, 13.4, -3.6, 15.4], top, top + 1.3, 'steel', 0xb8c0c8);
  t.raw({ kind: 'cylinder', x: -4.6, y: top + 1.3, z: 14.4, radius: 0.7, height: 0.25, axis: 'y', style: 'steel', color: 0x5a6066, sides: 12 });
  t.box([-6.2, 22.6, -4.4, 24.4], top, top + 0.8, 'steel', C.iron);
  t.b.cylinder(-5.3, top + 0.8, 23.5, 0.8, 1.4, 'painted', 'y', C.steel);
  rail([wx0, wz0 + 0.3, wx0 + 0.1, wz1]); rail([wx0, wz1 - 0.1, wx1, wz1]);
  rail([wx1 - 0.1, wz0 + 0.3, wx1, 18]); rail([wx1 - 0.1, 19.2, wx1, wz1 - 0.1]);
  t.box([wx0, wz0, wx1, wz0 + 0.3], top, top + 2.2, 'painted', 0x1d4fa8);
  t.sign('board', (wx0 + wx1) / 2, top + 1.1, wz0 + 0.32, Math.PI, 7.6, 2.0, '永興鐵工廠', '#1d4fa8', '#ffffff', '鐵門 · 鐵窗 · 不鏽鋼');
  t.b.ladder(0, 18.6, 0, top, 2);
  // Inside: a lathe, a press, a steel rack and a welding bench (cover), tube lights.
  t.box([-6.6, 9, -4, 11], 0, 1.2, 'painted', 0x3a6a4a);
  t.box([-3, 24.6, -1, 26.8], 0, 2.0, 'painted', 0x4a5a6a);
  t.box([-7.7, 20, -6.7, 27.2], 0, 2.2, 'steel', 0x8a5236);
  t.box([-4.6, 15, -2.4, 16.6], 0, 0.9, 'steel', 0x5a5a5a);
  for (const z of [10, 15, 20, 25]) t.shape([-4.6, z - 0.05, -3.4, z + 0.05], h - 0.35, h - 0.28, 'neon', 0xf0f4ff);
  t.sign('board', -4, 3.3, wz1 + 0.04, Math.PI, 6, 1.1, '永興鐵工廠', '#3a3e44', '#ffb02a', '電焊 · 車床');
  t.sign('board', wx0 - 0.04, 4.1, 12, -Math.PI / 2, 4, 0.9, '鐵工', '#3a3e44', '#ffb02a');

  // The yard: brick walls with gates north (to the market) and south (to the alley).
  const [yx0, yz0, yx1, yz1] = YARD;
  t.shape([yx0, wz0, yx1, 28], -0.02, 0.016, 'slab', 0x9c9890);
  t.wall('x', (wz0 + yz0) / 2, yx0, yx1, 0, 3.0, [{ at: 7.5, width: 4, top: 3.0 }], 'brick', C.brick, yz0 - wz0);
  t.wall('x', (yz1 + 28) / 2, yx0, yx1, 0, 3.0, [{ at: 12.5, width: 4, top: 3.0 }], 'brick', C.brick, 28 - yz1);
  for (const x of [5.5, 9.5]) t.box([x - 0.25, wz0, x + 0.25, yz0], 0, 3.4, 'concrete', 0xb0aca4);
  for (const x of [10.5, 14.5]) t.box([x - 0.25, yz1, x + 0.25, 28], 0, 3.4, 'concrete', 0xb0aca4);
  t.sign('board', 7.5, 3.7, wz0 - 0.03, 0, 4.6, 0.6, '工廠重地 閒人勿進', '#f0f0e8', '#c8141e');
  // Sliding gates pushed open along the walls.
  t.shape([9.8, yz0 + 0.02, 13.8, yz0 + 0.1], 0.1, 2.6, 'steel', 0x5a6066);
  t.shape([14.7, yz1 - 0.1, 18.7, yz1 - 0.02], 0.1, 2.6, 'steel', 0x5a6066);
  // Cover in the yard: steel plate stacks, a container, oil drums, a gas-bottle cage, a forklift.
  t.box([4, 12, 8, 14], 0, 1.1, 'steel', 0x6a5a4a);
  t.shape([4.1, 12.1, 7.9, 13.9], 1.1, 1.2, 'steel', 0x8a7a6a);
  t.box([13, 16.5, 19, 19], 0, 2.6, 'container');
  t.block([2.5, 21, 4.9, 23.4], 0, 0.95, 'metal');
  for (const [x, z] of [[3.0, 21.5], [3.75, 21.5], [4.5, 21.5], [3.0, 22.3], [3.75, 22.3], [4.5, 22.9]]) t.raw({ kind: 'cylinder', x, y: 0, z, radius: 0.32, height: 0.95, axis: 'y', style: 'painted', color: [0x2a5a9a, 0xc84a2a, 0x3a7a3a][Math.round(x * 4) % 3], sides: 10 });
  t.box([8, 24.4, 10, 26.4], 0, 1.8, 'steel', 0x8a9096);
  for (const x of [8.4, 8.9, 9.4]) t.raw({ kind: 'cylinder', x, y: 0.05, z: 25.4, radius: 0.18, height: 1.5, axis: 'y', style: 'painted', color: x > 9 ? 0x2a7a3a : 0x2a2a2a, sides: 8 });
  t.box([14.6, 22.2, 16.2, 24.6], 0, 1.5, 'painted', 0xe8b020);
  t.shape([14.5, 22.0, 16.3, 22.2], 0, 2.2, 'steel', 0x2a2a2a);
  // The overhead crane's girder across the yard on two legs (decorative, above the heads).
  t.raw({ kind: 'truss', x0: yx0 + 0.5, y0: 6.2, z0: 17.5, x1: yx1 - 0.5, y1: 6.2, z1: 17.5, w: 0.8, h: 0.9, color: 0xe8b020 });
  t.shape([yx1 - 0.6, 17.2, yx1 - 0.3, 17.8], 0, 6.2, 'steel', 0xe8b020);
  t.shape([10, 17.3, 10.6, 17.7], 4.8, 6.2, 'steel', 0x5a5a5a);
  t.shape([10.05, 17.35, 10.55, 17.65], 4.0, 4.8, 'steel', 0x2a2a2a);

  // The print shop (two storeys) east of the yard, its store by the south wall, and the passage
  // between them from the lane at x = 30 into the yard.
  t.apartment([20, 6.5, 28, 20], 2, C.grey, 501, { street: ['e', 's'], addon: false, blades: 1 });
  t.box([20, 24, 28, 28], 0, 3.8, 'painted', 0xd8d0c0);
  t.shape([19.9, 23.9, 28.1, 28.1], 3.8, 4.0, 'roof', C.tinBlue);
  t.sign('board', 24, 3.2, 19.95 + 0.1, 0, 7.6, 0.9, '大同印刷廠', '#1a3a6a', '#ffffff', '名片 · 傳單 · 喜帖');
  t.shape([20, 20, 20.3, 24], 3.6, 4.0, 'steel', 0x5a6066);
  t.shape([27.7, 20, 28, 24], 3.6, 4.0, 'steel', 0x5a6066);
  t.shape([20, 23.7, 28, 24], 3.6, 4.0, 'steel', 0x5a6066);
  t.box([24.4, 23.25, 26.6, 23.95], 0, 1.3, 'crate', 0xc8b088);
}

// ---- The levee (淡水河堤防), the pump station and the river ---------------------------------------------
export function levee(t: Town) {
  const x = LEVEE_X;
  t.box([x, -64, x + 1.5, 47], 0, 5, 'concrete', 0xbcb8b0);
  t.shape([x - 0.1, -64, x + 1.6, 47], 5, 5.25, 'painted', 0xa8a49c);
  t.shape([x - 0.03, -64, x, 47], 0.0, 0.6, 'painted', 0x8a8a84);
  // Murals and notices on the wall's face, and the evacuation gate (疏散門), shut.
  t.sign('billboard', x - 0.05, 2.9, -45, -Math.PI / 2, 9, 2.6, '淡水河', '#2a6a9a', '#ffffff', 'TAMSUI RIVER · 三重');
  t.sign('board', x - 0.05, 3.2, 20, -Math.PI / 2, 5, 1.0, '防汛期間 注意安全', '#f0d040', '#1a1a1a');
  t.shape([x - 0.12, -18, x, -14], 0, 3.6, 'steel', 0x8a9096);
  for (let k = 0; k < 6; k++) t.shape([x - 0.16, -18 + k * 0.7, x - 0.1, -17.7 + k * 0.7], 0, 3.6, 'painted', k % 2 ? 0x1a1a1a : 0xf0c020);
  t.sign('board', x - 0.18, 4.2, -16, -Math.PI / 2, 3.6, 0.8, '疏散門', '#1a5a2a', '#ffffff', 'EVACUATION GATE');
  // The pump station (抽水站) juts from the levee into the road: its pipes over the wall.
  t.box([61, -34, x, -24], 0, 7, 'painted', 0xb8c4c8);
  t.shape([60.9, -34.1, x + 0.1, -23.9], 7, 7.3, 'painted', 0x8a9aa0);
  for (const z of [-31, -27]) t.raw({ kind: 'cylinder', x: x - 2, y: 7.3 + 0.7, z, radius: 0.7, height: 6, axis: 'x', style: 'steel', color: 0x4a7aa8 });
  t.sign('board', 60.85, 5.5, -29, -Math.PI / 2, 4, 1.0, '抽水站', '#1a5a8a', '#ffffff', 'PUMP STATION');
  t.shape([60.95, -31.2, 61, -26.8], 0, 3.2, 'steel', 0x5a6a72);
  // Past the wall: the riverside park and the river, Taipei's skyline across it.
  t.shape([x + 1.5, -300, 98, 300], 0, 0.3, 'painted', 0x6a8a4a);
  t.raw({ kind: 'water', x: 180, y: 0.2, z: 0, w: 164, d: 700 });
  skyline(t);
}

/** Taipei across the river (Datong and beyond): towers of facade blocks (no collision, out of reach). */
function skyline(t: Town) {
  const tints = [0xd8d4cc, 0xc8ccd0, 0xb8c0c4, 0xe0d8c8, 0xa8b0b4];
  let k = 0;
  for (let z = -290; z < 290; z += 18) {
    const h = 18 + ((k * 37) % 50) + (Math.abs(z) < 80 ? 12 : 0), w = 12 + (k * 13) % 10, d = 12 + (k * 7) % 9;
    t.shape([262 + (k % 3) * 6, z, 262 + (k % 3) * 6 + w, z + d], 0, h, 'facade', tints[k % tints.length]);
    k++;
  }
}

// ---- The bases ---------------------------------------------------------------------------------------
export function bases(t: Town) {
  // Militia: the night-market car park (west), round a temple-fair neon truck (電子花車).
  t.shape([-76, -12, -54, 12], -0.02, 0.016, 'asphalt', 0x7a7a7a);
  for (let z = -10.5; z < 12; z += 2.6) t.raw({ kind: 'marking', x: -74, y: 0.03, z, w: 3.6, d: 0.12, color: 0xf0f0e8 });
  t.box([-60.5, -4, -58, 4], 0.35, 2.4, 'painted', 0x2a3a8a);
  t.block([-60.2, -3.7, -58.3, 3.7], 0, 0.35, 'metal');
  t.box([-60.5, -4, -58, -2.2], 2.4, 3.2, 'painted', 0xe8e8f0);
  t.shape([-60.4, -2.1, -58.1, 3.9], 2.4, 2.48, 'painted', 0xd8d0e8);
  t.shape([-60.55, -2, -60.5, 3.8], 1.2, 2.3, 'neon', 0xff3ad8);
  t.shape([-58.0, -2, -57.95, 3.8], 1.2, 2.3, 'neon', 0x3affd8);
  for (let i = 0; i < 6; i++) t.raw({ kind: 'cylinder', x: -59.25, y: 2.48, z: -1.6 + i * 1.0, radius: 0.12, height: 1.4 + (i % 3) * 0.3, axis: 'y', style: 'neon', color: [0xff3ad8, 0xffd040, 0x3affd8][i % 3], sides: 6 });
  t.sign('marquee', -57.93, 3.0, 0.9, Math.PI / 2, 5.6, 0.6, '', '#2a1a4a', '#ffe060');
  t.sign('board', -57.93, 1.7, 0.9, Math.PI / 2, 5.0, 0.8, '電子花車', '#ff3ad8', '#ffffff');
  for (const z of [-11, 10]) t.box([-66, z - 0.6, -64.6, z + 0.6], 0, 1.2, 'painted', 0xd8302a);
  t.sign('gate', -54.5, 7.2, 0, Math.PI / 2, 9, 1.6, '三重夜市', '#c8141e', '#ffe060', 'NIGHT MARKET · 停車場');
  t.shape([-54.6, -6.6, -54.4, -6.2], 0, 8, 'steel', C.iron); t.shape([-54.6, 6.2, -54.4, 6.6], 0, 8, 'steel', C.iron);
  // Sheds of night-market carts screen the car park from the west street, north and south (the
  // gaps alternate sides, so no view runs down the street into the base).
  cartShed(t, [-62, -14.5, -57, -12], C.tinBlue, '攤車');
  cartShed(t, [-59, 12, -54, 14.5], C.tinRust, '夜市');
  // SWAT: the levee road (east), round a police bus, by the flood wall.
  t.shape([56, -12, LEVEE_X, 12], -0.02, 0.016, 'asphalt', 0x7a7a7a);
  van(t, [57.5, -4.5, 60, 4.5], 0x2a4a8a, false);
  t.shape([57.45, -4.55, 60.05, 4.55], 1.3, 1.6, 'painted', 0xf0f0f0);
  t.shape([58.2, -1, 59.3, 0.4], 2.45, 2.65, 'neon', 0x3a7aff);
  t.shape([58.2, 0.4, 59.3, 1.0], 2.45, 2.65, 'neon', 0xff3a3a);
  for (const z of [-11, 10.5]) t.box([60.8, z - 0.4, 63.2, z + 0.4], 0, 0.85, 'concrete', 0xd8d4cc);
  t.sign('board', 70.9, 3.6, 0, -Math.PI / 2, 3.6, 0.9, '環河北路', '#1b5aa6', '#ffffff', 'Huanhe N. Rd.');
  // Containers of the flood-control depot screen the base up and down the road (gaps on opposite
  // sides), and a pump truck parked between the north one and the pump station makes a chicane.
  t.box([60, -14.5, LEVEE_X, -12], 0, 2.6, 'container');
  van(t, [56, -20.5, 62, -17.5], 0xe8b020, true);
  t.raw({ kind: 'cylinder', x: 58, y: 2.45, z: -19, radius: 0.5, height: 3.4, axis: 'x', style: 'painted', color: 0x3a5a8a });
  t.box([56, 12, 66, 14.5], 0, 2.6, 'container');
  t.sign('board', 63, 2.0, 12 - 0.03, 0, 3.4, 0.6, '防汛器材', '#f0d040', '#1a1a1a');
}

/** A tin shed of stacked night-market carts (cover), its sign on both long faces. */
function cartShed(t: Town, r: R, tin: number, name: string) {
  const [x0, z0, x1, z1] = r;
  t.box(r, 0, 2.8, 'roof', tin);
  t.shape([x0 - 0.25, z0 - 0.25, x1 + 0.25, z1 + 0.25], 2.8, 2.9, 'roof', 0xc8ccd0);
  t.sign('board', (x0 + x1) / 2, 2.2, z0 - 0.03, 0, x1 - x0 - 0.6, 0.6, name, '#c8141e', '#ffffff');
  t.sign('board', (x0 + x1) / 2, 2.2, z1 + 0.03, Math.PI, x1 - x0 - 0.6, 0.6, name, '#c8141e', '#ffffff');
}
