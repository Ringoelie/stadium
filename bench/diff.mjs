import fs from 'node:fs'; import { PNG } from 'pngjs';
const [a, b, out] = process.argv.slice(2);
const A = PNG.sync.read(fs.readFileSync(a)), B = PNG.sync.read(fs.readFileSync(b));
const o = new PNG({ width: A.width, height: A.height });
let sd = [0,0,0];
for (let i = 0; i < A.data.length; i += 4) {
  const d = Math.abs(A.data[i]-B.data[i]) + Math.abs(A.data[i+1]-B.data[i+1]) + Math.abs(A.data[i+2]-B.data[i+2]);
  for (let c=0;c<3;c++) sd[c] += A.data[i+c]-B.data[i+c];
  const v = Math.min(255, d * 4);
  o.data[i] = v; o.data[i+1] = v; o.data[i+2] = v; o.data[i+3] = 255;
}
const n = A.data.length/4; console.log('mean signed diff rgb', sd.map(x => (x/n).toFixed(2)).join(' '));
fs.writeFileSync(out, PNG.sync.write(o));
