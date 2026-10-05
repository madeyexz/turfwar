import type { BuyItem } from '../../shared/match/economy';
import type { Soldier } from '../../shared/match/state';
import { ECONOMY, WEAPONS, type WeaponCategory, type WeaponDef } from '../../shared/weapons';

const GROUPS: { category: WeaponCategory; title: string }[] = [
  { category: 'pistol', title: 'PISTOLS' }, { category: 'smg', title: 'SMGS' }, { category: 'shotgun', title: 'SHOTGUNS' },
  { category: 'rifle', title: 'RIFLES' }, { category: 'sniper', title: 'SNIPERS' }, { category: 'heavy', title: 'HEAVY' },
];

const rpm = (w: WeaponDef) => Math.round(60 / w.interval);

/**
 * The B menu: every weapon by category with its price. Bought weapons last until death and are
 * rebought automatically on respawn while you can afford them. The host validates every purchase.
 */
export class BuyMenu {
  readonly root: HTMLElement;
  private money: HTMLElement;
  private status: HTMLElement;
  private buttons = new Map<BuyItem, HTMLButtonElement>();
  onClose?: () => void;

  constructor(parent: HTMLElement, private purchase: (item: BuyItem) => void) {
    this.root = document.createElement('div');
    this.root.id = 'buymenu';
    this.root.hidden = true;
    const weapons = Object.values(WEAPONS);
    const card = (item: BuyItem, title: string, detail: string, price: number) =>
      `<button type="button" data-item="${item}"><span>${title}</span><small>${detail}</small><em>$${price}</em></button>`;
    this.root.innerHTML = `
      <header><h2>BUY</h2><span class="status"></span><span class="money"></span></header>
      ${GROUPS.map(g => {
        const items = weapons.filter(w => w.category === g.category).sort((a, b) => a.price - b.price);
        return items.length ? `<div class="group"><b>${g.title}</b><div class="items">${items.map(w =>
          card(w.id, w.name, `${w.projectile ? `${w.projectile.damage} blast` : `${w.pellets > 1 ? `${w.pellets}×` : ''}${w.damage} dmg`} · ${rpm(w)} rpm · ${w.magazine} rds`, w.price)).join('')}</div></div>` : '';
      }).join('')}
      <div class="group"><b>EQUIPMENT</b><div class="items">${card('grenade', 'Frag grenade', 'Bounces, then blows', ECONOMY.grenade)}</div></div>
      <div class="hint">Credits: kills, headshots and captures. Bought weapons last until you die and are rebought on respawn while affordable. <kbd>B</kbd> / <kbd>Esc</kbd> closes.</div>`;
    parent.appendChild(this.root);
    this.money = this.root.querySelector('.money')!;
    this.status = this.root.querySelector('.status')!;
    this.root.querySelectorAll<HTMLButtonElement>('[data-item]').forEach(b => {
      this.buttons.set(b.dataset.item as BuyItem, b);
      b.addEventListener('click', () => this.purchase(b.dataset.item as BuyItem));
    });
    window.addEventListener('keydown', e => {
      if (this.open && (e.code === 'Escape' || e.code === 'KeyB')) { e.preventDefault(); this.close(); }
    });
  }

  get open() { return !this.root.hidden; }

  show() { this.root.hidden = false; document.exitPointerLock?.(); }
  close() { if (!this.open) return; this.root.hidden = true; this.onClose?.(); }

  /** Refresh credits, buy-zone status and which items are affordable / already carried. */
  update(me: Soldier | undefined, canBuy: boolean, buyLeft: number, free = false) {
    if (!this.open || !me) return;
    this.money.textContent = free ? 'FREE BUY' : `$${me.money}`;
    this.status.textContent = canBuy ? (buyLeft > 0 ? `BUY TIME ${Math.ceil(buyLeft)}s · or at your spawn` : 'AT YOUR SPAWN') : 'BUY TIME OVER · RETURN TO YOUR SPAWN';
    this.status.classList.toggle('closed', !canBuy);
    for (const [item, b] of this.buttons) {
      const price = free ? 0 : item === 'grenade' ? ECONOMY.grenade : WEAPONS[item].price;
      const owned = item !== 'grenade' && me.weapons.includes(item);
      b.classList.toggle('owned', owned);
      b.disabled = !canBuy || owned || price > me.money;
    }
  }
}
