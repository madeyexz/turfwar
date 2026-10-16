import { FRAME_BODY, FRAME_HEADER, FRAME_POSE, FRAME_SHOT, FRAME_VEHICLE, FRAME_VERSION } from '../match/frame';
import { clockFit, type InputSession } from './clean';
import { In } from './inputlog';
import { EXPORT_RULES } from './policy';
import { Rec, recordJson, type Segment } from './segment';

/**
 * The export set (docs/RECORDING.md "Export"): one match → one de-identified `.tfx` file, made offline
 * from the internal set. Kept: the map, mode, size, rules, the date (Taipei calendar), each round's frames,
 * game events and roster changes, and the subjects' controls converted to view-angle changes and game
 * actions, with each soldier's device type, input type and aim-assist flag. Removed: every ID (game ID,
 * pid, match and room ids, session ids, the server's soldier and body ids — each soldier and body gets a
 * new random number in this file only), every wall-clock time (ticks count from the match's start), build
 * and module hashes, sensitivity, key codes, round trips, region flags, callsigns and chat. The container
 * is the segment's ("TFX1" instead of "TFR1"), zstd-compressed by the caller.
 */
export const EXPORT_MAGIC = 'TFX1';
export const Ex = { Frame: 1, Event: 2, Roster: 3, Input: 5 } as const;

/** One row of an Input record: kind, tick (from match start, fractional), then the kind's values. */
export const InputRow = { Frame: 1, Move: 2, Key: 3, Wheel: 4, Touch: 5, Shot: 6 } as const;
export const ROW_FLOATS = 10;

export interface ExportSoldier { id: number; team: number; bot: boolean; device?: string; input?: 'touch' | 'mouse'; aimAssist?: boolean; hasInput: boolean }
export interface ExportHeader {
  exportFormat: 1; rules: typeof EXPORT_RULES; frameVersion: number;
  /** Taipei calendar date (or ISO week `YYYY-Www` when the day's cell is small). */
  date: string;
  mapId: string; mapHash: string; mode: string; teamSize: number; configJson: string;
  rounds: number; ticks: number;
  soldiers: ExportSoldier[];
  /** Game actions named by Key rows (index → action ids joined with '|'). */
  actions: string[];
  /** What each Input row kind holds after kind and tick. */
  rowLayout: Record<string, string[]>;
}

const ROW_LAYOUT: ExportHeader['rowLayout'] = {
  // The look input is the player's own (before assist); the view turned by input × assistScale + assist.
  Frame: ['yawInputRad', 'pitchInputRad', 'assistYawRad', 'assistPitchRad', 'assistScale', 'yawRad', 'pitchRad', 'alive'],
  Move: ['yawRad (raw mouse × sensitivity, before ADS and assist)', 'pitchRad', 'coalesced'],
  Key: ['action', 'down'], Wheel: ['direction'], Touch: ['pointer', 'phase (0 down, 1 move, 2 up)', 'x (0..1)', 'y (0..1)'], Shot: [],
};

/** `count` distinct random ids in 1..32766 (they also fit the frame's signed 16-bit fields). */
export function randomIds(count: number, rand: (n: number) => Uint16Array = n => crypto.getRandomValues(new Uint16Array(n))): number[] {
  const out = new Set<number>();
  while (out.size < count) for (const v of rand(Math.max(8, count))) { const id = 1 + (v % 32766); if (out.size < count) out.add(id); }
  return [...out];
}

/** Copy of a frame with soldier and body ids replaced, the tick rebased and the match clock dropped. */
export function remapFrame(bytes: Uint8Array, soldiers: Map<number, number>, bodies: Map<number, number>, tickBase: number): Uint8Array | undefined {
  if (bytes.length < FRAME_HEADER || bytes[0] !== FRAME_VERSION) return undefined;
  const out = bytes.slice(), v = new DataView(out.buffer);
  const tick = v.getUint32(1, true);
  v.setUint32(1, Math.max(0, tick - tickBase), true);
  v.setFloat32(5, Math.max(0, tick - tickBase) / 30, true);
  const by = v.getInt16(19, true);
  if (by >= 0) v.setInt16(19, soldiers.get(by) ?? -1, true);
  const ns = v.getUint16(21, true), nb = v.getUint16(23, true), nshot = v.getUint16(25, true), nv = v.getUint8(27);
  let o = FRAME_HEADER;
  for (let i = 0; i < ns; i++, o += FRAME_POSE) v.setUint16(o, soldiers.get(v.getUint16(o, true)) ?? 0, true);
  for (let i = 0; i < nb; i++, o += FRAME_BODY) v.setUint16(o, bodies.get(v.getUint16(o, true)) ?? 0, true);
  for (let i = 0; i < nv; i++, o += FRAME_VEHICLE) {
    for (const at of [22, 24]) { const id = v.getInt16(o + at, true); if (id >= 0) v.setInt16(o + at, soldiers.get(id) ?? -1, true); }
  }
  for (let i = 0; i < nshot; i++, o += FRAME_SHOT) { const id = v.getUint16(o, true); v.setUint16(o, id === 0xffff ? 0xffff : soldiers.get(id) ?? 0xffff, true); }
  return out;
}

/** Event fields that name a soldier (MatchEvent: `vehicle` is a map vehicle's number and stays). */
const ID_FIELDS = ['killer', 'victim', 'target', 'attacker', 'owner', 'id', 'by', 'shooter'];

function remapEvent(e: Record<string, unknown>, soldiers: Map<number, number>): Record<string, unknown> | undefined {
  if (e.type === 'chat') return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(e)) {
    if (k === 'name' || k === 'text') continue;
    if (ID_FIELDS.includes(k) && typeof val === 'number') out[k] = val < 0 ? val : soldiers.get(val) ?? -1;
    else out[k] = val;
  }
  return out;
}

const ROSTER_KEEP = ['team', 'bot', 'alive', 'kills', 'deaths', 'assists', 'score', 'weapon0', 'weapon1', 'grenades', 'money', 'corrections', 'lastAttacker'];

export interface ExportInput { soldierId: number; sessions: InputSession[] }

/**
 * Build one export file from the rounds of one match (internal segments, any order) and the input
 * sessions of its subjects. The caller has already applied the selection rules (public room, no excluded,
 * EU/UK or opted-out player, …). `date` is the Taipei date or week to show.
 */
export function exportMatch(segments: Segment[], inputs: ExportInput[], date: string, rand?: (n: number) => Uint16Array): { header: ExportHeader; records: { type: number; tick: number; ms: number; data: Uint8Array }[] } {
  const segs = [...segments].sort((a, b) => a.header.startTick - b.header.startTick);
  const first = segs[0].header;
  const tickBase = first.startTick;
  // Every soldier and body id in the match gets a new random number.
  const soldierIds = new Set<number>(), bodyIds = new Set<number>();
  const info = new Map<number, { team: number; bot: boolean; device?: string }>();
  for (const s of segs) for (const x of s.header.soldiers) { soldierIds.add(x.soldierId); if (!info.has(x.soldierId)) info.set(x.soldierId, { team: x.team, bot: x.bot, device: x.device }); }
  for (const s of segs) for (const r of s.records) if (r.type === Rec.Frame && r.data.length >= FRAME_HEADER) {
    const v = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    const ns = v.getUint16(21, true), nb = v.getUint16(23, true);
    for (let i = 0; i < ns; i++) soldierIds.add(v.getUint16(FRAME_HEADER + i * FRAME_POSE, true));
    for (let i = 0; i < nb; i++) bodyIds.add(v.getUint16(FRAME_HEADER + ns * FRAME_POSE + i * FRAME_BODY, true));
  }
  const fresh = randomIds(soldierIds.size + bodyIds.size, rand);
  const soldiers = new Map([...soldierIds].map((id, i) => [id, fresh[i]]));
  const bodies = new Map([...bodyIds].map((id, i) => [id, fresh[soldierIds.size + i]]));

  const records: { type: number; tick: number; ms: number; data: Uint8Array }[] = [];
  const enc = new TextEncoder();
  for (const s of segs) for (const r of s.records) {
    const tick = Math.max(0, r.tick - tickBase);
    if (r.type === Rec.Frame) { const f = remapFrame(r.data, soldiers, bodies, tickBase); if (f) records.push({ type: Ex.Frame, tick, ms: 0, data: f }); }
    else if (r.type === Rec.Event) { const e = remapEvent(recordJson<Record<string, unknown>>(r), soldiers); if (e) records.push({ type: Ex.Event, tick, ms: 0, data: enc.encode(JSON.stringify(e)) }); }
    else if (r.type === Rec.Roster) {
      const row = recordJson<Record<string, unknown>>(r);
      const id = soldiers.get(row.id as number);
      if (id === undefined) continue;
      const out: Record<string, unknown> = { id };
      for (const k of ROSTER_KEEP) if (k in row) out[k] = k === 'lastAttacker' && typeof row[k] === 'number' ? (row[k] as number) < 0 ? -1 : soldiers.get(row[k] as number) ?? -1 : row[k];
      records.push({ type: Ex.Roster, tick, ms: 0, data: enc.encode(JSON.stringify(out)) });
    }
  }

  // Controls: rows of floats per subject, ticks from the clock fit, sensitivity and key codes resolved away.
  const actions: string[] = [];
  const actionIndex = (a: string) => { let i = actions.indexOf(a); if (i < 0) { i = actions.length; actions.push(a); } return i; };
  const meta = new Map<number, { input: 'touch' | 'mouse'; aimAssist: boolean; device: string }>();
  const lastTick = segs[segs.length - 1].header.endTick;
  for (const sub of inputs) {
    // Each page load has its own clock: put every session on the first one's (as the clean rules do).
    const base = sub.sessions[0]?.header.timeOrigin ?? 0;
    const recs = sub.sessions.flatMap(x => { const shift = (x.header.timeOrigin ?? base) - base; return x.records.map(r => ({ r: shift ? { ...r, t: r.t + shift } : r, h: x.header })); }).sort((a, b) => a.r.t - b.r.t);
    if (!recs.length) continue;
    const fit = clockFit(recs.map(x => x.r));
    const newId = soldiers.get(sub.soldierId);
    if (!fit || newId === undefined) continue;
    const h0 = recs[0].h;
    meta.set(sub.soldierId, { input: h0.touch ? 'touch' : 'mouse', aimAssist: !!h0.touch && !!h0.assist, device: h0.device });
    let sens = h0.sens;
    const rows: number[] = [];
    const row = (kind: number, tick: number, ...vals: number[]) => { rows.push(kind, tick - tickBase, ...vals, ...new Array(ROW_FLOATS - 2 - vals.length).fill(0)); };
    for (const { r, h } of recs) {
      const tick = fit.tickOf(r.t);
      if (tick < tickBase - 30 || tick > lastTick + 30) continue;
      switch (r.type) {
        case In.Sens: sens = r.sens; break;
        case In.Frame: row(InputRow.Frame, tick, -r.lookX * r.scale, -r.lookY * r.scale, r.assistYaw, r.assistPitch, r.assistScale, r.yaw, r.pitch, r.alive ? 1 : 0); break;
        case In.Move: row(InputRow.Move, tick, -r.dx * sens, -r.dy * sens, r.coalesced ? 1 : 0); break;
        case In.Key: row(InputRow.Key, tick, actionIndex(h.actions?.[r.key] ?? ''), r.down ? 1 : 0); break;
        case In.Wheel: row(InputRow.Wheel, tick, r.dir); break;
        case In.Touch: row(InputRow.Touch, tick, r.id, r.phase, r.x, r.y); break;
        case In.Send: if (r.kind === 1) row(InputRow.Shot, tick); break;
      }
    }
    if (!rows.length) continue;
    const data = new Uint8Array(2 + rows.length * 4);
    new DataView(data.buffer).setUint16(0, newId, true);
    const floats = new Float32Array(rows);
    data.set(new Uint8Array(floats.buffer), 2);
    records.push({ type: Ex.Input, tick: 0, ms: 0, data });
  }

  const header: ExportHeader = {
    exportFormat: 1, rules: EXPORT_RULES, frameVersion: first.frameVersion, date,
    mapId: first.mapId, mapHash: first.mapHash, mode: first.mode, teamSize: first.teamSize, configJson: first.configJson,
    rounds: segs.length, ticks: lastTick - tickBase,
    soldiers: [...soldierIds].map(id => {
      const i = info.get(id), m = meta.get(id);
      return { id: soldiers.get(id)!, team: i?.team ?? -1, bot: i?.bot ?? false, ...(i && !i.bot ? { device: m?.device ?? i.device ?? '', input: m?.input, aimAssist: m?.aimAssist } : {}), hasInput: !!m };
    }).sort((a, b) => a.id - b.id),
    actions, rowLayout: ROW_LAYOUT,
  };
  return { header, records };
}

export function encodeExport(x: { header: ExportHeader; records: { type: number; tick: number; ms: number; data: Uint8Array }[] }): Uint8Array {
  const enc = new TextEncoder();
  const head = enc.encode(JSON.stringify(x.header));
  let size = 8 + head.length;
  for (const r of x.records) size += 17 + r.data.length;
  const out = new Uint8Array(size), v = new DataView(out.buffer);
  out.set(enc.encode(EXPORT_MAGIC), 0); v.setUint32(4, head.length, true); out.set(head, 8);
  let o = 8 + head.length;
  for (const r of x.records) {
    v.setUint8(o, r.type); v.setUint32(o + 1, r.tick >>> 0, true); v.setFloat64(o + 5, 0, true); v.setUint32(o + 13, r.data.length, true);
    out.set(r.data, o + 17); o += 17 + r.data.length;
  }
  return out;
}

export function decodeExport(bytes: Uint8Array): { header: ExportHeader; records: { type: number; tick: number; data: Uint8Array }[] } {
  const dec = new TextDecoder();
  if (dec.decode(bytes.subarray(0, 4)) !== EXPORT_MAGIC) throw new Error('not a TFX1 file');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = v.getUint32(4, true);
  const header = JSON.parse(dec.decode(bytes.subarray(8, 8 + len))) as ExportHeader;
  const records: { type: number; tick: number; data: Uint8Array }[] = [];
  for (let o = 8 + len; o < bytes.length;) {
    const n = v.getUint32(o + 13, true);
    records.push({ type: v.getUint8(o), tick: v.getUint32(o + 1, true), data: bytes.subarray(o + 17, o + 17 + n) });
    o += 17 + n;
  }
  return { header, records };
}

/** X1: everything in an export file is on the allow list (no hex ids, no epoch times, no names). Returns problems. */
export function scanExport(file: { header: ExportHeader; records: { type: number; tick: number; data: Uint8Array }[] }, names: ReadonlySet<string> = new Set()): string[] {
  const problems: string[] = [];
  const allowed = new Set(['exportFormat', 'rules', 'frameVersion', 'date', 'mapId', 'mapHash', 'mode', 'teamSize', 'configJson', 'rounds', 'ticks', 'soldiers', 'actions', 'rowLayout']);
  for (const k of Object.keys(file.header)) if (!allowed.has(k)) problems.push(`header field ${k}`);
  for (const s of file.header.soldiers) for (const k of Object.keys(s)) if (!['id', 'team', 'bot', 'device', 'input', 'aimAssist', 'hasInput'].includes(k)) problems.push(`soldier field ${k}`);
  if (!/^\d{4}-(\d{2}-\d{2}|W\d{2})$/.test(file.header.date)) problems.push('date is not a day or a week');
  const dec = new TextDecoder();
  const text = [JSON.stringify({ ...file.header, mapHash: '', configJson: '' }), ...file.records.filter(r => r.type === Ex.Event || r.type === Ex.Roster).map(r => dec.decode(r.data))].join('\n');
  if (/[0-9a-f]{32,}/i.test(text)) problems.push('a long hex string');
  if (/\b1[6-9]\d{11}\b/.test(text)) problems.push('an epoch-millisecond time');
  for (const r of file.records) if (r.type === Ex.Event) { const e = JSON.parse(dec.decode(r.data)); if (e.type === 'chat' || 'name' in e || 'text' in e) problems.push('chat or a name in an event'); }
  for (const n of names) if (n.length >= 3 && text.includes(n)) { problems.push(`a callsign (${n.length} chars)`); break; }
  return problems;
}
