/**
 * The map picker's pictures: one still per playable map, saved as public/media/maps/<id>.webp
 * (480×270, under 40 KB). Re-shoot a map after changing it.
 *
 * Each shot opens the level preview (dev/level.html) with the camera below, waits until the level is
 * dressed and has rendered a while, and takes the frame it hands over (`&shot=480x270`: no overlay,
 * centre-cropped to 16:9 and scaled down from a 1280×720 high-quality render), encoded as WebP at the
 * best quality that fits the size budget. It drives Chrome through the agent-browser CLI.
 *
 * With the dev server running (`bun run dev`, or `bunx vite --port 5217`):
 *
 *   bun scripts/mapshots.ts                         # every map, dev server at http://127.0.0.1:5173
 *   bun scripts/mapshots.ts --url http://127.0.0.1:5217 taipei xinyi
 *   bun scripts/mapshots.ts --out /tmp/try 'taipei@40,30,60@0,0,0@55'   # try a camera (cam@look@fov)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Vec = [number, number, number];
interface Shot { id: string; cam: Vec; look: Vec; fov?: number; note: string }

/**
 * One camera per playable map (shared/maps/index.ts PLAYABLE_MAP_IDS: the 24v24 maps included), in
 * metres (+x east, +z south). Keep the sky's moon (towards -x, -z, 31° up) out of frame: it reads as
 * a dark blot at this size.
 */
export const SHOTS: readonly Shot[] = [
  { id: 'warehouse', cam: [-22, 4.5, 12], look: [8, 1, -6], fov: 65, note: 'the crate hall and its catwalk' },
  { id: 'pipeline', cam: [-30, 34, 52], look: [6, 0, 0], note: 'over the forest to the pumping station' },
  { id: 'timbertown', cam: [44, 14, 30], look: [-6, 3, -8], note: 'the lumber mill and the manor' },
  { id: 'ochre', cam: [50, 40, 65], look: [0, 0, 0], note: 'over the walled old town' },
  { id: 'citadel', cam: [40, 18, 32], look: [0, 7, 0], note: 'the hilltop keep' },
  { id: 'railyard', cam: [55, 16, -40], look: [0, 2, 8], note: 'the freight yard and its ramps' },
  { id: 'skyline', cam: [56, 54, 58], look: [0, 33, 0], note: 'the rooftops above the city' },
  { id: 'meridian', cam: [-160, 75, 100], look: [-30, 0, -10], note: 'the downtown blocks and the tower' },
  { id: 'taipei', cam: [55, 40, 75], look: [0, 0, -5], fov: 55, note: "Ximending's neon streets at dusk" },
  { id: 'xinyi', cam: [140, 70, 160], look: [-60, 200, 6], fov: 60, note: 'Taipei 101 over Xinyi at night' },
  { id: 'taipei101', cam: [8, 6.8, 8], look: [0, 5.4, 0], fov: 65, note: "88F's damper hall from the 89F gallery" },
  { id: 'memorial', cam: [60, 16, 34], look: [-14, 6, 0], note: 'the Memorial Hall and its blue roof' },
  { id: 'sanchong', cam: [-36, 8, -39], look: [14, 3.5, -45], fov: 50, note: 'down the main street to the temple' },
];

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const base = (flag('--url') ?? 'http://127.0.0.1:5173').replace(/\/+$/, '');
/** `--out <dir>`: write somewhere else (trying cameras without touching the game's pictures). */
const out = flag('--out') ?? join(import.meta.dir, '..', 'public', 'media', 'maps');
const vec = (s: string) => s.split(',').map(Number) as Vec;
/** Arguments: map ids, or `id@x,y,z@x,y,z[@fov]` to try another camera (copy a good one into SHOTS). */
const tries: Shot[] = args.filter(a => a.includes('@')).map((a, i) => {
  const [id, cam, look, fov] = a.split('@');
  return { id, cam: vec(cam), look: vec(look), fov: fov ? Number(fov) : undefined, note: `try ${i + 1}: ${a}` };
});
const only = new Set(args.filter(a => !a.includes('@')));
const SIZE = { w: 480, h: 270 }, BUDGET = 40_000;
const QUALITIES = [0.86, 0.82, 0.78, 0.74, 0.7, 0.65, 0.6, 0.55, 0.5];
const SESSION = `mapshots-${process.pid}`;

/** One agent-browser command in this script's own browser session; its output. */
function browser(...cmd: string[]) {
  // (A cold level loads its models and textures first: allow minutes, not the default 25 s.)
  const r = Bun.spawnSync(['agent-browser', '--session', SESSION, ...cmd], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, AGENT_BROWSER_DEFAULT_TIMEOUT: '180000' } });
  const text = r.stdout.toString();
  if (r.exitCode !== 0) throw new Error(`agent-browser ${cmd[0]}: ${r.stderr.toString() || text}`);
  return text;
}
/** Run `js` in the page; the data URL it returns. */
function dataUrl(js: string) {
  const m = /data:image\/webp;base64,[A-Za-z0-9+/=]+/.exec(browser('eval', js));
  if (!m) throw new Error('no image came back');
  return Buffer.from(m[0].slice(m[0].indexOf(',') + 1), 'base64');
}

mkdirSync(out, { recursive: true });
const shots = tries.length ? tries : SHOTS.filter(s => !only.size || only.has(s.id));
try {
  browser('set', 'viewport', '1280', '720');
  for (const [i, s] of shots.entries()) {
    const q = new URLSearchParams({ map: s.id, cam: s.cam.join(','), look: s.look.join(','), q: 'high', shot: `${SIZE.w}x${SIZE.h}` });
    if (s.fov) q.set('fov', String(s.fov));
    browser('open', `${base}/dev/level.html?${q}`);
    browser('wait', '--fn', '!!window.__shot');
    let file: Buffer | undefined, quality = 0;
    for (quality of QUALITIES) {
      file = dataUrl(`window.__shot.toDataURL('image/webp', ${quality})`);
      if (file.length <= BUDGET) break;
    }
    writeFileSync(join(out, tries.length ? `${s.id}-try${i + 1}.webp` : `${s.id}.webp`), file!);
    console.log(`${s.id.padEnd(10)} ${(file!.length / 1024).toFixed(1).padStart(5)} KB  q${quality}  ${s.note}`);
  }
} finally {
  try { browser('close'); } catch { /* already closed */ }
}
