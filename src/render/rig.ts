import * as THREE from 'three';

/**
 * Axis-agnostic skeletal helpers. They work purely in world space (bone → child directions),
 * so they do not depend on the exporter's bone-roll conventions.
 */
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();

export type Bones = Map<string, THREE.Bone>;

/** Rotate a bone about a world-space axis. */
export function rotateWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  if (!angle) return;
  const parentQ = bone.parent!.getWorldQuaternion(qa);
  const localAxis = vc.copy(axis).applyQuaternion(parentQ.invert()).normalize();
  bone.quaternion.premultiply(qb.setFromAxisAngle(localAxis, angle));
  bone.updateMatrixWorld(true);
}

/** Rotate `bone` so the direction toward `child` points at `target` (world space). */
export function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3) {
  const origin = bone.getWorldPosition(va);
  const current = child.getWorldPosition(vb).sub(origin).normalize();
  const desired = target.clone().sub(origin).normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(current, desired);
  const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
  const parent = bone.parent!.getWorldQuaternion(qa);
  bone.quaternion.copy(parent.invert().multiply(world));
  bone.updateMatrixWorld(true);
}

/** Analytic two-bone IK for an arm, bending the elbow toward `pole`. */
export function solveArm(bones: Bones, side: 'l' | 'r', target: THREE.Vector3, pole: THREE.Vector3) {
  const upper = bones.get(`upperarm_${side}`)!, lower = bones.get(`lowerarm_${side}`)!, hand = bones.get(`hand_${side}`)!;
  const s = upper.getWorldPosition(new THREE.Vector3()), e = lower.getWorldPosition(new THREE.Vector3()), h = hand.getWorldPosition(new THREE.Vector3());
  const a = s.distanceTo(e), b = e.distanceTo(h);
  const toTarget = target.clone().sub(s);
  const d = Math.max(0.05, Math.min(toTarget.length(), a + b - 0.002));
  const dir = toTarget.normalize();
  const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const toPole = pole.clone().sub(s);
  const perp = toPole.sub(dir.clone().multiplyScalar(toPole.dot(dir))).normalize();
  const elbow = s.clone().addScaledVector(dir, cosA * a).addScaledVector(perp, sinA * a);
  aimBone(upper, lower, elbow);
  aimBone(lower, hand, s.clone().addScaledVector(dir, d));
}

/**
 * Point the hand along `forward` and roll it so the palm faces `palm` (both world space).
 * The palm normal is derived from the knuckle line, so no bone-axis knowledge is needed.
 */
export function orientHand(bones: Bones, side: 'l' | 'r', forward: THREE.Vector3, palm: THREE.Vector3) {
  const hand = bones.get(`hand_${side}`)!, middle = bones.get(`middle_01_${side}`), index = bones.get(`index_01_${side}`), pinky = bones.get(`pinky_01_${side}`);
  if (!middle || !index || !pinky) return;
  const origin = hand.getWorldPosition(new THREE.Vector3());
  aimBone(hand, middle, origin.clone().add(forward));
  const handDir = middle.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  const knuckles = pinky.getWorldPosition(new THREE.Vector3()).sub(index.getWorldPosition(new THREE.Vector3())).normalize();
  // For the right hand index→pinky × direction points out of the palm; mirrored on the left.
  const currentPalm = new THREE.Vector3().crossVectors(handDir, knuckles).multiplyScalar(side === 'r' ? 1 : -1).normalize();
  const wanted = palm.clone().sub(handDir.clone().multiplyScalar(palm.dot(handDir))).normalize();
  if (wanted.lengthSq() < 1e-6) return;
  let angle = Math.acos(Math.max(-1, Math.min(1, currentPalm.dot(wanted))));
  if (new THREE.Vector3().crossVectors(currentPalm, wanted).dot(handDir) < 0) angle = -angle;
  rotateWorld(hand, handDir, angle);
}

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
/** Curl fingers toward the palm (radians per joint); thumb wraps around the grip. */
export function curlFingers(bones: Bones, side: 'l' | 'r', curl: number, thumb: number) {
  const index = bones.get(`index_01_${side}`), pinky = bones.get(`pinky_01_${side}`), hand = bones.get(`hand_${side}`), middle = bones.get(`middle_01_${side}`);
  if (!index || !pinky || !hand || !middle) return;
  const axis = pinky.getWorldPosition(new THREE.Vector3()).sub(index.getWorldPosition(new THREE.Vector3())).normalize();
  if (side === 'l') axis.negate();
  for (const f of FINGERS) for (let j = 1; j <= 3; j++) {
    const bone = bones.get(`${f}_0${j}_${side}`);
    if (bone) rotateWorld(bone, axis, curl * (j === 1 ? 0.9 : 1.1));
  }
  const handDir = middle.getWorldPosition(new THREE.Vector3()).sub(hand.getWorldPosition(new THREE.Vector3())).normalize();
  for (let j = 1; j <= 3; j++) {
    const bone = bones.get(`thumb_0${j}_${side}`);
    if (bone) rotateWorld(bone, side === 'r' ? handDir : handDir.clone().negate(), thumb * (j === 1 ? 0.6 : 0.5));
  }
}

/** Store the current local rotations so procedural layers can restore them each frame. */
export function snapshotPose(bones: Bones) {
  const pose = new Map<string, THREE.Quaternion>();
  for (const [name, bone] of bones) pose.set(name, bone.quaternion.clone());
  return pose;
}
export function restorePose(bones: Bones, pose: Map<string, THREE.Quaternion>, filter?: (name: string) => boolean) {
  for (const [name, q] of pose) if (!filter || filter(name)) bones.get(name)!.quaternion.copy(q);
}
