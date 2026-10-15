import { FRAME_HEADER, FRAME_POSE, FRAME_VERSION } from '../match/frame';
import type { RecEnv } from './policy';
import { Rec, frameHead, jsonRecord, zeroSoldiers, type Segment, type SegmentRecord, type SegmentSoldier } from './segment';

/**
 * The recorder's core (no SpacetimeDB or R2 here, so it is tested on its own): it turns each room's
 * stream of packed frames, events and roster rows into one segment per round. Humans who are not
 * recording subjects are blanked in every frame (`zeroSoldiers`) and keep no pid; chat, callsigns and
 * shot events (the frames carry shots) are never kept. A round with no subject in it is not kept at all.
 */

/** What the server says about one human in a room (the admin-only `recorder_subjects` view). */
export interface Subject { pid?: string; subject: boolean; device: string; euUk: boolean; termsVersion: number }
export interface RoomInfo { configJson: string; mode: string; teamSize: number; private: boolean }
export interface RosterRow { id: number; team: number; bot: boolean; [k: string]: unknown }

export interface SegmenterOptions {
  env: RecEnv;
  recorderSha: string;
  moduleHash: () => string;
  mapHash: (mapId: string) => string;
  now: () => number;
  uid: () => string;
  onClose: (seg: Segment) => void;
  /** Rounds longer than this many ticks (a long warmup, a stuck room) are split. */
  maxTicks?: number;
}

/** Roster fields kept for subjects (no name); everyone else keeps only id, team, bot and alive. */
const ROSTER_SUBJECT = ['id', 'team', 'bot', 'alive', 'grenades', 'grenadeHE', 'kills', 'deaths', 'assists', 'score', 'lastAttacker', 'corrections', 'weapon0', 'weapon1', 'reserve0', 'reserve1', 'money', 'gearJson'];
const ROSTER_OTHER = ['id', 'team', 'bot', 'alive'];
/** Events kept; their callsign and text fields are dropped. */
const EVENTS = new Set(['damage', 'kill', 'spawn', 'explosion', 'smoke', 'molotov', 'slipper', 'drink', 'phase', 'round', 'bomb', 'reward', 'join', 'leave', 'team', 'vehicle']);

interface Open {
  mapId: string; info: RoomInfo; matchUid: string; round: number;
  startTick: number; lastTick: number; startMs: number; lastMs: number; received: number;
  records: SegmentRecord[]; soldiers: Map<number, SegmentSoldier>; roster: Map<number, string>;
  hasExcluded: boolean; moduleHash: string;
}

export class Segmenter {
  private rooms = new Map<number, Open>();
  /** Frames skipped because their version is not the one this recorder reads. */
  skippedVersion = 0;
  /** Rounds dropped because no recording subject played in them. */
  droppedNoSubject = 0;
  private readonly maxTicks: number;

  constructor(private o: SegmenterOptions) { this.maxTicks = o.maxTicks ?? 30 * 600; }

  get openRooms() { return [...this.rooms.keys()]; }

  /** A frame of `room` arrived. `who(id)`: the soldier's roster row; `subject(id)`: the server's consent row for a human in this room. */
  frame(room: number, mapId: string, bytes: Uint8Array, info: RoomInfo, who: (id: number) => RosterRow | undefined, subject: (id: number) => Subject | undefined) {
    const head = frameHead(bytes);
    if (!head) return;
    if (head.version !== FRAME_VERSION) { this.skippedVersion++; return; }
    let cur = this.rooms.get(room);
    const sameMatch = !!cur && cur.mapId === mapId && head.round >= cur.round && head.tick > cur.lastTick;
    if (cur && (!sameMatch || head.round !== cur.round || head.tick - cur.startTick >= this.maxTicks)) {
      const matchUid = sameMatch ? cur.matchUid : undefined;
      this.close(room, false);
      cur = undefined;
      if (matchUid) cur = this.open(room, mapId, info, head, matchUid);
    }
    cur ??= this.open(room, mapId, info, head, this.o.uid());
    const now = this.o.now();
    if (cur.received && head.tick > cur.lastTick + 1) cur.records.push(jsonRecord(Rec.Gap, head.tick, now, { from: cur.lastTick + 1, to: head.tick - 1 }));

    // Who is in the frame, and who of them must be blanked.
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = v.getUint16(21, true);
    const blank = new Set<number>();
    for (let i = 0; i < count; i++) {
      const id = v.getUint16(FRAME_HEADER + i * FRAME_POSE, true);
      const row = who(id);
      const bot = row?.bot ?? false;
      // `undefined`: the server has not told us about this human yet (they just joined): blank them for now
      // without deciding. A known human who is not a subject is left out for the rest of the round.
      const sub = bot ? undefined : subject(id);
      const ok = !bot && !!sub?.subject && !!sub.pid;
      let s = cur.soldiers.get(id);
      if (!s) {
        s = { soldierId: id, team: row?.team ?? -1, bot, from: head.tick, to: head.tick };
        cur.soldiers.set(id, s);
        this.rosterRow(cur, row, ok, head.tick, now);
      }
      s.to = head.tick;
      if (row && s.team < 0) s.team = row.team;
      if (!bot) {
        if (ok) {
          // A subject keeps their pid; one who turns datasets off mid-round is blanked from here on and the round is theirs no longer.
          if (!s.excluded) Object.assign(s, { pid: sub!.pid, device: sub!.device, euUk: sub!.euUk, termsVersion: sub!.termsVersion });
        } else if (sub) {
          s.excluded = true;
          delete s.device; delete s.euUk; delete s.termsVersion;
        }
        if (s.excluded) cur.hasExcluded = true;
        if (s.excluded || !ok) blank.add(id);
      }
    }
    cur.records.push({ type: Rec.Frame, tick: head.tick, ms: now, data: zeroSoldiers(bytes, blank) });
    cur.lastTick = head.tick; cur.lastMs = now; cur.received++;
  }

  /** An event of `room` (match_event json), tagged with the room's latest tick. */
  event(room: number, json: string) {
    const cur = this.rooms.get(room);
    if (!cur) return;
    let e: Record<string, unknown>;
    try { e = JSON.parse(json); } catch { return; }
    if (typeof e.type !== 'string' || !EVENTS.has(e.type)) return;
    delete e.name; delete e.text;
    cur.records.push(jsonRecord(Rec.Event, cur.lastTick, this.o.now(), e));
  }

  /** A roster row of `room` was inserted or changed. */
  roster(room: number, row: RosterRow, subject: (id: number) => Subject | undefined) {
    const cur = this.rooms.get(room);
    if (!cur) return;
    const sub = row.bot ? undefined : subject(row.id);
    const s = cur.soldiers.get(row.id);
    this.rosterRow(cur, row, !row.bot && !!sub?.subject && !!sub.pid && !s?.excluded, cur.lastTick, this.o.now());
  }

  private rosterRow(cur: Open, row: RosterRow | undefined, full: boolean, tick: number, now: number) {
    if (!row) return;
    const out: Record<string, unknown> = {};
    for (const k of full ? ROSTER_SUBJECT : ROSTER_OTHER) if (k in row) out[k] = row[k];
    const text = JSON.stringify(out);
    if (cur.roster.get(row.id) === text) return;
    cur.roster.set(row.id, text);
    cur.records.push(jsonRecord(Rec.Roster, tick, now, out));
  }

  private open(room: number, mapId: string, info: RoomInfo, head: { tick: number; round: number }, matchUid: string): Open {
    const cur: Open = {
      mapId, info, matchUid, round: head.round, startTick: head.tick, lastTick: head.tick, startMs: this.o.now(), lastMs: this.o.now(), received: 0,
      records: [], soldiers: new Map(), roster: new Map(), hasExcluded: false, moduleHash: this.o.moduleHash(),
    };
    this.rooms.set(room, cur);
    return cur;
  }

  /** Close `room`'s segment (the round ended, the room went away, or the recorder lost the server: `truncated`). */
  close(room: number, truncated: boolean) {
    const cur = this.rooms.get(room);
    if (!cur) return;
    this.rooms.delete(room);
    const soldiers = [...cur.soldiers.values()];
    if (!soldiers.some(s => s.pid && !s.excluded && !s.bot) || !cur.received) { this.droppedNoSubject++; return; }
    const expected = cur.lastTick - cur.startTick + 1;
    const seconds = Math.max(0.001, (cur.lastMs - cur.startMs) / 1000);
    this.o.onClose({
      header: {
        recFormat: 1, frameVersion: FRAME_VERSION, env: this.o.env, recorderSha: this.o.recorderSha, moduleHash: cur.moduleHash,
        mapId: cur.mapId, mapHash: this.o.mapHash(cur.mapId), configJson: cur.info.configJson, mode: cur.info.mode, teamSize: cur.info.teamSize,
        room, roomKind: cur.info.private ? 'private' : 'public', matchUid: cur.matchUid, round: cur.round,
        startTick: cur.startTick, endTick: cur.lastTick, startMs: cur.startMs, endMs: cur.lastMs,
        ticksExpected: expected, ticksReceived: cur.received, gapRatio: Math.max(0, 1 - cur.received / expected),
        ticksPerSecond: cur.received > 1 ? (cur.lastTick - cur.startTick) / seconds : 30,
        truncated, hasExcluded: cur.hasExcluded, soldiers,
      },
      records: cur.records,
    });
  }

  /** Close rooms whose frames stopped (a room ticks only while humans are in it). */
  closeIdle(idleMs: number) { const now = this.o.now(); for (const [room, cur] of [...this.rooms]) if (now - cur.lastMs > idleMs) this.close(room, false); }

  closeAll(truncated: boolean) { for (const room of [...this.rooms.keys()]) this.close(room, truncated); }
}
