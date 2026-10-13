import type { CollisionWorld } from './collision';
import { eyeHeight } from './movement';

/**
 * Auto-peek (三角洲行動-style 自動探頭): aiming down sights with cover right in front of you leans
 * your head and shoulders out past its edge.
 * No key: the lean is a pure function of the soldier's pose (feet, crouch, yaw, aiming) and the
 * map, so the client, the server and every other client work out the same lean from what they
 * already have, and the leaning head is where shots land (hitbox.ts).
 */
export const PEEK = {
  /** Sideways shift of the eye and head at full lean (m); the chest top moves `chest` of it. */
  offset: 0.42,
  chest: 0.55,
  /** The head drops a little as the body tilts (m), and the camera rolls (rad). */
  drop: 0.06,
  roll: 0.14,
  /** Cover counts when the view straight ahead is blocked this close (m)... */
  block: 1.3,
  /** ...and the view from the leaned eye then runs at least this far. */
  clear: 3,
  /** Seconds to lean all the way out or back (rendering). */
  time: 0.18,
} as const;

export type PeekSide = -1 | 0 | 1;

/** Unit vectors for a yaw: forward (yaw 0 looks down -z) and to the right. */
const forwardOf = (yaw: number) => ({ x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) });
const rightOf = (yaw: number) => ({ x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) });

/** Sideways shift of the head for a lean of -1 (left) to 1 (right). */
export function peekShift(yaw: number, lean: number) {
  const r = rightOf(yaw);
  return { x: r.x * lean * PEEK.offset, z: r.z * lean * PEEK.offset };
}

/** How far a horizontal ray from `o` along `d` runs before something solid stops it (up to `max`). */
function free(world: CollisionWorld, o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, max: number, team: number) {
  return world.raycast(o, d, max, team)?.t ?? max;
}

/**
 * Which way an aiming soldier leans: -1 left, 1 right, 0 not at all. Cover must block the view
 * straight ahead within PEEK.block, there must be room beside the head, and the view from the
 * leaned eye must run clear. Both sides clear (a post): the longer view wins, then `prefer`
 * (the side already leaned to, so a client does not flip at the edge), then the right.
 */
export function peekSide(world: CollisionWorld, x: number, y: number, z: number, crouch: number, yaw: number, team = -1, prefer: PeekSide = 0): PeekSide {
  const eye = { x, y: y + eyeHeight({ crouch }), z };
  const f = forwardOf(yaw);
  const ahead = free(world, eye, f, PEEK.block, team);
  if (ahead >= PEEK.block) return 0;
  const r = rightOf(yaw);
  let best: PeekSide = 0, bestView = 0;
  for (const side of [1, -1] as const) {
    const d = { x: r.x * side, y: 0, z: r.z * side };
    if (free(world, eye, d, PEEK.offset + 0.15, team) < PEEK.offset + 0.15) continue;
    const out = { x: eye.x + d.x * PEEK.offset, y: eye.y - PEEK.drop, z: eye.z + d.z * PEEK.offset };
    const view = free(world, out, f, PEEK.clear + 2, team);
    if (view < PEEK.clear) continue;
    if (!best || view > bestView + 0.5 || (Math.abs(view - bestView) <= 0.5 && side === prefer)) { best = side; bestView = view; }
  }
  return best;
}

/** What auto-peek needs to know about a soldier. */
export interface Peeker {
  m: { x: number; y: number; z: number; crouch: number };
  yaw: number; ads: boolean; alive: boolean; bot: boolean; team: number;
}

const memo = new WeakMap<object, { x: number; y: number; z: number; crouch: number; yaw: number; side: PeekSide }>();

/**
 * A soldier's lean as the simulation judges it (the server, Solo, and others' clients alike):
 * humans aiming down sights only. Remembered per soldier until its pose changes, so the several
 * hit tests of one tick share the rays.
 */
export function peekOf(world: CollisionWorld, s: Peeker): PeekSide {
  if (!s.alive || !s.ads || s.bot) return 0;
  const m = s.m, last = memo.get(s);
  if (last && last.x === m.x && last.y === m.y && last.z === m.z && last.crouch === m.crouch && last.yaw === s.yaw) return last.side;
  const side = peekSide(world, m.x, m.y, m.z, m.crouch, s.yaw, s.team);
  memo.set(s, { x: m.x, y: m.y, z: m.z, crouch: m.crouch, yaw: s.yaw, side });
  return side;
}

/** Ease a rendered lean toward its side, all the way in PEEK.time. */
export const easePeek = (lean: number, side: PeekSide, dt: number) => {
  const step = dt / PEEK.time;
  return lean < side ? Math.min(side, lean + step) : Math.max(side, lean - step);
};
