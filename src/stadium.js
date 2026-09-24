import * as THREE from 'three/webgpu';
import { GeoBuilder, canvasTexture } from './builder.js';
import {
  L, R_TRACK_IN, R_TRACK_OUT, LANES, LANE_W, LOW, UP, CONCOURSE_R0, COLS,
  perimPoint, lowerRows, isAisle, PITCH_L, PITCH_W,
} from './layout.js';

const tmp = { x: 0, z: 0, nx: 0, nz: 0 };
const P = (k, r, y) => { perimPoint(k, r, tmp); return [tmp.x, y, tmp.z]; };
const N = (k) => { perimPoint(k, 1, tmp); return [tmp.nx, 0, tmp.nz]; };
const col = (hex) => new THREE.Color(hex);

const CONCRETE = col(0xb9b4aa), CONCRETE_D = col(0x9c978d), STAIR = col(0xd6d2c8);
const WHITE = col(0xf2f2ee);

// Seat colours per stand. Occidental: verde/blanco, Oriental: rojo/azul (the two home clubs).
function seatColor(seg, row, tier) {
  if (seg === 0) return (tier === 0 ? (row % 7 === 6 ? WHITE : col(0x13803f)) : (row % 6 === 5 ? col(0x13803f) : WHITE));
  if (seg === 2) return (tier === 0 ? (row % 7 === 6 ? WHITE : col(0xb3121f)) : (row % 6 === 5 ? col(0xb3121f) : col(0x1d3f9a)));
  return null; // popular ends: standing on bare concrete
}

// ---------------------------------------------------------------- pitch & track
function pitchTexture() {
  const X0 = -(L + R_TRACK_IN), W = 2 * (L + R_TRACK_IN), Z0 = -R_TRACK_IN, H = 2 * R_TRACK_IN;
  const tex = canvasTexture(4096, 2048, (ctx, w, h) => {
    const sx = w / W, sz = h / H;
    const X = (x) => (x - X0) * sx, Z = (z) => (z - Z0) * sz;
    ctx.fillStyle = '#3d7a2c'; ctx.fillRect(0, 0, w, h);
    // mowing stripes across the pitch length
    const stripes = 18, sw = (PITCH_L + 6) / stripes;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 ? '#468a33' : '#3b7a2b';
      ctx.fillRect(X(-PITCH_L / 2 - 3 + i * sw), Z(-PITCH_W / 2 - 3), sw * sx + 1, (PITCH_W + 6) * sz);
    }
    // subtle noise
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    let seed = 7;
    for (let i = 0; i < d.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = ((seed >>> 24) - 128) * 0.06;
      d[i] += n; d[i + 1] += n * 1.2; d[i + 2] += n * 0.6;
    }
    ctx.putImageData(img, 0, 0);
    // markings
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 0.12 * sx;
    const hl = PITCH_L / 2, hw = PITCH_W / 2;
    const rect = (x0, z0, x1, z1) => ctx.strokeRect(X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0));
    const ell = (x, z, r, a0 = 0, a1 = Math.PI * 2) => { ctx.beginPath(); ctx.ellipse(X(x), Z(z), r * sx, r * sz, 0, a0, a1); ctx.stroke(); };
    const dot = (x, z, r) => { ctx.beginPath(); ctx.ellipse(X(x), Z(z), r * sx, r * sz, 0, 0, Math.PI * 2); ctx.fill(); };
    rect(-hl, -hw, hl, hw);
    ctx.beginPath(); ctx.moveTo(X(0), Z(-hw)); ctx.lineTo(X(0), Z(hw)); ctx.stroke();
    ell(0, 0, 9.15); dot(0, 0, 0.2);
    for (const s of [-1, 1]) {
      const gx = s * hl;
      rect(Math.min(gx, gx - s * 16.5), -20.16, Math.max(gx, gx - s * 16.5), 20.16);
      rect(Math.min(gx, gx - s * 5.5), -9.16, Math.max(gx, gx - s * 5.5), 9.16);
      dot(gx - s * 11, 0, 0.18);
      const a = Math.acos(5.5 / 9.15);
      if (s < 0) ell(gx - s * 11, 0, 9.15, -a, a); else ell(gx - s * 11, 0, 9.15, Math.PI - a, Math.PI + a);
      for (const t of [-1, 1]) ell(gx, t * hw, 1, 0, Math.PI * 2);
    }
  });
  return { tex, X0, W, Z0, H };
}

function buildPitch(group) {
  const { tex, X0, W, Z0, H } = pitchTexture();
  // The infield is convex: triangulate as a fan from the centre spot.
  const pts = [];
  const seg = 48;
  for (let i = 0; i < seg; i++) { const a = -Math.PI / 2 + Math.PI * i / seg; pts.push([L + R_TRACK_IN * Math.cos(a), R_TRACK_IN * Math.sin(a)]); }
  for (let i = 0; i < seg; i++) { const a = Math.PI / 2 + Math.PI * i / seg; pts.push([-L + R_TRACK_IN * Math.cos(a), R_TRACK_IN * Math.sin(a)]); }
  const pos = [0, 0, 0], uv = [(0 - X0) / W, 1 - (0 - Z0) / H], idx = [];
  for (const [x, z] of pts) { pos.push(x, 0, z); uv.push((x - X0) / W, 1 - (z - Z0) / H); }
  for (let i = 0; i < pts.length; i++) { const a = 1 + i, b = 1 + ((i + 1) % pts.length); idx.push(0, b, a); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  m.receiveShadow = true; m.name = 'pitch';
  group.add(m);
}

function buildTrack(group) {
  const b = new GeoBuilder();
  const TRACK = col(0xa8432d), APRON = col(0x8d3a28), LINE = col(0xf4efe8);
  const rings = [R_TRACK_IN, R_TRACK_OUT, LOW.r0];
  for (let seg = 0; seg < 4; seg++) {
    const n = COLS[seg] * 2;
    for (let i = 0; i < n; i++) {
      const k0 = seg + i / n, k1 = seg + (i + 1) / n;
      for (let j = 0; j < rings.length - 1; j++) {
        b.quad(P(k0, rings[j], 0), P(k1, rings[j], 0), P(k1, rings[j + 1], 0), P(k0, rings[j + 1], 0), [0, 1, 0], j === 0 ? TRACK : APRON);
      }
      for (let l = 0; l <= LANES; l++) {
        const r = R_TRACK_IN + l * LANE_W;
        b.quad(P(k0, r - 0.025, 0.012), P(k1, r - 0.025, 0.012), P(k1, r + 0.025, 0.012), P(k0, r + 0.025, 0.012), [0, 1, 0], LINE);
      }
    }
  }
  const m = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  m.receiveShadow = true; m.name = 'track';
  group.add(m);
}

// ---------------------------------------------------------------- stands
function buildStands(group) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const UPV = [0, 1, 0];
  for (let seg = 0; seg < 4; seg++) {
    const b = new GeoBuilder();
    const n = COLS[seg];
    const side = !(seg & 1);
    for (let i = 0; i < n; i++) {
      const k0 = seg + i / n, k1 = seg + (i + 1) / n, km = (k0 + k1) / 2;
      const nm = N(km), inward = [-nm[0], 0, -nm[2]];
      const aisle = isAisle(km);
      const rows = lowerRows(km);
      // front wall
      b.quad(P(k0, LOW.r0, 0), P(k1, LOW.r0, 0), P(k1, LOW.r0, LOW.h0), P(k0, LOW.r0, LOW.h0), inward, i % 2 ? WHITE : col(0xe8e8e2));
      const tier = (t, r0, h0, tread, rise, count) => {
        for (let j = 0; j < count; j++) {
          const rf = r0 + j * tread, rb = rf + tread, h = h0 + j * rise;
          const sc = aisle ? null : seatColor(seg, j, t);
          b.quad(P(k0, rf, h), P(k1, rf, h), P(k1, rb, h), P(k0, rb, h), UPV, aisle ? STAIR : (j % 2 ? CONCRETE : CONCRETE_D));
          if (j < count - 1) b.quad(P(k0, rb, h), P(k1, rb, h), P(k1, rb, h + rise), P(k0, rb, h + rise), inward, aisle ? STAIR : CONCRETE_D);
          if (sc) {
            const s0 = rf + 0.28, s1 = rf + 0.62, sh = h + 0.42;
            b.quad(P(k0, s0, h), P(k1, s0, h), P(k1, s0, sh), P(k0, s0, sh), inward, sc);
            b.quad(P(k0, s0, sh), P(k1, s0, sh), P(k1, s1, sh), P(k0, s1, sh), UPV, sc);
          }
        }
      };
      tier(0, LOW.r0, LOW.h0, LOW.tread, LOW.rise, rows);
      const lowEnd = LOW.r0 + rows * LOW.tread, lowTop = LOW.h0 + (rows - 1) * LOW.rise;
      if (side) {
        // concourse, upper fascia, upper tier, back walkway and parapet
        b.quad(P(k0, lowEnd, lowTop), P(k1, lowEnd, lowTop), P(k1, UP.r0, lowTop), P(k0, UP.r0, lowTop), UPV, CONCRETE);
        b.quad(P(k0, UP.r0, lowTop), P(k1, UP.r0, lowTop), P(k1, UP.r0, UP.h0), P(k0, UP.r0, UP.h0), inward, i % 4 < 2 ? WHITE : (seg === 0 ? col(0x13803f) : col(0xb3121f)));
        tier(1, UP.r0, UP.h0, UP.tread, UP.rise, UP.rows);
        const upEnd = UP.r0 + UP.rows * UP.tread, top = UP.h0 + (UP.rows - 1) * UP.rise;
        b.quad(P(k0, upEnd, top), P(k1, upEnd, top), P(k1, upEnd + 2, top), P(k0, upEnd + 2, top), UPV, CONCRETE);
        b.quad(P(k0, upEnd + 2, top), P(k1, upEnd + 2, top), P(k1, upEnd + 2, top + 1.2), P(k0, upEnd + 2, top + 1.2), inward, CONCRETE_D);
        b.quad(P(k0, upEnd + 2.3, top + 1.2), P(k1, upEnd + 2.3, top + 1.2), P(k1, upEnd + 2, top + 1.2), P(k0, upEnd + 2, top + 1.2), UPV, CONCRETE);
        // exterior facade
        const fc = i % 3 === 0 ? col(0xd9d4c7) : col(0xc4bfb3);
        b.quad(P(k0, upEnd + 2.3, 0), P(k1, upEnd + 2.3, 0), P(k1, upEnd + 2.3, top + 1.2), P(k0, upEnd + 2.3, top + 1.2), nm, fc);
      } else {
        b.quad(P(k0, lowEnd, lowTop), P(k1, lowEnd, lowTop), P(k1, lowEnd, lowTop + 1.1), P(k0, lowEnd, lowTop + 1.1), inward, CONCRETE_D);
        b.quad(P(k0, lowEnd + 0.3, lowTop + 1.1), P(k1, lowEnd + 0.3, lowTop + 1.1), P(k1, lowEnd, lowTop + 1.1), P(k0, lowEnd, lowTop + 1.1), UPV, CONCRETE);
        const fc = i % 4 === 0 ? col(0xd9d4c7) : col(0xc4bfb3);
        b.quad(P(k0, lowEnd + 0.3, 0), P(k1, lowEnd + 0.3, 0), P(k1, lowEnd + 0.3, lowTop + 1.1), P(k0, lowEnd + 0.3, lowTop + 1.1), nm, fc);
        // side walls where the next column has a different row count
        const kn = seg + (i + 1.5) / n;
        const rowsN = i + 1 < n ? lowerRows(kn) : lowerRows(seg + 1 + 0.5 / COLS[(seg + 1) & 3]);
        if (rowsN !== rows) {
          const lo = Math.min(rows, rowsN), hi = Math.max(rows, rowsN);
          const dir = rowsN < rows ? 1 : -1; // wall faces towards the lower column
          perimPoint(k1, 1, tmp);
          const tang = [-tmp.nz * dir, 0, tmp.nx * dir];
          for (let j = lo; j < hi; j++) {
            const rf = LOW.r0 + j * LOW.tread, h = LOW.h0 + j * LOW.rise + 1.1 * (j === hi - 1);
            b.quad(P(k1, rf, 0), P(k1, rf + LOW.tread + (j === hi - 1 ? 0.3 : 0), 0), P(k1, rf + LOW.tread + (j === hi - 1 ? 0.3 : 0), h), P(k1, rf, h), tang, CONCRETE_D);
          }
          // the lower column also needs its parapet capped at the joint
        }
      }
    }
    const m = new THREE.Mesh(b.build(), mat);
    m.castShadow = true; m.receiveShadow = true; m.name = 'stand' + seg;
    group.add(m);
  }
  // End caps of the upper tiers at x = +-L
  const shape = new THREE.Shape();
  const lowTop = LOW.h0 + (LOW.rows - 1) * LOW.rise;
  const upEnd = UP.r0 + UP.rows * UP.tread, top = UP.h0 + (UP.rows - 1) * UP.rise;
  shape.moveTo(CONCOURSE_R0, 0); shape.lineTo(CONCOURSE_R0, lowTop); shape.lineTo(UP.r0, lowTop); shape.lineTo(UP.r0, UP.h0);
  for (let j = 0; j < UP.rows; j++) {
    const h = UP.h0 + j * UP.rise;
    shape.lineTo(UP.r0 + (j + 1) * UP.tread, h);
    if (j < UP.rows - 1) shape.lineTo(UP.r0 + (j + 1) * UP.tread, h + UP.rise);
  }
  shape.lineTo(upEnd + 2, top); shape.lineTo(upEnd + 2, top + 1.2); shape.lineTo(upEnd + 2.3, top + 1.2); shape.lineTo(upEnd + 2.3, 0);
  const capG = new THREE.ShapeGeometry(shape);
  const capMat = new THREE.MeshStandardMaterial({ color: 0xc4bfb3, roughness: 0.9, side: THREE.DoubleSide });
  for (const [x, zs] of [[L, 1], [-L, 1], [L, -1], [-L, -1]]) {
    const m = new THREE.Mesh(capG, capMat);
    // shape x -> world z (radius), shape y -> world y
    m.rotation.y = zs > 0 ? -Math.PI / 2 : Math.PI / 2;
    m.position.set(x, 0, 0);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
}

// ---------------------------------------------------------------- roofs
const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
function beam(a, b, r, mat) {
  const m = new THREE.Mesh(unitCyl, mat);
  const d = new THREE.Vector3().subVectors(b, a);
  m.scale.set(r, d.length(), r);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export const ROOF = { r0: 58, r1: 103, x0: -L - 4, x1: L + 4 };
export const roofY = (r) => { const t = (ROOF.r1 - r) / (ROOF.r1 - ROOF.r0); return 39 + 3.2 * t + 1.6 * Math.sin(Math.PI * t); };

function buildRoofs(group) {
  const steel = new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.4, metalness: 0.6 });
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
  for (const s of [1, -1]) {
    const b = new GeoBuilder();
    const nx = 36, nr = 14;
    const top = col(0xcfd4d8), under = col(0xf4f4f0), edge = col(0xffffff);
    const V = (i, j, off) => { const x = ROOF.x0 + (ROOF.x1 - ROOF.x0) * i / nx; const r = ROOF.r0 + (ROOF.r1 - ROOF.r0) * j / nr; return [x, roofY(r) + off, s * r]; };
    for (let i = 0; i < nx; i++) for (let j = 0; j < nr; j++) {
      b.quad(V(i, j, 0.5), V(i + 1, j, 0.5), V(i + 1, j + 1, 0.5), V(i, j + 1, 0.5), [0, 1, 0], (i + j) % 2 ? top : col(0xc6ccd1));
      b.quad(V(i, j, 0), V(i + 1, j, 0), V(i + 1, j + 1, 0), V(i, j + 1, 0), [0, -1, 0], under);
    }
    for (let i = 0; i < nx; i++) {
      b.quad(V(i, 0, -0.9), V(i + 1, 0, -0.9), V(i + 1, 0, 0.5), V(i, 0, 0.5), [0, 0, -s], edge);
      b.quad(V(i, nr, 0), V(i + 1, nr, 0), V(i + 1, nr, 0.5), V(i, nr, 0.5), [0, 0, s], edge);
    }
    for (const i of [0, nx]) for (let j = 0; j < nr; j++) b.quad(V(i, j, -0.9 * (j === 0)), V(i, j + 1, 0), V(i, j + 1, 0.5), V(i, j, 0.5), [i ? 1 : -1, 0, 0], edge);
    const roof = new THREE.Mesh(b.build(), roofMat);
    roof.castShadow = true; roof.receiveShadow = true; roof.name = 'roof';
    group.add(roof);
    // masts and stays (one mesh each)
    const masts = 9;
    for (let i = 0; i < masts; i++) {
      const x = ROOF.x0 + 3 + (ROOF.x1 - ROOF.x0 - 6) * i / (masts - 1);
      const base = new THREE.Vector3(x, 0, s * (ROOF.r1 + 1.5));
      const tip = new THREE.Vector3(x, 56, s * (ROOF.r1 - 2));
      group.add(beam(base, tip, 0.55, steel));
      for (const rr of [ROOF.r0 + 1, ROOF.r0 + 15, ROOF.r0 + 29]) group.add(beam(tip, new THREE.Vector3(x, roofY(rr) + 0.5, s * rr), 0.07, steel));
      group.add(beam(tip, new THREE.Vector3(x, 0, s * (ROOF.r1 + 14)), 0.09, steel));
      // under-roof ribs
      for (let j = 0; j < 6; j++) {
        const ra = ROOF.r0 + (ROOF.r1 - ROOF.r0) * j / 6, rb = ROOF.r0 + (ROOF.r1 - ROOF.r0) * (j + 1) / 6;
        group.add(beam(new THREE.Vector3(x, roofY(ra) - 0.2, s * ra), new THREE.Vector3(x, roofY(rb) - 0.2, s * rb), 0.25, steel));
      }
    }
  }
  // Roof fascia lettering (faces the pitch)
  const lettering = canvasTexture(4096, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0d6e35'; ctx.font = 'bold 92px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ESTADIO  ATANASIO  GIRARDOT  ·  MEDELLÍN', w / 2, h / 2 + 4);
  });
  for (const s of [1, -1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(ROOF.x1 - ROOF.x0, 1.4), new THREE.MeshStandardMaterial({ map: lettering, roughness: 0.6 }));
    pl.position.set(0, roofY(ROOF.r0) - 0.2, s * (ROOF.r0 - 0.03));
    if (s > 0) pl.rotation.y = Math.PI;
    group.add(pl);
  }
}

// ---------------------------------------------------------------- floodlight towers
export const TOWERS = [[L + 66, 66], [L + 66, -66], [-L - 66, 66], [-L - 66, -66]];
function buildTowers(group) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.5, metalness: 0.7 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.6, metalness: 0.4 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 2.2, roughness: 0.3 });
  const lampG = new THREE.BoxGeometry(1.3, 1.0, 0.35);
  const H = 60, levels = 10;
  for (const [tx, tz] of TOWERS) {
    const w = (y) => 3.2 - 1.9 * (y / H);
    const corner = (y, c) => new THREE.Vector3(tx + w(y) * (c & 1 ? 1 : -1), y, tz + w(y) * (c & 2 ? 1 : -1));
    const order = [0, 1, 3, 2];
    for (let c = 0; c < 4; c++) group.add(beam(corner(0, c), corner(H, c), 0.28, steel));
    for (let l = 0; l < levels; l++) {
      const y0 = H * l / levels, y1 = H * (l + 1) / levels;
      for (let f = 0; f < 4; f++) {
        const a = order[f], b2 = order[(f + 1) % 4];
        group.add(beam(corner(y1, a), corner(y1, b2), 0.1, steel));
        group.add(beam(corner(y0, a), corner(y1, b2), 0.07, steel));
        group.add(beam(corner(y0, b2), corner(y1, a), 0.07, steel));
      }
    }
    // headframe facing the centre spot
    const head = new THREE.Group();
    head.position.set(tx, H + 4, tz);
    head.lookAt(0, 0, 0);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(13, 8, 0.5), panel);
    frame.castShadow = true;
    head.add(frame);
    for (let i = 0; i < 7; i++) for (let j = 0; j < 5; j++) {
      const m = new THREE.Mesh(lampG, lamp);
      m.position.set(-5.4 + i * 1.8, -3 + j * 1.5, 0.35);
      head.add(m);
    }
    group.add(head);
  }
}

// ---------------------------------------------------------------- pitch furniture
const SPONSORS = [
  ['MEDELLÍN', '#0b8a3e', '#ffffff'], ['ETERNA PRIMAVERA', '#ffffff', '#c1121f'], ['ANTIOQUIA', '#c1121f', '#ffffff'],
  ['ATANASIO GIRARDOT', '#10243f', '#ffd400'], ['FÚTBOL · 1953', '#ffd400', '#10243f'], ['VALLE DE ABURRÁ', '#1d3f9a', '#ffffff'],
];
function buildBoards(group) {
  const texs = SPONSORS.map(([t, bg, fg]) => canvasTexture(1024, 160, (ctx, w, h) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg; ctx.font = 'bold 96px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t, w / 2, h / 2 + 4);
  }));
  const side = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7 });
  const g = new THREE.BoxGeometry(6, 0.9, 0.25);
  let n = 0;
  const add = (x, z, ry) => {
    const face = new THREE.MeshStandardMaterial({ map: texs[n % texs.length], emissive: 0xffffff, emissiveMap: texs[n % texs.length], emissiveIntensity: 0.35, roughness: 0.5 });
    n++;
    const m = new THREE.Mesh(g, [side, side, side, side, face, side]);
    m.position.set(x, 0.45, z); m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  };
  for (let i = 0; i < 17; i++) { const x = -51 + i * 6.05 + 3; add(x, 38.5, Math.PI); add(x, -38.5, 0); }
  for (let i = 0; i < 6; i++) { const z = -18 + i * 6.05 + 3; add(57.8, z, -Math.PI / 2); add(-57.8, z, Math.PI / 2); }
}

function netTexture() {
  const t = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h); ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineWidth = 3;
    for (let i = 0; i <= 8; i++) { const p = i * w / 8; ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke(); }
  }, { repeat: true });
  t.repeat.set(12, 4);
  return t;
}

export const GOAL = { halfW: 3.66, h: 2.44, depth: 2.2, post: 0.06 };
function buildGoals(group) {
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
  const nt = netTexture();
  const netMat = new THREE.MeshStandardMaterial({ map: nt, alphaMap: nt, transparent: false, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  for (const s of [1, -1]) {
    const gx = s * PITCH_L / 2;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    group.add(beam(V(gx, 0, -GOAL.halfW), V(gx, GOAL.h, -GOAL.halfW), GOAL.post, white));
    group.add(beam(V(gx, 0, GOAL.halfW), V(gx, GOAL.h, GOAL.halfW), GOAL.post, white));
    group.add(beam(V(gx, GOAL.h, -GOAL.halfW), V(gx, GOAL.h, GOAL.halfW), GOAL.post, white));
    const bx = gx + s * GOAL.depth;
    const b = new GeoBuilder(); b.uv = true;
    const net = new THREE.BufferGeometry();
    const pos = [], uv = [];
    const quad = (a, b2, c, d, u0, u1) => { for (const [p, q] of [[a, [0, 0]], [b2, [u0, 0]], [c, [u0, u1]], [a, [0, 0]], [c, [u0, u1]], [d, [0, u1]]]) { pos.push(...p); uv.push(...q); } };
    quad([gx, GOAL.h, -GOAL.halfW], [gx, GOAL.h, GOAL.halfW], [bx, 1.6, GOAL.halfW], [bx, 1.6, -GOAL.halfW], 1, 0.3);
    quad([bx, 1.6, -GOAL.halfW], [bx, 1.6, GOAL.halfW], [bx, 0, GOAL.halfW], [bx, 0, -GOAL.halfW], 1, 0.3);
    for (const z of [-GOAL.halfW, GOAL.halfW]) {
      pos.push(gx, 0, z, gx, GOAL.h, z, bx, 1.6, z, gx, 0, z, bx, 1.6, z, bx, 0, z);
      uv.push(0, 0, 0, 0.35, 0.2, 0.25, 0, 0, 0.2, 0.25, 0.2, 0);
    }
    net.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    net.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    net.computeVertexNormals();
    const nm = new THREE.Mesh(net, netMat); nm.castShadow = true;
    group.add(nm);
    group.add(beam(V(bx, 0, -GOAL.halfW), V(bx, 1.6, -GOAL.halfW), 0.035, white));
    group.add(beam(V(bx, 0, GOAL.halfW), V(bx, 1.6, GOAL.halfW), 0.035, white));
  }
  // corner flags
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xffd400, side: THREE.DoubleSide });
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const x = sx * PITCH_L / 2, z = sz * PITCH_W / 2;
    group.add(beam(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 1.5, z), 0.02, white));
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.32), flagMat);
    f.position.set(x + 0.23, 1.33, z); group.add(f);
  }
}

function buildDugouts(group) {
  const shell = new THREE.MeshStandardMaterial({ color: 0xbfd9e8, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
  const seat = new THREE.MeshStandardMaterial({ color: 0x0b8a3e, roughness: 0.6 });
  const back = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.6 });
  for (const x of [-9, 9]) {
    const g = new THREE.Group(); g.position.set(x, 0, 41.2);
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 8, 20, 1, true, -Math.PI / 2, Math.PI), shell);
    sh.rotation.z = Math.PI / 2; sh.position.y = 0.4; g.add(sh);
    const s = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.45, 0.6), seat); s.position.set(0, 0.45, 0.6); g.add(s);
    const b = new THREE.Mesh(new THREE.BoxGeometry(8, 1.8, 0.1), back); b.position.set(0, 0.9, 1.5); g.add(b);
    group.add(g);
  }
}

// ---------------------------------------------------------------- scoreboard
export function buildScoreboard(group) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 426;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const draw = (home, away, clock) => {
    ctx.fillStyle = '#05080c'; ctx.fillRect(0, 0, 1024, 426);
    ctx.fillStyle = '#0d6e35'; ctx.fillRect(0, 0, 1024, 70);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 48px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ESTADIO ATANASIO GIRARDOT', 512, 38);
    ctx.font = 'bold 60px sans-serif';
    ctx.fillStyle = '#19c25a'; ctx.fillText('LOCAL', 250, 150);
    ctx.fillStyle = '#ff4a4a'; ctx.fillText('VISITA', 774, 150);
    ctx.fillStyle = '#ffd400'; ctx.font = 'bold 170px sans-serif';
    ctx.fillText(String(home), 250, 290); ctx.fillText(String(away), 774, 290);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 64px monospace'; ctx.fillText(clock, 512, 290);
    tex.needsUpdate = true;
  };
  draw(0, 0, '00:00');
  const g = new THREE.Group();
  g.position.set(-L - 93, 0, 0); g.rotation.y = Math.PI / 2;
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.6, metalness: 0.5 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(26, 11.5, 1.2), frameMat);
  frame.position.y = 29; frame.castShadow = true; g.add(frame);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(24.4, 10.15), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.set(0, 29, 0.61); g.add(screen);
  for (const x of [-9, 9]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 23.5, 1.2), frameMat); p.position.set(x, 11.75, -0.3); p.castShadow = true; g.add(p); }
  group.add(g);
  return { draw };
}

export function buildStadium() {
  const group = new THREE.Group(); group.name = 'stadium';
  buildPitch(group);
  buildTrack(group);
  buildStands(group);
  buildRoofs(group);
  buildTowers(group);
  buildBoards(group);
  buildGoals(group);
  buildDugouts(group);
  const scoreboard = buildScoreboard(group);
  return { group, scoreboard };
}
