import type { Identity } from 'spacetimedb';
import type { Vec3 } from '../../shared/math';
import type { ClientReport, MatchEvent, MatchState, PointState, ShotClaim, Soldier, Team } from '../../shared/match/state';
import type { LoadoutId } from '../../shared/weapons';
import type { Body } from '../../shared/world';
import type { GameLink } from '../game/link';
import type { DbConnection } from '../module_bindings';

type Env = Record<string, string | undefined>;

/**
 * Where the SpacetimeDB database lives. "same-origin" routes the websocket through the page's
 * own host at /stdb (the dev server proxies it), so a single preview URL serves everything.
 */
export function onlineConfig() {
  const env = import.meta.env as Env;
  const params = new URLSearchParams(location.search);
  let uri = params.get('stdb') ?? env.VITE_SPACETIMEDB_URI;
  const database = params.get('db') ?? env.VITE_SPACETIMEDB_DATABASE;
  // Trailing slash matters: the SDK resolves 'v1/...' relative to this base URL.
  if (uri === 'same-origin') uri = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/stdb/`;
  return { uri, database };
}

export function onlineAvailable(): { ok: boolean; reason: string } {
  const { uri, database } = onlineConfig();
  if (!uri || !database) return { ok: false, reason: 'No SpacetimeDB server is configured for this build. Solo skirmish works offline.' };
  return { ok: true, reason: `Server: ${database}` };
}

/** Rebuild a shared Soldier from a replicated row. */
function soldierFromRow(r: Record<string, unknown> & { id: number }): Soldier {
  const n = (k: string) => r[k] as number, b = (k: string) => r[k] as boolean;
  return {
    id: r.id, name: r.name as string, team: n('team') as Team, bot: b('bot'), loadout: r.loadout as LoadoutId,
    m: { x: n('x'), y: n('y'), z: n('z'), vx: n('vx'), vy: n('vy'), vz: n('vz'), grounded: b('grounded'), crouch: n('crouch'), slideTime: n('slideTime'), slideCooldown: n('slideCooldown'), airTime: n('airTime'), prevCrouchInput: b('prevCrouch'), prevJumpInput: b('prevJump') },
    yaw: n('yaw'), pitch: n('pitch'), alive: b('alive'), health: n('health'), shield: n('shield'), weapon: n('weapon') as 0 | 1, ammo: [n('ammo0'), n('ammo1')],
    reloadLeft: n('reloadLeft'), fireCooldown: n('fireCooldown'), switchLeft: n('switchLeft'), grenades: n('grenades'), respawnLeft: n('respawnLeft'),
    protectLeft: n('protectLeft'), sinceHit: n('sinceHit'), lastAttacker: n('lastAttacker'), kills: n('kills'), deaths: n('deaths'), score: n('score'),
    captures: n('captures'), lawCooldown: n('lawCooldown'), sprint: b('sprint'), ads: b('ads'), sinceShot: n('sinceShot'), corrections: n('corrections'), idle: n('idle'),
  };
}

/** A match hosted by the SpacetimeDB module; this client renders it and sends validated intents. */
export class OnlineLink implements GameLink {
  readonly mode = 'online' as const;
  readonly interpDelay = 0.1;
  private events: MatchEvent[] = [];
  private dirty = true;
  private ver = 0;
  private view?: MatchState;
  private me = -1;
  private pingMs = 0;
  private lastPing = 0;
  private reportsInFlight = 0;
  private disconnected = false;

  constructor(private conn: DbConnection, private identity: Identity) {
    const bump = () => { this.dirty = true; };
    const db = conn.db;
    db.soldier.onInsert(bump); db.soldier.onUpdate(bump); db.soldier.onDelete(bump);
    db.body.onInsert(bump); db.body.onUpdate(bump); db.body.onDelete(bump);
    db.point.onInsert(bump); db.point.onUpdate(bump);
    db.match.onUpdate(bump); db.match.onInsert(bump);
    db.player.onInsert(bump); db.player.onUpdate(bump); db.player.onDelete(bump);
    db.matchEvent.onInsert((_ctx, row) => { try { this.events.push(JSON.parse(row.json)); } catch { /* malformed event */ } });
  }

  markDisconnected() { this.disconnected = true; }
  myId() { this.state(); return this.me; }
  version() { this.state(); return this.ver; }

  state(): MatchState | undefined {
    if (!this.dirty && this.view) return this.view;
    const db = this.conn.db;
    const match = db.match.id.find(0);
    if (!match) return this.view;
    const soldiers = [...db.soldier.iter()].map(r => soldierFromRow(r as unknown as Record<string, unknown> & { id: number })).sort((a, b) => a.id - b.id);
    const bodies: Body[] = [...db.body.iter()].map(r => ({ ...r, kind: r.kind as Body['kind'] }));
    const points: PointState[] = [...db.point.iter()].map(p => ({ id: p.id as PointState['id'], progress: p.progress, owner: p.owner as -1 | Team, contested: p.contested, capturing: p.capturing as -1 | Team }));
    const mine = db.player.identity.find(this.identity);
    this.me = mine?.soldierId ?? -1;
    this.view = {
      mapId: match.mapId, phase: match.phase as MatchState['phase'], phaseLeft: match.phaseLeft, time: match.time, worldTime: match.worldTime,
      tick: match.tick, scores: [match.score0, match.score1], scoreTimer: match.scoreTimer, laws: JSON.parse(match.lawsJson), lawAuthor: match.lawAuthor,
      lawText: match.lawText, lawLeft: match.lawLeft, rewindLeft: match.rewindLeft, soldiers, points, bodies, nextId: match.nextId,
      droneTimer: match.droneTimer, winner: match.winner as -1 | Team, config: JSON.parse(match.configJson),
    };
    this.dirty = false;
    this.ver++;
    return this.view;
  }

  drainEvents() { const e = this.events; this.events = []; return e; }
  update() { /* the server ticks the match */ }

  status() {
    if (this.disconnected) return 'DISCONNECTED';
    const humans = this.view?.soldiers.filter(s => !s.bot).length ?? 0;
    return `ONLINE · ${humans} PLAYER${humans === 1 ? '' : 'S'} · ${Math.round(this.pingMs)} MS`;
  }

  report(r: ClientReport) {
    if (this.reportsInFlight > 3) return; // never queue up stale movement
    this.reportsInFlight++;
    const sent = performance.now();
    void this.conn.reducers.report({ ...r, weapon: r.weapon })
      .then(() => { if (sent - this.lastPing > 500) { this.pingMs = this.pingMs ? this.pingMs * 0.7 + (performance.now() - sent) * 0.3 : performance.now() - sent; this.lastPing = sent; } })
      .catch(() => undefined)
      .finally(() => { this.reportsInFlight--; });
  }
  fire(c: ShotClaim) {
    void this.conn.reducers.fire({ weapon: c.weapon, ox: c.origin.x, oy: c.origin.y, oz: c.origin.z, dx: c.dir.x, dy: c.dir.y, dz: c.dir.z, target: c.target, zone: c.zone, px: c.point.x, py: c.point.y, pz: c.point.z }).catch(() => undefined);
  }
  grenade(o: Vec3, d: Vec3) { void this.conn.reducers.grenade({ ox: o.x, oy: o.y, oz: o.z, dx: d.x, dy: d.y, dz: d.z }).catch(() => undefined); }
  reload() { void this.conn.reducers.reloadWeapon({}).catch(() => undefined); }
  switchWeapon(slot: 0 | 1) { void this.conn.reducers.switchSlot({ slot }).catch(() => undefined); }
  setLoadout(loadout: LoadoutId) { void this.conn.reducers.chooseLoadout({ loadout }).catch(() => undefined); }
  async law(command: unknown, source: string, text: string) {
    try {
      await this.conn.reducers.rewriteLaw({ commandJson: JSON.stringify(command), source, text });
      return { ok: true, message: '' };
    } catch (error) {
      return { ok: false, message: String((error as Error).message ?? error).replace(/^.*?:\s*/, '') || 'The server rejected that law.' };
    }
  }
  dispose() {
    void this.conn.reducers.leave({}).catch(() => undefined);
    setTimeout(() => { try { this.conn.disconnect(); } catch { /* already closed */ } }, 300);
  }
}

/** Connect, subscribe, join the match and wait until our soldier exists. */
export async function connectOnline(name: string, loadout: LoadoutId, team: Team | undefined, status: (s: string) => void): Promise<GameLink> {
  const { uri, database } = onlineConfig();
  if (!uri || !database) throw new Error('No SpacetimeDB server configured.');
  status('Connecting to SpacetimeDB…');
  const { DbConnection } = await import('../module_bindings');
  const tokenKey = `lawbreaker.token:${uri}:${database}`;
  let token: string | undefined;
  try { token = localStorage.getItem(tokenKey) ?? undefined; } catch { /* storage disabled */ }
  return new Promise<GameLink>((resolve, reject) => {
    let link: OnlineLink | undefined;
    const timer = setTimeout(() => reject(new Error('Timed out connecting to the match server.')), 20_000);
    const conn = DbConnection.builder().withUri(uri).withDatabaseName(database).withToken(token)
      .onConnect((connection, identity, nextToken) => {
        try { localStorage.setItem(tokenKey, nextToken); } catch { /* anonymous identity still works */ }
        status('Joining the battlefield…');
        link = new OnlineLink(connection, identity);
        connection.subscriptionBuilder()
          .onApplied(async () => {
            try {
              await connection.reducers.join({ name, loadout, team: team ?? -1 });
              const wait = () => {
                if (link!.myId() >= 0) { clearTimeout(timer); resolve(link!); } else setTimeout(wait, 50);
              };
              wait();
            } catch (error) { clearTimeout(timer); reject(error); }
          })
          .onError(() => { clearTimeout(timer); reject(new Error('Subscription failed.')); })
          .subscribe(['SELECT * FROM match', 'SELECT * FROM soldier', 'SELECT * FROM point', 'SELECT * FROM body', 'SELECT * FROM player', 'SELECT * FROM match_event']);
      })
      .onConnectError((_ctx, error) => { clearTimeout(timer); reject(new Error(`Could not reach the match server (${error?.message ?? 'connection refused'}).`)); })
      .onDisconnect(() => { link?.markDisconnected(); })
      .build();
    void conn;
  });
}
