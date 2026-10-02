// Vegetation for the crossing: wind-swept instanced grass tufts, Poly Haven (CC0) plant models
// scattered along the verges and stylised leaf-card trees, all on the viewer's side of the tracks (the far side is
// Route 134 and the sea). Everything is in meters inside the crossing group.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { REFS, groundY } from './Crossing.js';

const MODELS = 'assets/polyhaven/models/';
const TRACK_Z = -11;
const wind = { value: 0 }; // shared time uniform
// Past the tracks is Route 134 and the sea: plants only on the viewer's side.
const NEAR_Z = TRACK_Z + 2.6;
// ink outlines are for the character only; without this flag every blade and leaf was drawn a second time
const noInk = (o) => { o.traverse((m) => { for (const mat of [].concat(m.material ?? [])) mat.userData.outlineParameters = { visible: false }; }); return o; };

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

// --- grass ---------------------------------------------------------------------------------------------
// One instance = a tuft of 6 curved blades. Near the eye every blade stands; with distance each blade's rank
// is compared against a falling keep-ratio and the losers shrink into their roots, so far verges cost almost
// nothing while the ground texture carries the colour. A slow gust wave rolls across the field: it bends the
// blades and lights up their tips as it passes, the way grass shimmers in anime backgrounds.
const BLADES = 6, SEG = 3;
function tuftGeometry() {
  const pos = [], uv = [], col = [], rank = [], root = [], idx = [];
  for (let b = 0; b < BLADES; b++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 0.09, rx = Math.cos(a) * r, rz = Math.sin(a) * r;
    const h = 0.26 + Math.random() * 0.26, w = 0.028 + Math.random() * 0.014, yaw = Math.random() * Math.PI;
    const lean = 0.06 + Math.random() * 0.12, cy = Math.cos(yaw), sy = Math.sin(yaw), k = Math.random(), base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG, ww = w * (1 - t * 0.92), bend = t * t * lean;
      for (const sx of [-1, 1]) {
        const lx = sx * ww, lz = bend; // blade frame, then turned by yaw
        pos.push(rx + lx * cy - lz * sy, t * h, rz + lx * sy + lz * cy);
        uv.push(sx < 0 ? 0 : 1, t);
        col.push(0.08 + 0.3 * t, 0.15 + 0.36 * t, 0.05 + 0.12 * t); // dark roots -> sunlit tips
        rank.push(k); root.push(rx, rz);
      }
      if (i < SEG) { const v = base + i * 2; idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3)); // up: soft painted lighting
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aRank', new THREE.Float32BufferAttribute(rank, 1));
  g.setAttribute('aRoot', new THREE.Float32BufferAttribute(root, 2));
  g.setIndex(idx);
  return g;
}
function grassField(count) {
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.75, vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aRank;\nattribute vec2 aRoot;\nvarying float vGust;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 iw = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float S = length(modelMatrix[0].xyz);                       // scene units per metre
        float dist = distance(iw, cameraPosition) / S;
        float keep = mix(1.0, 0.18, smoothstep(5.0, 20.0, dist));    // share of blades still standing
        float alive = smoothstep(aRank - 0.1, aRank, keep);
        transformed = mix(vec3(aRoot.x, 0.0, aRoot.y), transformed, alive);
        vec2 wp = iw.xz / S;
        float hgt = clamp(position.y / 0.52, 0.0, 1.0), h2 = hgt * hgt;
        float gust = sin(dot(wp, vec2(0.8, 0.6)) * 0.3 - uTime * 1.3) * 0.5 + 0.5;
        gust = gust * gust;
        float sway = sin(uTime * 1.9 + wp.x * 0.7 + wp.y * 0.4) * 0.25 + gust;
        transformed.x += sway * 0.09 * h2;
        transformed.z += sin(uTime * 1.3 + wp.x * 0.5) * 0.03 * h2;
        vGust = gust * hgt;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGust;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb *= 1.0 + vGust * 0.45;');
  };
  mat.customProgramCacheKey = () => 'grass-tuft';
  const mesh = new THREE.InstancedMesh(tuftGeometry(), mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), c = new THREE.Color();
  let n = 0;
  for (let a = 0; a < count; a++) {
    const side = Math.random() < 0.5 ? -1 : 1;
    // denser near the road edge and near the viewer
    const x = side * (3.0 + Math.pow(Math.random(), 1.6) * 9), z = 1.2 - Math.pow(Math.random(), 1.4) * (1.2 - NEAR_Z);
    if (z < NEAR_Z) continue;
    q.setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.2, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.2));
    s.set(1, 0.7 + Math.random() * 0.7, 1);
    mesh.setMatrixAt(n, m.compose(new THREE.Vector3(x, groundY(z), z), q, s));
    mesh.setColorAt(n, c.setHSL(0.2 + Math.random() * 0.08, 0.35 + Math.random() * 0.15, 0.5 + Math.random() * 0.25)); // olive..green, some dry
    n++;
  }
  mesh.count = n;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

// --- trees ---------------------------------------------------------------------------------------------
// Stylised leaf-card trees (the Ghibli / Genshin approach): a tapered trunk and branches, and a crown of a
// few hundred alpha-cut cards painted with leaf clusters. Card normals point out from the crown, so the whole
// crown shades like one soft volume instead of thousands of tiny leaves. About 600 triangles per tree.
function leafTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * 100;
    const px = 128 + Math.cos(a) * d, py = 128 + Math.sin(a) * d, len = 16 + Math.random() * 16;
    const l = 20 + Math.random() * 22 + (1 - d / 100) * 8;
    x.save(); x.translate(px, py); x.rotate(Math.random() * Math.PI * 2);
    x.fillStyle = `hsl(${92 + Math.random() * 28}, ${32 + Math.random() * 18}%, ${l}%)`;
    x.beginPath(); x.ellipse(0, 0, len, len * 0.42, 0, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(20,40,10,0.35)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(-len, 0); x.lineTo(len, 0); x.stroke();
    x.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function makeTree(seed) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const H = 2.4 + rnd() * 0.6, crown = new THREE.Vector3(0, H + 1.7, 0);
  const wood = [];
  const limb = (a, b, r0, r1) => {
    const d = b.clone().sub(a), len = d.length(), g = new THREE.CylinderGeometry(r1, r0, len, 7, 1);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    g.translate(a.x, a.y, a.z); wood.push(g);
  };
  const top = new THREE.Vector3((rnd() - 0.5) * 0.4, H, (rnd() - 0.5) * 0.4);
  limb(new THREE.Vector3(0, 0, 0), top, 0.2, 0.13);
  const clusters = [crown.clone().add(new THREE.Vector3(0, 0.6, 0))];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.6, rr = 1.3 + rnd() * 0.6;
    clusters.push(new THREE.Vector3(Math.cos(a) * rr, crown.y - 0.3 + rnd() * 1.0, Math.sin(a) * rr));
  }
  for (const c of clusters.slice(1)) limb(top, c.clone().multiplyScalar(0.75).setY(c.y - 0.4), 0.09, 0.04);
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), n = new THREE.Vector3();
  for (const c of clusters) {
    const cr = 0.95 + rnd() * 0.4;
    for (let k = 0; k < 42; k++) {
      const p = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(cr * Math.cbrt(rnd())).add(c);
      n.copy(p).sub(crown).normalize().multiplyScalar(0.7).add(v.copy(p).sub(c).normalize().multiplyScalar(0.3)).normalize();
      q.setFromEuler(e.set(rnd() * 6.28, rnd() * 6.28, rnd() * 6.28));
      const sz = 0.55 + rnd() * 0.35, shade = 0.8 + rnd() * 0.3, base = pos.length / 3;
      for (const [ux, uy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        v.set((ux - 0.5) * sz * 2, (uy - 0.5) * sz * 2, 0).applyQuaternion(q).add(p);
        pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z); uv.push(ux, uy); col.push(shade, shade, shade);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  leaves.setIndex(idx);
  return { leaves, wood: mergeGeometries(wood) };
}
export function trees(spots, ground = groundY) {
  const leafMat = windy(new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true, roughness: 0.85 }), 0.1, 6);
  const barkMat = new THREE.MeshStandardMaterial({ color: '#5e4a3a', roughness: 0.95 });
  REFS.leaves.push(leafMat); leafMat.userData.dry = { color: leafMat.color.clone(), map: leafMat.map };
  const group = new THREE.Group();
  [makeTree(7), makeTree(31)].forEach((t, v) => {
    const ts = spots.filter((_, i) => i % 2 === v).map(([x, z, sc]) => place(x, z, sc).setPosition(x, ground(z), z));
    for (const [geo, mat] of [[t.leaves, leafMat], [t.wood, barkMat]]) {
      const im = new THREE.InstancedMesh(geo, mat, ts.length);
      ts.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = im.receiveShadow = true; group.add(im);
    }
  });
  return group;
}

// --- glTF plants --------------------------------------------------------------------------------------
const gltf = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'));
// Poly Haven plant files often hold several variants laid out ~1 m apart (fern_02_a..d). Each variant is
// re-centred and gets its own share of the placements; parts of one plant (sorrel leaves) stay together.
async function variants(name) {
  const g = await gltf.loadAsync(`${MODELS}${name}/${name}.gltf`);
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
// Poly Haven plants ship heavy LOD0 variants next to light ones (dandelion a/b ~23k triangles, c-e ~2-3k);
// keep only variants within reach of the lightest so a verge weed never costs more than a tree.
const light = (model) => {
  const tris = (v) => v.reduce((n, { geo }) => n + (geo.index ? geo.index.count : geo.attributes.position.count) / 3, 0);
  const min = Math.min(...model.map(tris));
  return model.filter((v) => tris(v) <= Math.max(min * 2, 6000));
};
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
  const grass = grassField(4500);
  grass.userData.noAO = true; noInk(grass);
  g.add(grass);
  REFS.grass = grass;
  if (REFS.tufts) REFS.tufts.visible = false; // old card grass
  // trees along the verges on the viewer's side (cheap enough now for more than two)
  const grove = noInk(trees([[-8.5, -4.5, 1], [9.5, -1.5, 1.1], [-13, -1.5, 0.9], [13.5, -6.5, 0.85], [-16.5, -7, 1.05], [17, 0.5, 0.95]]));
  grove.userData.noAO = true; // the AO normal pass ignores alpha: cards came out as dark boxes round the crowns
  g.add(grove);
  if (!has) return { tick(t) { wind.value = t; } };

  const [fern, weed, sorrel, shrub, dandelion] = await Promise.all(['fern_02', 'weed_plant_02', 'shrub_sorrel_01', 'shrub_04', 'dandelion_01'].map(variants));
  const plants = new THREE.Group();
  plants.add(instance(fern, verge(18, 3.4, 8, 0, NEAR_Z, [0.7, 1.2]), { wind: 0.05 }));
  plants.add(instance(weed, verge(16, 3.1, 7, 1, NEAR_Z, [0.8, 1.4]), { wind: 0.06 }));
  plants.add(instance(sorrel, verge(35, 3.05, 6, 1, NEAR_Z, [0.8, 1.5]), { shadows: false, wind: 0.03 }));
  plants.add(instance(light(dandelion), verge(20, 3.05, 6, 1, NEAR_Z, [0.9, 1.3]), { shadows: false, wind: 0.04 }));
  plants.add(instance(shrub, verge(5, 5.5, 11, -1, NEAR_Z, [0.9, 1.6]), { shadows: false, wind: 0.04 })); // 27k triangles each: few, no shadow
  plants.userData.noAO = true;
  g.add(plants);
  noInk(plants);
  REFS.plants = plants;

  return { tick(t) { wind.value = t; } };
}
