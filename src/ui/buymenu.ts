import type { BuyItem } from '../../shared/match/economy';
import type { Soldier } from '../../shared/match/state';
import {
  ATTACHMENTS, ATTACHMENT_IDS, GRENADE, HIGH_EXPLOSIVE, WEAPONS, attachmentPrice, fitsWeapon, weaponStats,
  type AttachmentCategory, type AttachmentId, type Attachments, type WeaponClass, type WeaponDef, type WeaponId,
} from '../../shared/weapons';

type Tab = 'primary' | 'secondary' | 'tactical' | 'attachments';
const TABS: { id: Tab; title: string }[] = [
  { id: 'primary', title: 'Primary' }, { id: 'secondary', title: 'Secondary' }, { id: 'tactical', title: 'Tactical' }, { id: 'attachments', title: 'Attachments' },
];
const PRIMARY: WeaponId[] = ['mp5', 'm4a1', 'm1014', 'm110', 'm249'];
const SECONDARY: WeaponId[] = ['m9a1', 'mp7'];
const CATEGORIES: { id: AttachmentCategory; title: string }[] = [
  { id: 'optic', title: 'Optics' }, { id: 'tactical', title: 'Tactical' }, { id: 'mod', title: 'Mods' }, { id: 'ammo', title: 'Ammo' },
];
const CLASS: Record<WeaponClass, string> = { melee: 'Melee', pistol: 'Pistol', smg: 'Submachine gun', rifle: 'Assault rifle', shotgun: 'Shotgun', sniper: 'Sniper rifle', lmg: 'Light machine gun' };
const NOTES: Partial<Record<AttachmentId, string>> = {
  irons: 'Standard sights.', ammoCounter: 'Shows the rounds left on the gun.', laser: 'Visible beam — others can see it.',
  flashlight: 'Lights a cone ahead of you.', suppressor: 'Hides your tracer and muzzle flash and keeps you off enemy minimaps.',
  explosiveAmmo: 'Hard-hitting rounds, smaller magazine.', incendiaryAmmo: 'Burning rounds, smaller magazine.',
};
const NO_WEAPONS = 'Weapons are sold in your base during buy time';

// BeGone's stats recovered from the derived WeaponDef (see `derive` in shared/weapons.ts).
const acc = (w: WeaponDef) => 100 - w.spread.hip / 0.35;
const zoomAcc = (w: WeaponDef) => 100 - w.spread.ads / 0.25;
const kick = (w: WeaponDef) => w.recoil.pitch / 0.45;
const zoomKick = (w: WeaponDef) => w.recoil.adsPitch / 0.45;
const magnify = (w: WeaponDef) => 1 / w.zoom;
const money = (n: number) => `$${n.toLocaleString('en-US')}`;
const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Stat bars: value of a weapon on a 0..1 scale and its label. */
const BARS: { name: string; value: (w: WeaponDef) => number; label: (w: WeaponDef) => string }[] = [
  { name: 'Damage', value: w => clamp01(w.damage.body * w.pellets / 90), label: w => w.pellets > 1 ? `${w.damage.body}×${w.pellets}` : `${w.damage.body} / ${w.damage.head} hs` },
  { name: 'Fire rate', value: w => clamp01(1 / w.interval / 13), label: w => `${round1(1 / w.interval)}/s` },
  { name: 'Accuracy', value: w => clamp01(acc(w) / 100), label: w => `${round1(acc(w))}` },
  { name: 'Range', value: w => clamp01(w.range / 300), label: w => `${w.range} m` },
  { name: 'Mobility', value: w => clamp01((w.speed * 100 - 80) / 30), label: w => `${Math.round(w.speed * 100)}%` },
];

/** Stat changes from fitting `id` to `wid` instead of what's fitted in that category. */
function changes(wid: WeaponId, fitted: Attachments, id: AttachmentId) {
  const base = weaponStats(wid, fitted), next = weaponStats(wid, { ...fitted, [ATTACHMENTS[id].category]: id });
  const list = ([
    ['Head damage', 'head', next.damage.head - base.damage.head, 1], ['Body damage', 'dmg', next.damage.body - base.damage.body, 1], ['Limb damage', 'limb', next.damage.limb - base.damage.limb, 1],
    ['Magazine', 'mag', next.magazine - base.magazine, 1], ['Accuracy', 'acc', acc(next) - acc(base), 1], ['Zoom accuracy', 'zoom acc', zoomAcc(next) - zoomAcc(base), 1],
    ['Recoil', 'recoil', kick(next) - kick(base), -1], ['Zoom recoil', 'zoom recoil', zoomKick(next) - zoomKick(base), -1], ['Move speed', 'move', (next.speed - base.speed) * 100, 1],
  ] as [string, string, number, number][]).filter(([, , d]) => Math.abs(d) > 0.01)
    .map(([name, short, d, good]) => ({ name, short, up: d * good > 0, text: `${d > 0 ? '+' : ''}${round1(d)}${short === 'move' ? '%' : ''}` }));
  const zoom = magnify(next) - magnify(base);
  if (Math.abs(zoom) > 0.01) list.unshift({ name: 'Zoom', short: 'zoom', up: zoom > 0, text: `${round1(magnify(base))}× → ${round1(magnify(next))}×` });
  return { base, next, list };
}

interface Entry {
  key: string; name: string; sub: string; price: number;
  /** '' for sale, or the owned state shown instead of the price. */
  state: '' | 'equipped' | 'owned' | 'fitted' | 'carried';
  disabled: boolean; reason?: string; group?: string;
  item?: BuyItem; weapon?: WeaponId; attachment?: AttachmentId;
}

/**
 * BeGone's store (B): Primary / Secondary / Tactical / Attachments. Weapons sell in your base during
 * buy time and stay yours for the match (owned ones swap in free); attachments fit owned weapons
 * anywhere, any time. The host validates every purchase.
 */
export class BuyMenu {
  readonly root: HTMLElement;
  onClose?: () => void;
  private tab: Tab = 'primary';
  private selected: Partial<Record<Tab, string>> = {};
  private pick?: WeaponId;
  private entries: Entry[] = [];
  private last?: { me: Soldier; canBuy: boolean; buyLeft: number; free: boolean };
  private signature = '';
  private el: Record<'tabs' | 'status' | 'money' | 'list' | 'detail', HTMLElement>;

  constructor(parent: HTMLElement, private actions: { buy(item: BuyItem): void; attach(weapon: WeaponId, attachment: AttachmentId): void }) {
    this.root = document.createElement('div');
    this.root.id = 'buymenu';
    this.root.hidden = true;
    this.root.innerHTML = `
      <header><h2>Store</h2><nav class="tabs"></nav><span class="status"></span><span class="money"></span></header>
      <div class="store-body"><div class="list"></div><aside class="detail"></aside></div>
      <footer><span><kbd>1</kbd>–<kbd>9</kbd> select</span><span><kbd>Enter</kbd> buy</span><span><kbd>Q</kbd> <kbd>E</kbd> tabs</span><span><kbd>←</kbd> <kbd>→</kbd> weapon</span><span><kbd>B</kbd> / <kbd>Esc</kbd> close</span></footer>`;
    parent.appendChild(this.root);
    const q = (s: string) => this.root.querySelector<HTMLElement>(s)!;
    this.el = { tabs: q('.tabs'), status: q('.status'), money: q('.money'), list: q('.list'), detail: q('.detail') };
    this.el.tabs.innerHTML = TABS.map(t => `<button type="button" data-tab="${t.id}">${t.title}</button>`).join('');
    this.root.addEventListener('click', e => {
      const t = e.target as HTMLElement;
      const tab = t.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      if (tab) return this.setTab(tab);
      const pick = t.closest<HTMLElement>('[data-pick]')?.dataset.pick as WeaponId | undefined;
      if (pick) { this.pick = pick; return this.render(true); }
      if (t.closest('[data-buy]')) return this.purchase();
      const key = t.closest<HTMLElement>('[data-key]')?.dataset.key;
      if (key) { if (this.selected[this.tab] === key) this.purchase(); else this.select(key); }
    });
    // Capture phase: store keys never reach the game while it's open.
    document.addEventListener('keydown', e => {
      if (!this.open || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const c = e.code;
      const digit = /^(Digit|Numpad)(\d)$/.exec(c);
      if (c === 'Escape' || c === 'KeyB') this.close();
      else if (digit) { const i = (Number(digit[2]) + 9) % 10; if (this.entries[i]) this.select(this.entries[i].key); }
      else if (c === 'Enter' || c === 'NumpadEnter' || c === 'Space') this.purchase();
      else if (c === 'KeyQ' || c === 'KeyE') this.setTab(TABS[(TABS.findIndex(t => t.id === this.tab) + (c === 'KeyE' ? 1 : 3)) % 4].id);
      else if (c === 'ArrowUp' || c === 'ArrowDown') {
        const i = this.entries.findIndex(x => x.key === this.selected[this.tab]);
        const next = this.entries[Math.max(0, Math.min(this.entries.length - 1, i + (c === 'ArrowDown' ? 1 : -1)))];
        if (next) this.select(next.key);
      } else if ((c === 'ArrowLeft' || c === 'ArrowRight') && this.tab === 'attachments' && this.last) {
        const owned = this.ownedGuns(this.last.me), i = owned.indexOf(this.pick!);
        this.pick = owned[(i + (c === 'ArrowRight' ? 1 : owned.length - 1)) % owned.length];
        this.render(true);
      } else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
  }

  get open() { return !this.root.hidden; }

  show() { this.root.hidden = false; document.exitPointerLock?.(); this.render(true); }
  close() { if (!this.open) return; this.root.hidden = true; this.onClose?.(); }

  /** Refresh cash, buy window and owned/fitted state (re-renders only when something changed). */
  update(me: Soldier | undefined, canBuyWeapons: boolean, buyLeft: number, free: boolean) {
    if (!me) return;
    this.last = { me, canBuy: canBuyWeapons, buyLeft, free };
    if (this.open) this.render();
  }

  private setTab(tab: Tab) { this.tab = tab; this.render(true); }
  private select(key: string) { this.selected[this.tab] = key; this.render(true); }

  private ownedGuns(me: Soldier) { return [...PRIMARY, ...SECONDARY].filter(id => me.owned.includes(id)); }

  private purchase() {
    const e = this.entries.find(x => x.key === this.selected[this.tab]);
    if (!e || e.disabled) return;
    if (e.item) this.actions.buy(e.item);
    else if (e.weapon && e.attachment) this.actions.attach(e.weapon, e.attachment);
  }

  private render(force = false) {
    const l = this.last;
    if (!l) { this.el.list.innerHTML = ''; return; }
    const { me, canBuy, buyLeft, free } = l;
    const owned = this.ownedGuns(me);
    if (!this.pick || !owned.includes(this.pick)) this.pick = me.weapons[0];
    const sig = [this.tab, this.selected[this.tab], this.pick, me.money, me.owned.join(), me.weapons.join(), JSON.stringify(me.attachments), me.grenades, me.grenadeHE, canBuy, free, Math.ceil(buyLeft)].join('|');
    if (!force && sig === this.signature) return;
    this.signature = sig;
    this.el.tabs.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === this.tab));
    this.el.money.textContent = free ? 'FREE STORE' : money(me.money);
    this.el.status.textContent = free ? 'Practice — everything is free' : canBuy ? (buyLeft >= 0 ? `Buy time ${Math.ceil(buyLeft)}s` : 'Weapons on sale') : 'Buy time over — attachments only';
    this.el.status.classList.toggle('closed', !canBuy);
    const cost = (price: number) => free ? 0 : price;
    const short = (price: number) => !free && price > me.money;
    // ---- Entries for the tab ----
    const entries: Entry[] = [];
    if (this.tab === 'primary' || this.tab === 'secondary') {
      for (const id of this.tab === 'primary' ? PRIMARY : SECONDARY) {
        const w = WEAPONS[id], slot = w.slot as 0 | 1;
        const state = me.weapons[slot] === id ? 'equipped' : me.owned.includes(id) ? 'owned' : '';
        const price = state ? 0 : cost(w.price);
        entries.push({
          key: id, name: w.name, sub: CLASS[w.class], price, state, item: id,
          disabled: state === 'equipped' || !canBuy || short(price),
          reason: state === 'equipped' ? undefined : !canBuy ? NO_WEAPONS : short(price) ? 'Not enough cash' : undefined,
        });
      }
    } else if (this.tab === 'tactical') {
      const full = me.grenades >= GRENADE.max;
      entries.push({ key: 'grenade', name: 'M67', sub: 'Frag grenade', price: cost(GRENADE.price), state: full ? 'carried' : '', item: 'grenade', disabled: full || short(GRENADE.price), reason: full ? 'You carry one M67 at a time' : short(GRENADE.price) ? 'Not enough cash' : undefined });
      entries.push({ key: 'highExplosive', name: 'High Explosive', sub: 'M67 mod', price: cost(HIGH_EXPLOSIVE.price), state: me.grenadeHE ? 'fitted' : '', item: 'highExplosive', disabled: me.grenadeHE || short(HIGH_EXPLOSIVE.price), reason: !me.grenadeHE && short(HIGH_EXPLOSIVE.price) ? 'Not enough cash' : undefined });
    } else {
      const wid = this.pick!, fitted = me.attachments[wid] ?? {};
      for (const c of CATEGORIES) for (const id of ATTACHMENT_IDS) {
        const a = ATTACHMENTS[id];
        if (a.category !== c.id || !fitsWeapon(a, wid)) continue;
        const on = fitted[c.id] === id || (id === 'irons' && !fitted.optic);
        const price = cost(attachmentPrice(a, wid));
        const summary = changes(wid, fitted, id).list.slice(0, 2).map(x => `${x.text} ${x.short}`).join(' · ');
        entries.push({ key: id, name: a.name, sub: on ? '' : summary, group: c.title, price, state: on ? 'fitted' : '', weapon: wid, attachment: id, disabled: on || short(price), reason: !on && short(price) ? 'Not enough cash' : undefined });
      }
    }
    this.entries = entries;
    if (!entries.some(e => e.key === this.selected[this.tab])) this.selected[this.tab] = (entries.find(e => !e.state) ?? entries[0])?.key;
    const sel = entries.find(e => e.key === this.selected[this.tab]);
    // ---- List ----
    const tag = (e: Entry) => e.state === 'equipped' ? 'EQUIPPED' : e.state === 'owned' ? 'OWNED · equip free' : e.state === 'fitted' ? 'FITTED' : e.state === 'carried' ? 'CARRYING' : e.price ? money(e.price) : 'FREE';
    let html = '';
    if (this.tab === 'attachments') {
      html += `<div class="picker">${owned.map(id => {
        const n = Object.values(me.attachments[id] ?? {}).filter(a => a && a !== 'irons').length;
        return `<button type="button" data-pick="${id}" class="${id === this.pick ? 'on' : ''}">${WEAPONS[id].name}${n ? `<small>${n}</small>` : ''}</button>`;
      }).join('')}</div>`;
    }
    let group = '';
    entries.forEach((e, i) => {
      if (e.group && e.group !== group) { group = e.group; html += `<b class="group">${group}</b>`; }
      html += `<button type="button" data-key="${e.key}" class="item${e === sel ? ' sel' : ''}${e.state ? ` ${e.state}` : ''}${e.disabled && !e.state ? ' locked' : ''}"><kbd>${i < 10 ? (i + 1) % 10 : ''}</kbd><span><b>${e.name}</b><small>${e.sub}</small></span><em>${tag(e)}</em></button>`;
    });
    this.el.list.innerHTML = html;
    this.el.detail.innerHTML = sel ? this.detail(sel, me) : '';
  }

  /** Right panel: stat bars (with the current weapon's mark) and, for attachments, the stat changes. */
  private detail(e: Entry, me: Soldier) {
    const action = e.state === 'equipped' ? 'Equipped' : e.state === 'fitted' ? 'Fitted' : e.state === 'carried' ? 'Carrying' : e.state === 'owned' ? 'Equip · free' : `Buy · ${e.price ? money(e.price) : 'free'}`;
    const button = `${e.reason ? `<p class="why">${e.reason}</p>` : ''}<button type="button" class="buy" data-buy ${e.disabled ? 'disabled' : ''}>${action}</button>`;
    const bars = (w: WeaponDef, ref?: WeaponDef) => `<div class="bars">${BARS.map(b => `<div class="bar"><span>${b.name}</span><div class="track"><i style="width:${(b.value(w) * 100).toFixed(1)}%"></i>${ref && ref !== w ? `<u style="left:${(b.value(ref) * 100).toFixed(1)}%"></u>` : ''}</div><b>${b.label(w)}</b></div>`).join('')}</div>`;
    const facts = (w: WeaponDef) => `<dl><dt>Magazine</dt><dd>${w.magazine} + ${w.reserve}</dd><dt>Reload</dt><dd>${w.reload}s</dd><dt>Zoom</dt><dd>${round1(magnify(w))}×</dd><dt>Recoil</dt><dd>${round1(kick(w))}</dd><dt>Fire</dt><dd>${w.auto ? 'Auto' : 'Semi'}</dd></dl>`;
    if (e.item === 'grenade' || e.item === 'highExplosive') {
      const he = e.item === 'highExplosive';
      const rows = he ? [['Damage', `+${HIGH_EXPLOSIVE.damage}`, 'up'], ['Blast radius', `${HIGH_EXPLOSIVE.radius} m`, 'down']]
        : [['Damage', `${GRENADE.damage}${me.grenadeHE ? ` +${HIGH_EXPLOSIVE.damage} HE` : ''}`, ''], ['Blast radius', `${GRENADE.radius + (me.grenadeHE ? HIGH_EXPLOSIVE.radius : 0)} m`, ''], ['Fuse', `${GRENADE.fuse}s`, ''], ['Carry', `${GRENADE.max}`, '']];
      return `<h3>${e.name}</h3><small>${he ? 'M67 modification · lasts the match' : 'Tactical · press 4 to throw · not restocked'}</small><ul class="deltas">${rows.map(([k, v, c]) => `<li class="${c}"><span>${k}</span><b>${v}</b></li>`).join('')}</ul>${button}`;
    }
    if (e.attachment && e.weapon) {
      const fitted: Attachments = me.attachments[e.weapon] ?? {};
      const a = ATTACHMENTS[e.attachment];
      const { base, next, list } = changes(e.weapon, fitted, e.attachment);
      const rows = list.map(c => `<li class="${c.up ? 'up' : 'down'}"><span>${c.name}</span><b>${c.text}</b></li>`).join('');
      const replaces = fitted[a.category] && fitted[a.category] !== e.attachment ? ` · replaces ${ATTACHMENTS[fitted[a.category]!].name}` : '';
      return `<h3>${a.name}</h3><small>${CATEGORIES.find(c => c.id === a.category)!.title} · ${WEAPONS[e.weapon].name}${replaces}</small>${NOTES[e.attachment] ? `<p class="note">${NOTES[e.attachment]}</p>` : ''}<ul class="deltas">${rows || '<li><span>No stat change</span></li>'}</ul>${bars(next, base)}${button}`;
    }
    const id = e.item as WeaponId, w = weaponStats(id, me.attachments[id]);
    const current = weaponStats(me.weapons[w.slot as 0 | 1], me.attachments[me.weapons[w.slot as 0 | 1]]);
    return `<h3>${w.name}</h3><small>${CLASS[w.class]} · ${w.slot === 0 ? 'Primary · key 3' : 'Secondary · key 2'}</small>${bars(w, current)}${facts(w)}${button}`;
  }
}
