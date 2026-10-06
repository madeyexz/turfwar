import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAP_IDS, loadMap } from '../../shared/maps/index';
import { ATTACHMENT_IDS, ATTACHMENTS } from '../../shared/weapons';
import { DICTIONARIES, LANGS, attachmentName, causeName, langFromLocale, mapName, rewardReason, serverError, setLang, t, type Key } from './i18n';

const ROOT = join(__dirname, '../..');
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const hasCjk = (s: string) => /[㐀-鿿]/.test(s);

afterEach(() => setLang('en', false));

describe('i18n dictionaries', () => {
  const en = DICTIONARIES.en, zh = DICTIONARIES['zh-TW'];

  it('translate every key into Traditional Chinese, with the same placeholders', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    // stat.summary: English lower-cases the stat name mid-phrase ({lower}); Chinese has no case ({name}).
    for (const key of Object.keys(en) as Key[]) {
      expect(zh[key], key).toBeTruthy();
      if (key !== 'stat.summary') expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('use Traditional characters, not Simplified ones', () => {
    // Common Simplified-only forms; none may appear in the Taiwan dictionary.
    const simplified = /[这们说时间战弹枪击队设选开关门级点钟购买卖换装备视频软网络连线输赢场让应头动发态]/;
    for (const [key, text] of Object.entries(zh)) expect(simplified.test(text), `${key}: ${text}`).toBe(false);
  });

  it('name every map and attachment in Chinese', () => {
    setLang('zh-TW', false);
    for (const id of MAP_IDS) expect(hasCjk(mapName(id, loadMap(id).def.name)), id).toBe(true);
    expect(mapName('taipei', 'Taipei')).toBe('西門町');
    expect(mapName('xinyi', 'Taipei 101 · Xinyi')).toBe('台北101・信義');
    for (const id of ATTACHMENT_IDS) expect(attachmentName(id, ATTACHMENTS[id].name), id).not.toBe(ATTACHMENTS[id].name);
    setLang('en', false);
    expect(mapName('taipei', 'Taipei')).toBe('Taipei');
  });

  it('fill placeholders and keep English as English', () => {
    expect(t('hud.round', { n: 3 })).toBe('ROUND 3');
    setLang('zh-TW', false);
    expect(t('hud.round', { n: 3 })).toBe('第 3 回合');
    expect(t('mode.elimination')).toBe('殲滅戰');
    expect(t('mode.sabotage')).toBe('爆破戰');
    expect(causeName('fall')).toBe('墜落');
    expect(causeName('m4a1', 'M4A1')).toBe('M4A1');
  });
});

describe('server text (English on the wire, translated on the client)', () => {
  const shared = (dir: string) => readdirSync(join(ROOT, dir)).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts')).map(f => readFileSync(join(ROOT, dir, f), 'utf8')).join('\n');

  it('translates every cash award reason the match sends', () => {
    const src = shared('shared/match');
    const reasons = [...src.matchAll(/award\([^;]*?, '([^']+)', ctx\.emit\)/g)].map(m => m[1]);
    expect(reasons.length).toBeGreaterThan(10);
    setLang('zh-TW', false);
    for (const r of reasons) expect(hasCjk(rewardReason(r)), r).toBe(true);
    expect(rewardReason('3× multi-kill')).toBe('3 連殺');
    expect(rewardReason('10 kill streak')).toBe('連續擊殺 10');
  });

  it('knows only room errors the module really sends, and translates them', () => {
    const module = readFileSync(join(ROOT, 'spacetimedb/src/index.ts'), 'utf8');
    const sent = new Set([...module.matchAll(/new SenderError\('([^']+)'\)/g)].map(m => m[1]));
    const known = (Object.keys(DICTIONARIES.en) as Key[]).filter(k => k.startsWith('err.')).map(k => k.slice(4));
    for (const k of known) expect(sent.has(k), k).toBe(true);
    setLang('zh-TW', false);
    expect(serverError('That room is full')).toBe('該房間已滿');
    expect(serverError('Something new')).toBe('Something new');
  });
});

describe('language choice', () => {
  it('reads Traditional Chinese locales as zh-TW and everything else as English', () => {
    for (const l of ['zh-TW', 'zh-HK', 'zh-Hant', 'zh-Hant-TW', 'zh-MO']) expect(langFromLocale(l), l).toBe('zh-TW');
    for (const l of ['en-US', 'zh-CN', 'zh-Hans', 'ja-JP', '', undefined]) expect(langFromLocale(l), String(l)).toBe('en');
    expect(LANGS.map(l => l.label)).toEqual(['English', '繁體中文']);
  });
});
