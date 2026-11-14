"""Add the lab hook of the learned aim to the lab copy of bots.ts (the repository file has no hook)."""
import sys
p = sys.argv[1]; s = open(p).read()
def rep(old, new, n=1):
    global s
    assert s.count(old) == n, (old, s.count(old))
    s = s.replace(old, new)
rep("  const slow = 1 - brain.skill;\n", "  const slow = 1 - brain.skill;\n  const lab = LAB.before?.(state, ctx, bot, dt);\n  const own = !!lab?.active, ownTrigger = own && !lab?.script;\n")
# The script's hand, trigger and sights are off while the learned aim is active.
rep("    turnView(ctx, bot, brain, wrapAngle(brain.aimYaw - bot.yaw), brain.aimPitch - bot.pitch, Math.max(AIM.fine, AIM.rest / reach),", "    if (!own) turnView(ctx, bot, brain, wrapAngle(brain.aimYaw - bot.yaw), brain.aimPitch - bot.pitch, Math.max(AIM.fine, AIM.rest / reach),")
rep("    pull = brain.burst > 0 || (aligned && brain.burstPause <= 0 && distance < w.range * 0.6);", "    pull = !ownTrigger && (brain.burst > 0 || (aligned && brain.burstPause <= 0 && distance < w.range * 0.6));")
rep("    pull = brain.burst > 0;\n    if (pull) turnView(ctx, bot, brain, 0, 0, 1, HAND.restFire, 0, dt);\n    else {", "    pull = !ownTrigger && brain.burst > 0;\n    if (ownTrigger) brain.burst = 0;\n    if (own) { /* the learned hand has the view */ }\n    else if (pull) turnView(ctx, bot, brain, 0, 0, 1, HAND.restFire, 0, dt);\n    else {")
# The script's trigger with the learned hand: the shot itself is the lab's (the view's own spread and recoil).
rep("      if (w.pellets > 1) resolvePellets(state, ctx, bot, w, eye, dir, bot.ads);\n      else resolveShot(state, ctx, bot, w, eye, traceShot(state, ctx, bot, eye, dir, w.range));\n      if (bot.weapon !== 2) bot.ammo[bot.weapon]--;", "      if (own && lab?.script && LAB.shot) LAB.shot(state, ctx, bot, brain.burst);\n      else if (w.pellets > 1) resolvePellets(state, ctx, bot, w, eye, dir, bot.ads);\n      else resolveShot(state, ctx, bot, w, eye, traceShot(state, ctx, bot, eye, dir, w.range));\n      if (bot.weapon !== 2) bot.ammo[bot.weapon]--;")
rep("  const hurry = !target && (state.roundClock < BODY.dash || state.bomb.armed);", "  const hurry = !target && !lab?.noSprint && (state.roundClock < BODY.dash || state.bomb.armed);")
rep("    ads: wantAds, speed: w.speed,", "    ads: lab?.ads ?? wantAds, speed: w.speed,")
rep("  // ---- Drive the shared movement controller ---------------------------------------\n  const len = Math.hypot(moveX, moveZ);", "  // ---- Drive the shared movement controller ---------------------------------------\n  if (lab?.moveScale !== undefined) { moveX *= lab.moveScale; moveZ *= lab.moveScale; }\n  const len = Math.hypot(moveX, moveZ);")
s = s.rstrip() + "\n"
assert s.endswith("}\n")
# LAB.after at the end of updateBot (the last statement of the file's last function).
tail = "  if (bot.m.y < -60) bot.m.y = ctx.world.groundHeight(bot.m.x, bot.m.z, 100, MOVE.radius);\n}\n"
assert s.endswith(tail)
s = s[:-len(tail)] + tail[:-2] + "  LAB.after?.(state, ctx, bot, dt);\n}\n"
s = s.replace("/** Distance (m) from a bomb site's centre at which a bot stops to arm or disarm. */", """/** Lab only: a per-bot controller that can take the aim, the trigger and the sights from the script. */
export interface LabControl { active: boolean; noSprint: boolean; moveScale?: number; ads?: boolean; /** The script keeps the trigger (the learned aim has the view only). */ script?: boolean }
export const LAB: {
  before?: (state: MatchState, ctx: SimContext, bot: Soldier, dt: number) => LabControl | undefined;
  after?: (state: MatchState, ctx: SimContext, bot: Soldier, dt: number) => void;
  shot?: (state: MatchState, ctx: SimContext, bot: Soldier, burst: number) => void;
} = {};

/** Distance (m) from a bomb site's centre at which a bot stops to arm or disarm. */""", 1)
open(p, 'w').write(s)
print('patched', p)
