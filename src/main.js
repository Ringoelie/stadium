import * as THREE from 'three/webgpu';
import { buildStadium } from './stadium.js';
import { buildCrowd } from './crowd.js';
import { buildEnvironment, buildLights, buildSky } from './environment.js';
import { Game, Explorer } from './game.js';
import { CrowdAudio } from './audio.js';
import { benchCamera, BENCH_FRAMES, SHOTS } from './benchpath.js';

const params = new URLSearchParams(location.search);
const BENCH = params.has('bench');
const SHOT = params.has('shot') ? Number(params.get('shot')) : null;
const AUTOMATED = BENCH || SHOT !== null;
const FORCE_WEBGL = params.get('backend') === 'webgl';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGPURenderer({ antialias: !(params.get('off') || '').includes('aa'), forceWebGL: FORCE_WEBGL, powerPreference: 'high-performance' });
renderer.setPixelRatio(AUTOMATED ? 1 : Math.min(window.devicePixelRatio, 2));
if (AUTOMATED) renderer.setSize(1280, 720, false); else renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);
if (AUTOMATED) Object.assign(renderer.domElement.style, { width: '1280px', height: '720px', inset: 'auto', left: '0', top: '0' });
await renderer.init();
const backendName = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
$('backend').textContent = `Backend: ${backendName}`;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, AUTOMATED ? 1280 / 720 : innerWidth / innerHeight, 0.25, 40000);

const OFF = new Set((params.get('off') || '').split(','));
buildLights(scene);
if (OFF.has('shadow')) renderer.shadowMap.enabled = false;
const sky = OFF.has('sky') ? { cloudSpeed: { value: 0 } } : buildSky(scene);
const { metro } = OFF.has('env') ? { metro: { update() {} } } : buildEnvironment(scene);
const stadium = buildStadium();
scene.add(stadium.group);
const crowd = buildCrowd();
if (!OFF.has('crowd')) scene.add(crowd.mesh);

const audio = new CrowdAudio();
const toast = (txt) => { const t = $('toast'); t.textContent = txt; t.classList.add('show'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2200); };
const game = new Game(scene, {
  onGoal: (team, score) => {
    $('sL').textContent = score[0]; $('sV').textContent = score[1];
    stadium.scoreboard.draw(score[0], score[1], fmtClock(game.clock));
    if (!AUTOMATED) { toast('¡GOOOL!'); audio.roar(); }
  },
});
const explorer = new Explorer();
const fmtClock = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// ------------------------------------------------------------------ input
const keys = new Set();
let mode = 'menu'; // 'play' | 'explore' | 'menu'
let camYaw = Math.PI / 2, camPitch = 0.28;
let charge = 0, charging = false, pendingKick = null, jump = false;
const touch = { x: 0, y: 0, active: false };

addEventListener('keydown', (e) => {
  if (mode === 'menu') return;
  keys.add(e.code);
  if (e.code === 'Space') { e.preventDefault(); if (mode === 'play') { charging = true; } else jump = true; }
  if (e.code === 'KeyE' && mode === 'play') pendingKick = { power: 0.6, chip: true };
  if (e.code === 'Tab') { e.preventDefault(); setMode(mode === 'play' ? 'explore' : 'play'); }
  if (e.code === 'Escape') setMode('menu');
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Space' && mode === 'play' && charging) { pendingKick = { power: charge, chip: false }; charging = false; charge = 0; }
});
const canvas = renderer.domElement;
canvas.addEventListener('click', () => { if (mode !== 'menu' && !matchMedia('(pointer: coarse)').matches) canvas.requestPointerLock?.(); });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (mode === 'explore') { explorer.yaw -= e.movementX * 0.0022; explorer.pitch = THREE.MathUtils.clamp(explorer.pitch - e.movementY * 0.0022, -1.45, 1.45); }
  else if (mode === 'play') { camYaw -= e.movementX * 0.003; camPitch = THREE.MathUtils.clamp(camPitch + e.movementY * 0.002, 0.08, 0.9); }
});
// touch controls
const stick = $('stick');
stick.addEventListener('pointerdown', (e) => { touch.active = true; stick.setPointerCapture(e.pointerId); moveStick(e); });
stick.addEventListener('pointermove', (e) => touch.active && moveStick(e));
stick.addEventListener('pointerup', () => { touch.active = false; touch.x = touch.y = 0; stick.firstChild.style.transform = ''; });
function moveStick(e) {
  const r = stick.getBoundingClientRect();
  let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2);
  const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
  touch.x = x; touch.y = y; stick.firstChild.style.transform = `translate(${x * 40}px,${y * 40}px)`;
}
$('tKick').addEventListener('pointerdown', () => { if (mode === 'play') charging = true; else jump = true; });
$('tKick').addEventListener('pointerup', () => { if (charging) { pendingKick = { power: charge, chip: false }; charging = false; charge = 0; } });
let lookId = null, lookX = 0, lookY = 0;
canvas.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { lookId = e.pointerId; lookX = e.clientX; lookY = e.clientY; } });
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== lookId) return;
  const dx = e.clientX - lookX, dy = e.clientY - lookY; lookX = e.clientX; lookY = e.clientY;
  if (mode === 'explore') { explorer.yaw -= dx * 0.005; explorer.pitch = THREE.MathUtils.clamp(explorer.pitch - dy * 0.005, -1.45, 1.45); }
  else camYaw -= dx * 0.006;
});
canvas.addEventListener('pointerup', (e) => { if (e.pointerId === lookId) lookId = null; });

function setMode(m) {
  mode = m;
  $('menu').classList.toggle('hidden', m !== 'menu');
  $('hud').classList.toggle('hidden', m === 'menu');
  $('touch').classList.toggle('hidden', m === 'menu' || !matchMedia('(pointer: coarse)').matches);
  $('power').classList.toggle('hidden', m !== 'play');
  $('mode').textContent = m === 'play' ? 'Modo: Jugar (Tab para explorar)' : 'Modo: Explorar (Tab para jugar)';
  $('help').textContent = m === 'play' ? 'WASD mover · Shift correr · Espacio (mantener) patear · E globito · ratón cámara' : 'WASD caminar · ratón mirar · Shift correr · Espacio saltar';
  if (m === 'menu') document.exitPointerLock?.();
  else { audio.start(); if (!matchMedia('(pointer: coarse)').matches) canvas.requestPointerLock?.(); }
}
$('btnPlay').onclick = () => setMode('play');
$('btnExplore').onclick = () => { explorer.reset(); setMode('explore'); };

// ------------------------------------------------------------------ per-frame
const _mv = new THREE.Vector2();
const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3();
function readMoveInput() {
  let f = 0, s = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
  if (touch.active) { f -= touch.y; s += touch.x; }
  return { f, s, sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(touch.x, touch.y) > 0.9 };
}

function chaseCamera(dt, yaw, pitch, snap) {
  const p = game.human.pos;
  const dist = 9;
  camPos.set(p.x - Math.sin(yaw) * dist * Math.cos(pitch), 1.5 + dist * Math.sin(pitch) + 1.2, p.z - Math.cos(yaw) * dist * Math.cos(pitch));
  if (snap) camera.position.copy(camPos); else camera.position.lerp(camPos, Math.min(1, dt * 6));
  camTarget.set(p.x + Math.sin(yaw) * 4, 1.2, p.z + Math.cos(yaw) * 4);
  camera.lookAt(camTarget);
}

function simulate(dt, t, input) {
  game.update(dt, input);
  crowd.update(t, game.excite);
  metro.update(t);
}

// scripted bot used by the benchmark / capture modes (deterministic)
function botInput() {
  const b = game.ball.pos, p = game.human.pos;
  const goalX = 52.5;
  const toGoal = Math.hypot(goalX - p.x, -p.z);
  const d = Math.hypot(b.x - p.x, b.z - p.z);
  let tx = b.x - 0.5, tz = b.z;
  if (d < 1.2) { tx = goalX; tz = 0; }
  _mv.set(tx - p.x, tz - p.z); if (_mv.lengthSq() > 0) _mv.normalize();
  const kick = d < 1.1 && toGoal < 24 && game.human.kickCd <= 0 ? { power: 0.85, chip: false } : null;
  return { move: _mv, sprint: d > 4, kick };
}

let last = performance.now(), fpsAcc = 0, fpsN = 0, simT = 0;
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  simT += dt;
  if (charging) { charge = Math.min(1, charge + dt); $('power').firstChild.style.width = `${charge * 100}%`; } else $('power').firstChild.style.width = '0';
  const mi = readMoveInput();
  if (mode === 'play') {
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    _mv.set(fx * mi.f - fz * mi.s, fz * mi.f + fx * mi.s);
    const input = { move: _mv.lengthSq() > 0.01 ? _mv.clone().normalize() : null, sprint: mi.sprint, kick: pendingKick };
    pendingKick = null;
    simulate(dt, simT, input);
    chaseCamera(dt, camYaw, camPitch, false);
  } else {
    simulate(dt, simT, mode === 'menu' ? botInput() : null);
    if (mode === 'explore') {
      explorer.update(dt, { forward: mi.f, strafe: mi.s, sprint: mi.sprint, jump });
      jump = false;
      explorer.applyCamera(camera);
    } else {
      const a = simT * 0.05;
      camera.position.set(Math.cos(a) * 190, 70, Math.sin(a) * 150);
      camera.lookAt(0, 5, 0);
    }
  }
  if (Math.floor(game.clock) !== frame.lastSec) { frame.lastSec = Math.floor(game.clock); stadium.scoreboard.draw(game.score[0], game.score[1], fmtClock(game.clock)); }
  renderer.render(scene, camera);
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { $('fps').textContent = `${Math.round(fpsN / fpsAcc)} fps · ${backendName}`; fpsAcc = 0; fpsN = 0; }
}

addEventListener('resize', () => {
  if (AUTOMATED) return;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ benchmark & capture
async function gpuSync() {
  const be = renderer.backend;
  if (be.device) await be.device.queue.onSubmittedWorkDone();
  else { const gl = be.gl; gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); }
}

const DT = 1 / 60;
function stepTo(frameIdx) {
  // deterministic simulation state for frame `frameIdx`
  for (let f = 0; f < frameIdx; f++) game.update(DT, botInput());
}

async function runBench() {
  sky.cloudSpeed.value = 0;
  // warm-up: compile every pipeline by visiting all shots
  for (let s = 0; s < SHOTS; s++) { benchCamera(camera, s * (BENCH_FRAMES / SHOTS) + 1, game); renderer.render(scene, camera); await gpuSync(); }
  const times = [], cpu = [];
  // ?frames=N renders N evenly spaced frames of each shot (default: all 60)
  const per = BENCH_FRAMES / SHOTS, fps = Math.min(per, Number(params.get('frames') || per));
  const list = [];
  for (let s = 0; s < SHOTS; s++) for (let i = 0; i < fps; i++) list.push(s * per + Math.floor(i * per / fps));
  let simF = 0, draws = 0, tris = 0;
  renderer.info.autoReset = false;
  for (const f of list) {
    while (simF < f) { game.update(DT, botInput()); simF++; }
    simF++;
    const t0 = performance.now();
    simulate(DT, f * DT, botInput());
    benchCamera(camera, f, game);
    renderer.info.reset();
    renderer.render(scene, camera);
    const t1 = performance.now();
    draws += renderer.info.render.drawCalls; tris += renderer.info.render.triangles;
    await gpuSync();
    const t2 = performance.now();
    times.push(t2 - t0); cpu.push(t1 - t0);
    if (times.length % 10 === 0) console.log(`bench frame ${times.length}/${list.length}: ${(t2 - t0).toFixed(1)} ms`);
  }
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const sorted = [...times].sort((a, b) => a - b);
  window.__bench = {
    backend: backendName, frames: times.length, total: sum(times), mean: sum(times) / times.length,
    p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)], cpuMean: sum(cpu) / cpu.length,
    perShot: Array.from({ length: SHOTS }, (_, s) => sum(times.slice(s * fps, (s + 1) * fps)) / fps),
    drawCalls: draws / times.length, triangles: tris / times.length, crowd: crowd.count,
  };
}

async function runShot(s) {
  sky.cloudSpeed.value = 0;
  const f = Math.round(s * (BENCH_FRAMES / SHOTS) + BENCH_FRAMES / SHOTS / 2);
  stepTo(f);
  crowd.update(f * DT, game.excite);
  metro.update(f * DT);
  game.updateMeshes(0);
  benchCamera(camera, f, game);
  for (let i = 0; i < 3; i++) { renderer.render(scene, camera); await gpuSync(); }
  window.__shotReady = true;
}

if (BENCH) { $('menu').classList.add('hidden'); await runBench(); }
else if (SHOT !== null) {
  $('menu').classList.add('hidden');
  // the capture relies on the time uniform of the sky clouds; freeze it
  await runShot(SHOT);
} else {
  renderer.setAnimationLoop(frame);
}
window.__ready = true;
