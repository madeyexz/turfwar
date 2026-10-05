import { MapBuilder } from './builder';
import type { MapDef } from './types';

/**
 * Citadel Keep: a stone fortress on a grassy hill, in the spirit of compact browser arena
 * shooters. Curtain walls with rampart walks enclose the inner courtyard (B) and its twin
 * keeps; roofed galleries run under the north and south ramparts. A and C are the barbicans in
 * front of the west and east gatehouses, each behind a dry ditch with a bridge. Spawn camps sit at
 * the far edges of an open outer bailey of orchards, field walls and a watch post.
 */
const P = 2.5;      // inner ward plateau height
const WALK = 3.6;   // rampart walkway above the plateau
const W = 24;       // curtain wall centre line (inner ward is about 45 m across)

/** Battlements: a row of merlons from (x0, z0) to (x1, z1) standing on height y. */
function merlons(b: MapBuilder, x0: number, z0: number, x1: number, z1: number, y: number, spacing = 2.2) {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / spacing));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    b.box(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, 0.7, 0.7, 0.7, 'sandstone');
  }
}

export function citadelKeep(): MapDef {
  const b = new MapBuilder({
    id: 'citadel', name: 'Citadel Keep', region: 'VERDANT HIGHLANDS / HILLTOP FORTRESS',
    description: 'Hilltop castle: rampart walks, twin keeps over the inner courtyard, gatehouse barbicans and an open outer bailey.',
    theme: 'forest', halfX: 70, halfZ: 70, seed: 23, roll: 0.8, ridge: 12, teamSize: 8,
    sun: { x: -0.5, y: 0.66, z: 0.4 },
  });

  // ---- Terrain: the castle hill, barbicans, ditches and spawn camps ----
  b.pad(0, 0, 56, 56, P, 7);
  b.mirrored(() => {
    b.pad(-40, 0, 12, 24, P, 6);               // barbican (A)
    b.pad(-31, 0, 1.5, 20, P - 1.2, 1.5);      // dry ditch in front of the gatehouse
    b.pad(-62, 0, 16, 26, 0.3, 6);             // spawn camp
    b.bump(-12, -54, 9, 2.4);
    b.bump(-56, 36, 8, 1.8);
    b.bump(-48, -56, 7, 1.6);
  });
  b.buildTerrain(2);

  const y0 = P - 1.2, top = P + WALK;

  // ---- Inner courtyard (B) ----
  b.box(0, P, 0, 8, 0.45, 8, 'concrete');
  b.box(0, P + 0.45, 0, 2.4, 2.2, 2.4, 'pillar');
  b.point('B', 'Keep Courtyard', 0, P + 0.45, 0, 9);
  b.point('A', 'West Barbican', -40, P, 0, 7.5);
  b.point('C', 'East Barbican', 40, P, 0, 7.5);

  b.mirrored(() => {
    // ---- West curtain wall and gatehouse (mirror: east) ----
    b.box(-W, y0, -13.5, 2.4, top - y0, 21, 'sandstone');
    b.box(-W, y0, 13.5, 2.4, top - y0, 21, 'sandstone');
    b.box(-W, P + 3, 0, 2.4, WALK - 3, 6, 'sandstone');               // gate lintel carries the walk
    b.box(-W - 0.85, top, 0, 0.7, 0.45, 48, 'sandstone');             // parapet
    merlons(b, -W - 0.85, -23, -W - 0.85, 23, top + 0.45);
    b.box(-27.1, y0, 5.5, 3.8, P + 7.6 - y0, 5, 'sandstone');         // gatehouse towers
    b.box(-27.1, y0, -5.5, 3.8, P + 7.6 - y0, 5, 'sandstone');
    merlons(b, -28.6, 3.6, -28.6, 7.4, P + 7.6, 1.9);
    merlons(b, -28.6, -7.4, -28.6, -3.6, P + 7.6, 1.9);
    b.box(-31, P - 0.35, 0, 5.2, 0.35, 4, 'floor');                   // bridge over the ditch
    b.rail(-33.4, -2, -28.8, -2, P);
    b.rail(-33.4, 2, -28.8, 2, P);
    b.light(-29.4, P + 3, -2.9, 0xffb45a, 5, 10);

    // ---- North gallery: a roofed corridor under the rampart walk (mirror: south) ----
    const out = -W - 0.6, inner = -W + 3.6;
    b.box(-16.05, y0, out, 13.5, top + 0.45 - y0, 1.2, 'sandstone');  // outer wall, postern gap at x -9.3..-6.7
    b.box(8.05, y0, out, 29.5, top + 0.45 - y0, 1.2, 'sandstone');
    b.box(-8, P + 2.6, out, 2.6, top + 0.45 - P - 2.6, 1.2, 'sandstone');
    merlons(b, -22, out - 0.25, 22, out - 0.25, top + 0.45);
    b.box(0, P + 3.2, -22, 45.6, 0.4, 4, 'sandstone');                // walkway roof
    // Inner arcade wall: arches into the courtyard at x = -15, -4, 6.5, 15.
    const edges = [-22.8, -16.5, -13.5, -5.5, -2.5, 5, 8, 13.5, 16.5, 22.8];
    for (let i = 0; i < edges.length; i += 2) {
      b.box((edges[i] + edges[i + 1]) / 2, y0, inner, edges[i + 1] - edges[i], P + 3.2 - y0, 0.8, 'sandstone');
    }
    for (const x of [-15, -4, 6.5, 15]) b.box(x, P + 2.6, inner, 3, 0.6, 0.8, 'sandstone');
    b.light(-4, P + 2.6, -22, 0xffb45a, 4, 9);

    // ---- Corner bastions (NW and SW; mirror: SE and NE) with lookout turrets ----
    for (const sz of [-1, 1]) {
      b.box(-26.2, y0, sz * 26.2, 6.8, top - y0, 6.8, 'sandstone');
      merlons(b, -29.25, sz * 22.8, -29.25, sz * 29.25, top);
      merlons(b, -25.2, sz * 29.25, -22.8, sz * 29.25, top, 1.2);
      b.box(-28.2, top, sz * 28.2, 2.6, P + 10 - top, 2.6, 'sandstone');
    }

    // ---- Stairs from the courtyard up to the rampart walk (NW and SW; mirror: SE and NE) ----
    b.ramp(-21.3, -11, 3, 9, P, top, 3, 'stairs');
    b.box(-21.3, y0, -18, 3, top - y0, 5, 'sandstone');
    b.ramp(-21.3, 11, 3, 9, P, top, 1, 'stairs');
    b.box(-21.3, y0, 18, 3, top - y0, 5, 'sandstone');

    // ---- Keep (NW; mirror: SE): stone hall, crenellated roof, lookout turret ----
    b.bunker(-12, -11, 8, 8, {
      y: P, h: 4.2, roof: false, style: 'sandstone',
      doors: [['e', 0, 2.4], ['n', 1, 2.2]],
      windows: [['w', 0, 1.6], ['s', -2.6, 1.2], ['s', 2.6, 1.2], ['n', -2.4, 1.2]],
    });
    b.box(-12, P + 4.2, -11, 8.4, 0.35, 8.4, 'sandstone');
    const roof = P + 4.55;
    b.ramp(-12, -3.8, 3, 6.8, P, roof, 3, 'stairs');
    merlons(b, -15.85, -6.9, -15.85, -14.85, roof, 2);
    merlons(b, -15.2, -14.85, -8.2, -14.85, roof, 1.75);
    merlons(b, -8.15, -14, -8.15, -7.2, roof, 2.2);
    b.box(-14.6, roof, -13.6, 2.4, P + 11 - roof, 2.4, 'sandstone');
    b.mast(-14.6, P + 11, -13.6, 4);
    b.light(-14.6, P + 11.6, -13.6, 0xffb45a, 6, 16);
    b.solidProp('Prop_Crate', -9.6, P, -8.8, 0.2, 1.2, 1.0, 1.2);
    b.solidProp('Prop_Barrel1', -14.4, P, -12.8, 0, 0.7, 1.1, 0.7);

    // ---- Armory (SW; mirror: NE) ----
    b.bunker(-12, 11.5, 8, 6, {
      y: P, h: 3.6, roof: false, style: 'sandstone',
      doors: [['n', 0, 2.4], ['w', 0, 2]],
      windows: [['e', 0, 1.6], ['s', -2, 1.2], ['s', 2, 1.2]],
    });
    b.box(-12, P + 3.6, 11.5, 8.4, 0.35, 6.4, 'sandstone');
    b.solidProp('Prop_Crate_Large', -14, P, 13, 0.2, 1.9, 1.3, 1.9);
    b.solidProp('Prop_Chest', -9.6, P, 13.4, 0, 1.5, 0.75, 0.8);

    // ---- Courtyard cover ----
    b.box(-6.5, P, -3.2, 0.7, 1.15, 3.4, 'sandstone');
    b.box(-4.6, P, -6.4, 3.4, 1.15, 0.7, 'sandstone');
    b.box(5.8, P, -5.6, 2.4, 1.15, 0.7, 'sandstone');
    b.solidProp('Prop_Crate_Tarp', -17, P, 2.5, 0.4, 1.4, 1.05, 1.4);
    b.solidProp('Prop_Barrel2_Closed', -6.5, P, 9.5, 0, 0.9, 1.2, 0.9);
    b.box(-17.5, P, -3.5, 2.2, 0.9, 2.2, 'concrete');                 // well
    b.light(-9, P + 3.2, 4, 0xffc27a, 5, 12);

    // ---- Barbican (A; mirror: C): low walls, crates, a cart ----
    b.box(-47, P - 0.6, -6, 0.8, 1.9, 6, 'sandstone');
    b.box(-47, P - 0.6, 6, 0.8, 1.9, 6, 'sandstone');
    b.box(-43, P - 0.6, -10.5, 8, 1.9, 0.8, 'sandstone');
    b.box(-35.5, P - 0.6, -10.5, 3, 1.9, 0.8, 'sandstone');
    b.box(-43, P - 0.6, 10.5, 8, 1.9, 0.8, 'sandstone');
    b.box(-35.5, P - 0.6, 10.5, 3, 1.9, 0.8, 'sandstone');
    b.solidProp('Prop_Crate_Large', -43.5, P, -4.5, 0.3, 1.9, 1.3, 1.9);
    b.solidProp('Prop_Crate', -43.5, P, -2.4, 0.9, 1.2, 1.0, 1.2);
    b.solidProp('Prop_Crate_Tarp_Large', -36, P, 6.2, 0.2, 2.2, 1.6, 2.2);
    b.solidProp('Prop_Barrel1', -36.5, P, -6.6, 0, 0.7, 1.1, 0.7);
    b.box(-44.5, P, 5, 1.8, 1.1, 3.6, 'container');                   // supply cart

    // ---- Spawn camp: stone walls behind a team shield ----
    const SX = -62, sy = b.ground(SX, 0);
    b.box(SX - 5.5, sy - 0.5, 0, 1.2, 5, 21.2, 'sandstone');
    b.box(SX, sy - 0.5, -10, 12, 5, 1.2, 'sandstone');
    b.box(SX, sy - 0.5, 10, 12, 5, 1.2, 'sandstone');
    b.box(SX + 5.8, sy, 0, 0.3, 6, 18.8, 'shield', 'energy', b.team(0));
    for (const [x, z] of [[-3, -7], [-3, -3.5], [-3, 0], [-3, 3.5], [-3, 7], [1, -5], [1, 5]]) b.spawn(0, SX + x, sy, z, -Math.PI / 2);
    b.raw({ kind: 'spawnPad', team: b.team(0), ...b.at(SX - 1, 0), y: sy, rotY: b.rotation(-Math.PI / 2) });
    b.light(SX - 2, sy + 4.5, 0, b.mirroredSide ? 0xff5a4a : 0x58b6ff, 8, 20);
    // Cover between the camp and the barbican.
    b.box(-52, b.ground(-52, -6), -6, 0.8, 1.3, 3.6, 'sandstone');
    b.box(-52, b.ground(-52, 7), 7, 0.8, 1.3, 3.6, 'sandstone');
    b.solidProp('Prop_Crate_Large', -50, 'ground', 15, 0.6, 1.9, 1.3, 1.9);

    // ---- North outer bailey: watch post, ruined wall, trees ----
    const wp = b.ground(-42, -48), wpTop = wp + 4;
    b.platform(-42, -48, 6, 6, wpTop);
    b.ramp(-42, -41.7, 3, 6.6, b.ground(-42, -38.4), wpTop, 3, 'stairs');
    b.box(-44.75, wpTop, -48.5, 0.5, 1.1, 5, 'sandstone');
    b.box(-42, wpTop, -50.75, 6, 1.1, 0.5, 'sandstone');
    b.box(-30, b.ground(-30, -40) - 0.3, -40, 7, 2.4, 0.8, 'sandstone');
    b.box(-26.1, b.ground(-26, -43) - 0.3, -43.4, 0.8, 1.6, 6, 'sandstone');
    b.box(-18, b.ground(-18, -32) - 0.3, -32, 4, 1.4, 0.8, 'sandstone');
    b.box(-50, b.ground(-50, -26), -26, 2.8, 1.8, 2.2, 'rock');
    b.box(-6, b.ground(-6, -40), -40, 2.4, 1.5, 2, 'rock');
    b.solidProp('Prop_Crate_Tarp_Large', -24, 'ground', -54, 0.4, 2.2, 1.6, 2.2);
    b.solidProp('Prop_Crate', -34, 'ground', -32, 0.2, 1.2, 1.0, 1.2);
    b.solidProp('Prop_Barrel2_Closed', -13, 'ground', -36, 0, 0.9, 1.2, 0.9);
    for (const [x, z, s, v] of [[-52, -34, 1.1, 0], [-36, -58, 1.2, 1], [-20, -48, 1, 2], [-4, -60, 1.3, 0], [-58, -54, 1, 1], [-30, -30, 0.9, 2]]) b.tree(x, z, s, v);

    // ---- South outer bailey: stable, orchard, field walls ----
    b.bunker(-30, 42, 10, 6, {
      h: 3.4, roof: false, style: 'sandstone',
      doors: [['n', -2.5, 3], ['n', 2.5, 2.4], ['e', 0, 2.4]],
      windows: [['s', 0, 3], ['w', 0, 1.6]],
    });
    const st = b.ground(-30, 42);
    b.box(-30, st + 3.4, 42, 10.4, 0.35, 6.4, 'sandstone');
    b.solidProp('Prop_Crate_Tarp_Large', -32.5, st, 43, 0.2, 2.2, 1.6, 2.2);
    b.solidProp('Prop_Crate', -27, st, 43.6, 0.6, 1.2, 1.0, 1.2);
    b.light(-30, st + 3, 42, 0xffc27a, 4, 10);
    b.box(-44, b.ground(-44, 30) - 0.3, 30, 8, 1.5, 0.7, 'sandstone');
    b.box(-18, b.ground(-18, 34) - 0.3, 34, 0.7, 1.5, 7, 'sandstone');
    b.box(-10, b.ground(-10, 46) - 0.3, 46, 6, 1.5, 0.7, 'sandstone');
    b.box(-40, b.ground(-40, 52), 52, 2.6, 1.6, 2.2, 'rock');
    b.solidProp('Prop_Crate_Large', -22, 'ground', 52, 0.3, 1.9, 1.3, 1.9);
    for (const [x, z, s, v] of [[-50, 26, 1, 1], [-46, 46, 1.2, 0], [-22, 60, 1.1, 2], [-8, 36, 0.9, 1], [-58, 54, 1, 0], [-34, 58, 1.1, 1]]) b.tree(x, z, s, v);

    // ---- Pickups ----
    b.pickup(-23.4, top, -23.4, 'lancer', 45);           // exposed bastion top
    b.pickup(-9, roof, -8, 'graviton', 45);              // keep roof over the courtyard
    b.pickup(-18, P, -22.4, 'scatter', 35);              // north gallery corridor
    b.pickup(-42, P, 8.5, 'ammo', 20);                   // barbican, off the point
    b.pickup(-16, 'ground', -36, 'armor', 40);           // north bailey flank
  });

  return b.build();
}
