import * as THREE from 'three/webgpu';
import { makeRng } from './rng.js';
import { PITCH_L, PITCH_W, LOW, groundHeight } from './layout.js';
import { GOAL } from './stadium.js';

const HL = PITCH_L / 2, HW = PITCH_W / 2;
const BALL_R = 0.11;

// ------------------------------------------------------------------ models
function makeFootballer(shirt, shorts, socks, skin = 0xc68c64) {
  const g = new THREE.Group();
  const m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const part = (w, h, d, mat, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); b.position.set(x, y, z); b.castShadow = true; return b; };
  const skinM = m(skin), shirtM = m(shirt), shortsM = m(shorts), sockM = m(socks), bootM = m(0x111111);
  const torso = part(0.46, 0.62, 0.26, shirtM, 0, 1.2, 0);
  const head = part(0.23, 0.26, 0.24, skinM, 0, 1.66, 0);
  const hair = part(0.24, 0.08, 0.25, m(0x1b1410), 0, 1.8, 0);
  const hips = part(0.44, 0.22, 0.25, shortsM, 0, 0.84, 0);
  g.add(torso, head, hair, hips);
  const limb = (x, isLeg) => {
    const pivot = new THREE.Group(); pivot.position.set(x, isLeg ? 0.84 : 1.48, 0);
    if (isLeg) {
      pivot.add(part(0.17, 0.4, 0.18, skinM, 0, -0.2, 0));
      pivot.add(part(0.16, 0.36, 0.17, sockM, 0, -0.56, 0));
      pivot.add(part(0.16, 0.08, 0.28, bootM, 0, -0.78, 0.05));
    } else {
      pivot.add(part(0.13, 0.26, 0.14, shirtM, 0, -0.13, 0));
      pivot.add(part(0.11, 0.34, 0.12, skinM, 0, -0.43, 0));
    }
    g.add(pivot); return pivot;
  };
  const legL = limb(-0.12, true), legR = limb(0.12, true), armL = limb(-0.3, false), armR = limb(0.3, false);
  g.userData = { legL, legR, armL, armR, phase: 0 };
  return g;
}

function ballTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#111';
  for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) {
    const x = (i + (j % 2) * 0.5) * 512 / 6, y = 32 + j * 64, r = 20;
    ctx.beginPath();
    for (let k = 0; k < 5; k++) { const a = k * Math.PI * 2 / 5 - Math.PI / 2; ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); }
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ game
export class Game {
  constructor(scene, { onGoal, seed = 5 } = {}) {
    this.scene = scene;
    this.rng = makeRng(seed);
    this.onGoal = onGoal || (() => {});
    this.score = [0, 0];
    this.clock = 0;
    this.excite = 0.3;
    this.goalTimer = 0;
    this.ball = {
      mesh: new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 24), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45 })),
      pos: new THREE.Vector3(0, BALL_R, 0), vel: new THREE.Vector3(), spin: new THREE.Quaternion(), lastTouch: null,
    };
    this.ball.mesh.castShadow = true;
    scene.add(this.ball.mesh);

    this.players = [];
    const add = (team, role, x, z, kit) => {
      const mesh = makeFootballer(...kit);
      const p = { team, role, home: new THREE.Vector3(x, 0, z), pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(), yaw: team === 0 ? Math.PI / 2 : -Math.PI / 2, mesh, kickCd: 0, hold: 0, human: false };
      scene.add(mesh); this.players.push(p); return p;
    };
    const NAL = [0x0b8a3e, 0xffffff, 0x0b8a3e], MED = [0xc1121f, 0x1d3f9a, 0xc1121f];
    this.human = add(0, 'fw', -1.5, 0, NAL); this.human.human = true;
    add(0, 'mf', -14, 16, NAL); add(0, 'mf', -14, -16, NAL);
    add(0, 'gk', -HL + 1, 0, [0xffd400, 0x111111, 0xffd400]);
    add(1, 'fw', 14, 0, MED); add(1, 'df', 22, 14, MED); add(1, 'df', 22, -14, MED);
    add(1, 'gk', HL - 1, 0, [0x7a2fbf, 0x111111, 0x7a2fbf]);
    this.kickoff(0);
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
  }

  kickoff(team) {
    this.ball.pos.set(0, BALL_R, 0); this.ball.vel.set(0, 0, 0);
    for (const p of this.players) { p.pos.copy(p.home); p.vel.set(0, 0, 0); if (p.human) p.pos.set(team === 0 ? -0.8 : -9, 0, 0); p.hold = 0; }
    this.goalTimer = 0;
  }

  // input: { move: Vector2 (world x,z desired dir), sprint, kick: {power, chip} | null }
  update(dt, input) {
    this.clock += dt;
    this.excite = Math.max(0.3, this.excite - dt * 0.25);
    const ball = this.ball;
    if (this.goalTimer > 0) { this.goalTimer -= dt; if (this.goalTimer <= 0) this.kickoff(this.lastScorer === 0 ? 1 : 0); }

    for (const p of this.players) {
      p.kickCd = Math.max(0, p.kickCd - dt);
      const desired = new THREE.Vector3();
      let speed = 0;
      if (p.human && input) {
        if (input.move) { desired.set(input.move.x, 0, input.move.y); speed = input.sprint ? 8.5 : 6; }
      } else if (p.role === 'gk') {
        const gx = p.team === 0 ? -HL + 0.8 : HL - 0.8;
        const dist = Math.abs(ball.pos.x - gx);
        const tz = THREE.MathUtils.clamp(ball.pos.z * (dist < 20 ? 0.8 : 0.3), -GOAL.halfW + 0.4, GOAL.halfW - 0.4);
        const tx = gx + (p.team === 0 ? 1 : -1) * Math.min(4, Math.max(0, 16 - dist) * 0.25);
        desired.set(tx - p.pos.x, 0, tz - p.pos.z);
        speed = Math.min(7, desired.length() * 4);
        if (p.hold > 0) {
          p.hold -= dt; ball.pos.set(p.pos.x + (p.team === 0 ? 0.5 : -0.5), 1.1, p.pos.z); ball.vel.set(0, 0, 0);
          if (p.hold <= 0) { ball.vel.set((p.team === 0 ? 1 : -1) * 22, 9, (this.rng() - 0.5) * 16); p.kickCd = 1; }
        }
      } else {
        // outfield AI: closest player of the team chases, others keep shape relative to the ball
        const team = this.players.filter((q) => q.team === p.team && q.role !== 'gk');
        let closest = team[0], best = 1e9;
        for (const q of team) { const d = q.pos.distanceToSquared(ball.pos); if (d < best) { best = d; closest = q; } }
        if (closest === p && !(p.team === 0 && this.human && closest !== this.human && this.human.pos.distanceTo(ball.pos) < 6)) {
          const goalX = p.team === 0 ? HL : -HL;
          // approach from behind the ball relative to the goal
          this._v.set(goalX - ball.pos.x, 0, -ball.pos.z).normalize();
          desired.set(ball.pos.x - this._v.x * 0.6 - p.pos.x, 0, ball.pos.z - this._v.z * 0.6 - p.pos.z);
          speed = 6.8;
          const d = Math.hypot(ball.pos.x - p.pos.x, ball.pos.z - p.pos.z);
          if (d < 1.0 && ball.pos.y < 0.6 && p.kickCd <= 0 && this.goalTimer <= 0) {
            const toGoal = Math.abs(goalX - ball.pos.x);
            const pw = toGoal < 28 ? 0.75 + this.rng() * 0.25 : 0.35;
            const aimZ = toGoal < 28 ? (this.rng() - 0.5) * 6 : ball.pos.z * 0.5;
            this._w.set(goalX - ball.pos.x, 0, aimZ - ball.pos.z).normalize();
            ball.vel.set(this._w.x * (8 + 20 * pw), 1 + 4 * pw * this.rng(), this._w.z * (8 + 20 * pw));
            ball.lastTouch = p; p.kickCd = 0.9;
          }
        } else {
          const shift = THREE.MathUtils.clamp(ball.pos.x, -30, 30) * 0.6;
          desired.set(p.home.x + shift - p.pos.x, 0, p.home.z + ball.pos.z * 0.3 - p.pos.z);
          speed = Math.min(5, desired.length() * 1.2);
        }
      }
      if (desired.lengthSq() > 1e-6) desired.normalize().multiplyScalar(speed);
      p.vel.lerp(desired, Math.min(1, dt * 6));
      p.pos.addScaledVector(p.vel, dt);
      p.pos.x = THREE.MathUtils.clamp(p.pos.x, -HL - 4, HL + 4);
      p.pos.z = THREE.MathUtils.clamp(p.pos.z, -HW - 3, HW + 3);
      const sp = Math.hypot(p.vel.x, p.vel.z);
      if (sp > 0.3) p.yaw = Math.atan2(p.vel.x, p.vel.z);

      // human dribbling and shooting
      if (p.human && input && this.goalTimer <= 0) {
        const dx = ball.pos.x - p.pos.x, dz = ball.pos.z - p.pos.z, d = Math.hypot(dx, dz);
        const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
        if (input.kick && d < 1.6 && ball.pos.y < 0.8) {
          const { power, chip } = input.kick;
          if (chip) ball.vel.set(fx * (11 + 9 * power), 8 + 5 * power, fz * (11 + 9 * power));
          else ball.vel.set(fx * (10 + 22 * power), 1.5 + 5 * power * power, fz * (10 + 22 * power));
          ball.lastTouch = p; p.kickCd = 0.3;
        } else if (d < 0.95 && ball.pos.y < 0.5 && sp > 0.5 && p.kickCd <= 0) {
          const tx = p.pos.x + fx * 0.75, tz = p.pos.z + fz * 0.75;
          ball.vel.x = p.vel.x * 1.05 + (tx - ball.pos.x) * 5;
          ball.vel.z = p.vel.z * 1.05 + (tz - ball.pos.z) * 5;
          ball.lastTouch = p;
        }
      } else if (!p.human && p.role !== 'gk') {
        // AI body collision with ball
        const dx = ball.pos.x - p.pos.x, dz = ball.pos.z - p.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.45 && ball.pos.y < 1) { ball.vel.x += dx / d * 2; ball.vel.z += dz / d * 2; }
      }
      // goalkeeper saves
      if (p.role === 'gk' && p.hold <= 0 && p.kickCd <= 0) {
        const d = p.pos.distanceTo(this._v.set(ball.pos.x, 0, ball.pos.z));
        const incoming = (p.team === 0 ? -ball.vel.x : ball.vel.x) > 2;
        if (d < 1.6 && ball.pos.y < 2.4 && incoming) {
          const sp2 = ball.vel.length();
          const save = sp2 < 18 ? 0.9 : sp2 < 26 ? 0.55 : 0.3;
          if (this.rng() < save) { p.hold = 1.2; ball.lastTouch = p; this.excite = Math.min(1.3, this.excite + 0.4); }
          else p.kickCd = 1.5;
        }
      }
    }

    this.updateBall(dt);
    this.updateMeshes(dt);
  }

  updateBall(dt) {
    const b = this.ball;
    const p = b.pos, v = b.vel;
    v.y -= 9.81 * dt;
    const drag = 1 - Math.min(0.5, 0.012 * v.length() * dt);
    v.multiplyScalar(drag);
    p.addScaledVector(v, dt);
    const gh = Math.max(0, groundHeight(p.x, p.z));
    if (p.y < gh + BALL_R) {
      p.y = gh + BALL_R;
      if (v.y < -1.2) v.y = -v.y * 0.55; else v.y = 0;
      const f = Math.max(0, 1 - 1.1 * dt);
      v.x *= f; v.z *= f;
    }
    // posts & crossbar
    for (const s of [1, -1]) {
      const gx = s * HL;
      for (const pz of [-GOAL.halfW, GOAL.halfW]) {
        const dx = p.x - gx, dz = p.z - pz, d = Math.hypot(dx, dz);
        if (d < BALL_R + GOAL.post && p.y < GOAL.h) { const nx = dx / d, nz = dz / d, vn = v.x * nx + v.z * nz; if (vn < 0) { v.x -= 1.7 * vn * nx; v.z -= 1.7 * vn * nz; } p.x = gx + nx * (BALL_R + GOAL.post); p.z = pz + nz * (BALL_R + GOAL.post); }
      }
      const dx = p.x - gx, dy = p.y - GOAL.h, d = Math.hypot(dx, dy);
      if (Math.abs(p.z) < GOAL.halfW && d < BALL_R + GOAL.post) { const nx = dx / d, ny = dy / d, vn = v.x * nx + v.y * ny; if (vn < 0) { v.x -= 1.7 * vn * nx; v.y -= 1.7 * vn * ny; } }
      // goal and net
      const inMouth = Math.abs(p.z) < GOAL.halfW - BALL_R && p.y < GOAL.h - BALL_R;
      if (s * p.x > HL + BALL_R && inMouth && this.goalTimer <= 0 && s * p.x < HL + 1) {
        const team = s > 0 ? 0 : 1;
        this.score[team]++; this.lastScorer = team; this.goalTimer = 3.5; this.excite = 2.2;
        this.onGoal(team, this.score);
      }
      if (s * p.x > HL && Math.abs(p.z) < GOAL.halfW + 0.3 && p.y < GOAL.h + 0.2) {
        if (s * p.x > HL + GOAL.depth - BALL_R) { p.x = s * (HL + GOAL.depth - BALL_R); v.x *= -0.15; v.z *= 0.5; }
        if (Math.abs(p.z) > GOAL.halfW - BALL_R && s * p.x > HL + 0.2) { p.z = Math.sign(p.z) * (GOAL.halfW - BALL_R); v.z *= -0.2; }
      }
    }
    // advertising boards
    if (Math.abs(p.z) > 38.3 && Math.abs(p.x) < 52 && p.y < 1) { p.z = Math.sign(p.z) * 38.3; v.z *= -0.5; }
    if (Math.abs(p.x) > 57.6 && Math.abs(p.z) < 18 && p.y < 1) { p.x = Math.sign(p.x) * 57.6; v.x *= -0.5; }
    // stand front wall
    if (groundHeight(p.x, p.z) > p.y) { v.multiplyScalar(-0.4); p.addScaledVector(v, dt * 2); }
    // out of play -> back to the pitch after a moment
    const out = Math.abs(p.x) > HL + 0.5 || Math.abs(p.z) > HW + 0.5;
    if (out && this.goalTimer <= 0) {
      this.outTimer = (this.outTimer || 0) + dt;
      if (this.outTimer > 1.6) {
        this.outTimer = 0;
        p.set(THREE.MathUtils.clamp(p.x, -HL + 6, HL - 6), BALL_R, THREE.MathUtils.clamp(p.z, -HW + 1, HW - 1)); v.set(0, 0, 0);
      }
    } else this.outTimer = 0;
  }

  updateMeshes(dt) {
    const b = this.ball;
    b.mesh.position.copy(b.pos);
    const sp = Math.hypot(b.vel.x, b.vel.z);
    if (sp > 0.01) {
      const axis = new THREE.Vector3(b.vel.z, 0, -b.vel.x).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(axis, sp * dt / BALL_R);
      b.mesh.quaternion.premultiply(q);
    }
    for (const p of this.players) {
      const m = p.mesh, u = m.userData;
      m.position.copy(p.pos);
      m.rotation.y = p.yaw;
      const sp2 = Math.hypot(p.vel.x, p.vel.z);
      u.phase += dt * sp2 * 2.2;
      const sw = Math.sin(u.phase) * Math.min(1, sp2 / 5) * 0.8;
      u.legL.rotation.x = sw; u.legR.rotation.x = -sw; u.armL.rotation.x = -sw * 0.8; u.armR.rotation.x = sw * 0.8;
      if (p.role === 'gk' && p.hold > 0) { u.armL.rotation.x = u.armR.rotation.x = -1.4; }
    }
  }
}

// ------------------------------------------------------------------ explorer (first person)
export class Explorer {
  constructor() {
    this.pos = new THREE.Vector3(0, 0, 0);
    this.vy = 0; this.yaw = 0; this.pitch = 0; this.onGround = true;
    this.reset();
  }
  reset() {
    // start in the upper Occidental tier looking at the pitch
    this.pos.set(0, 0, 90); this.pos.y = groundHeight(0, 90);
    this.yaw = Math.PI; this.pitch = -0.25; this.vy = 0;
  }
  update(dt, input) {
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); // forward
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);  // right
    const f = input.forward || 0, s = input.strafe || 0;
    const sp = input.sprint ? 9 : 4.5;
    const dx = (fx * f + rx * s) * sp, dz = (fz * f + rz * s) * sp;
    const step = 0.62;
    const tryMove = (nx, nz) => {
      const gh = groundHeight(nx, nz);
      if (gh - this.pos.y <= step || gh <= this.pos.y + 0.01) { this.pos.x = nx; this.pos.z = nz; return true; }
      return false;
    };
    const nx = this.pos.x + dx * dt, nz = this.pos.z + dz * dt;
    if (!tryMove(nx, nz)) { tryMove(nx, this.pos.z) || tryMove(this.pos.x, nz); }
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > 640) { this.pos.x *= 640 / r; this.pos.z *= 640 / r; }
    const gh = groundHeight(this.pos.x, this.pos.z);
    if (input.jump && this.onGround) { this.vy = 5.2; this.onGround = false; }
    this.vy -= 12 * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= gh) {
      if (gh - this.pos.y < step + 0.05 || this.vy <= 0) { this.pos.y = gh; this.vy = 0; this.onGround = true; }
    } else if (this.pos.y - gh > 0.05) this.onGround = false;
  }
  applyCamera(cam) {
    cam.position.set(this.pos.x, this.pos.y + 1.65, this.pos.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
