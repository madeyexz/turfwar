import type { MapDef } from '../maps/types';
import {
  ATTACHMENTS, DEFAULT_WEAPONS, GRENADE, HIGH_EXPLOSIVE, SMOKE, WEAPONS, attachmentPrice, fitsWeapon, weaponStats,
  type AttachmentId, type WeaponDef, type WeaponId,
} from '../weapons';
import type { MatchState, RoundStats, Soldier, Team } from './state';

/**
 * BeGone's cash and store ([W:Cash], v1.8+): credits come from kills, assists, headshots, round
 * results and the bomb; weapons and attachments bought with B last for the whole match, owned
 * weapons swap in free during buy time, and ammo crates restock half a magazine. Shared by Solo
 * and the server, so every purchase is validated there.
 */
export const CASH = {
  matchBonus: 1000, max: 16000,
  kill: 500, grenadeKill: 900, knifeKill: 600, firstKill: 300, lastEnemy: 300,
  multiKill: 300, multiKillWindow: 4, streakEvery: 5, streak: 100,
  assist: 200, assistWindow: 3, trade: 100, firstBlood: 300, headshot: 100, headshotCap: 3,
  roundWin: 500, survivor: 200, lastStanding: 300, lossBonus: 500, lossBonusAfter: 3,
  loyalty: 1000, loyaltyEvery: 5, bomb: 500, crate: 300,
};

export type BuyItem = WeaponId | 'grenade' | 'highExplosive' | 'smoke';

/** Distance (m) within which an ammo crate can be used. */
export const CRATE_REACH = 2.4;

export const newRoundStats = (): RoundStats => ({ kills: 0, streak: 0, lastKillAt: -99, chain: 0, lastVictim: -1, hits: [], headshots: {}, damage: 0, crate: false });

/** Effective stats of the weapon in a slot, with its attachments. */
export function statsOf(s: Soldier, slot = s.weapon): WeaponDef {
  const id = slot === 2 ? 'knife' : s.weapons[slot];
  return weaponStats(id, s.attachments[id]);
}

/** Fresh match inventory: the defaults, no attachments, the new-match bonus. */
export function resetInventory(s: Soldier) {
  s.weapons = [...DEFAULT_WEAPONS];
  s.owned = [...DEFAULT_WEAPONS];
  s.attachments = {};
  s.grenades = 0; s.grenadeHE = false; s.smokes = 0;
  s.money = CASH.matchBonus;
}

/** Full magazines and reserves for both equipped weapons (each round and after buying). */
export function refillAmmo(s: Soldier) {
  for (const slot of [0, 1] as const) {
    const w = statsOf(s, slot);
    s.ammo[slot] = w.magazine; s.reserve[slot] = w.reserve;
  }
}

export function award(state: MatchState, s: Soldier | undefined, amount: number, reason: string, emit?: (e: { type: 'reward'; id: number; amount: number; reason: string }) => void) {
  if (!s || amount <= 0 || state.config.practice) return;
  s.money = Math.min(CASH.max, s.money + amount);
  emit?.({ type: 'reward', id: s.id, amount, reason });
}

/** Inside your own team's base (near any of its spawn slots) — where the store sells weapons. */
export function inBase(s: Soldier, map: MapDef, side: Team) {
  return map.spawns.some(p => p.team === side && Math.hypot(p.x - s.m.x, p.z - s.m.z) < 16);
}

/** Weapons: own base during buy time (dead players may shop for next round). Attachments: anywhere. */
export function canBuyWeapons(state: MatchState, map: MapDef, s: Soldier, side: Team) {
  if (state.config.freeBuy) return true;
  if (state.roundClock > state.config.buyTime) return false;
  return !s.alive || inBase(s, map, side);
}

const ok = (message: string) => ({ ok: true, message });
const no = (message: string) => ({ ok: false, message });

/** Buy (or, if owned, equip for free) a weapon, the M67 or its High Explosive mod, or the M18 smoke. */
export function buy(state: MatchState, map: MapDef, s: Soldier | undefined, item: BuyItem, side: Team): { ok: boolean; message: string } {
  if (!s || state.phase === 'ended') return no('Not in a match.');
  const free = !!state.config.freeBuy;
  if (item === 'smoke') {
    if (s.smokes >= SMOKE.max) return no('You already carry a smoke grenade.');
    if (!free && s.money < SMOKE.price) return no('Not enough cash.');
    if (!free) s.money -= SMOKE.price;
    s.smokes++;
    return ok('M18 smoke');
  }
  if (item === 'grenade' || item === 'highExplosive') {
    if (item === 'grenade') {
      if (s.grenades >= GRENADE.max) return no('You already carry an M67.');
      if (!free && s.money < GRENADE.price) return no('Not enough cash.');
      if (!free) s.money -= GRENADE.price;
      s.grenades++;
      return ok('M67');
    }
    if (s.grenadeHE) return no('High Explosive already fitted.');
    if (!free && s.money < HIGH_EXPLOSIVE.price) return no('Not enough cash.');
    if (!free) s.money -= HIGH_EXPLOSIVE.price;
    s.grenadeHE = true;
    return ok('High Explosive');
  }
  const w = WEAPONS[item];
  if (!w || w.slot === 2) return no('Unknown item.');
  if (!canBuyWeapons(state, map, s, side)) return no('Buy time is over — weapons are sold in your base at the start of a round.');
  const slot = w.slot;
  if (!s.owned.includes(item)) {
    if (!free && s.money < w.price) return no('Not enough cash.');
    if (!free) s.money -= w.price;
    s.owned.push(item);
  } else if (s.weapons[slot] === item) return no(`${w.name} already equipped.`);
  s.weapons[slot] = item;
  const stats = statsOf(s, slot);
  s.ammo[slot] = stats.magazine; s.reserve[slot] = stats.reserve;
  if (s.alive) { s.weapon = slot; s.reloadLeft = 0; s.switchLeft = stats.equipTime; }
  return ok(w.name);
}

/** Fit an attachment to an owned weapon (anywhere, any time); it replaces only the item in its own slot. */
export function buyAttachment(state: MatchState, s: Soldier | undefined, weapon: WeaponId, id: AttachmentId): { ok: boolean; message: string } {
  if (!s || state.phase === 'ended') return no('Not in a match.');
  const a = ATTACHMENTS[id];
  if (!a || !s.owned.includes(weapon) || !fitsWeapon(a, weapon)) return no('That attachment does not fit.');
  const fitted = s.attachments[weapon] ?? {};
  if (fitted[a.category] === id || (a.id === 'irons' && !fitted.optic)) return no(`${a.name} already fitted.`);
  // Iron sights are the default: switching back to them just takes the optic off, free.
  if (a.id === 'irons') { const { optic: _, ...rest } = fitted; s.attachments[weapon] = rest; return ok(a.name); }
  const price = state.config.freeBuy ? 0 : attachmentPrice(a, weapon);
  if (s.money < price) return no('Not enough cash.');
  s.money -= price;
  s.attachments[weapon] = { ...fitted, [a.category]: id };
  // Magazine size can change (extended clip, special ammo): keep what's loaded within the new size.
  for (const slot of [0, 1] as const) {
    if (s.weapons[slot] !== weapon) continue;
    s.ammo[slot] = Math.min(s.ammo[slot], statsOf(s, slot).magazine);
  }
  return ok(a.name);
}

/** Ammo crate (E): the first use each round costs $300, then it's free; each use adds RestockQuantity. */
export function useCrate(state: MatchState, map: MapDef, s: Soldier, index: number) {
  const crate = map.pickups?.[index];
  if (!crate || !s.alive || s.weapon === 2) return false;
  if (Math.hypot(crate.x - s.m.x, crate.z - s.m.z) > CRATE_REACH || Math.abs(crate.y - s.m.y) > 2) return false;
  const w = statsOf(s);
  if (s.reserve[s.weapon] >= w.reserve) return false;
  if (!s.round.crate && !state.config.freeBuy) {
    if (s.money < CASH.crate) return false;
    s.money -= CASH.crate;
  }
  s.round.crate = true;
  s.reserve[s.weapon] = Math.min(w.reserve, s.reserve[s.weapon] + w.restock);
  return true;
}

/** Reload from the reserve; bots carry endless spares (they never go looking for crates). */
export function finishReload(s: Soldier, w: WeaponDef) {
  if (s.weapon === 2) return;
  const need = w.magazine - s.ammo[s.weapon];
  const take = s.bot ? need : Math.min(need, s.reserve[s.weapon]);
  s.ammo[s.weapon] += take;
  if (!s.bot) s.reserve[s.weapon] -= take;
}

/** Bots shop like casual players at the start of a round: the best primary they can afford, sometimes an optic and a frag. */
export function botShop(s: Soldier, random: () => number) {
  const primaries = (Object.values(WEAPONS) as WeaponDef[]).filter(w => w.slot === 0 && w.price > 0);
  if (random() < 0.7) {
    const options = primaries.filter(w => w.price <= s.money && !s.owned.includes(w.id));
    if (options.length) {
      let best = options[0], bestScore = -Infinity;
      for (const w of options) { const score = w.price + random() * 1500; if (score > bestScore) { bestScore = score; best = w; } }
      s.money -= best.price; s.owned.push(best.id);
    }
  }
  const owned = primaries.filter(w => s.owned.includes(w.id));
  if (owned.length) s.weapons[0] = owned[Math.floor(random() * owned.length)].id;
  if (s.money > 2500 && random() < 0.4) {
    const fitted = s.attachments[s.weapons[0]] ?? {};
    if (!fitted.optic) {
      const optic = (['holo', 'reflex', 'acog'] as const)[Math.floor(random() * 3)];
      const a = ATTACHMENTS[optic];
      if (fitsWeapon(a, s.weapons[0]) && s.money >= a.price) { s.money -= a.price; s.attachments[s.weapons[0]] = { ...fitted, optic }; }
    }
  }
  if (s.grenades < GRENADE.max && s.money > 3000 && random() < 0.5) { s.money -= GRENADE.price; s.grenades = 1; }
}
