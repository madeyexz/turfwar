import * as THREE from 'three';
import type { Vehicle, VehicleKind } from '../../shared/vehicles';
import { InterpBuffer } from './interp';
import { UI_STACK } from '../ui/fonts';
import { t } from '../ui/i18n';

/**
 * Drivable vehicles, built procedurally from low-poly primitives: Taipei's yellow taxis and city
 * sedans, Taiwanese 125 cc scooters in their usual colours, and a light helicopter whose rotors
 * spin with the engine. Models face -Z (yaw 0) like the simulation; wrecks turn to charred hulks.
 */

export type VehiclePose = Pick<Vehicle, 'x' | 'y' | 'z' | 'yaw' | 'pitch' | 'roll' | 'vx' | 'vz' | 'rotor'>;
type Sample = { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; vx: number; vz: number; rotor: number };

/** What each car looks like (by its spot index): taxi first, then city sedans. */
const CAR_LOOKS: { body: number; taxi?: boolean }[] = [
  { body: 0xf2c418, taxi: true }, { body: 0xe8e8e4 }, { body: 0xf2c418, taxi: true }, { body: 0x2a3e66 }, { body: 0x9a9ea4 }, { body: 0x8c1f22 },
];
const SCOOTER_COLORS = [0xf4f2ec, 0xc8262a, 0x2f6bb0, 0x22252a, 0x9ed6c4, 0xf2c418, 0x6a6e74];

/** Short display name for a vehicle (HUD, prompts). */
export function vehicleName(v: Pick<Vehicle, 'kind' | 'id'>) {
  if (v.kind !== 'car') return t(v.kind === 'heli' ? 'vehicle.heli' : 'vehicle.scooter');
  return t(CAR_LOOKS[v.id % CAR_LOOKS.length].taxi ? 'vehicle.taxi' : 'vehicle.car');
}

const mats = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material) {
  let m = mats.get(key);
  if (!m) { m = make(); mats.set(key, m); }
  return m;
}
const paint = (color: number, rough = 0.35, metal = 0.35) => mat(`paint${color}${rough}${metal}`, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
const glass = () => mat('glass', () => new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.4 }));
const rubber = () => mat('rubber', () => new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 }));
const chrome = () => mat('chrome', () => new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.2, metalness: 0.9 }));
const lamp = (color: number, glow = 2) => mat(`lamp${color}${glow}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: glow, roughness: 0.4 }));
const charred = () => mat('charred', () => new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 1, metalness: 0.1 }));
const ember = () => mat('ember', () => new THREE.MeshStandardMaterial({ color: 0x2a0d04, emissive: 0xff5a18, emissiveIntensity: 2.2, roughness: 1 }));

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
function wheel(r: number, w: number, x: number, y: number, z: number) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 14), rubber());
  tyre.rotation.z = Math.PI / 2; tyre.castShadow = true;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 10), chrome());
  hub.rotation.z = Math.PI / 2;
  g.add(tyre, hub); g.position.set(x, y, z);
  return g;
}

/** Text panel on a canvas (the taxi's roof sign). */
function label(text: string, bg: string, fg: string, w: number, h: number) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 48;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, 128, 48);
  g.fillStyle = fg; g.font = `bold 30px ${UI_STACK}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 26);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6, roughness: 0.6 }));
}

interface Model { root: THREE.Group; body: THREE.Group; wheels: THREE.Object3D[]; rotor?: THREE.Object3D; tail?: THREE.Object3D; blur?: THREE.Mesh; wheelR: number }

function carModel(id: number): Model {
  const look = CAR_LOOKS[id % CAR_LOOKS.length];
  const root = new THREE.Group(), body = new THREE.Group();
  const p = paint(look.body);
  body.add(box(1.84, 0.58, 4.4, p, 0, 0.62, 0));                         // lower body
  body.add(box(1.8, 0.16, 1.1, p, 0, 0.98, -1.55));                      // bonnet
  body.add(box(1.8, 0.16, 0.8, p, 0, 0.98, 1.75));                       // boot lid
  body.add(box(1.62, 0.5, 2.2, glass(), 0, 1.16, 0.1));                  // glasshouse
  body.add(box(1.66, 0.07, 1.9, p, 0, 1.44, 0.15));                      // roof
  for (const s of [-1, 1]) {
    body.add(box(0.08, 0.5, 0.1, p, s * 0.79, 1.16, -0.95));             // A pillars
    body.add(box(0.08, 0.5, 0.12, p, s * 0.79, 1.16, 1.15));             // C pillars
    body.add(box(0.36, 0.13, 0.04, lamp(0xfff4d8, 1.6), s * 0.62, 0.78, -2.21)); // headlights
    body.add(box(0.36, 0.12, 0.04, lamp(0xd01818, 1.2), s * 0.62, 0.8, 2.21));   // tail lights
    body.add(box(0.06, 0.08, 0.2, p, s * 0.95, 1.06, -0.85));            // mirrors
  }
  body.add(box(1.7, 0.18, 0.1, chrome(), 0, 0.42, -2.22));               // bumpers
  body.add(box(1.7, 0.18, 0.1, chrome(), 0, 0.42, 2.22));
  body.add(box(0.7, 0.16, 0.03, lamp(0xf4f4f4, 0.1), 0, 0.55, 2.24));    // plate
  if (look.taxi) {
    const sign = new THREE.Group();
    sign.add(box(0.62, 0.22, 0.3, lamp(0xfff2b0, 0.9), 0, 0, 0));
    for (const s of [-1, 1]) { const t = label('TAXI', '#fff2b0', '#1a1a1a', 0.58, 0.2); t.position.set(0, 0, s * 0.155); t.rotation.y = s > 0 ? 0 : Math.PI; sign.add(t); }
    sign.position.set(0, 1.59, 0.2); body.add(sign);
    for (const s of [-1, 1]) body.add(box(0.03, 0.08, 3.2, paint(0x1a1a1a, 0.5, 0.1), s * 0.925, 0.78, 0)); // side stripe
  }
  const wheels = [-1, 1].flatMap(sx => [-1.36, 1.36].map(z => wheel(0.34, 0.24, sx * 0.82, 0.34, z)));
  root.add(body, ...wheels);
  return { root, body, wheels, wheelR: 0.34 };
}

function scooterModel(id: number): Model {
  const root = new THREE.Group(), body = new THREE.Group();
  const p = paint(SCOOTER_COLORS[id % SCOOTER_COLORS.length], 0.3, 0.2);
  const dark = paint(0x1c1d20, 0.6, 0.1);
  body.add(box(0.34, 0.08, 0.66, dark, 0, 0.3, -0.02));                  // floorboard
  body.add(box(0.4, 0.36, 0.78, p, 0, 0.5, 0.44));                       // rear body
  body.add(box(0.34, 0.11, 0.74, dark, 0, 0.74, 0.42));                  // seat
  const apron = box(0.42, 0.72, 0.16, p, 0, 0.62, -0.42);                // leg shield
  apron.rotation.x = -0.22; body.add(apron);
  const stem = box(0.08, 0.5, 0.08, dark, 0, 1.02, -0.5); stem.rotation.x = -0.25; body.add(stem);
  body.add(box(0.66, 0.06, 0.07, dark, 0, 1.24, -0.56));                 // handlebar
  body.add(box(0.28, 0.14, 0.16, p, 0, 1.2, -0.6));                      // headset
  body.add(box(0.16, 0.1, 0.04, lamp(0xfff4d8, 1.6), 0, 1.2, -0.69));    // headlight
  body.add(box(0.2, 0.08, 0.04, lamp(0xd01818, 1.2), 0, 0.62, 0.84));    // tail light
  body.add(box(0.14, 0.2, 0.5, paint(0x6a6a6a, 0.4, 0.7), 0.17, 0.3, 0.55)); // engine / exhaust
  body.add(box(0.16, 0.05, 0.36, dark, 0, 0.74, 0.92));                  // rear rack
  const wheels = [-0.62, 0.62].map(z => wheel(0.22, 0.1, 0, 0.22, z));
  root.add(body, ...wheels);
  return { root, body, wheels, wheelR: 0.22 };
}

function heliModel(): Model {
  const root = new THREE.Group(), body = new THREE.Group();
  const p = paint(0xeeeeea, 0.35, 0.3), stripe = paint(0x1f4fa8, 0.4, 0.2), dark = paint(0x2a2c30, 0.6, 0.3);
  const cabin = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), p);
  cabin.scale.set(1.05, 1.0, 1.55); cabin.position.set(0, 1.35, -0.55); cabin.castShadow = true; body.add(cabin);
  // The glazed nose: a bubble poking out of the cabin's front and top.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), glass());
  canopy.scale.set(0.92, 0.72, 0.9); canopy.position.set(0, 1.62, -1.22); body.add(canopy);
  body.add(box(2.12, 0.14, 1.6, stripe, 0, 1.1, -0.45));                 // belly stripe
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.24, 4.3, 10), p);
  boom.rotation.x = Math.PI / 2; boom.position.set(0, 1.55, 2.75); boom.castShadow = true; body.add(boom);
  body.add(box(0.07, 1.05, 0.6, stripe, 0, 2.0, 4.75));                   // fin
  body.add(box(1.1, 0.06, 0.32, p, 0, 1.6, 4.3));                         // stabiliser
  body.add(box(0.5, 0.35, 0.9, dark, 0, 2.32, -0.1));                     // engine cowl
  for (const s of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 8), dark);
    skid.rotation.x = Math.PI / 2; skid.position.set(s * 0.82, 0.06, -0.45); body.add(skid);
    for (const z of [-1.2, 0.3]) { const strut = box(0.06, 0.62, 0.06, dark, s * 0.68, 0.36, z); strut.rotation.z = s * 0.35; body.add(strut); }
    body.add(box(0.1, 0.08, 0.04, lamp(s < 0 ? 0xff2020 : 0x20ff40, 2), s * 1.04, 1.45, -0.6)); // nav lights
  }
  body.add(box(0.06, 0.06, 0.06, lamp(0xff3020, 3), 0, 2.55, 4.95));     // beacon
  const rotor = new THREE.Group();
  rotor.add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.3, 10), dark));
  for (let k = 0; k < 4; k++) {
    const blade = box(5.2, 0.04, 0.26, dark, 2.6, 0.12, 0);
    const arm = new THREE.Group(); arm.add(blade); arm.rotation.y = k * Math.PI / 2; rotor.add(arm);
  }
  rotor.position.set(0, 2.62, -0.3);
  const blur = new THREE.Mesh(new THREE.CircleGeometry(5.2, 40), new THREE.MeshBasicMaterial({ color: 0x202226, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  blur.rotation.x = -Math.PI / 2; blur.position.set(0, 2.76, -0.3);
  const tail = new THREE.Group();
  for (let k = 0; k < 2; k++) { const b = box(0.04, 1.1, 0.12, dark, 0, 0, 0); b.rotation.x = k * Math.PI / 2; tail.add(b); }
  tail.position.set(0.12, 2.05, 4.95);
  body.add(rotor, blur, tail);
  root.add(body);
  return { root, body, wheels: [], rotor, tail, blur, wheelR: 1 };
}

function buildModel(kind: VehicleKind, id: number) {
  return kind === 'car' ? carModel(id) : kind === 'scooter' ? scooterModel(id) : heliModel();
}

interface View { kind: VehicleKind; model: Model; buffer: InterpBuffer<Sample>; wrecked: boolean; spin: number; roll: number; pose: Sample; embers?: THREE.Object3D }

/** Renders every vehicle of the match: interpolated from snapshots, or a predicted pose for the one we drive. */
export class VehiclesView {
  readonly group = new THREE.Group();
  private views = new Map<number, View>();

  sync(vehicles: Vehicle[], t: number) {
    const seen = new Set<number>();
    for (const v of vehicles) {
      seen.add(v.id);
      let view = this.views.get(v.id);
      if (!view || view.kind !== v.kind) {
        if (view) view.model.root.removeFromParent();
        const model = buildModel(v.kind, v.id);
        this.group.add(model.root);
        view = { kind: v.kind, model, buffer: new InterpBuffer(), wrecked: false, spin: 0, roll: 0, pose: { ...v } };
        this.views.set(v.id, view);
      }
      const last = view.buffer.latest();
      // Round resets park vehicles far away: never interpolate across the map.
      if (last && Math.hypot(last.x - v.x, last.z - v.z) > 25) view.buffer.clear();
      view.buffer.push(t, { x: v.x, y: v.y, z: v.z, yaw: v.yaw, pitch: v.pitch, roll: v.roll, vx: v.vx, vz: v.vz, rotor: v.rotor });
      if (v.wrecked !== view.wrecked) this.setWrecked(view, v.wrecked);
    }
    for (const [id, view] of this.views) if (!seen.has(id)) { view.model.root.removeFromParent(); this.views.delete(id); }
  }

  /** Interpolated pose of vehicle `id` (what the renderer shows), if known. */
  pose(id: number): Sample | undefined { return this.views.get(id)?.pose; }

  /** Place every vehicle; `predicted` overrides the interpolated pose (the vehicle we drive). */
  update(dt: number, renderTime: number, predicted?: { id: number; pose: VehiclePose }) {
    for (const [id, view] of this.views) {
      const sample = predicted?.id === id ? predicted.pose : view.buffer.sample(renderTime, ['yaw']);
      if (!sample) continue;
      view.pose = { x: sample.x, y: sample.y, z: sample.z, yaw: sample.yaw, pitch: sample.pitch, roll: sample.roll, vx: sample.vx, vz: sample.vz, rotor: sample.rotor };
      const { root, body, wheels, rotor, tail, blur, wheelR } = view.model;
      root.position.set(sample.x, sample.y, sample.z);
      root.rotation.set(sample.pitch, sample.yaw, -sample.roll, 'YXZ');
      if (view.wrecked) continue;
      // Wheels roll with the ground speed along the heading.
      const forward = -Math.sin(sample.yaw) * sample.vx - Math.cos(sample.yaw) * sample.vz;
      for (const w of wheels) w.rotation.x -= forward / wheelR * dt;
      if (rotor) {
        view.spin += sample.rotor * 38 * dt;
        rotor.rotation.y = view.spin;
        if (tail) tail.rotation.x = view.spin * 2.7;
        if (blur) (blur.material as THREE.MeshBasicMaterial).opacity = Math.max(0, sample.rotor - 0.35) * 0.35;
      }
      void body;
    }
  }

  private setWrecked(view: View, wrecked: boolean) {
    view.wrecked = wrecked;
    if (!wrecked) {
      // A round reset brings a fresh vehicle: rebuild it.
      const id = [...this.views.entries()].find(([, v]) => v === view)![0];
      view.model.root.removeFromParent();
      view.model = buildModel(view.kind, id);
      this.group.add(view.model.root);
      return;
    }
    view.model.root.traverse(o => {
      if (o instanceof THREE.Mesh) {
        if (o.material instanceof THREE.MeshBasicMaterial) o.visible = false;
        else o.material = charred();
      }
    });
    if (view.model.rotor) { view.model.rotor.visible = true; view.model.rotor.rotation.z = 0.25; }
    // Smouldering engine bay (car), engine (scooter) or turbine (helicopter).
    const embers = new THREE.Mesh(new THREE.BoxGeometry(view.kind === 'scooter' ? 0.3 : 0.9, 0.12, view.kind === 'scooter' ? 0.4 : 0.8), ember());
    const at = { car: [1.08, -1.5], scooter: [0.84, 0.45], heli: [2.52, -0.1] }[view.kind];
    embers.position.set(0, at[0], at[1]);
    view.model.root.add(embers);
    view.embers = embers;
    view.model.body.rotation.z = 0.05;
  }

  dispose() { this.group.clear(); this.views.clear(); }
}
