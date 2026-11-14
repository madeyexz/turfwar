"""v2 -> v3: the stop-and-go hand. Run on the v2 file."""
p = '/home/user/workspace/repo/shared/match/bots.ts'
s = open(p).read()
def cut(s, a, b, new):
    i = s.index(a); j = s.index(b, i)
    return s[:i] + new + s[j:]
# 1. AIM constants: the hand's numbers move to HAND
s = cut(s, '  /**\n   * The hand covers `rate` times', '  /** The trigger goes down when the view is within `fire` m', '''  /**
   * A move of the hand goes to where the enemy will be when the move ends, by this share (more with skill): players are behind an enemy
   * that crosses their view (by 0.035 s of its way under 5 m, 0.07 to 0.12 s beyond).
   */
  lead: 0.5, leadSkill: 0.5,
  /** The hand leaves the view alone while it is within `rest` m of the aim point (and never corrects less than `fine` rad). */
  rest: 0.06, fine: 0.004,
''')
s = s.replace('''const FIRE = {''', '''const HAND = {
  /**
   * A player's hand turns the view in short moves at one speed, with rests between them. Seconds, at the mean: one move (players:
   * 0.13 s at the median, 0.19 s at the mean), and the rest after it with no enemy in sight, with one, and with the trigger down
   * (players: 0.1 s, 0.07 s and 0.07 s at the median).
   */
  move: 0.15, rest: 0.1, restSeen: 0.07, restFire: 0.05,
  /** One move covers this share of the way to where the bot wants to look, or up to `gainMore` more; the next move corrects what is left. */
  gain: 0.75, gainMore: 0.35,
  /** No hand moves straight: a move takes the view up or down by up to this share of its sideways part (players: 0.3 at the median), but not more than `tiltMost` rad. */
  tilt: 0.6, tiltMost: 0.08,
  /** The fastest turn (rad/s): a longer way takes a longer move (players: 10.5 rad/s in the fastest 1% of the ticks). */
  flick: 12,
};
const FIRE = {''', 1)
# 2. the stroke helper -> the hand
s = cut(s, '/** One tick of an aim stroke over an offset', 'const CALLSIGNS = [', '''/**
 * One tick of the hand on the view. `toYaw` and `toPitch` (rad) are the way to where the bot wants to look. A move starts when the
 * rest after the last one is over and the view is more than `slack` rad off; it is then carried out as it was planned, so the view
 * is behind something that moves. `rest`: the mean rest (s). `drift`: how fast (rad/s) the thing crosses the view.
 */
function turnView(ctx: SimContext, bot: Soldier, brain: BotBrain, toYaw: number, toPitch: number, slack: number, rest: number, drift: number, dt: number) {
  let left = brain.handLeft ?? 0;
  if (left <= 0) {
    const wait = brain.handRest ?? 0;
    if (wait > 0) { brain.handRest = wait - dt; return; }
    if (Math.hypot(toYaw, toPitch) <= slack) return;
    left = Math.max(dt, -Math.log(1 - ctx.random()) * HAND.move);
    const gain = HAND.gain + ctx.random() * HAND.gainMore;
    const yaw = (toYaw + drift * left) * gain;
    const pitch = toPitch * gain + (ctx.random() * 2 - 1) * Math.min(HAND.tiltMost, HAND.tilt * Math.abs(yaw));
    left = Math.max(left, Math.hypot(yaw, pitch) / HAND.flick);
    brain.handYaw = yaw; brain.handPitch = pitch;
    brain.handRest = -Math.log(1 - ctx.random()) * rest;
  }
  const share = Math.min(1, dt / left), yaw = brain.handYaw! * share, pitch = brain.handPitch! * share;
  bot.yaw = wrapAngle(bot.yaw + yaw); bot.pitch = clamp(bot.pitch + pitch, -1.3, 1.3);
  brain.handYaw! -= yaw; brain.handPitch! -= pitch; brain.handLeft = left - dt;
}

''')
# 3. the fight
s = cut(s, "    // How fast the enemy crosses the view (rad/s)", "    wantAds = w.class !== 'melee'", '''    brain.aimYaw = Math.atan2(-(chest.x - eye.x), -(chest.z - eye.z)) + brain.errYaw * sd / reach;
    brain.aimPitch = Math.atan2(chest.y + AIM.up * (1 + 2 * brain.skill) - eye.y, distance) + brain.errPitch * sd * AIM.vertical / reach;
    // How fast the enemy crosses the view (rad/s), from its speed and the bot's own: a move of the hand goes a part of the way ahead of it.
    const crossing = (dz * (target.m.vx - bot.m.vx) - dx * (target.m.vz - bot.m.vz)) / (reach * reach);
    turnView(ctx, bot, brain, wrapAngle(brain.aimYaw - bot.yaw), brain.aimPitch - bot.pitch, Math.max(AIM.fine, AIM.rest / reach),
      brain.burst > 0 ? HAND.restFire : HAND.restSeen, crossing * Math.min(1, AIM.lead + AIM.leadSkill * brain.skill), dt);
    const near = Math.max(AIM.fireMin, AIM.fire / reach);
    const aligned = Math.abs(wrapAngle(brain.aimYaw - bot.yaw)) < near && Math.abs(brain.aimPitch - bot.pitch) < near * 1.5;
''')
a = s.index("    const seenYaw = Math.atan2("); b = s.index("    brain.aimYaw = Math.atan2(", a)
s = s[:a] + s[b:]
# 4. out of the fight
old_a = "    // The finger comes off late when the enemy drops or goes out of sight; the view stays where it was for those shots.\n    pull = brain.burst > 0;\n    if (!pull) {\n"
i = s.index(old_a); j = s.index("      if (bot.weapon === 2 && bot.switchLeft <= 0)", i)
s = s[:i] + '''    // The finger comes off late when the enemy drops or goes out of sight; the hand ends its move and no more for those shots.
    pull = brain.burst > 0;
    if (pull) turnView(ctx, bot, brain, 0, 0, 1, HAND.restFire, 0, dt);
    else {
      // Look where we are going when not fighting, a little below level.
      turnView(ctx, bot, brain, moveX || moveZ ? wrapAngle(Math.atan2(-moveX, -moveZ) - bot.yaw) : 0, -(BODY.rest + habit(bot, 2) * BODY.restMore) - bot.pitch, BODY.slack, HAND.rest, 0, dt);
''' + s[j:]
open(p, 'w').write(s)
