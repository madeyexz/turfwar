import { MapBuilder } from './builder';
import type { MapDef } from './types';

/**
 * Verdant Divide: a jungle uplink array. The uplink crowns a raised plateau reached by two
 * long ramps and a cliff path; A and C are forest-clearing bunkers. Dense trees break
 * sightlines on the flanks, while the plateau dominates the middle.
 */
export function verdantDivide(): MapDef {
  const b = new MapBuilder({
    id: 'verdant', name: 'Verdant Divide', region: 'AMERISH-CLASS JUNGLE / UPLINK ARRAY',
    description: 'A plateau uplink over dense jungle flanks and clearing bunkers.',
    theme: 'forest', halfX: 86, halfZ: 58, seed: 31, roll: 1.6, ridge: 20,
    sun: { x: -0.3, y: 0.7, z: 0.45 },
  });

  b.pad(0, 0, 22, 22, 3.0, 9);                 // uplink plateau (blend forms ramps all round)
  b.mirrored(() => {
    b.pad(-71, 0, 20, 26, 0.8, 7);             // warpgate
    b.pad(-38, -18, 18, 14, 0.3, 6);           // clearing bunker A
    b.pad(-20, 30, 30, 12, -1.2, 7);           // creek bed (south-west)
    b.bump(-52, 26, 12, 3.5);
    b.bump(-24, -38, 10, 3);
    b.bump(-60, -30, 9, 2.6);
  });
  b.buildTerrain(2);

  // ---- Uplink plateau (B) ----
  const py = b.ground(0, 0);
  b.box(0, py, 0, 3, 1.4, 3, 'pillar');
  b.point('B', 'Uplink Plateau', 0, py, 0, 9);
  b.mirrored(() => {
    // Dish array pylons and low walls on the plateau rim.
    b.box(-7, py, -6, 3.4, 1.2, 0.7, 'wallDark');
    b.box(-8, py, 3, 0.7, 1.2, 3.4, 'wallDark');
    b.box(6, py, -7.5, 0.7, 1.2, 3, 'wallDark');
    b.prop('Prop_SatelliteDish', -4.5, py, -8.5, 0.5, 1.2);
    b.mast(5, py, 7, 11);
    b.light(-8.5, py + 1.6, -7, 0x9fffd8, 6, 12);
    // Cliff path: stairs up the plateau's steep side.
    b.box(-13, b.ground(-13, -12), -12, 3, 2.2, 3, 'rock');
    b.box(-10, b.ground(-10, 13), 13, 2.4, 1.8, 2.4, 'rock');
  });

  b.mirrored(() => {
    b.warpgate(-71, 0);
    b.box(-59, b.ground(-59, -6), -6, 0.9, 1.3, 4, 'concrete');
    b.box(-59, b.ground(-59, 6), 6, 0.9, 1.3, 4, 'concrete');

    // ---- Clearing bunker A ----
    const a = b.bunker(-38, -18, 13, 10, {
      h: 4, doors: [['e', 0, 2.6], ['s', -3, 2.4], ['n', 3, 2.4]],
      windows: [['w', 0, 3], ['e', -3.2, 1.4], ['e', 3.2, 1.4], ['s', 3.5, 1.8]],
    });
    b.point(b.mirroredSide ? 'C' : 'A', b.mirroredSide ? 'Canopy Bunker' : 'Clearing Bunker', -38, a.y, -18, 7.5);
    b.ramp(-36, -24.4, 6, 2.4, a.y, a.top, 0, 'stairs');
    b.box(-31.5, a.y, -24.4, 3, a.top - a.y, 2.4, 'wall');
    b.mast(-42, a.top, -15, 7);
    b.solidProp('Prop_Crate_Large', -41, a.y, -20, 0.2, 1.9, 1.3, 1.9);
    b.prop('Kit_Prop_Computer', -43.7, a.y, -16, Math.PI / 2);
    b.light(-38, a.y + 3.5, -18, 0xfff1d0, 6, 12);
    b.box(-28, b.ground(-28, -12), -12, 0.8, 1.25, 4, 'concrete');
    b.box(-30, b.ground(-30, -27), -27, 4, 1.25, 0.8, 'concrete');

    // ---- Creek bed (south-west): low ground with stones and a fallen-crate barricade ----
    b.box(-26, b.ground(-26, 31), 31, 3, 1.5, 2, 'rock');
    b.box(-14, b.ground(-14, 28), 28, 2.4, 1.2, 2.6, 'rock');
    b.solidProp('Prop_Crate_Tarp_Large', -20, 'ground', 33, 0.5, 2.2, 1.6, 2.2);
    b.solidProp('Prop_Barrel1', -9, 'ground', 32, 0, 0.7, 1.1, 0.7);

    // ---- Mid cover ----
    b.box(-22, b.ground(-22, 4), 4, 0.8, 2.4, 6, 'wall');
    b.box(-48, b.ground(-48, 10), 10, 4.4, 1.25, 0.8, 'concrete');
    b.solidProp('Prop_Crate', -24, 'ground', -8, 0.4, 1.2, 1.0, 1.2);
    b.box(-17, b.ground(-17, -26), -26, 3, 2, 3, 'rock');
    b.box(-30, b.ground(-30, -2), -2, 6.2, 2.6, 2.5, 'container');
    b.box(-44, b.ground(-44, -3), -3, 2.6, 1.6, 2.2, 'rock');
    b.box(-16, b.ground(-16, -6), -6, 2.2, 1.5, 2.6, 'rock');
    b.solidProp('Prop_Crate_Tarp', -18, 'ground', 18, 0.9, 1.4, 1.05, 1.4);
    b.box(-36, b.ground(-36, 14), 14, 0.8, 2.2, 5, 'wall');

    // ---- Pickups ----
    b.pickup(-11, 'ground', 0, 'graviton', 45);                 // foot of the plateau, under fire from B
    b.pickup(-17, 'ground', 31, 'scatter', 35);                 // creek bed
    b.pickup(-30, 'ground', 1.5, 'ammo', 20);                   // behind the mid container
    b.pickup(-48, 'ground', 13, 'armor', 40);                   // behind the flank barrier

    // ---- Jungle: trees break sightlines on both flanks ----
    const trees: [number, number, number, number][] = [
      [-60, -20, 1.2, 0], [-54, -40, 1.4, 1], [-46, -32, 1.0, 2], [-32, -40, 1.3, 0], [-20, -44, 1.1, 1], [-8, -40, 1.2, 2],
      [-12, -30, 0.9, 0], [-50, 18, 1.1, 1], [-58, 34, 1.3, 2], [-40, 40, 1.2, 0], [-30, 22, 1.0, 1], [-4, 40, 1.2, 2],
      [-36, 32, 0.9, 1], [-62, -48, 1.4, 0], [-26, -34, 0.8, 2], [-46, 46, 1.4, 1], [-16, 46, 1.0, 0], [-66, 20, 1.1, 2],
    ];
    for (const [x, z, s, v] of trees) b.tree(x, z, s, v);
  });
  return b.build();
}
