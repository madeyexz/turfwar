import { terrainHeight, type Heightfield, type Ladder, type Ramp, type Solid, type Surface } from '../collision';
import type { VehicleKind, VehicleSpot } from '../vehicles';
import type { BlockStyle, CapturePointDef, Decor, MapDef, PickupDef, PointId, RampStyle, SpawnDef, ThemeId } from './types';

// Deterministic value noise so the server and every client generate identical terrain.
function hash(ix: number, iz: number, seed: number) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, z: number, seed: number, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) { sum += amp * (valueNoise(x * freq, z * freq, seed + i * 17) * 2 - 1); amp *= 0.5; freq *= 2.03; }
  return sum;
}
const smooth = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };

interface Pad { x: number; z: number; w: number; d: number; h: number; blend: number; order: number }
interface Bump { x: number; z: number; r: number; h: number }

export interface BuilderOptions {
  id: string; name: string; region: string; description: string; theme: ThemeId;
  halfX: number; halfZ: number; seed: number;
  /** Amplitude of rolling ground inside the playable area and of the boundary ridges. */
  roll: number; ridge: number;
  sun: { x: number; y: number; z: number };
  /** Hand-authored base ground; replaces the mirrored noise and boundary ridges. */
  ground?: (x: number, z: number) => number;
  /** Sabotage bomb sites and the attacking base (see MapDef.sabotage). */
  sabotage?: MapDef['sabotage'];
  /** Hosts 24v24 (see MapDef.big). */
  big?: boolean;
}

/**
 * Small declarative level builder. Placement calls go through a 180° rotational mirror so
 * both teams get an identical, fair half of the map.
 */
export class MapBuilder {
  solids: Solid[] = [];
  ramps: Ramp[] = [];
  decor: Decor[] = [];
  points: CapturePointDef[] = [];
  spawns: SpawnDef[] = [];
  pickups: PickupDef[] = [];
  ladders: Ladder[] = [];
  vehicles: VehicleSpot[] = [];
  pads: Pad[] = [];
  bumps: Bump[] = [];
  terrain!: Heightfield;
  private s = 1;

  constructor(readonly o: BuilderOptions) {}

  /** Run a placement block for the west half, then again rotated 180° for the east half. */
  mirrored(place: () => void) {
    // Pads blend in order; give each mirrored pair the same rank so terrain stays symmetric.
    const base = this.padRank;
    this.s = 1; place();
    const after = this.padRank;
    this.padRank = base;
    this.s = -1; place();
    this.padRank = Math.max(after, this.padRank);
    this.s = 1;
  }
  private padRank = 0;
  get mirroredSide() { return this.s < 0; }
  team(t: 0 | 1): 0 | 1 { return (this.s < 0 ? 1 - t : t) as 0 | 1; }
  private tx(x: number) { return x * this.s; }
  private tz(z: number) { return z * this.s; }
  private rot(r: number) { return this.s < 0 ? r + Math.PI : r; }

  // ---- Terrain -------------------------------------------------------------------------
  pad(x: number, z: number, w: number, d: number, h: number, blend = 5) {
    this.pads.push({ x: this.tx(x), z: this.tz(z), w, d, h, blend, order: this.padRank++ });
  }
  bump(x: number, z: number, r: number, h: number) { this.bumps.push({ x: this.tx(x), z: this.tz(z), r, h }); }

  rawHeight(x: number, z: number) {
    const o = this.o;
    const nx = Math.abs(x) / o.halfX, nz = Math.abs(z) / o.halfZ;
    const edge = smooth((Math.max(nx, nz) - 0.86) / 0.3);
    // Average with the 180°-rotated sample so both teams fight on identical ground.
    const noise = (fbm(x * 0.035, z * 0.035, o.seed) + fbm(-x * 0.035, -z * 0.035, o.seed)) / 2;
    const ridgeNoise = (fbm(x * 0.05, z * 0.05, o.seed + 9) + fbm(-x * 0.05, -z * 0.05, o.seed + 9)) / 2;
    let h = o.ground ? o.ground(x, z) : noise * o.roll + edge * (o.ridge + ridgeNoise * o.ridge * 0.6);
    for (const b of this.bumps) {
      const d = Math.hypot(x - b.x, z - b.z) / b.r;
      if (d < 1) h += b.h * (1 - smooth(d));
    }
    // Flatten building foundations with a smooth skirt; later pads win.
    for (const p of this.pads) {
      const dx = Math.max(0, Math.abs(x - p.x) - p.w / 2), dz = Math.max(0, Math.abs(z - p.z) - p.d / 2);
      const t = smooth(Math.hypot(dx, dz) / p.blend);
      h = p.h * (1 - t) + h * t;
    }
    return h;
  }

  buildTerrain(spacing = 2) {
    const o = this.o;
    this.pads.sort((a, c) => a.order - c.order);
    const extent = Math.max(o.halfX, o.halfZ) + 70;
    const n = Math.ceil(extent * 2 / spacing) + 1;
    const heights = new Float32Array(n * n);
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++)
      heights[iz * n + ix] = this.rawHeight(-extent + ix * spacing, -extent + iz * spacing);
    this.terrain = { x0: -extent, z0: -extent, spacing, n, heights };
  }

  ground(x: number, z: number) { return terrainHeight(this.terrain, this.tx(x), this.tz(z)); }

  // ---- Solids --------------------------------------------------------------------------
  /** Axis-aligned block centered at (x, z), bottom at y. Returns its solid index. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, style: BlockStyle, surface: Surface = surfaceFor(style), team?: number) {
    // BeGone bases are open (and Sabotage swaps them between teams): team spawn shields are not built.
    if (style === 'shield') return -1;
    const cx = this.tx(x), cz = this.tz(z);
    const solid: Solid = { minX: cx - w / 2, maxX: cx + w / 2, minY: y, maxY: y + h, minZ: cz - d / 2, maxZ: cz + d / 2, surface };
    if (team !== undefined) solid.team = team;
    this.solids.push(solid);
    if (style !== 'invisible') this.decor.push({ kind: 'block', solid: this.solids.length - 1, style });
    return this.solids.length - 1;
  }

  /** Visual-only block centred at (x, z), bottom at y: details that collision boxes elsewhere stand in for. */
  shape(x: number, y: number, z: number, w: number, h: number, d: number, style: BlockStyle, color?: number) {
    const cx = this.tx(x), cz = this.tz(z);
    this.decor.push({ kind: 'shape', min: [cx - w / 2, y, cz - d / 2], max: [cx + w / 2, y + h, cz + d / 2], style, ...(color === undefined ? {} : { color }) });
  }

  /** Ramp rising toward local direction dir (0:+X 1:+Z 2:-X 3:-Z). */
  ramp(x: number, z: number, w: number, d: number, y0: number, y1: number, dir: 0 | 1 | 2 | 3, style: RampStyle = 'ramp') {
    const cx = this.tx(x), cz = this.tz(z);
    const mdir = (this.s < 0 ? (dir + 2) % 4 : dir) as 0 | 1 | 2 | 3;
    this.ramps.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, y0, y1, dir: mdir, surface: 'metal' });
    this.decor.push({ kind: 'ramp', ramp: this.ramps.length - 1, style });
  }

  /**
   * Ladder up a wall face from y0 to the landing at y1, its rungs centred on (x, z); `dir` points
   * from the ladder into the wall (0:+X 1:+Z 2:-X 3:-Z), the way a climber faces.
   */
  ladder(x: number, z: number, y0: number, y1: number, dir: 0 | 1 | 2 | 3, width = 0.9) {
    this.ladders.push({ x: this.tx(x), z: this.tz(z), y0, y1, width, dir: (this.s < 0 ? (dir + 2) % 4 : dir) as 0 | 1 | 2 | 3 });
  }

  /** Tint the block made by `box` (team crates, painted plaster, rusty steel). Returns the solid. */
  paint(solid: number, color: number) {
    for (let i = this.decor.length - 1; i >= 0; i--) {
      const d = this.decor[i];
      if (d.kind === 'block' && d.solid === solid) { d.color = color; break; }
    }
    return solid;
  }

  /** Wooden crate standing on y (or the ground), optionally tinted. */
  crate(x: number, y: number | 'ground', z: number, w = 1.5, h = w, d = w, color?: number) {
    const i = this.box(x, y === 'ground' ? this.ground(x, z) : y, z, w, h, d, 'crate');
    return color === undefined ? i : this.paint(i, color);
  }

  /**
   * Cylinder resting on y: upright (`axis` 'y', `length` is its height) or lying along x/z. Its
   * collision is a fan of boxes inscribed in the circle, so cover stays within 10% of the surface.
   */
  cylinder(x: number, y: number, z: number, radius: number, length: number, style: BlockStyle, axis: 'x' | 'y' | 'z' = 'y', color?: number) {
    const surface = surfaceFor(style);
    const n = radius < 0.8 ? 2 : radius < 2 ? 3 : 5;
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) / n) * Math.PI / 2, u = radius * Math.cos(a) * 2, v = radius * Math.sin(a) * 2;
      if (axis === 'y') this.box(x, y, z, u, length, v, 'invisible', surface);
      else if (axis === 'x') this.box(x, y + radius - v / 2, z, length, v, u, 'invisible', surface);
      else this.box(x, y + radius - v / 2, z, u, v, length, 'invisible', surface);
    }
    // Mirroring swaps nothing for an axis-aligned cylinder: only its centre moves.
    this.decor.push({ kind: 'cylinder', x: this.tx(x), y, z: this.tz(z), radius, height: length, axis, style, ...(color === undefined ? {} : { color }) });
  }

  /**
   * Lattice girder (fallen cranes, gantries) along its bottom centreline, w wide and h deep. Its
   * collision per panel is a walkable top chord and a low bottom chord, so shots pass between them.
   */
  truss(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w: number, h: number, color?: number) {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / w)), cell = Math.min(w, len / n + 0.2);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, z = z0 + (z1 - z0) * t;
      this.box(x, y + h - 0.16, z, cell, 0.16, cell, 'invisible', 'metal');
      this.box(x, y, z, cell, 0.16, cell, 'invisible', 'metal');
    }
    const a = this.at(x0, z0), b = this.at(x1, z1);
    this.decor.push({ kind: 'truss', x0: a.x, y0, z0: a.z, x1: b.x, y1, z1: b.z, w, h, ...(color === undefined ? {} : { color }) });
  }

  /** Sphere centred at height y, with an inscribed box as its collision. */
  ball(x: number, y: number, z: number, radius: number, style: BlockStyle, color?: number) {
    const side = radius * 1.5;
    this.box(x, y - side / 2, z, side, side, side, 'invisible', surfaceFor(style));
    this.decor.push({ kind: 'ball', x: this.tx(x), y, z: this.tz(z), radius, style, ...(color === undefined ? {} : { color }) });
  }

  /** Decorative box with no collision (mullions, fins, trims, canopies out of reach): centred on x/z, base at y. */
  detail(x: number, y: number, z: number, w: number, h: number, d: number, style: BlockStyle, color?: number) {
    this.decor.push({ kind: 'detail', x: this.tx(x), y, z: this.tz(z), w, h, d, style, ...(color === undefined ? {} : { color }) });
  }

  /** Decorative notched-square tower section with no collision (see the 'loft' decor). */
  loft(x: number, z: number, y0: number, y1: number, half0: number, notch0: number, half1: number, notch1: number, style: BlockStyle, color?: number, cap = false) {
    this.decor.push({ kind: 'loft', x: this.tx(x), z: this.tz(z), y0, y1, half0, notch0, half1, notch1, style, ...(color === undefined ? {} : { color }), ...(cap ? { cap } : {}) });
  }

  /** Decorative disc with no collision, facing the normal (nx, ny, nz). */
  disc(x: number, y: number, z: number, nx: number, ny: number, nz: number, rx: number, ry: number, depth: number, style: BlockStyle, color?: number) {
    this.decor.push({ kind: 'disc', x: this.tx(x), y, z: this.tz(z), nx: this.tx(nx), ny, nz: this.tz(nz), rx, ry, depth, style, ...(color === undefined ? {} : { color }) });
  }

  /** Still water filling a w×d basin at height y (decorative; dig the basin with a terrain pad). */
  water(x: number, y: number, z: number, w: number, d: number) {
    this.decor.push({ kind: 'water', x: this.tx(x), y, z: this.tz(z), w, d });
  }

  /**
   * Stairs that are as solid as they are drawn: the ramp is the walking surface, and a stepped fill
   * under it (every block's top below the slope) stops anyone walking through the flight.
   */
  stairs(x: number, z: number, w: number, d: number, y0: number, y1: number, dir: 0 | 1 | 2 | 3) {
    this.ramp(x, z, w, d, y0, y1, dir, 'stairs');
    const alongX = dir === 0 || dir === 2, run = alongX ? w : d, sign = dir === 0 || dir === 1 ? 1 : -1;
    const n = Math.max(1, Math.ceil(run / 0.6)), start = (alongX ? x : z) - sign * run / 2;
    for (let i = 1; i < n; i++) {
      const top = y0 + (y1 - y0) * (i / n) - 0.03, c = start + sign * (i + 0.5) * run / n;
      if (top - y0 < 0.15) continue;
      if (alongX) this.box(c, y0 - 0.05, z, run / n, top - y0 + 0.05, d, 'invisible', 'metal');
      else this.box(x, y0 - 0.05, c, w, top - y0 + 0.05, run / n, 'invisible', 'metal');
    }
  }

  prop(model: string, x: number, y: number | 'ground', z: number, rotY = 0, scale = 1) {
    const yy = y === 'ground' ? this.ground(x, z) : y;
    this.decor.push({ kind: 'prop', model, x: this.tx(x), y: yy, z: this.tz(z), rotY: this.rot(rotY), scale });
  }

  /** A prop that also blocks movement and bullets with an approximate box. */
  solidProp(model: string, x: number, y: number | 'ground', z: number, rotY: number, w: number, h: number, d: number, scale = 1, surface: Surface = 'metal') {
    const yy = y === 'ground' ? this.ground(x, z) : y;
    const quarter = Math.round(rotY / (Math.PI / 2)) % 2 !== 0;
    this.box(x, yy, z, quarter ? d : w, h, quarter ? w : d, 'invisible', surface);
    this.prop(model, x, yy, z, rotY, scale);
  }

  light(x: number, y: number, z: number, color: number, intensity = 6, distance = 14) {
    this.decor.push({ kind: 'light', x: this.tx(x), y, z: this.tz(z), color, intensity, distance });
  }

  rail(x0: number, z0: number, x1: number, z1: number, y: number) {
    this.decor.push({ kind: 'rail', x0: this.tx(x0), z0: this.tz(z0), x1: this.tx(x1), z1: this.tz(z1), y });
  }

  point(id: PointId, name: string, x: number, y: number, z: number, radius: number) {
    this.points.push({ id, name, x: this.tx(x), y, z: this.tz(z), radius });
  }

  spawn(team: 0 | 1, x: number, y: number, z: number, yaw: number) {
    this.spawns.push({ team: this.team(team), x: this.tx(x), y, z: this.tz(z), yaw: this.rot(yaw) });
  }

  /** Ammo crate standing on the floor at (x, z); `y` is the floor height (or 'ground'). */
  ammoCrate(x: number, y: number | 'ground', z: number) {
    this.pickups.push({ x: this.tx(x), y: y === 'ground' ? this.ground(x, z) : y, z: this.tz(z), item: 'ammo', respawn: 0 });
  }

  /** Drivable vehicle parked at (x, z) on the floor at y (or 'ground'), facing yaw. */
  vehicle(kind: VehicleKind, x: number, y: number | 'ground', z: number, yaw = 0) {
    this.vehicles.push({ kind, x: this.tx(x), y: y === 'ground' ? this.ground(x, z) : y, z: this.tz(z), yaw: this.rot(yaw) });
  }

  raw(decor: Decor) { this.decor.push(decor); }
  at(x: number, z: number) { return { x: this.tx(x), z: this.tz(z) }; }
  rotation(r: number) { return this.rot(r); }

  // ---- Composite structures ------------------------------------------------------------
  /**
   * Enterable bunker: four walls with door gaps, optional windows, and a walkable roof.
   * doors: list of [side, offset, width] where side is 'n' | 's' | 'e' | 'w' in local space.
   */
  bunker(x: number, z: number, w: number, d: number, opts: { y?: number; h?: number; doors: [Side, number, number][]; windows?: [Side, number, number][]; roof?: boolean; style?: BlockStyle }) {
    const y = opts.y ?? this.ground(x, z);
    const h = opts.h ?? 4.2, t = 0.5, style = opts.style ?? 'wall';
    const sides: Record<Side, { len: number; along: 'x' | 'z'; cx: number; cz: number }> = {
      n: { len: w, along: 'x', cx: x, cz: z - d / 2 + t / 2 },
      s: { len: w, along: 'x', cx: x, cz: z + d / 2 - t / 2 },
      w: { len: d - 2 * t, along: 'z', cx: x - w / 2 + t / 2, cz: z },
      e: { len: d - 2 * t, along: 'z', cx: x + w / 2 - t / 2, cz: z },
    };
    for (const side of ['n', 's', 'e', 'w'] as Side[]) {
      const info = sides[side];
      const gaps: { at: number; width: number; kind: 'door' | 'window' }[] = [
        ...opts.doors.filter(g => g[0] === side).map(g => ({ at: g[1], width: g[2], kind: 'door' as const })),
        ...(opts.windows ?? []).filter(g => g[0] === side).map(g => ({ at: g[1], width: g[2], kind: 'window' as const })),
      ].sort((a, b) => a.at - b.at);
      let cursor = -info.len / 2;
      const segment = (from: number, to: number, y0: number, y1: number) => {
        if (to - from < 0.05) return;
        const mid = (from + to) / 2, len = to - from;
        if (info.along === 'x') this.box(info.cx + mid, y + y0, info.cz, len, y1 - y0, t, style);
        else this.box(info.cx, y + y0, info.cz + mid, t, y1 - y0, len, style);
      };
      for (const gap of gaps) {
        const a = gap.at - gap.width / 2, b = gap.at + gap.width / 2;
        segment(cursor, a, 0, h);
        if (gap.kind === 'door') segment(a, b, 2.7, h);
        else { segment(a, b, 0, 1.1); segment(a, b, 2.2, h); }
        cursor = b;
      }
      segment(cursor, info.len / 2, 0, h);
    }
    if (opts.roof !== false) this.box(x, y + h, z, w + 0.4, 0.35, d + 0.4, 'floor');
    return { y, h, top: y + h + 0.35 };
  }

  /** Raised platform on pillars with a solid deck. */
  platform(x: number, z: number, w: number, d: number, top: number, opts: { pillars?: boolean; deck?: BlockStyle } = {}) {
    const base = this.ground(x, z);
    this.box(x, top - 0.35, z, w, 0.35, d, opts.deck ?? 'floor');
    if (opts.pillars !== false) {
      for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const gx = x + px * (w / 2 - 0.4), gz = z + pz * (d / 2 - 0.4);
        const g = Math.min(base, this.ground(gx, gz));
        this.box(gx, g - 0.5, gz, 0.5, top - 0.35 - g + 0.5, 0.5, 'pillar');
      }
    }
  }

  /** Team warpgate: walled spawn room whose energy shield only its own team can cross. */
  warpgate(x: number, z: number) {
    const sy = this.ground(x, z);
    this.box(x - 7, sy, z, 1.2, 7, 24, 'wall');
    this.box(x - 1, sy, z - 12, 13, 7, 1.2, 'wall');
    this.box(x - 1, sy, z + 12, 13, 7, 1.2, 'wall');
    this.box(x - 1, sy + 7, z, 13, 0.5, 25, 'floor');
    this.box(x + 5.4, sy, z, 0.3, 7, 22.8, 'shield', 'energy', this.team(0));
    for (const dz of [-7, -2.5, 2.5, 7]) this.spawn(0, x - 3, sy, z + dz, -Math.PI / 2);
    this.raw({ kind: 'spawnPad', team: this.team(0), ...this.at(x - 2, z), y: sy, rotY: this.rotation(-Math.PI / 2) });
    this.light(x - 4, sy + 6, z, this.mirroredSide ? 0xff5a4a : 0x58b6ff, 8, 20);
    return sy;
  }

  /** Tree with a solid trunk (canopy is decorative). */
  tree(x: number, z: number, scale = 1, variant = 0) {
    const y = this.ground(x, z);
    this.box(x, y, z, 0.6 * scale, 3.2 * scale, 0.6 * scale, 'invisible', 'rock');
    this.decor.push({ kind: 'tree', x: this.tx(x), y, z: this.tz(z), scale, variant });
  }

  /** Glowing ice crystal cluster with a solid core. */
  crystal(x: number, z: number, scale = 1, rotY = 0) {
    const y = this.ground(x, z);
    this.box(x, y, z, 1.4 * scale, 2.4 * scale, 1.4 * scale, 'invisible', 'glass');
    this.decor.push({ kind: 'crystal', x: this.tx(x), y, z: this.tz(z), scale, rotY: this.rot(rotY) });
  }

  /** Antenna mast landmark (decorative). */
  mast(x: number, y: number, z: number, height: number) {
    this.decor.push({ kind: 'mast', x: this.tx(x), y, z: this.tz(z), height });
  }

  build(): MapDef {
    const o = this.o;
    return {
      id: o.id, name: o.name, region: o.region, description: o.description, theme: o.theme,
      bounds: { minX: -o.halfX, maxX: o.halfX, minZ: -o.halfZ, maxZ: o.halfZ },
      terrain: this.terrain, solids: this.solids, ramps: this.ramps, points: this.points, spawns: this.spawns,
      decor: this.decor, sun: o.sun,
      ...(o.sabotage ? { sabotage: o.sabotage } : {}),
      ...(o.big ? { big: true } : {}),
      ...(this.pickups.length ? { pickups: this.pickups } : {}),
      ...(this.ladders.length ? { ladders: this.ladders } : {}),
      ...(this.vehicles.length ? { vehicles: this.vehicles } : {}),
    };
  }
}

export type Side = 'n' | 's' | 'e' | 'w';

function surfaceFor(style: BlockStyle): Surface {
  switch (style) {
    case 'concrete': case 'pillar': case 'sandstone': return 'concrete';
    // Masonry and timber both throw up dust and splinters like concrete.
    case 'brick': case 'plaster': case 'cobble': case 'slab': case 'wood': case 'crate': case 'paving': case 'asphalt': case 'tile': case 'mosaic': case 'painted': case 'carpet': return 'concrete';
    case 'hedge': return 'dirt';
    case 'facade': return 'concrete';
    case 'rock': return 'rock';
    case 'glass': case 'window': case 'curtain': return 'glass';
    case 'shield': return 'energy';
    default: return 'metal';
  }
}
