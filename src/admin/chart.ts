import { niceStep } from './groups';

/**
 * The admin page's charts (hand-rolled SVG, no library): a time chart with bars, lines and area
 * washes on one y axis, a sparkline, and one HTML tooltip for every chart on the page. Each bucket
 * (day or hour) gets a full-height hit column carrying its readout in `data-tip`, so the pointer
 * only has to find the X: hovering (or focusing the chart and pressing ←/→) shows the crosshair, the
 * points and one tooltip listing every series. Labels reach the tooltip through `textContent`.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** One row of a tooltip: the value leads, the series follows; `key` is the swatch's class, `shape` its form. */
export interface TipRow { key?: string; shape?: 'bar' | 'line' | 'tick' | 'ghost'; value: string; label: string; detail?: string }
export interface Tip { title: string; rows: TipRow[]; note?: string }
/** A `data-tip` attribute holding a readout. */
export const tipAttr = (t: Tip) => ` data-tip="${esc(JSON.stringify(t))}"`;

/** A series on a time chart; `values[i]` is bucket i (undefined: no data). */
export interface Series {
  id: string; label: string;
  kind: 'bar' | 'line' | 'area' | 'tick';
  /** Swatch / mark class (the CSS gives it a colour). */
  cls: string;
  values: (number | undefined)[];
  /** Per bucket: draw this point faint (a day in progress, an incomplete window). */
  faint?: (boolean | undefined)[];
}

export interface TimeChart {
  aria: string;
  series: Series[];
  /** The x label under bucket i, if it gets one. */
  xLabel: (i: number) => string | undefined;
  /** The readout for bucket i (undefined: no tooltip there). */
  tip: (i: number) => Tip | undefined;
  yFmt: (v: number) => string;
  /** Whole-number axis (counts). */
  counts?: boolean;
  /** The axis reaches at least this. */
  minMax?: number;
  /** Horizontal reference lines (a target, a full room). */
  refs?: { v: number; label: string }[];
  /** Extra marks over the plot (release flags), given the bucket centre and the plot's top and bottom. */
  overlay?: (cx: (i: number) => number, top: number, bottom: number) => string;
  width: number;
  height: number;
}

/** A bar with a 4px rounded data end and a square foot on the baseline. */
function barPath(x: number, y: number, w: number, h: number) {
  if (h <= 0) return '';
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

const f1 = (n: number) => Math.round(n * 10) / 10;

/** A line through the defined points (gaps where undefined), optionally only the points `keep` allows. */
function linePath(pts: ({ x: number; y: number } | undefined)[], keep: (i: number) => boolean = () => true) {
  let d = '', open = false;
  pts.forEach((p, i) => {
    if (!p || !keep(i)) { open = false; return; }
    d += `${open ? 'L' : 'M'}${f1(p.x)},${f1(p.y)}`;
    open = true;
  });
  return d;
}

/** A time chart: bars (side by side when several), area washes, lines and ticks on one y axis, with hover columns. */
export function timeChart(o: TimeChart): string {
  const n = Math.max(1, ...o.series.map(s => s.values.length));
  const W = o.width, H = o.height, L = 44, R = 10, T = 16, B = 24;
  let max = Math.max(o.minMax ?? 1, ...(o.refs ?? []).map(r => r.v));
  for (const s of o.series) for (const v of s.values) if (v !== undefined && v > max) max = v;
  const step = niceStep(max, o.counts), top = Math.ceil(max / step - 1e-9) * step;
  const plotH = H - T - B, col = (W - L - R) / n;
  const y = (v: number) => T + plotH * (1 - v / top);
  const cx = (i: number) => L + col * i + col / 2;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria)}">`;
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg += `<line class="grid${v ? '' : ' base'}" x1="${L}" x2="${W - R}" y1="${f1(y(v))}" y2="${f1(y(v))}"/><text class="ytick" x="${L - 8}" y="${f1(y(v)) + 4}" text-anchor="end">${esc(o.yFmt(v))}</text>`;
  }
  for (const r of o.refs ?? []) svg += `<line class="ref" x1="${L}" x2="${W - R}" y1="${f1(y(r.v))}" y2="${f1(y(r.v))}"/><text class="ref-label" x="${W - R}" y="${f1(y(r.v)) - 4}" text-anchor="end">${esc(r.label)}</text>`;

  // Bars: the bar series with a value in a bucket share it, centred, each at most 24 px wide.
  const bars = o.series.filter(s => s.kind === 'bar');
  for (let i = 0; i < n; i++) {
    const here = bars.filter(s => s.values[i] !== undefined && s.values[i]! > 0);
    if (!here.length) continue;
    const gap = col > 8 ? 2 : 0;
    const bw = Math.max(1, Math.min(24, (col * 0.72 - gap * (here.length - 1)) / here.length));
    const left = cx(i) - (bw * here.length + gap * (here.length - 1)) / 2;
    here.forEach((s, j) => {
      const v = s.values[i]!;
      svg += `<path class="bar ${s.cls}${s.faint?.[i] ? ' faint' : ''}" d="${barPath(f1(left + j * (bw + gap)), f1(y(v)), f1(bw), f1(y(0) - y(v)))}"/>`;
    });
  }
  // Areas (a 10% wash under the line), then lines, then ticks.
  const pts = (s: Series) => s.values.map((v, i) => (v === undefined ? undefined : { x: cx(i), y: y(v) }));
  for (const s of o.series.filter(s => s.kind === 'area')) {
    const p = pts(s);
    // One closed shape per run of defined points.
    let run: { x: number; y: number }[] = [];
    const flush = () => {
      if (run.length > 1) svg += `<path class="area ${s.cls}" d="M${f1(run[0].x)},${f1(y(0))}${run.map(q => `L${f1(q.x)},${f1(q.y)}`).join('')}L${f1(run[run.length - 1].x)},${f1(y(0))}Z"/>`;
      run = [];
    };
    p.forEach(q => (q ? run.push(q) : flush()));
    flush();
  }
  for (const s of o.series.filter(s => s.kind === 'line' || s.kind === 'area')) {
    const p = pts(s);
    if (s.faint?.some(Boolean)) {
      // Faint points: the whole line faint, then the solid part over it (a segment is solid when both ends are).
      svg += `<path class="line ${s.cls} faint" d="${linePath(p)}"/><path class="line ${s.cls}" d="${linePath(p, i => !s.faint![i])}"/>`;
    } else svg += `<path class="line ${s.cls}" d="${linePath(p)}"/>`;
    // A lone point (no neighbours) still shows.
    p.forEach((q, i) => { if (q && !p[i - 1] && !p[i + 1]) svg += `<circle class="dot ${s.cls}" cx="${f1(q.x)}" cy="${f1(q.y)}" r="3"/>`; });
  }
  for (const s of o.series.filter(s => s.kind === 'tick')) {
    s.values.forEach((v, i) => {
      if (v === undefined || v <= 0) return;
      const half = Math.min(14, Math.max(3, col * 0.42));
      svg += `<line class="tickmark ${s.cls}" x1="${f1(cx(i) - half)}" x2="${f1(cx(i) + half)}" y1="${f1(y(v))}" y2="${f1(y(v))}"/>`;
    });
  }
  // X labels.
  for (let i = 0; i < n; i++) {
    const label = o.xLabel(i);
    if (label) svg += `<text class="xtick" x="${f1(cx(i))}" y="${H - 6}" text-anchor="middle">${esc(label)}</text>`;
  }
  // Hover columns last (on top): the band, the crosshair and each line's point at this X.
  const lines = o.series.filter(s => s.kind === 'line' || s.kind === 'area');
  for (let i = 0; i < n; i++) {
    const t = o.tip(i);
    if (!t) continue;
    let marks = `<line class="cross" x1="${f1(cx(i))}" x2="${f1(cx(i))}" y1="${T}" y2="${H - B}"/>`;
    for (const s of lines) { const v = s.values[i]; if (v !== undefined) marks += `<circle class="pt ${s.cls}" cx="${f1(cx(i))}" cy="${f1(y(v))}" r="4"/>`; }
    svg += `<g class="col"${tipAttr(t)}><rect class="hit" x="${f1(L + col * i)}" y="${T}" width="${f1(col + 0.5)}" height="${H - T - B}"/>${marks}</g>`;
  }
  if (o.overlay) svg += o.overlay(cx, T, H - B);
  return `<div class="chart" tabindex="0">${svg}</svg></div>`;
}

/** A sparkline: the trend as a 2px line with a wash, the latest point marked. Undefined values are gaps. */
export function sparkline(values: (number | undefined)[], cls: string, width = 120, height = 32): string {
  const defined = values.filter((v): v is number => v !== undefined);
  if (defined.length < 2) return '';
  const max = Math.max(1e-9, ...defined), min = Math.min(0, ...defined);
  const x = (i: number) => 2 + ((width - 4) * i) / Math.max(1, values.length - 1);
  const y = (v: number) => 3 + (height - 6) * (1 - (v - min) / (max - min || 1));
  const p = values.map((v, i) => (v === undefined ? undefined : { x: x(i), y: y(v) }));
  const d = linePath(p);
  const firstI = p.findIndex(Boolean), lastI = p.length - 1 - [...p].reverse().findIndex(Boolean);
  const last = p[lastI]!;
  const area = `${linePath(p.map((q, i) => (i >= firstI && i <= lastI ? q : undefined)))}L${f1(last.x)},${height}L${f1(p[firstI]!.x)},${height}Z`;
  return `<svg class="spark ${cls}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="${area}"/><path class="line" d="${d}"/><circle cx="${f1(last.x)}" cy="${f1(last.y)}" r="2.5"/></svg>`;
}

/** Legend entries: a rect for bars, a line for lines and areas, a short bar for ticks. */
export function legend(items: { cls: string; label: string; shape?: 'bar' | 'line' | 'tick' | 'ghost' | 'ref' }[]): string {
  return `<div class="legend">${items.map(i => `<span><i class="sw ${i.shape ?? 'bar'} ${i.cls}"></i>${esc(i.label)}</span>`).join('')}</div>`;
}

/**
 * The one tooltip for the page: follows the pointer over any `[data-tip]` (chart columns, release
 * flags), and a focused chart walks its columns with ←/→ (Home/End), Escape hides it.
 */
export function attachTooltips(scope: HTMLElement): void {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  let current: Element | null = null;

  const fill = (data: Tip) => {
    tip.replaceChildren();
    const title = document.createElement('div');
    title.className = 'tt-title'; title.textContent = data.title;
    tip.append(title);
    for (const r of data.rows) {
      const row = document.createElement('div');
      row.className = 'tt-row';
      const sw = document.createElement('i');
      sw.className = `sw ${r.shape ?? 'bar'} ${r.key ?? ''}`;
      const v = document.createElement('b'); v.textContent = r.value;
      const l = document.createElement('span'); l.textContent = r.label;
      row.append(sw, v, l);
      if (r.detail) { const d = document.createElement('small'); d.textContent = r.detail; row.append(d); }
      tip.append(row);
    }
    if (data.note) { const n = document.createElement('div'); n.className = 'tt-note'; n.textContent = data.note; tip.append(n); }
  };
  const place = (x: number, y: number) => {
    const w = tip.offsetWidth, h = tip.offsetHeight, pad = 12;
    let left = x + 16, topY = y + 16;
    if (left + w > innerWidth - pad) left = Math.max(pad, x - w - 16);
    if (topY + h > innerHeight - pad) topY = Math.max(pad, y - h - 16);
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(topY)}px)`;
  };
  const show = (el: Element, x: number, y: number) => {
    if (current !== el) {
      current?.classList.remove('on');
      current = el;
      el.classList.add('on');
      try { fill(JSON.parse(el.getAttribute('data-tip') ?? '')); } catch { hide(); return; }
    }
    tip.hidden = false;
    place(x, y);
  };
  const hide = () => { current?.classList.remove('on'); current = null; tip.hidden = true; };

  scope.addEventListener('pointermove', e => {
    const el = (e.target as Element).closest?.('[data-tip]');
    if (el && scope.contains(el)) show(el, e.clientX, e.clientY); else if (current) hide();
  });
  scope.addEventListener('pointerleave', hide);
  addEventListener('scroll', () => { if (current && !current.closest('.chart:focus-within, .chart:focus')) hide(); }, { passive: true });
  // A focused control with a readout (a KPI's "i") shows it under itself; leaving it or a chart hides it.
  scope.addEventListener('focusin', e => {
    const el = e.target as Element;
    if (!el.matches?.('[data-tip]')) return;
    const r = el.getBoundingClientRect();
    show(el, r.left, r.bottom - 8);
  });
  scope.addEventListener('focusout', e => { const el = e.target as Element; if (el.classList?.contains('chart') || el.matches?.('[data-tip]')) hide(); });
  scope.addEventListener('keydown', e => {
    const chart = (e.target as Element).closest?.('.chart');
    if (!chart || !scope.contains(chart)) return;
    if (e.key === 'Escape') { hide(); return; }
    const cols = Array.from(chart.querySelectorAll('.col[data-tip]'));
    if (!cols.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const at = current && cols.includes(current) ? cols.indexOf(current) : -1;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? cols.length - 1
      : at < 0 ? cols.length - 1 : Math.max(0, Math.min(cols.length - 1, at + (e.key === 'ArrowLeft' ? -1 : 1)));
    const r = cols[next].getBoundingClientRect();
    show(cols[next], r.left + r.width / 2, r.top + 8);
  });
  /** A redraw replaced the hovered element: drop the stale tooltip. */
  new MutationObserver(() => { if (current && !scope.contains(current)) hide(); }).observe(scope, { childList: true });
}
