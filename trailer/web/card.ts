/**
 * Trailer cards, animated by frame (trailer/scripts/cards.ts screenshots each frame, with alpha
 * for captions and tags). `__card.show(kind, lines, frames)` builds a card; `__card.at(f)` poses it.
 */
type Kind = 'title' | 'caption' | 'tag' | 'end';

const root = document.querySelector<HTMLElement>('#card')!;
/** `?lang=zh-TW`: Chinese typography (card.css) and the game's Noto Sans TC. */
const LANG = new URLSearchParams(location.search).get('lang') ?? 'en';
document.documentElement.lang = LANG;
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (u: number) => 1 - (1 - clamp(u)) ** 3;
/** 0→1 over [a, b] frames, eased. */
const span = (f: number, a: number, b: number) => ease((f - a) / (b - a));
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));

let pose: (f: number) => void = () => undefined;

function show(kind: Kind, lines: string[], frames: number) {
  root.className = kind === 'title' || kind === 'end' ? 'opaque' : '';
  root.style.cssText = '';
  if (kind === 'title') {
    const [word, sub, teams] = lines;
    const [swat, militia] = teams.split(' vs ');
    root.innerHTML = `<div class="grid"></div><div class="title"><div class="word">${esc(word)}</div><div class="sub">${esc(sub)}</div><div class="rule"></div>
      <div class="teams"><span class="swat">${esc(swat)}</span><span class="vs">vs</span><span class="militia">${esc(militia)}</span></div></div>`;
    const q = (s: string) => root.querySelector<HTMLElement>(s)!;
    const short = frames < 90;
    pose = f => {
      const k = short ? 0.5 : 1;
      const w = span(f, 0, 20 * k);
      q('.word').style.cssText = `opacity:${w};letter-spacing:${0.16 + (1 - w) * 0.25}em;filter:blur(${(1 - w) * 8}px)`;
      const s = span(f, 12 * k, 30 * k);
      q('.sub').style.cssText = `opacity:${s};transform:translateY(${(1 - s) * 18}px)`;
      q('.rule').style.width = `${span(f, 18 * k, 48 * k) * 900}px`;
      const t = span(f, 44 * k, 62 * k);
      q('.teams').style.cssText = `opacity:${t};transform:scale(${1.08 - 0.08 * t})`;
      q('.grid').style.transform = `translateY(${-f * 0.4}px)`;
      root.style.opacity = String(1 - span(f, frames - 6, frames));
    };
  } else if (kind === 'caption') {
    const [kicker, head] = lines;
    root.innerHTML = `<div class="caption"><div class="shade"></div><div class="bar"></div><div class="kicker">${esc(kicker)}</div><div class="head">${esc(head)}</div></div>`;
    const q = (s: string) => root.querySelector<HTMLElement>(s)!;
    pose = f => {
      const out = span(f, frames - 10, frames);
      q('.bar').style.transform = `scaleY(${span(f, 0, 8)})`;
      q('.shade').style.opacity = String(span(f, 0, 10) * (1 - out));
      q('.kicker').style.cssText = `clip-path:inset(0 ${100 - span(f, 4, 14) * 100}% 0 0);opacity:${1 - out}`;
      q('.head').style.cssText = `clip-path:inset(0 ${100 - span(f, 8, 20) * 100}% 0 0);opacity:${1 - out};transform:translateX(${-out * 30}px)`;
      q('.bar').style.opacity = String(1 - out);
    };
  } else if (kind === 'tag') {
    root.innerHTML = `<div class="tag"><b>${esc(lines[0])}</b></div>`;
    const tag = root.querySelector<HTMLElement>('.tag')!;
    pose = f => {
      const inn = span(f, 0, 7), out = span(f, frames - 7, frames);
      tag.style.cssText = `clip-path:inset(0 ${100 - inn * 100}% 0 0);opacity:${1 - out};transform:translateX(${-out * 20}px)`;
    };
  } else {
    const [word, sub, cta, url, note] = lines;
    root.innerHTML = `<div class="grid"></div><div class="end"><div class="word">${esc(word)}</div><div class="sub">${esc(sub)}</div>
      <div class="cta">${esc(cta)}</div><div class="url">${esc(url)}</div><div class="note">${esc(note)}</div></div>`;
    const q = (s: string) => root.querySelector<HTMLElement>(s)!;
    pose = f => {
      root.style.opacity = String(span(f, 0, 12) * (1 - span(f, frames - 20, frames)));
      q('.word').style.cssText = `opacity:${span(f, 0, 16)};letter-spacing:${0.16 + (1 - span(f, 0, 24)) * 0.12}em`;
      q('.sub').style.opacity = String(span(f, 8, 24));
      q('.cta').style.cssText = `opacity:${span(f, 22, 36)};transform:translateY(${(1 - span(f, 22, 36)) * 14}px)`;
      const u = span(f, 30, 44);
      q('.url').style.cssText = `opacity:${u};transform:scale(${0.9 + 0.1 * u})`;
      q('.note').style.opacity = String(span(f, 44, 60) * 0.75);
      q('.grid').style.transform = `translateY(${-f * 0.3}px)`;
    };
  }
  pose(0);
  const text = lines.join('');
  return Promise.all([
    ...[500, 600, 700].map(w => document.fonts.load(`${w} 40px Rajdhani`)),
    ...(LANG === 'zh-TW' ? [500, 700, 800].map(w => document.fonts.load(`${w} 40px "Noto Sans TC"`, text)) : []),
  ]).then(() => document.fonts.ready).then(() => true);
}

Object.assign(window, { __card: { show, at: (f: number) => { pose(f); return f; } } });
