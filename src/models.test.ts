import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAP_IDS, loadMap } from '../shared/maps';

/**
 * props.glb holds only the props the maps place and the kit pieces carrying the procedural walls'
 * trim sheets (tools/compress-models.ts cuts the rest to keep the first download small).
 */
const glbJson = (file: string) => {
  const b = readFileSync(join(__dirname, '../public/assets', file));
  return JSON.parse(b.subarray(20, 20 + b.readUInt32LE(12)).toString('utf8')) as {
    scenes: { nodes: number[] }[]; nodes: { name?: string }[]; images?: { name?: string }[]; extensionsRequired?: string[];
  };
};

describe('props.glb', () => {
  const props = glbJson('props.glb');
  const roots = new Set(props.scenes[0].nodes.map(i => props.nodes[i].name));

  it('has every prop a map places', () => {
    const placed = new Set<string>();
    for (const id of MAP_IDS) for (const d of loadMap(id).def.decor) if (d.kind === 'prop') placed.add(d.model);
    expect(placed.size).toBeGreaterThan(3);
    expect([...placed].filter(m => !roots.has(m))).toEqual([]);
  });

  it('keeps the trim sheets the level borrows (src/render/level.ts trimMaterial)', () => {
    const images = new Set(props.images?.map(i => i.name));
    for (const name of ['T_Trim_01_BaseColor', 'T_Trim_02_BaseColor', 'T_Trim_03_BaseColor']) expect(images.has(name), name).toBe(true);
  });

  it('needs only extensions the client decodes', () => {
    for (const file of ['props.glb', 'weapons.glb', 'soldier.glb']) {
      for (const ext of glbJson(file).extensionsRequired ?? []) expect(['EXT_meshopt_compression', 'EXT_texture_webp', 'KHR_mesh_quantization'], `${file}: ${ext}`).toContain(ext);
    }
  });
});
