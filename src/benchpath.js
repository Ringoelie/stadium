// Deterministic camera path used by the benchmark and the quality captures.
// Six shots of 60 frames each cover the typical ways the stadium is viewed.
export const BENCH_FRAMES = 360;
export const SHOTS = 6;

export function benchCamera(cam, f, game) {
  const per = BENCH_FRAMES / SHOTS;
  const s = Math.min(SHOTS - 1, Math.floor(f / per));
  const t = (f - s * per) / per;
  const b = game.ball.pos, p = game.human.pos;
  switch (s) {
    case 0: { // aerial orbit
      const a = 0.6 + t * 0.9;
      cam.position.set(Math.cos(a) * 230, 125, Math.sin(a) * 200);
      cam.lookAt(0, 0, 0); break;
    }
    case 1: // broadcast camera on the Occidental roof line following the ball
      cam.position.set(b.x * 0.55, 26, 88);
      cam.lookAt(b.x, 0, b.z * 0.6); break;
    case 2: { // behind the player
      const yaw = Math.PI / 2 - 0.25 + t * 0.5;
      cam.position.set(p.x - Math.sin(yaw) * 8.5, 4.2, p.z - Math.cos(yaw) * 8.5);
      cam.lookAt(p.x + Math.sin(yaw) * 5, 1.2, p.z + Math.cos(yaw) * 5); break;
    }
    case 3: // fan in the Sur popular stand
      cam.position.set(-L_ - 60 + t * 4, 16.5, 12 - t * 8);
      cam.lookAt(10, 0, -8 + t * 20); break;
    case 4: // pitch level behind the Norte goal
      cam.position.set(59, 1.7, -7 + t * 14);
      cam.lookAt(0, 3, 0); break;
    default: { // outside: city, metro and mountains
      const a = 2.35 + t * 0.25;
      cam.position.set(Math.cos(a) * 420, 55, Math.sin(a) * 330);
      cam.lookAt(0, 20, 0);
    }
  }
}
const L_ = 42.195;
