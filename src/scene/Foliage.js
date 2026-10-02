// Vegetation for the crossing: wind-swept instanced grass blades, Poly Haven (CC0) plant models
// scattered along the verges and two hero trees, all on the viewer's side of the tracks (the far side is
// Route 134 and the sea). Everything is in meters inside the crossing group.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { REFS, groundY } from './Crossing.js';

const MODELS = 'assets/polyhaven/models/';
const TRACK_Z = -11;
const wind = { value: 0 }; // shared time uniform
// Past the tracks is Route 134 and the sea: plants only on the viewer's side.
const NEAR_Z = TRACK_Z + 2.6;

// Add sway to a standard material: displacement grows with height above the instance origin.
function windy(mat, strength, heightScale) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 iw = instanceMatrix[3].xyz;
      #else
        vec3 iw = vec3(0.0);
      #endif
      float hgt = clamp(position.y / ${heightScale.toFixed(3)}, 0.0, 1.0);
      float sway = sin(uTime * 1.7 + iw.x * 0.35 + iw.z * 0.22) * 0.6 + sin(uTime * 3.1 + iw.z * 0.9) * 0.25;
      transformed.x += sway * ${strength.toFixed(3)} * hgt * hgt;
      transformed.z += cos(uTime * 1.3 + iw.x * 0.5) * ${(strength * 0.5).toFixed(3)} * hgt * hgt;`);
  };
  mat.customProgramCacheKey = () => `windy${strength}${heightScale}`;
  return mat;
}

// --- grass blades -----------------------------------------------------------------------------------
function bladeGeometry() {
  const seg = 4, w = 0.035, h = 0.42, pos = [], uv = [], nor = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, ww = w * (1 - t * 0.9), bend = t * t * 0.12;
    pos.push(-ww, t * h, bend, ww, t * h, bend);
    uv.push(0, t, 1, t);
    nor.push(0, 1, 0, 0, 1, 0); // up-facing normals: soft, even lighting like painted grass
    if (i < seg) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function grassField(count) {
  const mat = windy(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.75, vertexColors: true }), 0.06, 0.42);
  const geo = bladeGeometry();
  // base dark, tip light (per-vertex), instance colour varies hue a little
  const col = []; for (let i = 0; i < geo.attributes.position.count; i++) { const t = geo.attributes.uv.getY(i); col.push(0.12 + 0.38 * t, 0.2 + 0.42 * t, 0.07 + 0.16 * t); } // dark roots -> sunlit tips
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
  let n = 0;
  for (let a = 0; a < count; a++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    // denser near the road edge and near the viewer
    const x = side * (3.0 + Math.pow(Math.random(), 1.6) * 9), z = 1.2 - Math.pow(Math.random(), 1.4) * (1.2 - NEAR_Z);
    if (z < NEAR_Z) continue;
    q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.35, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.35));
    s.set(1, 0.55 + Math.random() * 0.9, 1);
    mesh.setMatrixAt(n, m.compose(new THREE.Vector3(x, groundY(z), z), q, s));
    mesh.setColorAt(n, c.setHSL(0.2 + Math.random() * 0.08, 0.35 + Math.random() * 0.15, 0.5 + Math.random() * 0.25)); // olive..green, some dry
    n++;
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

// --- glTF plants --------------------------------------------------------------------------------------
const gltf = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'));
// trees use the real-time version made by scripts/lighten_tree.py
const FILE = { jacaranda_tree: 'jacaranda_tree/jacaranda_tree_rt.glb' };
// Poly Haven plant files often hold several variants laid out ~1 m apart (fern_02_a..d). Each variant is
// re-centred and gets its own share of the placements; parts of one plant (sorrel leaves) stay together.
async function variants(name) {
  const g = await gltf.loadAsync(MODELS + (FILE[name] ?? `${name}/${name}.gltf`));
  g.scene.updateMatrixWorld(true);
  const kids = g.scene.children, spread = Math.max(...kids.map((k) => Math.hypot(k.position.x, k.position.z)));
  const groups = spread > 0.5 ? kids.map((k) => [k, k.position.clone()]) : [[g.scene, new THREE.Vector3()]];
  return groups.map(([root, origin]) => {
    const out = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld).translate(-origin.x, -origin.y, -origin.z);
      const mat = o.material;
      mat.transparent = false; mat.alphaTest = 0.5; mat.depthWrite = true; // leaves are real geometry; skip blend sorting
      out.push({ geo, mat });
    });
    return out;
  });
}
function instance(model, transforms, { shadows = true, wind: w } = {}) {
  const group = new THREE.Group();
  model.forEach((pieces, v) => {
    const ts = transforms.filter((_, i) => i % model.length === v);
    if (!ts.length) return;
    for (const { geo, mat } of pieces) {
      if (w && !mat.userData.windy) { geo.computeBoundingBox(); windy(mat, w, geo.boundingBox.max.y || 1); mat.userData.windy = true; }
      const im = new THREE.InstancedMesh(geo, mat, ts.length);
      ts.forEach((t, i) => im.setMatrixAt(i, t));
      im.castShadow = shadows; im.receiveShadow = true;
      group.add(im);
    }
  });
  return group;
}
const place = (x, z, scale, rotY = Math.random() * 6.28) => new THREE.Matrix4().compose(new THREE.Vector3(x, groundY(z), z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), new THREE.Vector3().setScalar(scale));
function verge(count, minX, maxX, z0, z1, scale) {
  const out = [];
  for (let a = 0; a < count; a++) {
    const side = Math.random() < 0.5 ? -1 : 1, x = side * (minX + Math.random() * (maxX - minX)), z = z0 - Math.random() * (z0 - z1);
    if (z < NEAR_Z) continue;
    out.push(place(x, z, scale[0] + Math.random() * (scale[1] - scale[0])));
  }
  return out;
}

export async function addFoliage(g, renderer, { models = true } = {}) {
  const has = models && await fetch(`${MODELS}fern_02/fern_02.gltf`, { method: 'HEAD' }).then((r) => r.ok, () => false);
  const grass = grassField(16000);
  grass.userData.noAO = true;
  g.add(grass);
  REFS.grass = grass;
  if (REFS.tufts) REFS.tufts.visible = false; // old card grass
  if (!has) return { tick(t) { wind.value = t; } };

  const [fern, weed, sorrel, shrub, dandelion, tree] = await Promise.all(['fern_02', 'weed_plant_02', 'shrub_sorrel_01', 'shrub_04', 'dandelion_01', 'jacaranda_tree'].map(variants));
  const plants = new THREE.Group();
  plants.add(instance(fern, verge(18, 3.4, 8, 0, NEAR_Z, [0.7, 1.2]), { wind: 0.05 }));
  plants.add(instance(weed, verge(16, 3.1, 7, 1, NEAR_Z, [0.8, 1.4]), { wind: 0.06 }));
  plants.add(instance(sorrel, verge(35, 3.05, 6, 1, NEAR_Z, [0.8, 1.5]), { shadows: false, wind: 0.03 }));
  plants.add(instance(dandelion, verge(20, 3.05, 6, 1, NEAR_Z, [0.9, 1.3]), { shadows: false, wind: 0.04 }));
  plants.add(instance(shrub, verge(8, 5.5, 11, -1, NEAR_Z, [0.9, 1.6]), { wind: 0.04 }));
  // hero trees close to the crossing, one each side
  const heroes = instance(tree, [place(-8.5, -4.5, 0.55, 0.6), place(9.5, -1.5, 0.6, 2.2)], { wind: 0.12 });
  plants.add(heroes);
  plants.userData.noAO = true;
  g.add(plants);
  REFS.plants = plants;
  for (const p of tree.flat()) if (/leaves/i.test(p.mat.name)) { REFS.leaves.push(p.mat); p.mat.userData.dry = { color: p.mat.color.clone(), map: p.mat.map, normalMap: p.mat.normalMap, roughnessMap: p.mat.roughnessMap, roughness: p.mat.roughness }; }

  return { tick(t) { wind.value = t; } };
}
