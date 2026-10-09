/**
 * 戰績分享卡: a 1080×1920 (9:16, story-sized) picture of a match, drawn on a canvas in the browser:
 * a frame of the match behind, the result, one brag line, the numbers, the callsign, and a QR code
 * and link under 「單挑我 →」. Shared with the Web Share API where the browser can share files
 * (phones: IG Stories, LINE, Threads), else saved and the link copied.
 */
import qrcode from 'qrcode-generator';
import { sizeLabel } from '../../shared/match/rooms';
import { bragLine, nationalDay, type MatchSummary } from '../game/matchstats';
import { cjkFontReady, UI_STACK } from './fonts';
import { isZh, mapName, mapNameZh, t, type Key } from './i18n';
import { loadMap } from '../../shared/maps/index';

export const CARD_W = 1080;
export const CARD_H = 1920;

const INK = '#e9f3f5', MUTED = '#9fb3b9', ACCENT = '#7ff6ff', CRIMSON = '#ff5544', CASH = '#9cf08a', AMBER = '#ffb45a';

/** The card's headline in the current language. `meme`: the knife is the 藍白拖. */
export function bragText(s: MatchSummary, meme: boolean, at = new Date()) {
  const b = bragLine(s, at);
  const map = mapLabel(s.mapId);
  const key = !meme && b.key === 'slipperMulti' ? 'brag.knifeMulti' : !meme && b.key === 'slipper' ? 'brag.knife' : `brag.${b.key}`;
  return t(key as Key, { n: b.n ?? 0, name: b.name ?? '', map });
}

const mapLabel = (id: string) => {
  let english = id;
  try { english = loadMap(id).def.name; } catch { /* an unknown id stays as it is */ }
  return mapName(id, english);
};

/** "西門町 · 6v6 殲滅戰 · 對電腦" (the English card adds the Chinese name). */
function matchLine(s: MatchSummary) {
  const zh = mapNameZh(s.mapId);
  const map = isZh() || !zh ? mapLabel(s.mapId) : `${mapLabel(s.mapId)} ${zh}`;
  return [map, `${sizeLabel(s.teamSize)} ${t(`mode.${s.mode}` as Key)}`, ...(s.solo ? [t('share.vsBots')] : [])].join('  ·  ');
}

const font = (weight: number, size: number) => `${weight} ${size}px ${UI_STACK}`;

/** Shrinks `text` until it fits `width`; returns the size used. */
function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, size: number, width: number, min = 24) {
  for (; size > min; size -= 4) { ctx.font = font(weight, size); if (ctx.measureText(text).width <= width) break; }
  ctx.font = font(weight, size);
  return size;
}

/** Breaks `text` into lines of `width`: between words for Latin, between characters for Chinese. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const parts = text.match(/[　-〿㐀-鿿＀-￯]|[^\s　-〿㐀-鿿＀-￯]+|\s+/g) ?? [text];
  const lines: string[] = [];
  let line = '';
  for (const p of parts) {
    if (ctx.measureText(line + p).width > width && line.trim()) { lines.push(line.trim()); line = p.trimStart(); } else line += p;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function image(src: string) {
  return new Promise<HTMLImageElement | undefined>(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(undefined);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}

/** The QR code of `url` as dark squares on white, `size` px square with a quiet zone. */
function drawQr(ctx: CanvasRenderingContext2D, url: string, x: number, y: number, size: number) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  const n = qr.getModuleCount(), quiet = 3, cell = size / (n + quiet * 2);
  ctx.fillStyle = '#fff';
  roundRect(ctx, x, y, size, size, 18); ctx.fill();
  ctx.fillStyle = '#071016';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c)) ctx.fillRect(Math.floor(x + (c + quiet) * cell), Math.floor(y + (r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
  }
}

export interface CardInput {
  summary: MatchSummary;
  /** The 單挑我 link the QR code and the text carry. */
  url: string;
  /** A frame of the match (any size; cropped to fill). */
  backdrop?: CanvasImageSource & { width: number; height: number };
  meme: boolean;
  at?: Date;
}

/** Draws the card; resolves with the canvas (fonts and the app icon loaded first). */
export async function drawShareCard(input: CardInput): Promise<HTMLCanvasElement> {
  const { summary: s, url, meme } = input;
  const at = input.at ?? new Date();
  const brag = bragText(s, meme, at);
  const result = t(s.result === 'win' ? 'hud.victory' : s.result === 'loss' ? 'hud.defeat' : 'hud.draw');
  const line = matchLine(s);
  const holiday = nationalDay(at);
  const words = [brag, result, line, s.name, t('card.challenge'), t('card.scan'), t('card.holiday'), t('card.kills'), t('card.deaths'), t('card.hs'), t('card.best'), t('card.slipper'), t('card.knife'), '角頭械鬥'].join('');
  await Promise.all([
    cjkFontReady(words, 900), cjkFontReady(words, 700),
    document.fonts?.load(`700 64px Rajdhani`).catch(() => undefined), document.fonts?.load(`600 64px Rajdhani`).catch(() => undefined),
  ]);
  const icon = await image('/icons/icon-512.png');

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W; canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';

  // ---- Backdrop: the match frame, cropped to fill, darkened toward the text.
  ctx.fillStyle = '#071016'; ctx.fillRect(0, 0, CARD_W, CARD_H);
  const b = input.backdrop;
  if (b && b.width > 0 && b.height > 0) {
    const scale = Math.max(CARD_W / b.width, CARD_H / b.height);
    const w = b.width * scale, h = b.height * scale;
    ctx.drawImage(b, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
  } else {
    const g = ctx.createRadialGradient(CARD_W * 0.7, CARD_H * 0.28, 60, CARD_W * 0.5, CARD_H * 0.5, CARD_H * 0.75);
    g.addColorStop(0, '#1d4a5a'); g.addColorStop(0.5, '#0c1d26'); g.addColorStop(1, '#05090c');
    ctx.fillStyle = g; ctx.fillRect(0, 0, CARD_W, CARD_H);
    ctx.strokeStyle = 'rgba(127, 246, 255, 0.07)'; ctx.lineWidth = 26;
    for (let x = -CARD_H; x < CARD_W; x += 90) { ctx.beginPath(); ctx.moveTo(x, CARD_H); ctx.lineTo(x + CARD_H, 0); ctx.stroke(); }
  }
  const shade = ctx.createLinearGradient(0, 0, 0, CARD_H);
  shade.addColorStop(0, 'rgba(4, 9, 12, 0.82)'); shade.addColorStop(0.16, 'rgba(4, 9, 12, 0.35)');
  shade.addColorStop(0.42, 'rgba(4, 9, 12, 0.55)'); shade.addColorStop(0.62, 'rgba(4, 9, 12, 0.88)'); shade.addColorStop(1, 'rgba(4, 9, 12, 0.97)');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, CARD_W, CARD_H);

  const L = 80, R = CARD_W - 80, W = R - L;

  // ---- Brand.
  if (icon) { ctx.save(); roundRect(ctx, L, 76, 128, 128, 28); ctx.clip(); ctx.drawImage(icon, L, 76, 128, 128); ctx.restore(); }
  ctx.fillStyle = INK; ctx.font = font(900, 64); ctx.fillText('角頭械鬥', L + 156, 136);
  ctx.fillStyle = ACCENT; ctx.font = font(700, 36); ctx.fillText('TURF WAR: TAIPEI', L + 158, 188);
  if (holiday) {
    const label = t('card.holiday') + ' · 10.10';
    ctx.font = font(900, 34);
    const w = ctx.measureText(label).width + 44;
    ctx.fillStyle = CRIMSON; roundRect(ctx, R - w, 96, w, 64, 10); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'right'; ctx.fillText(label, R - 22, 140); ctx.textAlign = 'left';
  }

  // ---- Callsign and result.
  ctx.fillStyle = INK; fit(ctx, s.name, 700, 84, W); ctx.fillText(s.name, L, 470);
  const color = s.result === 'win' ? ACCENT : s.result === 'loss' ? CRIMSON : INK;
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 50; ctx.fillStyle = color;
  fit(ctx, result, 900, isZh() ? 250 : 210, W - 280); ctx.fillText(result, L - 6, 700);
  ctx.restore();
  ctx.fillStyle = INK; ctx.font = font(700, 76);
  const score = `${s.score[0]} : ${s.score[1]}`;
  ctx.textAlign = 'right'; ctx.fillText(score, R, 700); ctx.textAlign = 'left';
  ctx.fillStyle = MUTED; fit(ctx, line, 700, 40, W); ctx.fillText(line, L, 772);

  // ---- The brag line on a slanted bar.
  ctx.font = font(900, 92);
  let size = 92, lines = wrap(ctx, brag, W - 40);
  while ((lines.length > 2 || lines.some(l => ctx.measureText(l).width > W - 40)) && size > 52) { size -= 6; ctx.font = font(900, size); lines = wrap(ctx, brag, W - 40); }
  const lineH = size * 1.18, top = 870, barH = lines.length * lineH + 56;
  ctx.save();
  ctx.fillStyle = 'rgba(127, 246, 255, 0.14)';
  ctx.beginPath(); ctx.moveTo(L - 20, top); ctx.lineTo(R + 20, top); ctx.lineTo(R, top + barH); ctx.lineTo(L - 40, top + barH); ctx.closePath(); ctx.fill();
  ctx.fillStyle = ACCENT; ctx.fillRect(L - 20, top, 10, barH);
  ctx.restore();
  ctx.fillStyle = '#fff';
  lines.forEach((l, i) => ctx.fillText(l, L + 14, top + 28 + size * 0.92 + i * lineH));

  // ---- The numbers: four tiles.
  const knifeTile = s.knifeKills > 0;
  const tiles: [string, string | number, string][] = [
    [t('card.kills'), s.kills, ACCENT], [t('card.deaths'), s.deaths, INK], [t('card.hs'), s.headshots, AMBER],
    knifeTile ? [t(meme ? 'card.slipper' : 'card.knife'), s.knifeKills, CASH] : [t('card.best'), s.bestRound, CASH],
  ];
  const gap = 24, tw = (W - gap) / 2, th = 170, ty = top + barH + 60;
  tiles.forEach(([label, value, c], i) => {
    const x = L + (i % 2) * (tw + gap), y = ty + Math.floor(i / 2) * (th + gap);
    ctx.fillStyle = 'rgba(8, 16, 22, 0.78)'; roundRect(ctx, x, y, tw, th, 16); ctx.fill();
    ctx.strokeStyle = 'rgba(190, 236, 244, 0.18)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = c; ctx.font = font(700, 104); ctx.fillText(String(value), x + 30, y + 112);
    ctx.fillStyle = MUTED; fit(ctx, label, 700, 34, tw - 60); ctx.fillText(label, x + 32, y + 152);
  });

  // ---- 單挑我 → with the QR code and the link.
  const qrSize = 290, qy = CARD_H - 80 - qrSize;
  drawQr(ctx, url, R - qrSize, qy, qrSize);
  ctx.fillStyle = ACCENT; fit(ctx, t('card.challenge'), 900, 112, W - qrSize - 40); ctx.fillText(t('card.challenge'), L, qy + 120);
  const host = url.replace(/^https?:\/\//, '').split('/')[0];
  ctx.fillStyle = INK; fit(ctx, host, 700, 46, W - qrSize - 40); ctx.fillText(host, L, qy + 196);
  ctx.fillStyle = MUTED; fit(ctx, t('card.scan'), 600, 34, W - qrSize - 40); ctx.fillText(t('card.scan'), L, qy + 252);
  return canvas;
}

export const cardBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));

/** Shares the picture with the phone's share sheet. Resolves 'native', 'cancel', or 'unsupported' (no file sharing here). */
export async function shareNative(file: File, text: string, url: string): Promise<'native' | 'cancel' | 'unsupported'> {
  const data: ShareData = { files: [file], text: `${text}\n${url}` };
  if (!navigator.canShare?.(data) || !navigator.share) return 'unsupported';
  try { await navigator.share(data); return 'native'; } catch (error) { return (error as Error)?.name === 'AbortError' ? 'cancel' : 'unsupported'; }
}

/** Saves the picture as a file (desktops; phones keep the press-and-hold on the preview). */
export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** Copies `text`; resolves whether it worked. */
export async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* older or in-app browsers */ }
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.appendChild(area); area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}
