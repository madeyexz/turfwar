import * as THREE from 'three';
import type { Simulation, Vec } from './physics';
import { SlowLight } from './slow-light';
import { groundHeight, maps, terrainData, type BattleMap } from './battlefield';
import type { Player } from './player';

export class ArenaView {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .05, 700);
  scenery = new THREE.Group();
  meshes = new Map<number, THREE.Group>();
  trails = new Map<number, { line: THREE.Line; points: THREE.Vector3[]; age: number }>();
  droneGeometry = new THREE.BoxGeometry(.8, .35, .6);
  wingGeometry = new THREE.BoxGeometry(.65, .08, .38);
  debrisGeometry = new THREE.IcosahedronGeometry(.15);
  shotGeometry = new THREE.SphereGeometry(.075, 6, 4);
  armorMaterial = new THREE.MeshStandardMaterial({ color: 0x42494b, metalness: .6, roughness: .5 });
  droneMaterial = new THREE.MeshStandardMaterial({ color: 0xa53f31, emissive: 0xc12714, emissiveIntensity: .35, metalness: .6, roughness: .4 });
  debrisMaterial = new THREE.MeshStandardMaterial({ color: 0x9ba7a5 });
  shotMaterial = new THREE.MeshBasicMaterial({ color: 0xa4ffff });
  enemyMaterial = new THREE.MeshBasicMaterial({ color: 0xff5033 });
  slowLight = new SlowLight();
  velocity = new THREE.Vector3();
  weapon = new THREE.Group();
  muzzle = new THREE.Mesh(new THREE.IcosahedronGeometry(.12), new THREE.MeshBasicMaterial({ color: 0xb9ffff }));
  recoil = 0;
  bob = 0;
  frame = 0;
  particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
  particleGeometry = new THREE.BoxGeometry(.07, .07, .07);

  constructor(container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    container.prepend(this.renderer.domElement);
    this.camera.rotation.order = 'YXZ'; this.scene.add(this.camera, this.scenery);
    this.scene.add(new THREE.HemisphereLight(0xc8e4ed, 0x65503e, 2.1));
    const sun = new THREE.DirectionalLight(0xffd4a1, 3.2); sun.position.set(-60, 90, 45); this.scene.add(sun);
    const weaponLight = new THREE.PointLight(0xb9e3e4, 2, 2); weaponLight.position.set(.3, .4, 0); this.camera.add(weaponLight);
    this.buildWeapon(); this.setMap(maps[0]);
    window.addEventListener('resize', () => this.resize());
  }

  buildWeapon() {
    const shell = new THREE.MeshStandardMaterial({ color: 0x61777b, roughness: .6, metalness: .15 });
    const black = new THREE.MeshStandardMaterial({ color: 0x27393d, roughness: .65, metalness: .1 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x9bb4b6, roughness: .5, metalness: .2 });
    const cyan = new THREE.MeshBasicMaterial({ color: 0x63d9d7 });
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, material = shell) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); this.weapon.add(mesh); return mesh;
    };
    box(0, 0, 0, .19, .18, .47); box(0, -.035, .28, .14, .13, .21, black);
    box(0, .025, -.35, .13, .13, .3, black); box(0, .025, -.55, .065, .07, .14, trim);
    box(0, .115, -.16, .06, .045, .5, black);
    box(0, -.15, .06, .085, .24, .11, black).rotation.x = -.25;
    box(0, -.15, -.12, .095, .21, .14, trim).rotation.x = .13;
    for (let i = 0; i < 5; i++) box(.071, .04, -.22 - i * .045, .012, .07, .022, trim);
    // Open reflex optic. Its center remains clear when aiming.
    box(-.051, .2, -.22, .018, .12, .035, black); box(.051, .2, -.22, .018, .12, .035, black);
    box(0, .26, -.22, .12, .018, .035, black);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(.006, .025, .16), cyan); stripe.position.set(.097, .03, 0); this.weapon.add(stripe);
    const glove = new THREE.MeshStandardMaterial({ color: 0x2e3b3d, roughness: .95 });
    box(.07, -.15, .18, .12, .16, .25, glove).rotation.z = -.2;
    box(-.12, -.12, -.28, .14, .12, .22, glove).rotation.z = .3;
    const arm = box(-.21, -.23, -.03, .12, .15, .46, black); arm.rotation.y = -.35;
    this.muzzle.position.set(0, .025, -.65); this.muzzle.visible = false; this.weapon.add(this.muzzle);
    this.weapon.position.set(.32, -.28, -.5); this.weapon.visible = false; this.camera.add(this.weapon);
  }

  setMap(map: BattleMap) {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.scenery.traverse(object => { if (object instanceof THREE.Mesh) { geometries.add(object.geometry); for (const m of Array.isArray(object.material) ? object.material : [object.material]) materials.add(m); } });
    geometries.forEach(g => g.dispose()); materials.forEach(m => { if ('map' in m && m.map instanceof THREE.Texture) m.map.dispose(); m.dispose(); });
    this.scenery.clear();
    this.scene.background = new THREE.Color(map.sky); this.scene.fog = new THREE.Fog(map.fog, 65, 230);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const concrete = new THREE.MeshStandardMaterial({ color: 0x697574, roughness: .87 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x303c40, roughness: .7, metalness: .5 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9baba8, roughness: .45, metalness: .55 });
    const accent = new THREE.MeshBasicMaterial({ color: map.accent });
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, material: THREE.Material) => {
      const mesh = new THREE.Mesh(boxGeo, material); mesh.position.set(x, y, z); mesh.scale.set(w, h, d); this.scenery.add(mesh); return mesh;
    };
    const data = terrainData(map), terrain = new THREE.BufferGeometry();
    terrain.setAttribute('position', new THREE.BufferAttribute(data.vertices, 3)); terrain.setIndex(new THREE.BufferAttribute(data.indices, 1)); terrain.computeVertexNormals();
    const colors = new Float32Array(data.vertices.length), base = new THREE.Color(map.ground);
    for (let i = 0; i < data.vertices.length; i += 3) {
      const x = data.vertices[i], z = data.vertices[i + 2];
      const shade = .88 + .1 * Math.sin(x * 2.3 + z * 7.7) + .05 * Math.cos(z * 1.3);
      const c = base.clone().multiplyScalar(shade); colors.set([c.r, c.g, c.b], i);
    }
    terrain.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.scenery.add(new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));
    // Terrain-conforming road panels avoid floating slabs on uneven ground.
    for (let z = -32; z < 42; z += 4) {
      const road = new THREE.PlaneGeometry(9, 3.85, 8, 4); road.rotateX(-Math.PI / 2);
      const positions = road.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), pz = positions.getZ(i) + z;
        positions.setXYZ(i, x, groundHeight(x, pz, map) + .055, pz);
      }
      road.computeVertexNormals(); this.scenery.add(new THREE.Mesh(road, dark));
    }
    const apron = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, .12, 48), concrete); apron.position.y = -3.22; this.scenery.add(apron);
    for (const [i, b] of map.structures.entries()) {
      const top = -3.25 + b.h;
      box(b.x, -3.25 + b.h / 2, b.z, b.w, b.h, b.d, concrete);
      box(b.x, top + .18, b.z, b.w + .6, .36, b.d + .6, dark);
      if (b.role === 'cover') {
        box(b.x, top - .2, b.z + b.d / 2 + .02, b.w * .7, .15, .03, accent); continue;
      }
      if (b.role === 'wall') continue;
      // Armored ribs, recessed door facades, roof railings and faction strips.
      for (const side of [-1, 1]) {
        box(b.x + side * (b.w / 2 - .6), top - b.h / 2, b.z + b.d / 2 + .15, .8, b.h, .55, dark);
        box(b.x + side * (b.w / 2 + .04), top - 1.1, b.z, .1, .5, b.d * .75, accent);
      }
      box(b.x, -1.55, b.z + b.d / 2 + .02, 2.8, 3.4, .08, dark);
      box(b.x, .2, b.z + b.d / 2 + .1, 3, .13, .12, accent);
      for (let j = -1; j <= 1; j++) box(b.x + j * b.w / 3, top - 1.8, b.z + b.d / 2 + .03, 1.7, .65, .07, dark);
      for (const side of [-1, 1]) box(b.x, top + .8, b.z + side * b.d / 2, b.w, .12, .12, metal);
      if (b.role === 'tower') {
        box(b.x, top + 2, b.z, b.w * .65, 3.4, b.d * .65, dark);
        box(b.x, top + 3.4, b.z + b.d * .326, b.w * .6, .3, .1, accent);
        box(b.x, top + 7, b.z, .3, 10, .3, metal);
        for (let j = 0; j < 3; j++) box(b.x, top + 6 + j * 1.5, b.z, 3.5 - j * .5, .1, .1, metal);
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(.22, 8, 6), accent); beacon.position.set(b.x, top + 12, b.z); this.scenery.add(beacon);
      }
      const sign = document.createElement('canvas'); sign.width = 256; sign.height = 128;
      const ctx = sign.getContext('2d')!; ctx.fillStyle = '#25363c'; ctx.fillRect(0, 0, 256, 128); ctx.fillStyle = '#bfd6d3'; ctx.font = 'bold 74px sans-serif'; ctx.fillText(`0${i + 1}`, 22, 90);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 1.25), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sign) }));
      panel.position.set(b.x + b.w * .25, top - 3.3, b.z + b.d / 2 + .04); this.scenery.add(panel);
    }
    if (map === maps[0]) { box(0, 5.9, 3, 32, 1.5, 3, dark); box(0, 5.25, 4.52, 29, .12, .06, accent); }
    // Gravity anomaly: the original central force now lives in a military reactor.
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 1), new THREE.MeshStandardMaterial({ color: map.accent, emissive: map.accent, emissiveIntensity: 1.2, wireframe: true })); this.scenery.add(core);
    for (const y of [-2, 2]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(2.1, .18, 6, 48), dark); ring.rotation.x = Math.PI / 2; ring.position.y = y; this.scenery.add(ring); }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.1, .1, 90, 8), new THREE.MeshBasicMaterial({ color: map.accent, transparent: true, opacity: .45, depthWrite: false })); beam.position.y = 42; this.scenery.add(beam);
    // Instanced horizon geology keeps the landscape cheap to render.
    let seed = map.seed;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const rockGeo = new THREE.CylinderGeometry(.6, 1, 1, 5, 2);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: map.rock, roughness: 1, flatShading: true }), 90);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 90; i++) {
      const angle = rand() * Math.PI * 2, radius = 86 + rand() * 100;
      const h = 10 + rand() * 45;
      dummy.position.set(Math.cos(angle) * radius, h / 2 - 7, Math.sin(angle) * radius);
      dummy.scale.set(8 + rand() * 16, h, 8 + rand() * 17); dummy.rotation.set(0, rand() * 7, (rand() - .5) * .15); dummy.updateMatrix(); rocks.setMatrixAt(i, dummy.matrix);
    }
    this.scenery.add(rocks);
    // Small ground dressing is intentionally non-blocking; all large base cover is solid.
    const rubble = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: map.rock, roughness: 1 }), 200);
    for (let i = 0; i < 200; i++) {
      const x = (rand() - .5) * 155, z = (rand() - .5) * 155, s = .15 + rand() * .45;
      dummy.position.set(x, groundHeight(x, z, map) - .08, z); dummy.scale.set(s * 1.5, s, s); dummy.rotation.set(rand(), rand() * 7, rand()); dummy.updateMatrix(); rubble.setMatrixAt(i, dummy.matrix);
    }
    this.scenery.add(rubble);
    if (map === maps[2]) {
      const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 11, 6), new THREE.MeshStandardMaterial({ color: 0x345d53, flatShading: true }), 90);
      for (let i = 0; i < 90; i++) {
        const a = rand() * Math.PI * 2, r = 52 + rand() * 28, x = Math.cos(a) * r, z = Math.sin(a) * r;
        dummy.position.set(x, groundHeight(x, z, map) + 3, z); dummy.scale.setScalar(.8 + rand()); dummy.rotation.set(0, rand() * 7, 0); dummy.updateMatrix(); trees.setMatrixAt(i, dummy.matrix);
      }
      this.scenery.add(trees);
    }
    const moon = new THREE.Mesh(new THREE.SphereGeometry(36, 32, 20), new THREE.MeshBasicMaterial({ color: 0xe0d6bb, fog: false, transparent: true, opacity: .35 })); moon.position.set(110, 100, -220); this.scenery.add(moon);
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(innerWidth, innerHeight); }
  burst(position: Vec) {
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(this.particleGeometry, this.enemyMaterial); mesh.position.copy(position); this.scene.add(mesh);
      this.particles.push({ mesh, velocity: new THREE.Vector3(Math.sin(i * 8) * 4, 1 + i % 4, Math.cos(i * 8) * 4), life: .65 });
    }
  }
  render(sim: Simulation, dt = 1 / 60, player?: Player) {
    this.frame++;
    this.recoil *= Math.exp(-dt * 22);
    if (player) {
      this.bob += player.velocity.length() * dt * 1.7;
      const amount = player.grounded ? Math.min(1, player.velocity.length() / 6) : 0;
      const reload = player.reloadLeft > 0 ? Math.sin((1.65 - player.reloadLeft) / 1.65 * Math.PI) : 0;
      const target = new THREE.Vector3(player.aiming ? 0 : .32, (player.aiming ? -.2 : -.29) + Math.sin(this.bob * 2) * .009 * amount - reload * .24, -.5 + this.recoil + reload * .1);
      this.weapon.position.lerp(target, 1 - Math.exp(-dt * 18));
      this.weapon.rotation.set(reload * .65 + (player.sprinting ? .2 : 0), player.sprinting ? -.3 : 0, -reload * .65 + Math.sin(this.bob) * .015 * amount);
      const fov = player.aiming ? 48 : player.sprinting ? 79 : 72;
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 12)); this.camera.updateProjectionMatrix();
    }
    this.muzzle.visible = this.recoil > .035;
    this.muzzle.rotation.z += dt * 40;
    const live = new Set(sim.entities.map(e => e.id));
    for (const [id, mesh] of this.meshes) if (!live.has(id)) {
      this.scene.remove(mesh); this.meshes.delete(id);
      const trail = this.trails.get(id);
      if (trail) { this.scene.remove(trail.line); trail.line.geometry.dispose(); (trail.line.material as THREE.Material).dispose(); this.trails.delete(id); }
    }
    for (const entity of sim.entities) {
      let mesh = this.meshes.get(entity.id);
      if (!mesh) {
        mesh = new THREE.Group();
        mesh.add(new THREE.Mesh(entity.kind === 'drone' ? this.droneGeometry : entity.kind === 'debris' ? this.debrisGeometry : this.shotGeometry, entity.kind === 'drone' ? this.droneMaterial : entity.kind === 'debris' ? this.debrisMaterial : entity.kind === 'hostileShot' ? this.enemyMaterial : this.shotMaterial));
        if (entity.kind === 'drone') {
          for (const side of [-1, 1]) { const wing = new THREE.Mesh(this.wingGeometry, this.armorMaterial); wing.position.x = side * .6; wing.rotation.z = side * .2; mesh.add(wing); }
          const eye = new THREE.Mesh(this.shotGeometry, this.enemyMaterial); eye.position.set(0, 0, .32); eye.scale.set(2, .65, 1); mesh.add(eye);
          const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffa074, transparent: true, opacity: .35 }));
          this.trails.set(entity.id, { line, points: [], age: -1 }); this.scene.add(line);
        }
        this.scene.add(mesh); this.meshes.set(entity.id, mesh);
      }
      const p = entity.body.translation(); mesh.position.copy(p);
      if (entity.kind === 'drone') { const v = entity.body.linvel(); mesh.rotation.y = Math.atan2(v.x, v.z); mesh.rotation.z = Math.sin(entity.age * 3) * .08; }
      const trail = this.trails.get(entity.id);
      if (trail && this.frame % 3 === 0 && trail.age !== entity.age) {
        trail.age = entity.age; trail.points.push(mesh.position.clone()); if (trail.points.length > 60) trail.points.shift();
        trail.line.geometry.dispose(); trail.line.geometry = new THREE.BufferGeometry().setFromPoints(trail.points);
      }
    }
    for (const p of [...this.particles]) {
      p.life -= dt; p.mesh.position.addScaledVector(p.velocity, dt); p.velocity.y -= dt * 10; p.mesh.scale.setScalar(Math.max(0, p.life / .65));
      if (p.life <= 0) { this.scene.remove(p.mesh); this.particles.splice(this.particles.indexOf(p), 1); }
    }
    this.slowLight.render(this.renderer, this.scene, this.camera, this.velocity, sim.laws.lightSpeed.c);
  }
}
