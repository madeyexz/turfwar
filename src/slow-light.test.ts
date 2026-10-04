import { expect, test } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { betaVector } from './slow-light';

test('slow light uses camera-relative velocity and clamps superluminal input', () => {
  const camera = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  const b = betaVector(new Vector3(-6, 0, 0), camera, 10);
  expect(b.x).toBeCloseTo(0);
  expect(b.z).toBeCloseTo(-0.6);
  expect(betaVector(new Vector3(0, 0, 0), camera, 10).length()).toBe(0);
  expect(betaVector(new Vector3(30, 0, 0), camera, 10).length()).toBeCloseTo(0.85);
  expect(betaVector(new Vector3(-6, 0, 0), camera, 300).length()).toBeCloseTo(0.02);
});
