import * as THREE from 'three';
import { hitShape, raycastSoldier } from '../../shared/hitbox';
import { loadMap } from '../../shared/maps/index';
import type { Vec3 } from '../../shared/math';
import { eyeHeight } from '../../shared/movement';
import { ATTACKERS, TEAM_NAMES, type MatchEvent, type MatchState, type Soldier } from '../../shared/match/state';
import { pelletCone, pelletDirs, weaponStats, type HitZone, type WeaponId } from '../../shared/weapons';
import { CASH, CRATE_REACH, canBuyWeapons, inBase } from '../../shared/match/economy';
import { sideOf } from '../../shared/match/combat';
import { BOMB_REACH, modeOf } from '../../shared/match/sim';
import type { Assets } from '../assets';
import { Audio } from '../audio';
import { BodiesView } from '../render/bodies';
import { BombSitesView } from '../render/bombsite';
import { Effects } from '../render/effects';
import { InterpBuffer } from '../render/interp';
import { LevelView } from '../render/level';
import { CratesView } from '../render/pickups';
import { THEMES } from '../render/materials';
import type { Renderer } from '../render/renderer';
import { SoldierView } from '../render/soldier';
import { ViewModel } from '../render/viewmodel';
import { BuyMenu } from '../ui/buymenu';
import { Hud } from '../ui/hud';
import { Input } from './input';
import type { GameLink } from './link';
import { LocalPlayer } from './player';
import { settings } from './settings';

type Sample = { x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; pitch: number; crouch: number };
/** Remote soldiers closer than this get full animation and shadows; up to LOD_MID, half rate. */
const LOD_NEAR = 30, LOD_MID = 70;
/** Remote gunfire farther than this is not drawn or heard. */
const SHOT_FX_RANGE = 110, SHOT_AUDIO_RANGE = 85;
const frustum = new THREE.Frustum(), projScreen = new THREE.Matrix4(), lodSphere = new THREE.Sphere(new THREE.Vector3(), 1.3);

interface Remote { view: SoldierView; buffer: InterpBuffer<Sample>; pos: THREE.Vector3; crouch: number; yaw: number; pitch: number; stepDist: number; last?: THREE.Vector3 }

const REASONS: Record<string, string> = { eliminated: 'Team eliminated', time: 'Time ran out', armed: 'Bomb armed', disarmed: 'Bomb disarmed', exploded: 'Target destroyed' };

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
  private crates: CratesView;
  private sites: BombSitesView;
  private map: ReturnType<typeof loadMap>;
  private lastVersion = -1;
  private time = 0;
  private reportTimer = 0;
  private hudTimer = 0;
  private mapTimer = 0;
  private heartTimer = 0;
  private beepTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private wasAlive = false;
  private corrections = 0;
  /** Weapon (and attachments) the view model shows, to rebuild it only on change. */
  private shownWeapon = '';
  /** Remote gunshot sounds started this frame. */
  private shotVoices = 0;
  /** Last muzzle report per remote shooter (pellet events share one report). */
  private lastReport = new Map<number, number>();
  /** Online: hit markers already shown for predicted hits, so the server's confirmations don't repeat them. */
  private predictedHits: { at: number; target: number }[] = [];
  private deathCam = new THREE.Vector3();
  /** Dead: the soldier whose eyes we watch (the killer first; right click cycles). */
  private spectating = -1;
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
    this.crates = new CratesView(assets, def.pickups);
    this.sites = new BombSitesView(def);
    renderer.scene.add(this.crates.group, this.sites.group);
    this.input = new Input(renderer.renderer.domElement);
    this.input.sensitivity = settings.sensitivity;
    const me = link.state()?.soldiers.find(s => s.id === link.myId());
    this.myTeam = me?.team ?? 0;
    this.viewmodel = new ViewModel(assets, this.myTeam);
    renderer.viewCamera.add(this.viewmodel.root);
    this.hud = new Hud(container, def);
    this.hud.onMenu = () => this.onExit?.();
    this.buymenu = new BuyMenu(container, {
      buy: item => { this.link.buy(item); this.audio.ui(); },
      attach: (weapon, attachment) => { this.link.attach(weapon, attachment); this.audio.ui(); },
    });
    // The key that closed the menu must not reopen it next frame.
    this.buymenu.onClose = () => { this.input.clear(); void this.input.lock(); };
    this.input.canRelock = () => !this.buymenu.open && !this.hud.chatting;
    if (me) this.player.spawnFrom(me);
    if (import.meta.env.DEV) Object.assign(window, { __game: this });
  }

  stop(keepLink = false) {
    this.running = false;
    if (!keepLink) this.link.dispose();
    this.hud.dispose();
    this.buymenu.root.remove();
    this.renderer.scene.remove(this.level.group, this.effects.group, this.bodies.group, this.crates.group, this.sites.group);
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
    // Solo pauses while the mouse is released (Esc) mid-match: the frame still renders, but no time passes.
    const before = link.state(), self = before?.soldiers.find(s => s.id === link.myId());
    if (link.mode === 'offline' && !this.input.locked && !this.buymenu.open && !this.hud.chatting && self?.alive && before?.phase !== 'ended') dt = 0;
    this.time += dt;
    link.update(dt);
    const state = link.state();
    if (!state) { this.renderer.render(this.time); return; }
    if (state.mapId !== this.mapId && this.onMapChange) { this.onMapChange(state.mapId); return; }
    const myId = link.myId();
    const me = state.soldiers.find(s => s.id === myId);
    const sabotage = modeOf(state, this.map.def) === 'sabotage';
    const active = this.input.locked && !this.buymenu.open && !this.hud.chatting;
    const released = !this.input.locked && !this.buymenu.open && !this.hud.chatting && !!me?.alive && state.phase !== 'ended';
    this.hud.released(released, link.mode === 'offline');
    const side = me ? sideOf(state, this.map.def, me.team) : 0;
    const buyWindow = !!me && state.phase === 'live' && canBuyWeapons(state, this.map.def, me, side);

    // ---- Hotkeys ----
    if (active) {
      // The store is open anywhere: weapons only sell in base during buy time, attachments always.
      if (this.input.take('KeyB') && me) { this.buymenu.show(); this.input.clear(); }
      const chat = this.input.take('Enter') ? false : this.input.take('KeyT') ? true : undefined;
      if (chat !== undefined) { this.input.clear(); this.hud.openChat(chat, text => this.link.say(text, chat)); }
      if (this.input.take('KeyE') && me?.alive) {
        const i = this.crates.nearest(this.player.m.x, this.player.m.y, this.player.m.z, CRATE_REACH);
        if (i >= 0) { link.useCrate(i); this.audio.ui(); }
      }
    }
    this.hud.scoreboard(this.input.down('Tab'), state, myId);

    // ---- Server reconciliation ----
    if (me) {
      this.myTeam = me.team;
      if (me.alive && !this.wasAlive) { this.player.spawnFrom(me); this.spectating = -1; this.shownWeapon = ''; }
      else if (me.alive) this.player.syncGear(me);
      if (!me.alive && this.wasAlive) {
        this.player.alive = false;
        this.deathCam.set(this.player.m.x, this.player.m.y + 1.6, this.player.m.z);
        this.spectating = me.lastAttacker;
      }
      if (me.corrections !== this.corrections) { if (this.wasAlive && me.alive) this.player.correct(me); this.corrections = me.corrections; }
      this.wasAlive = me.alive;
    }
    const held = this.player.slot === 2 ? 'knife' : this.player.weapons[this.player.slot];
    const shown = `${held}|${JSON.stringify(this.player.attachments[held] ?? {})}`;
    if (shown !== this.shownWeapon) { this.viewmodel.setWeapon(held, this.player.attachments[held] ?? {}, !this.shownWeapon); this.shownWeapon = shown; }

    // ---- Bomb: hold E still on a site ----
    const site = sabotage && me?.alive ? this.siteHere(state) : -1;
    const myJob = state.bomb.armed ? me?.team !== ATTACKERS && site === state.bomb.site : me?.team === ATTACKERS && site >= 0;
    this.player.using = active && myJob && state.roundPhase === 'live' && this.input.down('KeyE');
    this.player.frozen = state.phase === 'live' && state.roundPhase === 'freeze' && !state.config.practice;

    // ---- Local player ----
    const look = active ? { x: this.input.lookX, y: this.input.lookY } : { x: 0, y: 0 };
    const result = this.player.update(dt, active ? this.input : undefined, this.map.world, active && state.phase !== 'ended', this.player.frozen || state.roundPhase === 'over');
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
    if (result.zoomed) this.player.binoculars ? this.audio.binoculars() : this.audio.ui();
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
    // Crowd LOD: the view frustum (from last frame's camera) and distance decide how much work each remote gets.
    const cam0 = this.renderer.camera;
    frustum.setFromProjectionMatrix(projScreen.multiplyMatrices(cam0.projectionMatrix, cam0.matrixWorldInverse));
    for (const [id, r] of this.remotes) {
      const s = byId.get(id);
      const sample = r.buffer.sample(renderTime, ['yaw']);
      if (!s || !sample) continue;
      r.pos.set(sample.x, sample.y, sample.z); r.crouch = sample.crouch; r.yaw = sample.yaw; r.pitch = sample.pitch;
      positions.set(id, r.pos);
      lodSphere.center.set(sample.x, sample.y + 1, sample.z);
      const distance = lodSphere.center.distanceTo(cam0.position);
      r.view.setLod(!frustum.intersectsSphere(lodSphere) ? 3 : distance < LOD_NEAR ? 0 : distance < LOD_MID ? 1 : 2);
      const weapon: WeaponId = s.weapon === 2 ? 'knife' : s.weapons[s.weapon];
      r.view.update(dt, {
        x: sample.x, y: sample.y, z: sample.z, vx: sample.vx, vy: sample.vy, vz: sample.vz, yaw: sample.yaw, pitch: sample.pitch, crouch: sample.crouch,
        grounded: s.m.grounded, sprint: s.sprint, ads: s.ads, slide: s.m.slideTime > 0, alive: s.alive, weapon, attachments: s.attachments[weapon], using: s.using,
        reloading: s.reloadLeft > 0 ? 1 - s.reloadLeft / 2 : 0, firing: s.sinceShot < 0.15,
      });
      // Hide a soldier the camera is inside (crowded bases, spectating): clipping through a body looks broken.
      const cp = this.renderer.camera.position;
      const inside = Math.hypot(r.pos.x - cp.x, r.pos.z - cp.z) < 0.75 && cp.y > r.pos.y - 0.3 && cp.y < r.pos.y + 2.2;
      r.view.root.visible = !inside && r.view.onScreen;
      if (inside) r.view.gun.visible = false;
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
    this.crates.update(this.time);
    this.sites.update(this.time, state.bomb, sabotage);
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
      const targetFov = base + (this.player.aimFov - base) * this.player.ads + (this.player.sprinting ? 6 : 0) + (this.player.m.slideTime > 0 ? 4 : 0);
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 14);
      cam.updateProjectionMatrix();
      this.renderer.viewCamera.fov = 58 - this.player.ads * (w.class === 'sniper' ? 0 : 10);
      this.renderer.viewCamera.updateProjectionMatrix();
      // update() also decides visibility: a full-zoom scope or binoculars hide the weapon.
      this.viewmodel.update(dt, this.player, look);
      this.hud.spectate(undefined, 0);
    } else {
      this.spectate(state, me, positions, dt, active);
      this.viewmodel.root.visible = false;
    }
    const mag = this.player.magnification;
    this.hud.scope(this.player.alive && this.viewmodel.scopeVisible, mag, this.viewmodel.overlay);
    this.hud.binoculars(this.player.alive && this.player.binoculars && this.player.ads > 0.5, mag);
    this.hud.zoomTag(this.player.alive && !this.player.binoculars && !this.viewmodel.overlay && this.player.ads > 0.85 && mag >= 1.5 ? mag : undefined);
    if (render) this.renderer.render(this.time);

    // ---- HUD ----
    this.hud.frame(dt, this.player, state, me, cam, positions);
    if (me?.alive && me.health < 25) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) { this.heartTimer = 0.9; this.audio.heartbeat(); }
    }
    if (sabotage && state.bomb.armed && state.roundPhase === 'live') {
      // The bomb beeps faster as it nears zero.
      this.beepTimer -= dt;
      if (this.beepTimer <= 0) { this.beepTimer = Math.max(0.12, Math.min(1, state.phaseLeft / 40)); this.audio.bombBeep(); }
    }
    this.hudTimer -= dt; this.mapTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.hud.tick(this.player, state, me);
      const free = !!state.config.freeBuy;
      const buyLeft = free ? -1 : Math.max(0, state.config.buyTime - state.roundClock);
      this.buymenu.update(me, buyWindow, buyLeft, free);
      const showBuy = !!me && buyWindow && (free || !me.alive || inBase(me, this.map.def, side)) && !this.buymenu.open;
      this.hud.buyHint(showBuy ? (free ? 'B STORE' : `B STORE · ${Math.ceil(buyLeft)}s`) : undefined);
      this.hud.prompt(this.promptText(state, me, site, myJob));
      const bomb = state.bomb;
      const mine = bomb.by === myId && bomb.progress > 0;
      this.hud.progress(mine ? (bomb.armed ? 'DISARMING' : 'ARMING') : undefined, bomb.progress);
      this.hud.matchEnd(state, this.myTeam, state.phase === 'ended' ? link.leaderboard?.() : undefined);
      this.hud.net(link.status());
    }
    if (this.mapTimer <= 0) { this.mapTimer = 0.1; this.hud.minimap(state, me, this.player.yaw, positions, new THREE.Vector3(this.player.m.x, 0, this.player.m.z)); }
    this.fpsFrames++; this.fpsTime += dt;
    if (this.fpsTime > 1) { this.hud.fps(`${Math.round(this.fpsFrames / this.fpsTime)} FPS · ${this.renderer.renderer.info.render.calls} calls`); this.fpsFrames = 0; this.fpsTime = 0; }
    this.input.endFrame();
  }

  /** Index of the bomb site the player stands on (within reach of its centre), or -1. */
  private siteHere(state: MatchState) {
    const sites = this.map.def.sabotage?.sites ?? [];
    const m = this.player.m;
    return sites.findIndex(id => {
      const p = this.map.def.points.find(x => x.id === id);
      return !!p && Math.hypot(p.x - m.x, p.z - m.z) < BOMB_REACH && (!state.bomb.armed || state.bomb.site === sites.indexOf(id));
    });
  }

  private promptText(state: MatchState, me: Soldier | undefined, site: number, myJob: boolean) {
    if (!me?.alive || state.roundPhase !== 'live') return '';
    if (site >= 0 && myJob) return `HOLD <kbd>E</kbd> TO ${state.bomb.armed ? 'DISARM THE BOMB' : `ARM THE BOMB AT ${this.map.def.sabotage!.sites[site]}`}`;
    if (this.crates.nearest(this.player.m.x, this.player.m.y, this.player.m.z, CRATE_REACH) >= 0 && this.player.slot !== 2) {
      return `<kbd>E</kbd> AMMO CRATE${me.round.crate || state.config.freeBuy ? '' : ` ($${CASH.crate})`}`;
    }
    return '';
  }

  /** Dead: watch through a living soldier's eyes (the killer first; right click cycles), else an overview. */
  private spectate(state: MatchState, me: Soldier | undefined, positions: Map<number, THREE.Vector3>, dt: number, active: boolean) {
    const cam = this.renderer.camera;
    const living = state.soldiers.filter(s => s.alive && s.id !== me?.id && positions.has(s.id));
    if (active && this.input.take('Mouse2') && living.length) {
      const i = living.findIndex(s => s.id === this.spectating);
      this.spectating = living[(i + 1) % living.length].id;
    }
    let target = living.find(s => s.id === this.spectating);
    // The watched soldier died: follow a teammate, then anyone.
    if (!target && living.length) { target = living.find(s => s.team === me?.team) ?? living[0]; this.spectating = target.id; }
    const r = target ? this.remotes.get(target.id) : undefined;
    if (target && r) {
      cam.position.set(r.pos.x, r.pos.y + eyeHeight({ crouch: r.crouch }), r.pos.z);
      cam.rotation.set(r.pitch, r.yaw, 0, 'YXZ');
      r.view.root.visible = false; r.view.gun.visible = false;
      this.hud.spectate(target.name, target.team);
    } else {
      this.deathCam.y += (this.player.m.y + 4 - this.deathCam.y) * Math.min(1, dt * 1.5);
      cam.position.lerp(this.deathCam, Math.min(1, dt * 3));
      cam.lookAt(new THREE.Vector3(this.player.m.x, this.player.m.y, this.player.m.z));
      this.hud.spectate(undefined, 0);
    }
    cam.fov += (settings.fov - cam.fov) * Math.min(1, dt * 5); cam.updateProjectionMatrix();
  }

  private listener() { return { pos: this.renderer.camera.position, yaw: this.player.yaw }; }

  private syncRemotes(state: MatchState, myId: number, now: number) {
    const seen = new Set<number>();
    for (const s of state.soldiers) {
      if (s.id === myId) continue;
      seen.add(s.id);
      let r = this.remotes.get(s.id);
      if (!r || r.view.team !== s.team) {
        if (r) { r.view.dispose(); r.view.gun.removeFromParent(); }
        const view = new SoldierView(this.assets, s.team);
        this.renderer.scene.add(view.root, view.gun);
        r = { view, buffer: new InterpBuffer(), pos: new THREE.Vector3(s.m.x, s.m.y, s.m.z), crouch: 0, yaw: s.yaw, pitch: 0, stepDist: 0 };
        this.remotes.set(s.id, r);
      }
      // New rounds teleport everyone home: never interpolate across the map.
      const last = r.buffer.latest();
      if (last && Math.hypot(last.x - s.m.x, last.z - s.m.z) > 6) r.buffer.clear();
      r.buffer.push(now, { x: s.m.x, y: s.m.y, z: s.m.z, vx: s.m.vx, vy: s.m.vy, vz: s.m.vz, yaw: s.yaw, pitch: s.pitch, crouch: s.m.crouch });
    }
    for (const [id, r] of this.remotes) if (!seen.has(id)) { r.view.dispose(); r.view.gun.removeFromParent(); this.remotes.delete(id); }
  }

  /** Client-side hitscan (or knife strike) against what this player sees; the host validates the claim. */
  private shoot(origin: Vec3, dir: Vec3, range: number, state: MatchState) {
    const w = this.player.weapon;
    const melee = w.class === 'melee';
    this.viewmodel.fire();
    const cam = this.renderer.camera;
    cam.updateMatrixWorld();
    const muzzle = this.viewmodel.muzzleWorld(cam, this.renderer.viewCamera);
    if (!melee) {
      this.audio.gunshot(w.id, undefined, undefined, w.suppressed);
      if (!w.suppressed) this.effects.flash(muzzle, 0xffc070, 4, 0.05, 7);
    }
    const traces = (w.pellets > 1 ? pelletDirs(dir, pelletCone(w, this.player.ads > 0.5), w.pellets) : [dir]).map(d => this.trace(origin, d, range, state));
    // Claim the soldier most pellets hit; the host re-traces a pellet pattern from that claim.
    const counts = new Map<number, number>();
    for (const t of traces) if (t.target >= 0) counts.set(t.target, (counts.get(t.target) ?? 0) + 1);
    const target = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
    const claimed = traces.find(t => t.target === target) ?? traces[0];
    this.link.fire({ weapon: this.player.slot, origin, dir, target: claimed.target, zone: claimed.zone, point: claimed.point });
    if (melee) this.audio.knife(target >= 0);
    traces.forEach((t, i) => {
      const end = new THREE.Vector3(t.point.x, t.point.y, t.point.z);
      if (melee) { if (t.target >= 0) this.effects.hitSpark(end, false); return; }
      const tracer = !w.suppressed && (w.pellets > 1 ? i % 3 === 0 : Math.random() < (w.auto ? 0.5 : 1));
      if (tracer) this.effects.tracer(muzzle, end, 0xffe2a0, w.class === 'sniper' ? 2.5 : 1);
      if (t.target >= 0) this.effects.hitSpark(end, false);
      else if (t.wall) this.effects.impact(end, new THREE.Vector3(t.wall.normal.x, t.wall.normal.y, t.wall.normal.z), t.wall.surface, i < 3, cam.position);
    });
    if (target >= 0 && this.link.mode === 'online') {
      // Waiting a round trip for the marker feels laggy: show it now; the server's damage event is then absorbed.
      const head = traces.some(t => t.target === target && t.zone === 'head');
      this.hud.hit(head ? 'head' : 'body');
      this.audio.hitmarker(head, false);
      this.predictedHits.push({ at: performance.now(), target });
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
    const me = find(myId);
    switch (e.type) {
      case 'shot': {
        if (e.shooter === myId) break;
        const r = this.remotes.get(e.shooter), shooter = find(e.shooter);
        const cam = this.renderer.camera.position;
        const shooterDistance = Math.hypot(e.from.x - cam.x, e.from.y - cam.y, e.from.z - cam.z);
        if (e.weapon === 'knife') { r?.view.shoot(); if (shooterDistance < 12) this.audio.knife(e.hit > 0); break; }
        const suppressed = !!shooter && weaponStats(e.weapon, shooter.attachments[e.weapon]).suppressed;
        // A shotgun blast arrives as one event per pellet: one report and muzzle flash per trigger pull.
        const now = performance.now(), pellet = now - (this.lastReport.get(e.shooter) ?? -1e9) < 40;
        this.lastReport.set(e.shooter, now);
        if (!pellet) r?.view.shoot();
        if (shooterDistance > SHOT_FX_RANGE && Math.hypot(e.to.x - cam.x, e.to.y - cam.y, e.to.z - cam.z) > SHOT_FX_RANGE) break;
        const from = r?.view.onScreen ? r.view.muzzleWorld() : new THREE.Vector3(e.from.x, e.from.y, e.from.z);
        if (!pellet && shooterDistance < SHOT_AUDIO_RANGE * (suppressed ? 0.4 : 1) && this.shotVoices++ < 6) this.audio.gunshot(e.weapon, this.listener(), from, suppressed);
        const to = new THREE.Vector3(e.to.x, e.to.y, e.to.z);
        if (e.from.x === e.to.x && e.from.y === e.to.y && e.from.z === e.to.z) break;
        if (!suppressed && (!pellet || e.hit || Math.random() < 0.3)) this.effects.tracer(from, to, shooter?.team === 0 ? 0xa8dcff : 0xffb0a0, 1.2);
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
          else { this.hud.hit(e.zone === 'head' ? 'head' : 'body'); this.audio.hitmarker(e.zone === 'head', false); }
        }
        if (e.target === myId) {
          const angle = Math.atan2(-(e.x - this.player.m.x), -(e.z - this.player.m.z));
          if (e.zone !== 'fall') this.hud.damage(angle);
          this.audio.damage(false);
          this.player.shake = Math.min(3, this.player.shake + e.amount * 0.05);
          this.player.punchVel -= e.amount * 0.08;
        } else this.remotes.get(e.target)?.view.hit(Math.random() < 0.5);
        break;
      }
      case 'kill': {
        const killer = find(e.killer), victim = find(e.victim);
        this.hud.killfeed(killer, victim, e.weapon, e.head, e.killer === myId || e.victim === myId);
        if (e.killer === myId && e.victim !== myId) { this.hud.hit('kill'); this.audio.hitmarker(e.head, true); }
        if (e.victim === myId) this.hud.announce('YOU DIED', killer && killer.id !== myId ? `${killer.name} · ${e.weapon.toUpperCase()}` : '', 'var(--crimson)');
        break;
      }
      case 'reward': if (e.id === myId) { this.hud.reward(e.amount, e.reason); this.audio.cash(); } break;
      case 'round': {
        if (e.phase === 'freeze') {
          this.audio.roundStart();
          const sabotage = modeOf(state, this.map.def) === 'sabotage';
          const goal = !sabotage ? 'Eliminate the enemy team' : me?.team === ATTACKERS ? 'Arm the bomb or eliminate SWAT' : 'Defend the sites or eliminate the Militia';
          this.hud.announce(`ROUND ${e.round}`, goal, 'var(--accent)');
        } else if (e.phase === 'over') {
          const won = e.winner === -1 ? undefined : e.winner === this.myTeam;
          this.audio.roundEnd(won);
          const title = e.winner === -1 ? 'DRAW · ROUND REPLAYS' : `${TEAM_NAMES[e.winner].toUpperCase()} WINS THE ROUND`;
          this.hud.announce(title, REASONS[e.reason ?? ''] ?? '', e.winner === -1 ? 'var(--ink)' : e.winner === 0 ? 'var(--aegis)' : 'var(--crimson)');
        }
        break;
      }
      case 'bomb': {
        const letter = this.map.def.sabotage?.sites[e.site] ?? '';
        if (e.action === 'armed') { this.audio.bombArmed(); this.hud.announce('BOMB ARMED', `Site ${letter}`, 'var(--crimson)'); this.beepTimer = 0; }
        if (e.action === 'disarmed') { this.audio.bombDisarmed(); this.hud.announce('BOMB DISARMED', `Site ${letter}`, 'var(--aegis)'); }
        break;
      }
      case 'explosion': {
        const at = new THREE.Vector3(e.x, e.y, e.z);
        this.effects.explosion(at, e.weapon === 'bomb' ? 2.5 : 1);
        this.audio.explosion(this.listener(), at);
        const d = at.distanceTo(this.renderer.camera.position);
        const reach = e.weapon === 'bomb' ? 40 : 18;
        if (d < reach) this.player.shake = Math.min(4, this.player.shake + (reach - d) * 0.25);
        break;
      }
      case 'phase': {
        if (e.phase === 'ended') {
          const won = e.winner === this.myTeam;
          this.hud.announce(won ? 'VICTORY' : 'DEFEAT', `${TEAM_NAMES[e.winner === -1 ? 0 : e.winner]} wins the match`, won ? 'var(--accent)' : 'var(--crimson)');
        }
        if (e.phase === 'warmup') this.hud.announce('NEW MATCH', this.map.def.name);
        break;
      }
      case 'chat': {
        const sender = find(e.id);
        // Team lines stay in the team; the dead are not heard by the living.
        if (e.teamOnly && sender && sender.team !== this.myTeam) break;
        const dead = !!sender && !sender.alive && state.roundPhase === 'live';
        if (dead && me?.alive && sender.id !== myId) break;
        this.hud.chatLine(e.name, e.team, e.text, e.teamOnly, dead);
        break;
      }
      case 'join': if (e.id !== myId && !find(e.id)?.bot) this.hud.toast(`${e.name} joined ${TEAM_NAMES[e.team]}`); break;
      case 'leave': break;
      case 'spawn': break;
    }
  }
}
