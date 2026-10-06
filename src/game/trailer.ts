/**
 * Dev-only trailer director (`?trailer` with `?capture`, never in production builds): the capture
 * driver in `trailer/scripts` steps the game frame by frame through `window.__trailer` and stages
 * each shot with it. It never changes the rules: it scripts input the way a player would (keys,
 * aim, trigger), places the camera for cinematic shots, hides the HUD, slows time, records which
 * sounds the game played (to rebuild the soundtrack offline) and, for staging only, moves soldiers
 * in the local Solo simulation.
 */
import * as THREE from 'three';
import { loadMap } from '../../shared/maps/index';
import { wrapAngle } from '../../shared/math';
import { eyeHeight } from '../../shared/movement';
import { HEALTH, type AttachmentId, type WeaponId } from '../../shared/weapons';
import type { Audio } from '../audio';
import type { Renderer } from '../render/renderer';
import type { Game } from './game';

type V3 = [number, number, number];
interface VClock { now: number; advance(ms: number): void; frame(): void; animations(ms: number): void; seed(n: number): void }
declare global { interface Window { __vclock?: VClock; __trailer?: Trailer } }

/** Camera moves for cinematic shots (frames count from when the move is set). */
export type CamMove =
  | { kind: 'path'; frames: number; keys: { p: V3; t: V3; fov?: number }[]; ease?: boolean }
  | { kind: 'orbit'; frames: number; center: V3; radius: number; height: number; from: number; to: number; fov?: number; lookUp?: number; ease?: boolean }
  | { kind: 'follow'; target: { soldier?: number; vehicle?: number }; offset: V3; look?: V3; fov?: number; smooth?: number; local?: boolean }
  | { kind: 'fixed'; p: V3; t: V3; fov?: number }
  /** A camera that stays put (or drifts from p to p2) and turns to keep a soldier or vehicle in frame. */
  | { kind: 'track'; p: V3; p2?: V3; frames?: number; target: { soldier?: number; vehicle?: number }; look?: V3; fov?: number; smooth?: number };

/** Waypoint for the vehicle autopilot: drive to (x, z) at about `speed` m/s, holding the handbrake if `drift`. */
interface Waypoint { x: number; z: number; speed?: number; drift?: boolean; y?: number }

const ease = (u: number) => u * u * (3 - 2 * u);
const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
function spline(points: V3[], u: number): V3 {
  if (points.length === 1) return points[0];
  const n = points.length - 1, x = Math.min(n - 1e-6, Math.max(0, u * n)), i = Math.floor(x), t = x - i;
  const p = (k: number) => points[Math.max(0, Math.min(n, k))];
  return [0, 1, 2].map(c => catmull(p(i - 1)[c], p(i)[c], p(i + 1)[c], p(i + 2)[c], t)) as V3;
}

const AUDIO_METHODS = ['gunshot', 'knife', 'boltShot', 'dryFire', 'reload', 'equip', 'hitmarker', 'damage', 'heartbeat', 'bombBeep', 'bombArmed', 'bombDisarmed',
  'roundStart', 'roundEnd', 'cash', 'binoculars', 'explosion', 'footstep', 'door', 'crash', 'jump', 'land', 'slide', 'ui', 'tick'] as const;

export class Trailer {
  timeScale = 1;
  frames = 0;
  /** Sounds the game asked for since `mark()`, with their time (s), for the offline mix. */
  sounds: { t: number; f: string; a: unknown[]; v?: number }[] = [];
  private markAt = 0;
  private cam?: CamMove;
  private camFrame = 0;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camReady = false;
  private hooked?: Game;
  private drivers = new Map<string, (dt: number) => void>();
  private voiceIds = 0;
  hudMode: 'full' | 'none' | 'clean' = 'full';

  constructor(private lb: { readonly game: Game | undefined; renderer: Renderer; step: (n: number, render?: boolean) => number }) {
    const style = document.createElement('style');
    style.textContent = `
      body.trailer #hud .fps, body.trailer #hud .netstat, body.trailer #hud .released { display: none !important; }
      body.trailer-hud-none #hud, body.trailer-hud-none #store { display: none !important; }
      body.trailer-hud-clean #hud > :not(.crosshair):not(.hitmarker):not(.killfeed):not(.rewards):not(.scope):not(.pipvig):not(.flash):not(.damage-ring):not(.announce):not(.binos):not(.progress):not(.zoomtag) { display: none !important; }
      body.trailer-nocursor * { cursor: none !important; }`;
    document.head.appendChild(style);
    document.body.classList.add('trailer', 'trailer-nocursor');
  }

  get game() { return this.lb.game; }
  private get g() { return this.lb.game as any; }

  /** Advance n frames of 1/30 s (scaled by timeScale), rendering the last one. */
  tick(n = 1) {
    const vc = window.__vclock;
    for (let i = 0; i < n; i++) {
      const dt = (1 / 30) * this.timeScale;
      vc?.advance(dt * 1000);
      vc?.frame();
      const game = this.game;
      if (game) this.hook(game);
      for (const d of this.drivers.values()) d(dt);
      if (game) game.frame(dt, i === n - 1);
      else this.lb.step(1, i === n - 1);
      vc?.animations(dt * 1000);
      this.frames++;
    }
    return this.frames;
  }

  /** Start of a clip: sound times count from here. */
  mark() { this.markAt = window.__vclock?.now ?? performance.now(); this.sounds = []; this.frames = 0; return true; }

  hud(mode: 'full' | 'none' | 'clean') {
    this.hudMode = mode;
    document.body.classList.toggle('trailer-hud-none', mode === 'none');
    document.body.classList.toggle('trailer-hud-clean', mode === 'clean');
    return mode;
  }

  // ---- Camera ----

  camera(move: CamMove | null) { this.cam = move ?? undefined; this.camFrame = 0; this.camReady = false; return !!move; }

  private hook(game: Game) {
    if (this.hooked === game) return;
    this.hooked = game;
    (game as any).trailerHook = (dt: number) => this.placeCamera(dt);
    this.recordAudio(game.audio);
  }

  private placeCamera(dt: number) {
    const move = this.cam;
    if (!move) return;
    const cam = this.lb.renderer.camera, g = this.g;
    let fov = 60;
    const f = this.camFrame;
    this.camFrame += this.timeScale;
    if (move.kind === 'fixed') { this.camPos.set(...move.p); this.camLook.set(...move.t); fov = move.fov ?? fov; }
    else if (move.kind === 'track') {
      const u = move.p2 ? ease(Math.min(1, f / Math.max(1, move.frames ?? 90))) : 0;
      const p2 = move.p2 ?? move.p;
      this.camPos.set(move.p[0] + (p2[0] - move.p[0]) * u, move.p[1] + (p2[1] - move.p[1]) * u, move.p[2] + (p2[2] - move.p[2]) * u);
      const pose = this.targetPose(move.target);
      if (pose) {
        const [lx, ly, lz] = move.look ?? [0, 1.2, 0];
        const want = new THREE.Vector3(pose.x + lx, pose.y + ly, pose.z + lz);
        this.camLook.lerp(want, this.camReady ? 1 - Math.exp(-dt * (move.smooth ?? 8)) : 1);
      }
      fov = move.fov ?? fov;
    }
    else if (move.kind === 'path') {
      let u = Math.min(1, f / Math.max(1, move.frames));
      if (move.ease !== false) u = ease(u);
      this.camPos.set(...spline(move.keys.map(k => k.p), u));
      this.camLook.set(...spline(move.keys.map(k => k.t), u));
      const fovs = move.keys.map(k => k.fov ?? 60);
      fov = spline(fovs.map(v => [v, 0, 0] as V3), u)[0];
    } else if (move.kind === 'orbit') {
      let u = Math.min(1, f / Math.max(1, move.frames));
      if (move.ease) u = ease(u);
      const a = move.from + (move.to - move.from) * u;
      const [cx, cy, cz] = move.center;
      this.camPos.set(cx + Math.cos(a) * move.radius, cy + move.height, cz + Math.sin(a) * move.radius);
      this.camLook.set(cx, cy + (move.lookUp ?? 0), cz);
      fov = move.fov ?? fov;
    } else {
      const pose = this.targetPose(move.target);
      if (pose) {
        const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
        const [ox, oy, oz] = move.offset;
        // Local offsets: x right, z behind (the game's forward is -z at yaw 0).
        const wx = move.local === false ? ox : ox * c + oz * s, wz = move.local === false ? oz : -ox * s + oz * c;
        const want = new THREE.Vector3(pose.x + wx, pose.y + oy, pose.z + wz);
        const [lx, ly, lz] = move.look ?? [0, 1.2, 0];
        const look = new THREE.Vector3(pose.x + (move.local === false ? lx : lx * c + lz * s), pose.y + ly, pose.z + (move.local === false ? lz : -lx * s + lz * c));
        const k = this.camReady ? 1 - Math.exp(-dt * (move.smooth ?? 6)) : 1;
        this.camPos.lerp(want, k); this.camLook.lerp(look, k);
      }
      fov = move.fov ?? fov;
    }
    this.camReady = true;
    cam.position.copy(this.camPos);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.camLook);
    cam.fov = fov; cam.updateProjectionMatrix();
    // A free camera shows no first-person weapon.
    g.viewmodel.root.visible = false; g.viewmodel.torch.intensity = 0;
    if (g.otherViewmodel) g.otherViewmodel.root.visible = false;
  }

  private targetPose(t: { soldier?: number; vehicle?: number }) {
    const g = this.g;
    if (t.vehicle !== undefined) {
      const own = g.driving.v?.id === t.vehicle ? g.driving.renderPose() : undefined;
      const p = own ?? g.vehicles.pose(t.vehicle);
      return p ? { x: p.x, y: p.y, z: p.z, yaw: p.yaw } : undefined;
    }
    if (t.soldier !== undefined) {
      const r = g.remotes.get(t.soldier);
      if (r) return { x: r.pos.x, y: r.pos.y, z: r.pos.z, yaw: r.yaw };
      if (t.soldier === this.game!.link.myId()) { const p = this.game!.player; return { x: p.m.x, y: p.m.y, z: p.m.z, yaw: p.yaw }; }
    }
    return undefined;
  }

  // ---- Sound log ----

  private recordAudio(audio: Audio) {
    const a = audio as any;
    if (a.__trailerWrapped) return;
    a.__trailerWrapped = true;
    const now = () => ((window.__vclock?.now ?? performance.now()) - this.markAt) / 1000;
    const clone = (args: unknown[]) => JSON.parse(JSON.stringify(args, (_k, v) => v instanceof THREE.Vector3 ? { x: v.x, y: v.y, z: v.z } : v));
    for (const name of AUDIO_METHODS) {
      const orig = a[name]?.bind(a);
      if (!orig) continue;
      a[name] = (...args: unknown[]) => { this.sounds.push({ t: now(), f: name, a: clone(args) }); return orig(...args); };
    }
    for (const name of ['engine', 'screech'] as const) {
      const orig = a[name].bind(a);
      a[name] = (...args: unknown[]) => {
        const voice = orig(...args);
        if (!voice) return voice;
        const id = ++this.voiceIds;
        this.sounds.push({ t: now(), f: name, a: clone(args), v: id });
        return {
          set: (...s: unknown[]) => { this.sounds.push({ t: now(), f: 'voice.set', a: clone(s), v: id }); voice.set(...s); },
          stop: () => { this.sounds.push({ t: now(), f: 'voice.stop', a: [], v: id }); voice.stop(); },
        };
      };
    }
  }

  // ---- Staging (local Solo simulation only) ----

  state() { return this.game?.link.state(); }
  me() { const st = this.state(); return st?.soldiers.find(s => s.id === this.game!.link.myId()); }

  info() {
    const st = this.state(), me = this.me(), def = this.game ? loadMap(this.game.mapId).def : undefined;
    return {
      map: this.game?.mapId, phase: st?.phase, roundPhase: st?.roundPhase, round: st?.round, phaseLeft: st?.phaseLeft, bomb: st?.bomb,
      me: me && { id: me.id, team: me.team, x: me.m.x, y: me.m.y, z: me.m.z, yaw: me.yaw, alive: me.alive, money: me.money, weapons: me.weapons },
      cam: this.lb.renderer.camera.position.toArray(),
      soldiers: st?.soldiers.map(s => ({ id: s.id, team: s.team, bot: s.bot, alive: s.alive, x: +s.m.x.toFixed(1), y: +s.m.y.toFixed(1), z: +s.m.z.toFixed(1) })),
      vehicles: st?.vehicles.map(v => ({ id: v.id, kind: v.kind, x: +v.x.toFixed(1), y: +v.y.toFixed(1), z: +v.z.toFixed(1), yaw: +v.yaw.toFixed(2) })),
      points: def?.points.map(p => ({ id: p.id, name: (p as any).name, x: p.x, y: p.y, z: p.z })),
      spawns: def?.spawns.slice(0, 40).map(s => ({ team: s.team, x: s.x, z: s.z })),
      sites: def?.sabotage, ladders: def?.ladders?.map(l => ({ ...l })), bounds: def?.bounds,
    };
  }

  /** Keep the local soldier alive through staged fights (Solo; the same trick as the ?bench run). */
  god(on = true) {
    if (on) this.drivers.set('god', () => { const me = this.me(); if (me) me.health = HEALTH.max * 4; });
    else this.drivers.delete('god');
    return on;
  }

  /** Put the local soldier somewhere (host state and prediction together, so nothing is corrected). */
  teleport(x: number, y: number, z: number, yaw?: number, pitch = 0) {
    const me = this.me(), p = this.game!.player;
    if (!me) return false;
    for (const m of [me.m, p.m]) { m.x = x; m.y = y; m.z = z; m.vx = m.vy = m.vz = 0; }
    (p as any).prev = { x, y, z, crouch: p.m.crouch };
    me.groundY = y;
    if (yaw !== undefined) { p.yaw = yaw; me.yaw = yaw; p.pitch = pitch; }
    return true;
  }

  /** Keep the local soldier at a point each frame (a vantage point no floor reaches, for a still shot). */
  hold(x: number, y: number, z: number) {
    this.drivers.set('hold', () => this.teleport(x, y, z));
    return true;
  }

  look(yaw: number, pitch = 0) { const p = this.game!.player; p.yaw = yaw; p.pitch = pitch; return true; }
  lookAt(x: number, y: number, z: number) {
    const e = this.game!.player.eye();
    return this.look(Math.atan2(-(x - e.x), -(z - e.z)), Math.atan2(y - e.y, Math.hypot(x - e.x, z - e.z)));
  }

  /** Move a soldier (bots too) and optionally pin it there each frame. */
  place(id: number, x: number, y: number, z: number, yaw = 0, pin = false) {
    const s = this.state()?.soldiers.find(q => q.id === id);
    if (!s) return false;
    s.m.x = x; s.m.y = y; s.m.z = z; s.m.vx = s.m.vy = s.m.vz = 0; s.yaw = yaw; s.groundY = y;
    if (s.brain) { s.brain.path = []; s.brain.repath = 0; }
    if (pin) this.drivers.set(`pin${id}`, () => { s.m.x = x; s.m.z = z; s.m.vx = s.m.vz = 0; if (s.brain) s.brain.path = []; });
    return true;
  }
  /** Pin every bot of a team where it stands (keeps a staged shot clear). */
  pinTeam(team: number) { for (const s of this.state()?.soldiers ?? []) if (s.bot && s.team === team) this.place(s.id, s.m.x, s.m.y, s.m.z, s.yaw, true); return true; }
  unpin() { for (const k of [...this.drivers.keys()]) if (k.startsWith('pin')) this.drivers.delete(k); return true; }

  /** Bots that see but do not shoot (targets for a gunplay shot). */
  pacify(ids: number[] | 'enemies' | 'all' | 'none') {
    if (ids === 'none') { this.drivers.delete('pacify'); return true; }
    this.drivers.set('pacify', () => {
      const st = this.state(), me = this.me();
      for (const s of st?.soldiers ?? []) {
        const hit = ids === 'all' || (ids === 'enemies' ? s.team !== me?.team : ids.includes(s.id));
        if (hit && s.brain) { s.brain.reaction = 1; s.brain.grenadeCooldown = 9; }
      }
    });
    return true;
  }

  kill(ids: number[]) { for (const s of this.state()?.soldiers ?? []) if (ids.includes(s.id)) { s.alive = false; s.health = 0; } return true; }

  /** Loadout for the local soldier (weapons and attachments as if bought). */
  loadout(primary: WeaponId, attachments: Partial<Record<AttachmentId extends never ? never : string, string>> = {}, secondary?: WeaponId) {
    const me = this.me();
    if (!me) return false;
    me.weapons[0] = primary; if (secondary) me.weapons[1] = secondary;
    for (const w of me.weapons) if (!me.owned.includes(w)) me.owned.push(w);
    me.attachments[primary] = { ...(me.attachments[primary] ?? {}), ...attachments } as any;
    me.ammo[0] = 999; me.reserve = [999, 999];
    return true;
  }

  money(n: number) { const me = this.me(); if (me) me.money = n; return n; }
  grenades(n: number) { const me = this.me(); if (me) me.grenades = n; return n; }

  // ---- Scripted input ----

  /** Hold keys (KeyW, ShiftLeft, …), trigger and aim until changed. */
  input(spec: { keys?: string[]; fire?: boolean; aim?: boolean; press?: string[]; look?: [number, number] }) {
    this.drivers.set('input', () => {
      const input = this.game!.input;
      input.keys.clear();
      for (const k of spec.keys ?? []) input.keys.add(k);
      input.fire = !!spec.fire; input.aim = !!spec.aim;
      if (spec.look) { input.lookX += spec.look[0]; input.lookY += spec.look[1]; }
    });
    if (spec.press) this.press(...spec.press);
    return true;
  }
  /** One edge-triggered key press (B, E, Z, G, 1–4, …) on the next frame. */
  press(...codes: string[]) { for (const c of codes) (this.game!.input as any).pressed.add(c); return true; }
  wheel(n: number) { this.game!.input.wheel += n; return true; }
  stop(name?: string) { if (name) this.drivers.delete(name); else { this.drivers.clear(); this.game?.input.clear(); } return true; }

  /** Turn the view smoothly toward a yaw/pitch (rate per second). */
  turnTo(yaw: number, pitch = 0, rate = 4) {
    this.drivers.set('turn', dt => {
      const p = this.game!.player, k = Math.min(1, dt * rate);
      p.yaw += wrapAngle(yaw - p.yaw) * k; p.pitch += (pitch - p.pitch) * k;
    });
    return true;
  }

  /**
   * Fight like the ?bench soldier: aim at the nearest visible enemy (chest or head), ADS, and fire
   * once on target. Options limit range, pick a target id, and set the turn rate.
   */
  fight(opts: { ads?: boolean; fire?: boolean; range?: number; target?: number; rate?: number; head?: boolean; keys?: string[]; burst?: [number, number] } = {}) {
    let clock = 0, pulse = false;
    this.drivers.set('fight', dt => {
      const g = this.game!, p = g.player, input = g.input, st = g.link.state(), me = this.me();
      clock += dt;
      if (!st || !me || !p.alive) return;
      const world = loadMap(g.mapId).world;
      const eye = p.eye();
      let target: { x: number; y: number; z: number } | undefined, best = opts.range ?? 60;
      for (const s of st.soldiers) {
        if (!s.alive || s.team === me.team || (opts.target !== undefined && s.id !== opts.target)) continue;
        const r = (g as any).remotes.get(s.id);
        const pos = r?.pos ?? s.m;
        const aim = { x: pos.x, y: pos.y + (opts.head ? eyeHeight(s.m) + 0.02 : 1.2 - s.m.crouch * 0.4), z: pos.z };
        const d = Math.hypot(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z);
        if (d < best && world.lineOfSight(eye, aim)) { best = d; target = aim; }
      }
      // At the handlebars the drive autopilot owns the keys.
      if (!g.driving.active) input.keys.clear();
      for (const k of opts.keys ?? []) input.keys.add(k);
      input.fire = false; input.aim = !!opts.ads;
      if (!target) return;
      const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
      const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz));
      if (g.driving.armed) {
        // Scooter: the camera aims (relative to the bike); the game turns the shot to the camera's centre.
        const v = g.driving.renderPose()!;
        g.driving.camYaw += wrapAngle(yaw - v.yaw - g.driving.camYaw) * Math.min(1, dt * (opts.rate ?? 8));
        g.driving.camPitch += (pitch - g.driving.camPitch) * Math.min(1, dt * (opts.rate ?? 8));
        g.driving.aiming();
        input.fire = opts.fire !== false && Math.abs(wrapAngle(yaw - v.yaw - g.driving.camYaw)) < 0.08;
        return;
      }
      const k = Math.min(1, dt * (opts.rate ?? 18));
      const ey = wrapAngle(yaw - p.yaw), ep = pitch - p.pitch;
      p.yaw += ey * k; p.pitch += ep * k;
      // On target once the remaining error is within about a body width at this range.
      const on = Math.hypot(ey, ep) * (1 - k) < Math.max(0.012, 0.25 / best) && (!opts.ads || p.ads > 0.9);
      const burstOn = !opts.burst || (clock % (opts.burst[0] + opts.burst[1])) < opts.burst[0];
      // Semi-automatic weapons need the trigger released between shots.
      pulse = !pulse;
      input.fire = opts.fire !== false && on && burstOn && (p.weapon.auto || pulse);
    });
    return true;
  }

  /** Vehicle autopilot through waypoints (cars and scooters steer and brake; the helicopter flies). */
  drive(points: Waypoint[], opts: { loop?: boolean; climb?: number; alt?: number } = {}) {
    let i = 0;
    this.drivers.set('drive', () => {
      const g = this.game!, d = g.driving, input = g.input, v = d.renderPose();
      if (!v) return;
      input.keys.clear();
      if (i >= points.length) { if (opts.loop) i = 0; else { input.keys.add(v.kind === 'heli' ? 'KeyC' : 'Space'); return; } }
      const wp = points[i];
      const dx = wp.x - v.x, dz = wp.z - v.z, dist = Math.hypot(dx, dz);
      if (dist < (v.kind === 'heli' ? 12 : 6)) { i++; return; }
      const want = Math.atan2(-dx, -dz), err = wrapAngle(want - v.yaw), speed = Math.hypot(v.vx, v.vz);
      if (v.kind === 'heli') {
        d.camYaw = v.yaw + Math.max(-0.05, Math.min(0.05, err));
        const alt = wp.y ?? opts.alt ?? 40;
        const floor = loadMap(g.mapId).world.groundHeight(v.x, v.z, v.y + 0.1, 0.5);
        if (v.y - floor < alt - 2) input.keys.add('Space'); else if (v.y - floor > alt + 4) input.keys.add('KeyC');
        if (v.rotor > 0.95 && v.y - floor > (opts.climb ?? 6) && Math.abs(err) < 0.5) input.keys.add('KeyW');
        return;
      }
      if (err > 0.04) input.keys.add('KeyA'); else if (err < -0.04) input.keys.add('KeyD');
      const target = wp.speed ?? 20;
      if (speed < target) input.keys.add('KeyW'); else if (speed > target + 4) input.keys.add('KeyS');
      if (wp.drift && Math.abs(err) > 0.25) input.keys.add('Space');
    });
    return true;
  }

  enter(vehicle: number) { this.game!.link.enterVehicle(vehicle); return true; }
  exit() { this.game!.link.exitVehicle(); return true; }

  /** Set a vehicle's pose in the Solo simulation (and the prediction when we drive it). */
  placeVehicle(id: number, x: number, y: number, z: number, yaw: number) {
    const v = this.state()?.vehicles.find(q => q.id === id);
    if (!v) return false;
    Object.assign(v, { x, y, z, yaw, vx: 0, vy: 0, vz: 0 });
    const d = this.game!.driving;
    if (d.v?.id === id) d.snap(v);
    return true;
  }

  /** Floor height under (x, z) at or below y. */
  ground(x: number, z: number, y = 3) { return loadMap(this.game!.mapId).world.groundHeight(x, z, y, 0.3); }

  /**
   * Stage a fight: the local soldier at `me` (x, z, yaw) and the listed enemies around, facing it.
   * Soldiers not listed stay where they are unless `clear` removes them from the round.
   */
  stage(me: [number, number, number], enemies: [number, number][], opts: { clear?: 'enemies' | 'all' | 'none'; pin?: boolean; y?: number } = {}) {
    const st = this.state()!, mine = this.me()!;
    const my = this.ground(me[0], me[1], opts.y ?? 3);
    this.teleport(me[0], my, me[1], me[2]);
    const foes = st.soldiers.filter(s => s.team !== mine.team && s.bot);
    foes.forEach((s, i) => {
      const at = enemies[i];
      if (!at) { if (opts.clear !== 'none') { s.alive = false; s.health = 0; } return; }
      s.alive = true; s.health = 100;
      const y = this.ground(at[0], at[1], opts.y ?? 3);
      this.place(s.id, at[0], y, at[1], Math.atan2(-(me[0] - at[0]), -(me[1] - at[1])), !!opts.pin);
    });
    if (opts.clear === 'all') for (const s of st.soldiers) if (s.team === mine.team && s.bot) { s.alive = false; s.health = 0; }
    return foes.map(s => s.id);
  }

  /** Send a bot somewhere (it walks there by the navigation grid and fights on the way). */
  goal(id: number, x: number, z: number, seconds = 60) {
    const b = this.state()?.soldiers.find(s => s.id === id)?.brain;
    if (!b) return false;
    b.goal = 'roam'; b.goalX = x; b.goalZ = z; b.goalLeft = seconds; b.repath = 0; b.path = [];
    return true;
  }

  /** Open or close the store. */
  store(open: boolean) { const g = this.g; if (open) g.buymenu.show(this.game!.player.weapons[0]); else g.buymenu.close(); return g.buymenu.open; }

  /** Click the first element matching a selector (store tabs, items, the buy button). */
  click(selector: string) {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return false;
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 60) ?? true;
  }

  /** A drawn mouse pointer that glides to an element over `frames` (the store shot). */
  private pointer?: HTMLElement;
  cursor(selector: string | null, frames = 12) {
    if (!this.pointer) {
      this.pointer = document.createElement('div');
      this.pointer.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:30px;z-index:99999;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))';
      this.pointer.innerHTML = '<svg viewBox="0 0 22 30" width="22" height="30"><path d="M2 2 L2 24 L8 18.5 L12.5 28 L16 26.5 L11.6 17.2 L19.5 17 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';
      this.pointer.dataset.x = '960'; this.pointer.dataset.y = '700';
      document.body.appendChild(this.pointer);
    }
    const p = this.pointer;
    if (!selector) { p.style.display = 'none'; this.drivers.delete('cursor'); return true; }
    p.style.display = '';
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const x0 = Number(p.dataset.x), y0 = Number(p.dataset.y), x1 = r.left + Math.min(r.width * 0.5, 80), y1 = r.top + r.height * 0.55;
    let f = 0;
    this.drivers.set('cursor', () => {
      const u = ease(Math.min(1, ++f / frames));
      const x = x0 + (x1 - x0) * u, y = y0 + (y1 - y0) * u;
      p.style.transform = `translate(${x}px, ${y}px)`; p.dataset.x = String(x); p.dataset.y = String(y);
      if (f === frames) el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    return true;
  }
}

export function installTrailer(lb: ConstructorParameters<typeof Trailer>[0]) {
  window.__trailer = new Trailer(lb);
}
