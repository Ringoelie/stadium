// Usage: node bench/run.mjs <label> [--runs 3] [--backend webgpu|webgl] [--ref <label>] [--dist dir] [--no-shots]
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { compare } from './ssim.mjs';

const args = process.argv.slice(2);
const label = args[0] || 'run';
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const runs = Number(opt('runs', 3));
const backend = opt('backend', 'webgl');
const ref = opt('ref', null);
const dist = path.resolve(opt('dist', 'dist'));
const noShots = args.includes('--no-shots');
const outDir = path.resolve('bench/out', label);
fs.mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let f = path.join(dist, decodeURIComponent(u.pathname));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
});

async function page(url, flag, timeout = 420000) {
  for (let attempt = 0; ; attempt++) {
    try { return await page1(url, flag, timeout); } catch (e) { if (attempt >= 2) throw e; console.error('retrying', url, e.message.split('\n')[0]); }
  }
}
async function page1(url, flag, timeout) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto(url, { waitUntil: 'commit' });
  try { await p.waitForFunction((f) => window[f] || window.__ready, flag, { timeout, polling: 250 }); }
  catch (e) { await p.close(); throw e; }
  return { p, errors };
}

const q = backend === 'webgl' ? '&backend=webgl' : '';
const results = { label, backend, runs: [], shots: [] };
for (let r = 0; r < runs; r++) {
  const { p, errors } = await page(`${base}?bench${q}`, '__bench');
  const b = await p.evaluate(() => window.__bench);
  if (!b) { console.error('bench failed', errors); process.exit(1); }
  if (errors.length) console.error('page errors:', errors.slice(0, 5));
  results.runs.push(b);
  console.log(`run ${r}: total ${b.total.toFixed(0)} ms, mean ${b.mean.toFixed(2)} ms, p95 ${b.p95.toFixed(2)}, cpu ${b.cpuMean.toFixed(2)}, draws ${b.drawCalls}, tris ${b.triangles} [${b.backend}]`);
  await p.close();
}
const totals = results.runs.map((r) => r.total).sort((a, b) => a - b);
results.medianTotal = totals[Math.floor(totals.length / 2)] || 0;
const med = results.runs.find((r) => r.total === results.medianTotal) || { frames: 1 };
results.median = med;

if (!noShots) {
  for (let s = 0; s < 6; s++) {
    const { p, errors } = await page(`${base}?shot=${s}${q}`, '__shotReady');
    if (errors.length) console.error('page errors:', errors.slice(0, 5));
    const buf = await p.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 720 } });
    fs.writeFileSync(path.join(outDir, `shot${s}.png`), buf);
    await p.close();
    if (ref) {
      const a = PNG.sync.read(buf), bref = PNG.sync.read(fs.readFileSync(path.resolve('bench/out', ref, `shot${s}.png`)));
      const c = compare(a.data, bref.data, 1280, 720);
      results.shots.push({ shot: s, ...c });
      console.log(`shot ${s}: SSIM ${c.ssim.toFixed(4)}  MAE ${(c.mae * 100).toFixed(3)}%  bad ${(c.badPixels * 100).toFixed(3)}%`);
    }
  }
  if (ref) {
    const avg = (k) => results.shots.reduce((x, s) => x + s[k], 0) / results.shots.length;
    results.quality = { ssim: avg('ssim'), mae: avg('mae'), minSsim: Math.min(...results.shots.map((s) => s.ssim)) };
    console.log(`quality vs ${ref}: mean SSIM ${results.quality.ssim.toFixed(4)} (min ${results.quality.minSsim.toFixed(4)}), MAE ${(results.quality.mae * 100).toFixed(3)}%`);
  }
}
console.log(`MEDIAN TOTAL ${results.medianTotal.toFixed(0)} ms (${(results.medianTotal / med.frames).toFixed(2)} ms/frame)`);
fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(results, null, 2));
await browser.close();
server.close();
