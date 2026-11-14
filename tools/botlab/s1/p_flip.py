"""Lab patch: a rest shorter than half a tick is no rest (the next move starts in the next tick), so the view can turn back at once after an overshoot."""
import sys
p = sys.argv[1]; s = open(p).read()
old = "if (wait > 0) { brain.handRest = wait - dt; return; }"
new = "if (wait > dt * 0.5) { brain.handRest = wait - dt; return; }"
assert s.count(old) == 1
open(p, 'w').write(s.replace(old, new))
