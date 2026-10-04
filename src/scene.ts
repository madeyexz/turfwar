import * as THREE from 'three';
import type { Simulation } from './physics';
import { SlowLight } from './slow-light';

export class ArenaView {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 300);
  meshes = new Map<number, THREE.Group>();
  trails = new Map<number, { line: THREE.Line; points: THREE.Vector3[] }>();
  droneGeometry = new THREE.OctahedronGeometry(0.45);
  debrisGeometry = new THREE.IcosahedronGeometry(0.15);
  debrisMaterial = new THREE.MeshStandardMaterial({ color: 0x95a8ae, roughness: 0.7 });
  shotGeometry = new THREE.SphereGeometry(0.08, 8, 6);
  droneMaterial = new THREE.MeshStandardMaterial({ color: 0xf69864, emissive: 0xff6834, emissiveIntensity: 0.8, metalness: 0.6, roughness: 0.3 });
  shotMaterial = new THREE.MeshBasicMaterial({ color: 0xc9f8ff });
  ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffb891, transparent: true, opacity: 0.65 });
  ringGeometry = new THREE.TorusGeometry(0.64, 0.014, 4, 24);
  slowLight = new SlowLight();
  velocity = new THREE.Vector3();
  weapon = new THREE.Group();
  recoil = 0;
  frame = 0;

  constructor(container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor(0x080c13);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.prepend(this.renderer.domElement);
    this.camera.position.set(0, 2.3, 19);
    this.camera.lookAt(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.15, 0.4), new THREE.MeshStandardMaterial({ color: 0x28363e, roughness: 0.3, metalness: 0.8 }));
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.075, 0.4), new THREE.MeshStandardMaterial({ color: 0x526978, metalness: 0.9, roughness: 0.3 }));
    barrel.position.set(0, 0.055, -0.23);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.015, 0.3), this.ringMaterial); rail.position.set(0, 0.09, -0.17);
    this.weapon.add(receiver, barrel, rail); this.weapon.position.set(0.38, -0.31, -0.7);
    this.weapon.visible = false; this.camera.add(this.weapon);
    this.scene.add(new THREE.AmbientLight(0x7394ae, 1.3));
    const sun = new THREE.DirectionalLight(0xbcdeff, 4);
    sun.position.set(-8, 12, 8);
    this.scene.add(sun);
    const warm = new THREE.PointLight(0xff8752, 45);
    warm.position.set(5, 1, 5);
    this.scene.add(warm);

    const planet = new THREE.Mesh(new THREE.IcosahedronGeometry(2.55, 5), new THREE.MeshStandardMaterial({
      color: 0x284454, roughness: 0.9, metalness: 0.25,
      flatShading: true,
    }));
    this.scene.add(planet);
    const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(2.68, 48, 32), new THREE.ShaderMaterial({
      transparent: true, side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 n; varying vec3 v; void main(){vec4 p=modelViewMatrix*vec4(position,1.); n=normalize(normalMatrix*normal); v=normalize(-p.xyz); gl_Position=projectionMatrix*p;}',
      fragmentShader: 'varying vec3 n; varying vec3 v; void main(){float a=pow(1.-abs(dot(n,v)),3.); gl_FragColor=vec4(.2,.65,.9,a*.55);}',
    }));
    this.scene.add(atmosphere);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(5.5 + i * 1.7, 0.009, 4, 160),
        new THREE.MeshBasicMaterial({ color: 0x60848f, transparent: true, opacity: 0.25 }));
      ring.rotation.set(Math.PI / 2.6, i * 0.25, 0.2);
      this.scene.add(ring);
    }
    const positions = new Float32Array(2200 * 3);
    let seed = 33;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < positions.length; i += 3) {
      const v = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize().multiplyScalar(70 + rand() * 80);
      positions.set([v.x, v.y, v.z], i);
    }
    const stars = new THREE.BufferGeometry(); stars.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xa7c0d3, size: 0.075, transparent: true, opacity: 0.7 })));

    const deck = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 0.45, 96), new THREE.MeshStandardMaterial({ color: 0x131c22, metalness: 0.65, roughness: 0.55 }));
    deck.position.y = -3.5; this.scene.add(deck);
    const grid = new THREE.GridHelper(48, 48, 0x3c565d, 0x26363d); grid.position.y = -3.26; this.scene.add(grid);
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2;
      const mark = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, i % 4 === 0 ? 0.75 : 0.3), this.ringMaterial);
      mark.position.set(Math.sin(a) * 23, -3.24, Math.cos(a) * 23); mark.rotation.y = a;
      this.scene.add(mark);
    }
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  render(sim: Simulation) {
    this.frame++;
    this.recoil *= 0.8; this.weapon.position.z = -0.7 + this.recoil;
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
        mesh.add(new THREE.Mesh(entity.kind === 'drone' ? this.droneGeometry : entity.kind === 'debris' ? this.debrisGeometry : this.shotGeometry, entity.kind === 'drone' ? this.droneMaterial : entity.kind === 'debris' ? this.debrisMaterial : this.shotMaterial));
        if (entity.kind === 'drone') {
          const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial); ring.rotation.x = Math.PI / 2; mesh.add(ring);
          const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf99966, transparent: true, opacity: 0.35 }));
          this.trails.set(entity.id, { line, points: [] }); this.scene.add(line);
        }
        this.scene.add(mesh); this.meshes.set(entity.id, mesh);
      }
      const p = entity.body.translation(); mesh.position.set(p.x, p.y, p.z); mesh.rotation.y = entity.age * 0.6;
      const trail = this.trails.get(entity.id);
      if (trail && this.frame % 3 === 0) {
        trail.points.push(mesh.position.clone()); if (trail.points.length > 100) trail.points.shift();
        trail.line.geometry.dispose(); trail.line.geometry = new THREE.BufferGeometry().setFromPoints(trail.points);
      }
    }
    this.slowLight.render(this.renderer, this.scene, this.camera, this.velocity, sim.laws.lightSpeed.c);
  }
}
