import * as THREE from 'three';
import { hitShape, raycastSoldier } from '../../shared/hitbox';
import { loadMap } from '../../shared/maps/index';
import type { Vec3 } from '../../shared/math';
import type { MatchEvent, MatchState, Soldier } from '../../shared/match/state';
import { ECONOMY, WEAPONS, pelletCone, pelletDirs, type HitZone, type LoadoutId } from '../../shared/weapons';
import { PICKUP_REACH, canBuy } from '../../shared/match/economy';
import type { Assets } from '../assets';
import { Audio } from '../audio';
import { BodiesView } from '../render/bodies';
import { Effects } from '../render/effects';
import { InterpBuffer } from '../render/interp';
import { LevelView } from '../render/level';
import { PickupsView } from '../render/pickups';
import { THEMES } from '../render/materials';
import type { Renderer } from '../render/renderer';
import { SoldierView } from '../render/soldier';
import { ViewModel } from '../render/viewmodel';
import { BuyMenu } from '../ui/buymenu';
import { Hud } from '../ui/hud';
import { Input } from './input';
import type { GameLink } from './link';
import { LocalPlayer } from './player';
import { adsFov, settings } from './settings';

type Sample = { x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; pitch: number; crouch: number };
/** Remote soldiers closer than this get full animation and shadows; up to LOD_MID, half rate. */
const LOD_NEAR = 30, LOD_MID = 70;
/** Remote gunfire farther than this is not drawn or heard (a 100-soldier battle fires hundreds of shots a second). */
const SHOT_FX_RANGE = 110, SHOT_AUDIO_RANGE = 85;
const frustum = new THREE.Frustum(), projScreen = new THREE.Matrix4(), lodSphere = new THREE.Sphere(new THREE.Vector3(), 1.3);

interface Remote { view: SoldierView; buffer: InterpBuffer<Sample>; pos: THREE.Vector3; crouch: number; yaw: number; stepDist: number; last?: THREE.Vector3; loadout: LoadoutId }


/** One deployed match: rendering, local prediction, effects, HUD and the link to the match host. */
export class Game {
  readonly input: Input;
  readonly player = new LocalPlayer();
  private level: LevelView;
  private effects = new Effects();
  private bodies: BodiesView;
  private viewmodel: ViewModel;
  private remotes = new Map<number, Remote>();
  private hud: Hud;
  private buymenu: BuyMenu;
  private pickups: PickupsView;
  /** Game time of our last deployment (buy time counts from here). */
  private spawnedAt = 0;
  private map: ReturnType<typeof loadMap>;
  private lastVersion = -1;
  private time = 0;
  private reportTimer = 0;
  private hudTimer = 0;
  private mapTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private wasAlive = false;
  private corrections = 0;
  /** Remote gunshot sounds started this frame. */
  private shotVoices = 0;
  /** Online: hit markers already shown for predicted hits, so the server's confirmations don't repeat them. */
  /** Last muzzle report per remote shooter (pellet events share one report). */
  private lastReport = new Map<number, number>();
  private predictedHits: { at: number; target: number }[] = [];
  private lastLook = { x: 0, y: 0 };
  private deathCam = new THREE.Vector3();
  private lastStepPhase = 0;
  private running = true;
  private myTeam = 0;
  onExit?: () => void;
  /** Online servers rotate battlefields; the host page rebuilds the scene for the new map. */
  onMapChange?: (mapId: string) => void;
  readonly mapId: string;

  constructor(private assets: Assets, private renderer: Renderer, readonly link: GameLink, mapId: string, readonly audio: Audio, container: HTMLElement) {
    this.map = loadMap(mapId);
    this.mapId = mapId;
    const def = this.map.def;
    const theme = THEMES[def.theme];
    renderer.setTheme(theme, def.sun);
    this.level = new LevelView(assets, def, theme);
    renderer.scene.add(this.level.group, this.effects.group);
    this.bodies = new BodiesView(assets);
    renderer.scene.add(this.bodies.group);
    this.pickups = new PickupsView(assets, def.pickups);
    renderer.scene.add(this.pickups.group);
    this.input = new Input(renderer.renderer.domElement);
    this.input.sensitivity = settings.sensitivity;
    const me = link.state()?.soldiers.find(s => s.id === link.myId());
    this.myTeam = me?.team ?? 0;
    this.viewmodel = new ViewModel(assets, this.myTeam);
    renderer.viewCamera.add(this.viewmodel.root);
    this.hud = new Hud(container, def);
    this.hud.onLoadout = l => { this.link.setLoadout(l); this.audio.ui(); };
    this.hud.onMenu = () => this.onExit?.();
    this.buymenu = new BuyMenu(container, item => { this.link.buy(item); this.audio.ui(); });
    // The key that closed the menu must not reopen it next frame.
    this.buymenu.onClose = () => { this.input.clear(); void this.input.lock(); };
    this.input.canRelock = () => !this.buymenu.open;
    if (me) this.player.spawnFrom(me);
    if (import.meta.env.DEV) Object.assign(window, { __game: this });
  }

  stop(keepLink = false) {
    this.running = false;
    if (!keepLink) this.link.dispose();
    this.hud.dispose();
    this.buymenu.root.remove();
    this.renderer.scene.remove(this.level.group, this.effects.group, this.bodies.group, this.pickups.group);
    for (const r of this.remotes.values()) { r.view.dispose(); r.view.gun.removeFromParent(); }
    this.viewmodel.root.removeFromParent();
    this.input.dispose();
    this.hud.released(false, false);
    document.exitPointerLock?.();
  }

  frame(dt: number, render = true) {
    if (!this.running) return;
    this.input.beginFrame();
    const link = this.link;
    // Solo pauses while the mouse is released (Esc) during a live round: the frame still renders,
    // but no time passes for the match, the player or the effects.
    const before = link.state(), self = before?.soldiers.find(s => s.id === link.myId());
    if (link.mode === 'offline' && !this.input.locked && self?.alive && before?.phase !== 'ended') dt = 0;
    this.time += dt;
    link.update(dt);
    const state = link.state();
    if (!state) { this.renderer.render(this.time); return; }
    if (state.mapId !== this.mapId && this.onMapChange) { this.onMapChange(state.mapId); return; }
    const myId = link.myId();
    const me = state.soldiers.find(s => s.id === myId);
    const active = this.input.locked && !this.buymenu.open;
    // Mouse released while alive in a live round (online: the match keeps going).
    const released = !this.input.locked && !this.buymenu.open && !!me?.alive && state.phase !== 'ended';
    this.hud.released(released, link.mode === 'offline');

    // ---- Hotkeys ----
    if (active) {
      if (this.input.take('KeyB') && me?.alive) { this.buymenu.show(); this.input.clear(); }
      if (this.input.take('KeyE') && me?.alive) {
        const i = this.pickups.nearestWeapon(this.player.m.x, this.player.m.y, this.player.m.z, PICKUP_REACH, state.pickupLeft);
        if (i >= 0) { link.pickup(i); this.audio.ui(); }
      }
    }
    this.hud.scoreboard(this.input.down('Tab'), state, myId);

    // ---- Server reconciliation ----
    if (me) {
      this.myTeam = me.team;
      if (me.alive && !this.wasAlive) { this.player.spawnFrom(me); this.viewmodel.setWeapon(me.weapons[0]); this.spawnedAt = this.time; }
      else if (me.alive) this.player.syncGear(me);
      if (!me.alive) this.buymenu.close();
      if (!me.alive && this.wasAlive) { this.player.alive = false; this.deathCam.set(this.player.m.x, this.player.m.y + 1.6, this.player.m.z); }
      if (me.corrections !== this.corrections) { if (this.wasAlive && me.alive) this.player.correct(me); this.corrections = me.corrections; }
      this.wasAlive = me.alive;
    }

    // ---- Local player ----
    const look = active ? { x: this.input.lookX, y: this.input.lookY } : { x: 0, y: 0 };
    this.lastLook = look;
    const result = this.player.update(dt, active ? this.input : undefined, this.map.world, active && state.phase !== 'ended', false);
    if (result.move.jumped) this.audio.jump();
    if (result.move.landed > 4) this.audio.land(result.move.landed);
    if (result.move.slideStarted) this.audio.slide();
    if (this.player.m.grounded && this.player.speed() > 1 && Math.floor(this.player.bobPhase / Math.PI) !== this.lastStepPhase) {
      this.lastStepPhase = Math.floor(this.player.bobPhase / Math.PI);
      this.audio.footstep(undefined, undefined, this.player.sprinting);
    }
    if (result.reloadStarted) { link.reload(); this.audio.reload('out'); setTimeout(() => this.audio.reload('in'), this.player.weapon.reload * 650); setTimeout(() => this.audio.reload('charge'), this.player.weapon.reload * 880); }
    if (result.switched) link.switchWeapon(this.player.slot);
    if (result.dryFire) this.audio.dryFire();
    if (result.grenade) link.grenade(result.grenade.origin, result.grenade.dir);
    for (const shot of result.shots) this.shoot(shot.origin, shot.dir, shot.weapon.range, state);

    this.reportTimer -= dt;
    if (this.reportTimer <= 0 && me?.alive) {
      this.reportTimer = link.mode === 'online' ? 1 / 20 : 1 / 30;
      link.report(this.player.report());
    }

    // ---- Events ----
    this.shotVoices = 0;
    for (const e of link.drainEvents()) this.handleEvent(e, state, myId);

    // ---- World views ----
    const now = performance.now() / 1000;
    if (link.version() !== this.lastVersion) {
      this.lastVersion = link.version();
      this.syncRemotes(state, myId, now);
      this.bodies.sync(state.bodies, now);
    }
    const renderTime = now - link.interpDelay - 0.02;
    const positions = new Map<number, THREE.Vector3>();
    const byId = new Map(state.soldiers.map(s => [s.id, s]));
    // Crowd LOD: the view frustum (from last frame's camera) and distance decide how much work each
    // remote soldier gets; positions still update every frame so hit tests and markers stay exact.
    const cam0 = this.renderer.camera;
    frustum.setFromProjectionMatrix(projScreen.multiplyMatrices(cam0.projectionMatrix, cam0.matrixWorldInverse));
    for (const [id, r] of this.remotes) {
      const s = byId.get(id);
      const sample = r.buffer.sample(renderTime, ['yaw']);
      if (!s || !sample) continue;
      r.pos.set(sample.x, sample.y, sample.z); r.crouch = sample.crouch; r.yaw = sample.yaw;
      positions.set(id, r.pos);
      lodSphere.center.set(sample.x, sample.y + 1, sample.z);
      const distance = lodSphere.center.distanceTo(cam0.position);
      r.view.setLod(!frustum.intersectsSphere(lodSphere) ? 3 : distance < LOD_NEAR ? 0 : distance < LOD_MID ? 1 : 2);
      const w = s.weapons[s.weapon];
      r.view.update(dt, {
        x: sample.x, y: sample.y, z: sample.z, vx: sample.vx, vy: sample.vy, vz: sample.vz, yaw: sample.yaw, pitch: sample.pitch, crouch: sample.crouch,
        grounded: s.m.grounded, sprint: s.sprint, ads: s.ads, slide: s.m.slideTime > 0, alive: s.alive, weapon: w,
        reloading: s.reloadLeft > 0 ? 1 - s.reloadLeft / 2 : 0, firing: s.sinceShot < 0.15,
      });
      // Hide a soldier the camera is inside (crowded spawns, kill cam): clipping through a body looks broken.
      const cp = this.renderer.camera.position;
      const inside = Math.hypot(r.pos.x - cp.x, r.pos.z - cp.z) < 0.75 && cp.y > r.pos.y - 0.3 && cp.y < r.pos.y + 2.2;
      r.view.root.visible = !inside && r.view.onScreen;
      if (inside) r.view.gun.visible = false;
      // Remote footsteps.
      if (s.alive && s.m.grounded && r.last) {
        r.stepDist += r.last.distanceTo(r.pos);
        if (r.stepDist > (s.sprint ? 2.6 : 2.0)) {
          r.stepDist = 0;
          if (r.pos.distanceTo(this.renderer.camera.position) < 32) this.audio.footstep(this.listener(), r.pos, s.sprint);
        }
      }
      r.last = (r.last ?? new THREE.Vector3()).copy(r.pos);
    }
    this.bodies.update(dt, renderTime, this.time);
    this.pickups.update(this.time, state.pickupLeft);
    this.effects.update(dt);
    this.level.update(this.time);

    // ---- Camera ----
    const cam = this.renderer.camera;
    if (this.player.alive) {
      const eye = this.player.eye();
      const shake = this.player.shake;
      cam.position.set(eye.x + (Math.random() - 0.5) * shake * 0.05, eye.y + (Math.random() - 0.5) * shake * 0.05, eye.z);
      const bob = this.player.m.grounded ? Math.sin(this.player.bobPhase * 2) * 0.012 * Math.min(1, this.player.speed() / 6) * (1 - this.player.ads) : 0;
      cam.position.y += bob;
      const slideRoll = this.player.m.slideTime > 0 ? 0.06 : 0;
      cam.rotation.set(this.player.pitch + this.player.punchPitch * 0.01, this.player.yaw + this.player.punchYaw, slideRoll, 'YXZ');
      const w = this.player.weapon;
      const base = settings.fov;
      const targetFov = base + (adsFov(w) - base) * this.player.ads + (this.player.sprinting ? 6 : 0) + (this.player.m.slideTime > 0 ? 4 : 0);
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 14);
      cam.updateProjectionMatrix();
      this.renderer.viewCamera.fov = 58 - this.player.ads * (w.category === 'sniper' ? 0 : 10);
      this.renderer.viewCamera.updateProjectionMatrix();
      // update() also decides visibility: a full-zoom scope hides the weapon behind the HUD reticle.
      this.viewmodel.update(dt, this.player, look);
    } else {
      // Kill cam: rise above the body and look toward the killer.
      const killer = me ? positions.get(me.lastAttacker) : undefined;
      this.deathCam.y += (this.player.m.y + 4 - this.deathCam.y) * Math.min(1, dt * 1.5);
      cam.position.lerp(this.deathCam, Math.min(1, dt * 3));
      cam.lookAt(killer ? killer.clone().setY(killer.y + 1.2) : new THREE.Vector3(this.player.m.x, this.player.m.y, this.player.m.z));
      cam.fov += (settings.fov - cam.fov) * Math.min(1, dt * 5); cam.updateProjectionMatrix();
      this.viewmodel.root.visible = false;
    }
    this.hud.scope(this.viewmodel.scopeVisible);
    const velocity = new THREE.Vector3(this.player.m.vx, this.player.m.vy, this.player.m.vz);
    if (render) this.renderer.render(this.time);

    // ---- HUD ----
    this.hud.frame(dt, this.player, state, me, cam, positions);
    this.hudTimer -= dt; this.mapTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.hud.tick(this.player, state, me, this.map.def.points);
      // Buy time counts from our own deployment (the host checks the same rule).
      const since = this.time - this.spawnedAt;
      const buyable = !!me && canBuy({ ...me, sinceSpawn: since }, this.map.def) && state.phase !== 'ended';
      this.buymenu.update(me, buyable, ECONOMY.buyTime - since);
      this.hud.buyHint(buyable && !this.buymenu.open);
      const near = me?.alive ? this.pickups.nearestWeapon(this.player.m.x, this.player.m.y, this.player.m.z, PICKUP_REACH, state.pickupLeft) : -1;
      const item = near >= 0 ? this.map.def.pickups![near].item : undefined;
      this.hud.prompt(item && item in WEAPONS ? `<kbd>E</kbd> PICK UP ${WEAPONS[item as keyof typeof WEAPONS].name.toUpperCase()}` : '');
      this.hud.net(link.status());
    }
    if (this.mapTimer <= 0) { this.mapTimer = 0.1; this.hud.minimap(state, me, this.player.yaw, positions, new THREE.Vector3(this.player.m.x, 0, this.player.m.z)); }
    this.fpsFrames++; this.fpsTime += dt;
    if (this.fpsTime > 1) { this.hud.fps(`${Math.round(this.fpsFrames / this.fpsTime)} FPS · ${this.renderer.renderer.info.render.calls} calls`); this.fpsFrames = 0; this.fpsTime = 0; }
    this.input.endFrame();
  }

  private listener() { return { pos: this.renderer.camera.position, yaw: this.player.yaw }; }

  private syncRemotes(state: MatchState, myId: number, now: number) {
    const seen = new Set<number>();
    for (const s of state.soldiers) {
      if (s.id === myId) continue;
      seen.add(s.id);
      let r = this.remotes.get(s.id);
      if (!r || r.loadout !== s.loadout && !this.hasGuns(r, s)) {
        if (r) { r.view.dispose(); r.view.gun.removeFromParent(); }
        const view = new SoldierView(this.assets, s.team, s.loadout);
        this.renderer.scene.add(view.root, view.gun);
        r = { view, buffer: new InterpBuffer(), pos: new THREE.Vector3(s.m.x, s.m.y, s.m.z), crouch: 0, yaw: s.yaw, stepDist: 0, loadout: s.loadout };
        this.remotes.set(s.id, r);
      }
      // Teleports (respawns) should not interpolate across the map.
      const last = r.buffer.latest();
      if (last && Math.hypot(last.x - s.m.x, last.z - s.m.z) > 6) r.buffer.clear();
      r.buffer.push(now, { x: s.m.x, y: s.m.y, z: s.m.z, vx: s.m.vx, vy: s.m.vy, vz: s.m.vz, yaw: s.yaw, pitch: s.pitch, crouch: s.m.crouch });
    }
    for (const [id, r] of this.remotes) if (!seen.has(id)) { r.view.dispose(); r.view.gun.removeFromParent(); this.remotes.delete(id); }
  }

  private hasGuns(r: Remote, s: Soldier) { r.view.setLoadout(this.assets, s.loadout); r.loadout = s.loadout; return true; }

  /** Client-side hitscan against what this player sees; the host validates the claim. */
  private shoot(origin: Vec3, dir: Vec3, range: number, state: MatchState) {
    const w = this.player.weapon;
    // Feel: muzzle flash, recoil, sound.
    this.viewmodel.fire();
    this.audio.gunshot(w.id);
    const cam = this.renderer.camera;
    cam.updateMatrixWorld();
    const muzzle = this.viewmodel.muzzleWorld(cam, this.renderer.viewCamera);
    this.effects.flash(muzzle, w.projectile ? 0xb48cff : 0xffc070, 4, 0.05, 7);
    if (w.projectile) {
      // The host launches the charge; it arrives with the next snapshot.
      this.link.fire({ weapon: this.player.slot, origin, dir, target: -1, zone: '', point: origin });
      return;
    }
    const traces = (w.pellets > 1 ? pelletDirs(dir, pelletCone(w, this.player.ads > 0.5), w.pellets) : [dir]).map(d => this.trace(origin, d, range, state));
    // Claim the soldier most pellets hit; the host re-traces a pellet pattern from that claim.
    const counts = new Map<number, number>();
    for (const t of traces) if (t.target >= 0) counts.set(t.target, (counts.get(t.target) ?? 0) + 1);
    const target = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
    const claimed = traces.find(t => t.target === target) ?? traces[0];
    this.link.fire({ weapon: this.player.slot, origin, dir, target: claimed.target, zone: claimed.zone, point: claimed.point });
    traces.forEach((t, i) => {
      const end = new THREE.Vector3(t.point.x, t.point.y, t.point.z);
      const tracer = w.pellets > 1 ? i % 3 === 0 : Math.random() < (w.auto ? 0.5 : 1);
      if (tracer) this.effects.tracer(muzzle, end, 0xffe2a0, w.category === 'sniper' ? 2.5 : 1);
      if (t.target >= 0) this.effects.hitSpark(end, (state.soldiers.find(s => s.id === t.target)?.shield ?? 0) > 0);
      else if (t.wall) this.effects.impact(end, new THREE.Vector3(t.wall.normal.x, t.wall.normal.y, t.wall.normal.z), t.wall.surface, i < 3, cam.position);
    });
    if (target >= 0) {
      const victim = state.soldiers.find(s => s.id === target);
      const head = traces.some(t => t.target === target && t.zone === 'head');
      // Online, waiting a round trip for the marker feels laggy: show it now; the server's damage
      // event (validated) is then absorbed instead of repeated. Spawn-protected targets take no damage.
      if (this.link.mode === 'online' && victim && victim.protectLeft <= 0) {
        this.hud.hit(head ? 'head' : 'body');
        this.audio.hitmarker(head, false);
        this.predictedHits.push({ at: performance.now(), target });
      }
    }
  }

  /** One ray against the world and enemy soldiers as rendered. */
  private trace(origin: Vec3, dir: Vec3, range: number, state: MatchState) {
    const wall = this.map.world.raycast(origin, dir, range, this.myTeam);
    let best = wall ? wall.t : range;
    let target = -1, zone: HitZone | '' = '';
    for (const [id, r] of this.remotes) {
      const s = state.soldiers.find(x => x.id === id);
      if (!s || !s.alive || s.team === this.myTeam) continue;
      const hit = raycastSoldier(origin, dir, hitShape(r.pos, r.crouch, r.yaw));
      if (hit && hit.t < best) { best = hit.t; target = id; zone = hit.zone; }
    }
    const point = { x: origin.x + dir.x * best, y: origin.y + dir.y * best, z: origin.z + dir.z * best };
    return { point, target, zone, wall: target < 0 ? wall : null };
  }

  private handleEvent(e: MatchEvent, state: MatchState, myId: number) {
    const find = (id: number) => state.soldiers.find(s => s.id === id);
    switch (e.type) {
      case 'shot': {
        if (e.shooter === myId) break;
        const r = this.remotes.get(e.shooter);
        const cam = this.renderer.camera.position;
        const shooterDistance = Math.hypot(e.from.x - cam.x, e.from.y - cam.y, e.from.z - cam.z);
        // A scattergun blast arrives as one event per pellet: one report and muzzle flash per trigger pull.
        const now = performance.now(), pellet = now - (this.lastReport.get(e.shooter) ?? -1e9) < 40;
        this.lastReport.set(e.shooter, now);
        if (!pellet) r?.view.shoot();
        if (shooterDistance > SHOT_FX_RANGE && Math.hypot(e.to.x - cam.x, e.to.y - cam.y, e.to.z - cam.z) > SHOT_FX_RANGE) break;
        const from = r?.view.onScreen ? r.view.muzzleWorld() : new THREE.Vector3(e.from.x, e.from.y, e.from.z);
        // Cap remote gunshot voices per frame: each one is several WebAudio nodes.
        if (!pellet && shooterDistance < SHOT_AUDIO_RANGE && this.shotVoices++ < 6) this.audio.gunshot(e.weapon, this.listener(), from);
        const to = new THREE.Vector3(e.to.x, e.to.y, e.to.z);
        if (e.from.x === e.to.x && e.from.y === e.to.y && e.from.z === e.to.z) break;
        if (!pellet || e.hit || Math.random() < 0.3) this.effects.tracer(from, to, find(e.shooter)?.team === 0 ? 0xa8dcff : 0xffb0a0, 1.2);
        if (e.hit === 0) this.effects.impact(to, from.clone().sub(to).normalize(), e.surface, !pellet);
        else this.effects.hitSpark(to, false);
        break;
      }
      case 'damage': {
        if (e.attacker === myId && e.target !== myId) {
          const now = performance.now();
          this.predictedHits = this.predictedHits.filter(h => now - h.at < 1000);
          const shown = e.zone === 'blast' ? -1 : this.predictedHits.findIndex(h => h.target === e.target);
          if (shown >= 0) this.predictedHits.splice(shown, 1);
          else {
            this.hud.hit(e.zone === 'head' ? 'head' : 'body');
            this.audio.hitmarker(e.zone === 'head', false);
          }
        }
        if (e.target === myId) {
          const angle = Math.atan2(-(e.x - this.player.m.x), -(e.z - this.player.m.z));
          this.hud.damage(angle);
          this.audio.damage((find(myId)?.shield ?? 0) > 0);
          if (e.shieldBroke) this.audio.shieldBreak();
          this.player.shake = Math.min(3, this.player.shake + e.amount * 0.05);
          this.player.punchVel -= e.amount * 0.08;
        } else {
          const r = this.remotes.get(e.target);
          if (r) r.view.hit(Math.random() < 0.5);
        }
        break;
      }
      case 'kill': {
        const killer = find(e.killer), victim = find(e.victim);
        this.hud.killfeed(killer, victim, e.weapon, e.head, e.killer === myId || e.victim === myId);
        if (e.killer === myId && e.victim !== myId) {
          this.hud.hit('kill'); this.audio.hitmarker(e.head, true);
          this.hud.popScore(`${e.head ? 'HEADSHOT ' : ''}+${e.head ? 125 : 100}`);
        }
        if (e.victim === myId) this.hud.announce('NEUTRALIZED', killer ? `by ${killer.name}` : '', 'var(--crimson)');
        break;
      }
      case 'capture': {
        const ours = e.team === this.myTeam;
        const name = this.map.def.points.find(p => p.id === e.point)?.name ?? e.point;
        this.hud.announce(`${e.point} ${ours ? 'SECURED' : 'LOST'}`, name, e.team === 0 ? 'var(--aegis)' : 'var(--crimson)');
        this.audio.capture(ours);
        break;
      }
      case 'neutralize': this.hud.toast(`${e.point} neutralized`); this.audio.tick(); break;
      case 'explosion': {
        const at = new THREE.Vector3(e.x, e.y, e.z);
        if (e.weapon === 'graviton') { this.effects.explosion(at, 0.8); this.effects.burst(at, 0xb48cff); }
        else this.effects.explosion(at);
        this.audio.explosion(this.listener(), at);
        const d = at.distanceTo(this.renderer.camera.position);
        if (d < 18) this.player.shake = Math.min(4, this.player.shake + (18 - d) * 0.25);
        break;
      }
      case 'phase': {
        if (e.phase === 'live') this.hud.announce('OPERATION LIVE', `Capture ${this.map.def.points.map(p => p.id).join(' · ')}`, 'var(--accent)');
        if (e.phase === 'warmup') this.hud.announce('NEW ROUND', this.map.def.name);
        break;
      }
      case 'join': if (e.id !== myId && !find(e.id)?.bot) this.hud.toast(`${e.name} joined ${e.team === 0 ? 'Aegis' : 'Crimson'}`); break;
      case 'leave': break;
      case 'spawn': {
        const s = find(e.id);
        if (s && e.id !== myId) this.effects.burst(new THREE.Vector3(s.m.x, s.m.y + 1, s.m.z), s.team === 0 ? 0x58b6ff : 0xff5a4a);
        break;
      }
    }
  }
}
