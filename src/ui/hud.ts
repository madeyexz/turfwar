import * as THREE from 'three';
import type { CollisionWorld } from '../../shared/collision';
import { loadMap } from '../../shared/maps';
import type { MapDef } from '../../shared/maps/types';
import { statsOf } from '../../shared/match/economy';
import { ATTACKERS, TEAM_NAMES, TEAM_SHORT, type MatchState, type Soldier, type Team } from '../../shared/match/state';
import { ATTACHMENTS, ATTACHMENT_SLOTS, HEALTH, STAMINA, WEAPONS, type AttachmentCategory, type WeaponId } from '../../shared/weapons';
import type { CareerStats } from '../game/link';
import type { LocalPlayer } from '../game/player';
import { isMagnified, settings } from '../game/settings';
import { RETICLE_CSS } from '../render/sights';

const TEAM_CSS = ['var(--aegis)', 'var(--crimson)'];
const TEAM_HEX = ['#4aa8ff', '#ff5544'];
/** Teammate name tags shown at once (nearest first). */
const NAMETAG_MAX = 8;
const CATEGORIES: AttachmentCategory[] = ATTACHMENT_SLOTS;
/** Crosshair styles chosen on the deploy screen (localStorage 'lawbreaker.crosshair'). */
export type CrosshairStyle = 'classic' | 'dot' | 'circle' | 't';
const CROSSHAIRS: CrosshairStyle[] = ['classic', 'dot', 'circle', 't'];
const savedCrosshair = (): CrosshairStyle => {
  try { const v = localStorage.getItem('lawbreaker.crosshair') as CrosshairStyle; return CROSSHAIRS.includes(v) ? v : 'classic'; } catch { return 'classic'; }
};

const clock = (t: number) => { const s = Math.max(0, Math.ceil(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const initials = (name: string) => {
  const parts = name.toUpperCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2);
};
/** Kill feed label for a weapon id or cause ('knife', 'grenade', 'fall', 'bomb'). */
const weaponLabel = (w: string) => w === 'grenade' ? 'M67' : WEAPONS[w as WeaponId]?.name ?? w.toUpperCase();
const binoTicks = () => {
  let s = '';
  for (let i = -50; i <= 50; i += 5) if (i) s += `<line x1="${i}" y1="${i % 10 ? -1 : -2.2}" x2="${i}" y2="0"/>${i % 20 ? '' : `<text x="${i}" y="-3.4">${Math.abs(i)}</text>`}`;
  for (let i = 6; i <= 30; i += 6) s += `<line x1="${-i / 6 - 0.6}" y1="${i}" x2="${i / 6 + 0.6}" y2="${i}"/>`;
  return s;
};

/** DOM heads-up display in BeGone's layout. Elements are created once; updates only touch changed values. */
export class Hud {
  readonly root: HTMLElement;
  crosshairStyle: CrosshairStyle = savedCrosshair();
  onRestart?: () => void;
  onMenu?: () => void;
  private el: Record<string, HTMLElement> = {};
  private cache = new Map<string, string>();
  private world?: CollisionWorld;
  private minimapCtx: CanvasRenderingContext2D;
  private hitTimer = 0;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private damageArrows: { el: HTMLElement; angle: number; life: number }[] = [];
  private markers = new Map<string, HTMLElement>();
  private nametags = new Map<number, HTMLElement>();
  private avatars = new Map<number, HTMLElement>();
  private avatarOrder = ['', ''];
  // Scorebar bookkeeping (per round): damage I dealt per enemy, who I killed, last seen health.
  private myId = -1;
  private round = -1;
  private dealt = new Map<number, number>();
  private victims = new Set<number>();
  private lastHealth = new Map<number, number>();
  private targetId = -1;
  private targetTimer = 0;
  private rangeTimer = 0;
  private scoped = false;
  private boardAt = 0;
  private chatOpen = false;
  private chatSend?: (text: string) => void;
  private input: HTMLInputElement;
  private v = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private eye = new THREE.Vector3();

  constructor(parent: HTMLElement, private map: MapDef) {
    try { this.world = loadMap(map.id).world; } catch { /* dev maps without a registry entry: no line-of-sight checks */ }
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="lowhp" data-k="lowhp" hidden></div>
      <div class="flash" data-k="flash"></div>
      <div class="scope" data-k="scope" hidden><svg class="scope-reticle sniper" viewBox="-100 -100 200 200" aria-hidden="true"><g fill="#050607"><rect x="-100" y="-1.3" width="68" height="2.6" rx="1.3"/><rect x="32" y="-1.3" width="68" height="2.6" rx="1.3"/><rect x="-1.3" y="32" width="2.6" height="68" rx="1.3"/><rect x="-1.3" y="-100" width="2.6" height="68" rx="1.3"/></g><g stroke="#050607" stroke-width="0.32"><line x1="-32" y1="0" x2="32" y2="0"/><line x1="0" y1="-32" x2="0" y2="32"/></g><g fill="#050607">${[-24, -18, -12, -6, 6, 12, 18, 24].map(i => `<circle cx="${i}" cy="0" r="0.75"/><circle cx="0" cy="${i}" r="0.75"/>`).join('')}</g><circle class="lit" r="0.55"/></svg><svg class="scope-reticle prism" viewBox="-100 -100 200 200" aria-hidden="true"><g class="lit-stroke" fill="none" stroke-width="1.6" stroke-linejoin="round" filter="url(#hud-glow)"><path d="M -7 7 L 0 -1 L 7 7"/></g><defs><filter id="hud-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g stroke="#08090a" stroke-width="0.5"><line x1="0" y1="9" x2="0" y2="60"/><line x1="-6" y1="18" x2="6" y2="18"/><line x1="-4.5" y1="27" x2="4.5" y2="27"/><line x1="-3.2" y1="36" x2="3.2" y2="36"/><line x1="-2.2" y1="45" x2="2.2" y2="45"/><line x1="-100" y1="0" x2="-30" y2="0"/><line x1="30" y1="0" x2="100" y2="0"/></g></svg><span class="scope-mag" data-k="scopeMag"></span></div>
      <div class="binos" data-k="binos" hidden>
        <svg viewBox="-100 -50 200 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <defs>
            <filter id="hud-bino-soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="2.2"/></filter>
            <mask id="hud-bino-mask"><rect x="-2000" y="-2000" width="4000" height="4000" fill="#fff"/><g filter="url(#hud-bino-soft)"><circle cx="-26" r="39"/><circle cx="26" r="39"/></g></mask>
          </defs>
                    <rect x="-2000" y="-2000" width="4000" height="4000" fill="#030405" mask="url(#hud-bino-mask)"/>
          <g class="rf" stroke-width="0.28" fill="none">
            <line x1="-56" y1="0" x2="-3" y2="0"/><line x1="3" y1="0" x2="56" y2="0"/><line x1="0" y1="-34" x2="0" y2="-3"/><line x1="0" y1="3" x2="0" y2="32"/>
            <rect x="-1.4" y="-1.4" width="2.8" height="2.8"/>${binoTicks()}
            <path d="M-12 -14 h-4 v4 M12 -14 h4 v4 M-12 14 h-4 v-4 M12 14 h4 v-4"/>
          </g>
        </svg>
        <div class="binos-read"><span data-k="binoRange">RNG ---- M</span><span data-k="binoBearing">BRG 000°</span><span data-k="binoMag">10×</span></div>
      </div>
      <div class="minimap panel"><canvas width="380" height="380"></canvas></div>
      <div class="sb">
        <div class="sb-side t0"><div class="sb-avs" data-k="av0"></div><div class="sb-score"><small>${TEAM_SHORT[0]}</small><b data-k="s0">0</b><i class="pips"><i data-k="p0"></i></i></div></div>
        <div class="sb-clock" data-k="clockBox"><b data-k="clock">0:00</b><small data-k="round"></small></div>
        <div class="sb-side t1"><div class="sb-score"><small>${TEAM_SHORT[1]}</small><b data-k="s1">0</b><i class="pips"><i data-k="p1"></i></i></div><div class="sb-avs" data-k="av1"></div></div>
      </div>
      <div class="sb-sub" data-k="sub"></div>
      <div class="bomb" data-k="bomb" hidden><div class="sites" data-k="sites"></div><span data-k="bombText"></span><div class="track"><i data-k="bombBar"></i></div></div>
      <div class="netstat" data-k="net"></div>
      <div class="killfeed" data-k="feed"></div>
      <div class="markers" data-k="markers"></div>
      <div class="crosshair" data-k="cross"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="dot"></i><i class="ring"></i></div>
      <div class="pipvig" data-k="pipvig" hidden></div>
      <div class="hitmarker" data-k="hit"><i></i><i></i><i></i><i></i></div>
      <div class="target-tag" data-k="targetTag" hidden></div>
      <div class="damage-ring" data-k="dmg"></div>
      <div class="rewards" data-k="rewards"></div>
      <div class="prompt" data-k="prompt" hidden></div>
      <div class="progress" data-k="progress" hidden><span data-k="progressText"></span><div class="track"><i data-k="progressBar"></i></div></div>
      <div class="toast" data-k="toast"></div>
      <div class="announce" data-k="announce"><b></b><small></small></div>
      <div class="chat" data-k="chat"><div class="lines" data-k="chatLines"></div><label class="chat-input" data-k="chatBox" hidden><span data-k="chatLabel">ALL</span><input maxlength="75" autocomplete="off" spellcheck="false"></label></div>
      <div class="vitals" data-k="vitals">
        <div class="meter health" data-k="healthMeter"><span>HP</span><div class="track"><i data-k="healthBar"></i></div><b data-k="health">100</b></div>
        <div class="meter stamina" data-k="staminaMeter"><span>STA</span><div class="track"><i data-k="staminaBar"></i><u></u></div><b data-k="stamina">100</b></div>
        <div class="cash" data-k="cash">$0</div>
      </div>
      <div class="arms" data-k="arms">
        <div class="wname"><b data-k="weapon"></b><span class="atts" data-k="atts"></span></div>
        <div class="ammo" data-k="ammo"></div>
        <div class="reloadbar"><i data-k="reload"></i></div>
        <div class="slots" data-k="slots"></div>
      </div>
      <div class="buyhint" data-k="buyhint" hidden></div>
      <div class="vehicle panel" data-k="vehicle" hidden><div class="vrow"><b data-k="vName"></b><span class="vread"><b data-k="vSpeed">0</b><small>KM/H</small></span><span class="vread" data-k="vAltBox"><b data-k="vAlt">0</b><small>M ALT</small></span></div><div class="track"><i data-k="vHealth"></i></div><small class="vkeys" data-k="vKeys"></small></div>
      <div class="spectate" data-k="spectate" hidden></div>
      <div class="zoomtag" data-k="zoomtag" hidden></div>
      <div class="released panel" data-k="released" hidden><b data-k="releasedTitle"></b><span>Click to resume · <kbd>M</kbd> leave match</span></div>
      <div class="scoreboard panel" data-k="board" hidden></div>
      <div class="end panel" data-k="end" hidden></div>
      <div class="fps" data-k="fps"></div>`;
    parent.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach(e => { this.el[e.dataset.k!] = e; });
    this.minimapCtx = (this.root.querySelector('.minimap canvas') as HTMLCanvasElement).getContext('2d')!;
    this.el.end.addEventListener('click', e => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'menu') this.onMenu?.(); else if (act === 'restart') this.onRestart?.();
    });
    // Chat input: Enter sends (blank just closes), Esc cancels; keys never reach the game.
    this.input = this.root.querySelector('.chat-input input')!;
    this.input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        const text = this.input.value.trim(), send = this.chatSend;
        this.closeChat();
        if (text) send?.(text);
      } else if (e.code === 'Escape') { e.preventDefault(); this.closeChat(); }
    });
    this.input.addEventListener('blur', () => this.closeChat());
  }

  private set(key: string, value: string, prop: 'text' | 'html' | 'width' = 'text') {
    if (this.cache.get(key + prop) === value) return;
    this.cache.set(key + prop, value);
    const e = this.el[key];
    if (prop === 'text') e.textContent = value; else if (prop === 'html') e.innerHTML = value; else e.style.width = value;
  }

  // ---- Per frame ------------------------------------------------------------------------------

  /** Crosshair, hit markers, damage arrows, target under the crosshair, low-HP effect, binocular range. */
  frame(dt: number, p: LocalPlayer, state: MatchState, me: Soldier | undefined, camera: THREE.PerspectiveCamera, positions: Map<number, THREE.Vector3>) {
    const alive = !!me?.alive && p.alive;
    const w = p.weapon;
    // Crosshair (BeGone: four bars around a dot): the gap follows the cone (bloom, movement, air) and widens
    // while sprinting; optics replace it while aiming.
    const cross = this.el.cross;
    cross.hidden = !alive || this.driving || p.binoculars || this.scoped || p.ads > 0.5;
    if (!cross.hidden) {
      if (cross.dataset.style !== this.crosshairStyle) cross.dataset.style = this.crosshairStyle;
      const spread = p.currentSpread();
      const px = Math.tan(Math.min(80, spread) * Math.PI / 180) / Math.tan(camera.fov * Math.PI / 360) * innerHeight / 2;
      const gap = Math.min(innerHeight * 0.3, Math.max(3, px + (p.sprinting ? 10 : 0)));
      cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
      cross.classList.toggle('busy', p.reloading);
    }
    // Red dots and holo sights draw their reticle on the 3D glass (sights.ts). A picture-in-picture scope
    // darkens the view round the eyepiece as it comes up (eye relief).
    const pip = alive && !p.binoculars && !this.scoped && settings.scopeMode === 'pip' && isMagnified(w) ? Math.max(0, Math.min(1, (p.ads - 0.55) / 0.35)) : 0;
    this.el.pipvig.hidden = pip <= 0;
    if (pip > 0) this.el.pipvig.style.opacity = pip.toFixed(2);
    this.hitTimer -= dt;
    if (this.hitTimer <= 0) this.el.hit.classList.remove('on', 'head', 'kill');
    // Below 25 HP the world goes grey with a red edge (BeGone); deeper as health falls.
    const health = me?.health ?? 0;
    const low = alive && health < HEALTH.critical;
    // Hidden (not just transparent) otherwise, so the backdrop filter costs nothing at full health.
    this.el.lowhp.hidden = !low;
    if (low) this.el.lowhp.style.opacity = (0.7 + (1 - health / HEALTH.critical) * 0.3).toFixed(2);
    this.el.flash.style.opacity = String(Math.max(0, Number(this.el.flash.style.opacity || 0) - dt * 2.5));
    for (let i = this.damageArrows.length - 1; i >= 0; i--) {
      const a = this.damageArrows[i];
      a.life -= dt;
      a.el.style.transform = `rotate(${-(a.angle - p.yaw)}rad)`;
      a.el.style.opacity = String(Math.min(1, Math.max(0, a.life)));
      if (a.life <= 0) { a.el.remove(); this.damageArrows.splice(i, 1); }
    }
    camera.getWorldPosition(this.eye);
    camera.getWorldDirection(this.fwd);
    // Enemy under the crosshair (in line of sight): name tag and the scorebar's target icon.
    this.targetTimer -= dt;
    if (this.targetTimer <= 0) {
      this.targetTimer = 0.06;
      const t = alive && !p.binoculars ? this.aimedEnemy(state, me!, positions, 160) : undefined;
      this.targetId = t?.id ?? -1;
      this.el.targetTag.hidden = !t;
      if (t) this.set('targetTag', `<i></i>${escape(t.name)}`, 'html');
    }
    // Binoculars: laser range to whatever sits under the mark, and bearing.
    this.rangeTimer -= dt;
    if (p.binoculars && this.rangeTimer <= 0) {
      this.rangeTimer = 0.1;
      let range = this.world?.raycast(this.eye, this.fwd, 1500)?.t ?? -1;
      const s = me && this.aimedEnemy(state, me, positions, range < 0 ? 1500 : range, true);
      if (s) range = this.v.copy(positions.get(s.id)!).sub(this.eye).length();
      this.set('binoRange', range < 0 ? 'RNG ---- M' : `RNG ${String(Math.round(range)).padStart(4, '0')} M`);
      this.set('binoBearing', `BRG ${String(Math.round(((Math.atan2(this.fwd.x, -this.fwd.z) * 180 / Math.PI) + 360) % 360) % 360).padStart(3, '0')}°`);
    }
    this.markersFrame(state, me, camera, positions);
  }

  /** Nearest living enemy whose chest lies within ~0.75 m of the view ray and in line of sight. */
  private aimedEnemy(state: MatchState, me: Soldier, positions: Map<number, THREE.Vector3>, maxDist: number, ignoreLos = false) {
    let best: Soldier | undefined, bestD = maxDist;
    for (const s of state.soldiers) {
      if (!s.alive || s.team === me.team || s.id === me.id) continue;
      const pos = positions.get(s.id);
      if (!pos) continue;
      const v = this.v.set(pos.x, pos.y + (s.m.crouch > 0.5 ? 0.9 : 1.25), pos.z).sub(this.eye);
      const d = v.length(), along = v.dot(this.fwd);
      if (d > bestD || along <= 0 || d * d - along * along > 0.75 * 0.75) continue;
      if (!ignoreLos && this.world && !this.world.lineOfSight(this.eye, { x: pos.x, y: pos.y + 1.25, z: pos.z })) continue;
      best = s; bestD = d;
    }
    return best;
  }

  private project(camera: THREE.PerspectiveCamera, x: number, y: number, z: number) {
    const v = this.v.set(x, y, z).project(camera);
    const behind = v.z > 1;
    let sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
    if (behind) { sx = innerWidth - sx; sy = innerHeight * 0.68; }
    // Off-screen markers ride the screen edge, clear of the score bar and the bottom panels.
    const cx = Math.max(40, Math.min(innerWidth - 40, sx)), cy = Math.max(130, Math.min(innerHeight * 0.68, sy));
    return { x: cx, y: cy, off: behind || cx !== sx || cy !== sy };
  }

  private markersFrame(state: MatchState, me: Soldier | undefined, camera: THREE.PerspectiveCamera, positions: Map<number, THREE.Vector3>) {
    const layer = this.el.markers;
    // Sabotage bomb sites: letter and distance; the armed site pulses red, the other goes inert.
    const sites = this.sabotage(state) ? this.map.sabotage!.sites : [];
    const bomb = state.bomb;
    sites.forEach((id, i) => {
      const def = this.map.points.find(d => d.id === id);
      if (!def) return;
      let m = this.markers.get(id);
      if (!m) { m = document.createElement('div'); m.className = 'marker'; m.innerHTML = `<b>${id}</b><small></small>`; layer.appendChild(m); this.markers.set(id, m); }
      const inert = bomb.armed && bomb.site !== i;
      m.hidden = inert || state.roundPhase === 'over';
      if (m.hidden) return;
      const s = this.project(camera, def.x, def.y + 2.6, def.z);
      m.style.left = `${s.x}px`; m.style.top = `${s.y}px`;
      m.classList.toggle('offscreen', s.off);
      m.classList.toggle('armed', bomb.armed && bomb.site === i);
      m.classList.toggle('busy', !bomb.armed && bomb.by >= 0 && bomb.site === i);
      (m.lastElementChild as HTMLElement).textContent = me ? `${Math.round(Math.hypot(def.x - me.m.x, def.z - me.m.z))}m` : '';
    });
    for (const [id, m] of this.markers) if (!sites.includes(id as never)) { m.remove(); this.markers.delete(id); }
    // Teammate name tags with health (the nearest few, so big battles stay readable).
    const seen = new Set<number>();
    if (me) {
      const tagged = state.soldiers
        .filter(s => s.id !== me.id && s.alive && s.team === me.team && positions.has(s.id))
        .map(s => ({ s, pos: positions.get(s.id)!, d: this.eye.distanceTo(positions.get(s.id)!) }))
        .filter(t => t.d <= 90).sort((a, b) => a.d - b.d).slice(0, NAMETAG_MAX);
      for (const { s, pos, d } of tagged) {
        const v = this.v.set(pos.x, pos.y + 2.05, pos.z).project(camera);
        if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
        seen.add(s.id);
        let tag = this.nametags.get(s.id);
        if (!tag) { tag = document.createElement('div'); layer.appendChild(tag); this.nametags.set(s.id, tag); }
        tag.className = `nametag t${s.team}${s.health < HEALTH.critical ? ' low' : ''}`;
        tag.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; tag.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
        tag.style.opacity = String(Math.max(0.35, 1 - d / 90));
        const key = s.name + Math.ceil(s.health);
        if (tag.dataset.t !== key) { tag.dataset.t = key; tag.innerHTML = `${escape(s.name)}<i class="hp"><i style="width:${Math.max(0, Math.min(100, s.health))}%"></i></i>`; }
      }
    }
    for (const [id, tag] of this.nametags) if (!seen.has(id)) { tag.remove(); this.nametags.delete(id); }
  }

  private sabotage(state: MatchState) { return state.config.mode === 'sabotage' && !!this.map.sabotage?.sites.length; }

  // ---- 10 Hz ----------------------------------------------------------------------------------

  /** Score bar, bomb status, vitals, cash and weapon. */
  tick(p: LocalPlayer, state: MatchState, me: Soldier | undefined) {
    this.myId = me?.id ?? -1;
    if (state.round !== this.round) { this.round = state.round; this.dealt.clear(); this.victims.clear(); this.lastHealth.clear(); }
    // Damage I dealt this round, per enemy (health drops while I'm their last attacker).
    for (const s of state.soldiers) {
      const h = Math.max(0, s.health), prev = this.lastHealth.get(s.id);
      if (me && s.team !== me.team && prev !== undefined && h < prev && s.lastAttacker === me.id) this.dealt.set(s.id, (this.dealt.get(s.id) ?? 0) + prev - h);
      this.lastHealth.set(s.id, h);
    }
    // Clock: round time, freeze countdown in amber, red once the bomb is armed.
    const cfg = state.config, practice = !!cfg.practice;
    const sabotage = this.sabotage(state);
    const armed = sabotage && state.bomb.armed && state.roundPhase === 'live';
    const phase = state.phase === 'warmup' ? 'warmup' : state.phase === 'ended' ? 'ended' : armed ? 'armed' : state.roundPhase;
    this.el.clockBox.dataset.phase = phase;
    this.set('clock', practice ? clock(cfg.roundTime - state.phaseLeft) : clock(state.phaseLeft));
    this.set('round', practice ? 'PRACTICE' : phase === 'warmup' ? 'WARMUP' : phase === 'ended' ? 'MATCH OVER' : phase === 'freeze' ? `ROUND ${state.round} · BUY` : phase === 'over' ? 'ROUND OVER' : `ROUND ${state.round}`);
    this.set('sub', practice ? 'PRACTICE RANGE · FREE STORE' : `${cfg.mode === 'sabotage' ? 'SABOTAGE' : 'ELIMINATION'} · FIRST TO ${cfg.roundsToWin}`);
    for (const t of [0, 1] as const) {
      this.set(`s${t}`, String(state.scores[t]));
      this.set(`p${t}`, `${Math.min(100, state.scores[t] / Math.max(1, cfg.roundsToWin) * 100)}%`, 'width');
    }
    this.avatarsTick(state, me);
    // Sabotage: sites, arming/disarming progress, armed site and its countdown.
    this.el.bomb.hidden = !sabotage || state.phase !== 'live' || state.roundPhase === 'over';
    if (sabotage) {
      const b = state.bomb, sites = this.map.sabotage!.sites;
      this.set('sites', sites.map((id, i) => `<b class="${b.site === i ? (b.armed ? 'armed' : b.by >= 0 ? 'busy' : '') : b.armed ? 'inert' : ''}">${id}</b>`).join(''), 'html');
      const site = sites[b.site] ?? '';
      const attacking = me?.team === ATTACKERS;
      const text = b.armed ? (b.by >= 0 ? `DISARMING ${site}` : `BOMB ARMED · ${site} · ${clock(state.phaseLeft)}`)
        : b.by >= 0 ? `ARMING ${site}` : attacking ? 'ARM A BOMB SITE' : 'DEFEND THE BOMB SITES';
      this.set('bombText', text);
      this.el.bomb.classList.toggle('armed', b.armed);
      this.el.bomb.classList.toggle('busy', b.by >= 0);
      this.set('bombBar', `${b.by >= 0 ? b.progress * 100 : 0}%`, 'width');
    }
    // Vitals: 100 HP (no shield), stamina, cash below.
    const hp = me?.alive ? Math.max(0, Math.ceil(Math.min(HEALTH.max, me.health))) : 0;
    this.set('health', String(hp));
    this.set('healthBar', `${hp / HEALTH.max * 100}%`, 'width');
    this.el.healthMeter.classList.toggle('low', hp < HEALTH.critical);
    const sta = Math.round(p.stamina);
    this.set('stamina', String(sta));
    this.set('staminaBar', `${sta / STAMINA.max * 100}%`, 'width');
    this.el.staminaMeter.classList.toggle('tired', p.tired);
    if (me) this.set('cash', `$${me.money.toLocaleString('en-US')}`);
    this.el.vitals.classList.toggle('dead', !me?.alive);
    this.el.arms.classList.toggle('dead', !me?.alive);
    // Weapon in hand, then the magazine / reserve: only with an Ammo Counter fitted (BeGone), then the loadout keys.
    const w = p.weapon, melee = w.class === 'melee', counter = w.attachments.counter === 'ammoCounter';
    this.set('weapon', w.name);
    this.set('atts', '', 'html');
    const ammo = p.ammo[p.slot as 0 | 1] ?? 0;
    // Without a counter the panel is a plain list of what you carry (key, weapon), the one in hand lit.
    const carried = [[3, WEAPONS[p.weapons[0]].name, p.slot === 0], [2, WEAPONS[p.weapons[1]].name, p.slot === 1], [1, 'Knife', p.slot === 2],
      [4, `M67 ×${p.grenades}${me?.grenadeHE ? ' HE' : ''}`, false]] as [number, string, boolean][];
    const list = `<ul class="carried">${carried.map(([k, name, on]) => `<li class="${on ? 'on' : ''}${k === 4 && !p.grenades ? ' none' : ''}"><kbd>${k}</kbd>${name}</li>`).join('')}</ul>`;
    this.set('ammo', counter && !melee ? `${ammo}<small>/ ${p.reserve[p.slot as 0 | 1]}</small>` : list, 'html');
    this.el.arms.classList.toggle('listed', !counter || melee);
    this.el.ammo.classList.toggle('low', counter && !melee && ammo > 0 && ammo <= Math.max(3, w.magazine * 0.25));
    this.el.ammo.classList.toggle('empty', counter && !melee && ammo === 0);
    this.set('reload', `${p.reloading ? (1 - p.reloadLeft / p.reloadTotal) * 100 : 0}%`, 'width');
    const slot = (key: number, name: string, on: boolean, extra = '') => `<span class="${on ? 'on' : ''}"><kbd>${key}</kbd>${name}${extra}</span>`;
    this.set('slots', slot(1, 'KNIFE', p.slot === 2) + slot(2, WEAPONS[p.weapons[1]].name, p.slot === 1) + slot(3, WEAPONS[p.weapons[0]].name, p.slot === 0)
      + `<span class="nade${p.grenades > 0 ? '' : ' none'}"><kbd>4</kbd>M67 ×${p.grenades}${me?.grenadeHE ? '<em>HE</em>' : ''}</span>`, 'html');
  }

  /** BeGone's score bar: one avatar per soldier, most kills nearest the clock. */
  private avatarsTick(state: MatchState, me: Soldier | undefined) {
    const spectating = !!me && !me.alive;
    const killer = spectating && me!.lastAttacker !== me!.id ? me!.lastAttacker : -1;
    const most = Math.max(state.soldiers.filter(s => s.team === 0).length, state.soldiers.filter(s => s.team === 1).length);
    this.root.style.setProperty('--av', `${most <= 8 ? 28 : most <= 12 ? 24 : most <= 20 ? 18 : 11}px`);
    const live = new Set<number>();
    for (const team of [0, 1] as const) {
      const list = state.soldiers.filter(s => s.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
      const box = this.el[`av${team}`];
      for (const s of list) {
        live.add(s.id);
        let a = this.avatars.get(s.id);
        if (!a) {
          a = document.createElement('div');
          a.innerHTML = `<b>${escape(initials(s.name))}</b><i class="hp"><i></i></i><em></em>`;
          this.avatars.set(s.id, a);
        }
        // Teammate health always; everyone's while spectating. Enemies show the damage I dealt them.
        const showHp = s.alive && !!me && (s.team === me.team || spectating);
        const hp = Math.max(0, Math.ceil(s.health));
        const dealt = me && s.team !== me.team ? Math.round(this.dealt.get(s.id) ?? 0) : 0;
        const cls = `av t${team}${s.alive ? '' : ' dead'}${s.id === me?.id ? ' me' : ''}${s.id === killer ? ' killer' : ''}${this.victims.has(s.id) ? ' victim' : ''}${s.id === this.targetId ? ' target' : ''}${showHp && hp < HEALTH.critical ? ' low' : ''}${showHp ? ' hp-on' : ''}`;
        const key = `${cls}|${showHp ? hp : -1}|${dealt}`;
        if (a.dataset.key !== key) {
          a.dataset.key = key; a.className = cls;
          ((a.children[1] as HTMLElement).firstElementChild as HTMLElement).style.width = `${showHp ? hp : 0}%`;
          (a.children[2] as HTMLElement).textContent = dealt > 0 ? String(dealt) : '';
        }
      }
      const order = list.map(s => s.id).join(',');
      if (order !== this.avatarOrder[team]) { this.avatarOrder[team] = order; for (const s of list) box.appendChild(this.avatars.get(s.id)!); }
    }
    for (const [id, a] of this.avatars) if (!live.has(id)) { a.remove(); this.avatars.delete(id); }
  }

  // ---- Events ---------------------------------------------------------------------------------

  hit(kind: 'body' | 'head' | 'kill') {
    const e = this.el.hit;
    e.classList.remove('head', 'kill');
    e.classList.add('on');
    if (kind !== 'body') e.classList.add(kind);
    this.hitTimer = kind === 'kill' ? 0.4 : 0.15;
  }

  /** Damage taken from a world yaw angle: an arrow around the crosshair pointing at the attacker. */
  damage(fromAngle: number) {
    const arrow = document.createElement('div');
    arrow.className = 'arrow';
    this.el.dmg.appendChild(arrow);
    this.damageArrows.push({ el: arrow, angle: fromAngle, life: 1.6 });
    if (this.damageArrows.length > 6) this.damageArrows.shift()!.el.remove();
    this.el.flash.style.opacity = '1';
  }

  killfeed(killer: Soldier | undefined, victim: Soldier | undefined, weapon: string, head: boolean, mine: boolean) {
    if (killer && victim && killer.id === this.myId && victim.id !== killer.id) this.victims.add(victim.id);
    const item = document.createElement('div');
    if (mine) item.className = 'me';
    const name = (s?: Soldier) => s ? `<span class="t${s.team}">${escape(s.name)}</span>` : '';
    item.innerHTML = `${killer && killer !== victim && killer.id !== victim?.id ? name(killer) : ''}<span class="wpn">${escape(weaponLabel(weapon))}${head ? '<span class="hs" title="Headshot"></span>' : ''}</span>${name(victim)}`;
    const feed = this.el.feed;
    feed.prepend(item);
    while (feed.children.length > 6) feed.lastElementChild!.remove();
    setTimeout(() => item.remove(), 7000);
  }

  toast(text: string, ms = 3800) {
    clearTimeout(this.toastTimer);
    this.el.toast.textContent = text;
    this.el.toast.classList.add('on');
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('on'), ms);
  }

  /** Big centre banner (round won/lost, bomb armed…). */
  announce(title: string, sub = '', color = 'var(--ink)') {
    const a = this.el.announce;
    (a.firstElementChild as HTMLElement).textContent = title;
    (a.firstElementChild as HTMLElement).style.color = color;
    (a.lastElementChild as HTMLElement).textContent = sub;
    a.classList.remove('on'); void a.offsetWidth; a.classList.add('on');
  }

  /** Cash award popup ("+$500 KILL"); several stack under the crosshair. */
  reward(amount: number, reason: string) {
    const e = document.createElement('div');
    e.innerHTML = `+$${amount.toLocaleString('en-US')} <small>${escape(reason)}</small>`;
    const box = this.el.rewards;
    box.prepend(e);
    while (box.children.length > 5) box.lastElementChild!.remove();
    setTimeout(() => e.remove(), 2600);
  }

  /** Full-screen eyepiece (sniper scope or ACOG-style prism) with its magnification. */
  scope(on: boolean, magnification = 1, overlay?: 'sniper' | 'prism') {
    this.scoped = on && !!overlay;
    this.el.scope.hidden = !this.scoped;
    if (!this.scoped) return;
    if (this.el.scope.dataset.kind !== overlay) this.el.scope.dataset.kind = overlay;
    const lit = RETICLE_CSS[settings.reticleColor];
    if (this.el.scope.style.getPropertyValue('--reticle') !== lit) this.el.scope.style.setProperty('--reticle', lit);
    this.set('scopeMag', `${Math.round(magnification * 2) / 2}×`);
  }

  /** Small magnification readout by the crosshair (e.g. "2.0×"), or hidden. */
  zoomTag(magnification: number | undefined) {
    this.el.zoomtag.hidden = magnification === undefined;
    if (magnification !== undefined) this.set('zoomtag', `${magnification.toFixed(1)}×`);
  }

  /** Binoculars (Z): twin-lens mask with a range-finder reticle. */
  binoculars(on: boolean, magnification: number) {
    this.el.binos.hidden = !on;
    if (on) this.set('binoMag', `${Math.round(magnification)}×`);
    else this.rangeTimer = 0;
  }

  /** "SPECTATING name · RMB next" while dead, or hidden. */
  spectate(name: string | undefined, team: number) {
    this.el.spectate.hidden = name === undefined;
    if (name !== undefined) this.set('spectate', `<small>SPECTATING</small><b style="color:${TEAM_CSS[team] ?? 'var(--ink)'}">${escape(name)}</b><small><kbd>RMB</kbd> NEXT</small>`, 'html');
  }

  /** Context prompt under the crosshair (HTML allowed, e.g. "<kbd>E</kbd> ARM BOMB"), or hidden. */
  prompt(text: string) {
    this.el.prompt.hidden = !text;
    if (text) this.set('prompt', text, 'html');
  }

  /** Centre progress bar (arming/disarming), hidden without a label. */
  progress(label: string | undefined, fraction: number) {
    this.el.progress.hidden = label === undefined;
    if (label === undefined) return;
    this.set('progressText', label);
    this.set('progressBar', `${Math.max(0, Math.min(1, fraction)) * 100}%`, 'width');
  }

  /** At the wheel: no crosshair and no weapon panel (drivers do not shoot). */
  driving = false;

  /** Vehicle panel while seated: name, speed, altitude (helicopter), body health and the controls; hidden otherwise. */
  vehicle(info?: { name: string; speed: number; altitude?: number; health: number; max: number; keys: string }) {
    this.el.vehicle.hidden = !info;
    this.el.arms.hidden = !!info && this.driving;
    if (!info) return;
    this.set('vName', info.name);
    this.set('vSpeed', String(Math.round(info.speed * 3.6)));
    this.el.vAltBox.hidden = info.altitude === undefined;
    if (info.altitude !== undefined) this.set('vAlt', String(Math.max(0, Math.round(info.altitude))));
    const f = Math.max(0, Math.min(1, info.health / info.max));
    this.set('vHealth', `${(f * 100).toFixed(1)}%`, 'width');
    this.el.vHealth.classList.toggle('low', f < 0.3);
    this.set('vKeys', info.keys, 'html');
  }

  /** Store reminder during buy time (e.g. "B STORE · 14s"), or hidden. */
  buyHint(text: string | undefined) {
    this.el.buyhint.hidden = !text;
    if (text) this.set('buyhint', escape(text).replace(/^B\b/, '<kbd>B</kbd>'), 'html');
  }

  /** Tab: per team name, K, D, A, score, cash (own team only) and alive state; sorted like BeGone (kills, then fewest deaths). */
  scoreboard(show: boolean, state: MatchState, myId: number) {
    const wasHidden = this.el.board.hidden;
    this.el.board.hidden = !show;
    const now = performance.now();
    if (!show || (!wasHidden && now - this.boardAt < 250)) return;
    this.boardAt = now;
    const myTeam = state.soldiers.find(s => s.id === myId)?.team;
    const table = (team: Team) => {
      const rows = state.soldiers.filter(s => s.team === team).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.score - a.score);
      const cash = team === myTeam;
      return `<section class="t${team}"><h3><span>${TEAM_NAMES[team]}</span><small>${rows.filter(s => s.alive).length}/${rows.length} ALIVE</small><b>${state.scores[team]}</b></h3>
        <table><tr><th>Player</th><th>K</th><th>D</th><th>A</th><th>Score</th><th>${cash ? 'Cash' : ''}</th></tr>${rows.map(s => `<tr class="${s.id === myId ? 'me' : ''}${s.alive ? '' : ' dead'}"><td><i class="life"></i>${escape(s.name)}${s.bot ? '<span class="bot">BOT</span>' : ''}</td><td>${s.kills}</td><td>${s.deaths}</td><td>${s.assists}</td><td>${s.score}</td><td class="money">${cash ? `$${s.money.toLocaleString('en-US')}` : ''}</td></tr>`).join('')}</table></section>`;
    };
    const cfg = state.config;
    this.set('board', `<header>${escape(this.map.name)} · ${cfg.mode === 'sabotage' ? 'SABOTAGE' : 'ELIMINATION'} · ROUND ${state.round} · FIRST TO ${cfg.roundsToWin}</header>${table(0)}${table(1)}`, 'html');
  }

  /** Chat line: team messages are prefixed *TEAM* on a team-tinted background, dead players' *DEAD*. */
  chatLine(name: string, team: number, text: string, teamOnly: boolean, dead: boolean) {
    const line = document.createElement('div');
    line.className = `line${teamOnly ? ` team t${team}` : ''}`;
    line.innerHTML = `${dead ? '<em>*DEAD*</em>' : ''}${teamOnly ? '<em>*TEAM*</em>' : ''}<b class="t${team}">${escape(name)}:</b> ${escape(text)}`;
    const box = this.el.chatLines;
    box.appendChild(line);
    while (box.children.length > 8) box.firstElementChild!.remove();
    setTimeout(() => line.classList.add('old'), 12000);
  }

  /** Opens the chat input (Enter: all, T: team); `send` gets the trimmed text. */
  openChat(team: boolean, send: (text: string) => void) {
    this.chatSend = send;
    this.chatOpen = true;
    this.set('chatLabel', team ? 'TEAM' : 'ALL');
    this.el.chatBox.classList.toggle('team', team);
    this.el.chatBox.hidden = false;
    this.el.chat.classList.add('open');
    this.input.value = '';
    // Focus after the opening key's own events, so its character doesn't land in the box.
    setTimeout(() => { if (this.chatOpen) this.input.focus(); });
  }

  private closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    this.chatSend = undefined;
    this.el.chatBox.hidden = true;
    this.el.chat.classList.remove('open');
    this.input.blur();
  }

  get chatting() { return this.chatOpen; }

  /** Rotating minimap: walls, bomb sites, ammo crates, the armed bomb, teammates and enemies who just fired (unsuppressed). */
  minimap(state: MatchState, me: Soldier | undefined, yaw: number, positions: Map<number, THREE.Vector3>, myPos: THREE.Vector3) {
    const ctx = this.minimapCtx, size = 380, scale = 2.1;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(yaw);
    ctx.translate(-myPos.x * scale, -myPos.z * scale);
    for (const s of this.map.solids) {
      if (s.maxY - s.minY < 0.8 || s.team !== undefined) continue;
      ctx.fillStyle = s.maxY - s.minY > 3 ? 'rgba(170,190,196,0.55)' : 'rgba(120,140,146,0.5)';
      ctx.fillRect(s.minX * scale, s.minZ * scale, (s.maxX - s.minX) * scale, (s.maxZ - s.minZ) * scale);
    }
    const upright = (x: number, z: number, draw: () => void) => { ctx.save(); ctx.translate(x * scale, z * scale); ctx.rotate(-yaw); draw(); ctx.restore(); };
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const c of this.map.pickups ?? []) upright(c.x, c.z, () => {
      ctx.fillStyle = 'rgba(255,180,90,0.9)'; ctx.fillRect(-7, -5, 14, 10);
      ctx.fillStyle = '#1a1206'; ctx.fillRect(-1.5, -3.5, 3, 7); ctx.fillRect(-4, -1, 8, 2);
    });
    if (this.sabotage(state)) {
      const b = state.bomb, blink = Math.floor(performance.now() / 250) % 2 === 0;
      this.map.sabotage!.sites.forEach((id, i) => {
        const def = this.map.points.find(d => d.id === id);
        if (!def) return;
        const armed = b.armed && b.site === i, inert = b.armed && !armed;
        const color = armed ? '#ff3a2a' : inert ? 'rgba(200,210,214,0.35)' : b.by >= 0 && b.site === i ? '#ffb45a' : '#e9f3f5';
        ctx.strokeStyle = color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(def.x * scale, def.z * scale, Math.max(6, def.radius) * scale, 0, Math.PI * 2); ctx.stroke();
        upright(def.x, def.z, () => {
          ctx.fillStyle = color; ctx.font = 'bold 26px Rajdhani, sans-serif'; ctx.fillText(id, 0, 1);
          if (armed && blink) { ctx.fillStyle = '#ff3a2a'; ctx.beginPath(); ctx.arc(0, 20, 7, 0, Math.PI * 2); ctx.fill(); }
        });
      });
    }
    // Vehicles: white when free, team-coloured when crewed (enemy crews only show while near).
    for (const v of state.vehicles) {
      if (v.wrecked) continue;
      const crewId = v.driver >= 0 ? v.driver : v.passenger;
      const crew = crewId >= 0 ? state.soldiers.find(x => x.id === crewId) : undefined;
      if (crew && me && crew.team !== me.team && Math.hypot(v.x - myPos.x, v.z - myPos.z) > 40) continue;
      ctx.save(); ctx.translate(v.x * scale, v.z * scale); ctx.rotate(-v.yaw);
      ctx.fillStyle = crew ? TEAM_HEX[crew.team] : 'rgba(240,240,232,0.85)';
      const [w, l] = v.kind === 'car' ? [4, 9] : v.kind === 'scooter' ? [2, 4] : [5, 10];
      ctx.fillRect(-w * scale / 2, -l * scale / 2, w * scale, l * scale);
      if (v.kind === 'heli') { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, -0.6 * scale, 5.2 * scale, 0, Math.PI * 2); ctx.stroke(); }
      ctx.restore();
    }
    for (const s of state.soldiers) {
      if (!s.alive || !me || s.id === me.id) continue;
      const pos = positions.get(s.id);
      if (!pos) continue;
      if (s.team !== me.team && (s.sinceShot > 2.5 || statsOf(s).suppressed)) continue;
      ctx.fillStyle = TEAM_HEX[s.team];
      ctx.beginPath(); ctx.arc(pos.x * scale, pos.z * scale, 6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(size / 2, size / 2 - 12); ctx.lineTo(size / 2 - 8, size / 2 + 9); ctx.lineTo(size / 2 + 8, size / 2 + 9); ctx.closePath(); ctx.fill();
  }

  /** End-of-match screen while `state.phase === 'ended'`: winner, final score, top players. */
  matchEnd(state: MatchState, myTeam: number, career?: CareerStats[]) {
    const show = state.phase === 'ended';
    this.el.end.hidden = !show;
    if (!show) return;
    const w = state.winner;
    const top = [...state.soldiers].sort((a, b) => b.score - a.score || b.kills - a.kills).slice(0, 5);
    this.set('end', `<small>${w === -1 ? 'MATCH DRAWN' : `${TEAM_NAMES[w].toUpperCase()} WIN THE MATCH`}</small>
      <h2 style="color:${w === -1 ? 'var(--ink)' : TEAM_CSS[w]}">${w === -1 ? 'DRAW' : w === myTeam ? 'VICTORY' : 'DEFEAT'}</h2>
      <div class="final"><b class="t0">${TEAM_SHORT[0]} ${state.scores[0]}</b><span>—</span><b class="t1">${state.scores[1]} ${TEAM_SHORT[1]}</b></div>
      <table><tr><th></th><th>Player</th><th>K</th><th>D</th><th>A</th><th>Score</th></tr>${top.map((s, i) => `<tr${s.team === myTeam ? ' class="mine"' : ''}><td>${i + 1}</td><td class="t${s.team}">${escape(s.name)}</td><td>${s.kills}</td><td>${s.deaths}</td><td>${s.assists}</td><td>${s.score}</td></tr>`).join('')}</table>
      ${career?.length ? this.careerTable(career) : ''}
      <p>New match in ${Math.ceil(state.phaseLeft)}s</p>
      <div class="actions">${this.onRestart ? '<button data-act="restart">Play again</button>' : ''}<button data-act="menu">Leave match</button></div>`, 'html');
  }

  /** Top five of the server leaderboard, plus my own row if I'm further down. */
  private careerTable(career: CareerStats[]) {
    const mine = career.findIndex(c => c.mine);
    const rows = career.map((c, i) => ({ c, i })).filter(({ i }) => i < 5 || i === mine);
    return `<h4>Server leaderboard</h4><table class="career"><tr><th></th><th>Player</th><th>K</th><th>D</th><th>A</th><th>HS</th><th>Rounds</th><th>Matches</th></tr>${rows.map(({ c, i }) => `<tr${c.mine ? ' class="me"' : ''}><td>${i + 1}</td><td>${escape(c.name)}</td><td>${c.kills}</td><td>${c.deaths}</td><td>${c.assists}</td><td>${c.headshots}</td><td>${c.roundsWon}/${c.roundsPlayed}</td><td>${c.matchesWon}/${c.matchesPlayed}</td></tr>`).join('')}</table>`;
  }

  /** Mouse released mid-game: solo is paused; online the match carries on. */
  released(show: boolean, solo: boolean) {
    this.el.released.hidden = !show;
    if (show) this.set('releasedTitle', solo ? 'Paused' : 'Mouse released — the match continues');
  }
  net(text: string) { this.set('net', text); }
  fps(text: string) { this.set('fps', text); }
  dispose() { clearTimeout(this.toastTimer); this.root.remove(); }
}

function escape(s: string) { return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`); }
