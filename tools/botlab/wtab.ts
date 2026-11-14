import { weaponStats } from '/home/user/workspace/repo/shared/weapons';
for (const id of ['mp5', 'm4a1', 'm249', 'm1014', 'm110', 'm9a1', 'mp7'] as const) {
  const w = weaponStats(id);
  console.log(id, w.class, 'auto', w.auto, 'rpm', Math.round(60 / w.interval), 'mag', w.magazine, 'dmg', JSON.stringify(w.damage), 'hip', w.spread.hip.toFixed(2), 'ads', w.spread.ads.toFixed(2), 'bloom/shot', w.spread.bloomPerShot.toFixed(2), 'bloomMax', w.spread.bloomMax.toFixed(2), 'kickPitch', w.recoil.pitch.toFixed(2), 'adsPitch', w.recoil.adsPitch.toFixed(2), 'yaw', w.recoil.yaw.toFixed(2), 'botRange', w.botRange, 'range', w.range, 'speed', w.speed, 'reload', w.reload, 'price', w.price, 'adsTime', w.adsTime);
}
