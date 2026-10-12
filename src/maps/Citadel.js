// Citadel meadow (성채의 초원): a windswept meadow at the foot of a cliff on the edge of a farmed plain, and ~1-1.5 km out a white city of
// seven walled tiers built into the shoulder of a mountain, split by a rock prow, a tower on the top tier, a sheer
// stratified cliff behind it. Everything sits under the engine sky (engine/sky/): cloud shadows cross the fields,
// the walls and the mountain; the time of day (citadel.elev) turns the walls gold, pink in the afterglow, then a
// city of lit windows under the moon.
//
// What makes it read as huge (art direction argued out with a second model, see the commit):
// - a mass, not a cake: on every terrace the back rows of houses rise past the foot of the next wall, so the
//   roofscape fills the risers; wall towers, a parapet lip and alternating gates break each ring;
// - the city IS the mountain's prow: it juts out of a mountain wall, shoulders closing in on both flanks;
// - a ruler in front: hedged field parcels on the plain and an outer field wall (the scale cue);
// - raking light from the right (never frontal) so each curved tier grades from lit to shade;
// - mist pooled on the plain (citadel.mist) so the city rises out of it while the top tiers stay crisp.
// If a photogrammetry city is dropped in assets/sketchfab/minas_tirith/scene.glb (or .gltf) it replaces the
// procedural one: its baked scan light is filtered out in the shader (the texture's own mip is the blur).
// The scan the defaults are fitted to (scanYaw/Sink/Back): "Scanned Minas Tirith Model (Lord of the Rings)" by 3digify,
// CC BY 4.0, https://sketchfab.com/3d-models/512b6293f38540be963dcdcbfd8bc7c5 (fetched locally, never committed).
//
// Metres, stage origin at her feet, -z away from the viewer. The far plane is ~2.4 km at the usual U, so the world
// ends at 2 km behind the range.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createVolumetricSky, createSkyLights } from '../../engine/sky/VolumetricSky.js';
import { grassField, trees, useWind, noInk } from './crossing/Foliage.js';

const PLAIN = -8;                                    // the farmed plain, just below her: she looks UP at the city
const CITY = { x: -80, z: -1450, r: [300, 262, 224, 186, 148, 110, 74], rise: 34 };
const top = (i) => PLAIN + CITY.rise * (i + 1);      // tier i's terrace height (the top tier is ~213 m up)
const END_Z = -2300, SIDE = 3200; // the massif's back reaches ~2.35 km, just inside the far plane
const TEX = 'assets/polyhaven/tex/';
const ss = THREE.MathUtils.smoothstep;

// --- terrain ---------------------------------------------------------------------------------------------
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * u, b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * u;
  return a + (b - a) * v;
}
const octaves = (f) => (x, z, o = 4) => { let a = 0, w = 0.5, s = 1; for (let k = 0; k < o; k++) { a += w * f(vnoise(x * s + k * 17.3, z * s)); s *= 2.03; w *= 0.5; } return a / (1 - 0.5 ** o); };
const fbm = octaves((n) => n), ridged = octaves((n) => (1 - Math.abs(2 * n - 1)) ** 2);
const riverZ = (x) => -330 + 70 * Math.sin(x / 260) + 30 * Math.sin(x / 97 + 1.3);

function height(x, z) {
  // meadow: rolling, flat where she stands, falling off the brow to the plain
  const brow = ss(z, -420, -50);
  let h = ((fbm(x / 90, z / 90) - 0.5) * 7 + (fbm(x / 23, z / 23) - 0.5) * 1.3) * ss(Math.hypot(x, z), 3, 26) * brow
        + (PLAIN + (fbm(x / 300, z / 300) - 0.5) * 4) * (1 - brow);
  h -= 2.6 * (1 - ss(Math.abs(z - riverZ(x)), 9, 34)) * (1 - brow);
  const dx = x - CITY.x, cr = Math.hypot(dx, z - CITY.z);
  h += (PLAIN - h) * (1 - ss(cr, CITY.r[0] + 10, CITY.r[0] + 90)); // the city stands on a level pad
  // The city is the mountain's prow: it juts out of a mountain wall. The wall rises behind the city's middle,
  // shoulders close in on both flanks (they also hide the scan's straight-cut sides), and a lower range runs
  // off along the horizon. The scan's own rock is the centre of the massif.
  const back = 1 - ss(z, CITY.z - 520, CITY.z - 300);
  let m = (520 + 300 * Math.exp(-((dx / 900) ** 2))) * back * (0.8 + 0.35 * ridged(x / 260, z / 260, 5));
  const shoulder = 560 * ss(Math.abs(dx), 520, 760) * (1 - ss(z, CITY.z - 100, CITY.z + 320)) * Math.exp(-(((Math.abs(dx) - 800) / 700) ** 2));
  m = Math.max(m, shoulder * (0.8 + 0.35 * ridged(x / 200, z / 200, 5)), (330 + 260 * fbm(x / 520, 3.7)) * (1 - ss(z, -1900, -1700)) * (0.75 + 0.4 * ridged(x / 260, z / 260, 5)));
  m *= 0.93 + 0.14 * ridged(x / 110, z / 110, 4); // spurs and gullies everywhere on the rock
  // The cliff she stands under: a dark rock wall ~190 m high down the right of the view, its face opening away
  // from her so the plain and the city stay clear. In the window it climbs out of the top of the frame: the
  // foreground scale that makes the city beyond read as huge.
  const face = 46 + 0.12 * -z + 16 * (fbm(z / 26, 1.7) - 0.5), near = ss(z, -560, -380) * (1 - ss(z, 10, 40));
  m = Math.max(m, 190 * ss(x, face, face + 13) * near * (0.8 + 0.4 * fbm(x / 40, z / 40, 3)) * (0.9 + 0.2 * ridged(x / 18, z / 18, 3)));
  return h + m;
}

const texture = (name, srgb = true) => {
  const t = new THREE.TextureLoader().load(TEX + name + '/diff.jpg', undefined, undefined, () => {});
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
// Textures are used as luminance detail over the hand-set albedo, each divided by its own mean linear luminance
// (measured): a sparse-grass photo is mostly brown dirt, a rock photo is orange; the colour comes from us.
const LUM = /* glsl */`float lum(vec3 c) { return dot(c, vec3(0.333)); }
  float tri(sampler2D t, vec3 p, vec3 n, float s) { // triplanar: rock faces are vertical, a top-down UV would smear them
    vec3 w = pow(abs(n), vec3(4.0)); w /= w.x + w.y + w.z;
    return lum(texture2D(t, p.zy / s).rgb) * w.x + lum(texture2D(t, p.xz / s).rgb) * w.y + lum(texture2D(t, p.xy / s).rgb) * w.z; }`;

// One grid, warped so cells are ~0.4 m under her feet and ~40 m at the mountains.
function terrain() {
  const N = 380, xs = [], zs = [];
  for (let i = 0; i <= N; i++) { const u = (i / N) * 2 - 1; xs.push(Math.sign(u) * SIDE * Math.abs(u) ** 2.4); zs.push(u < 0 ? END_Z * (-u) ** 2.2 : 150 * u ** 2.2); }
  const pos = new Float32Array((N + 1) ** 2 * 3), idx = [];
  for (let j = 0, k = 0; j <= N; j++) for (let i = 0; i <= N; i++, k++) {
    pos.set([xs[i], height(xs[i], zs[j]), zs[j]], k * 3);
    if (i < N && j < N) idx.push(k, k + N + 1, k + 1, k + 1, k + N + 1, k + N + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  // albedo by place: meadow and plain, dark stratified rock (scrub low down), snow above ~650 m
  const nrm = geo.attributes.normal, col = new Float32Array(pos.length), rock = new Float32Array(pos.length / 3);
  const c = new THREE.Color(), MEADOW = new THREE.Color(0.52, 0.56, 0.3), FIELD = new THREE.Color(0.68, 0.6, 0.34), SCRUB = new THREE.Color(0.17, 0.23, 0.13),
    STONE = new THREE.Color(0.15, 0.145, 0.14), BAND = new THREE.Color(0.38, 0.35, 0.31), SNOW = new THREE.Color(0.92, 0.94, 0.98);
  for (let k = 0; k < rock.length; k++) {
    const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2], ny = nrm.getY(k);
    const r = Math.max(1 - ss(ny, 0.68, 0.88), ss(y, PLAIN + 40, PLAIN + 140)), snow = ss(y, 600, 700) * ss(ny, 0.4, 0.65);
    c.lerpColors(MEADOW, FIELD, ss(z, -60, -420)).multiplyScalar(0.85 + 0.3 * fbm(x / 40, z / 40, 2));
    // strata: pale and dark bands by altitude, wobbling, so the cliff reads as geology
    const strata = ss(Math.sin(y / 23 + fbm(x / 200, y / 90, 2) * 4), 0.2, 0.8);
    const rk = STONE.clone().lerp(BAND, strata * 0.8).multiplyScalar(0.8 + 0.4 * fbm(x / 60, y / 60, 2))
      .lerp(SCRUB, ss(ny, 0.55, 0.8) * (1 - ss(y, 120, 330)) * fbm(x / 90, z / 90, 3));
    c.lerp(rk, r).lerp(SNOW, snow);
    col.set([c.r, c.g, c.b], k * 3); rock[k] = Math.max(r, snow * 0.6);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aRock', new THREE.BufferAttribute(rock, 1));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const U = { uRoad: { value: new THREE.Vector4(10, -40, CITY.x, CITY.z + 560) }, tGrass: { value: texture('sparse_grass') }, tField: { value: texture('aerial_grass_rock') }, tRock: { value: texture('rock_face_03') } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRock; varying float vRock; varying vec3 vLocal, vNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRock = aRock; vLocal = position; vNrm = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        uniform sampler2D tGrass, tField, tRock; uniform vec4 uRoad; varying float vRock; varying vec3 vLocal, vNrm;
        const vec3 LAWN = vec3(0.46, 0.54, 0.27); // blade colour / MEADOW (tip x straw paint, measured by eye)
        ${LUM}
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <map_fragment>', `{
        vec2 p = vLocal.xz; float far = smoothstep(60.0, 250.0, length(p));
        float g = mix(lum(texture2D(tGrass, p / 6.0).rgb) / 0.045, 1.0, far) * mix(1.0, lum(texture2D(tField, p / 45.0).rgb) / 0.106, 0.7);
        // under the blades the soil takes their colour and loses the dirt photo's contrast, so the grass thinning
        // with distance reads as a lawn going flat, not as tufts on bare earth
        float lawn = 1.0 - smoothstep(30.0, 110.0, length(p));
        vec3 ground = mix(vec3(g), LAWN * mix(1.0, g, 0.35), lawn);
        // the plain is farmed: hedged parcels, some green, some gold, that make the city's size readable
        float plain = 1.0 - smoothstep(-450.0, -150.0, vLocal.z);
        vec2 q = mat2(0.94, -0.34, 0.34, 0.94) * p, cs = vec2(70.0, 46.0); q.x += h21(vec2(0.0, floor(q.y / cs.y))) * cs.x; cs.x *= 0.7 + 0.6 * h21(vec2(floor(q.y / cs.y), 3.0));
        vec2 id = floor(q / cs), e = min(fract(q / cs), 1.0 - fract(q / cs)) * cs;
        vec3 crop = mix(vec3(0.9, 0.96, 0.8), vec3(1.28, 1.0, 0.58), step(0.55, h21(id))) * (0.85 + 0.3 * h21(id + 7.0));
        float hedge = (1.0 - smoothstep(0.6, 2.2, min(e.x, e.y))) * step(0.25, h21(id + 3.1)); // not every edge has a hedge
        ground *= mix(vec3(1.0), mix(crop, vec3(0.45, 0.55, 0.36), hedge * 0.7), plain);
        // the road from the meadow to the city gate: a scale cue the eye follows all the way in
        vec2 ra = uRoad.xy, rb = uRoad.zw, rp = p + vec2(22.0 * sin(p.y / 170.0), 0.0), rd = rb - ra;
        float road = 1.0 - smoothstep(3.0, 6.5, length(rp - ra - rd * clamp(dot(rp - ra, rd) / dot(rd, rd), 0.0, 1.0)));
        ground = mix(ground, vec3(1.25, 1.08, 0.86) * (0.9 + 0.2 * g), road * 0.85);
        float r = tri(tRock, vLocal, normalize(vNrm), 38.0) / 0.153;
        diffuseColor.rgb *= mix(ground, vec3(mix(1.0, r, 0.8)), vRock); }`);
  };
  mat.customProgramCacheKey = () => 'citadel-terrain';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.userData.noAO = true; // AO from depth at km range drew black teeth along the ridge lines
  return mesh;
}

function river() {
  const pos = [], idx = [], N = 600;
  for (let i = 0; i <= N; i++) {
    const x = -SIDE + (2 * SIDE * i) / N, z = riverZ(x);
    pos.push(x, PLAIN - 1.3, z - 24, x, PLAIN - 1.3, z + 24);
    if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial()); // tinted every frame with the sky near the horizon it mirrors
  m.userData.noAO = true;
  return m;
}

// --- the city ----------------------------------------------------------------------------------------------
const prowW = (y) => THREE.MathUtils.lerp(30, 9, THREE.MathUtils.clamp((y - PLAIN) / (top(6) - PLAIN), 0, 1)); // a keel, not a slab
function prowFront(y) { // radius of the prow's edge at height y: always a little outside the tier walls
  const ys = [PLAIN - 1, ...CITY.r.map((_, i) => top(i)), top(6) + 10], rs = [CITY.r[0] + 14, ...CITY.r.map((r) => r + 12), CITY.r[6] - 10];
  for (let k = 1; k < ys.length; k++) if (y <= ys[k]) return rs[k - 1] + (rs[k] - rs[k - 1]) * (y - ys[k - 1]) / (ys[k] - ys[k - 1]);
  return rs.at(-1);
}

// unit house: walls 0..1, a gable roof 1..1.3 with its ridge along local x (the tangent of the ring once placed)
function houseGeometry() {
  const body = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0).toNonIndexed();
  const roof = new THREE.BufferGeometry(), y0 = 1, y1 = 1.3, h = 0.5, v = [];
  const quad = (a, b, c, d) => v.push(...a, ...b, ...c, ...a, ...c, ...d);
  quad([-h, y0, h], [h, y0, h], [h, y1, 0], [-h, y1, 0]); quad([h, y0, -h], [-h, y0, -h], [-h, y1, 0], [h, y1, 0]);
  v.push(-h, y0, -h, -h, y0, h, -h, y1, 0, h, y0, h, h, y0, -h, h, y1, 0);
  roof.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); roof.computeVertexNormals();
  body.deleteAttribute('uv'); body.deleteAttribute('normal'); body.computeVertexNormals();
  const paint = (g, c) => g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position.count }, () => c).flat(), 3));
  paint(body, [1, 1, 1]); paint(roof, [0.34, 0.36, 0.42]); // pale walls, slate roofs
  return mergeGeometries([body, roof]);
}

function city(mats, glowMat) {
  const g = new THREE.Group(), { x: cx, z: cz, r: R } = CITY;
  let rnd = 9; const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  // seven tiers: half-cylinders facing the plain, the open back sunk in the cliff. The outermost wall is darker.
  R.forEach((r, i) => {
    const h = top(i) - PLAIN + 1;
    const geo = new THREE.CylinderGeometry(r, r * 1.012, h, 128, 1, false, -Math.PI / 2, Math.PI);
    const uv = geo.attributes.uv; // side UVs in metres / 10 for the ashlar texture
    for (let k = 0; k < 2 * 129; k++) uv.setXY(k, uv.getX(k) * Math.PI * r / 10, uv.getY(k) * h / 10);
    const m = new THREE.Mesh(geo, [i === 0 ? mats.outer : mats.wall, mats.paving, mats.wall]);
    m.position.set(cx, PLAIN - 1 + h / 2, cz); m.receiveShadow = true; g.add(m);
    // the parapet: a lip proud of the wall face that draws a line of light and shadow round every ring
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(r + 1.2, r + 1.2, 3.2, 128, 1, true, -Math.PI / 2, Math.PI), mats.wall);
    lip.position.set(cx, top(i) + 0.6, cz); g.add(lip);
  });

  // the prow: a keel of rock rising from the plain to the top tier, the walls running into its flanks
  {
    const pos = [], ys = [PLAIN - 1, ...R.map((_, i) => top(i) - 6), top(6) + 10];
    const ring = ys.map((y, k) => { const w = prowW(y) * (0.85 + 0.3 * rand()), rr = prowFront(y) + (k && k < ys.length - 1 ? (rand() - 0.5) * 6 : 0);
      return [new THREE.Vector3(cx, y, cz + rr), new THREE.Vector3(cx - w, y, cz + rr * 0.35), new THREE.Vector3(cx + w, y, cz + rr * 0.35)]; });
    const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let k = 0; k + 1 < ring.length; k++) {
      const [f0, l0, r0] = ring[k], [f1, l1, r1] = ring[k + 1];
      tri(f0, l0, l1); tri(f0, l1, f1); tri(f0, r1, r0); tri(f0, f1, r1);
      tri(l0, new THREE.Vector3(cx, l0.y, cz), l1); tri(r1, new THREE.Vector3(cx, r0.y, cz), r0); // flanks back into the hill
    }
    const [ft, lt, rt] = ring.at(-1); tri(ft, rt, lt);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mats.rock); m.receiveShadow = true; g.add(m);
  }

  // The roofscape. On terrace i (between wall i+1 behind and wall i in front) houses grow taller toward the back,
  // so the back rows reach the top of the next wall and no bare step shows. Wall towers stand on every ring,
  // a dark gate opening sits alternately left and right of the prow.
  const houses = [], towers = [], gates = [], glows = [], Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  const put = (list, x, y, z, rot, sx, sy, sz) => list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), Q.setFromAxisAngle(Y, rot).clone(), new THREE.Vector3(sx, sy, sz)));
  const onRing = (r, th, y) => [cx + r * Math.sin(th), y, cz + r * Math.cos(th)];
  const clearOfProw = (r, th, y, pad) => Math.abs(r * Math.sin(th)) > prowW(y) + pad;
  for (let i = 0; i < 7; i++) {
    const r = R[i], base = i ? top(i - 1) : PLAIN, gate = (i % 2 ? 1 : -1) * (0.32 + 0.05 * i);
    for (let th = -Math.PI / 2 + 0.06; th < Math.PI / 2 - 0.04; th += 64 / r) // a tower every ~64 m of wall
      if (clearOfProw(r, th, base, 14) && Math.abs(th - gate) > 0.08) put(towers, ...onRing(r + 2, th, base), th, 10, top(i) - base + 5, 10);
    put(gates, ...onRing(r + 0.6, gate, base), gate, 9, 13, 2);
  }
  for (let i = 0; i < 6; i++) {
    const r0 = R[i + 1] + 4, r1 = R[i] - 3, n = Math.round((Math.PI / 2) * (r1 * r1 - r0 * r0) / 95), y = top(i);
    for (let k = 0; k < n; k++) {
      const th = (rand() * 2 - 1) * (Math.PI / 2 - 0.05), rr = r0 + rand() * (r1 - r0);
      if (!clearOfProw(rr, th, y, 6)) continue;
      const back = (r1 - rr) / (r1 - r0), w = 7 + rand() * 9, d = 6 + rand() * 6, hh = 6 + 19 * back ** 1.6 + rand() * 5;
      const [x, , z] = onRing(rr, th, y);
      put(houses, x, y, z, th + (rand() - 0.5) * 0.2, w, hh, d);
      if (rand() < 0.5) for (let wdw = 0; wdw < 1 + (rand() * 3 | 0); wdw++) {
        const off = (rand() - 0.5) * w * 0.7;
        put(glows, x + Math.sin(th) * (d / 2 + 0.3) + Math.cos(th) * off, y + hh * (0.25 + rand() * 0.6), z + Math.cos(th) * (d / 2 + 0.3) - Math.sin(th) * off, th, 1, 1, 1);
      }
    }
  }
  put(houses, cx, top(6), cz + 4, 0, 46, 18, 34); // the citadel's hall behind the tower
  const inst = (geo, mat, list) => { const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((m, k) => im.setMatrixAt(k, m)); im.receiveShadow = true; g.add(im); return im; };
  const roofed = houseGeometry();
  inst(roofed, mats.house, houses);
  inst(roofed, mats.house, towers);
  inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mats.dark, gates);
  inst(new THREE.PlaneGeometry(2.4, 1.9), glowMat, glows);

  // the tower on the top tier, just behind the prow's tip (~90 m, with a pinnacle)
  const tz = cz + 42, ty = top(6);
  const part = (geo, y) => { const m = new THREE.Mesh(geo, mats.wall); m.position.set(cx, ty + y, tz); g.add(m); };
  part(new THREE.CylinderGeometry(6.5, 7.5, 92, 32), 46);
  part(new THREE.CylinderGeometry(8.6, 8.6, 4, 32), 84);
  part(new THREE.CylinderGeometry(7.2, 7.2, 8, 32), 90);
  part(new THREE.ConeGeometry(7.4, 24, 32), 106);
  part(new THREE.CylinderGeometry(0.5, 0.5, 12, 6), 122);
  return g;
}

// the outer field wall: a low ring round the city across the plain, too long to take in, which is the point
function fieldWall(mat) {
  const r = 760, geo = new THREE.CylinderGeometry(r, r, 12, 256, 1, true, -1.25, 2.5);
  const m = new THREE.Mesh(geo, mat); m.position.set(CITY.x, PLAIN + 1, CITY.z);
  return m;
}

// --- a photogrammetry city, if one was dropped in ------------------------------------------------------------
const SCAN = 'assets/sketchfab/minas_tirith/';
async function loadScan(wrap, glowMat, P) {
  for (const f of ['scene.glb', 'scene.gltf']) {
    if (!await fetch(SCAN + f, { method: 'HEAD' }).then((r) => r.ok, () => false)) continue;
    const gl = await new GLTFLoader().loadAsync(SCAN + f);
    const pivot = new THREE.Group(), root = gl.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    root.position.set(-c.x, -box.min.y, -c.z); // base centre to the pivot
    pivot.add(root);
    const place = () => {
      pivot.scale.setScalar(P.scanHeight / size.y);
      pivot.rotation.y = THREE.MathUtils.degToRad(P.scanYaw);
      pivot.position.set(CITY.x, PLAIN - P.scanSink, CITY.z - P.scanBack);
    };
    place();
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.material = wrap(scanMaterial(o.material));
      o.receiveShadow = true; o.userData.noAO = true;
    });
    // lit windows at night: points on faces looking out toward the plain
    pivot.updateMatrixWorld(true);
    const spots = [], n = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || spots.length > 4000) return;
      const p = o.geometry.attributes.position, ix = o.geometry.index, tris = (ix ? ix.count : p.count) / 3;
      for (let t = 0; t < Math.min(tris, 1500); t++) {
        const k = Math.floor(Math.random() * tris) * 3, at = (j) => (ix ? ix.getX(k + j) : k + j);
        a.fromBufferAttribute(p, at(0)).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(p, at(1)).applyMatrix4(o.matrixWorld); cc.fromBufferAttribute(p, at(2)).applyMatrix4(o.matrixWorld);
        n.subVectors(b, a).cross(cc.clone().sub(a)).normalize();
        if (n.z > 0.6 && Math.abs(n.y) < 0.4 && a.y > PLAIN + 8) spots.push(new THREE.Matrix4().lookAt(new THREE.Vector3(), n, new THREE.Vector3(0, 1, 0)).setPosition(a.add(b).add(cc).divideScalar(3).addScaledVector(n, 0.4)));
      }
    });
    const pick = spots.sort(() => Math.random() - 0.5).slice(0, 900), toPivot = pivot.matrixWorld.clone().invert();
    // in the pivot's frame (the instance matrices carry the inverse scale), so the windows turn and scale with the city
    const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.2, 1.8).rotateY(Math.PI), glowMat, pick.length);
    pick.forEach((m, k) => glow.setMatrixAt(k, m.premultiply(toPivot)));
    pivot.add(glow);
    const g = new THREE.Group(); g.add(pivot);
    return { group: g, place };
  }
  return null;
}
// The scan's albedo carries the light it was photographed under. Divide by its own blurred copy (a deep mip) to
// keep the carving and drop the lighting, then take only luminance and recolour it as limestone.
function scanMaterial(src) {
  const m = new THREE.MeshStandardMaterial({ map: src.map, color: '#bdbab3', roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
        vec3 sc = texture2D(map, vMapUv).rgb, lo = textureLod(map, vMapUv, 6.0).rgb, mid = textureLod(map, vMapUv, 4.0).rgb;
        float carve = pow(clamp(dot(sc / max(lo, vec3(0.03)), vec3(0.333)), 0.3, 1.8), 1.5); // steeper: carved shadows read at 1 km
        // the statue's rock is painted greener than its masonry (green/luminance ~0.24-0.32 vs ~0.17, measured):
        // that rock becomes the mountain's dark stone, the buildings stay pale limestone
        float lm = dot(mid, vec3(0.333)), rock = smoothstep(0.175, 0.215, (mid.g - 0.5 * (mid.r + mid.b)) / max(lm, 0.01));
        // centuries of rain: faint vertical streaks (noise stretched down the height), darker toward each foot
        vec3 sp = (vSkyW - uSkyOrigin) / uSkyU;
        float streak = fract(sin(floor(dot(sp.xz, vec2(0.7)) / 2.5) * 91.7) * 4375.5); // one value per 2.5 m column
        float weather = 1.0 - 0.18 * smoothstep(0.55, 1.0, streak) * (0.6 + 0.4 * sin(sp.y / 23.0));
        diffuseColor.rgb *= carve * weather * mix(vec3(1.0), vec3(0.36, 0.35, 0.33), rock);
      #endif`);
  };
  m.customProgramCacheKey = () => 'citadel-scan';
  return m;
}

// --- the map --------------------------------------------------------------------------------------------
export function createCitadel({ renderer, wind, ambient, key }) {
  useWind(wind.uniforms);
  const g = new THREE.Group(); g.name = 'citadel'; g.visible = false;
  const sky = createVolumetricSky(renderer, { wind });
  // afternoon, the sun from the right and behind the viewer's shoulder (~55 deg off the walls' facing): it rakes across the curved walls, each tier
  // grading from lit (right) to shade (left), the prow's right face lit and its left dark. Never frontal.
  Object.assign(sky.values, { elev: 18, azim: -125, cover: 0.72, sunGap: 0, haze: 2.6, rays: 2.2,
    hole: 420, holeX: CITY.x, holeY: 420, holeZ: CITY.z,             // a break in the clouds pours sun on the city
    matte: 1, matteAz: 8, matteEl: 44, matteW: 18, matteD: 5000 }); sky.apply();    // and Mindolluin's snows rise behind it
  const lights = createSkyLights(sky, { ambient, key });
  g.add(sky.dome, lights.group);

  const P = { aerial: 0.3, mist: 2, lights: 1, scanYaw: -45, scanHeight: 1150, scanSink: 245, scanBack: 0 }; // scan defaults fit the 3digify Sketchfab scan (512b6293): prow edge-on to the meadow, pedestal buried
  // mist pooled on the plain: optical depth of a straight ray through an exponential layer (scale height 40 m)
  // above the plain, so the city's foot sits in it and the top tiers stay crisp; the near meadow is too short a ray
  const MIST = { uMist: { value: 0 }, uMistCol: { value: new THREE.Color() }, uMistH: { value: 40 }, uMistBase: { value: PLAIN } };
  const misty = (mat) => {
    const prev = mat.onBeforeCompile, key0 = mat.customProgramCacheKey?.bind(mat);
    mat.onBeforeCompile = (sh, r) => {
      prev?.call(mat, sh, r);
      Object.assign(sh.uniforms, MIST);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uMist, uMistH, uMistBase; uniform vec3 uMistCol;')
        .replace('#include <fog_fragment>', `{
          vec3 mp = (vSkyW - uSkyOrigin) / uSkyU, me = (cameraPosition - uSkyOrigin) / uSkyU;
          float h0 = max(me.y - uMistBase, 0.0), h1 = max(mp.y - uMistBase, 0.0), e0 = exp(-h0 / uMistH), e1 = exp(-h1 / uMistH);
          float avg = abs(h1 - h0) < 0.5 ? e0 : uMistH * (e0 - e1) / (h1 - h0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistCol, 1.0 - exp(-uMist * distance(mp, me) * avg)); }
        #include <fog_fragment>`);
    };
    mat.customProgramCacheKey = () => `${key0?.() ?? ''}|mist`;
    return mat;
  };
  const wrap = (mat) => misty(sky.patchReceiver(mat, { aerial: true }));

  const ground = terrain(); wrap(ground.material); g.add(ground);
  const water = river(); g.add(water);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffb066', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const ashlar = texture('castle_brick_02_white');
  const stone = (hex) => { // the ashlar photo is orange-grey: keep its courses and weathering as luminance only
    const m = new THREE.MeshStandardMaterial({ map: ashlar, color: hex, roughness: 0.9 });
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
      'diffuseColor.rgb *= clamp(dot(texture2D(map, vMapUv).rgb, vec3(0.333)) / 0.17, 0.4, 1.5);'); };
    m.customProgramCacheKey = () => 'citadel-ashlar';
    return wrap(m);
  };
  const mats = {
    wall: stone('#efe6d3'), outer: stone('#a9a59c'), paving: wrap(new THREE.MeshStandardMaterial({ color: '#cfc8b8', roughness: 1 })),
    house: wrap(new THREE.MeshStandardMaterial({ vertexColors: true, color: '#efe8da', roughness: 0.9 })),
    dark: wrap(new THREE.MeshStandardMaterial({ color: '#141210', roughness: 1 })),
    rock: wrap(new THREE.MeshStandardMaterial({ color: '#7a756c', roughness: 1, flatShading: true, side: THREE.DoubleSide })),
  };
  const procedural = city(mats, glowMat);
  g.add(procedural, fieldWall(mats.outer));
  let scan = null;
  loadScan(wrap, glowMat, P).then((s) => { if (!s) return; scan = s; procedural.visible = false; g.add(s.group); noInk(s.group); s.group.traverse((o) => { o.userData.noAO = true; }); }, (e) => console.warn('citadel scan:', e));

  // grass round her, denser close in (it thins with distance on the GPU); groves on the slope and the plain.
  // None on the viewer's side of the glass (z > 0.4 m): those blades would stand inches from the eye.
  const grass = grassField(14000, () => {
    const r = 1 + Math.random() ** 1.8 * 48, a = Math.random() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = height(x, z);
    return z > 0.2 || y > 1.5 ? null : [x, y, z]; // not up the cliff face
  }, (c) => c.setHSL(0.09 + Math.random() * 0.06, 0.4 + Math.random() * 0.2, 0.62 + Math.random() * 0.2)); // straw to olive (the blades themselves are green: this pulls them to hay)
  grass.userData.noAO = true; g.add(grass);
  const spots = [[-15, -10, 1.3], [19, -24, 1.5], [-34, -46, 1.7], [40, -60, 1.6]];
  let s = 3; const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 7; k++) { // the Pelennor is open farmland: a few copses, not a woodland
    const gx = (rand() * 2 - 1) * 1300, gz = -90 - rand() * 1000;
    if (Math.hypot(gx - CITY.x, gz - CITY.z) < 760 || Math.abs(gz - riverZ(gx)) < 40) continue;
    for (let n = 3 + rand() * 9; n > 0; n--) spots.push([gx + (rand() - 0.5) * 60, gz + (rand() - 0.5) * 40, 1.4 + rand()]);
  }
  for (let n = 0; n < 28; n++) { const x = (rand() * 2 - 1) * 1800; spots.push([x, riverZ(x) + (rand() < 0.5 ? -1 : 1) * (26 + rand() * 10), 1.3 + rand() * 0.8]); }
  // dark, desaturated olive crowns of many small cards: the bright blobby anime trees fought the film grade
  const grove = trees(spots, height, { refs: false, look: { h: [70, 30], s: [16, 16], l: [17, 18] }, cards: 90, size: 0.32, bark: '#3b3631' });
  const done = new Set(); grove.traverse((o) => { if (o.material && !done.has(o.material)) { done.add(o.material); wrap(o.material); } });
  grove.userData.noAO = true; g.add(grove);
  procedural.traverse((o) => { o.userData.noAO = true; });
  // birds wheeling between her and the city: specks that move, the last scale cue (a 3 m wingspan at ~1 km)
  const BIRDS = 36, birds = new THREE.InstancedMesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(
    [-1, 0.45, 0, 0, 0, 0.3, 0, 0, -0.15, 1, 0.45, 0, 0, 0, -0.15, 0, 0, 0.3], 3)), new THREE.MeshBasicMaterial({ color: '#15130f', side: THREE.DoubleSide }), BIRDS);
  const flock = Array.from({ length: BIRDS }, (_, k) => ({ r: 220 + rand() * 330, a: rand() * 6.28, y: 120 + rand() * 260, w: (0.05 + rand() * 0.05) * (k % 3 ? 1 : -1), f: 4 + rand() * 3 }));
  birds.frustumCulled = false; birds.userData.noAO = true; g.add(birds);
  const lead = new THREE.Vector3(), bm = new THREE.Matrix4(), bq = new THREE.Quaternion(), bs = new THREE.Vector3(), bp = new THREE.Vector3(), Yb = new THREE.Vector3(0, 1, 0);
  const flyBirds = (t) => flock.forEach((b, k) => {
    const a = b.a + t * b.w, flap = 0.35 + 0.65 * Math.abs(Math.sin(t * b.f + k));
    bp.set(CITY.x + Math.cos(a) * b.r, b.y + Math.sin(t * 0.3 + k) * 12, CITY.z + 650 + Math.sin(a) * b.r * 0.6);
    if (k === 0) lead.copy(bp);
    birds.setMatrixAt(k, bm.compose(bp, bq.setFromAxisAngle(Yb, -a + (b.w > 0 ? 0 : Math.PI)), bs.set(2.4, 2.4 * flap, 2.4)));
  });

  noInk(g);

  const fog = new THREE.FogExp2(0xffffff, 0), origin = new THREE.Vector3();
  let units = 1;
  const setFog = () => { fog.density = P.aerial / (1500 * units); MIST.uMist.value = P.mist * 4.9e-4; };
  const num = (id, label, doc, min, max, step, after) => ({ id, label, doc, min, max, step, get: () => P[id], set: (v) => { P[id] = v; after?.(); } });
  const replace = () => scan?.place();
  return {
    group: g,
    look: { exposure: 1.0, amb: ['#c8ccd4', 1.0], key: ['#ffffff', 0.9], keyDir: new THREE.Vector3(0.3, 0.6, 1), gi: 0.6,
      // the films' Gondor grade: desaturated, cool steel shade, warm light, firm contrast
      grade: { tint: [1, 0.98, 0.95], sat: 0.76, contrast: 1.12, sepia: 0, vignette: 0.26, shadows: [0.8, 0.9, 1.06], highlights: [1.05, 1.0, 0.9] }, bloom: 0.4, bloomThreshold: 1.1 },
    params: [
      ...sky.params,
      num('aerial', '공기 원근', 'Aerial perspective: how much the air fades the far city and mountains (optical depth at 1.5 km; squared falloff keeps the meadow clear).', 0, 2, 0.01, setFog),
      num('mist', '평원 안개', 'Mist pooled on the plain (scale height 40 m): the city rises out of it, the top tiers stay clear. 1 = ~40% at the city foot.', 0, 4, 0.01, setFog),
      num('lights', '성의 불빛', 'Brightness of the lit windows in the city after sunset.', 0, 4, 0.05),
      num('scanYaw', '스캔 방향', 'Only with a scanned city in assets/sketchfab/minas_tirith/: its rotation (deg) so the gate faces the meadow.', -180, 180, 1, replace),
      num('scanHeight', '스캔 높이', 'Only with a scanned city: its height in metres, base to the tower tip.', 150, 600, 1, replace),
      num('scanSink', '스캔 매몰', 'Only with a scanned city: metres sunk into the plain (buries a display pedestal).', 0, 160, 0.5, replace),
      num('scanBack', '스캔 깊이', 'Only with a scanned city: metres pushed back toward the mountain, so its own rock spur sinks into the cliff.', -200, 400, 1, replace),
    ],
    sky,
    // what she looks at when her eyes leave you (src/character/Life.js), stage metres
    interests: () => [
      { p: [CITY.x, 760, CITY.z - 40], label: 'tower' }, { p: [CITY.x, 30, CITY.z + 560], label: 'gate' },
      { p: lead.toArray(), label: 'birds' }, { p: [75, 80, -160], label: 'cliff' }, { p: [CITY.x - 200, 1100, CITY.z], label: 'sky' },
    ],
    async fit(scene, U) {
      units = U; g.scale.setScalar(U);
      lights.fitShadow(U, 16);
      setFog(); scene.fog = fog;
    },
    tick(t, { dt, camera }) {
      flyBirds(t); birds.instanceMatrix.needsUpdate = true;
      g.getWorldPosition(origin);
      sky.tick(t, dt, camera, { origin, U: units });
      lights.update();
      const hz = sky.uniforms.uHorizon.value;
      fog.color.copy(hz).multiplyScalar(sky.values.skyGain);
      MIST.uMistCol.value.copy(fog.color).multiplyScalar(1.05);
      water.material.color.copy(hz).multiplyScalar(0.9 * sky.values.skyGain);
      glowMat.color.setRGB(1, 0.62, 0.3).multiplyScalar(3 * P.lights * (1 - ss(sky.values.elev, -4, 3)));
    },
  };
}
