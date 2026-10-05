import * as THREE from 'three';
import type { Theme } from './materials';

/**
 * Sky dome: gradient atmosphere, sun glow and a small moon; alien themes add a ringed gas giant
 * hanging over the battlefield (an original nod to Auraxis skies).
 */
export class SkyView {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(theme: Theme, sunDir: THREE.Vector3) {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: theme.skyTop }, horizon: { value: theme.skyHorizon }, sunDir: { value: sunDir.clone().normalize() },
        sunColor: { value: theme.sunColor }, planetColor: { value: theme.planet ?? new THREE.Color() }, planetShown: { value: theme.planet ? 1 : 0 }, time: { value: 0 },
        planetDir: { value: new THREE.Vector3(0.55, 0.45, -0.7).normalize() }, moonDir: { value: new THREE.Vector3(-0.3, 0.52, -0.8).normalize() },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
      fragmentShader: `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 planetColor; uniform float planetShown; uniform vec3 planetDir; uniform vec3 moonDir; uniform float time;
        varying vec3 vDir;
        float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
        // Disc body lit from the sun direction; returns rgb and coverage.
        vec4 body(vec3 d, vec3 center, float radius, vec3 col, float bands){
          float c = dot(d, center); float r = acos(clamp(c, -1.0, 1.0));
          if (r > radius) return vec4(0.0);
          vec3 up = normalize(cross(center, vec3(0.0,1.0,0.0))); vec3 side = cross(up, center);
          vec2 p = vec2(dot(d - center, up), dot(d - center, side)) / radius;
          float z = sqrt(max(0.0, 1.0 - dot(p,p)));
          vec3 n = normalize(p.x*up + p.y*side + z*center*-1.0);
          float lit = clamp(dot(n, sunDir) * 0.95 + 0.08, 0.0, 1.0);
          float rim = pow(1.0 - z, 3.0) * 0.6;
          float stripes = 0.85 + 0.15*sin(p.y*bands + noise(vec3(p*6.0, 1.0))*3.0);
          float edge = smoothstep(1.0, 0.96, length(p));
          return vec4(col * stripes * lit + col * rim * 0.5, edge);
        }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 col = mix(horizon, top, pow(max(h, 0.0), 0.55));
          col = mix(col, horizon * 0.85, smoothstep(0.0, -0.2, d.y));
          // High thin clouds.
          float cl = noise(d * vec3(4.0, 12.0, 4.0) + vec3(time*0.01, 0.0, 0.0)) * noise(d*9.0);
          col = mix(col, mix(horizon, vec3(1.0), 0.5), smoothstep(0.25, 0.6, cl) * smoothstep(0.02, 0.25, d.y) * 0.35);
          // Gas giant with ring, then the moon.
          vec4 g = body(d, planetDir, 0.2, planetColor, 18.0) * planetShown;
          float ringPlane = dot(d - planetDir * dot(d, planetDir), normalize(vec3(0.2, 1.0, 0.25)));
          float ringDist = length(d - planetDir);
          float ring = smoothstep(0.008, 0.0, abs(ringPlane)) * smoothstep(0.26, 0.29, ringDist) * smoothstep(0.46, 0.38, ringDist) * planetShown;
          col = mix(col, planetColor * 1.2, ring * 0.45 * (1.0 - g.a));
          col = mix(col, g.rgb + col * 0.15, g.a * 0.92);
          vec4 m = body(d, moonDir, 0.06, vec3(0.85, 0.85, 0.9), 4.0);
          col = mix(col, m.rgb + col * 0.2, m.a * 0.9);
          // Sun.
          float s = max(dot(d, sunDir), 0.0);
          col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(time: number, camera: THREE.Camera) {
    this.material.uniforms.time.value = time;
    this.mesh.position.copy(camera.position);
  }
}
