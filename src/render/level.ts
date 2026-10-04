import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Assets } from '../assets';
import { terrainHeight, type Ramp, type Solid } from '../../shared/collision';
import { fbm } from '../../shared/maps/builder';
import type { BlockStyle, MapDef } from '../../shared/maps/types';
import { rng } from '../../shared/math';
import { shieldMaterial, surfaceMaterial, terrainMaterial, type Theme } from './materials';
import { ReactorView } from './reactor';

const TEAM_COLORS = [new THREE.Color(0x3aa0ff), new THREE.Color(0xff4a3a)];

/** Static battlefield visuals built from shared map data (collision stays authoritative). */
export class LevelView {
  readonly group = new THREE.Group();
  readonly shields: THREE.ShaderMaterial[] = [];
  readonly reactor?: ReactorView;
  private parts = new Map<string, THREE.BufferGeometry[]>();
  private materials: Record<string, THREE.Material>;
  private animated: { object: THREE.Object3D; update: (t: number) => void }[] = [];

  constructor(private assets: Assets, private map: MapDef, private theme: Theme) {
    this.materials = {
      steel: surfaceMaterial(assets, 'concrete', { color: 0xb9c2c8, metalness: 0.12, roughness: 0.85, normalScale: 0.6 }),
      steelDark: surfaceMaterial(assets, 'metalplate', { color: 0x6c757c, metalness: 0.35, normalScale: 0.6 }),
      floor: surfaceMaterial(assets, 'metalplate', { color: 0xb3b9be, metalness: 0.3 }),
      concrete: trimMaterial(assets, 'T_Trim_03_BaseColor', 0xd8d2c8),
      container: surfaceMaterial(assets, 'container', { metalness: 0.3, roughness: 0.75 }),
      rock: surfaceMaterial(assets, theme.rock, { color: theme.rockTint.getHex(), normalScale: 1.2 }),
      hazard: new THREE.MeshStandardMaterial({ map: hazardTexture(), roughness: 0.6, metalness: 0.2 }),
      bark: new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.95, vertexColors: true }),
      leaves: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true, vertexColors: true }),
      crystal: new THREE.MeshStandardMaterial({ color: 0x1b3a52, emissive: 0x5fd6ff, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.3, flatShading: true, vertexColors: true }),
      mast: new THREE.MeshStandardMaterial({ color: 0x5b636a, roughness: 0.6, metalness: 0.5, vertexColors: true }),
      glow: new THREE.MeshStandardMaterial({ color: 0x0a1416, emissive: 0x7ff6ff, emissiveIntensity: 2.4 }),
      glowWarm: new THREE.MeshStandardMaterial({ color: 0x160e06, emissive: 0xffb45a, emissiveIntensity: 2.2 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x6fa8c8, roughness: 0.05, metalness: 0.9, transparent: true, opacity: 0.35 }),
      panel: trimMaterial(assets, 'T_Trim_02_BaseColor', 0xd4dade),
      panelDark: trimMaterial(assets, 'T_Trim_01_BaseColor', 0xa8b0b6),
    };
    this.buildTerrain();
    map.decor.forEach(d => {
      switch (d.kind) {
        case 'block': this.block(map.solids[d.solid], d.style, d.solid); break;
        case 'ramp': this.ramp(map.ramps[d.ramp], d.style); break;
        case 'prop': this.prop(d.model, d.x, d.y, d.z, d.rotY, d.scale ?? 1); break;
        case 'light': this.light(d.x, d.y, d.z, d.color, d.intensity, d.distance); break;
        case 'rail': this.rail(d.x0, d.z0, d.x1, d.z1, d.y); break;
        case 'reactor': (this as { reactor?: ReactorView }).reactor = new ReactorView(d.x, d.y, d.z); this.group.add(this.reactor!.group); break;
        case 'spawnPad': this.spawnPad(d.team, d.x, d.y, d.z, d.rotY); break;
        case 'tree': this.tree(d.x, d.y, d.z, d.scale, d.variant); break;
        case 'crystal': this.crystal(d.x, d.y, d.z, d.scale, d.rotY); break;
        case 'mast': this.mast(d.x, d.y, d.z, d.height); break;
        default: break;
      }
    });
    this.flush();
    this.scatter();
    this.horizon();
  }

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
      mesh.castShadow = name !== 'glow' && name !== 'glowWarm' && name !== 'glass';
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
  private block(s: Solid, style: BlockStyle, index: number) {
    const w = s.maxX - s.minX, h = s.maxY - s.minY, d = s.maxZ - s.minZ;
    const cx = (s.minX + s.maxX) / 2, cy = (s.minY + s.maxY) / 2, cz = (s.minZ + s.maxZ) / 2;
    const r = rng(index * 977 + 13);
    switch (style) {
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
    const geo = rockGeometry(Math.floor(r() * 1000));
    geo.scale(w * 0.62, h * 1.08, d * 0.62);
    geo.translate((s.minX + s.maxX) / 2, s.minY - 0.15, (s.minZ + s.maxZ) / 2);
    worldUV(geo, 2.5);
    this.add('rock', geo);
  }

  private ramp(r: Ramp, style: 'stairs' | 'ramp') {
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
      const len = Math.hypot(run, rise);
      const g = new THREE.BoxGeometry(alongX ? len : width, 0.2, alongX ? width : len);
      const angle = Math.atan2(rise, run);
      if (r.dir === 0) g.rotateZ(angle); else if (r.dir === 2) g.rotateZ(-angle); else if (r.dir === 1) g.rotateX(-angle); else g.rotateX(angle);
      g.translate((r.minX + r.maxX) / 2, r.y0 + rise / 2 - 0.1, (r.minZ + r.maxZ) / 2);
      worldUV(g, 3);
      this.add('floor', g);
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
   * every dynamic light costs every lit pixel, so real lights are reserved for the reactor
   * and short-lived muzzle/explosion flashes.
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
        this.add('leaves', colorize(crown.toNonIndexed(), greens[Math.floor(r() * greens.length)]));
      }
    } else {
      // Tall conifer: stacked tiers that taper upward.
      const tiers = variant === 2 ? 5 : 4;
      for (let i = 0; i < tiers; i++) {
        const t = i / tiers;
        const cone = new THREE.ConeGeometry((2.6 - t * 1.9) * scale, (3.2 - t * 0.8) * scale, 8);
        cone.rotateY(r() * 3);
        cone.translate(x, y + height * (0.3 + t * 0.62), z);
        this.add('leaves', colorize(cone.toNonIndexed(), greens[Math.floor(r() * greens.length)]));
      }
    }
  }

  private crystal(x: number, y: number, z: number, scale: number, rotY: number) {
    const r = rng(Math.round(x * 13 + z * 7) >>> 0);
    for (let i = 0; i < 5; i++) {
      const h = (1.4 + r() * 1.8) * scale;
      const shard = new THREE.CylinderGeometry(0, 0.32 * scale, h, 6);
      shard.translate(0, h / 2, 0);
      shard.rotateZ((r() - 0.5) * 0.9); shard.rotateX((r() - 0.5) * 0.9);
      shard.rotateY(rotY + r() * 6);
      shard.translate(x + (r() - 0.5) * 1.2 * scale, y - 0.1, z + (r() - 0.5) * 1.2 * scale);
      this.add('crystal', shard.toNonIndexed());
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
      const g = rockGeometry(Math.floor(r() * 1000), inside ? 1 : 2);
      g.scale(size * (0.8 + r() * 0.6), size * (0.5 + r() * 0.5), size * (0.8 + r() * 0.6));
      g.rotateY(r() * 6);
      g.translate(x, terrainHeight(this.map.terrain, x, z) + size * 0.15, z);
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
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
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

function tint(g: THREE.BufferGeometry, hex: number, base: number, height: number) {
  shade(g, base, height, 0.7);
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
  ctx.fillStyle = accent; ctx.font = 'bold 28px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(team === 0 ? 'AEGIS' : 'CRIMSON', 128, 290);
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
