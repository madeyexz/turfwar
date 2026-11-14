import { WEAPONS } from '/home/user/workspace/repo/shared/weapons';
for (const id of ['mp5', 'm4a1', 'm249', 'm1014', 'm110', 'm9a1'] as const) {
  const w: any = (WEAPONS as any)[id];
  console.log(id, JSON.stringify({ interval: w.interval, spread: w.spread, recoil: w.recoil, range: w.range, botRange: w.botRange, speed: w.speed, damage: w.damage, falloff: w.falloff }));
}
