import * as THREE from 'three';
import type { Laws } from '../../shared/laws';
import type { MapDef, PointId } from '../../shared/maps/types';
import type { MatchState, Soldier, Team } from '../../shared/match/state';
import { TEAM_SHORT } from '../../shared/match/state';
import { HEALTH, LOADOUTS, WEAPONS, type LoadoutId } from '../../shared/weapons';
import { describeLaws } from '../commands';
import type { LocalPlayer } from '../game/player';

const TEAM_CSS = ['var(--aegis)', 'var(--crimson)'];
const TEAM_HEX = ['#4aa8ff', '#ff5544'];
const pointSvg = (fill: string, progress: number, color: string) => `<svg viewBox="0 0 38 38"><path d="M19 2 36 19 19 36 2 19Z" fill="rgba(8,16,22,.75)" stroke="${fill}" stroke-width="2"/>${progress > 0 ? `<path d="M19 2 36 19 19 36 2 19Z" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="${(progress * 96).toFixed(1)} 200"/>` : ''}</svg>`;

/** DOM heads-up display. Elements are created once; updates only touch changed values. */
export class Hud {
  readonly root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private cache = new Map<string, string>();
  private hitTimer = 0;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private markers = new Map<string, HTMLElement>();
  private nametags = new Map<number, HTMLElement>();
  private damageArcs: { el: HTMLElement; angle: number; life: number }[] = [];
  private minimapCtx: CanvasRenderingContext2D;
  private killfeedItems: HTMLElement[] = [];
  onLoadout?: (l: LoadoutId) => void;
  onRestart?: () => void;
  onMenu?: () => void;

  constructor(parent: HTMLElement, private map: MapDef) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="minimap panel"><canvas width="380" height="380"></canvas></div>
      <div class="scorebar">
        <div class="score aegis"><small>${TEAM_SHORT[0]}</small><b data-k="s0">0</b><div class="bar"><i data-k="b0" style="width:0;color:var(--aegis)"></i></div></div>
        <div class="points">${[...map.points].sort((a, b) => a.id.localeCompare(b.id)).map(p => `<div class="point" data-point="${p.id}"><span>${p.id}</span></div>`).join('')}</div>
        <div class="score crimson"><small>${TEAM_SHORT[1]}</small><b data-k="s1">0</b><div class="bar"><i data-k="b1" style="width:0;color:var(--crimson)"></i></div></div>
      </div>
      <div class="timer" data-k="timer"></div>
      <div class="netstat" data-k="net"></div>
      <div class="killfeed" data-k="feed"></div>
      <div class="capture panel" data-k="capture" hidden><span data-k="captureText"></span><div class="track"><i data-k="captureBar"></i></div></div>
      <div class="markers" data-k="markers"></div>
      <div class="crosshair" data-k="cross"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><i class="dot"></i></div>
      <div class="reddot" data-k="reddot" hidden></div>
      <div class="hitmarker" data-k="hit"><i></i><i></i><i></i><i></i></div>
      <div class="damage-ring" data-k="dmg"></div>
      <div class="laws panel" data-k="laws"></div>
      <div class="vitals panel">
        <div class="who"><span data-k="name">LAWBREAKER</span><span data-k="loadout"></span></div>
        <div class="meter shield"><span>Shield</span><div class="track"><i data-k="shieldBar"></i></div><b data-k="shield">50</b></div>
        <div class="meter health" data-k="healthMeter"><span>Health</span><div class="track"><i data-k="healthBar"></i></div><b data-k="health">100</b></div>
      </div>
      <div class="weapon panel">
        <div class="name" data-k="weapon"></div>
        <div class="ammo" data-k="ammo">30<small>/30</small></div>
        <div class="extra"><span>Grenades <b data-k="nades">2</b></span><span data-k="fire"></span></div>
        <div class="reloadbar"><i data-k="reload"></i></div>
      </div>
      <div class="toast panel" data-k="toast"></div>
      <div class="announce" data-k="announce"><b></b><small></small></div>
      <div class="score-pop" data-k="pop"></div>
      <div class="vignette" data-k="vignette"></div>
      <div class="flash" data-k="flash"></div>
      <div class="scope" data-k="scope" hidden><i></i></div>
      <div class="rewind-tag" data-k="rewind" hidden>◀◀ REWINDING THE WORLD</div>
      <div class="death panel" data-k="death" hidden>
        <h3>Operative down</h3><p data-k="deathText"></p>
        <div class="loadouts">${Object.entries(LOADOUTS).map(([id, l]) => `<button data-loadout="${id}">${l.name}</button>`).join('')}</div>
      </div>
      <div class="scoreboard panel" data-k="board" hidden></div>
      <div class="end panel" data-k="end" hidden><small data-k="endSub"></small><h2 data-k="endTitle"></h2><p data-k="endText"></p><button data-k="endMenu">Change deployment</button></div>
      <div class="fps" data-k="fps"></div>`;
    parent.appendChild(this.root);
    this.root.querySelectorAll<HTMLElement>('[data-k]').forEach(e => { this.el[e.dataset.k!] = e; });
    this.minimapCtx = (this.root.querySelector('.minimap canvas') as HTMLCanvasElement).getContext('2d')!;
    this.root.querySelectorAll<HTMLButtonElement>('[data-loadout]').forEach(b => b.addEventListener('click', () => this.onLoadout?.(b.dataset.loadout as LoadoutId)));
    this.el.endMenu.addEventListener('click', () => this.onMenu?.());
  }

  private set(key: string, value: string, prop: 'text' | 'html' | 'width' = 'text') {
    if (this.cache.get(key + prop) === value) return;
    this.cache.set(key + prop, value);
    const e = this.el[key];
    if (prop === 'text') e.textContent = value; else if (prop === 'html') e.innerHTML = value; else e.style.width = value;
  }

  /** Per-frame cheap updates (crosshair, markers, overlays). */
  frame(dt: number, p: LocalPlayer, state: MatchState, me: Soldier | undefined, camera: THREE.PerspectiveCamera, soldiers: Map<number, THREE.Vector3>, rewinding: boolean) {
    // Crosshair spread in pixels from the cone angle.
    const spreadDeg = p.currentSpread();
    const px = Math.max(3, Math.tan(spreadDeg * Math.PI / 180) / Math.tan(camera.fov * Math.PI / 360) * innerHeight / 2);
    const cross = this.el.cross;
    (cross.children[0] as HTMLElement).style.transform = `translateY(${-px - 9}px)`;
    (cross.children[1] as HTMLElement).style.transform = `translateY(${px}px)`;
    (cross.children[2] as HTMLElement).style.transform = `translateX(${-px - 9}px)`;
    (cross.children[3] as HTMLElement).style.transform = `translateX(${px}px)`;
    cross.classList.toggle('ads', p.ads > 0.6);
    this.el.reddot.hidden = !(p.ads > 0.85 && p.weapon.id === 'carbine');
    cross.classList.toggle('hidden', p.sprinting || p.reloading);
    this.hitTimer -= dt;
    if (this.hitTimer <= 0) this.el.hit.classList.remove('on', 'head', 'kill');
    const health = me?.health ?? 0;
    this.el.vignette.style.opacity = String(me?.alive ? Math.max(0, (45 - health) / 45) * 0.9 : 0);
    this.el.flash.style.opacity = String(Math.max(0, Number(this.el.flash.style.opacity || 0) - dt * 3));
    this.el.rewind.hidden = !rewinding;
    document.body.classList.toggle('rewinding', rewinding);
    for (let i = this.damageArcs.length - 1; i >= 0; i--) {
      const a = this.damageArcs[i];
      a.life -= dt;
      const rel = a.angle - p.yaw;
      a.el.style.transform = `rotate(${-rel}rad)`;
      a.el.style.opacity = String(Math.max(0, a.life));
      if (a.life <= 0) { a.el.remove(); this.damageArcs.splice(i, 1); }
    }
    this.markersFrame(state, me, camera, soldiers);
  }

  private project(camera: THREE.PerspectiveCamera, x: number, y: number, z: number) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    const behind = v.z > 1;
    let sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
    if (behind) { sx = innerWidth - sx; sy = innerHeight - 40; }
    const clampX = Math.max(30, Math.min(innerWidth - 30, sx)), clampY = Math.max(60, Math.min(innerHeight - 40, sy));
    return { x: clampX, y: clampY, off: behind || clampX !== sx || clampY !== sy };
  }

  private markersFrame(state: MatchState, me: Soldier | undefined, camera: THREE.PerspectiveCamera, soldiers: Map<number, THREE.Vector3>) {
    const layer = this.el.markers;
    for (const p of state.points) {
      const def = this.map.points.find(d => d.id === p.id)!;
      let m = this.markers.get(p.id);
      if (!m) {
        m = document.createElement('div'); m.className = 'marker';
        m.innerHTML = `<div class="diamond"></div><small></small>`;
        layer.appendChild(m); this.markers.set(p.id, m);
      }
      const s = this.project(camera, def.x, def.y + 3.2, def.z);
      m.style.left = `${s.x}px`; m.style.top = `${s.y}px`;
      m.classList.toggle('offscreen', s.off);
      const color = p.owner === -1 ? '#c8d2d6' : TEAM_HEX[p.owner];
      const capColor = p.capturing === -1 ? color : TEAM_HEX[p.capturing];
      const key = `${p.owner}|${Math.round(Math.abs(p.progress))}|${p.capturing}|${p.contested}`;
      if (m.dataset.key !== key) {
        m.dataset.key = key;
        (m.firstElementChild as HTMLElement).innerHTML = pointSvg(color, p.capturing !== -1 ? Math.abs(p.progress) / 100 : 0, capColor) + `<span style="position:relative;color:${color}">${p.id}</span>`;
      }
      const dist = me ? Math.round(Math.hypot(def.x - me.m.x, def.z - me.m.z)) : 0;
      (m.lastElementChild as HTMLElement).textContent = p.contested ? 'CONTESTED' : `${dist}m`;
    }
    // Teammate name tags (and enemies under the crosshair would need line of sight; omitted).
    const seen = new Set<number>();
    for (const s of state.soldiers) {
      if (!me || s.id === me.id || !s.alive || s.team !== me.team) continue;
      const pos = soldiers.get(s.id);
      if (!pos) continue;
      const d = camera.position.distanceTo(pos);
      if (d > 90) continue;
      const v = pos.clone().setY(pos.y + 2.05).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      seen.add(s.id);
      let tag = this.nametags.get(s.id);
      if (!tag) { tag = document.createElement('div'); tag.className = `nametag t${s.team}`; layer.appendChild(tag); this.nametags.set(s.id, tag); }
      tag.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`; tag.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
      tag.style.opacity = String(Math.max(0.35, 1 - d / 90));
      const text = `${s.name}${s.bot ? ' ·' : ''}`;
      if (tag.dataset.t !== text + s.health) { tag.dataset.t = text + s.health; tag.innerHTML = `${text}<i class="hp" style="width:${Math.round(s.health / HEALTH.max * 100)}%"></i>`; }
    }
    for (const [id, tag] of this.nametags) if (!seen.has(id)) { tag.remove(); this.nametags.delete(id); }
  }

  /** Lower-frequency updates (10 Hz). */
  tick(p: LocalPlayer, state: MatchState, me: Soldier | undefined, mapPoints: MapDef['points']) {
    this.set('s0', String(state.scores[0])); this.set('s1', String(state.scores[1]));
    this.set('b0', `${Math.min(100, state.scores[0] / state.config.scoreLimit * 100)}%`, 'width');
    this.set('b1', `${Math.min(100, state.scores[1] / state.config.scoreLimit * 100)}%`, 'width');
    for (const p2 of state.points) {
      const e = this.root.querySelector<HTMLElement>(`.point[data-point="${p2.id}"]`)!;
      const color = p2.owner === -1 ? '#c8d2d6' : TEAM_HEX[p2.owner];
      const key = `${p2.owner}|${Math.round(Math.abs(p2.progress) / 5)}|${p2.capturing}`;
      if (e.dataset.key !== key) {
        e.dataset.key = key;
        e.innerHTML = pointSvg(color, p2.capturing !== -1 ? Math.abs(p2.progress) / 100 : 0, p2.capturing === -1 ? color : TEAM_HEX[p2.capturing]) + `<span style="position:relative;color:${color}">${p2.id}</span>`;
      }
      e.classList.toggle('contested', p2.contested);
    }
    const t = Math.max(0, Math.ceil(state.phaseLeft));
    const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    this.set('timer', state.phase === 'warmup' ? `DEPLOYING <b>${clock}</b>` : state.phase === 'ended' ? `NEXT ROUND <b>${clock}</b>` : `<b>${clock}</b> · FIRST TO ${state.config.scoreLimit}`, 'html');
    // Capture status for the point I'm standing in.
    let inside: { id: PointId; progress: number; capturing: number; owner: number; contested: boolean } | undefined;
    if (me?.alive) for (const pt of state.points) {
      const def = mapPoints.find(d => d.id === pt.id)!;
      if (Math.hypot(me.m.x - def.x, me.m.z - def.z) <= def.radius && Math.abs(me.m.y - def.y) < 4.5) inside = pt;
    }
    this.el.capture.hidden = !inside;
    if (inside && me) {
      const name = mapPoints.find(d => d.id === inside!.id)!.name.toUpperCase();
      const text = inside.contested ? `${inside.id} · ${name} · CONTESTED` : inside.owner === me.team && inside.capturing === -1 ? `${inside.id} · ${name} · SECURED` : `${inside.id} · ${name} · ${inside.capturing === me.team ? 'CAPTURING' : 'LOSING'}`;
      this.set('captureText', text);
      const bar = this.el.captureBar;
      const pct = Math.abs(inside.progress) / 2;
      bar.style.width = `${pct}%`;
      bar.style.left = inside.progress >= 0 ? '50%' : `${50 - pct}%`;
      bar.style.background = inside.progress >= 0 ? 'var(--aegis)' : 'var(--crimson)';
    }
    // Vitals and weapon.
    if (me) {
      this.set('name', me.name); this.set('loadout', LOADOUTS[p.loadout].name);
      this.set('shield', String(Math.ceil(me.shield))); this.set('health', String(Math.ceil(me.health)));
      this.set('shieldBar', `${me.shield / HEALTH.shield * 100}%`, 'width');
      this.set('healthBar', `${me.health / HEALTH.max * 100}%`, 'width');
      this.el.healthMeter.classList.toggle('low', me.health < 35);
    }
    const w = p.weapon;
    this.set('weapon', `${w.name} · ${LOADOUTS[p.loadout].weapons.map(id => WEAPONS[id].short).join(' / ')}`);
    const ammo = p.ammo[p.slot];
    this.set('ammo', `${ammo}<small>/${w.magazine}</small>`, 'html');
    this.el.ammo.classList.toggle('low', ammo > 0 && ammo <= w.magazine * 0.25);
    this.el.ammo.classList.toggle('empty', ammo === 0);
    this.set('nades', String(p.grenades));
    this.set('fire', p.reloading ? 'RELOADING' : w.auto ? 'AUTO' : 'SEMI');
    this.set('reload', `${p.reloading ? (1 - p.reloadLeft / p.reloadTotal) * 100 : 0}%`, 'width');
    // Death panel.
    const dead = !!me && !me.alive && state.phase !== 'ended';
    this.el.death.hidden = !dead;
    if (dead && me) {
      const killer = state.soldiers.find(s => s.id === me.lastAttacker);
      this.set('deathText', `${killer ? `Neutralized by ${killer.name}` : 'Neutralized'} · redeploying in ${Math.max(0, me.respawnLeft).toFixed(1)}s · choose kit:`);
      this.root.querySelectorAll<HTMLButtonElement>('[data-loadout]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.loadout === me.loadout)));
    }
    // End of round.
    this.el.end.hidden = state.phase !== 'ended';
    if (state.phase === 'ended' && me) {
      const won = state.winner === me.team;
      this.set('endTitle', state.winner === -1 ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT');
      this.el.endTitle.style.color = state.winner === -1 ? 'var(--ink)' : TEAM_CSS[state.winner];
      this.set('endSub', `${TEAM_SHORT[0]} ${state.scores[0]} — ${state.scores[1]} ${TEAM_SHORT[1]}`);
      const best = [...state.soldiers].sort((a, b) => b.score - a.score)[0];
      this.set('endText', `MVP ${best?.name ?? '-'} · ${best?.score ?? 0} pts · next round in ${Math.ceil(state.phaseLeft)}s`);
    }
  }

  laws(laws: Laws, cooldown: number, cooldownLimit: number, changed?: string) {
    const rows = describeLaws(laws);
    const keys = ['gravity', 'time', 'lightSpeed', 'rewind'];
    this.set('laws', `<h4><span>Laws of this world</span><span>/ rewrite</span></h4>${rows.map((l, i) => `<div class="law${changed === keys[i] ? ' changed' : ''}"><span class="icon">${l.icon}</span><div><p>${l.text}</p><code>${l.value}</code></div></div>`).join('')}
      <div class="hint"><span><kbd>/</kbd> sentence</span><span><kbd>1</kbd> cube gravity</span><span><kbd>2</kbd> motion time</span><span><kbd>3</kbd> slow light</span><span><kbd>4</kbd> rewind</span>${cooldownLimit > 0 ? `<span class="cool" data-k="lawCool">${cooldown > 0 ? `recharging ${Math.ceil(cooldown)}s` : 'law engine ready'}</span>` : ''}</div>`, 'html');
  }

  hit(kind: 'body' | 'head' | 'kill') {
    const e = this.el.hit;
    e.classList.remove('head', 'kill');
    e.classList.add('on');
    if (kind !== 'body') e.classList.add(kind);
    this.hitTimer = kind === 'kill' ? 0.35 : 0.14;
  }

  damage(fromAngle: number) {
    const arc = document.createElement('div');
    arc.className = 'arc';
    this.el.dmg.appendChild(arc);
    this.damageArcs.push({ el: arc, angle: fromAngle, life: 1.2 });
    this.el.flash.style.opacity = '1';
  }

  killfeed(killer: Soldier | undefined, victim: Soldier | undefined, weapon: string, head: boolean, mine: boolean) {
    const item = document.createElement('div');
    if (mine) item.className = 'me';
    const name = (s?: Soldier) => s ? `<span class="t${s.team}">${escape(s.name)}</span>` : '<span>Sentinel</span>';
    const wpn = WEAPONS[weapon as keyof typeof WEAPONS]?.short ?? weapon.toUpperCase();
    item.innerHTML = `${killer && killer !== victim ? name(killer) : ''}<span class="wpn">${wpn}${head ? ' <span class="hs">◎</span>' : ''}</span>${name(victim)}`;
    this.el.feed.prepend(item);
    this.killfeedItems.unshift(item);
    if (this.killfeedItems.length > 6) this.killfeedItems.pop()!.remove();
    setTimeout(() => { item.remove(); this.killfeedItems = this.killfeedItems.filter(x => x !== item); }, 7000);
  }

  toast(text: string, ms = 3800) {
    clearTimeout(this.toastTimer);
    this.el.toast.textContent = text;
    this.el.toast.classList.add('on');
    this.toastTimer = setTimeout(() => this.el.toast.classList.remove('on'), ms);
  }

  announce(title: string, sub = '', color = 'var(--ink)') {
    const a = this.el.announce;
    (a.firstElementChild as HTMLElement).textContent = title;
    (a.firstElementChild as HTMLElement).style.color = color;
    (a.lastElementChild as HTMLElement).textContent = sub;
    a.classList.remove('on'); void a.offsetWidth; a.classList.add('on');
  }

  popScore(text: string) {
    const e = this.el.pop;
    e.textContent = text;
    e.classList.remove('on'); void e.offsetWidth; e.classList.add('on');
  }

  scope(on: boolean) { this.el.scope.hidden = !on; }
  scoreboard(show: boolean, state: MatchState, myId: number) {
    this.el.board.hidden = !show;
    if (!show) return;
    const table = (team: Team) => {
      const rows = state.soldiers.filter(s => s.team === team).sort((a, b) => b.score - a.score);
      return `<div><h3 style="color:${TEAM_CSS[team]}">${TEAM_SHORT[team]} · ${state.scores[team]}</h3><table><tr><th>Operative</th><th>K</th><th>D</th><th>Cap</th><th>Score</th></tr>${rows.map(s => `<tr class="${s.id === myId ? 'me' : ''} ${s.alive ? '' : 'dead'}"><td>${escape(s.name)}${s.bot ? '<span class="bot">BOT</span>' : ''}</td><td>${s.kills}</td><td>${s.deaths}</td><td>${s.captures}</td><td>${s.score}</td></tr>`).join('')}</table></div>`;
    };
    this.set('board', table(0) + table(1), 'html');
  }

  fps(text: string) { this.set('fps', text); }
  net(text: string) { this.set('net', text); }

  minimap(state: MatchState, me: Soldier | undefined, yaw: number, positions: Map<number, THREE.Vector3>, myPos: THREE.Vector3) {
    const ctx = this.minimapCtx, size = 380, scale = 2.1;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(yaw);
    ctx.translate(-myPos.x * scale, -myPos.z * scale);
    ctx.fillStyle = 'rgba(10,22,28,0.55)';
    ctx.fillRect(-400, -400, 800, 800);
    for (const s of this.map.solids) {
      if (s.maxY - s.minY < 0.8) continue;
      ctx.fillStyle = s.team !== undefined ? (s.team === 0 ? 'rgba(74,168,255,0.6)' : 'rgba(255,85,68,0.6)') : s.maxY - s.minY > 3 ? 'rgba(170,190,196,0.55)' : 'rgba(120,140,146,0.5)';
      ctx.fillRect(s.minX * scale, s.minZ * scale, (s.maxX - s.minX) * scale, (s.maxZ - s.minZ) * scale);
    }
    for (const p of state.points) {
      const def = this.map.points.find(d => d.id === p.id)!;
      ctx.strokeStyle = p.owner === -1 ? '#c8d2d6' : TEAM_HEX[p.owner];
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(def.x * scale, def.z * scale, def.radius * scale, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.translate(def.x * scale, def.z * scale); ctx.rotate(-yaw);
      ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 22px Rajdhani, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.id, 0, 0); ctx.restore();
    }
    for (const s of state.soldiers) {
      if (!s.alive || !me || s.id === me.id) continue;
      const pos = positions.get(s.id);
      if (!pos) continue;
      // Enemies show only when recently firing (like PlanetSide's spotting).
      if (s.team !== me.team && s.sinceShot > 2.5) continue;
      ctx.fillStyle = s.team === 0 ? '#4aa8ff' : '#ff5544';
      ctx.beginPath(); ctx.arc(pos.x * scale, pos.z * scale, 5, 0, Math.PI * 2); ctx.fill();
    }
    for (const b of state.bodies) {
      if (b.kind !== 'drone') continue;
      ctx.fillStyle = b.team === -1 ? '#c0ff7a' : b.team === 0 ? '#4aa8ff' : '#ff5544';
      ctx.fillRect(b.x * scale - 3, b.z * scale - 3, 6, 6);
    }
    ctx.restore();
    // Player arrow (always up).
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(size / 2, size / 2 - 11); ctx.lineTo(size / 2 - 7, size / 2 + 8); ctx.lineTo(size / 2 + 7, size / 2 + 8); ctx.closePath(); ctx.fill();
  }

  dispose() { this.root.remove(); }
}

function escape(s: string) { return s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`); }
