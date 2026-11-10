/**
 * Builds public/assets/operator.glb: the third-person soldier as a textured PBR model, on the crew's
 * skeleton, so the clips (soldier-anims.glb) and the IK in src/render/soldier.ts drive it unchanged.
 * Two roots share the mesh: `Swat` (navy uniform) and `Militia` (the source's camouflage).
 *
 * Source (not committed): "Soldier" from https://grab3d.com (CC0 1.0; AI-assisted: its base mesh and
 * textures were generated with Meshy, then rigged). Download the rigged GLB into its own directory:
 *
 *   OPERATOR_SRC=/path/soldier-rigged.glb bun tools/import-operator.ts
 *   then `bun tools/make-model-textures.ts` (moves the textures out to assets/modeltex as KTX2).
 *
 * The skeleton comes from public/assets/soldiers.glb (tools/import-modular.ts). The source has other
 * bones, an A-pose and other proportions, so its mesh is posed onto the crew's bind pose: each source
 * bone moves to a target point, turns to the crew bone's direction and stretches along its length;
 * then each vertex takes the crew joints of its source bones. The glove's fingers are
 * curled to a grip here (the crew's clips do not move fingers).
 */
import { Document, NodeIO, type Accessor, type Node } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, weld } from '@gltf-transform/functions';
import { createCanvas } from '@napi-rs/canvas';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { join } from 'node:path';

const SRC = process.env.OPERATOR_SRC ?? '/tmp/operator-src/soldier-rigged.glb';
const ASSETS = join(import.meta.dir, '../public/assets');
const TRIS = 14000, SIZE = 1024;

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

// ---- The crew skeleton and its bind pose (metres, origin at the hips, facing +Z, T-pose) ------------
const crew = await io.read(join(ASSETS, 'soldiers.glb'));
const crewRoot = crew.getRoot().listScenes()[0].listChildren().find(n => n.getName() === 'Swat')!;
const crewSkin = crew.getRoot().listSkins().find(s => s.listJoints().some(j => { let a: Node | null = j; while (a && a !== crewRoot) a = a.getParentNode() as Node | null; return !!a; }))!;
const crewJoints = crewSkin.listJoints().map(j => j.getName());
// soldiers.glb is quantized: its inverse bind matrices also undo that scale. Take it out again.
const ibmIn = crewSkin.getInverseBindMatrices()!;
const q = new Vector3().setFromMatrixColumn(new Matrix4().fromArray(ibmIn.getElement(0, [])), 0).length();
const ibms = crewJoints.map((_, i) => new Matrix4().fromArray(ibmIn.getElement(i, [])).multiply(new Matrix4().makeScale(1 / q, 1 / q, 1 / q)));
const bindPos = new Map(crewJoints.map((name, i) => [name, new Vector3().setFromMatrixPosition(ibms[i].clone().invert())]));
const at = (name: string) => bindPos.get(name)!.clone();
const GROUND = at('pelvis').y;

// ---- The source: fewer triangles, its bones and world bind matrices ---------------------------------
const src = await io.read(SRC);
const srcNode = src.getRoot().listNodes().find(n => n.getMesh())!;
const srcSkin = srcNode.getSkin()!;
const prim = srcNode.getMesh()!.listPrimitives()[0];
const full = { uv: prim.getAttribute('TEXCOORD_0')!.clone(), joints: prim.getAttribute('JOINTS_0')!.clone(), weights: prim.getAttribute('WEIGHTS_0')!.clone(), indices: prim.getIndices()!.clone() };
const before = prim.getIndices()!.getCount() / 3;
await src.transform(weld());
simplifyAcrossSeams();
const srcJoints = srcSkin.listJoints();
const sName = srcJoints.map(j => j.getName());
const sWorld = srcJoints.map(j => new Matrix4().fromArray(j.getWorldMatrix()));
const sPos = new Map(sName.map((n, i) => [n, new Vector3().setFromMatrixPosition(sWorld[i])]));
/** Mesh space to metric world at rest, per source joint. */
const sRest = srcJoints.map((_, i) => sWorld[i].clone().multiply(new Matrix4().fromArray(srcSkin.getInverseBindMatrices()!.getElement(i, []))));

/**
 * The source's texture layout is cut into many small charts, and a simplifier that keeps every chart's
 * border stops at about 25 000 triangles. So: simplify the surface alone (vertices joined by position),
 * then give each new triangle the texture coordinates of ONE chart; a corner that chart does not reach
 * takes the chart's nearest vertex (a sliver of stretched texture along some seams, unseen in the pattern).
 */
function simplifyAcrossSeams() {
  const P = prim.getAttribute('POSITION')!, idx = prim.getIndices()!;
  const count = P.getCount(), p = [0, 0, 0];
  // Vertices by position.
  const ids = new Map<string, number>(), posId = new Uint32Array(count), unique: number[] = [], at: number[][] = [];
  for (let i = 0; i < count; i++) {
    P.getElement(i, p);
    const key = `${p[0]},${p[1]},${p[2]}`;
    let id = ids.get(key);
    if (id === undefined) { id = at.length; ids.set(key, id); unique.push(p[0], p[1], p[2]); at.push([]); }
    posId[i] = id; at[id].push(i);
  }
  // Charts: vertices joined through triangles.
  const chart = new Uint32Array(count).map((_, i) => i);
  const find = (i: number) => { while (chart[i] !== i) { chart[i] = chart[chart[i]]; i = chart[i]; } return i; };
  const tris = idx.getCount();
  for (let t = 0; t < tris; t += 3) { const a = find(idx.getScalar(t)); chart[find(idx.getScalar(t + 1))] = a; chart[find(idx.getScalar(t + 2))] = a; }
  const members = new Map<number, number[]>();
  for (let i = 0; i < count; i++) { const c = find(i); let m = members.get(c); if (!m) members.set(c, m = []); m.push(i); }
  const surface = new Uint32Array(tris);
  for (let t = 0; t < tris; t++) surface[t] = posId[idx.getScalar(t)];
  // The face shows every stretched texel: on the head and neck the chart borders stay as they are.
  const names = srcSkin.listJoints().map(j => j.getName()), J = prim.getAttribute('JOINTS_0')!, W = prim.getAttribute('WEIGHTS_0')!;
  const lock = new Uint8Array(at.length), js = [0, 0, 0, 0], ws = [0, 0, 0, 0];
  at.forEach((vs, id) => {
    if (new Set(vs.map(find)).size < 2) return;
    J.getElement(vs[0], js); W.getElement(vs[0], ws);
    let h = 0, sum = 0;
    for (let k = 0; k < 4; k++) { sum += ws[k]; if (/^(Head|neck|head_end|headfront)$/.test(names[js[k]])) h += ws[k]; }
    if (h > sum * 0.5) lock[id] = 1;
  });
  MeshoptSimplifier.useExperimentalFeatures = true; // the vertex lock
  const [out] = MeshoptSimplifier.simplifyWithAttributes(surface, new Float32Array(unique), 3, new Float32Array(at.length), 1, [0], lock, TRIS * 3, 0.05);
  const nearest = (c: number, id: number) => {
    let best = -1, d = Infinity;
    const x = unique[id * 3], y = unique[id * 3 + 1], z = unique[id * 3 + 2], q = [0, 0, 0];
    for (const i of members.get(c)!) { P.getElement(i, q); const e = (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2; if (e < d) { d = e; best = i; } }
    return best;
  };
  // New vertices: a position (with its normal and skin) and the vertex whose texture coordinates it shows.
  const pairs = new Map<string, number>(), from: [number, number][] = [], indices = new Uint32Array(out.length);
  let stretched = 0;
  for (let t = 0; t < out.length; t += 3) {
    const corners = [out[t], out[t + 1], out[t + 2]];
    const votes = new Map<number, number>();
    for (const id of corners) for (const c of new Set(at[id].map(find))) votes.set(c, (votes.get(c) ?? 0) + 1);
    const best = [...votes].sort((a, b) => b[1] - a[1] || members.get(b[0])!.length - members.get(a[0])!.length)[0];
    if (best[1] < 3) stretched++;
    corners.forEach((id, k) => {
      const uv = at[id].find(i => find(i) === best[0]) ?? nearest(best[0], id);
      const key = `${id}:${uv}`;
      let v = pairs.get(key);
      if (v === undefined) { v = from.length; pairs.set(key, v); from.push([at[id][0], uv]); }
      indices[t + k] = v;
    });
  }
  const buffer = src.getRoot().listBuffers()[0];
  for (const semantic of prim.listSemantics()) {
    const a = prim.getAttribute(semantic)!, size = a.getElementSize(), array = new (a.getArray()!.constructor as Float32ArrayConstructor)(from.length * size);
    const b = src.createAccessor().setType(a.getType()).setArray(array).setNormalized(a.getNormalized()).setBuffer(buffer), e: number[] = [];
    from.forEach(([v, uv], i) => b.setElement(i, a.getElement(semantic === 'TEXCOORD_0' ? uv : v, e)));
    prim.setAttribute(semantic, b);
  }
  prim.setIndices(src.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
  console.log(`simplified: ${members.size} charts, ${out.length / 3} triangles, ${stretched} across a seam`);
}

// ---- Where each source bone goes ---------------------------------------------------------------------
/** The source torso (hip joints to neck) is longer than the crew's: its joints keep their share of the height. */
const torso = (name: string) => {
  const y0 = sPos.get('LeftUpLeg')!.y, y1 = sPos.get('neck')!.y, t = (sPos.get(name)!.y - y0) / (y1 - y0);
  const p = sPos.get(name)!;
  return new Vector3(0, at('thigh_l').y + t * (at('neck_01').y - at('thigh_l').y), p.z + at('neck_01').z - sPos.get('neck')!.z);
};
const ankle = (side: 'l' | 'r', name: string) => { const f = at(`foot_${side}`); return new Vector3(f.x, GROUND + sPos.get(name)!.y, f.z - 0.03); };
interface Bone { target: Vector3; to: Record<string, number>; child?: string; like?: string; turn?: string; scale?: number }
/** The glove is a little larger than the source's (it reads better at range); REACH would move its wrist past the crew's wrist joint. */
const REACH = 0, HAND = 1.1, ROLL = -Math.PI / 2;
const BONES: Record<string, Bone> = {
  Hips: { target: torso('Hips'), to: { Hips: 1 }, child: 'Spine02' },
  Spine02: { target: torso('Spine02'), to: { spine_02: 1 }, child: 'Spine01' },
  Spine01: { target: torso('Spine01'), to: { spine_02: 0.5, spine_03: 0.5 }, child: 'Spine' },
  Spine: { target: torso('Spine'), to: { spine_03: 1 }, child: 'neck' },
  neck: { target: at('neck_01'), to: { neck_01: 1 }, child: 'Head' },
  Head: { target: at('Head'), to: { Head: 1 } },
  head_end: { target: at('Head'), to: { Head: 1 }, like: 'Head' },
  headfront: { target: at('Head'), to: { Head: 1 }, like: 'Head' },
};
for (const [S, s] of [['Left', 'l'], ['Right', 'r']] as const) {
  const arm = at(`upperarm_${s}`);
  Object.assign(BONES, {
    [`${S}Shoulder`]: { target: new Vector3(Math.sign(arm.x) * 0.03, arm.y, arm.z), to: { [`clavicle_${s}`]: 1 }, child: `${S}Arm` },
    [`${S}Arm`]: { target: arm, to: { [`upperarm_${s}`]: 1 }, child: `${S}ForeArm` },
    [`${S}ForeArm`]: { target: at(`lowerarm_${s}`), to: { [`lowerarm_${s}`]: 1 }, child: `${S}Hand` },
    [`${S}Hand`]: { target: at(`hand_${s}`).add(new Vector3(Math.sign(arm.x) * REACH, 0, 0)), to: { [`hand_${s}`]: 1 }, turn: `${S}ForeArm`, scale: HAND },
    [`${S}UpLeg`]: { target: at(`thigh_${s}`), to: { [`thigh_${s}`]: 1 }, child: `${S}Leg` },
    [`${S}Leg`]: { target: at(`calf_${s}`), to: { [`calf_${s}`]: 1 }, child: `${S}Foot` },
    [`${S}Foot`]: { target: ankle(s, `${S}Foot`), to: { [`foot_${s}`]: 1 } },
    [`${S}ToeBase`]: { target: ankle(s, `${S}Foot`), to: { [`foot_${s}`]: 1 }, like: `${S}Foot` },
  } satisfies Record<string, Bone>);
}

/** A source bone's move: metric rest space to the crew's bind space. */
function poseOf(name: string): Matrix4 {
  const bone = BONES[name];
  if (bone.like) {
    // Rigid with another bone (the hand with the forearm, the toes with the foot).
    const m = poseOf(bone.like);
    return m;
  }
  const from = sPos.get(name)!;
  const m = new Matrix4().makeTranslation(-from.x, -from.y, -from.z);
  if (bone.turn) m.premultiply(new Matrix4().makeRotationFromQuaternion(turnOf(bone.turn))).premultiply(new Matrix4().makeScale(bone.scale!, bone.scale!, bone.scale!));
  if (bone.child) {
    const a = sPos.get(bone.child)!.clone().sub(from), la = a.length(), lb = BONES[bone.child].target.distanceTo(bone.target);
    a.normalize();
    // Stretch along the bone, then turn it onto the crew bone's direction.
    const k = lb / la - 1;
    const stretch = new Matrix4().set(
      1 + k * a.x * a.x, k * a.x * a.y, k * a.x * a.z, 0,
      k * a.y * a.x, 1 + k * a.y * a.y, k * a.y * a.z, 0,
      k * a.z * a.x, k * a.z * a.y, 1 + k * a.z * a.z, 0,
      0, 0, 0, 1);
    m.premultiply(stretch).premultiply(new Matrix4().makeRotationFromQuaternion(turnOf(name)));
  }
  return m.premultiply(new Matrix4().makeTranslation(bone.target.x, bone.target.y, bone.target.z));
}
/** The turn that puts a source bone on its crew bone's direction. */
function turnOf(name: string) {
  const bone = BONES[name], a = sPos.get(bone.child!)!.clone().sub(sPos.get(name)!).normalize(), b = BONES[bone.child!].target.clone().sub(bone.target).normalize();
  return new Quaternion().setFromUnitVectors(a, b);
}
const pose = sName.map((n, i) => poseOf(n).multiply(sRest[i]));

// ---- Bake the mesh into the crew's bind space, with the crew's joints --------------------------------
const P = prim.getAttribute('POSITION')!, N = prim.getAttribute('NORMAL')!, J = prim.getAttribute('JOINTS_0')!, W = prim.getAttribute('WEIGHTS_0')!, UV = prim.getAttribute('TEXCOORD_0')!;
const count = P.getCount();
const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), jnt = new Uint16Array(count * 4), wgt = new Float32Array(count * 4);
const jointIndex = new Map(crewJoints.map((n, i) => [n, i]));
const v = new Vector3(), n = new Vector3(), sum = new Vector3(), nsum = new Vector3(), t4 = [0, 0, 0, 0], w4 = [0, 0, 0, 0];
for (let i = 0; i < count; i++) {
  P.getElement(i, t4); v.set(t4[0], t4[1], t4[2]);
  N.getElement(i, t4); n.set(t4[0], t4[1], t4[2]);
  const js = J.getElement(i, [0, 0, 0, 0]); W.getElement(i, w4);
  const total = w4[0] + w4[1] + w4[2] + w4[3];
  sum.set(0, 0, 0); nsum.set(0, 0, 0);
  const out = new Map<number, number>();
  for (let k = 0; k < 4; k++) {
    const w = w4[k] / total;
    if (w <= 0) continue;
    sum.addScaledVector(v.clone().applyMatrix4(pose[js[k]]), w);
    nsum.addScaledVector(n.clone().transformDirection(pose[js[k]]), w);
    for (const [name, share] of Object.entries(BONES[sName[js[k]]].to)) { const j = jointIndex.get(name)!; out.set(j, (out.get(j) ?? 0) + w * share); }
  }
  // The crew's clips do not move fingers: curl the glove's four fingers here, at the knuckles and the middle joints, to a grip.
  for (const s of ['l', 'r']) {
    const share = out.get(jointIndex.get(`hand_${s}`)!) ?? 0;
    if (share <= 0) continue;
    const dir = Math.sign(at(`hand_${s}`).x), wrist = at(`hand_${s}`).add(new Vector3(dir * REACH, 0, 0));
    // The posed glove has its thumb down: roll it (the cuff twists with it) so the palm is down and the thumb in front, as on the crew's hand.
    const roll = new Matrix4().makeTranslation(0, wrist.y, wrist.z).multiply(new Matrix4().makeRotationX(ROLL * share)).multiply(new Matrix4().makeTranslation(0, -wrist.y, -wrist.z));
    sum.applyMatrix4(roll); nsum.transformDirection(roll);
    if (share < 0.5) continue;
    // The posed hand runs along X, palm down: knuckles at about 0.085 m of the source's hand, fingertips at about 0.19 m. The thumb is in front (+Z).
    if (sum.z - wrist.z > 0.045 * HAND && (sum.x - wrist.x) * dir < 0.12 * HAND) continue;
    for (const [joint, angle] of [[0.125, 1.1], [0.085, 0.9]]) {
      const knuckle = joint * HAND, f = Math.min(1, Math.max(0, ((sum.x - wrist.x) * dir - knuckle + 0.01) / 0.02));
      if (f <= 0) continue;
      const turn = new Matrix4().makeTranslation(wrist.x + dir * knuckle, wrist.y, 0).multiply(new Matrix4().makeRotationZ(-dir * angle * f)).multiply(new Matrix4().makeTranslation(-wrist.x - dir * knuckle, -wrist.y, 0));
      sum.applyMatrix4(turn); nsum.transformDirection(turn);
    }
  }
  const top = [...out].filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 4), norm = top.reduce((s, e) => s + e[1], 0);
  top.forEach(([j, w], k) => { jnt[i * 4 + k] = j; wgt[i * 4 + k] = w / norm; });
  nsum.normalize();
  pos.set([sum.x, sum.y, sum.z], i * 3); nor.set([nsum.x, nsum.y, nsum.z], i * 3);
}

// ---- Textures: the camouflage as it is (Militia) and a navy uniform (SWAT) ---------------------------
const mat = prim.getMaterial()!;
const image = async (bytes: Uint8Array) => sharp(Buffer.from(bytes)).resize(SIZE, SIZE);
const color = await (await image(mat.getBaseColorTexture()!.getImage()!)).removeAlpha().raw().toBuffer();
// Skin shows only on the head and neck: mark their triangles in UV space (from the full mesh), then pick skin by colour.
const mask = createCanvas(SIZE, SIZE), ctx = mask.getContext('2d');
ctx.fillStyle = ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
{
  const headJoints = new Set(['Head', 'neck', 'head_end', 'headfront'].map(nm => sName.indexOf(nm)));
  const isHead = (i: number) => { const js = full.joints.getElement(i, [0, 0, 0, 0]), ws = full.weights.getElement(i, [0, 0, 0, 0]); let h = 0, s = 0; for (let k = 0; k < 4; k++) { s += ws[k]; if (headJoints.has(js[k])) h += ws[k]; } return h > s * 0.5; };
  const uv = [0, 0];
  for (let t = 0; t < full.indices.getCount(); t += 3) {
    const tri = [full.indices.getScalar(t), full.indices.getScalar(t + 1), full.indices.getScalar(t + 2)];
    if (!tri.every(isHead)) continue;
    ctx.beginPath();
    // Charts lie outside 0..1 too (the texture repeats).
    full.uv.getElement(tri[0], uv);
    const ou = Math.floor(uv[0]), ov = Math.floor(uv[1]);
    tri.forEach((i, k) => { full.uv.getElement(i, uv); const x = (uv[0] - ou) * SIZE, y = (uv[1] - ov) * SIZE; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.fill(); ctx.stroke();
  }
}
// Simplified triangles also sample the gutters round the head's charts: widen the mask.
const head = await sharp(Buffer.from(ctx.getImageData(0, 0, SIZE, SIZE).data.buffer), { raw: { width: SIZE, height: SIZE, channels: 4 } }).blur(5).linear(8, 0).raw().toBuffer();
// Skin by colour, then closed over the small dark parts it surrounds (brows, eyes, nostrils).
const raw = Buffer.alloc(SIZE * SIZE);
for (let i = 0; i < SIZE * SIZE; i++) { const r = color[i * 3], g = color[i * 3 + 1], b = color[i * 3 + 2]; if (head[i * 4] > 127 && r > g * 1.12 && g > b * 1.05 && r > 70) raw[i] = 255; }
const skin = await sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 1 } }).blur(6).toColourspace('b-w').raw().toBuffer();
const swat = Buffer.alloc(color.length);
for (let i = 0; i < SIZE * SIZE; i++) {
  const r = color[i * 3], g = color[i * 3 + 1], b = color[i * 3 + 2];
  if (head[i * 4] > 127 && skin[i] > 45 && r > g) { swat[i * 3] = r; swat[i * 3 + 1] = g; swat[i * 3 + 2] = b; continue; }
  // Cloth and gear: the pattern's brightness in the SWAT side's navy.
  const l = (0.3 * r + 0.55 * g + 0.15 * b) / 255, d = Math.pow(l, 1.25);
  swat[i * 3] = Math.min(255, d * 150); swat[i * 3 + 1] = Math.min(255, d * 185); swat[i * 3 + 2] = Math.min(255, d * 285);
}
const webp = (s: sharp.Sharp) => s.webp({ quality: 92 }).toBuffer();
const textures = {
  militia: await webp(sharp(color, { raw: { width: SIZE, height: SIZE, channels: 3 } })),
  swat: await webp(sharp(swat, { raw: { width: SIZE, height: SIZE, channels: 3 } })),
  normal: await webp(await image(mat.getNormalTexture()!.getImage()!)),
  orm: await webp(await image(mat.getMetallicRoughnessTexture()!.getImage()!)),
};

// ---- Write: two roots, each with the crew's bones, sharing the mesh data -----------------------------
const doc = new Document();
const buffer = doc.createBuffer();
const scene = doc.createScene('Scene');
const acc = (type: Accessor.Type, array: Float32Array | Uint16Array | Uint32Array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const tex = (name: string, bytes: Buffer) => doc.createTexture(name).setImage(new Uint8Array(bytes)).setMimeType('image/webp');
const normalTex = tex('T_Operator_Normal', textures.normal), ormTex = tex('T_Operator_ORM', textures.orm);
const attrs = {
  POSITION: acc('VEC3', pos), NORMAL: acc('VEC3', nor), TEXCOORD_0: acc('VEC2', new Float32Array(UV.getArray()!)),
  JOINTS_0: acc('VEC4', jnt), WEIGHTS_0: acc('VEC4', wgt),
};
const indices = acc('SCALAR', new Uint32Array(prim.getIndices()!.getArray()!));
const ibm = acc('MAT4', new Float32Array(ibms.flatMap(m => m.toArray())));
for (const [name, colorBytes] of [['Swat', textures.swat], ['Militia', textures.militia]] as const) {
  const material = doc.createMaterial(`Operator${name}`)
    .setBaseColorTexture(tex(`T_Operator_${name}_BaseColor`, colorBytes)).setNormalTexture(normalTex)
    .setMetallicRoughnessTexture(ormTex).setRoughnessFactor(1).setMetallicFactor(1);
  const p = doc.createPrimitive().setMaterial(material).setIndices(indices);
  for (const [semantic, a] of Object.entries(attrs)) p.setAttribute(semantic, a);
  const bones = new Map<string, Node>();
  const copy = (node: Node): Node => {
    const c = doc.createNode(node.getName()).setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale());
    bones.set(node.getName(), c);
    for (const k of node.listChildren()) if (!k.getMesh()) c.addChild(copy(k));
    return c;
  };
  const root = copy(crewRoot).setName(name);
  const skin = doc.createSkin().setInverseBindMatrices(ibm);
  for (const j of crewJoints) skin.addJoint(bones.get(j)!);
  bones.get('CharacterArmature')!.addChild(doc.createNode('Soldier').setMesh(doc.createMesh('Soldier').addPrimitive(p)).setSkin(skin));
  scene.addChild(root);
}
await doc.transform(quantize({ quantizeWeight: 8, quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(join(ASSETS, 'operator.glb'), doc);
console.log(`wrote operator.glb: ${before} → ${indices.getCount() / 3} triangles, ${count} vertices`);
