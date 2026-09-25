import * as THREE from 'three/webgpu';
import { attribute, mix, vec3, uniform, sin, max, fract, exp, positionLocal } from 'three/tsl';
import { makeRng } from './rng.js';
import { LOW, UP, COLS, perimPoint, lowerRows, isAisle } from './layout.js';

// One spectator: legs, torso, arms and head as boxes. Vertex attributes mark which
// parts take the shirt colour and which take the skin colour.
function personGeometry(lod = false) {
  const parts = [];
  // drop: faces hidden by the neighbouring part or the floor (px, nx, py, ny, pz, nz)
  const FACES = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const box = (w, h, d, x, y, z, shirt, skin, drop = []) => {
    const src = new THREE.BoxGeometry(w, h, d);
    src.translate(x, y, z);
    // BoxGeometry stores 4 vertices and 6 indices per face, in FACES order
    const pos = [], nor = [], idx = [];
    FACES.forEach((f, i) => {
      if (drop.includes(f)) return;
      const base = pos.length / 3;
      for (let v = i * 4; v < i * 4 + 4; v++) { pos.push(...src.attributes.position.array.slice(v * 3, v * 3 + 3)); nor.push(...src.attributes.normal.array.slice(v * 3, v * 3 + 3)); }
      for (const k of src.index.array.slice(i * 6, i * 6 + 6)) idx.push(k - i * 4 + base);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    const n = g.attributes.position.count;
    g.setAttribute('mshirt', new THREE.Float32BufferAttribute(new Array(n).fill(shirt), 1));
    g.setAttribute('mskin', new THREE.Float32BufferAttribute(new Array(n).fill(skin), 1));
    parts.push(g);
  };
  box(0.34, 0.8, 0.22, 0, 0.4, 0, 0, 0, ['py', 'ny']);            // legs
  if (lod) {
    // far LOD: arms (same shirt colour, 1 cm from the torso) merged into one torso box
    box(0.70, 0.62, 0.26, 0, 1.11, 0, 1, 0, ['ny']);
    box(0.22, 0.25, 0.22, 0, 1.56, 0, 0, 1, ['ny']);
    return mergeGeoms(parts);
  }
  box(0.44, 0.62, 0.26, 0, 1.11, 0, 1, 0, ['ny']);                // torso
  box(0.12, 0.58, 0.14, -0.29, 1.12, 0, 1, 0, ['px', 'ny']);      // arms (inner face touches the torso)
  box(0.12, 0.58, 0.14, 0.29, 1.12, 0, 1, 0, ['nx', 'ny']);
  box(0.22, 0.25, 0.22, 0, 1.56, 0, 0, 1, ['ny']);                // head
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
  const geo = personGeometry(), geoLod = personGeometry(true);
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

  // Per-instance animation parameters: phase, amplitude, perimeter position k, seated flag.
  const anim = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { anim[i * 4] = phase[i]; anim[i * 4 + 1] = amp[i]; anim[i * 4 + 2] = slots[i].k; anim[i * 4 + 3] = slots[i].seated ? 1 : 0; }

  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  const pants = vec3(0.1, 0.11, 0.15);
  mat.colorNode = mix(mix(pants, attribute('shirt', 'vec3'), attribute('mshirt', 'float')), attribute('skin', 'vec3'), attribute('mskin', 'float'));

  // Animation runs in the vertex shader: barras jump to the beat, the sides do a mexican wave.
  const uTime = uniform(0), uExcite = uniform(0);
  const A = attribute('anim', 'vec4');
  const beat = sin(uTime.mul(2 * Math.PI * 1.9).add(A.x.mul(0.35)).add(A.z.mul(6.0)));
  const yStand = max(0, beat).mul(A.y).mul(uExcite.add(0.6));
  const wave = fract(uTime.mul(0.09).sub(A.z.div(4)));
  const d = wave.sub(0.5).mul(40);
  const w = exp(d.mul(d).negate());
  const ySeat = max(0, sin(uTime.mul(3).add(A.x))).mul(A.y).mul(uExcite).add(w.mul(0.45));
  // offset is in world metres; the instance matrix scales seated people by 0.92
  const yOff = mix(yStand, ySeat.div(0.92), A.w);
  mat.positionNode = positionLocal.add(vec3(0, yOff, 0));

  // Split into chunks along the bowl so off-screen parts are frustum culled.
  const group = new THREE.Group(); group.name = 'crowd';
  const chunkOf = (sl) => (sl.tier * 4 + sl.seg) * 6 + Math.min(5, Math.floor((sl.k - sl.seg) * 6));
  const buckets = new Map();
  for (let i = 0; i < n; i++) { const c = chunkOf(slots[i]); if (!buckets.has(c)) buckets.set(c, []); buckets.get(c).push(i); }
  const dummy = new THREE.Object3D();
  const chunks = [];
  const sub = (src, ids, size) => { const out = new Float32Array(ids.length * size); ids.forEach((id, j) => { for (let q = 0; q < size; q++) out[j * size + q] = src[id * size + q]; }); return out; };
  for (const [, ids] of [...buckets].sort((x, y) => x[0] - y[0])) {
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'mshirt', 'mskin']) g.setAttribute(name, geo.attributes[name]);
    g.setIndex(geo.index);
    g.setAttribute('shirt', new THREE.InstancedBufferAttribute(sub(shirt, ids, 3), 3));
    g.setAttribute('skin', new THREE.InstancedBufferAttribute(sub(skin, ids, 3), 3));
    g.setAttribute('anim', new THREE.InstancedBufferAttribute(sub(anim, ids, 4), 4));
    const mesh = new THREE.InstancedMesh(g, mat, ids.length);
    ids.forEach((id, j) => {
      const s = slots[id];
      dummy.position.set(s.x, s.y - (s.seated ? 0.38 : 0), s.z);
      dummy.rotation.set(0, s.yaw, 0);
      const sc = s.seated ? 0.92 : 1;
      dummy.scale.set(sc, sc, sc);
      dummy.updateMatrix();
      mesh.setMatrixAt(j, dummy.matrix);
    });
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += 1.5; // room for the vertex animation
    mesh.castShadow = true; mesh.receiveShadow = true;
    // far version sharing the per-instance data
    const gl = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'mshirt', 'mskin']) gl.setAttribute(name, geoLod.attributes[name]);
    gl.setIndex(geoLod.index);
    for (const name of ['shirt', 'skin', 'anim']) gl.setAttribute(name, g.attributes[name]);
    const far = new THREE.InstancedMesh(gl, mat, ids.length);
    far.instanceMatrix = mesh.instanceMatrix;
    far.boundingSphere = mesh.boundingSphere.clone();
    far.castShadow = true; far.receiveShadow = true; far.visible = false;
    group.add(mesh, far);
    chunks.push({ near: mesh, far });
  }
  const place = (t, excite) => { uTime.value = t; uExcite.value = excite; };
  // pick the detail level of each chunk from its distance to the camera
  const LOD_DIST = 60;
  const lod = (camera) => {
    for (const c of chunks) {
      const s = c.near.boundingSphere;
      const near = camera.position.distanceTo(s.center) - s.radius < LOD_DIST;
      c.near.visible = near; c.far.visible = !near;
    }
  };
  place(0, 0);
  return { mesh: group, count: n, update: place, lod };
}
