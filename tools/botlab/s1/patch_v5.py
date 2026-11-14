"""v4 -> v5 in the repository's bots.ts and state.ts: a move of the hand has a shortest time, speeds up and slows down, and a rest shorter than half a tick is no rest."""
import sys
R = '/home/user/workspace/repo/shared/match/'
s = open(R + 'bots.ts').read()
def sub(old, new):
    global s
    assert s.count(old) == 1, old[:60]
    s = s.replace(old, new)
sub("""   * A player's hand turns the view in short moves at one speed, with rests between them. Seconds, at the mean: one move (players:
   * 0.13 s at the median, 0.19 s at the mean), and the rest after it with no enemy in sight, with one, and with the trigger down
   * (players: 0.1 s, 0.07 s and 0.07 s at the median).
   */
  move: 0.15, rest: 0.1, restSeen: 0.07, restFire: 0.05,""",
"""   * A player's hand turns the view in short moves, with rests between them. Seconds: the shortest move and the mean of what comes on
   * top (players: 0.13 s at the median, 0.19 s at the mean), and the mean rest after a move with no enemy in sight, with one, and with
   * the trigger down (players: 0.1 s, 0.07 s and 0.07 s at the median).
   */
  moveLeast: 0.05, move: 0.11, rest: 0.1, restSeen: 0.07, restFire: 0.05,""")
sub("""/**
 * One tick of the hand on the view. `toYaw` and `toPitch` (rad) are the way to where the bot wants to look. A move starts when the
 * rest after the last one is over and the view is more than `slack` rad off; it is then carried out as it was planned, so the view
 * is behind something that moves. `rest`: the mean rest (s). `drift`: how fast (rad/s) the thing crosses the view.
 */""",
"""/** The share of a move of the hand that is done after the share `u` of its time: the hand speeds up, then slows down. */
const ease = (u: number) => u * u * (3 - 2 * u);

/**
 * One tick of the hand on the view. `toYaw` and `toPitch` (rad) are the way to where the bot wants to look. A move starts when the
 * rest after the last one is over and the view is more than `slack` rad off; it is then carried out as it was planned, so the view
 * is behind something that moves. `rest`: the mean rest (s); one shorter than half a tick is no rest, so the hand can turn back at
 * once when it went too far. `drift`: how fast (rad/s) the thing crosses the view.
 */""")
sub("if (wait > 0) { brain.handRest = wait - dt; return; }", "if (wait > dt * 0.5) { brain.handRest = wait - dt; return; }")
sub("left = Math.max(dt, -Math.log(1 - ctx.random()) * HAND.move);", "left = Math.max(dt, HAND.moveLeast - Math.log(1 - ctx.random()) * HAND.move);")
sub("""    brain.handRest = -Math.log(1 - ctx.random()) * rest;
  }
  const share = Math.min(1, dt / left), yaw = brain.handYaw! * share, pitch = brain.handPitch! * share;""",
"""    brain.handRest = -Math.log(1 - ctx.random()) * rest; brain.handFor = left;
  }
  // The share of what is left of the move that this tick does.
  const all = Math.max(left, brain.handFor ?? left), from = 1 - left / all, to = from + dt / all;
  const share = to >= 1 ? 1 : (ease(to) - ease(from)) / (1 - ease(from)), yaw = brain.handYaw! * share, pitch = brain.handPitch! * share;""")
open(R + 'bots.ts', 'w').write(s)
t = open(R + 'state.ts').read()
old = "handLeft?: number; handYaw?: number; handPitch?: number; handRest?: number;"
assert t.count(old) == 1
open(R + 'state.ts', 'w').write(t.replace(old, "handLeft?: number; handFor?: number; handYaw?: number; handPitch?: number; handRest?: number;"))
