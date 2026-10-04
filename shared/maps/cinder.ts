import { defaultLaws } from '../laws';
import { MapBuilder } from './builder';
import type { MapDef } from './types';

/**
 * Cinder Basin: a desert tech outpost. Three lanes (north ridge, central plaza, south yard)
 * connect two warpgate spawns. A and C are fortified bunkers; B is the open reactor plaza
 * where the anomaly bends the rules.
 */
export function cinderBasin(): MapDef {
  const b = new MapBuilder({
    id: 'cinder', name: 'Cinder Basin', region: 'INDAR-CLASS DESERT / TECH OUTPOST',
    description: 'Three lanes, two bunkers, one reactor. Long sightlines over the ridge.',
    theme: 'desert', halfX: 86, halfZ: 58, seed: 7, roll: 1.2, ridge: 16,
    laws: structuredClone(defaultLaws), sun: { x: -0.55, y: 0.62, z: 0.36 },
  });

  // ---- Terrain shaping (pads must exist before the heightfield is sampled) ----
  b.pad(0, 0, 26, 26, -0.9, 6);                // reactor basin
  b.mirrored(() => {
    b.pad(-72, 0, 20, 26, 0.6, 6);             // warpgate spawn
    b.pad(-40, -14, 20, 16, 0.2, 5);           // bunker A
    b.pad(-20, -38, 46, 14, 3.2, 9);           // north ridge plateau
    b.pad(-22, 30, 34, 18, 0, 6);              // south cargo yard
    b.bump(-52, 20, 10, 2.2);
    b.bump(-8, 22, 7, 1.4);
    b.bump(-56, -34, 9, 2.6);
  });
  b.buildTerrain(2);

  // ---- Reactor plaza (B) ----
  const by = b.ground(0, 0);
  b.box(0, by, 0, 18, 1.0, 18, 'concrete');                 // raised deck
  b.ramp(0, -10.5, 6, 3, by, by + 1.0, 1, 'stairs');        // north stairs rise toward +Z
  b.ramp(0, 10.5, 6, 3, by, by + 1.0, 3, 'stairs');
  b.ramp(-10.5, 0, 3, 6, by, by + 1.0, 0, 'stairs');
  b.ramp(10.5, 0, 3, 6, by, by + 1.0, 2, 'stairs');
  b.box(0, by + 1, 0, 2.6, 2.4, 2.6, 'pillar');             // reactor pylon base
  b.raw({ kind: 'reactor', x: 0, y: by + 1, z: 0 });
  b.point('B', 'Reactor', 0, by + 1, 0, 8.5);
  b.mirrored(() => {
    // Low walls on the deck corners give attackers something to fight from.
    b.box(-6.2, by + 1, -4.2, 0.6, 1.15, 3.6, 'wallDark');
    b.box(-4.2, by + 1, -6.2, 3.6, 1.15, 0.6, 'wallDark');
    b.box(6.2, by + 1, -4.2, 0.6, 1.15, 3.6, 'wallDark');
    b.box(4.2, by + 1, -6.2, 3.6, 1.15, 0.6, 'wallDark');
    b.light(-6.5, by + 2.2, -6.5, 0x7ff6ff, 5, 12);
    b.light(6.5, by + 2.2, -6.5, 0x7ff6ff, 5, 12);
    // Perimeter cover around the basin.
    b.box(-15, b.ground(-15, -9), -9, 4.2, 1.2, 0.9, 'concrete');
    b.box(-16, b.ground(-16, 7), 7, 0.9, 1.2, 4.2, 'concrete');
    b.solidProp('Prop_Crate_Large', -12.5, 'ground', 13, 0.3, 1.9, 1.3, 1.9);
    b.solidProp('Prop_Crate_Tarp', -14, 'ground', -2.5, 1.2, 1.4, 1.05, 1.4);
  });

  b.mirrored(() => {
    // ---- Warpgate spawn ----
    const sy = b.ground(-72, 0);
    b.box(-79, sy, 0, 1.2, 7, 24, 'wall');                  // rear wall
    b.box(-73, sy, -12, 13, 7, 1.2, 'wall');                // side walls
    b.box(-73, sy, 12, 13, 7, 1.2, 'wall');
    b.box(-73, sy + 7, 0, 13, 0.5, 25, 'floor');            // canopy
    b.box(-66.6, sy, 0, 0.3, 7, 22.8, 'shield', 'energy', b.team(0)); // team shield
    for (const z of [-7, -2.5, 2.5, 7]) b.spawn(0, -75, sy, z, -Math.PI / 2);
    b.raw({ kind: 'spawnPad', team: b.team(0), ...b.at(-74, 0), y: sy, rotY: b.rotation(-Math.PI / 2) });
    b.light(-76, sy + 6, 0, b.mirroredSide ? 0xff5a4a : 0x58b6ff, 8, 20);
    // Spawn exits: cover just outside the shield.
    b.box(-60, b.ground(-60, -6), -6, 0.9, 1.3, 4, 'concrete');
    b.box(-60, b.ground(-60, 6), 6, 0.9, 1.3, 4, 'concrete');
    b.solidProp('Prop_Crate', -62, 'ground', 13, 0.4, 1.2, 1.0, 1.2);

    // ---- Bunker A (west) ----
    const a = b.bunker(-40, -14, 14, 10, {
      doors: [['e', 0, 2.6], ['s', 3, 2.4], ['w', 1.5, 2.4]],
      windows: [['n', -3.5, 2.2], ['n', 3.5, 2.2], ['e', -3.2, 1.6], ['e', 3.2, 1.6], ['s', -3.5, 2]],
    });
    b.point(b.mirroredSide ? 'C' : 'A', b.mirroredSide ? 'Relay Bunker' : 'Comm Bunker', -40, a.y, -14, 7.5);
    // External stairs along the north face climb east to a landing beside the roof.
    b.ramp(-43, -20.4, 6, 2.4, a.y, a.top, 0, 'stairs');
    b.box(-38.5, a.y, -20.4, 3, a.top - a.y, 2.4, 'wall');
    b.rail(-47, -9, -33, -9, a.top);
    b.solidProp('Prop_Crate_Large', -36, a.y, -16, 0, 1.9, 1.3, 1.9);
    b.solidProp('Prop_Chest', -44, a.y, -12, Math.PI / 2, 1.5, 0.75, 0.8);
    b.prop('Prop_Computer', -46.2, a.y, -17.5, Math.PI / 2);
    b.light(-40, a.y + 3.6, -14, 0xfff1d0, 6, 12);
    // Approach cover.
    b.box(-30, b.ground(-30, -7), -7, 3.6, 1.2, 0.8, 'concrete');
    b.box(-31, b.ground(-31, -22), -22, 0.8, 1.2, 3.6, 'concrete');

    // ---- North ridge watchtower ----
    const ry = b.ground(-16, -38);
    b.platform(-16, -38, 8, 8, ry + 4.6);
    b.ramp(-16, -31.5, 2.6, 5, ry, ry + 4.6, 3, 'stairs');
    b.box(-19.6, ry + 4.6, -38, 0.6, 1.1, 8, 'wallDark');
    b.box(-16, ry + 4.6, -41.7, 8, 1.1, 0.6, 'wallDark');
    b.box(-30, b.ground(-30, -38), -38, 1.2, 2.2, 6, 'rock');
    b.box(-2, b.ground(-2, -36), -36, 5, 1.6, 2.2, 'rock');
    b.solidProp('Prop_Crate_Tarp_Large', -8, 'ground', -42, 0.2, 2.2, 1.6, 2.2);
    b.solidProp('Prop_Barrel2_Closed', -24, 'ground', -33, 0, 0.9, 1.2, 0.9);
    b.prop('Prop_SatelliteDish', -16, ry + 4.6, -40, 0.6, 0.9);

    // ---- South cargo yard ----
    const yy = b.ground(-22, 30);
    b.box(-30, yy, 26, 6.2, 2.6, 2.5, 'container');
    b.box(-30, yy + 2.6, 26, 6.2, 2.6, 2.5, 'container');
    b.box(-21, yy, 34, 2.5, 2.6, 6.2, 'container');
    b.box(-13, yy, 25, 6.2, 2.6, 2.5, 'container');
    b.box(-38, yy, 36, 6.2, 2.6, 2.5, 'container');
    b.ramp(-42.6, 36, 3, 2.5, yy, yy + 2.6, 0, 'ramp');        // climb onto the single container
    b.solidProp('Prop_Crate', -25, yy, 30, 0.3, 1.2, 1.0, 1.2);
    b.solidProp('Prop_Crate_Large', -16, yy, 31, 0.8, 1.9, 1.3, 1.9);
    b.solidProp('Prop_Barrel1', -27, yy, 33.5, 0, 0.7, 1.1, 0.7);
    b.light(-22, yy + 4.5, 29, 0xffc27a, 5, 14);

    // ---- Mid lane cover between A and B ----
    b.box(-25, b.ground(-25, 2), 2, 0.8, 2.4, 6.5, 'wall');
    b.box(-28, b.ground(-28, 10), 10, 4, 1.25, 0.8, 'concrete');
    b.solidProp('Prop_Crate_Large', -22, 'ground', -12, 0.5, 1.9, 1.3, 1.9);
    b.box(-48, b.ground(-48, 4), 4, 4.6, 1.25, 0.8, 'concrete');
    b.box(-55, b.ground(-55, -10), -10, 0.8, 1.3, 4.4, 'concrete');
    b.box(-50, b.ground(-50, 18), 18, 3.2, 2.2, 3.2, 'rock');
  });

  // Outer boundary blockers sit just beyond the playable bounds.
  return b.build();
}
