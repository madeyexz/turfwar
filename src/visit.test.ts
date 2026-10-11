import { describe, expect, it } from 'vitest';
import { clickIds, dropClickIds, hadStorage, stripClickIdParams, parseUtm, referrerHost, visitProps, type Landing, type Store } from './visit';

const memory = (init: Record<string, string> = {}): Store & { data: Map<string, string> } => {
  const data = new Map(Object.entries(init));
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); }, get length() { return data.size; } };
};
const broken: Store = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); }, length: 0 };
const HOST = 'turfwar.ianhsiao.me';
const landing = (search = '', referrer = ''): Landing => ({ search, referrer, host: HOST });
const NOW = new Date('2026-10-11T08:00:00Z');

describe('UTM and referrer parsing', () => {
  it('reads the five UTM tags, trimmed and lower-cased, and ignores the rest', () => {
    expect(parseUtm('?utm_source=Threads&utm_medium=%20post%20&utm_campaign=Launch-1&room=ABCD&utm_term=')).toEqual({ utm_source: 'threads', utm_medium: 'post', utm_campaign: 'launch-1' });
    expect(parseUtm('')).toEqual({});
  });

  it('keeps tags harmless and short', () => {
    expect(parseUtm('?utm_source=a<b>c d').utm_source).toBe('a-b-c-d');
    expect(parseUtm(`?utm_content=${'x'.repeat(200)}`).utm_content).toHaveLength(64);
  });

  it('notes ad click ids as present only', () => {
    expect(clickIds('?gclid=abc123&x=1')).toEqual({ gclid: true });
    expect(clickIds('?fbclid=IwAR&gclid=z')).toEqual({ gclid: true, fbclid: true });
    expect(clickIds('?utm_source=x')).toEqual({});
  });

  it('keeps only the referrer host, and none for ourselves or junk', () => {
    expect(referrerHost('https://www.threads.net/@someone/post/abc?x=1', HOST)).toBe('threads.net');
    expect(referrerHost('android-app://com.instagram.android/', HOST)).toBe('com.instagram.android');
    expect(referrerHost(`https://${HOST}/privacy`, HOST)).toBeUndefined();
    expect(referrerHost('', HOST)).toBeUndefined();
    expect(referrerHost('not a url', HOST)).toBeUndefined();
  });
});

describe('click ids are not sent', () => {
  it('strips them from URLs and keeps every other parameter', () => {
    expect(stripClickIdParams('https://turfwar.ianhsiao.me/?fbclid=IwAR1&utm_source=threads')).toBe('https://turfwar.ianhsiao.me/?utm_source=threads');
    expect(stripClickIdParams('https://x.me/?a=1&gclid=abc&b=2')).toBe('https://x.me/?a=1&b=2');
    expect(stripClickIdParams('https://x.me/?a=1&fbclid=abc#top')).toBe('https://x.me/?a=1#top');
    expect(stripClickIdParams('https://x.me/?fbclid=abc')).toBe('https://x.me/');
    expect(stripClickIdParams('https://x.me/?room=ABCD')).toBe('https://x.me/?room=ABCD');
  });

  it('drops the properties posthog-js adds for them, and the ids inside URLs', () => {
    const props = { fbclid: 'zzz', gclid: null, $initial_fbclid: 'zzz', $initial__kx: null, $fbc: 'fb.1.1.zzz', utm_source: 'threads', $current_url: 'https://x.me/?fbclid=zzz&utm_source=threads', n: 3 };
    expect(dropClickIds(props)).toEqual({ utm_source: 'threads', $current_url: 'https://x.me/?utm_source=threads', n: 3, $initial__kx: null });
    expect(dropClickIds(undefined)).toBeUndefined();
  });
});

describe('visit properties', () => {
  it('counts visits across tab sessions, and a reload is the same visit', () => {
    const local = memory();
    const first = visitProps({ local, session: memory(), landing: landing(), prior: false, now: NOW });
    expect(first).toMatchObject({ visit_n: 1, has_prior_storage: false, storage_ok: true });
    const tab = memory();
    expect(visitProps({ local, session: tab, landing: landing(), prior: true, now: NOW })).toMatchObject({ visit_n: 2, has_prior_storage: true });
    // Reload in the same tab: still visit 2, and it still remembers what the first load of the visit saw.
    expect(visitProps({ local, session: tab, landing: landing(), prior: true, now: NOW })).toMatchObject({ visit_n: 2, has_prior_storage: true });
    const fresh = memory(), tab2 = memory();
    visitProps({ local: fresh, session: tab2, landing: landing(), prior: false, now: NOW });
    expect(visitProps({ local: fresh, session: tab2, landing: landing(), prior: true, now: NOW })).toMatchObject({ visit_n: 1, has_prior_storage: false });
  });

  it('survives storage that is missing or refuses writes', () => {
    expect(visitProps({ local: broken, session: broken, landing: landing('?utm_source=threads'), prior: false, now: NOW }))
      .toMatchObject({ visit_n: 1, has_prior_storage: false, storage_ok: false, visit_utm_source: 'threads' });
    expect(visitProps({ landing: landing(), prior: false, now: NOW })).toMatchObject({ visit_n: 1, storage_ok: false });
    expect(hadStorage(broken)).toBe(false);
    expect(hadStorage(undefined)).toBe(false);
    expect(hadStorage(memory({ a: '1' }))).toBe(true);
    expect(hadStorage(memory())).toBe(false);
  });

  it('recovers from a corrupt counter', () => {
    expect(visitProps({ local: memory({ 'lawbreaker.visits': 'banana' }), session: memory(), landing: landing(), prior: true, now: NOW }).visit_n).toBe(1);
  });

  it('keeps the first informative touch, and sends this visit’s own beside it', () => {
    const local = memory();
    // A direct first visit says nothing about the channel and does not use the slot up.
    expect(visitProps({ local, session: memory(), landing: landing(), prior: false, now: NOW })).not.toHaveProperty('first_touch_at');
    const second = visitProps({ local, session: memory(), landing: landing('?utm_source=Threads&utm_medium=post&utm_campaign=launch&fbclid=SECRET', 'https://l.threads.net/'), prior: true, now: NOW });
    expect(second).toMatchObject({ first_utm_source: 'threads', first_utm_medium: 'post', first_utm_campaign: 'launch', first_referrer: 'l.threads.net', first_fbclid: true, first_touch_at: '2026-10-11', visit_utm_source: 'threads', visit_fbclid: true });
    expect(JSON.stringify(second)).not.toContain('SECRET');
    expect(local.data.get('lawbreaker.firstTouch')).not.toContain('SECRET');
    // A later visit from elsewhere: the first touch stays, the visit's own changes.
    const third = visitProps({ local, session: memory(), landing: landing('?utm_source=bahamut', 'https://forum.gamer.com.tw/x'), prior: true, now: new Date('2026-10-20T00:00:00Z') });
    expect(third).toMatchObject({ first_utm_source: 'threads', first_touch_at: '2026-10-11', visit_utm_source: 'bahamut', visit_referrer: 'forum.gamer.com.tw', visit_n: 3 });
  });

  it('does not tag a visit with our own page as its referrer, or invent tags', () => {
    const p = visitProps({ local: memory(), session: memory(), landing: landing('?room=ABCD', `https://${HOST}/`), prior: false, now: NOW });
    expect(Object.keys(p).filter(k => /^(first|visit)_/.test(k) && k !== 'visit_n')).toEqual([]);
  });

  it('says which app’s browser it is', () => {
    expect(visitProps({ local: memory(), landing: landing(), prior: false, inApp: 'threads', now: NOW }).in_app).toBe('threads');
    expect(visitProps({ local: memory(), landing: landing(), prior: false, now: NOW })).not.toHaveProperty('in_app');
  });

  it('only a click id counts as a touch', () => {
    const local = memory();
    expect(visitProps({ local, session: memory(), landing: landing('?gclid=abc'), prior: false, now: NOW })).toMatchObject({ first_gclid: true });
  });
});
