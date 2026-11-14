import re, sys
p = '/home/user/workspace/repo/shared/match/bots.ts'
s = open(p).read()
a = s.index('const AIM = {')
b = s.index('const FIRE = {')
new_aim = '''const AIM = {
  /**
   * Median distance (m) between the aim point and the enemy's chest, sideways, for a bot of no skill: `error + errorFar × distance`
   * (players' shots at a slow enemy: 0.22 m off under 5 m, 0.34 m at 8 to 15 m, 0.49 m at 30 to 60 m). Skill divides it by 1 + sharp × skill.
   */
  error: 0.22, errorFar: 0.006, sharp: 6,
  /** The first aim point at an enemy is looser (players: 1.3 m off half a second before the first shot); each next one keeps this share of the last error. */
  first: 2, keep: 0.6,
  /** The aim point is this far above the chest's middle (m), more with skill; the error up and down is this share of the sideways one. */
  up: 0.1, vertical: 0.6,
  /** Seconds between two aim points at full skill, and what a bot of no skill adds. */
  every: 0.3, everySlow: 0.2,
  /**
   * The hand covers `rate` times what is left to the aim point per second (players: 10 to 18), up to `flick` rad/s and never slower than
   * `creep` rad/s, and it rests while the view is within `rest` m of the aim point. So the view is 1/rate s behind an enemy that crosses it
   * (players: 0.035 s under 5 m, 0.07 to 0.12 s beyond). A bot aims ahead of the enemy by `lead` of that time, more with skill.
   */
  rate: 12, flick: 14, creep: 0.15, rest: 0.06, lead: 0.5, leadSkill: 0.5,
  /** The hand does not move straight: the view goes up or down by up to this share of each sideways move (players: 0.35 at the median). */
  wobble: 0.3,
  /** The trigger goes down when the view is within `fire` m of the enemy as the bot sees it (and never needs less than `fireMin` rad). */
  fire: 0.6, fireMin: 0.02,
};
'''
s = s[:a] + new_aim + s[b:]
# the engaged aim block
a = s.index("    // The aim: the bot holds one aim point, and looks at it again after a while, or sooner when the enemy has moved off it.")
b = s.index("    wantAds = w.class !== 'melee'")
new_block = '''    // The aim point rides on the enemy as the bot sees it: its chest (or what shows of it), a little high, with the bot's error.
    // A soldier peeking round cover shows its head and shoulder, not its chest.
    const chest = peekOf(ctx.world, target) !== 0 ? shapeOf(ctx, target).chestTop : chestPoint(feetOf(target), target.m.crouch);
    let aimLeft = (brain.aimLeft ?? -9) - dt;
    if (aimLeft <= 0) {
      // A new error, which keeps a part of the last one (the first one at this enemy is set where the bot notices it).
      if (aimLeft > -1) {
        const g = Math.sqrt(-2 * Math.log(1 - ctx.random()) * (1 - AIM.keep * AIM.keep)), a = ctx.random() * Math.PI * 2;
        brain.errYaw = brain.errYaw * AIM.keep + g * Math.cos(a); brain.errPitch = brain.errPitch * AIM.keep + g * Math.sin(a);
      }
      aimLeft = (AIM.every + slow * AIM.everySlow) * (0.7 + ctx.random() * 0.6);
    }
    brain.aimLeft = aimLeft;
    const sd = (AIM.error + AIM.errorFar * distance) / (1 + AIM.sharp * brain.skill) / MEDIAN;
    const seenYaw = Math.atan2(-(chest.x - eye.x), -(chest.z - eye.z)) + brain.errYaw * sd / reach;
    // How fast the enemy crosses the view (rad/s), from its speed and the bot's own: the bot aims ahead by a part of what its hand is behind.
    const crossing = (dz * (target.m.vx - bot.m.vx) - dx * (target.m.vz - bot.m.vz)) / (reach * reach);
    const share = Math.min(1, AIM.rate * (0.75 + brain.skill * 0.5) * dt);
    brain.aimYaw = seenYaw + crossing * dt / share * Math.min(1, AIM.lead + AIM.leadSkill * brain.skill);
    brain.aimPitch = Math.atan2(chest.y + AIM.up * (1 + 2 * brain.skill) - eye.y, distance) + brain.errPitch * sd * AIM.vertical / reach;
    // The hand: a stroke of the view to the aim point (fast at first, then slow), and a rest when the view is near enough.
    const toYaw = wrapAngle(brain.aimYaw - bot.yaw), toPitch = brain.aimPitch - bot.pitch;
    if (Math.hypot(toYaw, toPitch) * reach > AIM.rest) {
      const turn = stroke(toYaw, share, AIM.flick * dt, AIM.creep * dt);
      bot.yaw = wrapAngle(bot.yaw + turn);
      bot.pitch = clamp(bot.pitch + stroke(toPitch, share, AIM.flick * dt, AIM.creep * dt) + (ctx.random() * 2 - 1) * AIM.wobble * Math.abs(turn), -1.3, 1.3);
    }
    const near = Math.max(AIM.fireMin, AIM.fire / reach);
    const aligned = Math.abs(wrapAngle(seenYaw - bot.yaw)) < near && Math.abs(brain.aimPitch - bot.pitch) < near * 1.5;
'''
s = s[:a] + new_block + s[b:]
open(p, 'w').write(s)
