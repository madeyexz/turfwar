"""Lab patch: a move of the hand has a shortest time (fewer moves of one tick). argv[2] = floor, argv[3] = mean of the tail."""
import sys
p = sys.argv[1]; s = open(p).read()
old = "left = Math.max(dt, -Math.log(1 - ctx.random()) * HAND.move);"
new = "left = Math.max(dt, 0.05 - Math.log(1 - ctx.random()) * 0.11);"
assert s.count(old) == 1
open(p, 'w').write(s.replace(old, new))
