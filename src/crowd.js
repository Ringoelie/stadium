import * as THREE from 'three/webgpu';
import { attribute, mix, vec3, float } from 'three/tsl';
import { makeRng } from './rng.js';
import { LOW, UP, COLS, perimPoint, lowerRows, isAisle } from './layout.js';

// One spectator: legs, torso, arms and head as boxes. Vertex attributes mark which
// parts take the shirt colour and which take the skin colour.
function personGeometry() {
  const parts = [];
  const box = (w, h, d, x, y, z, shirt, skin) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    g.setAttribute('mshirt', new THREE.Float32BufferAttribute(new Array(n).fill(shirt), 1));
    g.setAttribute('mskin', new THREE.Float32BufferAttribute(new Array(n).fill(skin), 1));
    g.deleteAttribute('uv');
    parts.push(g);
  };
  box(0.34, 0.8, 0.22, 0, 0.4, 0, 0, 0);         // legs
  box(0.44, 0.62, 0.26, 0, 1.11, 0, 1, 0);       // torso
  box(0.12, 0.58, 0.14, -0.29, 1.12, 0, 1, 0);   // arms
  box(0.12, 0.58, 0.14, 0.29, 1.12, 0, 1, 0);
  box(0.22, 0.25, 0.22, 0, 1.56, 0, 0, 1);       // head
  return mergeGeoms(parts);
}

function mergeGeoms(list) {
  const names = Object.keys(list[0].attributes);
  const out = new THREE.BufferGeometry();
  let vcount = 0, icount = 0;
  for (const g of list) { vcount += g.attributes.position.count; icount += g.index.count; }
  for (const name of names) {
    const size = list[0].attributes[name].itemSize, arr = new Float32Array(vcount * size);
    let off = 0;
    for (const g of list) { arr.set(g.attributes[name].array, off); off += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = new Uint16Array(icount); let io = 0, vo = 0;
  for (const g of list) { for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo; vo += g.attributes.position.count; }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

const PALETTES = {
  sur: [[0x0b8a3e, 0.5], [0xffffff, 0.35], [0x0a5c2a, 0.1], [0x222222, 0.05]],   // Los del Sur (verde)
  norte: [[0xc1121f, 0.45], [0x1d3f9a, 0.3], [0xffffff, 0.15], [0x222222, 0.1]], // Rexixtenxia Norte (rojo/azul)
  side: [[0x0b8a3e, 0.25], [0xffffff, 0.2], [0xc1121f, 0.15], [0x1d3f9a, 0.12], [0xffd400, 0.08], [0x333333, 0.1], [0x8a8f96, 0.1]],
};
const SKINS = [0xe0b494, 0xc68c64, 0x9a6844, 0x6e4a32, 0xf0cfb4];

function pickPalette(rng, pal) {
  let x = rng();
  for (const [c, p] of pal) { if ((x -= p) <= 0) return c; }
  return pal[0][0];
}

// Enumerate seat/standing slots over the bowl.
export function crowdSlots(seed = 3) {
  const rng = makeRng(seed);
  const slots = [];
  const tmp = {};
  const addRow = (seg, k0, k1, r, h, seated, occ, tier, row) => {
    perimPoint(k0, r, tmp); const ax = tmp.x, az = tmp.z;
    perimPoint(k1, r, tmp); const bx = tmp.x, bz = tmp.z;
    const len = Math.hypot(bx - ax, bz - az);
    const spacing = seated ? 0.55 : 0.5;
    const n = Math.max(1, Math.floor(len / spacing));
    for (let i = 0; i < n; i++) {
      if (rng() > occ) continue;
      const t = (i + 0.5 + (seated ? 0 : (rng() - 0.5) * 0.3)) / n;
      const k = k0 + (k1 - k0) * t;
      perimPoint(k, r + (seated ? 0 : (rng() - 0.5) * 0.15), tmp);
      slots.push({ x: tmp.x, y: h, z: tmp.z, yaw: Math.atan2(-tmp.nx, -tmp.nz), seg, seated, tier, row, k });
    }
  };
  for (let seg = 0; seg < 4; seg++) {
    const n = COLS[seg], side = !(seg & 1);
    for (let i = 0; i < n; i++) {
      const k0 = seg + i / n, k1 = seg + (i + 1) / n, km = (k0 + k1) / 2;
      if (isAisle(km)) continue;
      const rows = lowerRows(km);
      for (let j = 0; j < rows; j++) {
        const r = LOW.r0 + j * LOW.tread + (side ? 0.5 : 0.4);
        addRow(seg, k0, k1, r, LOW.h0 + j * LOW.rise, side, side ? 0.72 : 0.93, 0, j);
      }
      if (side) for (let j = 0; j < UP.rows; j++) {
        const r = UP.r0 + j * UP.tread + 0.5;
        addRow(seg, k0, k1, r, UP.h0 + j * UP.rise, true, 0.68, 1, j);
      }
    }
  }
  return slots;
}

export function buildCrowd(seed = 3) {
  const slots = crowdSlots(seed);
  const rng = makeRng(seed * 7 + 1);
  const geo = personGeometry();
  const n = slots.length;
  const shirt = new Float32Array(n * 3), skin = new Float32Array(n * 3);
  const c = new THREE.Color();
  const phase = new Float32Array(n), amp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = slots[i];
    const pal = s.seg === 1 ? PALETTES.sur : s.seg === 3 ? PALETTES.norte : PALETTES.side;
    c.setHex(pickPalette(rng, pal)); c.toArray(shirt, i * 3);
    c.setHex(SKINS[Math.floor(rng() * SKINS.length)]); c.toArray(skin, i * 3);
    phase[i] = rng() * Math.PI * 2;
    amp[i] = s.seated ? 0.05 + rng() * 0.07 : 0.18 + rng() * 0.2;
  }
  geo.setAttribute('shirt', new THREE.InstancedBufferAttribute(shirt, 3));
  geo.setAttribute('skin', new THREE.InstancedBufferAttribute(skin, 3));

  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  const pants = vec3(0.1, 0.11, 0.15);
  mat.colorNode = mix(mix(pants, attribute('shirt', 'vec3'), attribute('mshirt', 'float')), attribute('skin', 'vec3'), attribute('mskin', 'float'));

  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.name = 'crowd';
  mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const place = (t, excite) => {
    for (let i = 0; i < n; i++) {
      const s = slots[i];
      // barras jump to the beat; the sides do a mexican wave now and then
      let y = 0;
      if (!s.seated) {
        const beat = Math.sin(t * 2 * Math.PI * 1.9 + phase[i] * 0.35 + s.k * 6.0);
        y = Math.max(0, beat) * amp[i] * (0.6 + excite);
      } else {
        const wave = ((t * 0.09 - s.k / 4) % 1 + 1) % 1; // travels around the ground
        const w = Math.exp(-Math.pow((wave - 0.5) * 40, 2));
        y = Math.max(0, Math.sin(t * 3 + phase[i])) * amp[i] * excite + w * 0.45;
      }
      dummy.position.set(s.x, s.y + y - (s.seated ? 0.38 : 0), s.z);
      dummy.rotation.set(0, s.yaw, 0);
      const sc = s.seated ? 0.92 : 1;
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  place(0, 0);
  return { mesh, count: n, update: place };
}
