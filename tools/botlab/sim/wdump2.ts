import { WEAPONS } from './shared/weapons';
for (const w of Object.values(WEAPONS) as any[]) console.log(w.id, w.class, 'int', w.interval.toFixed(3), 'spread', JSON.stringify(w.spread), 'recoil', JSON.stringify(w.recoil), 'ads', w.adsTime, 'range', w.range, 'botRange', w.botRange, 'speed', w.speed, 'pellets', w.pellets);
