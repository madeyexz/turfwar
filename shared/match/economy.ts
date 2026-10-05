import { ECONOMY, GRENADE, HEALTH, LOADOUTS, WEAPONS, slotOf, type LoadoutId, type WeaponDef, type WeaponId } from '../weapons';
import type { MapDef } from '../maps/types';
import type { MatchState, Soldier } from './state';

/**
 * Credits and gear: soldiers earn credits for kills and captures, spend them in the buy
 * menu on weapons that last until death, and swap weapons from pickups placed on the map. The same
 * rules run in Solo and on the server, so every purchase and pickup is validated there.
 */
export type BuyItem = WeaponId | 'grenade';

/** Distance (m) within which a weapon pickup can be taken with E, or ammo/armor is collected. */
export const PICKUP_REACH = 2.2;

export const kitWeapons = (loadout: LoadoutId): [WeaponId, WeaponId] => [...LOADOUTS[loadout].weapons];
const spare = (w: WeaponDef) => w.magazine * ECONOMY.spareMags;

/** Put `id` into its slot with a full magazine and spare ammo, and bring it up. */
export function equip(s: Soldier, id: WeaponId) {
  const w = WEAPONS[id], slot = slotOf(w);
  s.weapons[slot] = id;
  s.ammo[slot] = w.magazine;
  s.reserve[slot] = spare(w);
  s.weapon = slot; s.reloadLeft = 0; s.switchLeft = w.equipTime;
}

/** Fresh deployment: the kit's weapons, full ammo, then rebuy what this soldier last bought. */
export function outfit(s: Soldier, random: () => number, free = false) {
  s.weapons = kitWeapons(s.loadout);
  s.ammo = [WEAPONS[s.weapons[0]].magazine, WEAPONS[s.weapons[1]].magazine];
  s.reserve = [spare(WEAPONS[s.weapons[0]]), spare(WEAPONS[s.weapons[1]])];
  s.sinceSpawn = 0;
  if (s.bot) botShop(s, random);
  else for (const id of s.bought) {
    const price = free ? 0 : WEAPONS[id || 'sidearm'].price;
    if (id && price <= s.money && s.weapons[slotOf(WEAPONS[id])] !== id) { s.money -= price; equip(s, id); }
  }
  s.weapon = 0; s.switchLeft = WEAPONS[s.weapons[0]].equipTime;
}

export function award(s: Soldier | undefined, amount: number) {
  if (s) s.money = Math.min(ECONOMY.max, s.money + amount);
}

/** Buying works for a short while after deploying, and always near your own team's spawn (anywhere with free buying). */
export function canBuy(s: Soldier, map: MapDef, free = false) {
  if (!s.alive) return false;
  if (free) return true;
  if (s.sinceSpawn < ECONOMY.buyTime) return true;
  return map.spawns.some(p => p.team === s.team && !p.point && Math.hypot(p.x - s.m.x, p.z - s.m.z) < ECONOMY.buyRadius);
}

export function buy(state: MatchState, map: MapDef, s: Soldier | undefined, item: BuyItem): { ok: boolean; message: string } {
  if (!s || !s.alive || state.phase === 'ended') return { ok: false, message: 'Deploy first.' };
  const free = !!state.config.freeBuy;
  if (!canBuy(s, map, free)) return { ok: false, message: 'Buy time is over — return to your spawn.' };
  if (item === 'grenade') {
    if (s.grenades >= GRENADE.perLife) return { ok: false, message: 'Grenades full.' };
    const cost = free ? 0 : ECONOMY.grenade;
    if (s.money < cost) return { ok: false, message: 'Not enough credits.' };
    s.money -= cost; s.grenades++;
    return { ok: true, message: 'Grenade' };
  }
  const w = WEAPONS[item];
  if (!w) return { ok: false, message: 'Unknown item.' };
  if (s.weapons[slotOf(w)] === item) return { ok: false, message: `${w.short} already equipped.` };
  const price = free ? 0 : w.price;
  if (s.money < price) return { ok: false, message: 'Not enough credits.' };
  s.money -= price;
  equip(s, item);
  s.bought[slotOf(w)] = item;
  return { ok: true, message: w.name };
}

/** Take pickup `index`: weapons swap into their slot; ammo refills spare ammo; armor restores vitals. */
export function takePickup(state: MatchState, map: MapDef, s: Soldier, index: number) {
  const def = map.pickups?.[index];
  if (!def || !s.alive || (state.pickupLeft[index] ?? 0) > 0) return false;
  if (Math.hypot(def.x - s.m.x, def.z - s.m.z) > PICKUP_REACH || Math.abs(def.y - s.m.y) > 2) return false;
  if (def.item === 'ammo') {
    const full = s.weapons.every((id, i) => s.reserve[i] >= spare(WEAPONS[id]));
    if (full) return false;
    s.weapons.forEach((id, i) => { s.reserve[i] = spare(WEAPONS[id]); });
  } else if (def.item === 'armor') {
    if (s.health >= HEALTH.max && s.shield >= HEALTH.shield) return false;
    s.health = HEALTH.max; s.shield = HEALTH.shield;
  } else {
    if (!WEAPONS[def.item] || s.weapons[slotOf(WEAPONS[def.item])] === def.item) return false;
    equip(s, def.item);
  }
  state.pickupLeft[index] = def.respawn;
  return true;
}

/**
 * Per tick: pickups come back, everyone walks over ammo and armor, and bots grab a lying weapon
 * that is better (pricier) than what they carry in that slot. Humans take weapons with E.
 */
export function updatePickups(state: MatchState, map: MapDef, dt: number) {
  const pickups = map.pickups;
  if (!pickups?.length) return;
  for (let i = 0; i < pickups.length; i++) {
    if (state.pickupLeft[i] > 0) { state.pickupLeft[i] = Math.max(0, state.pickupLeft[i] - dt); continue; }
    const def = pickups[i];
    for (const s of state.soldiers) {
      if (!s.alive || Math.abs(def.x - s.m.x) > PICKUP_REACH || Math.abs(def.z - s.m.z) > PICKUP_REACH) continue;
      const weapon = def.item !== 'ammo' && def.item !== 'armor' ? WEAPONS[def.item] : undefined;
      if (weapon && (!s.bot || weapon.price <= WEAPONS[s.weapons[slotOf(weapon)]].price)) continue;
      if (takePickup(state, map, s, i)) break;
    }
  }
}

/** Bots spend like a careless player: usually the priciest primary they can afford, sometimes they save. */
function botShop(s: Soldier, random: () => number) {
  if (random() < 0.25) return;
  const options = Object.values(WEAPONS).filter(w => slotOf(w) === 0 && w.price <= s.money && w.price > WEAPONS[s.weapons[0]].price);
  if (!options.length) return;
  let best = options[0], bestScore = -Infinity;
  for (const w of options) { const score = w.price + random() * 1500; if (score > bestScore) { bestScore = score; best = w; } }
  s.money -= best.price;
  equip(s, best.id);
}

/** Reload from spare ammo; bots carry endless spares (they never go looking for ammo). */
export function finishReload(s: Soldier, w: WeaponDef) {
  const need = w.magazine - s.ammo[s.weapon];
  const take = s.bot ? need : Math.min(need, s.reserve[s.weapon]);
  s.ammo[s.weapon] += take;
  if (!s.bot) s.reserve[s.weapon] -= take;
}
