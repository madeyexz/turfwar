import * as THREE from 'three';
import { hitShape, raycastSoldier } from '../../shared/hitbox';
import { loadMap } from '../../shared/maps/index';
import { wrapAngle, type Vec3 } from '../../shared/math';
import { eyeHeight } from '../../shared/movement';
import { ATTACKERS, TEAM_NAMES, vehicleTarget, type MatchEvent, type MatchState, type Soldier } from '../../shared/match/state';
import { VEHICLES, obstaclesOf, raycastVehicle, seatPosition, speedOf, type Vehicle } from '../../shared/vehicles';
import { seatFor } from '../../shared/match/vehicles';
import { WEAPONS, pelletCone, pelletDirs, weaponStats, type HitZone, type WeaponId } from '../../shared/weapons';
import { CASH, CRATE_REACH, canBuyWeapons, inBase } from '../../shared/match/economy';
import { seatOf, shieldedIds, sideOf } from '../../shared/match/combat';
import { BOMB_REACH, modeOf } from '../../shared/match/sim';
import type { Assets } from '../assets';
import { Audio, type EngineVoice } from '../audio';
import { BodiesView } from '../render/bodies';
import { BombSitesView } from '../render/bombsite';
import { Effects } from '../render/effects';
import { InterpBuffer } from '../render/interp';
import { LevelView } from '../render/level';
import { CratesView } from '../render/pickups';
import { THEMES } from '../render/materials';
import { QUALITY, type Renderer } from '../render/renderer';
import { SoldierView } from '../render/soldier';
import { ViewModel } from '../render/viewmodel';
import { SkidMarks } from '../render/skids';
import { VehiclesView, vehicleName } from '../render/vehicles';
import { BuyMenu } from '../ui/buymenu';
import { SettingsMenu } from '../ui/settingsmenu';
import { Hud } from '../ui/hud';
import { Input } from './input';
import type { GameLink } from './link';
import { Driving } from './driving';
import { LocalPlayer } from './player';
import { isMagnified, settings } from './settings';

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
  private hudReady = false;
  private menu: SettingsMenu;
  private menuAt = 0;
  /** The match-end screen has buttons: free the mouse once when it appears. */
  private endShown = false;
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
  /** First-person stand-in for the watched soldier: drives the view model like the local player. */
  private watched = new LocalPlayer();
  private watchedId = -1;
  private lastWatchedYaw = 0;
  private lastWatchedPitch = 0;
  /** View model with the other team's arms, built the first time we watch an enemy. */
  private otherViewmodel?: ViewModel;
  private lastStepPhase = 0;
  /** Cars, scooters and the helicopter. */
  private vehicles = new VehiclesView();
  /** The vehicle we drive (prediction, controls and chase camera). */
  readonly driving = new Driving();
  /** Our seat according to the host: vehicle index and seat (0 drives). */
  private seated?: { index: number; seat: 0 | 1 };
  /** Vehicle within reach that E would get us into (-1 none). */
  private nearVehicle = -1;
  /** Ourselves, seen from the chase camera on a scooter. */
  private selfView?: SoldierView;
  /** Running engines and rotors we can hear. */
  private engines = new Map<number, EngineVoice>();
  /** Rubber on the road and smoke off sliding tyres; the screech of the nearest skids. */
  private skids = new SkidMarks();
  private skidding = new Map<number, number>();
  private screeches = new Map<number, EngineVoice>();

  /** Rebuild a view model only when the weapon or its attachments change. */
  private showWeapon(vm: ViewModel, p: LocalPlayer) {
    const held = p.slot === 2 ? 'knife' : p.weapons[p.slot];
    const shown = `${vm === this.viewmodel ? 'own' : 'other'}|${held}|${JSON.stringify(p.attachments[held] ?? {})}`;
    if (shown !== this.shownWeapon) { vm.setWeapon(held, p.attachments[held] ?? {}, true); this.shownWeapon = shown; }
  }

  private viewmodelFor(team: number) {
    if (team === this.myTeam) return this.viewmodel;
    if (!this.otherViewmodel) {
      this.otherViewmodel = new ViewModel(this.assets, team);
      this.renderer.viewCamera.add(this.otherViewmodel.root);
      this.renderer.camera.add(this.otherViewmodel.torch, this.otherViewmodel.torch.target);
    }
    return this.otherViewmodel;
  }
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
    renderer.scene.add(this.crates.group, this.sites.group, this.vehicles.group, this.skids.mesh);
    this.input = new Input(renderer.renderer.domElement);
    this.input.sensitivity = settings.sensitivity;
    const me = link.state()?.soldiers.find(s => s.id === link.myId());
    this.myTeam = me?.team ?? 0;
    this.viewmodel = new ViewModel(assets, this.myTeam);
    renderer.viewCamera.add(this.viewmodel.root);
    // The flashlight attachment lights the world, so it rides on the world camera.
    renderer.camera.add(this.viewmodel.torch, this.viewmodel.torch.target);
    this.hud = new Hud(container, def);
    this.hud.onMenu = () => this.onExit?.();
    this.buymenu = new BuyMenu(container, {
      buy: item => { this.link.buy(item); this.audio.ui(); },
      attach: (weapon, attachment) => { this.link.attach(weapon, attachment); this.audio.ui(); },
    }, assets);
    // The key that closed the menu must not reopen it next frame.
    this.buymenu.onClose = () => { this.input.clear(); void this.input.lock(); };
    this.menu = new SettingsMenu(container, {
      resume: () => { this.menu.hide(); this.input.clear(); void this.input.lock(); },
      leave: () => this.onExit?.(),
      sensitivity: v => { this.input.sensitivity = v; },
      crosshair: style => { this.hud.crosshairStyle = style; },
      quality: q => renderer.applyQuality(QUALITY[q]),
      volume: v => audio.setVolume(v),
    });
    // With the menu up, resuming goes through its button (or Esc / P), not a stray click on the view.
    this.input.canRelock = () => !this.buymenu.open && !this.hud.chatting && !this.menu.open && this.link.state()?.phase !== 'ended';
    if (me) this.player.spawnFrom(me);
    const room = link.roomInfo?.();
    if (room?.code) this.hud.toast(`Private room ${room.code} · ${room.size} — friends join with this code`, 12000);
    if (import.meta.env.DEV) Object.assign(window, { __game: this });
  }

  stop(keepLink = false) {
    this.running = false;
    if (!keepLink) this.link.dispose();
    this.hud.dispose();
    this.buymenu.dispose?.();
    this.buymenu.root.remove();
    this.menu.dispose();
    this.renderer.scene.remove(this.level.group, this.effects.group, this.bodies.group, this.crates.group, this.sites.group, this.vehicles.group);
    this.vehicles.dispose();
    this.renderer.scene.remove(this.skids.mesh); this.skids.dispose();
    for (const e of [...this.engines.values(), ...this.screeches.values()]) e.stop();
    this.engines.clear(); this.screeches.clear();
    if (this.selfView) { this.selfView.dispose(); this.selfView.root.removeFromParent(); this.selfView.gun.removeFromParent(); }
    for (const r of this.remotes.values()) { r.view.dispose(); r.view.gun.removeFromParent(); }
    this.viewmodel.root.removeFromParent();
    this.viewmodel.torch.removeFromParent(); this.viewmodel.torch.target.removeFromParent();
    for (const vm of [this.otherViewmodel]) if (vm) { vm.root.removeFromParent(); vm.torch.removeFromParent(); vm.torch.target.removeFromParent(); }
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
    if (state.phase === 'ended' && !this.endShown) { this.endShown = true; this.buymenu.close(); document.exitPointerLock?.(); }
    if (state.phase !== 'ended') this.endShown = false;
    const sabotage = modeOf(state, this.map.def) === 'sabotage';
    const active = this.input.locked && !this.buymenu.open && !this.hud.chatting;
    // Esc (the browser frees the mouse) or P opens the in-game menu; Esc / P again (or Resume) closes it.
    const released = !this.input.locked && !this.buymenu.open && !this.hud.chatting && state.phase !== 'ended';
    this.hud.released(false, false);
    if (this.input.locked) this.menu.hide();
    else if (released && !this.menu.open) { this.menu.show(link.mode === 'offline'); this.menuAt = performance.now(); }
    if (this.menu.open && performance.now() - this.menuAt > 250 && (this.input.take('Escape') || this.input.take('KeyP'))) {
      this.menu.hide(); this.input.clear(); void this.input.lock();
    }
    const side = me ? sideOf(state, this.map.def, me.team) : 0;
    const buyWindow = !!me && state.phase === 'live' && canBuyWeapons(state, this.map.def, me, side);
    const site = sabotage && me?.alive ? this.siteHere(state) : -1;
    const myJob = state.bomb.armed ? me?.team !== ATTACKERS && site === state.bomb.site : me?.team === ATTACKERS && site >= 0;
    this.nearVehicle = me?.alive && !this.seated && !(myJob && site >= 0) ? this.vehicleNear(state, me) : -1;

    // ---- Hotkeys ----
    if (active && this.input.take('KeyP')) document.exitPointerLock?.();
    if (active) {
      // The store is open anywhere: weapons only sell in base during buy time, attachments always.
      if (this.input.take('KeyB') && me) { this.buymenu.show(this.player.weapons[this.player.slot === 2 ? 0 : this.player.slot]); this.input.clear(); }
      const chat = this.input.take('Enter') ? false : this.input.take('KeyT') ? true : undefined;
      if (chat !== undefined) { this.input.clear(); this.hud.openChat(chat, text => this.link.say(text, chat)); }
      if (this.input.take('KeyE') && me?.alive) {
        // E: out of the vehicle we sit in, into the one in reach, else the ammo crate.
        const i = this.crates.nearest(this.player.m.x, this.player.m.y, this.player.m.z, CRATE_REACH);
        if (this.seated) { link.exitVehicle(); this.audio.door(); }
        else if (this.nearVehicle >= 0) { link.enterVehicle(this.nearVehicle); this.audio.door(); }
        else if (i >= 0) { link.useCrate(i); this.audio.ui(); }
      }
    }
    this.hud.scoreboard(this.input.down('Tab'), state, myId);

    // ---- Server reconciliation ----
    // Vehicles: the host decides who sits where. Taking the wheel starts prediction from its pose;
    // leaving a seat puts us where the host stood us (beside the vehicle).
    const seat = me?.alive ? seatOf(state, myId) : undefined;
    const wasSeated = this.seated;
    this.seated = seat ? { index: seat.vehicle.id, seat: seat.seat } : undefined;
    if (this.driving.active && (seat?.seat !== 0 || seat.vehicle.id !== this.driving.v!.id)) this.driving.end();
    if (seat?.seat === 0 && !this.driving.active) {
      this.driving.begin(seat.vehicle); this.player.binoculars = false; this.player.ads = 0;
      // A scooter rider shoots one-handed: bring up the sidearm if the weapon in hand needs two.
      this.player.rider = this.driving.armed;
      const drawn = this.player.rider ? this.player.drawOneHanded() : undefined;
      if (drawn !== undefined) { link.switchWeapon(drawn); this.audio.equip(this.player.weapon.id); }
    }
    if (wasSeated && !seat && me?.alive && this.wasAlive) this.player.correct(me);
    this.player.riding = !!seat;
    this.player.rider = this.driving.armed;
    // Drivers have no crosshair or weapon panel; a scooter rider keeps both.
    this.hud.driving = this.driving.active && !this.driving.armed;
    if (me) {
      this.myTeam = me.team;
      if (me.alive && !this.wasAlive) { this.player.spawnFrom(me); this.spectating = -1; this.shownWeapon = ''; }
      else if (me.alive) this.player.syncGear(me);
      if (!me.alive && this.wasAlive) {
        this.player.alive = false;
        this.deathCam.set(this.player.m.x, this.player.m.y + 1.6, this.player.m.z);
        this.spectating = me.lastAttacker;
      }
      if (me.corrections !== this.corrections) {
        if (this.wasAlive && me.alive) { if (this.driving.active && seat) this.driving.snap(seat.vehicle); else if (!seat) this.player.correct(me); }
        this.corrections = me.corrections;
      }
      this.wasAlive = me.alive;
    }
    if (this.player.alive) this.showWeapon(this.viewmodel, this.player);

    // ---- Bomb: hold E still on a site ----
    this.player.using = active && myJob && !seat && state.roundPhase === 'live' && this.input.down('KeyE');
    this.player.frozen = state.phase === 'live' && state.roundPhase === 'freeze' && !state.config.practice;

    // ---- Local player ----
    const look = active ? { x: this.input.lookX, y: this.input.lookY } : { x: 0, y: 0 };
    if (this.driving.active) {
      // At the wheel: the controls fly the vehicle; we ride in the driver's seat (no walking). Car and
      // helicopter drivers have no weapon; a scooter rider aims with the mouse (below).
      const e = this.driving.update(dt, active && state.phase !== 'ended' ? this.input : undefined, this.map.world, this.player.frozen, obstaclesOf(state.vehicles, this.driving.v!.id));
      if (e.impact > 5) this.audio.crash(e.impact);
      const v = this.driving.renderPose()!;
      this.player.seat(seatPosition(v, 0), VEHICLES[v.kind].sit, v);
      this.aimRider(state);
    } else if (seat) {
      // Passenger: carried on the seat of the vehicle as rendered; look and shoot as usual.
      const p = this.vehicles.pose(seat.vehicle.id);
      if (p) this.player.seat(seatPosition({ ...p, kind: seat.vehicle.kind }, seat.seat), VEHICLES[seat.vehicle.kind].sit, { vx: p.vx, vy: 0, vz: p.vz });
    }
    const aimed = { yaw: this.player.yaw, pitch: this.player.pitch };
    const result = this.driving.active && !this.driving.armed
      ? this.player.update(dt, undefined, this.map.world, false, true)
      : this.player.update(dt, active ? this.input : undefined, this.map.world, active && state.phase !== 'ended', this.player.frozen || state.roundPhase === 'over',
        seat ? undefined : this.vehicleBodies(state));
    if (this.driving.armed) {
      // Recoil kicks the rider's camera (the aim follows the camera, not the other way round).
      this.driving.camPitch += this.player.pitch - aimed.pitch;
      this.driving.camYaw += wrapAngle(this.player.yaw - aimed.yaw);
      this.driving.camPitch = Math.max(-0.9, Math.min(this.driving.firstPerson ? 0.9 : 0.6, this.driving.camPitch));
      if (result.shots.length) this.driving.aiming();
    }
    if (result.move.jumped) this.audio.jump();
    if (result.move.landed > 4) this.audio.land(result.move.landed);
    if (result.move.slideStarted) this.audio.slide();
    if (!this.player.riding && this.player.m.grounded && this.player.speed() > 1 && Math.floor(this.player.bobPhase / Math.PI) !== this.lastStepPhase) {
      this.lastStepPhase = Math.floor(this.player.bobPhase / Math.PI);
      this.audio.footstep(undefined, undefined, this.player.sprinting);
    }
    if (result.reloadStarted) {
      const id = this.player.weapon.id, t = this.player.weapon.reload;
      link.reload(); this.audio.reload('out', id);
      setTimeout(() => this.audio.reload('in', id), t * 650); setTimeout(() => this.audio.reload('charge', id), t * 880);
    }
    if (result.switched) { link.switchWeapon(this.player.slot); this.audio.equip(this.player.weapon.id); }
    if (result.dryFire) this.audio.dryFire(this.player.weapon.id);
    if (result.zoomed) this.player.binoculars ? this.audio.binoculars() : this.audio.ui();
    if (result.grenade) link.grenade(result.grenade.origin, result.grenade.dir);
    for (const shot of result.shots) this.shoot(shot.origin, shot.dir, shot.weapon.range, state);

    this.reportTimer -= dt;
    if (this.reportTimer <= 0 && me?.alive) {
      this.reportTimer = link.mode === 'online' ? 1 / 20 : 1 / 30;
      const driven = this.driving.report();
      if (driven) link.vehicleReport(driven); else link.report(this.player.report());
    }

    // ---- Events ----
    this.shotVoices = 0;
    // The HUD learns who we are in tick(): run it before the first events (kill marks on the score bar).
    if (!this.hudReady) { this.hud.tick(this.player, state, me); this.hudReady = true; }
    for (const e of link.drainEvents()) this.handleEvent(e, state, myId);

    // ---- World views ----
    const now = performance.now() / 1000;
    if (link.version() !== this.lastVersion) {
      this.lastVersion = link.version();
      this.syncRemotes(state, myId, now);
      this.bodies.sync(state.bodies, now);
      this.vehicles.sync(state.vehicles, now);
    }
    const renderTime = now - link.interpDelay - 0.02;
    const driven = this.driving.renderPose();
    this.vehicles.update(dt, renderTime, driven ? { id: driven.id, pose: driven } : undefined);
    this.updateSkids(state, dt);
    const rides = new Map<number, { v: Vehicle; seat: number }>();
    for (const v of state.vehicles) { if (v.driver >= 0) rides.set(v.driver, { v, seat: 0 }); if (v.passenger >= 0) rides.set(v.passenger, { v, seat: 1 }); }
    const positions = new Map<number, THREE.Vector3>();
    const byId = new Map(state.soldiers.map(s => [s.id, s]));
    // Crowd LOD: the view frustum (from last frame's camera) and distance decide how much work each remote gets.
    const cam0 = this.renderer.camera;
    frustum.setFromProjectionMatrix(projScreen.multiplyMatrices(cam0.projectionMatrix, cam0.matrixWorldInverse));
    for (const [id, r] of this.remotes) {
      const s = byId.get(id);
      let sample = r.buffer.sample(renderTime, ['yaw']);
      if (!s || !sample) continue;
      // Riders sit on their seat of the vehicle as rendered; car and helicopter crews are hidden inside.
      const ride = rides.get(id), hiddenInside = !!ride && !VEHICLES[ride.v.kind].exposed;
      const vp = ride ? this.vehicles.pose(ride.v.id) : undefined;
      if (ride && vp) {
        const p = seatPosition({ ...vp, kind: ride.v.kind }, ride.seat);
        // A scooter's crew looks and aims freely (legs on the bike); other drivers face the heading.
        const free = ride.seat === 1 || VEHICLES[ride.v.kind].driverArms;
        sample = { ...sample, x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, yaw: free ? sample.yaw : vp.yaw, crouch: VEHICLES[ride.v.kind].sit };
      }
      const hips = ride && vp && VEHICLES[ride.v.kind].exposed ? vp.yaw : undefined;
      r.pos.set(sample.x, sample.y, sample.z); r.crouch = sample.crouch; r.yaw = sample.yaw; r.pitch = sample.pitch;
      positions.set(id, r.pos);
      lodSphere.center.set(sample.x, sample.y + 1, sample.z);
      const distance = lodSphere.center.distanceTo(cam0.position);
      r.view.setLod(!frustum.intersectsSphere(lodSphere) ? 3 : distance < LOD_NEAR ? 0 : distance < LOD_MID ? 1 : 2);
      const weapon: WeaponId = s.weapon === 2 ? 'knife' : s.weapons[s.weapon];
      r.view.update(dt, {
        x: sample.x, y: sample.y, z: sample.z, vx: sample.vx, vy: sample.vy, vz: sample.vz, yaw: sample.yaw, hips, pitch: sample.pitch, crouch: sample.crouch,
        grounded: s.m.grounded, sprint: s.sprint, ads: s.ads, slide: s.m.slideTime > 0, alive: s.alive, weapon, attachments: s.attachments[weapon], using: s.using,
        reloading: s.reloadLeft > 0 ? 1 - s.reloadLeft / 2 : 0, firing: s.sinceShot < 0.15,
      });
      // Hide a soldier the camera is inside (crowded bases, spectating): clipping through a body looks broken.
      const cp = this.renderer.camera.position;
      const inside = Math.hypot(r.pos.x - cp.x, r.pos.z - cp.z) < 0.75 && cp.y > r.pos.y - 0.3 && cp.y < r.pos.y + 2.2;
      r.view.root.visible = !inside && !hiddenInside && r.view.onScreen;
      if (inside || hiddenInside) r.view.gun.visible = false;
      if (s.alive && s.m.grounded && !ride && r.last) {
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
    this.updateSelfView(dt);
    if (this.player.alive && this.driving.active) {
      // Chase camera (or the driver's seat with V).
      this.driving.placeCamera(cam, this.map.world);
      const v = this.driving.v!;
      const targetFov = settings.fov + Math.min(14, speedOf(v) * 0.35);
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 4);
      cam.updateProjectionMatrix();
      // A scooter rider in first person holds the weapon in view; otherwise no weapon in view.
      if (this.driving.armed && this.driving.firstPerson) this.viewmodel.update(dt, this.player, look);
      else { this.viewmodel.root.visible = false; this.viewmodel.torch.intensity = 0; }
      if (this.otherViewmodel) { this.otherViewmodel.root.visible = false; this.otherViewmodel.torch.intensity = 0; }
      this.hud.spectate(undefined, 0);
    } else if (this.player.alive) {
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
      // Aiming: open sights keep the weapon small (more of the world visible); scopes bring the lens up large.
      this.renderer.viewCamera.fov = 58 - this.player.ads * (isMagnified(w) ? 12 : -4);
      this.renderer.viewCamera.updateProjectionMatrix();
      // update() also decides visibility: a full-zoom scope or binoculars hide the weapon.
      this.viewmodel.update(dt, this.player, look);
      if (this.otherViewmodel) { this.otherViewmodel.root.visible = false; this.otherViewmodel.torch.intensity = 0; }
      this.hud.spectate(undefined, 0);
    } else this.spectate(state, me, positions, dt, active);
    const mag = this.player.magnification;
    const watching = !this.player.alive && this.spectating >= 0 && this.watched.alive;
    const vm = watching ? this.viewmodelFor(this.watched.team) : this.viewmodel;
    this.hud.scope((this.player.alive || watching) && !this.driving.active && vm.scopeVisible, watching ? this.watched.magnification : mag, vm.overlay);
    this.hud.binoculars(this.player.alive && this.player.binoculars && this.player.ads > 0.5, mag);
    this.hud.zoomTag(this.player.alive && !this.player.binoculars && !this.viewmodel.overlay && this.player.ads > 0.85 && mag >= 1.5 ? mag : undefined);
    this.updateEngines(state);
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
      // Dead: the HUD shows the watched soldier's gun and magazine.
      this.hud.tick(!this.player.alive && this.watched.alive ? this.watched : this.player, state, me);
      const free = !!state.config.freeBuy;
      const buyLeft = free ? -1 : Math.max(0, state.config.buyTime - state.roundClock);
      this.buymenu.update(me, buyWindow, buyLeft, free);
      const showBuy = !!me && buyWindow && (free || !me.alive || inBase(me, this.map.def, side)) && !this.buymenu.open;
      this.hud.buyHint(showBuy ? (free ? 'B STORE' : `B STORE · ${Math.ceil(buyLeft)}s`) : undefined);
      this.hud.prompt(this.promptText(state, me, site, myJob));
      this.hud.vehicle(this.vehicleInfo(state));
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

  /** The vehicles' bodies where we see them (as rendered): they block us, carry us on their roofs and push us aside. */
  private vehicleBodies(state: MatchState) {
    if (!state.vehicles.length) return undefined;
    return obstaclesOf(state.vehicles.map(v => {
      const p = this.vehicles.pose(v.id);
      return p ? { id: v.id, kind: v.kind, x: p.x, y: p.y, z: p.z, yaw: p.yaw, vx: p.vx, vz: p.vz } : v;
    }));
  }

  /** The vehicle E would get us into: the closest one in reach with a seat for us, or -1. */
  private vehicleNear(state: MatchState, me: Soldier) {
    const at = { ...me, m: this.player.m };
    let best = -1, bestD = Infinity;
    for (const v of state.vehicles) {
      if (seatFor(state, at, v) === undefined) continue;
      const d = Math.hypot(v.x - this.player.m.x, v.z - this.player.m.z);
      if (d < bestD) { bestD = d; best = v.id; }
    }
    return best;
  }

  /**
   * Where the driver looks; a scooter rider aims there. The crosshair is the camera's centre (chase
   * or first person): the shot leaves the rider's eye toward whatever the camera ray meets (a wall,
   * a vehicle or an enemy as rendered), so it lands under the crosshair without parallax.
   */
  private aimRider(state: MatchState) {
    const d = this.driving, cam = this.renderer.camera;
    const viewYaw = d.placeCamera(cam, this.map.world);
    d.aimYaw = viewYaw; d.aimPitch = 0;
    if (!d.armed) return;
    cam.updateMatrixWorld();
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const hit = this.trace(cam.position, dir, this.player.weapon.range + 15, state);
    const eye = this.player.eye();
    const dx = hit.point.x - eye.x, dy = hit.point.y - eye.y, dz = hit.point.z - eye.z, len = Math.hypot(dx, dy, dz);
    const yaw = len > 2 ? Math.atan2(-dx, -dz) : Math.atan2(-dir.x, -dir.z);
    const pitch = len > 2 ? Math.asin(dy / len) : Math.asin(Math.max(-1, Math.min(1, dir.y)));
    this.player.yaw = yaw; this.player.pitch = pitch;
    d.aimYaw = yaw; d.aimPitch = pitch;
  }

  /** HUD vehicle panel: name, speed, altitude above the floor (helicopter), body health, controls. */
  private vehicleInfo(state: MatchState) {
    const seated = this.seated;
    const host = seated ? state.vehicles[seated.index] : undefined;
    if (!seated || !host) return undefined;
    const v = this.driving.v ?? host, spec = VEHICLES[v.kind];
    const k = (key: string) => `<kbd>${key}</kbd>`;
    const keys = seated.seat === 1 ? `PASSENGER · ${k('E')}EXIT`
      : v.kind === 'heli' ? `${k('W')}${k('A')}${k('S')}${k('D')}FLY · MOUSE TURN · ${k('SPACE')}UP · ${k('C')}DOWN · ${k('V')}VIEW · ${k('E')}EXIT`
      : `${k('W')}${k('S')}DRIVE · ${k('A')}${k('D')}STEER · ${k('SPACE')}DRIFT${v.kind === 'scooter' ? ` · ${k('LMB')}FIRE` : ''} · ${k('V')}VIEW · ${k('E')}EXIT`;
    const floor = this.map.world.groundHeight(v.x, v.z, v.y + 0.1, 0.5);
    return { name: vehicleName(v), speed: speedOf(v), altitude: v.kind === 'heli' ? v.y - floor : undefined, health: host.health, max: spec.health, keys };
  }

  /** On a scooter the chase camera sees us riding: a third-person body on the seat. */
  private updateSelfView(dt: number) {
    const v = this.driving.renderPose();
    const show = !!v && v.kind === 'scooter' && !this.driving.firstPerson && this.player.alive;
    if (!show) { if (this.selfView) { this.selfView.root.visible = false; this.selfView.gun.visible = false; } return; }
    if (!this.selfView || this.selfView.team !== this.myTeam) {
      if (this.selfView) { this.selfView.dispose(); this.selfView.root.removeFromParent(); this.selfView.gun.removeFromParent(); }
      this.selfView = new SoldierView(this.assets, this.myTeam);
      this.renderer.scene.add(this.selfView.root, this.selfView.gun);
    }
    const p = seatPosition(v!, 0), held = this.player.slot === 2 ? 'knife' : this.player.weapons[this.player.slot];
    const pl = this.player;
    this.selfView.root.visible = true;
    // Legs on the bike, torso and weapon turned to the aim.
    this.selfView.update(dt, {
      x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, yaw: this.driving.aimYaw, hips: v!.yaw, pitch: this.driving.aimPitch, crouch: VEHICLES.scooter.sit,
      grounded: true, sprint: false, ads: false, slide: false, alive: true, weapon: held, attachments: pl.attachments[held],
      reloading: pl.reloading ? 1 - pl.reloadLeft / pl.reloadTotal : 0, firing: false,
    });
  }

  /** Skid marks and tyre smoke under every nearby sliding car and scooter (ours from its predicted pose). */
  private updateSkids(state: MatchState, dt: number) {
    const cam = this.renderer.camera.position;
    const list: Parameters<SkidMarks['update']>[1] = [];
    for (const v of state.vehicles) {
      if (v.wrecked || v.kind === 'heli') continue;
      const mine = this.driving.v?.id === v.id ? this.driving.v : undefined;
      const pose = mine ?? this.vehicles.pose(v.id);
      if (!pose || Math.hypot(pose.x - cam.x, pose.z - cam.z) > 140) continue;
      list.push({ id: v.id, pose: { kind: v.kind, x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, vx: pose.vx, vz: pose.vz, grounded: mine ? mine.grounded : true }, braking: !!mine && this.driving.braking });
    }
    this.skidding = this.skids.update(dt, list, this.map.world, this.effects);
  }

  /** Engines and rotors: ours at full level, others placed in the world (the nearest few). */
  private updateEngines(state: MatchState) {
    const cam = this.renderer.camera.position;
    const listener = this.listener();
    const running = new Set<number>();
    const candidates = state.vehicles
      .filter(v => !v.wrecked && (v.driver >= 0 || v.rotor > 0.05))
      .map(v => ({ v, pose: this.driving.v?.id === v.id ? this.driving.v : this.vehicles.pose(v.id) }))
      .filter(c => c.pose && Math.hypot(c.pose.x - cam.x, c.pose.y - cam.y, c.pose.z - cam.z) < (c.v.kind === 'heli' ? 160 : 70))
      .sort((a, b) => Math.hypot(a.pose!.x - cam.x, a.pose!.z - cam.z) - Math.hypot(b.pose!.x - cam.x, b.pose!.z - cam.z))
      .slice(0, 4);
    for (const { v, pose } of candidates) {
      let voice = this.engines.get(v.id);
      if (!voice) { voice = this.audio.engine(v.kind); if (!voice) continue; this.engines.set(v.id, voice); }
      running.add(v.id);
      const spec = VEHICLES[v.kind], p = pose!;
      const speed = Math.hypot(p.vx, p.vz) / spec.maxSpeed;
      const rpm = v.kind === 'heli' ? p.rotor * (0.55 + 0.45 * Math.min(1, speed)) : 0.12 + 0.88 * Math.min(1, speed);
      const mine = this.seated?.index === v.id;
      voice.set(rpm, mine ? undefined : listener, mine ? undefined : { x: p.x, y: p.y + 1, z: p.z });
    }
    for (const [id, voice] of this.engines) if (!running.has(id)) { voice.stop(); this.engines.delete(id); }
    // Tyre screech: the two nearest skids.
    const sliding = state.vehicles
      .filter(v => v.kind !== 'heli' && (this.skidding.get(v.id) ?? 0) > (this.screeches.has(v.id) ? 0.01 : 0.08))
      .map(v => ({ v, pose: this.driving.v?.id === v.id ? this.driving.v : this.vehicles.pose(v.id) }))
      .filter(c => c.pose && Math.hypot(c.pose.x - cam.x, c.pose.z - cam.z) < 70)
      .sort((a, b) => Math.hypot(a.pose!.x - cam.x, a.pose!.z - cam.z) - Math.hypot(b.pose!.x - cam.x, b.pose!.z - cam.z))
      .slice(0, 2);
    const screeching = new Set<number>();
    for (const { v, pose } of sliding) {
      let voice = this.screeches.get(v.id);
      if (!voice) { voice = this.audio.screech(v.kind as 'car' | 'scooter'); if (!voice) continue; this.screeches.set(v.id, voice); }
      screeching.add(v.id);
      const mine = this.seated?.index === v.id;
      voice.set(this.skidding.get(v.id)!, mine ? undefined : listener, mine ? undefined : { x: pose!.x, y: pose!.y + 0.3, z: pose!.z });
    }
    for (const [id, voice] of this.screeches) if (!screeching.has(id)) { voice.stop(); this.screeches.delete(id); }
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
    const near = state.vehicles[this.nearVehicle];
    if (me?.alive && near && !this.seated) {
      const name = vehicleName(near);
      return near.driver >= 0 ? `<kbd>E</kbd> RIDE ALONG · ${name}` : `<kbd>E</kbd> ${VEHICLES[near.kind].verb} ${near.kind === 'car' ? `THE ${name}` : name}`;
    }
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
    for (const vm of [this.viewmodel, this.otherViewmodel]) if (vm) { vm.root.visible = false; vm.torch.intensity = 0; }
    this.watched.alive = false;
    if (target && r) {
      // First person through their eyes: their gun, attachments, aim, sprint, reload and shots.
      const w = this.watched;
      if (w.team !== target.team || this.watchedId !== target.id) { w.team = target.team; this.watchedId = target.id; w.ads = 0; this.shownWeapon = ''; }
      w.alive = true; w.slot = target.weapon; w.weapons = target.weapons; w.attachments = target.attachments;
      w.ammo = [...target.ammo]; w.reserve = [...target.reserve]; w.grenades = target.grenades;
      w.m = target.m; w.sprinting = target.sprint; w.using = target.using; w.binoculars = false; w.throwLeft = 0;
      w.reloadTotal = w.weapon.reload; w.reloadLeft = target.reloadLeft;
      w.ads = Math.max(0, Math.min(1, w.ads + (target.ads ? 1 : -1) * dt / w.weapon.adsTime));
      if (target.m.grounded) w.bobPhase += dt * Math.hypot(target.m.vx, target.m.vz) * (target.sprint ? 1.5 : 1.75);
      cam.position.set(r.pos.x, r.pos.y + eyeHeight({ crouch: r.crouch }), r.pos.z);
      cam.rotation.set(r.pitch, r.yaw, 0, 'YXZ');
      r.view.root.visible = false; r.view.gun.visible = false;
      const vm = this.viewmodelFor(target.team);
      this.showWeapon(vm, w);
      const look = { x: wrapAngle(this.lastWatchedYaw - r.yaw) * 300, y: (r.pitch - this.lastWatchedPitch) * -300 };
      this.lastWatchedYaw = r.yaw; this.lastWatchedPitch = r.pitch;
      vm.update(dt, w, look);
      const fov = settings.fov + (w.aimFov - settings.fov) * w.ads + (w.sprinting ? 6 : 0);
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 14); cam.updateProjectionMatrix();
      this.renderer.viewCamera.fov = 58 - w.ads * (isMagnified(w.weapon) ? 12 : -4);
      this.renderer.viewCamera.updateProjectionMatrix();
      this.hud.spectate(target.name, target.team);
      return;
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
    const cam = this.renderer.camera;
    cam.updateMatrixWorld();
    // A scooter rider seen from the chase camera fires from the third-person body on the seat.
    const rider = this.driving.armed && !this.driving.firstPerson ? this.selfView : undefined;
    let muzzle: THREE.Vector3;
    if (rider) {
      rider.shoot();
      const v = this.driving.v!;
      muzzle = rider.muzzleWorld().add(new THREE.Vector3(v.vx, 0, v.vz).multiplyScalar(1 / 60));
    } else {
      this.viewmodel.fire();
      muzzle = this.viewmodel.muzzleWorld(cam, this.renderer.viewCamera);
    }
    if (!melee) {
      this.audio.gunshot(w.id, undefined, undefined, w.suppressed);
      if (!w.suppressed) this.effects.flash(muzzle, 0xffc070, 4, 0.05, 7);
    }
    const traces = (w.pellets > 1 ? pelletDirs(dir, pelletCone(w, this.player.ads > 0.5), w.pellets) : [dir]).map(d => this.trace(origin, d, range, state));
    // Claim the soldier most pellets hit; the host re-traces a pellet pattern from that claim.
    const counts = new Map<number, number>();
    for (const t of traces) if (t.target !== -1) counts.set(t.target, (counts.get(t.target) ?? 0) + 1);
    const target = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
    const claimed = traces.find(t => t.target === target) ?? traces[0];
    this.link.fire({ weapon: this.player.slot, origin, dir, target: claimed.target, zone: claimed.zone, point: claimed.point });
    if (melee) this.audio.knife(target !== -1);
    traces.forEach((t, i) => {
      const end = new THREE.Vector3(t.point.x, t.point.y, t.point.z);
      if (melee) { if (t.target !== -1) this.effects.hitSpark(end, false); return; }
      const tracer = !w.suppressed && (w.pellets > 1 ? i % 3 === 0 : Math.random() < (w.auto ? 0.5 : 1));
      if (tracer) this.effects.tracer(muzzle, end, 0xffe2a0, w.class === 'sniper' ? 1.8 : 1, w.velocity);
      if (t.target !== -1) this.effects.hitSpark(end, false);
      else if (t.wall) this.effects.impact(end, new THREE.Vector3(t.wall.normal.x, t.wall.normal.y, t.wall.normal.z), t.wall.surface, i < 3, cam.position);
    });
    if (target !== -1 && this.link.mode === 'online') {
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
    // Vehicle bodies as rendered (claimed as vehicleTarget(i)); crews inside them are behind the body.
    for (const v of state.vehicles) {
      if (v.id === this.seated?.index) continue;
      const pose = this.vehicles.pose(v.id);
      const t = pose ? raycastVehicle(origin, dir, { ...pose, kind: v.kind }) : -1;
      if (t >= 0 && t < best) { best = t; target = vehicleTarget(v.id); zone = 'body'; }
    }
    const shielded = shieldedIds(state);
    for (const [id, r] of this.remotes) {
      const s = state.soldiers.find(x => x.id === id);
      if (!s || !s.alive || s.team === this.myTeam || shielded.has(id)) continue;
      const hit = raycastSoldier(origin, dir, hitShape(r.pos, r.crouch, r.yaw));
      if (hit && hit.t < best) { best = hit.t; target = id; zone = hit.zone; }
    }
    const point = { x: origin.x + dir.x * best, y: origin.y + dir.y * best, z: origin.z + dir.z * best };
    return { point, target, zone, wall: target === -1 ? wall : null };
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
        if (!this.player.alive && e.shooter === this.spectating && this.watched.alive) {
          const vm = this.viewmodelFor(this.watched.team), now = performance.now();
          if (now - (this.lastReport.get(e.shooter) ?? -1e9) >= 40) vm.fire();
        }
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
        if (!suppressed && (!pellet || e.hit || Math.random() < 0.3)) this.effects.tracer(from, to, shooter?.team === 0 ? 0xa8dcff : 0xffb0a0, 1.2, WEAPONS[e.weapon]?.velocity);
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
          // Every round deploys everyone fresh in their base: full magazines, health and stamina,
          // survivors included (they keep their gear, the server refills it).
          if (me?.alive) { this.player.spawnFrom(me); this.shownWeapon = ''; }
          this.skids.clear();
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
      case 'vehicle': {
        if (e.action === 'hit' && e.id === myId && this.seated?.index !== e.vehicle) {
          const now = performance.now();
          this.predictedHits = this.predictedHits.filter(h => now - h.at < 1000);
          const shown = this.predictedHits.findIndex(h => h.target === vehicleTarget(e.vehicle));
          if (shown >= 0) this.predictedHits.splice(shown, 1); else { this.hud.hit('body'); this.audio.hitmarker(false, false); }
        }
        if (e.action === 'hit' && this.seated?.index === e.vehicle && e.id !== myId) this.player.shake = Math.min(2, this.player.shake + 0.3);
        if (e.action === 'wreck' && e.id === myId) this.hud.hit('kill');
        break;
      }
      case 'explosion': {
        const at = new THREE.Vector3(e.x, e.y, e.z);
        this.effects.explosion(at, e.weapon === 'bomb' ? 2.5 : e.weapon === 'vehicle' ? 1.8 : 1);
        this.audio.explosion(this.listener(), at);
        const d = at.distanceTo(this.renderer.camera.position);
        const reach = e.weapon === 'bomb' ? 40 : e.weapon === 'vehicle' ? 28 : 18;
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
