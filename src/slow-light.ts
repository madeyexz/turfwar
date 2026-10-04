import * as THREE from 'three';

// Camera-space velocity / c. Clamp below c to keep the approximation finite.
export function betaVector(velocity: THREE.Vector3, camera: THREE.Quaternion, c: number) {
  const beta = velocity.clone().applyQuaternion(camera.clone().invert()).divideScalar(c);
  if (beta.length() > 0.85) beta.setLength(0.85);
  return beta;
}

/**
 * Screen-space approximation inspired by MIT's A Slower Speed of Light: directional Doppler
 * tint, searchlight brightness and aberration from the lawbreaker's camera-relative velocity.
 * No retarded-time geometry, spectral rendering, or relativistic dynamics.
 */
export const SlowLightShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, beta: { value: new THREE.Vector3() }, aspect: { value: 1 }, tanHalfFov: { value: 0.637 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec3 beta;
    uniform float aspect;
    uniform float tanHalfFov;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv * 2. - 1.;
      vec3 ray = normalize(vec3(uv.x * aspect * tanHalfFov, uv.y * tanHalfFov, -1.));
      float b2 = dot(beta, beta);
      float doppler = sqrt(1. - b2) / max(.15, 1. - dot(beta, ray));
      // Approximate aberration: compress toward the direction of travel.
      vec2 warped = uv * (1. + beta.z * .28) + beta.xy * .22;
      vec3 col = texture2D(tDiffuse, clamp(warped * .5 + .5, .002, .998)).rgb;
      float shift = clamp(log(doppler), -.7, .7);
      col *= vec3(1. - shift * .65, 1. + shift * .08, 1. + shift * .8);
      col *= clamp(pow(doppler, 1.4), .45, 2.1);
      gl_FragColor = vec4(col, 1.);
    }`,
};
