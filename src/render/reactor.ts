import * as THREE from 'three';

/** The anomaly reactor at point B: a caged singularity whose field the laws rewrite. */
export class ReactorView {
  readonly group = new THREE.Group();
  readonly core: THREE.Mesh;
  private rings: THREE.Mesh[] = [];
  private coreMaterial: THREE.ShaderMaterial;
  private beam: THREE.Mesh;
  readonly light: THREE.PointLight;
  /** 0 neutral, 1 Aegis, 2 Crimson (blends the glow color). */
  owner: -1 | 0 | 1 = -1;
  private color = new THREE.Color(0x9ff6ff);

  constructor(x: number, y: number, z: number) {
    this.group.position.set(x, y, z);
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a4248, metalness: 0.8, roughness: 0.35 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x0b1416, emissive: 0x7ff6ff, emissiveIntensity: 2.2 });
    // Base collar and four caging pylons.
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.1, 0.6, 8), steel);
    collar.position.y = 2.6; collar.castShadow = true; this.group.add(collar);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.35, 6.5, 0.6), steel);
      pylon.position.set(Math.cos(a) * 2.2, 5.2, Math.sin(a) * 2.2);
      pylon.rotation.y = -a; pylon.rotation.z = 0.12 * (i % 2 ? 1 : -1);
      pylon.castShadow = true;
      this.group.add(pylon);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 5.2, 0.2), trim);
      strip.position.set(Math.cos(a) * 1.98, 5.2, Math.sin(a) * 1.98);
      strip.rotation.y = -a;
      this.group.add(strip);
    }
    this.coreMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, color: { value: this.color } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP; uniform float time;
        void main(){ vec3 p = position; float w = sin(p.y*6.0+time*3.0)*0.04 + sin(p.x*7.0-time*2.3)*0.04; p += normal*w;
        vec4 mv = modelViewMatrix*vec4(p,1.0); vN = normalize(normalMatrix*normal); vV = -mv.xyz; vP = position; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float time; uniform vec3 color; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float swirl = 0.5 + 0.5*sin(atan(vP.z, vP.x)*5.0 + vP.y*8.0 - time*4.0);
        vec3 c = mix(vec3(0.02,0.03,0.05), color*3.0, f) + color*swirl*0.35*(1.0-f);
        gl_FragColor = vec4(c, 1.0); }`,
    });
    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 5), this.coreMaterial);
    this.core.position.y = 5;
    this.group.add(this.core);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.8 + i * 0.45, 0.035, 6, 96), new THREE.MeshBasicMaterial({ color: this.color.clone().multiplyScalar(2) }));
      ring.position.y = 5;
      this.rings.push(ring); this.group.add(ring);
    }
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 60, 24, 1, true), new THREE.MeshBasicMaterial({
      color: this.color.clone().multiplyScalar(0.5), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.beam.position.y = 35;
    this.group.add(this.beam);
    this.light = new THREE.PointLight(this.color, 30, 28, 1.6);
    this.light.position.y = 5;
    this.group.add(this.light);
  }

  update(time: number, intensity = 1) {
    const target = this.owner === 0 ? new THREE.Color(0x58b6ff) : this.owner === 1 ? new THREE.Color(0xff5a4a) : new THREE.Color(0x9ff6ff);
    this.color.lerp(target, 0.05);
    this.coreMaterial.uniforms.time.value = time;
    this.rings.forEach((r, i) => {
      r.rotation.x = time * (0.6 + i * 0.25) + i;
      r.rotation.y = time * (0.4 - i * 0.2);
      (r.material as THREE.MeshBasicMaterial).color.copy(this.color).multiplyScalar(2);
    });
    this.core.scale.setScalar(1 + Math.sin(time * 2.2) * 0.04);
    (this.beam.material as THREE.MeshBasicMaterial).color.copy(this.color).multiplyScalar(0.5);
    this.light.color.copy(this.color);
    this.light.intensity = 26 * intensity + Math.sin(time * 6) * 2;
  }
}
