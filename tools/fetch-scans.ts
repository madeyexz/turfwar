/**
 * Downloads the CC0 Poly Haven assets of a map of scanned models and packs them for the game into
 * public/assets/<set>:
 *
 *   <model>.glb        a scanned model or modular kit: meshopt-compressed, textures as WebP at the size below
 *   <name>_<kind>.webp a ground or wall surface (diff, nor, arm = occlusion/roughness/metalness)
 *   sky.hdr            the sky: backdrop and image-based light
 *
 * The sets: `alley` (Back Alley: shared/maps/alley.ts, src/render/alley.ts) and `warehouse`
 * (Warehouse above the Low preset: src/render/warehouse.ts).
 * Downloads are kept in a cache directory (default /tmp/polyhaven), so a re-run only packs.
 * Run: bun tools/fetch-scans.ts <set> [name ...]   (names limit the run to those assets)
 * Poly Haven assets are CC0 1.0 (https://polyhaven.com/license).
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CACHE = process.env.POLYHAVEN_CACHE ?? '/tmp/polyhaven';

interface ScanSet {
  /** What the licence file calls it. */
  title: string;
  /**
   * [Poly Haven model id, texture size (px), share of the triangles to keep, error the simplifier may make
   * (share of the model's size; 0.002 unless given)]. The sources are film-dense (a flat wall panel is 3,000
   * triangles), and a map is drawn several times a frame (view, reflection, shadows), so the dense ones are
   * simplified: borders stay where they are, so kit pieces still meet, unless the last entry is `false`
   * (a model that stands alone and is drawn very many times).
   */
  models: [string, number, number?, number?, boolean?][];
  /** [Poly Haven texture id, local name, size (px)]. */
  surfaces: [string, string, number][];
  /** The sky: [Poly Haven HDRI id, resolution]. */
  sky: [string, string];
}

export const SETS: Record<string, ScanSet> = {
  alley: {
    title: 'the Back Alley map',
    // The two facade kits are seen closest and largest.
    models: [
      ['modular_urban_apartments_facade', 2048, 0.2], ['modular_factory_facade', 2048, 0.35],
      ['modular_fire_escape', 1024], ['exterior_aircon_unit', 1024, 0.3], ['metal_trash_can', 1024, 0.4],
      ['rollershutter_door', 1024], ['modular_electricity_poles', 1024, 0.3], ['modular_chainlink_fence', 1024],
      ['street_lamp_01', 1024, 0.3], ['security_light', 512, 0.4], ['utility_box_01', 1024], ['utility_box_02', 1024],
      ['water_manhole_cover', 1024, 0.5], ['modular_metal_gutter', 1024, 0.25], ['concrete_road_barrier_02', 1024, 0.25],
      ['covered_car', 2048], ['old_tyre', 512, 0.4], ['barrel_stove', 1024], ['cardboard_box_01', 1024, 0.2],
      ['modular_airduct_circular_01', 1024],
    ],
    surfaces: [['asphalt_04', 'ground', 2048]],
    sky: ['rooftop_night', '2k'],
  },
  warehouse: {
    title: 'the Warehouse map',
    // The crate is drawn a thousand times (nine to a stack): its planks and stencils are in its textures.
    models: [['wooden_military_crate', 2048, 0.012, 0.02, false], ['hanging_industrial_lamp', 1024, 0.3], ['power_box_01', 1024, 0.3], ['korean_fire_extinguisher_01', 1024, 0.3], ['Barrel_01', 1024, 0.3], ['barrel_03', 1024, 0.3], ['hand_truck', 1024, 0.3]],
    surfaces: [['concrete_floor_worn_001', 'floor', 2048], ['corrugated_iron_02', 'wall', 2048], ['metal_plate', 'deck', 1024], ['green_metal_rust', 'girder', 1024]],
    sky: ['kloofendal_48d_partly_cloudy_puresky', '1k'],
  },
};

type Files = Record<string, Record<string, Record<string, { url: string; include?: Record<string, { url: string }> }>>>;
const files = async (id: string) => await (await fetch(`https://api.polyhaven.com/files/${id}`)).json() as Files;
async function cached(path: string, url: string) {
  const out = join(CACHE, path);
  if (!existsSync(out)) {
    mkdirSync(dirname(out), { recursive: true });
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  }
  return out;
}

if (import.meta.main) {
  const [name, ...only] = process.argv.slice(2), set = SETS[name];
  if (!set) throw new Error(`usage: bun tools/fetch-scans.ts <${Object.keys(SETS).join('|')}> [name ...]`);
  const { models: MODELS, surfaces: SURFACES, sky: SKY } = set, OUT = join(import.meta.dir, '../public/assets', name);
  mkdirSync(OUT, { recursive: true });
  const wanted = (name: string) => !only.length || only.includes(name);
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

  for (const [id, size, keep, error = 0.002, lockBorder = true] of MODELS) {
    if (!wanted(id)) continue;
    // The source one step above the packed size where there is one (2k for 1024 px), so the resize has something to work with.
    const res = size >= 2048 ? '2k' : '1k';
    const g = (await files(id)).gltf?.[res]?.gltf;
    if (!g) { console.warn('no glTF for', id); continue; }
    const gltf = await cached(`${id}_${res}/${id}.gltf`, g.url);
    await Promise.all(Object.entries(g.include ?? {}).map(([p, v]) => cached(`${id}_${res}/${p}`, v.url)));
    const doc = await io.read(gltf);
    await doc.transform(
      dedup(), weld(),
      ...(keep ? [simplify({ simplifier: MeshoptSimplifier, ratio: keep, error, lockBorder })] : []),
      prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 86 }),
    );
    doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
    const out = join(OUT, `${id}.glb`);
    await io.write(out, doc);
    console.log(`${id}.glb  ${(Bun.file(out).size / 1024).toFixed(0)} KB`);
  }

  for (const [id, name, size] of SURFACES) {
    if (!wanted(name)) continue;
    const f = await files(id);
    for (const [map, kind] of [['Diffuse', 'diff'], ['nor_gl', 'nor'], ['arm', 'arm']] as const) {
      const url = f[map]?.[size >= 2048 ? '2k' : '1k']?.jpg?.url;
      if (!url) { console.warn('missing', id, map); continue; }
      const src = await cached(`${id}/${map}.jpg`, url);
      const out = await sharp(src).resize(size, size).webp({ quality: kind === 'diff' ? 84 : 88 }).toBuffer();
      writeFileSync(join(OUT, `${name}_${kind}.webp`), out);
      console.log(`${name}_${kind}.webp  ${(out.length / 1024).toFixed(0)} KB`);
    }
  }

  if (wanted('sky')) {
    const url = (await files(SKY[0])).hdri?.[SKY[1]]?.hdr?.url;
    if (!url) throw new Error(`no HDRI ${SKY[0]}`);
    const src = await cached(`${SKY[0]}_${SKY[1]}.hdr`, url);
    writeFileSync(join(OUT, 'sky.hdr'), await Bun.file(src).bytes());
    console.log(`sky.hdr  ${(Bun.file(src).size / 1024).toFixed(0)} KB`);
  }

  const credits = [...MODELS.map(([id]) => id), ...SURFACES.map(([id]) => id), SKY[0]].map(id => `https://polyhaven.com/a/${id}`);
  writeFileSync(join(OUT, 'LICENSE.txt'), `Models, surfaces and sky of ${set.title}, from Poly Haven (https://polyhaven.com), CC0 1.0 Universal.\nPacked by tools/fetch-scans.ts (textures resized to WebP, geometry meshopt-compressed).\n\n${credits.join('\n')}\n`);
}
