import { MapBuilder } from './builder';
import type { MapDef } from './types';

/**
 * Frostline Reach: an arctic relay station. B sits inside a walled courtyard with
 * four gates and wall-top catwalks; a frozen trench gives a low flanking route to the north,
 * an ice ridge with crystal cover runs to the south. A and C are two-storey relay towers.
 */
export function frostlineReach(): MapDef {
  const b = new MapBuilder({
    id: 'frostline', name: 'Frostline Reach', region: 'ESAMIR-CLASS TUNDRA / RELAY STATION',
    description: 'Walled relay courtyard, rooftop towers and a frozen flanking trench.',
    theme: 'snow', halfX: 84, halfZ: 60, seed: 19, roll: 1.4, ridge: 18,
    sun: { x: 0.45, y: 0.5, z: -0.6 },
  });

  b.pad(0, 0, 32, 32, 0.4, 5);                 // courtyard foundation
  b.mirrored(() => {
    b.pad(-70, 0, 20, 26, 1.2, 7);             // warpgate
    b.pad(-42, 16, 16, 16, 0.8, 5);            // relay tower A
    b.pad(-26, -36, 48, 10, -2.4, 6);          // frozen trench (north-west / south-east)
    b.pad(-24, 38, 44, 12, 2.6, 8);            // ice ridge (south-west / north-east)
    b.bump(-58, -24, 9, 2.4);
    b.bump(-26, 0, 6, 1.2);
  });
  b.buildTerrain(2);

  // ---- Relay courtyard (B): 26 x 26 walls with four gates and wall-top catwalks ----
  const cy = b.ground(0, 0);
  const H = 3.4, half = 13, gate = 5;
  b.mirrored(() => {
    // North wall (two halves around the gate) and west wall halves; mirroring gives S and E.
    const L = half - gate / 2, L2 = half - gate / 2 - 0.4;
    b.box(-(gate / 2 + L / 2), cy, -half, L, H, 0.8, 'wall');
    b.box(gate / 2 + L / 2, cy, -half, L, H, 0.8, 'wall');
    b.box(-half, cy, -(gate / 2 + L2 / 2), 0.8, H, L2, 'wallDark');
    b.box(-half, cy, gate / 2 + L2 / 2, 0.8, H, L2, 'wallDark');
    // Catwalk on top of the north wall, reached by stairs from inside the courtyard.
    b.box(-7.5, cy + H, -half + 0.3, 9, 0.3, 2.2, 'floor');
    b.ramp(-7.5, -half + 3.3, 2.4, 4, cy, cy + H + 0.3, 3, 'stairs');
    b.rail(-12, -half - 0.7, -3, -half - 0.7, cy + H + 0.3);
    // Inner cover: generator blocks and crates.
    b.box(-5.5, cy, -5.5, 2.2, 1.6, 1.2, 'container');
    b.box(5.5, cy, -6.5, 1.2, 1.2, 2.6, 'concrete');
    b.solidProp('Prop_Crate_Tarp_Large', -8.5, cy, 2.5, 0.4, 2.2, 1.6, 2.2);
    b.light(-11, cy + 3, -11, 0x9fd8ff, 6, 14);
    b.crystal(-20, -6, 1.1, 0.4);
    b.crystal(-18, 9, 0.8, 1.2);
  });
  b.box(0, cy, 0, 4, 0.6, 4, 'concrete');
  b.box(0, cy + 0.6, 0, 2.4, 2.0, 2.4, 'pillar');
  b.point('B', 'Relay Courtyard', 0, cy, 0, 9);

  b.mirrored(() => {
    b.warpgate(-70, 0);
    b.box(-58, b.ground(-58, -5), -5, 0.9, 1.3, 4, 'concrete');
    b.box(-58, b.ground(-58, 6), 6, 0.9, 1.3, 4, 'concrete');
    b.crystal(-54, 15, 1.2, 0.8);

    // ---- Relay tower A: ground floor room with doors, roof deck with mast ----
    const t = b.bunker(-42, 16, 12, 12, {
      h: 4, doors: [['e', 0, 2.6], ['n', -2, 2.4], ['s', 2.5, 2.4]],
      windows: [['e', -3.6, 1.6], ['e', 3.6, 1.6], ['w', 0, 3], ['n', 3, 2]],
    });
    b.point(b.mirroredSide ? 'C' : 'A', b.mirroredSide ? 'Relay Tower East' : 'Relay Tower West', -42, t.y, 16, 7.5);
    b.ramp(-49.7, 13.5, 3.2, 7, t.y, t.top, 1, 'stairs');
    b.box(-49.7, t.y, 18.5, 3.2, t.top - t.y, 3, 'wall');
    b.box(-38.5, t.top, 21.6, 5, 1.1, 0.5, 'wallDark');
    b.box(-36.3, t.top, 18, 0.5, 1.1, 6, 'wallDark');
    b.mast(-44, t.top, 12, 9);
    b.prop('Prop_SatelliteDish', -40, t.top, 12, 2.3, 0.8);
    b.solidProp('Prop_Crate_Large', -44.5, t.y, 18.5, 0.3, 1.9, 1.3, 1.9);
    b.prop('Kit_Prop_Computer', -47.3, t.y, 14, Math.PI / 2);
    b.light(-42, t.y + 3.5, 16, 0xdfeaff, 6, 12);
    b.box(-31, b.ground(-31, 22), 22, 3.6, 1.2, 0.8, 'concrete');
    b.box(-32, b.ground(-32, 8), 8, 0.8, 1.2, 3.6, 'concrete');

    // ---- Frozen trench (north): low route with ice blocks and a crossing bridge ----
    const ty = b.ground(-20, -36);
    b.box(-30, ty, -35, 2.5, 2.6, 6.2, 'container');
    b.box(-12, ty, -38, 6.2, 2.6, 2.5, 'container');
    b.crystal(-38, -37, 1.0, 0.2);
    b.crystal(-4, -33, 0.9, 2.1);
    b.box(-25, ty, -39.5, 3, 1.4, 1.6, 'rock');
    // Bridge over the trench: flush with the banks so players can sprint straight across.
    const bank = b.ground(-20, -28.5);
    b.box(-20, bank - 0.35, -36, 3.2, 0.35, 15, 'floor');
    b.box(-20, ty, -36, 0.8, bank - 0.35 - ty, 0.8, 'pillar');
    b.rail(-21.6, -43, -21.6, -29, bank);
    b.rail(-18.4, -43, -18.4, -29, bank);

    // ---- Ice ridge (south): elevated, crystal cover, sniper perches ----
    const ry = b.ground(-24, 38);
    b.crystal(-26, 36, 1.3, 0.9);
    b.crystal(-8, 41, 1.0, 2.6);
    b.crystal(-18, 33, 0.7, 0.1);
    b.platform(-30, 44, 6, 6, ry + 3.6);
    b.ramp(-30, 38.5, 2.4, 5, ry, ry + 3.6, 1, 'stairs');
    b.box(-32.7, ry + 3.6, 44, 0.5, 1.1, 6, 'wallDark');
    b.solidProp('Prop_Barrel2_Closed', -11, 'ground', 34, 0, 0.9, 1.2, 0.9);
    b.solidProp('Prop_Crate', -22, 'ground', 30, 0.6, 1.2, 1.0, 1.2);

    // ---- Mid-field cover between A and the courtyard ----
    b.box(-24, b.ground(-24, 8), 8, 4.2, 1.25, 0.8, 'concrete');
    b.box(-27, b.ground(-27, -10), -10, 0.8, 2.6, 5, 'wall');
    b.solidProp('Prop_Crate_Tarp', -20, 'ground', -18, 0.7, 1.4, 1.05, 1.4);
    b.box(-50, b.ground(-50, -12), -12, 3, 2, 3, 'rock');

    // ---- Cover pass: break up the open snowfields on every approach ----
    b.box(-52, b.ground(-52, -20), -20, 3.2, 1.8, 2.4, 'rock');                 // spawn → trench
    b.crystal(-45, -27, 0.9, 1.7);
    b.solidProp('Prop_Crate_Tarp_Large', -40, 'ground', -3, 0.3, 2.2, 1.6, 2.2); // spawn → courtyard lane
    b.box(-10, b.ground(-10, -22), -22, 0.8, 1.25, 4.2, 'concrete');             // trench → courtyard
    b.solidProp('Prop_Crate_Large', -3.5, 'ground', -24.5, 0.2, 1.9, 1.3, 1.9);
    b.box(-46, b.ground(-46, 29), 29, 2.6, 1.6, 2.2, 'rock');                    // tower A → ridge
    b.box(-34, b.ground(-34, 27), 27, 3.6, 1.25, 0.8, 'concrete');

    // ---- Pickups ----
    b.pickup(-29, ry + 3.6, 45, 'lancer', 45);             // ice-ridge sniper perch
    b.pickup(-35, b.ground(-35, -39.5), -39.5, 'stinger', 35); // frozen trench, close quarters
    b.pickup(-30, 'ground', 17, 'ammo', 20);               // relay tower approach, off point A
    b.pickup(-23, 'ground', 2, 'armor', 40);               // mid-field toward the courtyard
  });
  return b.build();
}
