import { Vector2 } from 'three';
import { loadMap, loadNav } from '../../shared/maps/index';
import { findPath, nearestNode } from '../../shared/match/nav';
import { HEALTH } from '../../shared/weapons';
import type { Renderer } from '../render/renderer';
import type { Game } from './game';
import type { Key } from '../ui/i18n';

export const BENCH_WARMUP = 4;
export const BENCH_SECONDS = 30;

export interface BenchResult {
  map: string;
  quality: string;
  resolution: string;
  gpu: string;
  userAgent: string;
  frames: number;
  seconds: number;
  avgFps: number;
  low1Fps: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Share of frames slower than a 60 Hz frame (with 1.5 ms of scheduling slack). */
  slowFrames: number;
  cpuMedianMs: number;
  cpuP95Ms: number;
  drawCalls: number;
  triangles: number;
  /** Shader programs compiled during the measured window (each one can cause a hitch). */
  shaderCompiles: number;
  /** Number of frames over 100 ms. */
  hitchCount: number;
  /** The first of those frames, with the measured second they happened at. */
  hitches: { at: number; ms: number; compiled: boolean }[];
  meets60: boolean;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * ?bench: a scripted solo Elimination match that patrols the map's landmarks, fights whatever it sees and
 * records real frame intervals. requestAnimationFrame is capped at the display's refresh rate,
 * so a 120 Hz screen can report up to ~120 fps; the 60 fps verdict only needs 60.
 */
export class Bench {
  private frames: number[] = [];
  private cpu: number[] = [];
  private calls = 0;
  private tris = 0;
  /** Measured seconds (after warm-up). */
  private elapsed = 0;
  private route: { x: number; z: number }[] = [];
  private leg = 0;
  private path: number[] = [];
  private pathIndex = 0;
  private stuckTime = 0;
  private lastX = 0;
  private lastZ = 0;
  private strafe = 0;
  private programs = -1;
  private lastPrograms = -1;
  private compiledLast = false;
  private warmLeft = BENCH_WARMUP;
  private hitches: { at: number; ms: number; compiled: boolean }[] = [];
  done?: BenchResult;
  onDone?: (result: BenchResult) => void;

  constructor(private game: Game, private renderer: Renderer, private quality: string) {
    game.input.driven = true;
  }

  /** Seconds of measurement remaining (warm-up included). */
  get remaining() { return Math.max(0, BENCH_SECONDS - this.elapsed); }
  get warming() { return this.warmLeft > 0; }

  /** Steer the local player for this frame. Call before Game.frame. */
  drive(dt: number) {
    if (this.done) return; // the player has the controls back
    const g = this.game, p = g.player, input = g.input, st = g.link.state();
    input.keys.clear(); input.forced.clear();
    if (!st) return;
    const me = st.soldiers.find(s => s.id === g.link.myId());
    if (!me) return;
    // Topped up well past the maximum every frame (solo only; the HUD caps the display) so no
    // single tick of damage can kill the benchmark soldier and stall the run on a death screen.
    me.health = HEALTH.max * 4;
    if (!p.alive || st.phase === 'ended') return;
    const { def, world } = loadMap(g.mapId);
    if (!this.route.length) {
      // Nearest landmark (bomb sites are among them) first, then the middle one, the far one and back.
      const byDistance = [...def.points].sort((a, b) => Math.hypot(a.x - p.m.x, a.z - p.m.z) - Math.hypot(b.x - p.m.x, b.z - p.m.z));
      const middle = [...def.points].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
      const ends = byDistance.filter(pt => pt !== middle);
      this.route = [ends[0], middle, ends[ends.length - 1], middle].map(pt => ({ x: pt.x, z: pt.z }));
    }

    const eye = p.eye();
    let target: { x: number; y: number; z: number } | undefined;
    let best = 42;
    for (const s of st.soldiers) {
      if (!s.alive || s.team === me.team) continue;
      const chest = { x: s.m.x, y: s.m.y + 1.25, z: s.m.z };
      const d = Math.hypot(chest.x - eye.x, chest.y - eye.y, chest.z - eye.z);
      if (d < best && world.lineOfSight(eye, chest)) { best = d; target = chest; }
    }
    if (target) {
      const dx = target.x - eye.x, dy = target.y - eye.y, dz = target.z - eye.z;
      const error = this.turn(Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz)), dt, 10);
      input.forced.add('aim');
      if (error < 0.08) input.forced.add('fire');
      this.strafe -= dt;
      if (this.strafe < -1.4) this.strafe = 1.4;
      input.forced.add(this.strafe > 0 ? 'left' : 'right');
      return;
    }

    const nav = loadNav(g.mapId);
    const goal = this.route[this.leg % this.route.length];
    if (Math.hypot(goal.x - p.m.x, goal.z - p.m.z) < 5) { this.leg++; this.path = []; return; }
    if (this.pathIndex >= this.path.length) {
      this.path = findPath(nav, nearestNode(nav, p.m.x, p.m.y, p.m.z), nearestNode(nav, goal.x, 0, goal.z));
      this.pathIndex = 1;
      if (this.path.length < 2) { this.leg++; this.path = []; return; }
    }
    const node = this.path[this.pathIndex];
    const dx = nav.x[node] - p.m.x, dz = nav.z[node] - p.m.z;
    if (Math.hypot(dx, dz) < 1.4) { this.pathIndex++; return; }
    this.turn(Math.atan2(-dx, -dz), 0, dt, 7);
    input.forced.add('forward');
    if (this.path.length - this.pathIndex > 3) input.forced.add('sprint');
    // Unstick: jump and re-plan if barely moving for a second.
    this.stuckTime = Math.hypot(p.m.x - this.lastX, p.m.z - this.lastZ) < 2 * dt ? this.stuckTime + dt : 0;
    this.lastX = p.m.x; this.lastZ = p.m.z;
    if (this.stuckTime > 1) { input.forced.add('jump'); this.path = []; this.stuckTime = 0; }
  }

  private turn(yaw: number, pitch: number, dt: number, rate: number) {
    const p = this.game.player, k = Math.min(1, dt * rate);
    const dy = wrap(yaw - p.yaw), dp = pitch - p.pitch;
    p.yaw += dy * k; p.pitch += dp * k;
    return Math.hypot(dy, dp);
  }

  /** Record one presented frame: the interval since the previous one and the main-thread time spent on it. */
  record(intervalMs: number, cpuMs: number) {
    if (this.done) return;
    // A frame's interval includes the previous frame's work, so a compile is charged to the next interval.
    const programs = this.renderer.renderer.info.programs?.length ?? 0;
    const compiled = this.compiledLast;
    this.compiledLast = this.lastPrograms >= 0 && programs !== this.lastPrograms;
    this.lastPrograms = programs;
    if (this.warmLeft > 0) {
      // Warm-up: the first frames build the scene and compile shaders. Each interval is capped so
      // one long compile frame cannot use up the whole warm-up.
      this.warmLeft -= Math.min(intervalMs, 250) / 1000;
      if (this.warmLeft <= 0) this.programs = programs;
      return;
    }
    this.elapsed += intervalMs / 1000;
    if (intervalMs > 100) this.hitches.push({ at: round(this.elapsed), ms: Math.round(intervalMs), compiled });
    this.frames.push(intervalMs); this.cpu.push(cpuMs);
    const info = this.renderer.renderer.info.render;
    this.calls += info.calls; this.tris += info.triangles;
    if (this.elapsed >= BENCH_SECONDS) this.finish();
  }

  private finish() {
    const sorted = [...this.frames].sort((a, b) => a - b), cpu = [...this.cpu].sort((a, b) => a - b), n = sorted.length;
    const at = (list: number[], q: number) => list[Math.min(list.length - 1, Math.floor(q * list.length))];
    const total = this.frames.reduce((a, b) => a + b, 0);
    const worst = sorted.slice(Math.floor(n * 0.99));
    const gl = this.renderer.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const size = this.renderer.renderer.getDrawingBufferSize(new Vector2());
    const avgFps = n / (total / 1000), p95 = at(sorted, 0.95);
    this.done = {
      map: this.game.mapId,
      quality: this.quality,
      resolution: `${size.x}×${size.y}`,
      gpu: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
      userAgent: navigator.userAgent,
      frames: n,
      seconds: round(total / 1000),
      avgFps: round(avgFps),
      low1Fps: round(1000 / (worst.reduce((a, b) => a + b, 0) / worst.length)),
      medianMs: round(at(sorted, 0.5), 2),
      p95Ms: round(p95, 2),
      p99Ms: round(at(sorted, 0.99), 2),
      maxMs: round(sorted[n - 1], 2),
      slowFrames: round(this.frames.filter(f => f > 1000 / 60 + 1.5).length / n * 100),
      cpuMedianMs: round(at(cpu, 0.5), 2),
      cpuP95Ms: round(at(cpu, 0.95), 2),
      drawCalls: Math.round(this.calls / n),
      triangles: Math.round(this.tris / n),
      shaderCompiles: (this.renderer.renderer.info.programs?.length ?? 0) - this.programs,
      hitchCount: this.hitches.length,
      hitches: this.hitches.slice(0, 12),
      meets60: avgFps >= 58 && p95 <= 1000 / 60 + 1.5,
    };
    const input = this.game.input;
    input.driven = false; input.clear();
    console.info('[lawbreaker] benchmark', this.done);
    this.onDone?.(this.done);
  }
}

/** Result rows: [label key (see i18n `bench.*`), value]. */
export function benchReport(r: BenchResult) {
  const rows: [Key, string][] = [
    ['bench.avg', `${r.avgFps} fps`],
    ['bench.low', `${r.low1Fps} fps`],
    ['bench.frame', `${r.medianMs} / ${r.p95Ms} / ${r.p99Ms} ms`],
    ['bench.slowest', `${r.maxMs} ms`],
    ['bench.slow', `${r.slowFrames}%`],
    ['bench.cpu', `${r.cpuMedianMs} / ${r.cpuP95Ms} ms`],
    ['bench.draws', `${r.drawCalls} · ${(r.triangles / 1000).toFixed(0)}k`],
    ['bench.hitches', `${r.hitchCount} · ${r.shaderCompiles}`],
    ['bench.setup', `${r.map} · ${r.quality} · ${r.resolution}`],
    ['bench.gpu', r.gpu],
  ];
  return rows;
}
