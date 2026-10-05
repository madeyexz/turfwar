import { describe, expect, it } from 'vitest';
import { HEALTH, LOADOUTS, WEAPONS, damageAt, slotOf, type WeaponCategory, type WeaponId } from './weapons';

const CATEGORIES: WeaponCategory[] = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper', 'heavy'];
/** Price bands per buy-menu category (kit-only weapons may sit at their band's edge). */
const BANDS: Record<WeaponCategory, [number, number]> = {
  pistol: [200, 800], smg: [1000, 1500], shotgun: [1100, 2000], rifle: [2000, 3200], sniper: [3000, 4750], heavy: [3500, 5000],
};
const all = Object.values(WEAPONS);
const TOUGHNESS = HEALTH.max + HEALTH.shield;

describe('weapon roster', () => {
  it('every weapon is complete: id, model, magazine, price band, category, bot range', () => {
    for (const w of all) {
      expect(WEAPONS[w.id as WeaponId]).toBe(w);
      expect(w.model).toMatch(/^Gun_/);
      expect(w.magazine).toBeGreaterThan(0);
      expect(w.reload).toBeGreaterThan(0);
      expect(w.interval).toBeGreaterThan(0);
      expect(CATEGORIES).toContain(w.category);
      const [lo, hi] = BANDS[w.category];
      expect(w.price, w.id).toBeGreaterThanOrEqual(lo);
      expect(w.price, w.id).toBeLessThanOrEqual(hi);
      expect(w.botRange).toBeGreaterThan(0);
      expect(w.recoil.pattern.length).toBeGreaterThan(0);
      expect(w.pellets).toBeGreaterThanOrEqual(1);
    }
  });

  it('the buy menu offers at least two weapons in every category', () => {
    for (const c of CATEGORIES) expect(all.filter(w => w.category === c).length, c).toBeGreaterThanOrEqual(2);
  });

  it('pistols are secondaries and everything else is a primary', () => {
    for (const w of all) expect(slotOf(w)).toBe(w.category === 'pistol' ? 1 : 0);
  });

  it('every kit starts with real weapons', () => {
    for (const kit of Object.values(LOADOUTS)) for (const id of kit.weapons) expect(WEAPONS[id]).toBeDefined();
  });

  it('point-blank body time-to-kill stays sane for hitscan weapons (no instant kills, no 3 s slogs)', () => {
    for (const w of all) {
      if (w.projectile) continue;
      const perShot = damageAt(w, 1) * w.pellets;
      const shots = Math.ceil(TOUGHNESS / perShot);
      const ttk = (shots - 1) * w.interval;
      expect(perShot, `${w.id} per shot`).toBeLessThan(TOUGHNESS + 1);
      expect(ttk, `${w.id} ttk`).toBeLessThan(2.5);
    }
  });

  it('only a bolt-action sniper one-shots on a headshot at range', () => {
    const oneShot = all.filter(w => !w.projectile && w.pellets === 1 && damageAt(w, 60) * w.headMultiplier >= TOUGHNESS).map(w => w.id);
    expect(oneShot).toContain('longbow');
    for (const id of oneShot) expect(WEAPONS[id].category).toBe('sniper');
  });
});
