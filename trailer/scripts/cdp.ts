/**
 * A tiny Chrome DevTools Protocol client for the trailer tools: launches its own headless Chrome
 * (GPU on, audio muted, private profile) on a fixed debugging port, opens one page and talks to it
 * over a WebSocket. No Playwright or Puppeteer.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.TRAILER_CDP_PORT ?? 9351);

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; method: string };

export class Page {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Map<string, ((params: any) => void)[]>();
  logs: string[] = [];

  static async open(wsUrl: string) {
    const page = new Page();
    page.ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => { page.ws.onopen = () => resolve(); page.ws.onerror = () => reject(new Error(`CDP connect failed: ${wsUrl}`)); });
    page.ws.onmessage = ev => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined) {
        const p = page.pending.get(msg.id);
        if (!p) return;
        page.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`)); else p.resolve(msg.result);
      } else if (msg.method) for (const f of page.listeners.get(msg.method) ?? []) f(msg.params);
    };
    page.on('Runtime.consoleAPICalled', p => {
      const text = p.args.map((a: any) => a.value ?? a.description ?? '').join(' ');
      page.logs.push(`[${p.type}] ${text}`);
      if (process.env.TRAILER_VERBOSE || p.type === 'error') console.log(`  page ${p.type}: ${text.slice(0, 400)}`);
    });
    page.on('Runtime.exceptionThrown', p => {
      const text = p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text;
      page.logs.push(`[exception] ${text}`);
      console.log(`  page exception: ${String(text).slice(0, 600)}`);
    });
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    return page;
  }

  on(method: string, f: (params: any) => void) { this.listeners.set(method, [...(this.listeners.get(method) ?? []), f]); }

  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, method }));
  }

  /** Evaluate an expression in the page (awaiting promises) and return its JSON value. */
  async eval<T = any>(expression: string): Promise<T> {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n  in: ${expression.slice(0, 300)}`);
    return r.result.value as T;
  }

  /** Poll until `expression` is truthy. */
  async waitFor(expression: string, timeoutMs = 60000, label = expression) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await this.eval(`!!(${expression})`).catch(() => false)) return;
      await Bun.sleep(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  async navigate(url: string) {
    const loaded = new Promise<void>(resolve => this.once('Page.loadEventFired', () => resolve()));
    await this.send('Page.navigate', { url });
    await loaded;
  }

  private once(method: string, f: (params: any) => void) {
    const wrapped = (p: any) => { this.listeners.set(method, (this.listeners.get(method) ?? []).filter(x => x !== wrapped)); f(p); };
    this.on(method, wrapped);
  }

  /** Viewport screenshot as bytes (jpeg or png). */
  async screenshot(format: 'jpeg' | 'png' = 'jpeg', quality = 94): Promise<Uint8Array> {
    const r = await this.send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}), optimizeForSpeed: true, captureBeyondViewport: false });
    return Buffer.from(r.data, 'base64');
  }

  close() { try { this.ws.close(); } catch { /* closed */ } }
}

export class Browser {
  private proc?: ChildProcess;
  private profile = mkdtempSync(join(tmpdir(), 'lb-trailer-chrome-'));

  async launch(width = 1920, height = 1080) {
    this.proc = spawn(CHROME, [
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${this.profile}`,
      '--headless=new', `--window-size=${width},${height}`, '--hide-scrollbars', '--mute-audio',
      '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal', '--enable-webgl',
      '--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) return; } catch { /* starting */ }
      await Bun.sleep(100);
    }
    throw new Error('Chrome did not start');
  }

  async page(width = 1920, height = 1080, scale = 1) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[];
    const target = list.find(t => t.type === 'page');
    if (!target) throw new Error('no page target');
    const page = await Page.open(target.webSocketDebuggerUrl);
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    return page;
  }

  close() {
    this.proc?.kill('SIGTERM');
    try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* in use */ }
  }
}
