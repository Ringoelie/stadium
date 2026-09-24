import * as THREE from 'three/webgpu';

// Small helper to accumulate flat-shaded, vertex-coloured quads/triangles.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

export class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; this.uv = null; }
  get count() { return this.pos.length / 3; }

  // p0..p3: [x,y,z]; hint: [x,y,z] rough desired normal direction; c: THREE.Color or [r,g,b]
  quad(p0, p1, p2, p3, hint, c) {
    _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    _b.set(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
    _n.crossVectors(_a, _b);
    if (_n.lengthSq() < 1e-12) { _a.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]); _n.crossVectors(_a, _b); }
    _n.normalize();
    let flip = hint && (_n.x * hint[0] + _n.y * hint[1] + _n.z * hint[2]) < 0;
    if (flip) _n.negate();
    const base = this.count;
    const pts = flip ? [p0, p3, p2, p1] : [p0, p1, p2, p3];
    const r = c.r ?? c[0], g = c.g ?? c[1], b = c.b ?? c[2];
    for (const p of pts) { this.pos.push(p[0], p[1], p[2]); this.nor.push(_n.x, _n.y, _n.z); this.col.push(r, g, b); }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  tri(p0, p1, p2, hint, c) {
    _a.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    _b.set(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]);
    _n.crossVectors(_a, _b).normalize();
    let flip = hint && (_n.x * hint[0] + _n.y * hint[1] + _n.z * hint[2]) < 0;
    if (flip) _n.negate();
    const base = this.count;
    const pts = flip ? [p0, p2, p1] : [p0, p1, p2];
    const r = c.r ?? c[0], g = c.g ?? c[1], b = c.b ?? c[2];
    for (const p of pts) { this.pos.push(p[0], p[1], p[2]); this.nor.push(_n.x, _n.y, _n.z); this.col.push(r, g, b); }
    this.idx.push(base, base + 1, base + 2);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export function canvasTexture(w, h, draw, { repeat = false, aniso = 8, mips = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (!mips) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}
