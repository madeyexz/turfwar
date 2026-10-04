import { terrainHeight, type Heightfield, type Ramp, type Solid, type Surface } from '../collision';
import type { Laws } from '../laws';
import type { BlockStyle, CapturePointDef, Decor, MapDef, PointId, SpawnDef, ThemeId } from './types';

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

interface Pad { x: number; z: number; w: number; d: number; h: number; blend: number }
interface Bump { x: number; z: number; r: number; h: number }

export interface BuilderOptions {
  id: string; name: string; region: string; description: string; theme: ThemeId;
  halfX: number; halfZ: number; seed: number;
  /** Amplitude of rolling ground inside the playable area and of the boundary ridges. */
  roll: number; ridge: number;
  laws: Laws;
  sun: { x: number; y: number; z: number };
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
  pads: Pad[] = [];
  bumps: Bump[] = [];
  terrain!: Heightfield;
  private s = 1;

  constructor(readonly o: BuilderOptions) {}

  /** Run a placement block for the west half, then again rotated 180° for the east half. */
  mirrored(place: () => void) {
    this.s = 1; place();
    this.s = -1; place();
    this.s = 1;
  }
  get mirroredSide() { return this.s < 0; }
  team(t: 0 | 1): 0 | 1 { return (this.s < 0 ? 1 - t : t) as 0 | 1; }
  private tx(x: number) { return x * this.s; }
  private tz(z: number) { return z * this.s; }
  private rot(r: number) { return this.s < 0 ? r + Math.PI : r; }

  // ---- Terrain -------------------------------------------------------------------------
  pad(x: number, z: number, w: number, d: number, h: number, blend = 5) {
    this.pads.push({ x: this.tx(x), z: this.tz(z), w, d, h, blend });
  }
  bump(x: number, z: number, r: number, h: number) { this.bumps.push({ x: this.tx(x), z: this.tz(z), r, h }); }

  rawHeight(x: number, z: number) {
    const o = this.o;
    const nx = Math.abs(x) / o.halfX, nz = Math.abs(z) / o.halfZ;
    const edge = smooth((Math.max(nx, nz) - 0.86) / 0.3);
    // Average with the 180°-rotated sample so both teams fight on identical ground.
    const noise = (fbm(x * 0.035, z * 0.035, o.seed) + fbm(-x * 0.035, -z * 0.035, o.seed)) / 2;
    const ridgeNoise = (fbm(x * 0.05, z * 0.05, o.seed + 9) + fbm(-x * 0.05, -z * 0.05, o.seed + 9)) / 2;
    let h = noise * o.roll + edge * (o.ridge + ridgeNoise * o.ridge * 0.6);
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
    const cx = this.tx(x), cz = this.tz(z);
    const solid: Solid = { minX: cx - w / 2, maxX: cx + w / 2, minY: y, maxY: y + h, minZ: cz - d / 2, maxZ: cz + d / 2, surface };
    if (team !== undefined) solid.team = team;
    this.solids.push(solid);
    if (style !== 'invisible') this.decor.push({ kind: 'block', solid: this.solids.length - 1, style });
    return this.solids.length - 1;
  }

  /** Ramp rising toward local direction dir (0:+X 1:+Z 2:-X 3:-Z). */
  ramp(x: number, z: number, w: number, d: number, y0: number, y1: number, dir: 0 | 1 | 2 | 3, style: 'stairs' | 'ramp' = 'ramp') {
    const cx = this.tx(x), cz = this.tz(z);
    const mdir = (this.s < 0 ? (dir + 2) % 4 : dir) as 0 | 1 | 2 | 3;
    this.ramps.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, y0, y1, dir: mdir, surface: 'metal' });
    this.decor.push({ kind: 'ramp', ramp: this.ramps.length - 1, style });
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
      const gaps = opts.doors.filter(g => g[0] === side).map(g => ({ at: g[1], width: g[2], kind: 'door' as const }))
        .concat((opts.windows ?? []).filter(g => g[0] === side).map(g => ({ at: g[1], width: g[2], kind: 'window' as const })))
        .sort((a, b) => a.at - b.at);
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

  build(): MapDef {
    const o = this.o;
    const anomaly = this.points.find(p => p.id === 'B')!;
    return {
      id: o.id, name: o.name, region: o.region, description: o.description, theme: o.theme,
      bounds: { minX: -o.halfX, maxX: o.halfX, minZ: -o.halfZ, maxZ: o.halfZ },
      terrain: this.terrain, solids: this.solids, ramps: this.ramps, points: this.points, spawns: this.spawns,
      anomaly: { x: anomaly.x, y: anomaly.y + 5, z: anomaly.z }, decor: this.decor, laws: o.laws, sun: o.sun,
    };
  }
}

export type Side = 'n' | 's' | 'e' | 'w';

function surfaceFor(style: BlockStyle): Surface {
  switch (style) {
    case 'concrete': case 'pillar': return 'concrete';
    case 'rock': return 'rock';
    case 'glass': return 'glass';
    case 'shield': return 'energy';
    default: return 'metal';
  }
}
