import { decodeFrame } from '../shared/match/frame';

/** What the load-test clients need from the replicated match (the `roster` + packed `frame` tables). */
export interface SoldierView { id: number; team: number; alive: boolean; x: number; y: number; z: number; yaw: number; crouch: number; corrections: number }
export interface WorldView { tick: number; mapId: string; myId: number; soldiers: Map<number, SoldierView>; totalKills: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConn = any;

const cache = new WeakMap<object, { data: Uint8Array; decoded: ReturnType<typeof decodeFrame> }>();

export function readWorld(conn: AnyConn, _me: number): WorldView {
  const db = conn.db;
  const mine = conn.identity ? db.player.identity.find(conn.identity) : undefined;
  const room = mine?.room ?? 0;
  const frameRow = db.frame.id.find(room);
  let decoded = undefined as ReturnType<typeof decodeFrame>;
  if (frameRow) {
    const hit = cache.get(conn);
    if (hit && hit.data === frameRow.data) decoded = hit.decoded;
    else { decoded = decodeFrame(frameRow.data); cache.set(conn, { data: frameRow.data, decoded }); }
  }
  const poses = new Map((decoded?.poses ?? []).map(p => [p.id, p]));
  const soldiers = new Map<number, SoldierView>();
  let totalKills = 0;
  for (const r of db.roster.iter()) {
    if (r.room !== room) continue;
    totalKills += r.kills;
    const p = poses.get(r.id);
    if (!p) continue;
    soldiers.set(r.id, { id: r.id, team: r.team, alive: p.alive, x: p.x, y: p.y, z: p.z, yaw: p.yaw, crouch: p.crouch, corrections: r.corrections });
  }
  return { tick: decoded?.tick ?? 0, mapId: frameRow?.mapId ?? db.match.id.find(room)?.mapId ?? 'cinder', myId: mine?.soldierId ?? -1, soldiers, totalKills };
}
/** Rooms and players; then, once in a room, only that room's rows (as the game client does). */
readWorld.queries = (_conn: AnyConn) => ['SELECT * FROM match', 'SELECT * FROM player'];
readWorld.roomQueries = (room: number) => [`SELECT * FROM roster WHERE room = ${room}`, `SELECT * FROM frame WHERE id = ${room}`, `SELECT * FROM match_event WHERE room = ${room}`];
