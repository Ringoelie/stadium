import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { makeRng, fbm } from './rng.js';

export const SUN_DIR = new THREE.Vector3(-0.28, 0.52, 0.81).normalize();

export function buildLights(scene) {
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x8a8068, 1.2);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dc, 3.2);
  sun.position.copy(SUN_DIR).multiplyScalar(300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const c = sun.shadow.camera;
  c.left = -160; c.right = 160; c.top = 160; c.bottom = -160; c.near = 10; c.far = 700;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  scene.add(sun); scene.add(sun.target);
  return { hemi, sun };
}

export function buildSky(scene) {
  const sky = new SkyMesh();
  sky.scale.setScalar(20000);
  sky.turbidity.value = 4.5; sky.rayleigh.value = 1.4;
  sky.mieCoefficient.value = 0.004; sky.mieDirectionalG.value = 0.82;
  sky.cloudCoverage.value = 0.35; sky.cloudDensity.value = 0.5;
  sky.sunPosition.value.copy(SUN_DIR);
  sky.material.fog = false;
  scene.add(sky);
  scene.fog = new THREE.Fog(0xb9c9d6, 900, 9000);
  return sky;
}

// Aburrá valley: runs north-south (along X) with steep slopes east and west.
export function terrainHeight(x, z) {
  const bend = 300 * Math.sin(x / 2600);
  const d = Math.abs(z - bend);
  const valley = 1500 + 250 * Math.sin(x / 1300 + 1);
  let h = d > valley ? Math.pow((d - valley) / 3200, 0.8) * 1100 : 0;
  h += fbm(x / 900, z / 900, 5) * 380 * Math.min(1, Math.max(0, (d - valley + 400) / 1200));
  const ends = Math.abs(x) > 5000 ? (Math.abs(x) - 5000) * 0.15 : 0;
  return h + ends - 2;
}

function buildTerrain(group) {
  const size = 16000, seg = 400;
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  const green = new THREE.Color(0x46703a), dark = new THREE.Color(0x2f5229), brick = new THREE.Color(0x7f6454), urban = new THREE.Color(0x8b8278);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const h = terrainHeight(x, z);
    p.setY(i, h);
    const n = fbm(x / 140, z / 140, 3);
    if (h < 5) c.copy(urban).lerp(brick, n * 0.5);
    else if (h < 420) c.copy(brick).lerp(urban, n * 0.4).lerp(green, Math.min(1, Math.max(0, (h - 90) / 260 + (n - 0.5) * 1.2)));
    else c.copy(green).lerp(dark, n);
    c.toArray(colors, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  m.receiveShadow = true; m.name = 'terrain';
  group.add(m);
}

function buildGround(group) {
  // Plaza and green areas of the Unidad Deportiva around the stadium
  const g = new THREE.PlaneGeometry(1400, 1400, 140, 140);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, colors = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
    const n = fbm(x / 30, z / 30, 3);
    if (r < 125) c.setHex(0x9d9990).offsetHSL(0, 0, (n - 0.5) * 0.05);
    else if (r < 520) c.setHex(0x55803d).offsetHSL(0, 0, (n - 0.5) * 0.12);
    else c.setHex(0x8d7f73).lerp(new THREE.Color(0x55803d), Math.max(0, (650 - r) / 130));
    c.toArray(colors, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  m.position.y = -0.02; m.receiveShadow = true; m.name = 'ground';
  group.add(m);
}

const BRICK = [0xa0522d, 0x9c5a3c, 0xb0643e, 0x8e4a2e, 0xc2b8a8, 0xd8d2c6];
function buildCity(group, rng) {
  const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
  const mats = BRICK.map((hx) => new THREE.MeshStandardMaterial({ color: hx, roughness: 0.9 }));
  let placed = 0, tries = 0;
  while (placed < 900 && tries < 20000) {
    tries++;
    const a = rng() * Math.PI * 2, r = 560 + Math.pow(rng(), 0.7) * 1100;
    const x = Math.cos(a) * r * 1.35, z = Math.sin(a) * r;
    if (terrainHeight(x, z) > 3) continue;
    // keep the metro corridor clear
    if (Math.abs(x + 230) < 30) continue;
    const tall = rng() < 0.08;
    const w = 10 + rng() * 22, d = 10 + rng() * 22, h = tall ? 45 + rng() * 70 : 7 + rng() * 18;
    const m = new THREE.Mesh(box, mats[tall ? 4 + (placed % 2) : placed % 4]);
    m.scale.set(tall ? w + 8 : w, h, tall ? d + 8 : d); m.position.set(x, 0, z); m.rotation.y = rng() * Math.PI;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    placed++;
  }
}

function buildTrees(group, rng) {
  const trunkG = new THREE.CylinderGeometry(0.25, 0.35, 4, 7); trunkG.translate(0, 2, 0);
  const crownG = new THREE.IcosahedronGeometry(3, 1);
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 1 });
  const crownMs = [0x3e6e2e, 0x4b7d34, 0x2f5e27].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
  let placed = 0;
  while (placed < 320) {
    const a = rng() * Math.PI * 2, r = 125 + rng() * 380;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x + 230) < 20) continue;
    const t = new THREE.Mesh(trunkG, trunkM);
    t.position.set(x, 0, z); t.castShadow = true;
    const s = 0.8 + rng() * 0.7;
    t.scale.setScalar(s);
    const cr = new THREE.Mesh(crownG, crownMs[placed % 3]);
    cr.position.set(x, 5.2 * s, z); cr.scale.set(s, s * 0.85, s); cr.castShadow = true; cr.receiveShadow = true;
    group.add(t, cr);
    placed++;
  }
}

// Metro de Medellín, línea B: elevated viaduct next to Estadio station.
function buildMetro(group) {
  const concrete = new THREE.MeshStandardMaterial({ color: 0xbdb8ad, roughness: 0.9 });
  const beamG = new THREE.BoxGeometry(8, 1.6, 1); // unit length along z scaled
  const deck = new THREE.Mesh(new THREE.BoxGeometry(9, 1.6, 2400), concrete);
  deck.position.set(-230, 11, 0); deck.castShadow = true; deck.receiveShadow = true;
  group.add(deck);
  for (let z = -1200; z <= 1200; z += 30) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(2, 10.2, 2), concrete);
    p.position.set(-230, 5.1, z); p.castShadow = true;
    group.add(p);
  }
  const st = new THREE.Mesh(new THREE.BoxGeometry(22, 8, 110), new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.8 }));
  st.position.set(-230, 14.5, 60); st.castShadow = true; group.add(st);
  const roofSt = new THREE.Mesh(new THREE.BoxGeometry(26, 1, 120), new THREE.MeshStandardMaterial({ color: 0x7d8a94, roughness: 0.5, metalness: 0.5 }));
  roofSt.position.set(-230, 19, 60); group.add(roofSt);
  // train (3 cars)
  const train = new THREE.Group();
  const carM = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, metalness: 0.3 });
  const stripeM = new THREE.MeshStandardMaterial({ color: 0x0b8a3e, roughness: 0.5 });
  const winM = new THREE.MeshStandardMaterial({ color: 0x1a2530, roughness: 0.15, metalness: 0.6 });
  for (let i = 0; i < 3; i++) {
    const car = new THREE.Mesh(new THREE.BoxGeometry(2.9, 3.4, 22), carM); car.position.set(1.8, 13.5, i * 23); car.castShadow = true; train.add(car);
    const s = new THREE.Mesh(new THREE.BoxGeometry(2.95, 0.4, 22), stripeM); s.position.set(1.8, 12.6, i * 23); train.add(s);
    const w = new THREE.Mesh(new THREE.BoxGeometry(2.96, 1.1, 20), winM); w.position.set(1.8, 14.2, i * 23); train.add(w);
  }
  train.position.x = -230;
  train.userData.dynamic = true;
  group.add(train);
  return {
    update(t) { train.position.z = ((t * 18) % 2200) - 1100; },
  };
}

// Coliseo Iván de Bedout and other sports venues of the Unidad Deportiva
function buildVenues(group) {
  const roofM = new THREE.MeshStandardMaterial({ color: 0xd0d5d8, roughness: 0.5, metalness: 0.4 });
  const wallM = new THREE.MeshStandardMaterial({ color: 0xe6e0d4, roughness: 0.9 });
  const add = (x, z, rx, rz, h) => {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, h, 40), wallM);
    w.scale.set(rx, 1, rz); w.position.set(x, h / 2, z); w.castShadow = true; w.receiveShadow = true; group.add(w);
    const r = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 12, 0, Math.PI * 2, 0, Math.PI / 2), roofM);
    r.scale.set(rx * 1.02, h * 0.45, rz * 1.02); r.position.set(x, h, z); r.castShadow = true; group.add(r);
  };
  add(-40, 185, 45, 35, 16);
  add(120, 190, 28, 22, 11);
  add(170, -150, 34, 26, 12);
  // training pitches
  const fieldM = new THREE.MeshStandardMaterial({ color: 0x4f8a38, roughness: 1 });
  for (const [x, z] of [[190, 60], [300, -40]]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(100, 64), fieldM);
    f.rotation.x = -Math.PI / 2; f.position.set(x, 0.01, z); f.receiveShadow = true; group.add(f);
  }
}

export function buildEnvironment(scene) {
  const group = new THREE.Group(); group.name = 'environment';
  const rng = makeRng(11);
  buildTerrain(group);
  buildGround(group);
  buildCity(group, rng);
  buildTrees(group, rng);
  buildVenues(group);
  const metro = buildMetro(group);
  scene.add(group);
  return { group, metro };
}
