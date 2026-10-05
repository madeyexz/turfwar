// Development-only store preview: the real BuyMenu with a fake soldier and the shared buy rules.
// /dev/store.html?money=4200&clock=8&away&closed&free&owned=m4a1,mp7&att=m4a1:holo,laser&tab=attachments&held=m4a1
// The buy clock counts down from ?clock (seconds, default 20; ?freeze stops it); ?away = outside your base;
// ?closed = buy time over; ?noassets shows the placeholder.
import { loadAssets } from '../src/assets';
import { BuyMenu } from '../src/ui/buymenu';
import { buy, buyAttachment } from '../shared/match/economy';
import type { MatchState, Soldier } from '../shared/match/state';
import type { MapDef } from '../shared/maps/types';
import { normalizeAttachments, type WeaponId } from '../shared/weapons';

const params = new URLSearchParams(location.search);
const info = document.getElementById('info')!;
const assets = params.has('noassets') ? undefined : await loadAssets(f => { info.textContent = `loading ${(f * 100).toFixed(0)}%`; });
info.textContent = '';

const owned = (params.get('owned') ?? '').split(',').filter(Boolean) as WeaponId[];
const me = {
  id: 1, alive: true, weapon: 0, weapons: ['mp5', 'm9a1'], owned: ['mp5', 'm9a1', ...owned], attachments: {},
  ammo: [30, 12], reserve: [90, 36], reloadLeft: 0, switchLeft: 0, grenades: Number(params.get('grenades') ?? 0), grenadeHE: params.has('he'),
  money: Number(params.get('money') ?? 4200), m: { x: params.has('away') ? 100 : 0, z: 0 },
} as unknown as Soldier;
for (const spec of (params.get('att') ?? '').split(';').filter(Boolean)) {
  const [w, list] = spec.split(':');
  me.attachments[w as WeaponId] = normalizeAttachments(Object.fromEntries(list.split(',').map((a, i) => [i, a])));
}
let clock = params.has('closed') ? 0 : Number(params.get('clock') ?? 20);
const free = params.has('free');
const state = { phase: 'live', config: { freeBuy: free, buyTime: 20 }, get roundClock() { return 20 - clock; } } as unknown as MatchState;
const map = { spawns: [{ team: 0, x: 0, y: 0, z: 0 }] } as unknown as MapDef;
const say = (r: { ok: boolean; message: string }) => { info.textContent = `${r.ok ? 'OK' : 'NO'} ${r.message}`; };

const menu = new BuyMenu(document.getElementById('app')!, {
  buy: item => say(buy(state, map, me, item, 0)),
  attach: (weapon, attachment) => say(buyAttachment(state, me, weapon, attachment)),
}, assets);
const held = (params.get('held') ?? undefined) as WeaponId | undefined;
const tick = () => menu.update(me, free || (clock > 0 && !params.has('away')), free ? -1 : clock, free);
tick();
setInterval(() => { if (!params.has('freeze')) clock = Math.max(0, clock - 0.1); tick(); }, 100);
menu.onClose = () => { info.textContent = 'Store closed — press B'; };
document.addEventListener('keydown', e => { if (e.code === 'KeyB' && !menu.open) menu.show(held); });
menu.show(held);
const tab = params.get('tab');
if (tab) document.querySelector<HTMLElement>(`[data-tab="${tab}"]`)?.click();
Object.assign(window, { __store: { menu, me } });
