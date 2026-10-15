// Development-only replay viewer for match recordings (docs/RECORDING.md "Proof"): a top-down view of one
// segment (.tfr, the internal set) or export file (.tfx), with soldiers by team, their aim, shots and kills,
// and the segment's checks (kill reconciliation, frame gaps). /dev/replay.html; open a decompressed file.
import { loadMap } from '../shared/maps/index';
import { decodeFrame, type DecodedFrame } from '../shared/match/frame';
import { decodeFrames, segmentChecks } from '../shared/rec/clean';
import { Ex, decodeExport } from '../shared/rec/export';
import { decodeSegment } from '../shared/rec/segment';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('map'), info = $('info'), seek = $<HTMLInputElement>('seek'), tickEl = $('tick');
const ctx = canvas.getContext('2d')!;
let frames: DecodedFrame[] = [];
let kills: { tick: number; victim: number; killer: number }[] = [];
let teams = new Map<number, number>();
let subjects = new Set<number>();
let mapId = '';
let at = 0, playing = false, last = 0;

async function open(bytes: Uint8Array) {
  const magic = new TextDecoder().decode(bytes.subarray(0, 4));
  if (bytes[0] === 0x28 && bytes[1] === 0xb5) { info.textContent = 'This file is zstd-compressed: run zstd -d on it first.'; return; }
  teams = new Map(); subjects = new Set(); kills = [];
  const dec = new TextDecoder();
  if (magic === 'TFR1') {
    const seg = decodeSegment(bytes), d = decodeFrames(seg), c = segmentChecks(d);
    frames = d.frames; mapId = seg.header.mapId;
    for (const s of seg.header.soldiers) { teams.set(s.soldierId, s.team); if (s.pid && !s.excluded) subjects.add(s.soldierId); }
    for (const { tick, e } of d.events) if (e.type === 'kill') kills.push({ tick, victim: e.victim, killer: e.killer });
    const h = seg.header;
    info.textContent = `${h.mapId} · ${h.mode} ${h.teamSize}v${h.teamSize} · ${h.roomKind} room ${h.room} · round ${h.round} · ticks ${h.startTick}–${h.endTick}\n`
      + `frames ${c.frames} · gap ratio ${(c.gapRatio * 100).toFixed(2)}% · ${c.ticksPerSecond.toFixed(2)} ticks/s · kills ${c.killsMatched}/${c.kills} reconciled${h.truncated ? ' · truncated' : ''}\n`
      + h.soldiers.map(s => `#${s.soldierId} team ${s.team} ${s.bot ? 'bot' : s.excluded ? 'human, not recorded (blanked)' : `subject ${s.device ?? ''}`}`).join('\n');
  } else if (magic === 'TFX1') {
    const x = decodeExport(bytes);
    frames = x.records.filter(r => r.type === Ex.Frame).map(r => decodeFrame(r.data)).filter((f): f is DecodedFrame => !!f);
    mapId = x.header.mapId;
    for (const s of x.header.soldiers) { teams.set(s.id, s.team); if (s.hasInput) subjects.add(s.id); }
    for (const r of x.records) if (r.type === Ex.Event) { const e = JSON.parse(dec.decode(r.data)); if (e.type === 'kill') kills.push({ tick: r.tick, victim: e.victim, killer: e.killer }); }
    info.textContent = `${x.header.mapId} · ${x.header.mode} ${x.header.teamSize}v${x.header.teamSize} · ${x.header.date} · ${x.header.rounds} rounds · ${frames.length} frames\n`
      + x.header.soldiers.map(s => `#${s.id} team ${s.team} ${s.bot ? 'bot' : `${s.device} ${s.input}${s.aimAssist ? ' + assist' : ''}${s.hasInput ? ' · controls' : ''}`}`).join('\n');
  } else { info.textContent = 'Not a TFR1 or TFX1 file.'; return; }
  frames.sort((a, b) => a.tick - b.tick);
  seek.max = String(Math.max(0, frames.length - 1)); seek.value = '0'; at = 0;
  draw();
}

const COLORS = ['#4fa3ff', '#ff6b4f'];
function draw() {
  const w = canvas.width = canvas.clientWidth * devicePixelRatio, h = canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.fillStyle = '#0b0f12'; ctx.fillRect(0, 0, w, h);
  if (!mapId || !frames.length) return;
  const map = loadMap(mapId).def, b = map.bounds;
  const sx = w / (b.maxX - b.minX), sz = h / (b.maxZ - b.minZ), s = Math.min(sx, sz) * 0.95;
  const ox = w / 2 - ((b.minX + b.maxX) / 2) * s, oz = h / 2 - ((b.minZ + b.maxZ) / 2) * s;
  const X = (x: number) => ox + x * s, Z = (z: number) => oz + z * s;
  ctx.fillStyle = '#2a343b';
  // Walls and cover, not floors: skip slabs that cover a large part of the map (high-rise floors sit far above y = 0).
  const area = (b.maxX - b.minX) * (b.maxZ - b.minZ);
  for (const sol of map.solids) if (sol.maxY - sol.minY > 1 && (sol.maxX - sol.minX) * (sol.maxZ - sol.minZ) < area * 0.2) ctx.fillRect(X(sol.minX), Z(sol.minZ), (sol.maxX - sol.minX) * s, (sol.maxZ - sol.minZ) * s);
  const f = frames[Math.min(at, frames.length - 1)];
  tickEl.textContent = `tick ${f.tick} · ${f.roundPhase}`;
  ctx.lineWidth = 1.5 * devicePixelRatio;
  for (const sh of f.shots) { ctx.strokeStyle = '#ffe28a'; ctx.beginPath(); ctx.moveTo(X(sh.from.x), Z(sh.from.z)); ctx.lineTo(X(sh.to.x), Z(sh.to.z)); ctx.stroke(); }
  for (const p of f.poses) {
    if (!p.alive) continue;
    const color = COLORS[teams.get(p.id) ?? 0] ?? '#ccc', r = (subjects.has(p.id) ? 6 : 4) * devicePixelRatio;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(p.x), Z(p.z), r, 0, Math.PI * 2); ctx.fill();
    if (subjects.has(p.id)) { ctx.strokeStyle = '#fff'; ctx.stroke(); }
    // Facing: yaw 0 looks down −Z.
    ctx.strokeStyle = color; ctx.beginPath(); ctx.moveTo(X(p.x), Z(p.z)); ctx.lineTo(X(p.x - Math.sin(p.yaw) * 4), Z(p.z - Math.cos(p.yaw) * 4)); ctx.stroke();
  }
  ctx.fillStyle = '#ff4f6b'; ctx.font = `${12 * devicePixelRatio}px monospace`;
  kills.filter(k => k.tick <= f.tick && k.tick > f.tick - 60).forEach((k, i) => ctx.fillText(`#${k.killer} ✕ #${k.victim}`, 10 * devicePixelRatio, (20 + 16 * i) * devicePixelRatio));
}

$<HTMLInputElement>('file').addEventListener('change', async e => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) await open(new Uint8Array(await f.arrayBuffer()));
});
seek.addEventListener('input', () => { at = Number(seek.value); draw(); });
$('play').addEventListener('click', () => { playing = !playing; $('play').textContent = playing ? 'Pause' : 'Play'; last = performance.now(); });
addEventListener('resize', draw);
const url = new URLSearchParams(location.search).get('file');
if (url) void fetch(url).then(r => r.arrayBuffer()).then(b => open(new Uint8Array(b)));
let acc = 0;
const loop = (t: number) => {
  if (playing && frames.length) {
    acc += ((t - last) / 1000) * 30 * Number($<HTMLSelectElement>('speed').value);
    while (acc >= 1 && at < frames.length - 1) { at++; acc--; }
    seek.value = String(at); draw();
  }
  last = t;
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
