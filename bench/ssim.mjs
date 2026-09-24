// Image comparison: SSIM on luma (8x8 windows, stride 4) and mean absolute error per channel.
export function compare(a, b, w, h) {
  const lum = (d) => { const o = new Float32Array(w * h); for (let i = 0, j = 0; i < o.length; i++, j += 4) o[i] = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]; return o; };
  const A = lum(a), B = lum(b);
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let ssim = 0, n = 0;
  for (let y = 0; y + 8 <= h; y += 4) for (let x = 0; x + 8 <= w; x += 4) {
    let ma = 0, mb = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const k = (y + j) * w + x + i; ma += A[k]; mb += B[k]; }
    ma /= 64; mb /= 64;
    let va = 0, vb = 0, cov = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { const k = (y + j) * w + x + i; const da = A[k] - ma, db = B[k] - mb; va += da * da; vb += db * db; cov += da * db; }
    va /= 63; vb /= 63; cov /= 63;
    ssim += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    n++;
  }
  let mae = 0, bad = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    mae += d; if (d > 30) bad++;
  }
  return { ssim: ssim / n, mae: mae / (w * h * 3 * 255), badPixels: bad / (w * h) };
}
