import { MapBuilder } from './builder';
import type { MapDef } from './types';

/**
 * Railyard: a compact freight-yard arena. Four tracks run between the two warpgates, lined
 * with boxcars, tankers and flatcars whose gaps make the cross lanes. A and C are the engine
 * sheds at each end; B is the open turntable in the middle. Twin two-storey depots with
 * interior mezzanines and roof decks, footbridges over the tracks, a signal gantry, container
 * stacks and water towers frame the yard.
 *
 * Coordinates: +X east, +Z south, metres. Team 0 deploys in the west; everything placed inside
 * `mirrored()` is repeated rotated 180° for team 1.
 */
const HALF_X = 75, HALF_Z = 55;
/** Track centrelines (the mirror turns each into its negative on the far half). */
const TRACKS = [-20, -8, 8, 20];
const GAUGE = 0.72;

type B = MapBuilder;

/** Low chassis plus a car body sitting on it. */
function chassis(b: B, x0: number, x1: number, z: number) {
  b.box((x0 + x1) / 2, 0, z, x1 - x0 - 1.6, 1.1, 2.2, 'wallDark');
}
function boxcar(b: B, x0: number, x1: number, z: number) {
  chassis(b, x0, x1, z);
  b.box((x0 + x1) / 2, 1.1, z, x1 - x0, 2.9, 3, 'container');
}
function tanker(b: B, x0: number, x1: number, z: number) {
  chassis(b, x0, x1, z);
  b.box((x0 + x1) / 2, 1.1, z, x1 - x0, 2.5, 2.6, 'container');
  b.box((x0 + x1) / 2, 3.6, z, 1.4, 0.45, 1.4, 'trim');           // filler dome
}
/** Flatcar deck (1.35 m) carrying crates. */
function flatcar(b: B, x0: number, x1: number, z: number) {
  chassis(b, x0, x1, z);
  b.box((x0 + x1) / 2, 1.1, z, x1 - x0, 0.25, 2.8, 'floor');
}

export function railyard(): MapDef {
  const b = new MapBuilder({
    id: 'railyard', name: 'Railyard', region: 'DESERT TERMINUS / FREIGHT YARD',
    description: 'Four tracks of boxcars, twin depots, footbridges and a turntable plaza.',
    theme: 'desert', halfX: HALF_X, halfZ: HALF_Z, seed: 23, roll: 0, ridge: 0,
    sun: { x: 0.5, y: 0.66, z: -0.4 },
    teamSize: 8,
    // Flat ballast inside the fences, rising into embankments past the bounds.
    ground: (x, z) => { const e = Math.max(Math.abs(x) - 72, Math.abs(z) - 52); return e > 0 ? Math.min(14, e * 1.2) : 0; },
  });
  b.buildTerrain(2);

  // ---- B: the turntable ----
  b.box(0, 0, 0, 16, 0.3, 16, 'floor');
  b.box(0, 0.3, 0, 2.6, 2.4, 2.6, 'pillar');
  b.point('B', 'Turntable', 0, 0.3, 0, 9);

  b.mirrored(() => {
    // Low L-shaped cover on the turntable corners.
    b.box(-6, 0.3, -3, 0.6, 1.2, 3.4, 'concrete');
    b.box(-3, 0.3, -6, 3.4, 1.2, 0.6, 'concrete');
    b.box(-6, 0.3, 3, 0.6, 1.2, 3.4, 'concrete');
    b.box(-3, 0.3, 6, 3.4, 1.2, 0.6, 'concrete');
    b.light(-7.6, 1.6, 0, 0x7ff6ff, 5, 12);

    // ---- Track: rails (inner tracks stop at the turntable) ----
    for (const z of TRACKS) {
      const x1 = Math.abs(z) < 10 ? -8.5 : 0;
      for (const side of [-1, 1]) b.box((-56 + x1) / 2, 0, z + side * GAUGE, x1 + 56, 0.16, 0.12, 'trim');
    }

    // ---- Warpgate ----
    b.warpgate(-66, 0);
    b.spawn(0, -69, 0, -9.5, -Math.PI / 2);
    b.spawn(0, -69, 0, 9.5, -Math.PI / 2);

    // ---- A: the engine shed over the two northern tracks ----
    b.box(-44.5, 0, -26.75, 7, 7, 0.5, 'wall');                  // north wall with a door
    b.box(-34, 0, -26.75, 8, 7, 0.5, 'wall');
    b.box(-39.5, 2.8, -26.75, 3, 4.2, 0.5, 'wall');              // lintel over the door
    for (const x of [-47.7, -42, -36, -30.3]) b.box(x, 0, -1.3, 0.6, 7, 0.6, 'pillar');
    b.box(-39, 0, -1.3, 4.6, 1.2, 0.5, 'concrete');              // low wall between the middle pillars
    b.box(-39, 7, -14, 18.4, 0.4, 26.4, 'floor');                // roof (walkable)
    b.box(-39, 7.4, -1.1, 18.4, 0.9, 0.4, 'wallDark');           // roof parapet facing the yard
    b.ramp(-44, -34.1, 2.4, 13.8, 0, 7.4, 1, 'stairs');          // north stairs onto the roof
    // Locomotive stabled on the northern track.
    b.box(-41.5, 0, -20, 8.4, 1.0, 2.2, 'wallDark');
    b.box(-41.5, 1.0, -20, 9, 2.6, 2.8, 'wallDark');
    b.box(-44, 3.6, -20, 3.4, 1.2, 2.8, 'wallDark');             // cab
    b.solidProp('Prop_Crate_Large', -46, 0, -24.5, 0.1, 1.9, 1.3, 1.9);
    b.solidProp('Prop_Crate', -33, 0, -24.8, 0.4, 1.2, 1.0, 1.2);
    b.solidProp('Prop_Barrel2_Closed', -32.5, 0, -14, 0, 0.9, 1.2, 0.9);
    b.light(-39, 6.6, -20, 0xfff1d0, 6, 14);
    b.light(-39, 6.6, -8, 0xfff1d0, 6, 14);
    b.point(b.mirroredSide ? 'C' : 'A', b.mirroredSide ? 'East Engine Shed' : 'West Engine Shed', -39, 0, -13, 8);

    // ---- Rolling stock (gaps between cars are the cross lanes) ----
    tanker(b, -26, -14, -20);
    boxcar(b, -24, -12, -8);
    boxcar(b, -54, -42, 8);
    flatcar(b, -34, -24, 8);
    b.solidProp('Prop_Crate_Large', -31, 1.35, 8, 0.1, 1.9, 1.3, 1.9);
    b.solidProp('Prop_Crate_Tarp_Large', -26.5, 1.35, 8, 0.3, 2.2, 1.6, 2.2);
    boxcar(b, -18, -8.5, 8);
    tanker(b, -50, -38, 20);
    boxcar(b, -30, -18, 20);
    b.ramp(-32.5, 20, 5, 2.6, 0, 4, 0, 'stairs');                // stairs onto the boxcar roof

    // ---- Signal gantry over the northern tracks ----
    for (const z of [-26, -14, -2]) b.box(-27, 0, z, 0.6, 7.5, 0.6, 'pillar');
    b.box(-27, 7.5, -14, 0.6, 0.5, 24.6, 'trim');
    b.light(-27, 7.1, -20, 0xff3a30, 4, 8);
    b.light(-27, 7.1, -8, 0x40ff70, 4, 8);

    // ---- Footbridge over the southern tracks ----
    b.box(-36, 5.2, 14, 2.6, 0.3, 22, 'floor');                  // deck z 3..25, top 5.5
    b.box(-37.1, 0, 14, 0.5, 5.2, 0.5, 'pillar');
    b.box(-34.9, 0, 14, 0.5, 5.2, 0.5, 'pillar');
    b.rail(-37.3, 3, -37.3, 25, 5.5);
    b.rail(-34.7, 3, -34.7, 25, 5.5);
    b.platform(-36, 1.75, 4, 2.5, 5.5);                          // north landing
    b.ramp(-28.5, 1.75, 11, 2.4, 0, 5.5, 2, 'stairs');
    b.platform(-36, 26.25, 4, 2.5, 5.5);                         // south landing
    b.ramp(-43.5, 26.25, 11, 2.4, 0, 5.5, 0, 'stairs');

    // ---- Depot: two storeys, interior mezzanine, roof deck ----
    const depot = b.bunker(-17, 36, 18, 16, {
      h: 7,
      doors: [['n', -4, 3.6], ['n', 5, 2.6], ['e', -2, 2.6], ['w', 4, 2.6]],
      windows: [['s', -5, 2.4], ['s', 4, 2.4], ['e', 4, 1.8]],
    });
    b.platform(-17, 41.5, 16, 4, 3.4);                           // mezzanine along the south wall
    b.ramp(-11, 36.25, 2.4, 6.5, 0, 3.4, 1, 'stairs');
    b.rail(-25, 39.5, -12.4, 39.5, 3.4);
    b.ramp(-30.6, 31, 8.8, 2.4, 0, depot.top, 0, 'stairs');      // outside stairs to the roof
    b.box(-17, depot.top, 28, 18.4, 1, 0.4, 'wallDark');         // roof parapets
    b.box(-17, depot.top, 44, 18.4, 1, 0.4, 'wallDark');
    b.box(-8, depot.top, 36, 0.4, 1, 15.6, 'wallDark');
    b.box(-26, depot.top, 38.3, 0.4, 1, 11.4, 'wallDark');
    b.box(-16.75, 0, 26.7, 4.5, 1.2, 2.2, 'concrete');           // loading dock between the doors
    b.solidProp('Prop_Crate', -16, 1.2, 26.8, 0.3, 1.2, 1.0, 1.2);
    b.solidProp('Prop_Crate_Large', -23, 0, 41, 0.2, 1.9, 1.3, 1.9);
    b.solidProp('Prop_Crate_Tarp', -19, 0, 33.5, 0.6, 1.4, 1.05, 1.4);
    b.light(-17, 6.5, 36, 0xffd9a0, 6, 14);
    b.light(-21, 3.2, 26.4, 0xffc27a, 4, 10);

    // ---- Container yard and water tower ----
    b.box(-55, 0, 36, 6.2, 2.6, 2.5, 'container');
    b.ramp(-55, 39.6, 2.4, 4.7, 0, 2.6, 3, 'ramp');              // climb onto the container
    b.box(-46, 0, 44, 2.5, 2.6, 6.2, 'container');
    b.box(-46, 2.6, 44, 2.5, 2.6, 6.2, 'container');
    b.box(-58, 0, 47, 6.2, 2.6, 2.5, 'container');
    b.box(-63, 0, 30, 2.5, 2.6, 6.2, 'container');
    b.solidProp('Prop_Barrel1', -51, 0, 31, 0, 0.7, 1.1, 0.7);
    b.solidProp('Prop_Crate_Large', -40, 0, 36, 0.4, 1.9, 1.3, 1.9);
    for (const [x, z] of [[-32, 47], [-28, 47], [-32, 51], [-28, 51]]) b.box(x, 0, z, 0.5, 10, 0.5, 'pillar');
    b.box(-30, 10, 49, 5.4, 4.6, 5.4, 'container');
    b.mast(-30, 14.6, 49, 5);
    b.light(-30, 14.9, 49, 0xff5a4a, 4, 10);

    // ---- North-west yard: barriers and a container by the shed stairs ----
    b.box(-55, 0, -38, 6.2, 2.6, 2.5, 'container');
    b.box(-55, 2.6, -38, 6.2, 2.6, 2.5, 'container');
    b.box(-36, 0, -38, 4, 1.2, 0.9, 'concrete');
    b.box(-24, 0, -32, 0.9, 1.2, 4, 'concrete');
    b.solidProp('Prop_Crate_Tarp_Large', -20, 0, -44, 0.5, 2.2, 1.6, 2.2);
    // Siding along the fence with two cars parked on it.
    for (const side of [-1, 1]) b.box(-43, 0, -47 + side * GAUGE, 38, 0.16, 0.12, 'trim');
    boxcar(b, -60, -48, -47);
    tanker(b, -40, -29, -47);

    // ---- Signal hut beside the turntable ----
    b.bunker(-4, 40, 5, 4, { h: 3, doors: [['n', 0, 1.6]], windows: [['w', 0, 1.4]] });
    b.light(-4, 2.6, 37.6, 0xffc27a, 3, 8);

    // ---- Lane cover around the turntable ----
    b.box(-14, 0, 0, 0.9, 1.2, 4, 'concrete');
    b.box(-20, 0, 14, 4, 1.2, 0.9, 'concrete');
    b.solidProp('Prop_Crate', -12, 0, -14, 0.5, 1.2, 1.0, 1.2);

    // ---- Perimeter fences ----
    b.box(-36.5, 0, -53, 71, 2.4, 0.3, 'wallDark');
    b.box(-36.5, 0, 53, 71, 2.4, 0.3, 'wallDark');

    // ---- Pickups ----
    b.pickup(-17, depot.top, 40, 'lancer', 45);                  // exposed on the depot roof
    b.pickup(-21, 0, 33, 'scatter', 35);                         // depot ground floor
    b.pickup(-36, 5.5, 14, 'stinger', 30);                       // middle of the footbridge
    b.pickup(-25, 0, -4.5, 'ammo', 20);                          // outside the shed's east end
    b.pickup(-14, 0, 15, 'armor', 40);                           // south lane by the turntable
  });

  return b.build();
}
