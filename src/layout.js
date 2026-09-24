// Geometric layout of the Atanasio Girardot bowl.
// Pitch centred at origin, length along X (+X = Norte), width along Z (+Z = Occidental).
// The bowl follows a 400 m athletics track: two straights joined by semicircles.

export const L = 42.195;            // half length of the track straights
export const R_TRACK_IN = 36.5;     // inner edge of lane 1
export const LANE_W = 1.22;
export const LANES = 8;
export const R_TRACK_OUT = R_TRACK_IN + LANES * LANE_W; // 46.26
export const R_WALL = 48.6;         // front wall of the stands
export const PITCH_L = 105, PITCH_W = 68;

// Lower tier (all around)
export const LOW = { r0: 49.4, h0: 1.3, tread: 0.8, rise: 0.42, rows: 28 };
// Extra rows on the curved ends (Norte / Sur "populares")
export const END_EXTRA_ROWS = 18;
// Upper tier on the straight sides (Occidental / Oriental)
export const UP = { r0: 75.0, h0: 15.6, tread: 0.8, rise: 0.56, rows: 30 };
export const CONCOURSE_R0 = LOW.r0 + LOW.rows * LOW.tread; // 71.8

// Perimeter parameter k in [0,4):
//   [0,1) straight +Z (Occidental) from x=+L to x=-L
//   [1,2) semicircle around (-L,0)   (Sur)
//   [2,3) straight -Z (Oriental) from x=-L to x=+L
//   [3,4) semicircle around (+L,0)   (Norte)
export function perimPoint(k, r, out) {
  const seg = Math.floor(k) & 3, f = k - Math.floor(k);
  let x, z, nx, nz;
  if (seg === 0) { x = L - 2 * L * f; z = r; nx = 0; nz = 1; }
  else if (seg === 1) { const a = Math.PI / 2 + Math.PI * f; nx = Math.cos(a); nz = Math.sin(a); x = -L + r * nx; z = r * nz; }
  else if (seg === 2) { x = -L + 2 * L * f; z = -r; nx = 0; nz = -1; }
  else { const a = -Math.PI / 2 + Math.PI * f; nx = Math.cos(a); nz = Math.sin(a); x = L + r * nx; z = r * nz; }
  out.x = x; out.z = z; out.nx = nx; out.nz = nz;
  return out;
}

// Inverse: world (x,z) -> { k, r }
export function toPerim(x, z) {
  if (x >= -L && x <= L) {
    if (z >= 0) return { k: (L - x) / (2 * L), r: z };
    return { k: 2 + (x + L) / (2 * L), r: -z };
  }
  if (x < -L) {
    const dx = x + L, r = Math.hypot(dx, z);
    let a = Math.atan2(z, dx); if (a < Math.PI / 2 && a >= -Math.PI / 2) a = a < 0 ? -Math.PI / 2 : Math.PI / 2;
    if (a < 0) a += 2 * Math.PI;
    return { k: 1 + (a - Math.PI / 2) / Math.PI, r };
  }
  const dx = x - L, r = Math.hypot(dx, z);
  let a = Math.atan2(z, dx); // -pi/2..pi/2
  return { k: 3 + (a + Math.PI / 2) / Math.PI, r };
}

export const COLS = [48, 64, 48, 64];
// Centre of the stand column containing k (stands are built per column).
export function colIndex(k) { const seg = Math.floor(k) & 3, n = COLS[seg]; return Math.min(n - 1, Math.floor((k - Math.floor(k)) * n)); }
export function colMid(k) { const seg = Math.floor(k) & 3, n = COLS[seg]; return seg + (colIndex(k) + 0.5) / n; }
export function isAisle(k) { const seg = Math.floor(k) & 3, i = colIndex(k); return (seg & 1) ? i % 8 === 4 : i % 6 === 3; }

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Number of lower-tier rows at perimeter parameter k (ends are taller).
export function lowerRows(k) {
  const seg = Math.floor(k) & 3, f = k - Math.floor(k);
  if (seg === 0 || seg === 2) return LOW.rows;
  const w = Math.min(smooth(0.0, 0.18, f), smooth(1.0, 0.82, f));
  return LOW.rows + Math.round(END_EXTRA_ROWS * w);
}

export const isSide = (k) => { const s = Math.floor(k) & 3; return s === 0 || s === 2; };

// Walkable height at a world position (used by the explorer and the ball).
export function groundHeight(x, z) {
  const { k, r } = toPerim(x, z);
  if (r < LOW.r0) return 0;
  const nLow = lowerRows(colMid(k));
  const lowEnd = LOW.r0 + nLow * LOW.tread;
  if (r < lowEnd) {
    const row = Math.floor((r - LOW.r0) / LOW.tread);
    return LOW.h0 + row * LOW.rise;
  }
  const lowTop = LOW.h0 + (nLow - 1) * LOW.rise;
  if (isSide(k)) {
    if (r < UP.r0) return lowTop;               // concourse
    const upEnd = UP.r0 + UP.rows * UP.tread;
    if (r < upEnd) {
      const row = Math.floor((r - UP.r0) / UP.tread);
      return UP.h0 + row * UP.rise;
    }
    if (r < upEnd + 2) return UP.h0 + (UP.rows - 1) * UP.rise; // back walkway
    return 0;
  }
  if (r < lowEnd + 2) return lowTop;
  return 0;
}
