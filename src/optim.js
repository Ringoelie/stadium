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

// Merge every static mesh under `root` that shares a material (and shadow flags) into one
// mesh, with the world transform baked into the vertices. Multi-material meshes are split by
// group first. Subtrees flagged with userData.dynamic are left alone.
export function mergeStatic(root, mergeGeometries) {
  root.updateMatrixWorld(true);
  const buckets = new Map();
  const victims = [];
  const isDynamic = (o) => { for (let p = o; p; p = p.parent) if (p.userData.dynamic) return true; return false; };
  root.traverse((o) => {
    // big meshes are already one draw call each and keep their own frustum culling
    if (!o.isMesh || o.isInstancedMesh || isDynamic(o) || o.geometry.attributes.position.count > 20000) return;
    const parts = [];
    if (Array.isArray(o.material)) {
      const g = o.geometry;
      for (const grp of g.groups) {
        const sub = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(g.attributes)) sub.setAttribute(name, attr);
        sub.setIndex(Array.from(g.index.array.slice(grp.start, grp.start + grp.count)));
        parts.push([sub, o.material[grp.materialIndex]]);
      }
    } else parts.push([o.geometry, o.material]);
    for (const [geo, mat] of parts) {
      const g = geo.clone();
      g.applyMatrix4(o.matrixWorld);
      if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
      g.morphAttributes = {};
      const sig = Object.keys(g.attributes).sort().join(',');
      const key = `${mat.uuid}|${o.castShadow}|${o.receiveShadow}|${sig}`;
      if (!buckets.has(key)) buckets.set(key, { mat, cast: o.castShadow, recv: o.receiveShadow, geos: [], names: [] });
      const b = buckets.get(key); b.geos.push(g); b.names.push(o.name);
    }
    victims.push(o);
  });
  for (const o of victims) o.parent.remove(o);
  let meshes = 0;
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    merged.computeBoundingSphere(); merged.computeBoundingBox();
    const m = new THREE.Mesh(merged, b.mat);
    m.castShadow = b.cast; m.receiveShadow = b.recv;
    m.name = b.names.find((n) => n) || 'merged';
    m.matrixAutoUpdate = false;
    root.add(m);
    meshes++;
  }
  return { before: victims.length, after: meshes };
}

// Objects whose bounds lie completely outside the directional light's shadow camera cannot
// cast into the shadow map nor receive from it (lookups outside the map read as "lit"),
// so their shadow flags are cleared: fewer objects in the shadow pass, no PCF lookups.
export function pruneShadows(root, light) {
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);
  light.shadow.updateMatrices(light);
  const cam = light.shadow.camera;
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const sphere = new THREE.Sphere();
  root.updateMatrixWorld(true);
  let pruned = 0;
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    sphere.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
    if (!frustum.intersectsSphere(sphere)) { if (o.castShadow || o.receiveShadow) pruned++; o.castShadow = false; o.receiveShadow = false; }
  });
  return pruned;
}
