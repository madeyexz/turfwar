// Development-only asset inspector: /dev/viewer.html?model=/assets/x.glb&anim=Idle_Loop&cam=3,1.6,3&target=0,1,0
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(devicePixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(params.get('bg') ?? '#56606a');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const sun = new THREE.DirectionalLight(0xffffff, 2.5); sun.position.set(3, 6, 4); sun.castShadow = true; scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x777777 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 200);
const [cx, cy, cz] = (params.get('cam') ?? '2.5,1.6,3').split(',').map(Number); camera.position.set(cx, cy, cz);
const controls = new OrbitControls(camera, renderer.domElement);
const [tx, ty, tz] = (params.get('target') ?? '0,1,0').split(',').map(Number); controls.target.set(tx, ty, tz); controls.update();
const clock = new THREE.Clock(); let mixer: THREE.AnimationMixer | undefined;
const info = document.getElementById('info')!;
const models = (params.get('model') ?? '').split('|').filter(Boolean);
const spacing = Number(params.get('spacing') ?? 0);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const extraClips: THREE.AnimationClip[] = [];
const animsUrl = params.get('anims');
const start = () => models.forEach((url, i) => loader.load(url, gltf => {
  gltf.animations.push(...extraClips);
  const root = gltf.scene; root.position.x = (i - (models.length - 1) / 2) * spacing;
  const only = params.get('only');
  if (only) for (const c of root.children) c.visible = c.name === only;
  if (params.get('grid')) { const g = new THREE.GridHelper(2, 40, 0xff0000, 0x333333); g.rotation.x = Math.PI / 2; scene.add(g, new THREE.AxesHelper(0.5)); ground.visible = false; }
  if (params.get('scale')) root.scale.setScalar(Number(params.get('scale')));
  root.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  scene.add(root);
  const anim = params.get('anim');
  if (gltf.animations.length && anim) {
    mixer = new THREE.AnimationMixer(root);
    const clip = THREE.AnimationClip.findByName(gltf.animations, anim);
    if (clip) { const a = mixer.clipAction(clip); a.play(); if (params.get('t')) { a.time = Number(params.get('t')); a.paused = true; } }
  }
  const box = new THREE.Box3(); root.traverseVisible(o => { if ((o as THREE.Mesh).isMesh) box.expandByObject(o); });
  info.textContent += `${url}\n size ${box.getSize(new THREE.Vector3()).toArray().map(v => v.toFixed(2))} min ${box.min.toArray().map(v => v.toFixed(2))}\n anims ${gltf.animations.map(a => a.name).join(', ')}\n`;
  (window as any).__ready = ((window as any).__ready ?? 0) + 1;
}, undefined, e => { info.textContent += 'ERROR ' + e; console.error(e); }));
if (animsUrl) loader.load(animsUrl, g => { extraClips.push(...g.animations); start(); }, undefined, e => { info.textContent += 'ERROR anims ' + e; console.error(e); }); else start();
renderer.setAnimationLoop(() => { mixer?.update(clock.getDelta()); renderer.render(scene, camera); });
