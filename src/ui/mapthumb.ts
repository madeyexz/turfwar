import { loadMap } from '../../shared/maps/index';

/** Map swatches (also in menu.css as `--swatch`): the theme's dominant colour. */
export const THEME_SWATCH: Record<string, string> = {
  desert: '#d9a75e', snow: '#cfe8f2', forest: '#7fc56b', dusk: '#f0a560', twilight: '#8aa6c8',
  steppe: '#d8c9a4', meadow: '#8fc46a', taipei: '#ff5ad8', xinyi: '#5fd0c0',
};

/**
 * A top-down plan of a map for the lobby's map picker: its walls and buildings from the collision
 * boxes, tinted with the theme swatch, the bases' spawn areas in team colours and the bomb sites.
 * Drawn once per canvas from the shared map definition (no textures, no WebGL).
 */
export function drawMapThumb(canvas: HTMLCanvasElement, id: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const def = loadMap(id).def, b = def.bounds;
  const w = canvas.width, h = canvas.height, pad = 4;
  const sx = (w - pad * 2) / (b.maxX - b.minX), sz = (h - pad * 2) / (b.maxZ - b.minZ);
  const s = Math.min(sx, sz);
  const ox = (w - (b.maxX - b.minX) * s) / 2, oz = (h - (b.maxZ - b.minZ) * s) / 2;
  const X = (x: number) => ox + (x - b.minX) * s, Z = (z: number) => oz + (z - b.minZ) * s;
  const swatch = THEME_SWATCH[def.theme] ?? '#9fb3b9';
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(4, 9, 12, 0.9)';
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.14; ctx.fillStyle = swatch;
  ctx.fillRect(X(b.minX), Z(b.minZ), (b.maxX - b.minX) * s, (b.maxZ - b.minZ) * s);
  ctx.globalAlpha = 1;
  // Taller boxes read brighter; low clutter (kerbs, rubble) is skipped.
  for (const o of def.solids) {
    const tall = o.maxY - o.minY;
    if (tall < 0.9 || o.team !== undefined) continue;
    const x0 = Math.max(o.minX, b.minX), x1 = Math.min(o.maxX, b.maxX), z0 = Math.max(o.minZ, b.minZ), z1 = Math.min(o.maxZ, b.maxZ);
    if (x1 <= x0 || z1 <= z0) continue;
    ctx.globalAlpha = tall > 3 ? 0.75 : 0.45;
    ctx.fillStyle = tall > 3 ? swatch : '#c8d2d6';
    ctx.fillRect(X(x0), Z(z0), Math.max(0.6, (x1 - x0) * s), Math.max(0.6, (z1 - z0) * s));
  }
  ctx.globalAlpha = 1;
  for (const team of [0, 1] as const) {
    const own = def.spawns.filter(p => p.team === team);
    if (!own.length) continue;
    const cx = own.reduce((a, p) => a + p.x, 0) / own.length, cz = own.reduce((a, p) => a + p.z, 0) / own.length;
    ctx.fillStyle = team === 0 ? '#4aa8ff' : '#ff5544';
    ctx.beginPath(); ctx.arc(X(cx), Z(cz), 3.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = '#ffb45a'; ctx.lineWidth = 1.4;
  for (const site of def.sabotage?.sites ?? []) {
    const p = def.points.find(q => q.id === site);
    if (!p) continue;
    ctx.beginPath(); ctx.arc(X(p.x), Z(p.z), Math.max(3, p.radius * s), 0, Math.PI * 2); ctx.stroke();
  }
}
