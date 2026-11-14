"""Lab patch: roam goals from the human places (sampled by their share of the time). argv[2] = mode: 'places' | 'nodes'; argv[3] = arrival rate per second (default 0.6)."""
import sys
p = sys.argv[1]; mode = sys.argv[2] if len(sys.argv) > 2 else 'places'; rate = sys.argv[3] if len(sys.argv) > 3 else '0.6'
s = open(p).read()
old = "  // Landmarks, weighted toward the enemy's half of the map.\n"
assert s.count(old) == 1
if mode == 'places':
    new = """  const places = PLACES[ctx.map.id]?.[bot.team];
  if (places) {
    let r = ctx.random(), pick = places[0];
    for (const q of places) { r -= q[3]; if (r <= 0) { pick = q; break; } }
    const angle = ctx.random() * Math.PI * 2, rr = ctx.random() * 2.5;
    brain.goal = 'roam'; brain.goalX = pick[0] + Math.cos(angle) * rr; brain.goalZ = pick[2] + Math.sin(angle) * rr; brain.goalY = pick[1]; brain.goalLeft = 40;
    return;
  }
"""
    s = s.replace("import { ATTACKERS,", "import { PLACES } from './places.lab';\nimport { ATTACKERS,", 1)
else:
    new = """  if (ctx.nav) {
    const nav = ctx.nav, eb = ctx.map.spawns.filter(q => q.team === sideOf(state, ctx.map, (1 - bot.team) as 0 | 1));
    const bx = eb.reduce((a, q) => a + q.x, 0) / (eb.length || 1), bz = eb.reduce((a, q) => a + q.z, 0) / (eb.length || 1);
    let pick = 0, top = -Infinity;
    for (let k = 0; k < 6; k++) {
      const i = Math.floor(ctx.random() * nav.x.length);
      const sc = -Math.hypot(nav.x[i] - bx, nav.z[i] - bz) / 120 - Math.hypot(nav.x[i] - bot.m.x, nav.z[i] - bot.m.z) / 200 + ctx.random() * 0.9;
      if (sc > top) { top = sc; pick = i; }
    }
    brain.goal = 'roam'; brain.goalX = nav.x[pick]; brain.goalZ = nav.z[pick]; brain.goalY = nav.y[pick]; brain.goalLeft = 40;
    return;
  }
"""
s = s.replace(old, new + old)
old2 = "else if (ctx.random() < dt * 0.6) { brain.goalLeft = Math.min(brain.goalLeft, 1.5); }"
assert s.count(old2) == 1
s = s.replace(old2, "else if (ctx.random() < dt * %s) { brain.goalLeft = Math.min(brain.goalLeft, 1.5); }" % rate)
open(p, 'w').write(s)
