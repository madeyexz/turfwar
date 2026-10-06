import './store.css';
import type { Assets } from '../assets';
import type { BuyItem } from '../../shared/match/economy';
import type { Soldier } from '../../shared/match/state';
import {
  ATTACHMENTS, ATTACHMENT_IDS, ATTACHMENT_SLOTS, GRENADE, HIGH_EXPLOSIVE, WEAPONS, attachmentPrice, fitsWeapon, weaponStats,
  type AttachmentCategory, type AttachmentId, type Attachments, type WeaponClass, type WeaponDef, type WeaponId,
} from '../../shared/weapons';
import { StorePreview, type PreviewItem } from './storepreview';
import { L, applyI18n, attachmentName, onLang, t, weaponClass, type Key } from './i18n';

type Tab = 'primary' | 'secondary' | 'tactical' | 'attachments';
const TABS: { id: Tab }[] = [{ id: 'primary' }, { id: 'secondary' }, { id: 'tactical' }, { id: 'attachments' }];
const PRIMARY: WeaponId[] = ['mp5', 'm4a1', 'm1014', 'm110', 'm249'];
const SECONDARY: WeaponId[] = ['m9a1', 'mp7'];
const CLASS = (c: WeaponClass) => weaponClass(c);
/** Attachment slots on the gun: one item each, so gadgets in different slots stack. */
const SLOT_EMPTY: Record<AttachmentCategory, Key> = {
  optic: 'slot.empty.optic', muzzle: 'slot.empty.muzzle', laser: 'slot.empty.none', light: 'slot.empty.none', counter: 'slot.empty.none',
  magazine: 'slot.empty.standard', stock: 'slot.empty.standard', ammo: 'slot.empty.ammo',
};
const SLOT = (c: AttachmentCategory) => ({ name: t(`slot.${c}`), empty: t(SLOT_EMPTY[c]) });
const attName = (id: AttachmentId) => attachmentName(id, ATTACHMENTS[id].name);
/** One line on what each attachment does (`note.<id>` in i18n). */
const note = (id: AttachmentId) => t(`note.${id}`);

// BeGone's stats recovered from the derived WeaponDef (see `derive` in shared/weapons.ts).
const acc = (w: WeaponDef) => 100 - w.spread.hip / 0.35;
const zoomAcc = (w: WeaponDef) => 100 - w.spread.ads / 0.25;
const kick = (w: WeaponDef) => w.recoil.pitch / 0.45;
const zoomKick = (w: WeaponDef) => w.recoil.adsPitch / 0.45;
const magnify = (w: WeaponDef) => 1 / w.zoom;
const money = (n: number) => `$${n.toLocaleString('en-US')}`;
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const signed = (n: number, unit = '') => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(round1(n))}${unit}`;

/** Stat bars: 0..1 fill, the number compared, its label and whether more is better. */
interface Bar { name: Key; fill: (w: WeaponDef) => number; num: (w: WeaponDef) => number; label: (w: WeaponDef) => string; unit?: string; less?: boolean }
const BARS: Bar[] = [
  { name: 'bar.damage', fill: w => clamp01(w.damage.body * w.pellets / 90), num: w => w.damage.body * w.pellets, label: w => w.pellets > 1 ? `${w.damage.body}×${w.pellets}` : `${w.damage.body}` },
  { name: 'bar.headshot', fill: w => clamp01(w.damage.head * w.pellets / 160), num: w => w.damage.head * w.pellets, label: w => w.pellets > 1 ? `${w.damage.head}×${w.pellets}` : `${w.damage.head}` },
  { name: 'bar.rate', fill: w => clamp01(1 / w.interval / 13), num: w => 1 / w.interval, label: w => `${round1(1 / w.interval)}/s`, unit: '/s' },
  { name: 'bar.accuracy', fill: w => clamp01((acc(w) - 25) / 75), num: acc, label: w => `${round1(acc(w))}` },
  { name: 'bar.aimAcc', fill: w => clamp01((zoomAcc(w) - 35) / 65), num: zoomAcc, label: w => `${round1(zoomAcc(w))}` },
  { name: 'bar.recoil', fill: w => clamp01(kick(w) / 12), num: kick, label: w => `${round1(kick(w))}`, less: true },
  { name: 'bar.mobility', fill: w => clamp01((w.speed * 100 - 80) / 30), num: w => w.speed * 100, label: w => `${Math.round(w.speed * 100)}%`, unit: '%' },
];

/** Stat changes from fitting `id` to `wid` instead of what's in its slot. */
function changes(wid: WeaponId, fitted: Attachments, id: AttachmentId) {
  const base = weaponStats(wid, fitted), next = weaponStats(wid, withAttachment(fitted, id));
  const list = ([
    ['stat.head', next.damage.head - base.damage.head, 1, ''], ['stat.body', next.damage.body - base.damage.body, 1, ''], ['stat.limb', next.damage.limb - base.damage.limb, 1, ''],
    ['stat.magazine', next.magazine - base.magazine, 1, ''], ['stat.hipAcc', acc(next) - acc(base), 1, ''], ['stat.aimAcc', zoomAcc(next) - zoomAcc(base), 1, ''],
    ['stat.recoil', kick(next) - kick(base), -1, ''], ['stat.aimRecoil', zoomKick(next) - zoomKick(base), -1, ''], ['stat.move', (next.speed - base.speed) * 100, 1, '%'],
  ] as [Key, number, number, string][]).filter(([, d]) => Math.abs(d) > 0.01)
    .map(([key, d, good, unit]) => ({ name: t(key), up: d * good > 0, text: signed(d, unit) }));
  const zoom = magnify(next) - magnify(base);
  if (Math.abs(zoom) > 0.01) list.unshift({ name: t('stat.zoom'), up: zoom > 0, text: `${round1(magnify(base))}× → ${round1(magnify(next))}×` });
  return { base, next, list };
}

/** `fitted` with `id` in its slot (iron sights: no optic). */
function withAttachment(fitted: Attachments, id: AttachmentId): Attachments {
  const out = { ...fitted };
  if (id === 'irons') delete out.optic; else out[ATTACHMENTS[id].category] = id;
  return out;
}

const isFitted = (fitted: Attachments, id: AttachmentId) => fitted[ATTACHMENTS[id].category] === id || (id === 'irons' && !fitted.optic);
const fittedNames = (fitted: Attachments = {}) => ATTACHMENT_SLOTS.map(c => fitted[c]).filter((a): a is AttachmentId => !!a && a !== 'irons').map(attName);

interface Entry {
  key: string; name: string; sub: string; price: number;
  /** '' for sale, or the state shown instead of the price. */
  state: '' | 'equipped' | 'owned' | 'fitted' | 'default' | 'carried';
  disabled: boolean; reason?: string;
  /** Can't afford it (the badge turns red). */
  short?: boolean;
  item?: BuyItem; weapon?: WeaponId; attachment?: AttachmentId;
}

/**
 * BeGone's store (B), redesigned around a live 3D preview: the loadout you carry is always on top,
 * items are cards with a clear badge (price / owned / equipped), the selected item turns on a studio
 * turntable wearing the attachments it would have, and stats compare against what you have equipped.
 * Weapons sell in your base during buy time and stay yours for the match (owned ones swap in free);
 * attachments fit owned weapons anywhere, any time, one per slot. The host validates every purchase.
 */
export class BuyMenu {
  readonly root: HTMLElement;
  onClose?: () => void;
  private tab: Tab = 'primary';
  private selected: Partial<Record<Tab, string>> = {};
  /** Weapon being customised on the Attachments tab and its open slot. */
  private pick?: WeaponId;
  private slot: AttachmentCategory = 'optic';
  private slotPick: Partial<Record<AttachmentCategory, AttachmentId>> = {};
  private manualPick = false;
  /** Weapon in hand at the last render (to follow swaps). */
  private hand?: WeaponId;
  /** Last item clicked and when (double-click to buy). */
  private lastClick = { key: '', at: 0 };
  private hover?: string;
  private entries: Entry[] = [];
  private last?: { me: Soldier; canBuy: boolean; buyLeft: number; free: boolean };
  private buyTotal = 20;
  private signature = '';
  private preview: StorePreview;
  private el: Record<'tabs' | 'clock' | 'cash' | 'spent' | 'loadout' | 'side' | 'title' | 'info' | 'keys', HTMLElement>;
  private stopLang: () => void;

  constructor(parent: HTMLElement, private actions: { buy(item: BuyItem): void; attach(weapon: WeaponId, attachment: AttachmentId): void }, assets?: Assets) {
    this.root = document.createElement('div');
    this.root.id = 'store';
    this.root.hidden = true;
    this.root.innerHTML = `
      <header>
        ${L('store.title', 'h2')}
        <nav class="tabs"><kbd>Q</kbd>${TABS.map(tab => L(`store.tab.${tab.id}`, 'button', `type="button" data-tab="${tab.id}"`)).join('')}<kbd>E</kbd></nav>
        <div class="clock"></div>
        <div class="cash">${L('store.cash', 'small')}<b></b><span class="spent"></span></div>
        <button type="button" class="close" data-close aria-label="${t('store.close')}" data-i18n-aria-label="store.close">✕</button>
      </header>
      <section class="loadout"></section>
      <div class="body">
        <aside class="side"></aside>
        <main>
          <div class="stage"><div class="title"></div></div>
          <div class="info"></div>
        </main>
      </div>
      <footer class="keys"></footer>`;
    parent.appendChild(this.root);
    const q = (s: string) => this.root.querySelector<HTMLElement>(s)!;
    this.el = { tabs: q('.tabs'), clock: q('.clock'), cash: q('.cash b'), spent: q('.spent'), loadout: q('.loadout'), side: q('.side'), title: q('.title'), info: q('.info'), keys: q('.keys') };
    this.preview = new StorePreview(assets);
    q('.stage').prepend(this.preview.el);
    this.stopLang = onLang(() => { applyI18n(this.root); this.preview.relabel(); this.render(true); });

    this.root.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const data = (k: string) => t.closest<HTMLElement>(`[data-${k}]`)?.dataset[k];
      if (t.closest('[data-close]')) return this.close();
      const tab = data('tab') as Tab | undefined;
      if (tab) return this.setTab(tab);
      const custom = data('customize') as WeaponId | undefined;
      if (custom) { this.pick = custom; this.manualPick = true; return this.setTab('attachments'); }
      const lo = data('lo');
      if (lo) return this.loadoutClick(lo);
      const pick = data('pick') as WeaponId | undefined;
      if (pick) return this.pickGun(pick);
      const step = data('step');
      if (step) return this.stepGun(Number(step));
      const slot = data('slot') as AttachmentCategory | undefined;
      if (slot) return this.openSlot(slot);
      if (t.closest('[data-buy]')) return this.purchase();
      const key = data('key');
      if (!key) return;
      // Double-click buys. The first click re-renders the list, so the browser's dblclick lands on a
      // replaced element: detect the second click on the same item ourselves.
      const now = performance.now(), again = key === this.lastClick.key && now - this.lastClick.at < 450;
      this.lastClick = again ? { key: '', at: 0 } : { key, at: now };
      this.select(key);
      if (again) this.purchase();
    });
    // Hover tries an item on in the preview without selecting it.
    this.el.side.addEventListener('pointerover', e => {
      const key = (e.target as HTMLElement).closest<HTMLElement>('[data-key]')?.dataset.key;
      if (key !== this.hover) { this.hover = key; this.showPreview(); }
    });
    this.el.side.addEventListener('pointerleave', () => { if (this.hover) { this.hover = undefined; this.showPreview(); } });
    // Capture phase: store keys never reach the game while it's open.
    document.addEventListener('keydown', e => {
      if (!this.open || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const c = e.code;
      const digit = /^(Digit|Numpad)(\d)$/.exec(c);
      if (c === 'Escape' || c === 'KeyB') this.close();
      else if (digit) { const i = (Number(digit[2]) + 9) % 10; if (this.entries[i]) this.select(this.entries[i].key); }
      else if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') this.purchase();
      else if (c === 'KeyQ' || c === 'KeyE') this.setTab(TABS[(TABS.findIndex(t => t.id === this.tab) + (c === 'KeyE' ? 1 : 3)) % 4].id);
      else if (c === 'ArrowUp' || c === 'ArrowDown') this.move(c === 'ArrowDown' ? 1 : -1);
      else if (c === 'ArrowLeft' || c === 'ArrowRight') {
        if (this.tab === 'attachments') this.stepGun(c === 'ArrowRight' ? 1 : -1);
        else this.move(c === 'ArrowRight' ? 1 : -1);
      } else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
  }

  get open() { return !this.root.hidden; }

  /** Open the store; attachments default to the gun in hand (`held`). */
  show(held?: WeaponId) {
    if (held && held !== 'knife') { this.pick = held; this.slotPick = {}; }
    this.manualPick = false;
    this.hand = undefined;
    this.root.hidden = false;
    this.hover = undefined;
    document.exitPointerLock?.();
    this.preview.start();
    this.render(true);
  }

  close() {
    if (!this.open) return;
    this.root.hidden = true;
    this.preview.stop();
    this.onClose?.();
  }

  /** Free the preview's GL context now (optional: it is also released a while after closing). */
  dispose() { this.root.hidden = true; this.stopLang(); this.preview.stop(); this.preview.release(); }

  /** Refresh cash, buy window and owned/fitted state (re-renders only when something changed). */
  update(me: Soldier | undefined, canBuyWeapons: boolean, buyLeft: number, free: boolean) {
    if (!me) return;
    const before = this.last?.me.money;
    if (buyLeft > this.buyTotal || (this.last && buyLeft > this.last.buyLeft + 1)) this.buyTotal = Math.max(buyLeft, 1);
    this.last = { me, canBuy: canBuyWeapons, buyLeft, free };
    if (!this.open) return;
    if (before !== undefined && me.money < before) this.spent(before - me.money);
    this.render();
  }

  private setTab(tab: Tab) { this.tab = tab; this.hover = undefined; this.render(true); }

  private select(key: string) {
    if (this.tab === 'attachments' && key in ATTACHMENTS) { this.slot = ATTACHMENTS[key as AttachmentId].category; this.slotPick[this.slot] = key as AttachmentId; }
    else this.selected[this.tab] = key;
    this.render(true);
  }

  private move(d: number) {
    const i = this.entries.findIndex(x => x.key === this.selectedKey());
    const j = i + d;
    const next = this.entries[Math.max(0, Math.min(this.entries.length - 1, j))];
    if (next) this.select(next.key);
  }

  private loadoutClick(lo: string) {
    const me = this.last?.me;
    if (!me) return;
    if (lo === 'tactical') return this.setTab('tactical');
    if (lo === 'knife') return;
    const slot = Number(lo) as 0 | 1;
    this.selected[slot === 0 ? 'primary' : 'secondary'] = me.weapons[slot];
    this.setTab(slot === 0 ? 'primary' : 'secondary');
  }

  private pickGun(id: WeaponId) { this.pick = id; this.manualPick = true; this.slotPick = {}; this.hover = undefined; this.render(true); }
  private stepGun(d: number) {
    if (!this.last) return;
    const owned = this.ownedGuns(this.last.me), i = owned.indexOf(this.pick!);
    this.pickGun(owned[(i + d + owned.length) % owned.length]);
  }
  /** A slot header selects what that slot holds (or its first option). */
  private openSlot(slot: AttachmentCategory) {
    this.slot = slot; this.hover = undefined;
    const fitted = this.last?.me.attachments[this.pick!]?.[slot];
    const first = this.entries.find(e => e.attachment && ATTACHMENTS[e.attachment].category === slot);
    this.slotPick[slot] = fitted ?? (slot === 'optic' ? 'irons' : first?.attachment);
    this.render(true);
  }

  private ownedGuns(me: Soldier) { return [...PRIMARY, ...SECONDARY].filter(id => me.owned.includes(id)); }
  /** Slots that take at least one attachment on `wid`. */
  private slots(wid: WeaponId) { return ATTACHMENT_SLOTS.filter(c => ATTACHMENT_IDS.some(id => ATTACHMENTS[id].category === c && fitsWeapon(ATTACHMENTS[id], wid))); }
  private selectedKey() { return this.tab === 'attachments' ? this.slotPick[this.slot] : this.selected[this.tab]; }

  private purchase() {
    const e = this.entries.find(x => x.key === this.selectedKey());
    if (!e || e.disabled) return;
    if (e.item) this.actions.buy(e.item);
    else if (e.weapon && e.attachment) this.actions.attach(e.weapon, e.attachment);
  }

  private spent(amount: number) {
    const s = document.createElement('span');
    s.textContent = `−${money(amount)}`;
    this.el.spent.replaceChildren(s);
    setTimeout(() => s.remove(), 1400);
  }

  /** Why weapons can't be bought right now. */
  private closedReason() {
    const l = this.last!;
    return t(l.buyLeft > 0 ? 'store.returnToBase' : 'store.buyOver');
  }

  private render(force = false) {
    const l = this.last;
    if (!l) return;
    const { me, canBuy, buyLeft, free } = l;
    this.renderClock();
    const owned = this.ownedGuns(me);
    // Attachments follow the gun in hand (a purchase swaps it) until you pick another one.
    const hand = me.weapon === 2 ? undefined : me.weapons[me.weapon];
    if (hand && this.hand !== undefined && hand !== this.hand && !this.manualPick) this.pick = hand;
    this.hand = hand;
    if (!this.pick || !owned.includes(this.pick)) this.pick = hand ?? me.weapons[0];
    const sig = [this.tab, this.selectedKey(), this.pick, this.slot, me.money, me.owned.join(), me.weapons.join(), JSON.stringify(me.attachments), me.grenades, me.grenadeHE, canBuy, free, buyLeft > 0].join('|');
    if (!force && sig === this.signature) return;
    this.signature = sig;
    this.el.tabs.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === this.tab));
    this.el.cash.textContent = free ? t('store.free') : money(me.money);
    this.el.cash.classList.toggle('free', free);
    const cost = (price: number) => free ? 0 : price;
    const shortBy = (price: number) => free ? 0 : Math.max(0, price - me.money);

    // ---- Entries for the tab ----
    const entries: Entry[] = [];
    if (this.tab === 'primary' || this.tab === 'secondary') {
      for (const id of this.tab === 'primary' ? PRIMARY : SECONDARY) {
        const w = WEAPONS[id], slot = w.slot as 0 | 1;
        const state = me.weapons[slot] === id ? 'equipped' : me.owned.includes(id) ? 'owned' : '';
        const price = state ? 0 : cost(w.price), short = shortBy(price);
        entries.push({
          key: id, name: w.name, sub: CLASS(w.class), price, state, item: id,
          disabled: state === 'equipped' || !canBuy || short > 0,
          reason: state === 'equipped' ? undefined : !canBuy ? this.closedReason() : short ? t('store.need', { money: money(short) }) : undefined,
          short: state !== 'equipped' && canBuy && short > 0,
        });
      }
    } else if (this.tab === 'tactical') {
      const full = me.grenades >= GRENADE.max, gShort = shortBy(GRENADE.price), heShort = shortBy(HIGH_EXPLOSIVE.price);
      entries.push({ key: 'grenade', name: 'M67', sub: t('store.frag'), price: cost(GRENADE.price), state: full ? 'carried' : '', item: 'grenade', disabled: full || gShort > 0, reason: full ? t('store.oneM67') : gShort ? t('store.need', { money: money(gShort) }) : undefined, short: !full && gShort > 0 });
      entries.push({ key: 'highExplosive', name: t('store.he'), sub: t('store.heUpgrade'), price: cost(HIGH_EXPLOSIVE.price), state: me.grenadeHE ? 'fitted' : '', item: 'highExplosive', disabled: me.grenadeHE || heShort > 0, reason: !me.grenadeHE && heShort ? t('store.need', { money: money(heShort) }) : undefined, short: !me.grenadeHE && heShort > 0 });
    } else {
      const wid = this.pick!, fitted = me.attachments[wid] ?? {};
      if (!this.slots(wid).includes(this.slot)) this.slot = 'optic';
      // Every slot's options in one list (slot order), so the whole gun is browsable at a glance.
      for (const id of this.slots(wid).flatMap(c => ATTACHMENT_IDS.filter(x => ATTACHMENTS[x].category === c))) {
        const a = ATTACHMENTS[id];
        if (!fitsWeapon(a, wid)) continue;
        const on = isFitted(fitted, id), price = id === 'irons' ? 0 : cost(attachmentPrice(a, wid)), short = shortBy(price);
        const summary = changes(wid, fitted, id).list.slice(0, 2).map(x => t('stat.summary', { text: x.text, name: x.name, lower: x.name.toLowerCase() })).join(' · ');
        entries.push({
          key: id, name: attName(id), sub: on ? t(id === 'irons' ? 'store.freeDefault' : 'store.onYourGun') : id === 'irons' ? t('store.freeDefault') : summary, price,
          state: on ? (id === 'irons' ? 'default' : 'fitted') : '', weapon: wid, attachment: id,
          disabled: on || short > 0, reason: !on && short ? t('store.need', { money: money(short) }) : undefined, short: !on && short > 0,
        });
      }
    }
    this.entries = entries;
    // Default selection: the fitted/equipped item, so the preview starts on what you have.
    const sel0 = this.selectedKey();
    if (!entries.some(e => e.key === sel0)) {
      const pick = (entries.find(e => e.state === 'equipped' || e.state === 'fitted' || e.state === 'default') ?? entries.find(e => !e.state) ?? entries[0])?.key;
      if (this.tab === 'attachments') this.slotPick[this.slot] = pick as AttachmentId; else this.selected[this.tab] = pick;
    }
    const sel = entries.find(e => e.key === this.selectedKey());

    this.el.loadout.innerHTML = this.loadoutHtml(me);
    this.el.side.innerHTML = this.tab === 'attachments' ? this.slotsHtml(me, sel) : this.cardsHtml(entries, sel);
    this.el.info.innerHTML = sel ? this.infoHtml(sel, me) : '';
    this.el.keys.innerHTML = (this.tab === 'attachments'
      ? [`<kbd>↑</kbd><kbd>↓</kbd> ${t('store.k.browse')}`, `<kbd>1</kbd>–<kbd>9</kbd> ${t('store.k.option')}`, `<kbd>←</kbd><kbd>→</kbd> ${t('store.k.weapon')}`, `<kbd>Enter</kbd> ${t('store.k.fit')}`]
      : [`<kbd>1</kbd>–<kbd>9</kbd> ${t('store.k.select')}`, `<kbd>←</kbd><kbd>→</kbd> ${t('store.k.browse')}`, `<kbd>Enter</kbd> / ${t('store.k.buy')}`])
      .concat([`<kbd>Q</kbd><kbd>E</kbd> ${t('store.k.tabs')}`, `<kbd>B</kbd> / <kbd>Esc</kbd> ${t('store.k.close')}`]).map(s => `<span>${s}</span>`).join('');
    this.showPreview();
  }

  private renderClock() {
    const { canBuy, buyLeft, free } = this.last!;
    let cls = 'open', label: string, time = '', frac = 0;
    const secs = () => t('common.seconds', { n: Math.ceil(buyLeft) });
    if (free) { label = t('store.c.free'); time = t('store.c.practice'); cls = 'free'; }
    else if (canBuy && buyLeft > 0) { label = t('store.c.buy'); time = secs(); frac = buyLeft / this.buyTotal; if (buyLeft <= 5) cls = 'open low'; }
    else if (canBuy) { label = t('store.c.weapons'); time = t('store.c.onSale'); }
    else if (buyLeft > 0) { label = t('store.c.outside'); time = secs(); frac = buyLeft / this.buyTotal; cls = 'away'; }
    else { label = t('store.c.closed'); time = t('store.c.gear'); cls = 'closed'; }
    this.el.clock.className = `clock ${cls}`;
    this.el.clock.innerHTML = `<small>${label}</small><b>${time}</b><i><u style="width:${(clamp01(frac) * 100).toFixed(1)}%"></u></i>`;
  }

  /** What you carry: Primary · Secondary · Knife · Tactical, in key order 3 · 2 · 1 · 4. */
  private loadoutHtml(me: Soldier) {
    const gun = (slot: 0 | 1) => {
      const id = me.weapons[slot], mods = fittedNames(me.attachments[id]);
      const active = (this.tab === (slot ? 'secondary' : 'primary')) || (this.tab === 'attachments' && this.pick === id);
      return `<button type="button" class="lo${active ? ' on' : ''}" data-lo="${slot}"><kbd>${slot ? 2 : 3}</kbd><small>${t(slot ? 'store.lo.secondary' : 'store.lo.primary')}</small><b>${WEAPONS[id].name}</b><span class="mods">${mods.length ? mods.join(' · ') : t('store.noAttachments')}</span></button>`;
    };
    const he = me.grenadeHE ? ` · ${t('store.he')}` : '';
    return gun(0) + gun(1)
      + `<button type="button" class="lo knife" data-lo="knife" tabindex="-1"><kbd>1</kbd><small>${t('store.lo.melee')}</small><b>${t('store.knife')}</b><span class="mods">${t('store.alwaysCarried')}</span></button>`
      + `<button type="button" class="lo${this.tab === 'tactical' ? ' on' : ''}${me.grenades ? '' : ' none'}" data-lo="tactical"><kbd>4</kbd><small>${t('store.lo.tactical')}</small><b>${me.grenades ? 'M67' : t('store.empty')}</b><span class="mods">${me.grenades ? `${t('store.frag')}${he}` : me.grenadeHE ? t('store.heReady') : t('store.noGrenade')}</span></button>`;
  }

  private badge(e: Entry) {
    const [cls, text] = e.state === 'equipped' ? ['eq', t('badge.equipped')] : e.state === 'owned' ? ['own', t('badge.owned')] : e.state === 'fitted' ? ['eq', t('badge.fitted')]
      : e.state === 'default' ? ['eq', t('badge.inUse')] : e.state === 'carried' ? ['eq', t('badge.carrying')] : [e.short ? 'short' : 'price', e.price ? money(e.price) : t('common.free')];
    return `<em class="badge ${cls}">${text}</em>`;
  }

  private cardsHtml(entries: Entry[], sel?: Entry) {
    return `<div class="cards">${entries.map((e, i) => `<button type="button" data-key="${e.key}" class="card${e === sel ? ' sel' : ''}${e.state ? ` ${e.state}` : ''}${e.disabled && !e.state ? ' locked' : ''}"><kbd>${i < 10 ? (i + 1) % 10 : ''}</kbd><span><b>${e.name}</b><small>${e.sub}</small></span>${this.badge(e)}</button>`).join('')}</div>`
      + `<p class="aside">${t(this.tab === 'tactical' ? 'store.asideTactical' : 'store.asideWeapons')}</p>`;
  }

  /** Attachments: weapon picker, then the gun's slots; the open slot lists its options. */
  private slotsHtml(me: Soldier, sel?: Entry) {
    const wid = this.pick!, fitted = me.attachments[wid] ?? {}, owned = this.ownedGuns(me);
    let html = `<div class="picker"><button type="button" class="step" data-step="-1" aria-label="${t('store.prevWeapon')}">‹</button><div>${owned.map(id => {
      const n = fittedNames(me.attachments[id]).length;
      const held = me.weapons.includes(id) ? '' : ' spare';
      return `<button type="button" data-pick="${id}" class="${id === wid ? 'on' : ''}${held}">${WEAPONS[id].name}${n ? `<small>${n}</small>` : ''}</button>`;
    }).join('')}</div><button type="button" class="step" data-step="1" aria-label="${t('store.nextWeapon')}">›</button></div><div class="mounts">`;
    for (const c of this.slots(wid)) {
      const on = fitted[c], open = c === this.slot;
      const name = on && on !== 'irons' ? attName(on) : SLOT(c).empty;
      const opts = this.entries.map((e, i) => ({ e, i })).filter(({ e }) => e.attachment && ATTACHMENTS[e.attachment].category === c);
      html += `<div class="slot open${open ? ' current' : ''}${on && on !== 'irons' ? ' filled' : ''}"><button type="button" class="slot-head" data-slot="${c}"><small>${SLOT(c).name}</small><b>${name}${c === 'optic' && !on ? ` <i>${t('store.default')}</i>` : ''}</b><span class="chev"></span></button>`;
      html += `<div class="opts">${opts.map(({ e, i }) => `<button type="button" data-key="${e.key}" class="opt${e === sel ? ' sel' : ''}${e.state ? ` ${e.state}` : ''}${e.disabled && !e.state ? ' locked' : ''}"><kbd>${i < 10 ? (i + 1) % 10 : ''}</kbd><span><b>${e.name}</b><small>${e.sub}</small></span>${this.badge(e)}</button>`).join('')}</div>`;
      html += '</div>';
    }
    return html + '</div>';
  }

  private bars(w: WeaponDef, ref?: WeaponDef, only?: Key[]) {
    return `<div class="bars">${BARS.filter(b => !only || only.includes(b.name)).map(b => {
      const d = ref && ref !== w ? b.num(w) - b.num(ref) : 0, good = (d > 0) !== !!b.less;
      const delta = Math.abs(d) > 0.05 ? `<em class="${good ? 'up' : 'down'}">${signed(d, b.unit)}</em>` : '<em></em>';
      return `<div class="bar${b.less ? ' less' : ''}"><span>${t(b.name)}</span><div class="track"><i style="width:${(b.fill(w) * 100).toFixed(1)}%"></i>${ref && ref !== w ? `<u style="left:${(b.fill(ref) * 100).toFixed(1)}%"></u>` : ''}</div><b>${b.label(w)}</b>${delta}</div>`;
    }).join('')}</div>`;
  }

  /** The primary action with its price and, when it can't be done, why. */
  private action(e: Entry, extra = '') {
    const label = e.state === 'equipped' ? t('badge.equipped') : e.state === 'fitted' ? t('badge.fitted') : e.state === 'default' ? t('badge.inUse') : e.state === 'carried' ? t('badge.carrying')
      : e.state === 'owned' ? t('store.equipFree') : e.key === 'irons' ? t('store.useIrons')
      : e.price ? t('store.buy', { price: money(e.price) }) : t('store.buyFree');
    const done = !!e.state && e.state !== 'owned';
    const l = this.last!, after = !done && !l.free && e.price > 0 && e.price <= l.me.money ? `<p class="after">${t('store.leaves', { money: money(l.me.money - e.price) })}</p>` : '';
    return `<div class="act${done ? ' done' : ''}"><small>${t(done ? 'store.haveIt' : e.state === 'owned' ? 'store.ownedSwap' : 'store.price')}</small><strong>${done ? '✓' : e.state === 'owned' ? t('common.free') : e.price ? money(e.price) : t('common.free')}</strong>${after}`
      + `<button type="button" class="buy" data-buy ${e.disabled ? 'disabled' : ''}>${label}${e.disabled ? '' : ' <kbd>Enter</kbd>'}</button>`
      + `${e.reason ? `<p class="why">${e.reason}</p>` : ''}${extra}</div>`;
  }

  private infoHtml(e: Entry, me: Soldier) {
    if (e.item === 'grenade' || e.item === 'highExplosive') {
      const he = e.item === 'highExplosive', withHE = he || me.grenadeHE;
      const rows: [string, string, string][] = he
        ? [[t('bar.damage'), `${GRENADE.damage} → ${GRENADE.damage + HIGH_EXPLOSIVE.damage}`, 'up'], [t('store.blast'), `${GRENADE.radius} → ${GRENADE.radius + HIGH_EXPLOSIVE.radius} m`, 'down'], [t('store.appliesTo'), t('store.everyM67'), '']]
        : [[t('bar.damage'), `${GRENADE.damage + (withHE ? HIGH_EXPLOSIVE.damage : 0)}${withHE ? ' (HE)' : ''}`, ''], [t('store.blast'), `${GRENADE.radius + (withHE ? HIGH_EXPLOSIVE.radius : 0)} m`, ''], [t('store.fuse'), t('common.seconds', { n: GRENADE.fuse }), ''], [t('store.carry'), t('store.carryN', { n: GRENADE.max }), '']];
      const blurb = t(he ? 'store.heNote' : 'store.m67Note');
      return `<div class="stats"><p class="note">${blurb}</p><ul class="deltas">${rows.map(([k, v, c]) => `<li class="${c}"><span>${k}</span><b>${v}</b></li>`).join('')}</ul></div>${this.action(e)}`;
    }
    if (e.attachment && e.weapon) {
      const fitted: Attachments = me.attachments[e.weapon] ?? {};
      const a = ATTACHMENTS[e.attachment];
      const { base, next, list } = changes(e.weapon, fitted, e.attachment);
      const current = fitted[a.category];
      const replaces = current && current !== e.attachment ? `<p class="swap">${t('store.replaces', { name: attName(current) })}</p>` : '';
      const rows = list.map(c => `<li class="${c.up ? 'up' : 'down'}"><span>${c.name}</span><b>${c.text}</b></li>`).join('');
      return `<div class="stats"><p class="note">${note(e.attachment)}</p><div class="split"><ul class="deltas">${rows || `<li><span>${t(e.state ? 'store.onYourGun' : 'store.noChange')}</span></li>`}</ul>${this.bars(next, base, ['bar.damage', 'bar.accuracy', 'bar.aimAcc', 'bar.recoil', 'bar.mobility'])}</div></div>${this.action(e, replaces)}`;
    }
    const id = e.item as WeaponId, w = weaponStats(id, me.attachments[id]), slot = w.slot as 0 | 1;
    const equippedId = me.weapons[slot], current = weaponStats(equippedId, me.attachments[equippedId]);
    const compare = equippedId === id ? t('store.yourWeapon') : `${t('store.compared', { name: current.name })} <u></u>`;
    const facts = `<dl><dt>${t('store.f.magazine')}</dt><dd>${w.magazine} / ${w.reserve}</dd><dt>${t('store.f.reload')}</dt><dd>${t('common.seconds', { n: w.reload })}</dd><dt>${t('store.f.fire')}</dt><dd>${t(w.auto ? 'store.f.auto' : 'store.f.semi')}</dd><dt>${t('store.f.zoom')}</dt><dd>${round1(magnify(w))}×</dd><dt>${t('store.f.velocity')}</dt><dd>${w.velocity} m/s</dd></dl>`;
    const customize = me.owned.includes(id) ? `<button type="button" class="link" data-customize="${id}">${t('store.customize')}</button>` : '';
    return `<div class="stats"><p class="cmp">${compare}</p>${this.bars(w, current)}${facts}</div>${this.action(e, customize)}`;
  }

  /** Name over the preview: the hovered item, else the selected one. */
  private titleHtml(e: Entry, me: Soldier) {
    if (e.item === 'grenade' || e.item === 'highExplosive') {
      const he = e.item === 'highExplosive';
      return `<h3>${he ? t('store.he') : 'M67'}</h3><small>${t(he ? 'store.heTitle' : 'store.m67Title')}</small>`;
    }
    if (e.attachment && e.weapon) return `<h3>${attName(e.attachment)}</h3><small>${t('store.slotOn', { slot: SLOT(ATTACHMENTS[e.attachment].category).name, weapon: WEAPONS[e.weapon].name })}</small>`;
    const w = WEAPONS[e.item as WeaponId], mods = fittedNames(me.attachments[w.id]);
    return `<h3>${w.name}</h3><small>${CLASS(w.class)} · ${t(w.slot === 0 ? 'store.primaryKey' : 'store.secondaryKey')}${mods.length ? ` · ${mods.join(' · ')}` : ''}</small>`;
  }

  /** Point the 3D preview (and its title) at the hovered or selected item, wearing what it would have. */
  private showPreview() {
    const me = this.last?.me;
    if (!me || !this.open) return;
    const key = this.hover ?? this.selectedKey();
    const entry = this.entries.find(e => e.key === key);
    this.el.title.innerHTML = entry ? this.titleHtml(entry, me) : '';
    let item: PreviewItem | undefined;
    if (this.tab === 'tactical') item = { kind: 'grenade', he: key === 'highExplosive' || me.grenadeHE };
    else if (this.tab === 'attachments') {
      const wid = this.pick!, fitted = me.attachments[wid] ?? {};
      const id = key as AttachmentId | undefined;
      const att = id && ATTACHMENTS[id] ? withAttachment(fitted, id) : fitted;
      item = { kind: 'weapon', id: wid, attachments: att, focus: this.slot, label: `${SLOT(this.slot).name}${id && ATTACHMENTS[id] ? ` · ${attName(id)}` : ''}` };
    } else if (key && key in WEAPONS) item = { kind: 'weapon', id: key as WeaponId, attachments: me.attachments[key as WeaponId] ?? {} };
    if (item) this.preview.show(item);
  }
}
