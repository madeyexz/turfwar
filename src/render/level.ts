import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Assets } from '../assets';
import { LADDER_DIRS, terrainHeight, type Ladder, type Ramp, type Solid } from '../../shared/collision';
import { fbm } from '../../shared/maps/builder';
import type { BlockStyle, Decor, MapDef, RampStyle } from '../../shared/maps/types';
import { rng } from '../../shared/math';
import { addDressing } from './dressing';
import { CJK_STACK, UI_STACK, cjkFontReady } from '../ui/fonts';
import { shieldMaterial, surfaceMaterial, terrainMaterial, type Theme } from './materials';

const TEAM_COLORS = [new THREE.Color(0x3aa0ff), new THREE.Color(0xff4a3a)];
const LADDER_GREY = 0x9aa0a4;

/** Material bucket, texture scale (m per tile), default tint and base occlusion of the realistic styles. */
const LOOKS = {
  brick: { material: 'brick', uv: 2, color: 0xe6d8cc, ao: 0.72 },
  plaster: { material: 'plaster', uv: 3, color: 0xf2eee6, ao: 0.74 },
  wood: { material: 'planks', uv: 1.8, color: 0xb89a78, ao: 0.75 },
  roof: { material: 'roof', uv: 1.6, color: 0xc4c4bc, ao: 0.8 },
  cobble: { material: 'cobble', uv: 2.2, color: 0xd8d4cc, ao: 0.9 },
  slab: { material: 'steel', uv: 4, color: 0xd2cdc4, ao: 0.95 },
  steel: { material: 'paint', uv: 2, color: 0x8c5236, ao: 0.78 },
  concrete: { material: 'steel', uv: 3, color: 0xd6d6d0, ao: 0.74 },
  rock: { material: 'rock', uv: 2.5, color: 0xffffff, ao: 0.8 },
  // Taipei streets: square sidewalk tiles, asphalt, marble shop floors and white mosaic facade tiles.
  paving: { material: 'sidewalk', uv: 2.2, color: 0xe4e2dc, ao: 0.95 },
  asphalt: { material: 'asphalt', uv: 7, color: 0xb0b0b0, ao: 1 },
  tile: { material: 'floortile', uv: 2.4, color: 0xf0ece4, ao: 0.95 },
  mosaic: { material: 'facadetile', uv: 1.6, color: 0xf2efe8, ao: 0.8 },
  painted: { material: 'painted', uv: 1, color: 0xf0f0ec, ao: 0.9 },
} as const;

/** Static battlefield visuals built from shared map data (collision stays authoritative). */
export class LevelView {
  readonly group = new THREE.Group();
  readonly shields: THREE.ShaderMaterial[] = [];
  private parts = new Map<string, THREE.BufferGeometry[]>();
  private materials: Record<string, THREE.Material>;
  private animated: { object: THREE.Object3D; update: (t: number) => void }[] = [];

  constructor(private assets: Assets, private map: MapDef, private theme: Theme) {
    this.materials = {
      steel: surfaceMaterial(assets, 'concrete', { color: 0xb9c2c8, metalness: 0.12, roughness: 0.85, normalScale: 0.6 }),
      steelDark: surfaceMaterial(assets, 'metalplate', { color: 0x6c757c, metalness: 0.35, normalScale: 0.6 }),
      floor: surfaceMaterial(assets, 'metalplate', { color: 0xb3b9be, metalness: 0.3 }),
      concrete: trimMaterial(assets, 'T_Trim_03_BaseColor', 0xd8d2c8),
      sandstone: surfaceMaterial(assets, 'concrete', { color: 0xffe9c4, normalScale: 0.5 }),
      sandstoneTrim: surfaceMaterial(assets, 'concrete', { color: 0xc9a77a, normalScale: 0.5 }),
      container: surfaceMaterial(assets, 'container', { metalness: 0.3, roughness: 0.75 }),
      rock: surfaceMaterial(assets, theme.rock, { color: theme.rockTint.getHex(), normalScale: 1.2 }),
      hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, metalness: 0.2 }),
      bark: new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95, vertexColors: true }),
      leaves: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true, vertexColors: true }),
      crystal: new THREE.MeshStandardMaterial({ color: 0x1b3a52, emissive: 0x5fd6ff, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.3, flatShading: true, vertexColors: true }),
      mast: new THREE.MeshStandardMaterial({ color: 0x5b636a, roughness: 0.6, metalness: 0.5, vertexColors: true }),
      glow: new THREE.MeshStandardMaterial({ color: 0x0a1416, emissive: 0x7ff6ff, emissiveIntensity: 2.4 }),
      glowWarm: new THREE.MeshStandardMaterial({ color: 0x160e06, emissive: 0xffb45a, emissiveIntensity: 2.2 }),
      painted: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }),
      lightPanel: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e0).multiplyScalar(1.6), toneMapped: false }),
      glass: new THREE.MeshStandardMaterial({ color: 0x6fa8c8, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.35 }),
      panel: trimMaterial(assets, 'T_Trim_02_BaseColor', 0xd4dade),
      panelDark: trimMaterial(assets, 'T_Trim_01_BaseColor', 0xa8b0b6),
      // Realistic architecture (CC0 Poly Haven sets); per-block tints arrive as vertex colours.
      brick: surfaceMaterial(assets, 'brick', { normalScale: 0.9 }),
      plaster: surfaceMaterial(assets, 'plaster', { normalScale: 0.6 }),
      planks: surfaceMaterial(assets, 'planks', { normalScale: 0.8 }),
      roof: surfaceMaterial(assets, 'corrugated', { metalness: 0.45, roughness: 0.6 }),
      cobble: surfaceMaterial(assets, 'cobble'),
      paint: surfaceMaterial(assets, 'metalplate', { metalness: 0.35, normalScale: 0.5 }),
      hedge: surfaceMaterial(assets, 'moss', { color: 0x8fbf6a, normalScale: 1.6 }),
      sidewalk: surfaceMaterial(assets, 'sidewalk', { normalScale: 0.7, color: 0x000000 }),
      asphalt: surfaceMaterial(assets, 'asphalt', { normalScale: 0.8, color: 0x000000 }),
      floortile: surfaceMaterial(assets, 'floortile', { normalScale: 0.4, roughness: 0.35 }),
      facadetile: surfaceMaterial(assets, 'facadetile', { normalScale: 0.6 }),
      water: new THREE.MeshStandardMaterial({ color: 0x1e3c48, roughness: 0.06, metalness: 0.55, transparent: true, opacity: 0.84, depthWrite: false }),
      marking: new THREE.MeshStandardMaterial({ roughness: 0.75, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    };
    // The tile and asphalt photos are dark; lift them to street brightness.
    (this.materials.sidewalk as THREE.MeshStandardMaterial).color.setScalar(2.1);
    (this.materials.asphalt as THREE.MeshStandardMaterial).color.setScalar(1.5);
    if (map.decor.some(d => (d.kind === 'block' || d.kind === 'shape') && d.style === 'facade')) this.materials.facade = facadeMaterial();
    if (map.decor.some(d => 'style' in d && d.style === 'curtain')) this.materials.curtain = curtainMaterial();
    // Self-lit strips and lamps: vertex colours brighter than white, so bloom picks them up.
    this.materials.neon = new THREE.MeshBasicMaterial({ vertexColors: true });
    const signs: SignDecor[] = [];
    let shapes = 0;
    this.buildTerrain();
    map.decor.forEach((d, i) => {
      switch (d.kind) {
        case 'block': this.block(map.solids[d.solid], d.style, d.solid, d.color); break;
        case 'detail': this.block({ minX: d.x - d.w / 2, maxX: d.x + d.w / 2, minY: d.y, maxY: d.y + d.h, minZ: d.z - d.d / 2, maxZ: d.z + d.d / 2, surface: 'metal' }, d.style, 100000 + i, d.color); break;
        case 'loft': this.loft(d); break;
        case 'disc': this.disc(d); break;
        case 'shape': {
          const [minX, minY, minZ] = d.min, [maxX, maxY, maxZ] = d.max;
          this.block({ minX, minY, minZ, maxX, maxY, maxZ, surface: 'concrete' }, d.style, 100000 + shapes++, d.color);
          break;
        }
        case 'cylinder': this.cylinder(d.x, d.y, d.z, d.radius, d.height, d.axis, d.style, d.color, d.sides, d.top); break;
        case 'water': this.add('water', boxGeo(d.x, d.y - 0.01, d.z, d.w, 0.02, d.d)); break;
        case 'ball': this.ball(d.x, d.y, d.z, d.radius, d.style, d.color); break;
        case 'truss': this.truss(new THREE.Vector3(d.x0, d.y0, d.z0), new THREE.Vector3(d.x1, d.y1, d.z1), d.w, d.h, d.color ?? LOOKS.steel.color); break;
        case 'ramp': this.ramp(map.ramps[d.ramp], d.style); break;
        case 'prop': this.prop(d.model, d.x, d.y, d.z, d.rotY, d.scale ?? 1); break;
        case 'light': this.light(d.x, d.y, d.z, d.color, d.intensity, d.distance); break;
        case 'rail': this.rail(d.x0, d.z0, d.x1, d.z1, d.y); break;
        case 'spawnPad': this.spawnPad(d.team, d.x, d.y, d.z, d.rotY); break;
        case 'tree': this.tree(d.x, d.y, d.z, d.scale, d.variant); break;
        case 'crystal': this.crystal(d.x, d.y, d.z, d.scale, d.rotY); break;
        case 'mast': this.mast(d.x, d.y, d.z, d.height); break;
        case 'sign': signs.push(d); break;
        case 'marking': {
          const g = boxGeo(d.x, d.y, d.z, d.w, 0.004, d.d, 0, 4);
          tint(g, d.color, d.y, 1, 1);
          this.add('marking', g);
          break;
        }
        default: break;
      }
    });
    for (const l of map.ladders ?? []) this.ladder(l);
    this.flush();
    if (!theme.urban) this.scatter();
    // Maps with a dressing set bring their own skyline in place of the generic mountain ring.
    const dressed = map.decor.some(d => d.kind === 'dressing');
    if (!dressed) this.horizon();
    // Signs bake their text into a canvas: wait for the Chinese face so they never keep a fallback font.
    const signsBuilt = signs.length
      ? cjkFontReady(signs.map(s => s.text + (s.sub ?? '')).join('')).then(() => { this.group.add(signMesh(signs)); })
      : Promise.resolve();
    /** Resolves once the map's signs, dressing sets and model instances are built (they load on demand). */
    this.ready = Promise.all([signsBuilt, addDressing(this.group, map.decor).catch(e => console.warn('dressing failed', e))]).then(() => undefined);
  }
  readonly ready: Promise<void>;

  update(time: number) {
    for (const s of this.shields) s.uniforms.time.value = time;
    for (const a of this.animated) a.update(time);
  }

  private add(material: string, geometry: THREE.BufferGeometry) {
    let list = this.parts.get(material);
    if (!list) { list = []; this.parts.set(material, list); }
    // Normalize attributes so everything in a bucket merges cleanly.
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (!g.getAttribute('color')) {
      const n = g.getAttribute('position').count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    list.push(g);
  }

  private flush() {
    for (const [name, list] of this.parts) {
      const geometry = mergeGeometries(list, false);
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, this.materials[name]);
      mesh.castShadow = name !== 'glow' && name !== 'glowWarm' && name !== 'glass' && name !== 'water' && name !== 'marking' && name !== 'lightPanel' && name !== 'neon';
      mesh.receiveShadow = true;
      mesh.name = `level:${name}`;
      this.group.add(mesh);
    }
    this.parts.clear();
  }

  // ---- Terrain -------------------------------------------------------------------------
  private buildTerrain() {
    const f = this.map.terrain, n = f.n;
    const positions = new Float32Array(n * n * 3), splat = new Float32Array(n * n), indices: number[] = [];
    const pathPoints = [...this.map.points.map(p => [p.x, p.z]), ...this.map.spawns.map(s => [s.x, s.z])];
    for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
      const x = f.x0 + ix * f.spacing, z = f.z0 + iz * f.spacing, i = iz * n + ix;
      positions.set([x, f.heights[i], z], i * 3);
      // Dirt where soldiers walk: near objectives, spawns and the lanes between them.
      let d = 0;
      for (const [px, pz] of pathPoints) d = Math.max(d, 1 - Math.hypot(x - px, z - pz) / 16);
      for (const s of this.map.solids) {
        if (s.surface === 'energy') continue;
        const gap = Math.max(Math.abs(x - (s.minX + s.maxX) / 2) - (s.maxX - s.minX) / 2, Math.abs(z - (s.minZ + s.maxZ) / 2) - (s.maxZ - s.minZ) / 2);
        if (gap < 3) d = Math.max(d, 0.75 - gap * 0.2);
      }
      d = Math.max(d, 0.55 - Math.abs(z) / 14) * (Math.abs(x) < this.map.bounds.maxX ? 1 : 0);
      splat[i] = Math.min(1, d + fbm(x * 0.08, z * 0.08, 3) * 0.35);
      if (ix < n - 1 && iz < n - 1) {
        const a = i, b = i + 1, c = i + n, dd = i + n + 1;
        // Diagonal a-d matches shared terrainHeight triangulation.
        indices.push(a, dd, b, a, c, dd);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('splat', new THREE.BufferAttribute(splat, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, terrainMaterial(this.assets, this.theme));
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
  }

  // ---- Architecture ----------------------------------------------------------------------
  private block(s: Solid, style: BlockStyle, index: number, color?: number) {
    const w = s.maxX - s.minX, h = s.maxY - s.minY, d = s.maxZ - s.minZ;
    const cx = (s.minX + s.maxX) / 2, cy = (s.minY + s.maxY) / 2, cz = (s.minZ + s.maxZ) / 2;
    const r = rng(index * 977 + 13);
    switch (style) {
      case 'brick': case 'plaster': case 'wood': case 'roof': case 'cobble': case 'slab': case 'steel':
      case 'paving': case 'asphalt': case 'tile': case 'mosaic': case 'painted': {
        const look = LOOKS[style];
        const g = boxGeo(cx, cy, cz, w, h, d, 0, look.uv);
        tint(g, color ?? look.color, s.minY, h, look.ao);
        this.add(look.material, g);
        // Walls get a concrete coping (brick) or plinth (plaster), like the real thing.
        if (style === 'brick' && h > 2.2 && Math.min(w, d) < 1.2) this.add('steel', boxGeo(cx, s.maxY - 0.06, cz, w + 0.08, 0.12, d + 0.08, 0, 2));
        if (style === 'plaster' && h > 2.2) {
          const plinth = boxGeo(cx, s.minY + 0.25, cz, w + 0.04, 0.5, d + 0.04, 0, 2);
          shade(plinth, s.minY, 0.5, 0.6);
          this.add('steel', plinth);
        }
        return;
      }
      case 'crate': this.crate(cx, s.minY, cz, w, h, d, color); return;
      case 'facade': {
        // Buildings standing on the street get a shopfront storey under the window grid.
        const shop = s.minY < 0.5 && h > 6 ? SHOPFRONT : 0;
        if (shop) {
          this.materials.shopfront ??= shopfrontMaterial();
          const g = windowBox(cx, s.minY, cz, w, shop, d, SHOP_BAY, shop);
          tint(g, color ?? 0xd8d4cc, s.minY, shop, 0.85);
          this.add('shopfront', g);
        }
        const g = windowBox(cx, s.minY + shop, cz, w, h - shop, d);
        tint(g, color ?? 0xd8d4cc, s.minY, Math.min(h, 8), 0.8);
        this.add('facade', g);
        return;
      }
      case 'hedge': this.add('hedge', hedgeGeometry(cx, s.minY, cz, w, h, d, index)); return;
      case 'shield': {
        const mat = shieldMaterial(TEAM_COLORS[s.team ?? 0]);
        this.shields.push(mat);
        const plane = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(w, d), h), mat);
        plane.position.set(cx, cy, cz);
        if (d > w) plane.rotation.y = Math.PI / 2;
        plane.renderOrder = 5;
        this.group.add(plane);
        // Emitter frame.
        this.add('glow', boxGeo(cx, s.minY + 0.05, cz, w + 0.2, 0.1, d + 0.2));
        this.add('glow', boxGeo(cx, s.maxY - 0.05, cz, w + 0.2, 0.1, d + 0.2));
        return;
      }
      case 'rock': this.rock(s, r); return;
      case 'container': {
        const g = boxGeo(cx, cy, cz, w, h, d, 0.04, 2.6);
        tint(g, [0xc0622b, 0x2f6c8f, 0x7a8288, 0x5d7a3a, 0xb8902c][Math.floor(r() * 5)], s.minY, h);
        this.add('container', g);
        // Corner posts.
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) this.add('steelDark', boxGeo(cx + sx * (w / 2 - 0.08), cy, cz + sz * (d / 2 - 0.08), 0.18, h + 0.02, 0.18));
        return;
      }
      case 'sandstone': {
        // Plastered masonry: shaded body with a darker cornice on building-height blocks.
        const g = boxGeo(cx, cy, cz, w, h, d, 0, 7);
        shade(g, s.minY, h, 0.78);
        this.add('sandstone', g);
        if (h > 6) this.add('sandstoneTrim', boxGeo(cx, s.maxY - 0.2, cz, w + 0.3, 0.4, d + 0.3, 0, 4));
        return;
      }
      case 'concrete': case 'pillar': {
        const g = boxGeo(cx, cy, cz, w, h, d, Math.min(0.12, w / 6, d / 6), 3);
        shade(g, s.minY, h, 0.72);
        this.add('concrete', g);
        if (style === 'concrete' && h < 1.6 && Math.max(w, d) > 2.5) {
          // Hazard band on low barriers.
          const band = boxGeo(cx, s.maxY - 0.18, cz, w + 0.02, 0.16, d + 0.02);
          this.add('hazard', band);
        }
        return;
      }
      case 'floor': {
        const g = boxGeo(cx, cy, cz, w, h, d, 0.04, 3);
        this.add('floor', g);
        // Trim around the deck edge.
        this.add('steelDark', boxGeo(cx, s.minY - 0.06, cz, w + 0.06, 0.12, d + 0.06));
        return;
      }
      case 'glass': this.add('glass', boxGeo(cx, cy, cz, w, h, d)); return;
      case 'curtain': {
        const g = windowBox(cx, s.minY, cz, w, h, d, CURTAIN_BAY * CURTAIN_TILE, CURTAIN_FLOOR * CURTAIN_TILE);
        tint(g, color ?? 0x8fb4b8, s.minY, Math.min(h, 6), 0.9);
        this.add('curtain', g);
        return;
      }
      case 'neon': this.add('neon', glowing(boxGeo(cx, cy, cz, w, h, d), color ?? 0xffe0a0)); return;
      case 'light': this.add('lightPanel', boxGeo(cx, cy, cz, w, h, d)); return;
      case 'invisible': return;
      default: {
        // Armored wall: trim-sheet panelling (CC0 MegaKit textures), concrete foot, cap band,
        // pilasters and accent light strips.
        const dark = style === 'wallDark';
        const long = Math.max(w, d), alongX = w >= d;
        if (h > 1.6) {
          const foot = 0.45, cap = Math.min(0.75, h * 0.2);
          this.add('concrete', boxGeo(cx, s.minY + foot / 2, cz, w + 0.12, foot, d + 0.12, 0.04, 3));
          const body = facadeBox(cx, s.minY + foot, cz, w, h - foot - cap, d, dark ? [0.5, 0.93] : [0.25, 0.6], dark ? 5 : 4);
          shade(body, s.minY, h, 0.7);
          this.add(dark ? 'panelDark' : 'panel', body);
          this.add(dark ? 'panelDark' : 'panel', facadeBox(cx, s.maxY - cap, cz, w + 0.06, cap, d + 0.06, dark ? [0.35, 0.48] : [0.06, 0.24], 4));
          const count = Math.floor(long / 4);
          for (let i = 1; i < count; i++) {
            const t = -long / 2 + i * long / count;
            const px = alongX ? cx + t : cx, pz = alongX ? cz : cz + t;
            this.add('steelDark', boxGeo(px, cy, pz, alongX ? 0.3 : w + 0.14, h - 0.05, alongX ? d + 0.14 : 0.3));
          }
          if (h > 3 && long > 4 && r() < 0.75) {
            this.add(r() < 0.5 ? 'glow' : 'glowWarm', boxGeo(cx, s.maxY - cap - 0.12, cz, alongX ? long * 0.7 : w + 0.1, 0.06, alongX ? d + 0.1 : long * 0.7));
          }
        } else {
          const body = facadeBox(cx, s.minY, cz, w, h - 0.12, d, [0.06, 0.24], 4);
          shade(body, s.minY, h, 0.7);
          this.add(dark ? 'panelDark' : 'panel', body);
          this.add('steelDark', boxGeo(cx, s.maxY - 0.06, cz, w + 0.08, 0.12, d + 0.08));
        }
      }
    }
  }

  private rock(s: Solid, r: () => number) {
    const w = s.maxX - s.minX, h = s.maxY - s.minY, d = s.maxZ - s.minZ;
    // Rocks are cover: the boulder fills its collision box (sunk slightly into the ground) so shots
    // stop exactly where the rock shows, never on invisible corners or through visible bulges.
    const geo = rockBlockGeometry(Math.floor(r() * 1000));
    geo.scale(w, h + 0.2, d);
    geo.translate((s.minX + s.maxX) / 2, s.minY - 0.2, (s.minZ + s.maxZ) / 2);
    worldUV(geo, 2.5);
    this.add('rock', geo);
  }

  /** Wooden crate: plank body inside a darker frame along all twelve edges. */
  private crate(cx: number, y: number, cz: number, w: number, h: number, d: number, color = 0xffffff) {
    const body = boxGeo(cx, y + h / 2, cz, w - 0.04, h - 0.04, d - 0.04, 0, 1.6);
    tint(body, color, y, h, 0.8);
    this.add('planks', body);
    const t = Math.min(0.13, Math.min(w, h, d) * 0.09), frame = new THREE.Color(color).multiplyScalar(0.55).getHex();
    const edges = [
      ...[-1, 1].flatMap(sx => [-1, 1].map(sz => boxGeo(cx + sx * (w - t) / 2, y + h / 2, cz + sz * (d - t) / 2, t, h, t, 0, 1.6))),
      ...[y + t / 2, y + h - t / 2].flatMap(ey => [
        boxGeo(cx, ey, cz - (d - t) / 2, w, t, t, 0, 1.6), boxGeo(cx, ey, cz + (d - t) / 2, w, t, t, 0, 1.6),
        boxGeo(cx - (w - t) / 2, ey, cz, t, t, d, 0, 1.6), boxGeo(cx + (w - t) / 2, ey, cz, t, t, d, 0, 1.6),
      ]),
    ];
    for (const e of edges) { tint(e, frame, y, h, 0.85); this.add('planks', e); }
  }

  private cylinder(x: number, y: number, z: number, radius: number, length: number, axis: 'x' | 'y' | 'z', style: BlockStyle, color?: number, sides?: number, top = radius) {
    if (style === 'invisible') return;
    const look = LOOKS[style as keyof typeof LOOKS] ?? LOOKS.steel;
    const g = new THREE.CylinderGeometry(top, radius, length, sides ?? Math.min(48, Math.max(14, Math.round(radius * 14))), 1, false, sides ? Math.PI / sides : 0);
    if (sides) { const flat = g.toNonIndexed(); flat.computeVertexNormals(); g.copy(flat); }
    // Unwrap the side around the circumference and lay the caps flat, at the material's texel density.
    const uv = g.getAttribute('uv') as THREE.BufferAttribute, n = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(n.getY(i)) > 0.5) uv.setXY(i, (uv.getX(i) - 0.5) * 2 * radius / look.uv, (uv.getY(i) - 0.5) * 2 * radius / look.uv);
      else uv.setXY(i, uv.getX(i) * 2 * Math.PI * radius / look.uv, uv.getY(i) * length / look.uv);
    }
    if (axis === 'y') g.translate(0, length / 2, 0);
    else { if (axis === 'x') g.rotateZ(Math.PI / 2); else g.rotateX(Math.PI / 2); g.translate(0, radius, 0); }
    g.translate(x, y, z);
    this.styled(g, style, color, y, axis === 'y' ? length : radius * 2, LOOKS.steel);
  }

  /** Notched-square tower section (Taipei 101): the outline at y0 lofted to the one at y1, flat-shaded. */
  private loft(d: Extract<Decor, { kind: 'loft' }>) {
    const a = notchedSquare(d.half0, d.notch0), b = notchedSquare(d.half1, d.notch1), n = a.length;
    const pos: number[] = [], uv: number[] = [];
    // Panels: u runs around the perimeter in metres, v up the height (curtain walls tile by floor).
    const tileW = d.style === 'curtain' ? CURTAIN_BAY * CURTAIN_TILE : 3, tileH = d.style === 'curtain' ? CURTAIN_FLOOR * CURTAIN_TILE : 3;
    let along = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, len = Math.hypot(a[j][0] - a[i][0], a[j][1] - a[i][1]);
      const p = (q: number[][], k: number, y: number) => [d.x + q[k][0], y, d.z + q[k][1]];
      const quad = [p(a, i, d.y0), p(b, j, d.y1), p(a, j, d.y0), p(a, i, d.y0), p(b, i, d.y1), p(b, j, d.y1)];
      const u0 = along / tileW, u1 = (along + len) / tileW, v1 = (d.y1 - d.y0) / tileH;
      const uvs = [[u0, 0], [u1, v1], [u1, 0], [u0, 0], [u0, v1], [u1, v1]];
      for (const v of quad) pos.push(...v);
      for (const v of uvs) uv.push(...v);
      along += len;
    }
    if (d.cap) for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      pos.push(d.x, d.y1, d.z, d.x + b[j][0], d.y1, d.z + b[j][1], d.x + b[i][0], d.y1, d.z + b[i][1]);
      uv.push(0.003, 0.003, 0.003, 0.003, 0.003, 0.003);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    this.styled(g, d.style, d.color, d.y0, Math.max(1, d.y1 - d.y0));
  }

  /** Disc ornament facing its normal (the 101's ruyi and coins). */
  private disc(d: Extract<Decor, { kind: 'disc' }>) {
    const g = new THREE.CylinderGeometry(1, 1, d.depth, 28, 1, false);
    g.scale(d.rx, 1, d.ry);
    const n = new THREE.Vector3(d.nx, d.ny, d.nz).normalize();
    // Lay the ellipse's x axis along the level tangent (−nz, 0, nx), which turning the disc's
    // axis from +y onto the normal leaves in place.
    g.rotateY(Math.atan2(-n.x, -n.z));
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n));
    g.translate(d.x, d.y, d.z);
    worldUV(g, 2);
    this.styled(g, d.style, d.color, d.y - d.ry, d.ry * 2);
  }

  /** File a decorative mesh under its style's material, tinted (or lit, for neon). */
  private styled(g: THREE.BufferGeometry, style: BlockStyle, color: number | undefined, base: number, height: number, fallback: (typeof LOOKS)[keyof typeof LOOKS] = LOOKS.concrete) {
    if (style === 'neon') { this.add('neon', glowing(g, color ?? 0xffe0a0)); return; }
    if (style === 'curtain') { tint(g, color ?? 0x8fb4b8, base, height, 0.9); this.add('curtain', g); return; }
    const look = LOOKS[style as keyof typeof LOOKS] ?? fallback;
    tint(g, color ?? look.color, base, height, look.ao);
    this.add(look.material, g);
  }

  private ball(x: number, y: number, z: number, radius: number, style: BlockStyle, color?: number) {
    const look = LOOKS[style as keyof typeof LOOKS] ?? LOOKS.steel;
    const g = new THREE.IcosahedronGeometry(radius, 3);
    g.translate(x, y, z);
    worldUV(g, look.uv);
    tint(g, color ?? look.color, y - radius, radius * 2, look.ao);
    this.add(look.material, g);
  }

  /** Lattice girder: four chords, a vertical and a cross brace at every panel point, diagonals on both sides. */
  private truss(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, color: number) {
    const along = b.clone().sub(a), n = Math.max(1, Math.round(Math.hypot(along.x, along.z) / w));
    const side = new THREE.Vector3(-along.z, 0, along.x).setLength(w / 2 - 0.06), up = new THREE.Vector3(0, h - 0.1, 0);
    const lift = new THREE.Vector3(0, 0.06, 0);
    const parts: THREE.BufferGeometry[] = [];
    const strut = (p: THREE.Vector3, q: THREE.Vector3, t: number) => parts.push(Math.abs(p.x - q.x) + Math.abs(p.z - q.z) < 1e-3
      ? boxGeo(p.x, (p.y + q.y) / 2, p.z, t, Math.abs(q.y - p.y), t, 0, 2)
      : beam(p, q, t, t));
    const at = (i: number) => a.clone().addScaledVector(along, i / n).add(lift);
    for (const s of [side, side.clone().negate()]) for (const u of [new THREE.Vector3(), up]) strut(at(0).add(s).add(u), at(n).add(s).add(u), 0.16);
    for (let i = 0; i <= n; i++) {
      const p = at(i);
      for (const s of [side, side.clone().negate()]) strut(p.clone().add(s), p.clone().add(s).add(up), 0.09);
      strut(p.clone().add(side).add(up), p.clone().sub(side).add(up), 0.08);
      strut(p.clone().add(side), p.clone().sub(side), 0.08);
      if (i < n) for (const s of [side, side.clone().negate()]) {
        const q = at(i + 1);
        strut(i % 2 ? p.clone().add(s) : p.clone().add(s).add(up), i % 2 ? q.clone().add(s).add(up) : q.clone().add(s), 0.07);
      }
    }
    for (const g of parts) { tint(g, color, Math.min(a.y, b.y), h, LOOKS.steel.ao); this.add(LOOKS.steel.material, g); }
  }

  /** Steel ladder: two rails standing a metre past the landing as handholds, a rung every 30 cm. */
  private ladder(l: Ladder) {
    const [nx, nz] = LADDER_DIRS[l.dir], sx = -nz, sz = nx, out = -0.07;
    const at = (side: number, y: number) => new THREE.Vector3(l.x + nx * out + sx * side, y, l.z + nz * out + sz * side);
    const parts: THREE.BufferGeometry[] = [];
    for (const side of [-l.width / 2, l.width / 2]) {
      const p = at(side, l.y0);
      parts.push(boxGeo(p.x, (l.y0 + l.y1 + 1) / 2, p.z, 0.06, l.y1 + 1 - l.y0, 0.06, 0, 2));
    }
    for (let y = l.y0 + 0.3; y < l.y1 + 0.05; y += 0.3) {
      const c = at(0, y);
      parts.push(boxGeo(c.x, y, c.z, Math.abs(sx) * l.width + 0.04, 0.035, Math.abs(sz) * l.width + 0.04, 0, 2));
    }
    for (const g of parts) { tint(g, LADDER_GREY, l.y0, l.y1 - l.y0 + 1, 0.85); this.add(LOOKS.steel.material, g); }
  }

  private ramp(r: Ramp, style: RampStyle) {
    const w = r.maxX - r.minX, d = r.maxZ - r.minZ;
    const alongX = r.dir === 0 || r.dir === 2;
    const run = alongX ? w : d, width = alongX ? d : w;
    const rise = r.y1 - r.y0;
    if (style === 'stairs') {
      const steps = Math.max(2, Math.round(rise / 0.24));
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps, t1 = (i + 1) / steps;
        const top = r.y0 + rise * t1;
        const along = (t0 + t1) / 2 * run;
        const sign = r.dir === 0 || r.dir === 1 ? 1 : -1;
        const start = sign > 0 ? (alongX ? r.minX : r.minZ) : (alongX ? r.maxX : r.maxZ);
        const center = start + sign * along;
        const len = run / steps;
        const cx = alongX ? center : (r.minX + r.maxX) / 2, cz = alongX ? (r.minZ + r.maxZ) / 2 : center;
        const h = top - (r.y0 - 0.05);
        this.add('floor', boxGeo(cx, r.y0 - 0.05 + h / 2, cz, alongX ? len : width, h, alongX ? width : len));
      }
      // Side stringers follow the slope.
      const lowX = r.dir === 0 ? r.minX : r.dir === 2 ? r.maxX : 0, lowZ = r.dir === 1 ? r.minZ : r.dir === 3 ? r.maxZ : 0;
      const highX = r.dir === 0 ? r.maxX : r.dir === 2 ? r.minX : 0, highZ = r.dir === 1 ? r.maxZ : r.dir === 3 ? r.minZ : 0;
      for (const side of [-1, 1]) {
        const ox = alongX ? 0 : (side < 0 ? r.minX : r.maxX), oz = alongX ? (side < 0 ? r.minZ : r.maxZ) : 0;
        this.add('steelDark', beam(
          new THREE.Vector3(alongX ? lowX : ox, r.y0 + 0.1, alongX ? oz : lowZ),
          new THREE.Vector3(alongX ? highX : ox, r.y1 + 0.1, alongX ? oz : highZ), 0.12, 0.3));
      }
    } else {
      const len = Math.hypot(run, rise), roof = style === 'roof';
      const g = new THREE.BoxGeometry(alongX ? len : width, roof ? 0.08 : 0.2, alongX ? width : len);
      const angle = Math.atan2(rise, run);
      if (r.dir === 0) g.rotateZ(angle); else if (r.dir === 2) g.rotateZ(-angle); else if (r.dir === 1) g.rotateX(-angle); else g.rotateX(angle);
      g.translate((r.minX + r.maxX) / 2, r.y0 + rise / 2 - (roof ? 0.04 : 0.1), (r.minZ + r.maxZ) / 2);
      worldUV(g, roof ? LOOKS.roof.uv : 3);
      if (roof) tint(g, LOOKS.roof.color, r.y0, rise, 1);
      this.add(roof ? 'roof' : 'floor', g);
    }
  }

  private rail(x0: number, z0: number, x1: number, z1: number, y: number) {
    const len = Math.hypot(x1 - x0, z1 - z0), posts = Math.max(2, Math.round(len / 1.6) + 1);
    const angle = Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      this.add('steelDark', boxGeo(x0 + (x1 - x0) * t, y + 0.5, z0 + (z1 - z0) * t, 0.06, 1.0, 0.06));
    }
    for (const h of [0.55, 1.0]) {
      const g = new THREE.BoxGeometry(len, 0.05, 0.05);
      g.rotateY(-angle);
      g.translate((x0 + x1) / 2, y + h, (z0 + z1) / 2);
      worldUV(g, 2);
      this.add(h > 0.9 ? 'hazard' : 'steelDark', g);
    }
  }

  private prop(model: string, x: number, y: number, z: number, rotY: number, scale: number) {
    const source = this.assets.props.get(model);
    if (!source) { console.warn('missing prop', model); return; }
    const o = source.clone();
    o.position.set(x, y, z); o.rotation.y = rotY; o.scale.setScalar(scale);
    this.group.add(o);
  }

  /**
   * Decorative lights are emissive fixtures with a soft glow sprite, not real PointLights:
   * every dynamic light costs every lit pixel, so real lights are reserved for short-lived
   * muzzle and explosion flashes.
   */
  private light(x: number, y: number, z: number, color: number, intensity: number, distance: number) {
    const c = new THREE.Color(color);
    const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.18), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(3) }));
    fixture.position.set(x, y, z);
    this.group.add(fixture);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: c, transparent: true, opacity: Math.min(0.5, intensity * 0.06), blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.set(x, y, z); glow.scale.setScalar(distance * 0.35);
    this.group.add(glow);
  }

  private spawnPad(team: 0 | 1, x: number, y: number, z: number, rotY: number) {
    const color = TEAM_COLORS[team];
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.25, 48), this.materials.steelDark);
    pad.position.set(x, y + 0.05, z); pad.receiveShadow = true;
    this.group.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.8, 0.06, 8, 64), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2.5) }));
    ring.rotation.x = Math.PI / 2; ring.position.set(x, y + 0.2, z);
    this.group.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 6, 48, 1, true), new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(0.6), transparent: true, opacity: 0.12, side: THREE.FrontSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    beam.position.set(x, y + 3.2, z);
    this.group.add(beam);
    this.animated.push({ object: beam, update: t => { (beam.material as THREE.MeshBasicMaterial).opacity = 0.08 + Math.sin(t * 2) * 0.03; } });
    // Faction banner on the rear wall.
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(4, 5), new THREE.MeshStandardMaterial({ map: bannerTexture(team), emissive: color, emissiveIntensity: 0.25, side: THREE.DoubleSide }));
    banner.position.set(x - Math.sin(rotY) * -4.6, y + 3.6, z - Math.cos(rotY) * -4.6);
    banner.rotation.y = rotY;
    this.group.add(banner);
  }

  // ---- Vegetation, crystals and masts ------------------------------------------------------
  private tree(x: number, y: number, z: number, scale: number, variant: number) {
    const r = rng(Math.round(x * 31 + z * 17) >>> 0);
    const height = (variant === 1 ? 7.5 : 11) * scale;
    const trunk = new THREE.CylinderGeometry(0.22 * scale, 0.42 * scale, height * 0.75, 7);
    trunk.translate(x, y + height * 0.375 - 0.2, z);
    worldUV(trunk, 2);
    this.add('bark', trunk);
    const greens = this.theme.id === 'snow' ? [0x3c5a4e, 0x4a6658] : [0x2f6b3a, 0x3e7d3a, 0x4b8a46, 0x2b5f45];
    const colorize = (g: THREE.BufferGeometry, hex: number) => {
      const n = g.getAttribute('position').count, c = new Float32Array(n * 3), col = new THREE.Color(hex);
      for (let i = 0; i < n; i++) { const k = 0.8 + r() * 0.35; c.set([col.r * k, col.g * k, col.b * k], i * 3); }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      return g;
    };
    if (variant === 1) {
      // Broad alien canopy: clustered lumpy crowns.
      for (let i = 0; i < 4; i++) {
        const crown = new THREE.IcosahedronGeometry((1.8 + r() * 1.2) * scale, 1);
        crown.scale(1.2, 0.65, 1.2);
        crown.translate(x + (r() - 0.5) * 2.6 * scale, y + height * (0.72 + r() * 0.2), z + (r() - 0.5) * 2.6 * scale);
        this.add('leaves', colorize(nonIndexed(crown), greens[Math.floor(r() * greens.length)]));
      }
    } else {
      // Tall conifer: stacked tiers that taper upward.
      const tiers = variant === 2 ? 5 : 4;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const cone = new THREE.ConeGeometry((2.6 - t * 1.9) * scale, (3.2 - t * 0.8) * scale, 8);
        cone.rotateY(r() * 3);
        cone.translate(x, y + height * (0.3 + t * 0.62), z);
        this.add('leaves', colorize(nonIndexed(cone), greens[Math.floor(r() * greens.length)]));
      }
    }
  }

  private crystal(x: number, y: number, z: number, scale: number, rotY: number) {
    const r = rng(Math.round(x * 13 + z * 7) >>> 0);
    // Solid core filling the collision box (1.4 × 2.4 × 1.4 per scale), capped with a point; the
    // shards around it are decoration.
    const core = new THREE.CylinderGeometry(0.99 * scale, 0.99 * scale, 2.5 * scale, 4);
    core.rotateY(Math.PI / 4);
    core.translate(x, y - 0.1 + 1.25 * scale, z);
    this.add('crystal', nonIndexed(core));
    const cap = new THREE.CylinderGeometry(0, 0.99 * scale, 0.8 * scale, 4);
    cap.rotateY(Math.PI / 4);
    cap.translate(x, y + 2.4 * scale + 0.4 * scale, z);
    this.add('crystal', nonIndexed(cap));
    for (let i = 0; i < 5; i++) {
      const h = (1.4 + r() * 1.8) * scale;
      const shard = new THREE.CylinderGeometry(0, 0.32 * scale, h, 6);
      shard.translate(0, h / 2, 0);
      shard.rotateZ((r() - 0.5) * 0.9); shard.rotateX((r() - 0.5) * 0.9);
      shard.rotateY(rotY + r() * 6);
      shard.translate(x + (r() - 0.5) * 1.2 * scale, y - 0.1, z + (r() - 0.5) * 1.2 * scale);
      this.add('crystal', nonIndexed(shard));
    }
  }

  private mast(x: number, y: number, z: number, height: number) {
    for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) this.add('mast', boxGeo(x + dx, y + height / 2, z + dz, 0.08, height, 0.08));
    for (let h = 1.2; h < height; h += 1.4) {
      this.add('mast', boxGeo(x, y + h, z - 0.35, 0.78, 0.05, 0.05));
      this.add('mast', boxGeo(x, y + h, z + 0.35, 0.78, 0.05, 0.05));
      this.add('mast', boxGeo(x - 0.35, y + h + 0.7, z, 0.05, 0.05, 0.78));
      this.add('mast', boxGeo(x + 0.35, y + h + 0.7, z, 0.05, 0.05, 0.78));
    }
    this.add('mast', boxGeo(x, y + height + 1.2, z, 0.06, 2.4, 0.06));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3a2a).multiplyScalar(3) }));
    beacon.position.set(x, y + height + 2.5, z);
    this.group.add(beacon);
    this.animated.push({ object: beacon, update: t => { beacon.visible = Math.sin(t * 3 + x) > -0.2; } });
  }

  // ---- Dressing --------------------------------------------------------------------------
  private scatter() {
    const r = rng(91);
    const rocks: THREE.BufferGeometry[] = [];
    const b = this.map.bounds;
    for (let i = 0; i < 160; i++) {
      const x = (r() * 2 - 1) * (b.maxX + 60), z = (r() * 2 - 1) * (b.maxZ + 60);
      const inside = Math.abs(x) < b.maxX - 4 && Math.abs(z) < b.maxZ - 4;
      // Keep clutter off the lanes: inside the arena only small pebbles.
      const size = inside ? 0.25 + r() * 0.4 : 1.2 + r() * 4.5;
      if (inside && this.map.solids.some(s => x > s.minX - 2 && x < s.maxX + 2 && z > s.minZ - 2 && z < s.maxZ + 2)) continue;
      // Boulders are scenery past the bounds: one inside the play area would be cover without collision.
      if (!inside && Math.abs(x) < b.maxX + size && Math.abs(z) < b.maxZ + size) continue;
      const g = rockGeometry(Math.floor(r() * 1000), inside ? 1 : 2);
      g.scale(size * (0.8 + r() * 0.6), size * (0.5 + r() * 0.5), size * (0.8 + r() * 0.6));
      g.rotateY(r() * 6);
      // Lay it along the slope (tilted to the ground under its footprint) so it never juts out like a shelf.
      const reach = Math.max(1, size * 0.8), t = (dx: number, dz: number) => terrainHeight(this.map.terrain, x + dx, z + dz);
      const slope = new THREE.Vector3(t(-reach, 0) - t(reach, 0), 2 * reach, t(0, -reach) - t(0, reach)).normalize();
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), slope));
      g.translate(x, t(0, 0) - size * 0.08, z);
      worldUV(g, 2.5);
      rocks.push(g);
    }
    for (const g of rocks) this.add('rock', g);
    this.flush();
  }

  private horizon() {
    // A ring of distant mountains so the arena sits inside a landscape, not on a table.
    const segments = 160, rings = 6;
    const positions: number[] = [], indices: number[] = [];
    for (let j = 0; j <= rings; j++) for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2, t = j / rings;
      const radius = 260 + t * 240;
      const ridge = Math.max(0, fbm(Math.cos(a) * 3 + 11, Math.sin(a) * 3, 5, 5) + 0.35) * 110 * Math.sin(t * Math.PI) + 8;
      positions.push(Math.cos(a) * radius, ridge * (0.6 + t * 0.7) - 6, Math.sin(a) * radius);
      if (i < segments && j < rings) { const k = j * (segments + 1) + i; indices.push(k, k + segments + 1, k + 1, k + 1, k + segments + 1, k + segments + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setIndex(indices); g.computeVertexNormals();
    worldUV(g, 40);
    const mat = surfaceMaterial(this.assets, this.theme.rock, { color: this.theme.rockTint.clone().multiplyScalar(0.9).getHex(), normalScale: 1 });
    mat.vertexColors = false;
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = 'horizon';
    this.group.add(mesh);
  }
}

// ---- Geometry helpers -------------------------------------------------------------------

/** Smooth boulder: low-frequency displaced sphere with a flattened base, unit size, base at y=0. */
function rockGeometry(seed: number, detail = 3) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + fbm(v.x * 0.9 + seed * 0.37, v.z * 0.9 + v.y * 0.7, seed, 3) * 0.45;
    v.multiplyScalar(n);
    // Faceted strata: quantize slightly along a tilted axis.
    v.y = Math.max(v.y * 0.85, -0.55);
    p.setXYZ(i, v.x, (v.y + 0.55) / 1.55, v.z);
  }
  const ng = nonIndexed(g);
  ng.computeVertexNormals();
  return ng;
}

/** Weathered block filling a unit box (base at y=0): a rounded box whose erosion only cuts in a few percent. */
function rockBlockGeometry(seed: number) {
  const g = new RoundedBoxGeometry(1, 1, 1, 6, 0.16);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const broad = Math.abs(fbm(v.x * 2.2 + v.y * 1.3 + seed * 0.37, v.z * 2.2 - v.y * 1.1, seed, 3));
    const chips = Math.abs(fbm(v.x * 7 + v.y * 5 + seed, v.z * 7 - v.y * 4, seed + 5, 2));
    v.multiplyScalar(1 - broad * 0.09 - chips * 0.05);
    p.setXYZ(i, v.x, v.y + 0.5, v.z);
  }
  const ng = nonIndexed(g);
  ng.computeVertexNormals();
  return ng;
}

/**
 * Clipped hedge: a finely divided block whose faces are pushed in by up to 12 cm of noise (the
 * collision box is its outer envelope), mapped with leaf litter and mottled in greens.
 */
function hedgeGeometry(cx: number, y: number, cz: number, w: number, h: number, d: number, seed: number) {
  const cell = 0.3;
  const g = new THREE.BoxGeometry(w, h, d, Math.ceil(w / cell), Math.ceil(h / cell), Math.ceil(d / cell));
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  // Every copy of a shared corner moves identically (the shift depends only on position), so faces stay closed.
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), yy = p.getY(i), z = p.getZ(i);
    const inset = 0.02 + 0.1 * (0.5 + 0.5 * fbm((cx + x) * 1.7 + yy * 1.3, (cz + z) * 1.7 - yy, seed, 3));
    const on = (v: number, half: number) => (Math.abs(Math.abs(v) - half) < 1e-4 ? Math.sign(v) : 0);
    p.setXYZ(i, cx + x - on(x, w / 2) * inset, y + h / 2 + yy - (on(yy, h / 2) > 0 ? inset : 0), cz + z - on(z, d / 2) * inset);
  }
  const merged = mergeVertices(g.deleteAttribute('normal').deleteAttribute('uv'));
  merged.computeVertexNormals();
  worldUV(merged, 1.4);
  const r = rng(seed * 31 + 7), q = merged.getAttribute('position') as THREE.BufferAttribute, c = new Float32Array(q.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < q.count; i++) {
    col.setHSL(0.27 + r() * 0.04, 0.45, 0.38 + r() * 0.12 + (q.getY(i) - y) / h * 0.1);
    c.set([col.r, col.g, col.b], i * 3);
  }
  merged.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return merged;
}

/** Box spanning two points (thickness x height cross-section). */
function beam(a: THREE.Vector3, b: THREE.Vector3, thickness: number, height: number) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(thickness, height, len);
  const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0));
  g.applyMatrix4(m);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  worldUV(g, 3);
  return g;
}

function boxGeo(cx: number, cy: number, cz: number, w: number, h: number, d: number, bevel = 0, uvScale = 3) {
  const g = bevel > 0.01 ? new RoundedBoxGeometry(w, h, d, 2, bevel) : new THREE.BoxGeometry(w, h, d);
  g.translate(cx, cy, cz);
  worldUV(g, uvScale);
  return g;
}

/**
 * Box whose side faces map a horizontal band [v0, v1] of a trim sheet over their height and
 * repeat it every `period` metres; caps map to a flat spot of the sheet.
 */
function facadeBox(cx: number, y0: number, cz: number, w: number, h: number, d: number, band: [number, number], period: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, y0 + h / 2, cz);
  const p = g.getAttribute('position') as THREE.BufferAttribute, n = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const nx = n.getX(i), ny = n.getY(i);
    if (Math.abs(ny) > 0.5) { uv.setXY(i, 0.12 + (p.getX(i) / period) * 0.02, 0.4); continue; }
    const along = Math.abs(nx) > 0.5 ? p.getZ(i) : p.getX(i);
    const f = (p.getY(i) - y0) / h;
    uv.setXY(i, along / period, band[0] + (1 - f) * (band[1] - band[0]));
  }
  return g;
}

/** Clone a CC0 kit trim-sheet material for procedural architecture. */
function trimMaterial(assets: Assets, image: string, tint: number) {
  let found: THREE.MeshStandardMaterial | undefined;
  assets.props.forEach(root => root.traverse(o => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!found && m?.map?.name === image) found = m;
  }));
  const material = (found?.clone() ?? new THREE.MeshStandardMaterial()) as THREE.MeshStandardMaterial;
  for (const t of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap]) {
    if (t) { t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true; }
  }
  material.color = new THREE.Color(tint);
  material.vertexColors = true;
  // The kit's ORM metalness reads as near-black outdoors without local reflections.
  material.metalnessMap = null; material.metalness = 0.2;
  if (!found) console.warn('trim material missing', image);
  return material;
}

/** World-space box projection so textures keep a constant texel density. */
function worldUV(g: THREE.BufferGeometry, scale: number) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  g.computeVertexNormals();
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ay >= ax && ay >= az) { uv[i * 2] = x / scale; uv[i * 2 + 1] = z / scale; }
    else if (ax >= az) { uv[i * 2] = z / scale; uv[i * 2 + 1] = y / scale; }
    else { uv[i * 2] = x / scale; uv[i * 2 + 1] = y / scale; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/** Vertex-color ambient occlusion: darker toward the base of a block. */
function shade(g: THREE.BufferGeometry, base: number, height: number, floor: number) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, (p.getY(i) - base) / Math.max(1.2, height * 0.6));
    const v = floor + (1 - floor) * Math.sqrt(Math.max(0, t));
    c.set([v, v, v], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

function tint(g: THREE.BufferGeometry, hex: number, base: number, height: number, floor = 0.7) {
  shade(g, base, height, floor);
  const col = new THREE.Color(hex);
  const c = g.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * col.r, c.getY(i) * col.g, c.getZ(i) * col.b);
}

let glowTex: THREE.Texture | undefined;
function glowTexture() {
  if (glowTex) return glowTex;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.3, 'rgba(255,255,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(canvas);
  return glowTex;
}

function hazardTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1c1c1c'; ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#e0a420';
  for (let i = -128; i < 256; i += 32) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + 16, 0); ctx.lineTo(i + 16 + 128, 128); ctx.lineTo(i + 128, 128); ctx.closePath(); ctx.fill(); }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.repeat.set(2, 2);
  return tex;
}

function bannerTexture(team: 0 | 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 320;
  const ctx = canvas.getContext('2d')!;
  const main = team === 0 ? '#163a66' : '#5a1514', accent = team === 0 ? '#58b6ff' : '#ff5a4a';
  ctx.fillStyle = main; ctx.fillRect(0, 0, 256, 320);
  ctx.fillStyle = accent; ctx.fillRect(0, 0, 256, 18); ctx.fillRect(0, 302, 256, 18);
  ctx.strokeStyle = accent; ctx.lineWidth = 10;
  ctx.beginPath();
  if (team === 0) { ctx.moveTo(128, 70); ctx.lineTo(200, 120); ctx.lineTo(200, 200); ctx.lineTo(128, 250); ctx.lineTo(56, 200); ctx.lineTo(56, 120); ctx.closePath(); }
  else { ctx.moveTo(60, 80); ctx.lineTo(196, 80); ctx.lineTo(128, 240); ctx.closePath(); }
  ctx.stroke();
  ctx.fillStyle = accent; ctx.font = `bold 28px ${UI_STACK}`; ctx.textAlign = 'center';
  ctx.fillText(team === 0 ? 'AEGIS' : 'CRIMSON', 128, 290);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Polyhedra are already non-indexed; only expand geometries that share vertices. */
function nonIndexed(g: THREE.BufferGeometry) { return g.index ? g.toNonIndexed() : g; }

// ---- City buildings and signs ------------------------------------------------------------

/** Taipei 101's section outline: a square of half-size n, each corner stepped in twice by r (its sawtooth corners). */
function notchedSquare(n: number, r: number) {
  const quarter = [[n, n - 2 * r], [n - r, n - 2 * r], [n - r, n - r], [n - 2 * r, n - r], [n - 2 * r, n]];
  const out: number[][] = [];
  for (let k = 0; k < 4; k++) for (const [x, z] of quarter) {
    let a = x, b = z;
    for (let t = 0; t < k; t++) [a, b] = [-b, a];
    out.push([a, b]);
  }
  return out;
}

/** Vertex colours for a self-lit mesh: the colour pushed past white so bloom picks it up. */
function glowing(g: THREE.BufferGeometry, hex: number, strength = 2.2) {
  const n = g.getAttribute('position').count, c = new Float32Array(n * 3), col = new THREE.Color(hex).multiplyScalar(strength);
  for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** Curtain-wall sheet: 6 panels × 6 floors per tile, 1.5 m panels on 4 m floors. */
const CURTAIN_BAY = 1.5, CURTAIN_FLOOR = 4, CURTAIN_TILE = 6;

/**
 * Glass curtain wall: dark tinted panels that pick up the sky, slim mullions, a spandrel band at
 * every floor slab, and office floors lit warm or cool behind about a third of the panels.
 */
function curtainMaterial() {
  const size = 512, cell = size / CURTAIN_TILE;
  const wall = document.createElement('canvas'), lit = document.createElement('canvas');
  wall.width = wall.height = lit.width = lit.height = size;
  const c = wall.getContext('2d')!, e = lit.getContext('2d')!;
  const r = rng(11);
  e.fillStyle = '#000'; e.fillRect(0, 0, size, size);
  for (let fy = 0; fy < CURTAIN_TILE; fy++) {
    // A floor's offices are lit together, in runs, the way towers look at night.
    let run = 0, warm = true, on = false;
    for (let bx = 0; bx < CURTAIN_TILE; bx++) {
      if (run-- <= 0) { run = 1 + Math.floor(r() * 4); on = r() < 0.3; warm = r() < 0.75; }
      const x = bx * cell, y = fy * cell, shade = 0.75 + r() * 0.35;
      const g = c.createLinearGradient(x, y, x + cell, y + cell);
      g.addColorStop(0, `rgb(${70 * shade},${104 * shade},${118 * shade})`); g.addColorStop(1, `rgb(${30 * shade},${48 * shade},${60 * shade})`);
      c.fillStyle = g; c.fillRect(x, y, cell, cell);
      if (on) {
        e.fillStyle = warm ? '#ffd9a0' : '#d8ecff'; e.globalAlpha = 0.45 + r() * 0.5;
        e.fillRect(x + 3, y + cell * 0.22, cell - 6, cell * 0.74); e.globalAlpha = 1;
        c.fillStyle = 'rgba(255,230,190,0.25)'; c.fillRect(x + 3, y + cell * 0.22, cell - 6, cell * 0.74);
      }
      // Mullion, spandrel and the slab edge.
      c.fillStyle = '#9aa4a8'; c.fillRect(x, y, 3, cell);
      c.fillStyle = '#56636a'; c.fillRect(x, y, cell, cell * 0.2);
      c.fillStyle = '#b8c2c6'; c.fillRect(x, y + cell * 0.2 - 2, cell, 2);
    }
  }
  // Roofs and soffits map the sheet's corner (uv 0.003, 0.003): plain grey, unlit.
  c.fillStyle = '#6a6e70'; c.fillRect(0, size - 8, 8, 8);
  e.fillStyle = '#000'; e.fillRect(0, size - 8, 8, 8);
  const map = new THREE.CanvasTexture(wall), emissiveMap = new THREE.CanvasTexture(lit);
  for (const t of [map, emissiveMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
  return new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.18, metalness: 0.55, vertexColors: true });
}

/** Window grid of the facade sheet: 4 bays × 4 floors per tile. */
const BAY = 3.1, FLOOR = 3.2, TILE_BAYS = 4, TILE_FLOORS = 4;
/** Height of a street-level shopfront storey and the width its sheet repeats over. */
const SHOPFRONT = 4.2, SHOP_BAY = 7.5;

/**
 * Box whose walls map the window grid (one cell per bay and floor, counted from its base) and
 * whose roof and underside map a plain corner of the sheet.
 */
function windowBox(cx: number, y0: number, cz: number, w: number, h: number, d: number, tileW = BAY * TILE_BAYS, tileH = FLOOR * TILE_FLOORS) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(cx, y0 + h / 2, cz);
  const p = g.getAttribute('position') as THREE.BufferAttribute, n = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(n.getY(i)) > 0.5) { uv.setXY(i, 0.003, 0.003); continue; }
    const along = Math.abs(n.getX(i)) > 0.5 ? p.getZ(i) * -Math.sign(n.getX(i)) : p.getX(i) * Math.sign(n.getZ(i));
    uv.setXY(i, along / tileW, (p.getY(i) - y0) / tileH);
  }
  return g;
}

/**
 * Procedural facade sheet: plaster wall (tinted per building) with windows, many behind the iron
 * window cages (鐵窗) and air-conditioner boxes of Taipei walk-ups; an emissive twin lights a third of them.
 */
function facadeMaterial() {
  const size = 512, cell = size / TILE_BAYS, rowH = size / TILE_FLOORS;
  const wall = document.createElement('canvas'), lit = document.createElement('canvas');
  wall.width = wall.height = lit.width = lit.height = size;
  const c = wall.getContext('2d')!, e = lit.getContext('2d')!;
  const r = rng(7);
  c.fillStyle = '#ece8e0'; c.fillRect(0, 0, size, size);
  for (let i = 0; i < 1800; i++) { c.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + r() * 0.04})`; c.fillRect(r() * size, r() * size, 2 + r() * 6, 2 + r() * 6); }
  e.fillStyle = '#000'; e.fillRect(0, 0, size, size);
  for (let fy = 0; fy < TILE_FLOORS; fy++) for (let bx = 0; bx < TILE_BAYS; bx++) {
    const x = bx * cell + cell * 0.22, y = fy * rowH + rowH * 0.2, w = cell * 0.56, h = rowH * 0.52;
    const glass = c.createLinearGradient(x, y, x + w, y + h);
    glass.addColorStop(0, '#3a4a5c'); glass.addColorStop(0.55, '#1c2430'); glass.addColorStop(1, '#2c3644');
    c.fillStyle = '#9a968e'; c.fillRect(x - 4, y - 4, w + 8, h + 10);
    c.fillStyle = glass; c.fillRect(x, y, w, h);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x + w / 2 - 1, y, 2, h);
    if (r() < 0.36) {
      e.fillStyle = r() < 0.7 ? '#ffcf8a' : '#cfe6ff';
      e.globalAlpha = 0.55 + r() * 0.45; e.fillRect(x + 2, y + 2, w - 4, h - 4); e.globalAlpha = 1;
      c.fillStyle = 'rgba(255,214,150,0.35)'; c.fillRect(x, y, w, h);
    }
    if (r() < 0.45) {
      // Iron window cage: a frame standing proud of the wall with vertical bars.
      c.strokeStyle = '#4a4e52'; c.lineWidth = 3; c.strokeRect(x - 6, y - 6, w + 12, h + 12);
      c.lineWidth = 2;
      for (let k = x; k < x + w; k += 9) { c.beginPath(); c.moveTo(k, y - 6); c.lineTo(k, y + h + 6); c.stroke(); }
    }
    if (r() < 0.4) { c.fillStyle = '#d8d8d2'; c.fillRect(x + w - 34, y + h + 4, 30, 16); c.fillStyle = '#8a8a86'; c.fillRect(x + w - 30, y + h + 8, 22, 8); }
  }
  const map = new THREE.CanvasTexture(wall), emissiveMap = new THREE.CanvasTexture(lit);
  for (const t of [map, emissiveMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
  return new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.88, vertexColors: true });
}

/** Street-level shopfronts: lit glass between piers, a fascia above, some shops behind roller shutters. */
function shopfrontMaterial() {
  const W = 512, H = 288;
  const wall = document.createElement('canvas'), lit = document.createElement('canvas');
  wall.width = lit.width = W; wall.height = lit.height = H;
  const c = wall.getContext('2d')!, e = lit.getContext('2d')!;
  c.fillStyle = '#dcd8d0'; c.fillRect(0, 0, W, H);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const fascia = H * (1 - 3.2 / SHOPFRONT);
  c.fillStyle = '#3a3a3e'; c.fillRect(0, 0, W, fascia);
  const units = [[8, 250, false], [262, 242, true]] as const;
  for (const [x, w, shutter] of units) {
    if (shutter) {
      c.fillStyle = '#9ea2a6'; c.fillRect(x, fascia + 8, w, H - fascia - 8);
      c.fillStyle = '#7e8286'; for (let y = fascia + 12; y < H; y += 7) c.fillRect(x, y, w, 2);
      continue;
    }
    const g = c.createLinearGradient(0, fascia, 0, H);
    g.addColorStop(0, '#fff0c8'); g.addColorStop(1, '#c8a878');
    c.fillStyle = g; c.fillRect(x, fascia + 8, w, H - fascia - 8);
    c.fillStyle = 'rgba(40,30,20,0.55)';
    for (let k = 0; k < 5; k++) c.fillRect(x + 14 + k * 46, fascia + 40 + (k % 2) * 20, 30, H - fascia - 70);
    c.fillStyle = '#2a2a2e'; c.fillRect(x + w / 2 - 2, fascia + 8, 4, H - fascia - 8);
    e.fillStyle = '#ffe2b0'; e.globalAlpha = 0.8; e.fillRect(x, fascia + 8, w, H - fascia - 8); e.globalAlpha = 1;
  }
  const map = new THREE.CanvasTexture(wall), emissiveMap = new THREE.CanvasTexture(lit);
  for (const t of [map, emissiveMap]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; }
  return new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.7, roughness: 0.5, vertexColors: true });
}

type SignDecor = Extract<Decor, { kind: 'sign' }>;
const SIGN_FONT = CJK_STACK;

/**
 * Every sign of the map in one draw: each sign is painted once into a shared canvas atlas (text,
 * colours, bulbs) that also lights it as its emissive map, so the neon reads at dusk. Blades show
 * the art on both faces; billboards and the gateway get a dark back.
 */
function signMesh(signs: SignDecor[]) {
  const faces: { s: SignDecor; facing: number; out: number; back: boolean }[] = [];
  for (const s of signs) {
    if (s.style === 'blade') { faces.push({ s, facing: s.rotY + Math.PI / 2, out: 0, back: false }, { s, facing: s.rotY - Math.PI / 2, out: 0, back: false }); continue; }
    faces.push({ s, facing: s.rotY, out: 0, back: false });
    if (s.style === 'billboard' || s.style === 'gate') faces.push({ s, facing: s.rotY + Math.PI, out: 0.04, back: true });
  }
  // One cell per sign, packed on shelves of a 2048-wide atlas; a small dark cell for the backs.
  const W = 2048, cells = new Map<SignDecor, { x: number; y: number; w: number; h: number }>();
  const dark = { x: 0, y: 0, w: 8, h: 8 };
  let x = 10, y = 0, shelf = 8;
  for (const s of signs) {
    const ppm = Math.min(1000 / Math.max(s.w, s.h), Math.max(64, 90 / Math.min(s.w, s.h)));
    const w = Math.max(8, Math.round(s.w * ppm)), h = Math.max(8, Math.round(s.h * ppm));
    if (x + w > W) { x = 0; y += shelf + 2; shelf = 0; }
    cells.set(s, { x, y, w, h });
    x += w + 2; shelf = Math.max(shelf, h);
  }
  const H = THREE.MathUtils.ceilPowerOfTwo(y + shelf + 2);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#121212'; c.fillRect(dark.x, dark.y, dark.w, dark.h);
  for (const s of signs) drawSign(c, s, cells.get(s)!);

  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (const f of faces) {
    const s = f.s, cell = f.back ? dark : cells.get(s)!;
    // Outward normal of the face and its right-hand direction as seen from the front.
    const nx = Math.sin(f.facing), nz = -Math.cos(f.facing), rx = -Math.cos(f.facing), rz = -Math.sin(f.facing);
    const cx = s.x + nx * f.out, cz = s.z + nz * f.out, hw = s.w / 2, hh = s.h / 2;
    const u0 = cell.x / W, u1 = (cell.x + cell.w) / W, v0 = 1 - (cell.y + cell.h) / H, v1 = 1 - cell.y / H;
    const corner = (sx: number, sy: number, u: number, v: number) => { pos.push(cx + rx * hw * sx, s.y + hh * sy, cz + rz * hw * sx); nor.push(nx, 0, nz); uv.push(u, v); };
    corner(-1, -1, u0, v0); corner(1, -1, u1, v0); corner(1, 1, u1, v1);
    corner(-1, -1, u0, v0); corner(1, 1, u1, v1); corner(-1, 1, u0, v1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.6 }));
  mesh.name = 'level:signs';
  return mesh;
}

/** Bold text centred at (cx, cy): `size` px, shrunk until it fits maxW. */
function fitText(c: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxW: number, size: number) {
  let px = Math.max(6, Math.floor(size));
  c.font = `900 ${px}px ${SIGN_FONT}`;
  const w = c.measureText(text).width;
  if (w > maxW) { px = Math.max(6, Math.floor(px * maxW / w)); c.font = `900 ${px}px ${SIGN_FONT}`; }
  c.fillText(text, cx, cy);
}

function drawSign(c: CanvasRenderingContext2D, s: SignDecor, r: { x: number; y: number; w: number; h: number }) {
  c.save();
  c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.clip();
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const cx = r.x + r.w / 2;
  switch (s.style) {
    case 'blade': {
      c.fillStyle = s.bg; c.fillRect(r.x, r.y, r.w, r.h);
      const line = Math.max(2, r.w * 0.06);
      c.strokeStyle = s.fg; c.lineWidth = line; c.strokeRect(r.x + line, r.y + line, r.w - 2 * line, r.h - 2 * line);
      // Characters stacked top to bottom, the way Taipei's vertical signs read.
      const chars = [...s.text], step = (r.h * 0.9) / chars.length, size = Math.min(r.w * 0.72, step * 0.9);
      c.fillStyle = s.fg; c.shadowColor = s.fg; c.shadowBlur = size * 0.25;
      chars.forEach((ch, i) => fitText(c, ch, cx, r.y + r.h * 0.05 + step * (i + 0.5), r.w * 0.8, size));
      break;
    }
    case 'screen': {
      const g = c.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
      g.addColorStop(0, '#1a2a6a'); g.addColorStop(0.5, '#c82a8a'); g.addColorStop(1, '#2ac8d8');
      c.fillStyle = g; c.fillRect(r.x, r.y, r.w, r.h);
      c.fillStyle = 'rgba(0,0,0,0.25)';
      for (let yy = r.y; yy < r.y + r.h; yy += 4) c.fillRect(r.x, yy, r.w, 1);
      break;
    }
    case 'marquee': {
      c.fillStyle = s.bg; c.fillRect(r.x, r.y, r.w, r.h);
      c.fillStyle = s.fg;
      const n = Math.max(4, Math.round(r.w / (r.h * 0.5)));
      for (let i = 0; i < n; i++) for (const yy of [0.3, 0.7]) { c.beginPath(); c.arc(r.x + (i + 0.5) * r.w / n, r.y + r.h * yy, r.h * 0.11, 0, Math.PI * 2); c.fill(); }
      break;
    }
    case 'billboard': case 'gate': {
      const g = c.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      g.addColorStop(0, s.bg); g.addColorStop(1, `#${new THREE.Color(s.bg).multiplyScalar(0.7).getHexString()}`);
      c.fillStyle = g; c.fillRect(r.x, r.y, r.w, r.h);
      if (s.style === 'gate') { const line = r.h * 0.06; c.strokeStyle = '#ffd24a'; c.lineWidth = line; c.strokeRect(r.x + line, r.y + line, r.w - 2 * line, r.h - 2 * line); }
      c.fillStyle = s.fg;
      fitText(c, s.text, cx, r.y + r.h * (s.sub ? 0.4 : 0.5), r.w * 0.9, r.h * (s.sub ? 0.5 : 0.7));
      if (s.sub) { c.fillStyle = s.style === 'gate' ? '#ffd24a' : s.fg; fitText(c, s.sub, cx, r.y + r.h * 0.8, r.w * 0.9, r.h * 0.2); }
      break;
    }
    default: {
      c.fillStyle = s.bg; c.fillRect(r.x, r.y, r.w, r.h);
      c.fillStyle = s.fg;
      fitText(c, s.text, cx, r.y + r.h * (s.sub ? 0.38 : 0.5), r.w * 0.92, r.h * (s.sub ? 0.5 : 0.72));
      if (s.sub) fitText(c, s.sub, cx, r.y + r.h * 0.8, r.w * 0.92, r.h * 0.22);
    }
  }
  c.restore();
}
