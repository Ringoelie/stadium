import { chromium } from 'playwright-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const dist = path.resolve(process.env.DIST || 'bench/build/v5');
const server = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); let f = path.join(dist, u.pathname); if (fs.statSync(f, {throwIfNoEntry:false})?.isDirectory()) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
p.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
const q = process.argv[2] || 'shot=0';
const t0 = Date.now();
await p.goto(`http://localhost:${server.address().port}/?${q}`, { waitUntil: 'commit' });
try { await p.waitForFunction(() => window.__ready, null, { timeout: Number(process.argv[4] || 240000), polling: 500 }); } catch (e) { console.log('timeout'); }
console.log('elapsed', Date.now() - t0);
await p.screenshot({ path: process.argv[3] || 'bench/out/debug.png', clip: { x: 0, y: 0, width: 1280, height: 720 } });
await browser.close(); server.close();
