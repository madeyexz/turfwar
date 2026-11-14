"""Lab patch: the hand speeds up and slows down inside a move (smoothstep) instead of one speed."""
import sys
p = sys.argv[1]; s = open(p).read()
old = """    brain.handRest = -Math.log(1 - ctx.random()) * rest;
  }
  const share = Math.min(1, dt / left), yaw = brain.handYaw! * share, pitch = brain.handPitch! * share;"""
new = """    brain.handRest = -Math.log(1 - ctx.random()) * rest; brain.handFor = left;
  }
  const all = Math.max(left, brain.handFor ?? left), from = 1 - left / all, to = from + dt / all;
  const share = to >= 1 ? 1 : (ease(to) - ease(from)) / (1 - ease(from)), yaw = brain.handYaw! * share, pitch = brain.handPitch! * share;"""
assert s.count(old) == 1
s = s.replace(old, new)
old2 = "function turnView("
assert s.count(old2) == 1
s = s.replace(old2, "const ease = (u: number) => u * u * (3 - 2 * u);\n" + old2)
open(p, 'w').write(s)
