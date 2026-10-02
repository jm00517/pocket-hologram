// School pool (学校のプール) on a midsummer afternoon. A 25 m, 6-lane outdoor pool seen from the start end:
// the water is a planar mirror with ripple normals, refraction-depth absorption and a sun glint; the basin
// gets moving caustics only where the sun actually reaches and a refraction wobble on its lane lines.
// Lane ropes bob, backstroke flags flutter, a pace clock sweeps. Chain-link fence, the school building on
// the right, changing rooms and a tent on the left, cicada-summer trees beyond.
// Same conventions as Crossing/Classroom: metres inside `group`, fit(scene, U) scales it.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadSky } from './Weather.js';
import { trees } from './Foliage.js';

const PX = 6.5, PZ0 = -1, PZ1 = -26, WY = -0.12, FY = -1.25; // basin half-width, near/far end, water level, floor
const LANES = [-5, -3, -1, 1, 3, 5], ROPES = [-4, -2, 0, 2, 4];
const FENCE_X = 11, FENCE_Z = -30;
const SUN_DIR = new THREE.Vector3(-0.5, 0.74, 0.46).normalize(); // toward the sun: high, behind the viewer's left
const TEX = 'assets/polyhaven/tex/';

const noInk = (o) => { o.traverse((m) => { for (const mat of [].concat(m.material ?? [])) mat.userData.outlineParameters = { visible: false }; }); return o; };
const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r, h, x = 0, y = 0, z = 0, seg = 10) => new THREE.CylinderGeometry(r, r, h, seg).translate(x, y + h / 2, z);
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
const loader = new THREE.TextureLoader();
function pbrSet(name, repeat, color = '#ffffff') {
  const tex = (f, srgb) => { const t = loader.load(`${TEX}${name}/${f}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  return new THREE.MeshStandardMaterial({ color, map: tex('diff', true), normalMap: tex('nor_gl'), roughnessMap: tex('rough') });
}
// Static parts are authored as geometries in group space and merged per material: one draw call each.
function addMerged(g, mat, geos, { cast = true, recv = true } = {}) {
  const m = new THREE.Mesh(mergeGeometries(geos.map((x) => (x.index ? x.toNonIndexed() : x))), mat);
  m.castShadow = cast; m.receiveShadow = recv; g.add(m); return m;
}
const time = { value: 0 };

// --- the basin: painted tiles, lane lines, caustics ----------------------------------------------------
const CAUSTICS = /* glsl */`
  vec2 h2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  float cellEdge(vec2 p, float t) { // distance between the nearest two moving cell centres: thin bright seams
    vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(x, y), o = 0.5 + 0.45 * sin(t + 6.2831 * h2(i + g));
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return d2 - d1;
  }
  float caustic(vec2 p, float t) {
    p += 0.18 * vec2(sin(p.y * 1.7 + t * 0.9), sin(p.x * 1.9 - t * 0.7));
    float a = 1.0 - smoothstep(0.0, 0.16, cellEdge(p, t));
    float b = 1.0 - smoothstep(0.0, 0.2, cellEdge(p * 1.55 + 3.7, t * 1.25));
    return a * a * 0.9 + b * b * 0.55;
  }`;
function basinMat(map, wobble) {
  const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.35 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPos = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec3 vPos;\n${CAUSTICS}`)
      // seen through moving water the lines waver: wobble the paint lookup (refraction, faked where it's visible)
      .replace('#include <map_fragment>', `
        float under = smoothstep(${(WY - 0.02).toFixed(3)}, ${(WY - 0.2).toFixed(3)}, vPos.y);
        vec2 wob = vec2(sin(vPos.z * 2.3 + uTime * 1.7) + sin(vPos.x * 3.1 - uTime * 1.3), cos(vPos.x * 2.7 + uTime * 1.5) + sin(vPos.z * 3.7 + uTime * 1.1));
        vec4 sampledDiffuseColor = texture2D(map, vMapUv + wob * ${wobble.toFixed(4)} * under);
        diffuseColor *= sampledDiffuseColor;`)
      // caustics ride on the direct sun term, so the wall's shadow strip stays caustic-free
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        vec2 cp = (vPos.xz + vec2(vPos.y * 0.6)) * 1.9;
        reflectedLight.directDiffuse *= mix(1.0, 0.55 + 2.4 * caustic(cp, uTime * 0.8), under);
        reflectedLight.indirectDiffuse *= mix(1.0, 0.8, under);`);
  };
  mat.customProgramCacheKey = () => `basin${wobble}`;
  return mat;
}
function floorTex() {
  const L = PZ0 - PZ1, W = PX * 2, ppm = 80;
  return canvasTex(W * ppm, L * ppm, (c, w, h) => {
    c.fillStyle = '#a8e2ec'; c.fillRect(0, 0, w, h);
    const t = 0.25 * ppm;
    for (let y = 0; y < h; y += t) for (let x = 0; x < w; x += t) { // per-tile tint jitter
      c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '40,110,140'},${Math.random() * 0.06})`; c.fillRect(x, y, t, t);
    }
    c.fillStyle = 'rgba(70,140,160,0.45)';
    for (let y = 0; y < h; y += t) c.fillRect(0, y, w, 1.5);
    for (let x = 0; x < w; x += t) c.fillRect(x, 0, 1.5, h);
    c.fillStyle = '#21428f'; // lane lines, ending in a T two metres from each wall
    for (const lx of LANES) {
      const x = (lx + PX) * ppm, lw = 0.25 * ppm;
      c.fillRect(x - lw / 2, 2 * ppm, lw, h - 4 * ppm);
      for (const y of [2 * ppm, h - 2 * ppm]) c.fillRect(x - 0.5 * ppm, y - lw / 2, ppm, lw);
    }
  });
}
function wallTex() { // 1 m wide, full wall height; the top row is a darker band at the water line
  const ppm = 128, H = -FY;
  const t = canvasTex(ppm, Math.round(H * ppm), (c, w, h) => {
    c.fillStyle = '#b4e8f0'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#2b5fa8'; c.fillRect(0, 0, w, 0.22 * ppm);
    const s = 0.25 * ppm;
    for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; c.fillRect(x, y, s, s); }
    c.fillStyle = 'rgba(60,120,150,0.5)';
    for (let y = 0; y < h; y += s) c.fillRect(0, y, w, 2);
    for (let x = 0; x < w; x += s) c.fillRect(x, 0, 2, h);
  });
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
function basin(g) {
  const floor = new THREE.PlaneGeometry(PX * 2, PZ0 - PZ1).rotateX(-Math.PI / 2).translate(0, FY, (PZ0 + PZ1) / 2);
  addMerged(g, basinMat(floorTex(), 0.0012), [floor], { cast: false });
  const L = PZ0 - PZ1, H = -FY, walls = [];
  for (const [w, ry, x, z] of [[L, Math.PI / 2, -PX, (PZ0 + PZ1) / 2], [L, -Math.PI / 2, PX, (PZ0 + PZ1) / 2], [PX * 2, Math.PI, 0, PZ0], [PX * 2, 0, 0, PZ1]]) {
    const p = new THREE.PlaneGeometry(w, H).rotateY(ry).translate(x, FY + H / 2, z);
    const uv = p.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * w);
    walls.push(p);
  }
  addMerged(g, basinMat(wallTex(), 0.012), walls, { cast: false });
}

// --- the water ----------------------------------------------------------------------------------------
function water(g) {
  const geo = new THREE.PlaneGeometry(PX * 2, PZ0 - PZ1);
  const r = new Reflector(geo, {
    textureWidth: Math.min(1280, innerWidth * 0.5), textureHeight: Math.min(1280, innerHeight * 0.5), clipBias: 0.003,
    shader: {
      uniforms: {
        color: { value: new THREE.Color(1, 1, 1) }, tDiffuse: { value: null }, textureMatrix: { value: null },
        uTime: { value: 0 }, uU: { value: 1 }, uSun: { value: SUN_DIR.clone() }, uSunCol: { value: new THREE.Color('#fff3df') },
        uShallow: { value: new THREE.Color('#22c3d8') }, uDeep: { value: new THREE.Color('#0a5f86') },
      },
      vertexShader: /* glsl */`
        uniform mat4 textureMatrix; varying vec4 vUvR; varying vec3 vWorld;
        void main() { vUvR = textureMatrix * vec4(position, 1.0); vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse; uniform float uTime, uU; uniform vec3 uSun, uSunCol, uShallow, uDeep;
        varying vec4 vUvR; varying vec3 vWorld;
        void main() {
          vec2 p = vWorld.xz / uU; // metres
          // small wind ripples: a spread of short directional waves (deep-water speeds), analytic slope
          vec2 d = vec2(0.0);
          for (int i = 0; i < 10; i++) {
            float fi = float(i), ang = fi * 2.39996 + 0.4, lam = 2.2 * pow(0.76, fi);
            vec2 dir = vec2(cos(ang), sin(ang));
            float k = 6.2831 / lam, ph = dot(dir, p) * k + uTime * sqrt(9.8 * k) + fi * 1.7;
            d += dir * (0.028 * cos(ph));
          }
          vec3 n = normalize(vec3(-d.x, 1.0, -d.y));
          vec3 V = normalize(cameraPosition - vWorld);
          float cosI = max(dot(n, V), 0.0);
          float F = 0.02 + 0.98 * pow(1.0 - cosI, 5.0);
          vec3 refl = texture2D(tDiffuse, vUvR.xy / vUvR.w + n.xz * 0.03).rgb;
          // light path to the floor: refracted ray (n = 1.33) through the water column
          float sin2 = (1.0 - V.y * V.y) / 1.769, len = ${(WY - FY).toFixed(3)} / sqrt(1.0 - sin2);
          float ab = 1.0 - exp(-len * 0.42);
          vec3 body = mix(uShallow, uDeep, ab) * (0.35 + 0.65 * max(uSun.y, 0.0));
          vec3 H = normalize(uSun + V);
          vec3 spec = uSunCol * (pow(max(dot(n, H), 0.0), 900.0) * 40.0 + pow(max(dot(n, H), 0.0), 90.0) * 0.25);
          float a = F + (1.0 - F) * ab;
          vec3 rgb = (refl * F + (1.0 - F) * body * ab) / max(a, 0.05) + spec / max(a, 0.2);
          gl_FragColor = vec4(rgb, a);
        }`,
    },
  });
  r.rotation.x = -Math.PI / 2; r.position.set(0, WY, (PZ0 + PZ1) / 2);
  r.material.transparent = true; r.material.depthWrite = false;
  r.userData.noAO = true; noInk(r); g.add(r);
  return r;
}

// --- lane ropes and backstroke flags --------------------------------------------------------------------
function ropes(g) {
  const float = new THREE.CylinderGeometry(0.06, 0.06, 0.1, 12).rotateX(Math.PI / 2);
  const step = 0.11, n = Math.floor((PZ0 - PZ1) / step), list = [];
  for (const x of ROPES) for (let i = 0; i < n; i++) list.push([x, PZ0 - 0.06 - i * step, i * step]);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.35 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed.y += 0.012 * sin(uTime * 1.7 + instanceMatrix[3].z * 1.3 + instanceMatrix[3].x * 0.9) + 0.006 * sin(uTime * 3.1 + instanceMatrix[3].z * 4.0);`);
  };
  mat.customProgramCacheKey = () => 'rope';
  const im = new THREE.InstancedMesh(float, mat, list.length), m = new THREE.Matrix4(), c = new THREE.Color();
  const L = PZ0 - PZ1;
  list.forEach(([x, z, s], i) => {
    im.setMatrixAt(i, m.makeTranslation(x, WY + 0.01, z));
    const end = s < 5 || s > L - 5; // red within 5 m of the walls, blue/yellow in the middle
    im.setColorAt(i, c.set(end ? (Math.floor(s / 0.55) % 2 ? '#e8333a' : '#f4f4f4') : Math.floor(s / 1.1) % 2 ? '#2f63d6' : '#f2cc2a'));
  });
  im.castShadow = true; im.receiveShadow = true; im.userData.noAO = true; g.add(im);
}
function flags(g) {
  const pos = [], col = [], tip = [], palette = ['#e8333a', '#ffffff', '#2f63d6', '#f2cc2a'].map((x) => new THREE.Color(x));
  const span = 8.6, top = 2.1, pole = [];
  for (const z of [PZ0 - 5, PZ1 + 5]) {
    for (let i = 0, x = -span + 0.15; x < span - 0.15; x += 0.24, i++) {
      const y = (u) => top - 0.18 * (1 - (u / span) ** 2); // sag
      const c = palette[i % 4];
      pos.push(x - 0.1, y(x - 0.1), z, x + 0.1, y(x + 0.1), z, x, y(x) - 0.3, z);
      for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
      tip.push(0, 0, 1);
    }
    for (const sx of [-span, span]) pole.push(cyl(0.035, top + 0.15, sx, 0, z));
    const rope = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, k) => { const x = -span + (k / 8) * span * 2; return new THREE.Vector3(x, top - 0.18 * (1 - (x / span) ** 2), z); }));
    pole.push(new THREE.TubeGeometry(rope, 32, 0.006, 4));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = 'uniform float uTime;\nattribute float aTip;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed.z += aTip * (0.07 * sin(uTime * 4.2 + position.x * 1.7) + 0.05);
      transformed.x += aTip * 0.03 * sin(uTime * 3.3 + position.x * 2.3);`);
  };
  mat.customProgramCacheKey = () => 'flags';
  const f = new THREE.Mesh(geo, mat); f.castShadow = true; g.add(f);
  return pole;
}

// --- deck furniture ---------------------------------------------------------------------------------------
function numberTex(n) {
  return canvasTex(128, 128, (c, w) => {
    c.fillStyle = '#f6f7f8'; c.fillRect(0, 0, w, w); c.fillStyle = '#1d3f8c';
    c.font = 'bold 96px "Arial Black",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(n), w / 2, w / 2 + 6);
  });
}
function startingBlocks(g, steel) {
  const body = [], top = [], grips = [];
  const white = new THREE.MeshStandardMaterial({ color: '#eef1f3', roughness: 0.45 });
  LANES.forEach((x, i) => {
    body.push(box(0.5, 0.62, 0.42, x, 0.31, PZ0 + 0.27));
    const t = new THREE.BoxGeometry(0.54, 0.05, 0.6).rotateX(0.14).translate(x, 0.68, PZ0 + 0.2);
    top.push(t);
    for (const sx of [-0.18, 0.18]) grips.push(new THREE.TorusGeometry(0.1, 0.012, 6, 12, Math.PI).rotateY(Math.PI / 2).translate(x + sx, 0.55, PZ0 - 0.04));
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), new THREE.MeshStandardMaterial({ map: numberTex(i + 1), roughness: 0.5 }));
    plate.position.set(x, 0.36, PZ0 + 0.485); g.add(plate);
  });
  addMerged(g, white, body);
  addMerged(g, new THREE.MeshStandardMaterial({ color: '#2a6fc0', roughness: 0.8 }), top);
  return grips;
}
function ladder(x, z, side) { // stainless pool ladder; side = +1 hangs into the pool toward +x
  const parts = [];
  for (const dz of [-0.26, 0.26]) {
    const curve = new THREE.CatmullRomCurve3([[-0.55, 0], [-0.55, 0.62], [-0.38, 0.86], [-0.12, 0.8], [0.08, 0.45], [0.12, -0.2], [0.12, -0.95]]
      .map(([a, y]) => new THREE.Vector3(x + a * side, y, z + dz)));
    parts.push(new THREE.TubeGeometry(curve, 40, 0.022, 8));
  }
  for (const y of [-0.25, -0.55, -0.85]) parts.push(new THREE.BoxGeometry(0.07, 0.025, 0.5).translate(x + 0.15 * side, y, z));
  return parts;
}
function guardChair(x, z) {
  const parts = [];
  for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) {
    const leg = new THREE.CylinderGeometry(0.03, 0.03, 1.75, 8);
    leg.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-dx * 0.35, 1.7, -dz * 0.35).normalize()));
    parts.push(leg.translate(x + dx * 0.82, 0.86, z + dz * 0.82));
  }
  for (const y of [0.4, 0.8, 1.2]) parts.push(box(0.6, 0.03, 0.06, x, y, z + 0.3), box(0.06, 0.03, 0.6, x - 0.3, y, z));
  parts.push(box(0.5, 0.05, 0.46, x, 1.72, z), box(0.5, 0.42, 0.04, x + 0.25, 1.95, z).rotateY(0));
  return parts;
}
function tent(g, x, z, steel) {
  const w = 3.6, d = 2.7, h = 2.2, ridge = 0.45;
  const poles = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) poles.push(cyl(0.025, h, x + sx * w / 2, 0, z + sz * d / 2));
  const shape = new THREE.BufferGeometry(); // gable roof: two sloped panels and the end triangles
  const v = (a, b, c) => [a, b, c];
  const A = v(x - w / 2, h, z - d / 2), B = v(x + w / 2, h, z - d / 2), C = v(x + w / 2, h, z + d / 2), D = v(x - w / 2, h, z + d / 2), E = v(x - w / 2, h + ridge, z), F = v(x + w / 2, h + ridge, z);
  const tri = [A, B, F, A, F, E, E, F, C, E, C, D, A, E, D, B, C, F].flat();
  shape.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
  shape.computeVertexNormals();
  const canvas = new THREE.MeshStandardMaterial({ color: '#f4f5f2', roughness: 0.9, side: THREE.DoubleSide });
  const roof = new THREE.Mesh(shape, canvas); roof.castShadow = true; roof.receiveShadow = true; g.add(roof);
  const valance = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.22), new THREE.MeshStandardMaterial({ color: '#f4f5f2', roughness: 0.9, side: THREE.DoubleSide,
    map: canvasTex(512, 32, (c, cw, ch) => { c.fillStyle = '#f4f5f2'; c.fillRect(0, 0, cw, ch); c.fillStyle = '#1d3f8c'; c.font = 'bold 22px "Yu Gothic",sans-serif'; c.textAlign = 'center'; c.fillText('第一中学校 水泳部', cw / 2, 24); }) }));
  valance.position.set(x, h - 0.11, z + d / 2); valance.castShadow = true; g.add(valance);
  // folding table with kickboards and a stopwatch-and-clipboard corner
  const table = [box(1.8, 0.03, 0.6, x, 0.72, z - 0.4)];
  for (const sx of [-0.8, 0.8]) for (const sz of [-0.25, 0.25]) table.push(cyl(0.015, 0.71, x + sx, 0, z - 0.4 + sz, 6));
  return { poles: poles.concat(table) };
}
function kickboards(g, list) { // ビート板 stacks: [x, y0, z, count, rotY]
  const geo = [], col = [], palette = ['#2f8fe0', '#f2cc2a', '#f07aa0', '#5cc76a'].map((x) => new THREE.Color(x));
  for (const [x, y0, z, n, ry] of list) for (let i = 0; i < n; i++) {
    const b = new THREE.BoxGeometry(0.3, 0.032, 0.44).rotateY(ry + (Math.random() - 0.5) * 0.15).translate(x + (Math.random() - 0.5) * 0.02, y0 + 0.016 + i * 0.033, z);
    const c = palette[(((i + Math.round(x * 3)) % 4) + 4) % 4], arr = [];
    for (let k = 0; k < b.attributes.position.count; k++) arr.push(c.r, c.g, c.b);
    b.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3)); geo.push(b);
  }
  addMerged(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), geo);
}
function boardTex() {
  return canvasTex(256, 320, (c, w, h) => {
    c.fillStyle = '#fbfbf8'; c.fillRect(0, 0, w, h); c.strokeStyle = '#1d3f8c'; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = '#1d3f8c'; c.font = 'bold 34px "Yu Gothic","Meiryo",sans-serif'; c.textAlign = 'center';
    c.fillText('本日のプール', w / 2, 52);
    c.font = 'bold 40px "Yu Gothic","Meiryo",sans-serif'; c.fillStyle = '#222';
    c.fillText('水温 28℃', w / 2, 125); c.fillText('気温 32℃', w / 2, 185);
    c.fillStyle = '#d92b2b'; c.fillText('遊泳 可', w / 2, 262);
  });
}
function paceClock(g, x, z) {
  const face = canvasTex(256, 256, (c, w) => {
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(w / 2, w / 2, w / 2, 0, 7); c.fill();
    c.fillStyle = '#111'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 26px Arial,sans-serif';
    for (let s = 0; s < 60; s++) {
      const a = (s / 60) * Math.PI * 2 - Math.PI / 2, r0 = s % 5 ? 112 : 100;
      c.lineWidth = s % 5 ? 2 : 5; c.strokeStyle = '#111';
      c.beginPath(); c.moveTo(w / 2 + Math.cos(a) * r0, w / 2 + Math.sin(a) * r0); c.lineTo(w / 2 + Math.cos(a) * 122, w / 2 + Math.sin(a) * 122); c.stroke();
      if (s % 5 === 0) c.fillText(String(s), w / 2 + Math.cos(a) * 80, w / 2 + Math.sin(a) * 80);
    }
  });
  const y = 2.15, r = 0.55;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 48), new THREE.MeshStandardMaterial({ map: face, roughness: 0.4 }));
  disc.position.set(x, y, z + 0.06); g.add(disc);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 48), new THREE.MeshStandardMaterial({ color: '#d8dadc', metalness: 0.8, roughness: 0.3 }));
  rim.position.copy(disc.position); rim.castShadow = true; g.add(rim);
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.02, r * 0.95, 0.01).translate(0, r * 0.38, 0), new THREE.MeshStandardMaterial({ color: '#e0201f', roughness: 0.4 }));
  hand.position.set(x, y, z + 0.075); g.add(hand);
  return { hand, stand: [cyl(0.04, y, x, 0, z), box(0.6, 0.6, 0.05, x, y, z + 0.02)] };
}

// --- deck, fence, surroundings ---------------------------------------------------------------------------
function deck(g) {
  const pieces = [[-FENCE_X, FENCE_X, PZ0, 1.2], [-FENCE_X, FENCE_X, FENCE_Z, PZ1], [-FENCE_X, -PX, PZ1, PZ0], [PX, FENCE_X, PZ1, PZ0]].map(([x0, x1, z0, z1]) => {
    const p = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = p.attributes.position, uv = p.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4); // world-aligned, one tile per 4 m
    return p;
  });
  const concrete = pbrSet('concrete_floor_worn_001', [1, 1]); concrete.color.setRGB(1.9, 1.9, 1.82); // the scan is dark; sunlit poolside concrete is near white
  addMerged(g, concrete, pieces, { cast: false });
  // coping: a white stone lip around the opening
  addMerged(g, new THREE.MeshStandardMaterial({ color: '#f1f1ec', roughness: 0.55 }), [
    box(PX * 2 + 0.8, 0.07, 0.4, 0, 0.005, PZ0 + 0.2), box(PX * 2 + 0.8, 0.07, 0.4, 0, 0.005, PZ1 - 0.2),
    box(0.4, 0.07, PZ0 - PZ1, -PX - 0.2, 0.005, (PZ0 + PZ1) / 2), box(0.4, 0.07, PZ0 - PZ1, PX + 0.2, 0.005, (PZ0 + PZ1) / 2),
  ], { cast: false });
  // wet: splashes along the edge and footprints from the ladder to where she stands
  const wet = canvasTex(1024, 512, (c, w, h) => {
    const sx = w / 16, sz = h / 8; // 16 x 8 m patch, x -8..8, z -6..2 (canvas y = z + 6)
    const X = (x) => (x + 8) * sx, Y = (z) => (z + 6) * sz;
    for (let i = 0; i < 90; i++) {
      const x = -7 + Math.random() * 14, z = PZ0 + 0.1 + Math.random() ** 2 * 1.3;
      const r = 6 + Math.random() * 30, gr = c.createRadialGradient(X(x), Y(z), 0, X(x), Y(z), r);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(X(x), Y(z), r, 0, 7); c.fill();
    }
    c.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 9; i++) { // footprints from the left ladder
      const t = i / 8, x = -6.1 + t * 5.6 + (i % 2 ? 0.1 : -0.1), z = PZ0 - 2 + t * 2.3;
      c.save(); c.translate(X(x), Y(z)); c.rotate(0.35); c.beginPath(); c.ellipse(0, 0, 5, 9, 0, 0, 7); c.fill(); c.restore();
    }
  }, false);
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(16, 8).rotateX(-Math.PI / 2).translate(0, 0.004, -2),
    new THREE.MeshStandardMaterial({ color: '#4d5250', roughness: 0.08, alphaMap: wet, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  decal.receiveShadow = true; decal.userData.noAO = true; g.add(decal);
}
function chainLink() {
  const t = canvasTex(64, 64, (c, w) => {
    c.clearRect(0, 0, w, w); c.strokeStyle = '#fff'; c.lineWidth = 3.2;
    c.beginPath(); c.moveTo(0, w / 2); c.lineTo(w / 2, 0); c.lineTo(w, w / 2); c.lineTo(w / 2, w); c.closePath(); c.stroke();
  }, false);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function fence(g, steel) {
  const H = 2.4, mesh = [], posts = [], kerb = [];
  const run = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
    const p = new THREE.PlaneGeometry(len, H).rotateY(ang - Math.PI / 2).translate((x0 + x1) / 2, 0.3 + H / 2, (z0 + z1) / 2);
    const uv = p.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 0.06, uv.getY(i) * H / 0.06);
    mesh.push(p);
    for (let s = 0; s <= len + 0.01; s += 2.5) { const k = s / len; posts.push(cyl(0.035, H + 0.3, x0 + (x1 - x0) * k, 0, z0 + (z1 - z0) * k, 8)); }
    const rail = new THREE.CylinderGeometry(0.025, 0.025, len, 8).rotateX(Math.PI / 2).rotateY(ang).translate((x0 + x1) / 2, H + 0.3, (z0 + z1) / 2);
    posts.push(rail);
    kerb.push(new THREE.BoxGeometry(0.25, 0.4, len + 0.25).rotateY(ang).translate((x0 + x1) / 2, 0.1, (z0 + z1) / 2));
  };
  run(-FENCE_X, 1.2, -FENCE_X, FENCE_Z); run(-FENCE_X, FENCE_Z, FENCE_X, FENCE_Z); run(FENCE_X, FENCE_Z, FENCE_X, 1.2);
  const link = new THREE.MeshStandardMaterial({ color: '#2f6a4c', alphaMap: chainLink(), alphaTest: 0.35, alphaToCoverage: true, side: THREE.DoubleSide, metalness: 0.3, roughness: 0.6 });
  const m = addMerged(g, link, mesh); m.userData.noAO = true;
  addMerged(g, new THREE.MeshStandardMaterial({ color: '#2f6a4c', metalness: 0.4, roughness: 0.5 }), posts);
  addMerged(g, new THREE.MeshStandardMaterial({ color: '#c9c9c2', roughness: 0.9 }), kerb);
  // rules sign on the left fence
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2), new THREE.MeshStandardMaterial({ roughness: 0.6, map: canvasTex(300, 400, (c, w, h) => {
    c.fillStyle = '#fdfdfb'; c.fillRect(0, 0, w, h); c.fillStyle = '#1d3f8c'; c.fillRect(0, 0, w, 70);
    c.fillStyle = '#fff'; c.font = 'bold 34px "Yu Gothic",sans-serif'; c.textAlign = 'center'; c.fillText('プールの約束', w / 2, 48);
    c.fillStyle = '#222'; c.textAlign = 'left'; c.font = 'bold 24px "Yu Gothic",sans-serif';
    ['一、準備運動をしよう', '二、プールサイドは', '　　走らない', '三、飛び込み禁止', '四、先生の笛で', '　　すぐ集合'].forEach((s, i) => c.fillText(s, 22, 120 + i * 44));
  }) }));
  sign.rotation.y = Math.PI / 2; sign.position.set(-FENCE_X + 0.05, 1.5, -4.5); g.add(sign);
}
function schoolBuilding(g) { // 校舎 beyond the right fence: four floors of classroom bays facing the pool
  const x0 = 17, z0 = -62, z1 = -2, floors = 4, fh = 3.6, H = floors * fh + 1.0, L = z1 - z0;
  const bay = canvasTex(1024, 256, (c, w, h) => { // four 3.6 m bays per tile, curtains drawn differently in each
    for (let b = 0; b < 4; b++) {
      const x = b * 256;
      c.fillStyle = '#efe9dc'; c.fillRect(x, 0, 256, h);
      const gx = x + 22, gy = 70, gw = 212, gh = 150;
      const gr = c.createLinearGradient(0, gy, 0, gy + gh); gr.addColorStop(0, '#9fc6e6'); gr.addColorStop(1, '#5d86a8');
      c.fillStyle = gr; c.fillRect(gx, gy, gw, gh);
      c.fillStyle = 'rgba(255,255,255,0.25)'; c.beginPath(); c.moveTo(gx + 30, gy); c.lineTo(gx + 90, gy); c.lineTo(gx + 40, gy + gh); c.lineTo(gx - 20 < gx ? gx : gx, gy + gh); c.fill();
      const cur = [0.3, 0.75, 0.15, 0.5][b]; // a drawn curtain
      c.fillStyle = '#f1ecdf'; c.fillRect(gx, gy, gw * cur * 0.5, gh); c.fillRect(gx + gw * (1 - cur * 0.4), gy, gw * cur * 0.4, gh);
      c.fillStyle = '#b8bcbd'; for (const fx of [0, 0.5, 1]) c.fillRect(gx + gw * fx - 3, gy, 6, gh); c.fillRect(gx, gy - 3, gw, 6); c.fillRect(gx, gy + gh - 3, gw, 6);
      c.fillStyle = '#d9d2c3'; c.fillRect(x, 0, 256, 18);
    }
  });
  bay.wrapS = bay.wrapT = THREE.RepeatWrapping; bay.repeat.set(L / 14.4, floors);
  const facade = new THREE.PlaneGeometry(L, floors * fh).rotateY(-Math.PI / 2).translate(x0, floors * fh / 2, (z0 + z1) / 2);
  const wallMat = pbrSet('white_plaster_02', [L / 4, H / 4], '#f2ece0');
  addMerged(g, new THREE.MeshStandardMaterial({ map: bay, roughness: 0.6 }), [facade]);
  addMerged(g, wallMat, [box(12, H, L, x0 + 6.05, H / 2, (z0 + z1) / 2), box(4, H + 4, 6, x0 + 4, (H + 4) / 2, -33)]);
  const slabs = [];
  for (let f = 1; f <= floors; f++) slabs.push(box(0.6, 0.22, L, x0 - 0.3, f * fh - 0.05, (z0 + z1) / 2));
  slabs.push(box(0.5, 1.0, L, x0 - 0.05, floors * fh + 0.5, (z0 + z1) / 2));
  addMerged(g, new THREE.MeshStandardMaterial({ color: '#e7e1d4', roughness: 0.8 }), slabs);
  const clock = new THREE.Mesh(new THREE.CircleGeometry(1.1, 40), new THREE.MeshStandardMaterial({ roughness: 0.5, map: canvasTex(256, 256, (c, w) => {
    c.fillStyle = '#fafafa'; c.beginPath(); c.arc(w / 2, w / 2, w / 2 - 4, 0, 7); c.fill(); c.lineWidth = 10; c.strokeStyle = '#2a3b5a'; c.stroke();
    c.fillStyle = '#2a3b5a'; for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; c.fillRect(w / 2 + Math.cos(a) * 100 - 5, w / 2 + Math.sin(a) * 100 - 5, 10, 10); }
    c.lineWidth = 9; c.lineCap = 'round'; c.beginPath(); c.moveTo(w / 2, w / 2); c.lineTo(w / 2 + 50, w / 2 + 20); c.stroke(); // ~ 3:40
    c.lineWidth = 6; c.beginPath(); c.moveTo(w / 2, w / 2); c.lineTo(w / 2 - 55, w / 2 - 70); c.stroke();
  }) }));
  clock.rotation.y = -Math.PI / 2; clock.position.set(x0 + 1.95, H + 2, -33); g.add(clock);
}
function changingRooms(g) {
  const x0 = -21, x1 = -13, z0 = -24, z1 = -7, h = 3.4;
  addMerged(g, pbrSet('white_plaster_02', [3, 1], '#e9e2d2'), [box(x1 - x0, h, z1 - z0, (x0 + x1) / 2, h / 2, (z0 + z1) / 2)]);
  addMerged(g, new THREE.MeshStandardMaterial({ color: '#8f9693', roughness: 0.8 }), [box(x1 - x0 + 0.6, 0.2, z1 - z0 + 0.6, (x0 + x1) / 2, h + 0.1, (z0 + z1) / 2)]);
  const door = new THREE.MeshStandardMaterial({ color: '#3d74b8', roughness: 0.5 }), frost = new THREE.MeshStandardMaterial({ color: '#dfe7ea', roughness: 0.25, metalness: 0.2 });
  const parts = [], wins = [];
  for (const z of [-11, -20]) parts.push(box(0.08, 2.1, 1.0, x1 + 0.04, 1.05, z));
  for (let z = z0 + 1.5; z < z1 - 1; z += 2.2) if (Math.abs(z + 11) > 1 && Math.abs(z + 20) > 1) wins.push(box(0.06, 0.5, 1.4, x1 + 0.03, 2.5, z));
  addMerged(g, door, parts); addMerged(g, frost, wins);
  for (const [z, t, col] of [[-11, '男子更衣室', '#2f63d6'], [-20, '女子更衣室', '#e0405f']]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.25), new THREE.MeshStandardMaterial({ roughness: 0.6, map: canvasTex(256, 64, (c, w, hh) => { c.fillStyle = '#fff'; c.fillRect(0, 0, w, hh); c.fillStyle = col; c.font = 'bold 40px "Yu Gothic",sans-serif'; c.textAlign = 'center'; c.fillText(t, w / 2, 46); }) }));
    s.rotation.y = Math.PI / 2; s.position.set(x1 + 0.05, 2.35, z); g.add(s);
  }
}
function surroundings(g) {
  // grass everywhere outside the deck rectangle (the basin sits below it)
  const R = 300, ground = [[-R, R, 1.2, R], [-R, R, -R, FENCE_Z], [-R, -FENCE_X, FENCE_Z, 1.2], [FENCE_X, R, FENCE_Z, 1.2]].map(([x0, x1, z0, z1]) => {
    const p = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, -0.03, (z0 + z1) / 2);
    const pos = p.attributes.position, uv = p.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 4, pos.getZ(i) / 4);
    return p;
  });
  addMerged(g, pbrSet('sparse_grass', [1, 1], '#c6d6a0'), ground, { cast: false });
  const hills = []; let s = 5; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 40; i++) {
    const a = -Math.PI * 0.95 + (i / 40) * Math.PI * 1.1, r = 260 + rnd() * 120, rad = 50 + rnd() * 60;
    hills.push(new THREE.SphereGeometry(rad, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.25 + rnd() * 0.2, 1).translate(Math.cos(a) * r, -4, Math.sin(a) * r - 40));
  }
  addMerged(g, new THREE.MeshStandardMaterial({ color: '#4f7a4a', roughness: 1 }), hills, { cast: false, recv: false });
  const spots = [];
  for (let x = -26; x <= 26; x += 3.6 + rnd()) spots.push([x, FENCE_Z - 3 - rnd() * 3, 1.1 + rnd() * 0.4]);
  for (let z = -4; z > -29; z -= 4.5) spots.push([-FENCE_X - 1.6 - rnd(), z + rnd(), 0.9 + rnd() * 0.3]);
  g.add(noInk(trees(spots, () => -0.03)));
}

export function createPool(renderer) {
  const g = new THREE.Group(); g.name = 'pool'; g.visible = false;
  const steel = new THREE.MeshStandardMaterial({ color: '#e4e7ea', metalness: 1, roughness: 0.18 });
  const white = new THREE.MeshStandardMaterial({ color: '#f3f4f2', roughness: 0.5 });
  basin(g); deck(g); ropes(g); fence(g, steel); schoolBuilding(g); changingRooms(g); surroundings(g);
  const sea = water(g);
  const metal = [...startingBlocks(g, steel), ...flags(g), ...ladder(-PX, -3, 1), ...ladder(PX, -23, -1), ...ladder(-PX, -23, 1)];
  const t = tent(g, -8.8, -13, steel), clock = paceClock(g, -3, FENCE_Z + 0.2);
  addMerged(g, steel, metal.concat(t.poles, clock.stand));
  addMerged(g, white, guardChair(8.6, -13.5));
  kickboards(g, [[-8.8 - 0.5, 0.74, -13.4, 9, 0.1], [-8.8 + 0.1, 0.74, -13.4, 6, -0.2], [8.4, 0, -3.5, 12, 0.4], [8.85, 0, -3.3, 7, 1.2]]);
  // bench and the pool-status board on the right deck
  const wood = new THREE.MeshStandardMaterial({ color: '#b98a5c', roughness: 0.7 });
  addMerged(g, wood, [box(2.4, 0.05, 0.38, 9.6, 0.45, -7.5).rotateY(0), box(0.06, 0.45, 0.34, 8.6, 0.22, -7.5), box(0.06, 0.45, 0.34, 10.6, 0.22, -7.5)]);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), new THREE.MeshStandardMaterial({ map: boardTex(), roughness: 0.6 }));
  board.position.set(8.6, 1.35, -1.2); board.rotation.y = -0.5; g.add(board);
  addMerged(g, steel, [cyl(0.025, 0.85, 8.42, 0, -1.08), cyl(0.025, 0.85, 8.78, 0, -1.32)]);
  noInk(g);

  const sun = new THREE.DirectionalLight('#fff3df', 3.4);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  const target = new THREE.Object3D(); target.position.set(0, 0, -12); sun.target = target;
  sun.position.copy(SUN_DIR).multiplyScalar(60).add(target.position);
  const fill = new THREE.HemisphereLight('#d6e8ff', '#9aa79a', 0.35);
  g.add(sun, target, fill);
  return {
    group: g,
    look: { exposure: 1.0, amb: ['#b4b4b4', 1.1], key: ['#ffffff', 0.8], keyDir: new THREE.Vector3(0.4, 0.8, 1), gi: 0.6,
      grade: { tint: [1, 1, 1.02], sat: 1.1, contrast: 1.04, sepia: 0, vignette: 0.12 }, bloom: 0.3, bloomThreshold: 1.15 },
    async fit(scene, U) {
      g.scale.setScalar(U);
      const cam = sun.shadow.camera;
      cam.left = -17 * U; cam.right = 17 * U; cam.bottom = -19 * U; cam.top = 19 * U; cam.near = 1 * U; cam.far = 140 * U; cam.updateProjectionMatrix();
      sea.material.uniforms.uU.value = U;
      scene.fog = new THREE.Fog('#c9dcef', 90 * U, 520 * U);
      const sky = await loadSky(renderer, 'day', 1.6);
      const a = Math.atan2(SUN_DIR.x, SUN_DIR.z) - Math.atan2(sky.sun.x, sky.sun.z);
      scene.background = sky.tex; scene.environment = sky.env;
      scene.backgroundRotation.set(0, a, 0); scene.environmentRotation.set(0, a, 0);
      scene.backgroundIntensity = 1; scene.environmentIntensity = 0.85;
    },
    tick(t) {
      time.value = t; sea.material.uniforms.uTime.value = t;
      clock.hand.rotation.z = -((t % 60) / 60) * Math.PI * 2;
    },
  };
}
