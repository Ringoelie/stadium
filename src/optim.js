import * as THREE from 'three/webgpu';
import { renderOutput } from 'three/tsl';

// Replace a rough, non-metallic MeshStandardMaterial by an equivalent Lambert material.
// With roughness >= 0.85 and no environment map the GGX specular term is a small
// contribution, while the diffuse term (Lambert) is identical.
export function toLambert(m) {
  if (!m || !(m.isMeshStandardMaterial || m.isMeshStandardNodeMaterial) || m.isMeshPhysicalMaterial || m.metalness > 0 || m.roughness < 0.85) return m;
  const Cls = m.isMeshStandardNodeMaterial ? THREE.MeshLambertNodeMaterial : THREE.MeshLambertMaterial;
  const l = new Cls();
  for (const k of ['color', 'emissive']) l[k].copy(m[k]);
  for (const k of ['map', 'emissiveMap', 'alphaMap', 'vertexColors', 'side', 'alphaTest', 'transparent', 'opacity', 'flatShading', 'emissiveIntensity', 'fog', 'name']) l[k] = m[k];
  if (m.isMeshStandardNodeMaterial) for (const k of ['colorNode', 'positionNode']) l[k] = m[k];
  return l;
}

export function lambertize(root, filter = () => true) {
  const cache = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !filter(o)) return;
    const conv = (m) => { if (!cache.has(m)) cache.set(m, toLambert(m)); return cache.get(m); };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
}

export function inlineOutput(renderer, toneMapping, colorSpace) {
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const setupOutput = THREE.NodeMaterial.prototype.setupOutput;
  THREE.NodeMaterial.prototype.setupOutput = function (builder, outputNode) {
    return renderOutput(setupOutput.call(this, builder, outputNode), toneMapping, colorSpace);
  };
}
