// Citadel meadow (성채의 초원): a windswept meadow on a brow above a river plain, and 1.2-2 km out a white city of
// seven walled tiers built out from a mountain's face, split by a rock prow, a tower on the top tier. An original
// city in that spirit, not a replica of any film's. Everything sits under the engine sky (engine/sky/): cloud
// shadows cross the meadow, the plain, the walls and the mountain; the time of day (citadel.elev) turns the walls
// gold, then pink in the afterglow, then a city of lit windows under the moon.
//
// Metres, stage origin at her feet, -z away from the viewer. The far plane is ~2.4 km at the usual U, so the world
// ends at 2 km behind a mountain range. Aerial perspective is FogExp2: its squared falloff leaves the meadow clear
// and fades the city by about a third (citadel.aerial).
import * as THREE from 'three';
import { createVolumetricSky, createSkyLights } from '../../engine/sky/VolumetricSky.js';
import { grassField, trees, useWind, noInk } from './crossing/Foliage.js';

const PLAIN = -26;                                   // the river plain below the meadow's brow
const CITY = { x: -260, z: -1500, r: [300, 262, 224, 186, 148, 110, 74], rise: 34 };
const top = (i) => PLAIN + CITY.rise * (i + 1);      // tier i's terrace height
const END_Z = -1980, SIDE = 3200;
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
const riverZ = (x) => -640 + 70 * Math.sin(x / 260) + 30 * Math.sin(x / 97 + 1.3);

function height(x, z) {
  // meadow: rolling, flat where she stands, falling off the brow to the plain
  const brow = ss(z, -420, -50);
  let h = ((fbm(x / 90, z / 90) - 0.5) * 7 + (fbm(x / 23, z / 23) - 0.5) * 1.3) * ss(Math.hypot(x, z), 3, 26) * brow
        + (PLAIN + (fbm(x / 300, z / 300) - 0.5) * 5) * (1 - brow);
  h -= 2.6 * (1 - ss(Math.abs(z - riverZ(x)), 9, 34)) * (1 - brow);
  const cr = Math.hypot(x - CITY.x, z - CITY.z);
  h += (PLAIN - h) * (1 - ss(cr, CITY.r[0] + 10, CITY.r[0] + 90)); // the city stands on a level pad
  // the mountain the city is built against, and the range behind it along the whole horizon
  const mx = (x - CITY.x - 40) / 640, mz = (z - CITY.z + 220) / 260;
  let m = 660 * Math.exp(-mx * mx - mz * mz) * (0.6 + 0.6 * ridged(x / 380, z / 380, 5));
  m = Math.max(m, (300 + 260 * fbm(x / 520, 3.7)) * (1 - ss(z, -1900, -1700)) * (0.75 + 0.4 * ridged(x / 260, z / 260, 5)));
  m *= 0.8 + 0.4 * ridged(x / 130, z / 130, 4); // gullies and spurs down the faces
  m *= 1 - (1 - ss(cr, CITY.r[0] + 20, CITY.r[0] + 160)) * ss(z, CITY.z - 60, CITY.z + 10); // the city's bowl in its face
  return h + m;
}

// One grid, warped so cells are ~0.4 m under her feet and ~40 m at the mountains.
function terrain(sky) {
  const N = 360, xs = [], zs = [];
  for (let i = 0; i <= N; i++) { const u = (i / N) * 2 - 1; xs.push(Math.sign(u) * SIDE * Math.abs(u) ** 2.4); zs.push(u < 0 ? END_Z * (-u) ** 2.2 : 150 * u ** 2.2); }
  const pos = new Float32Array((N + 1) ** 2 * 3), uv = new Float32Array((N + 1) ** 2 * 2), idx = [];
  for (let j = 0, k = 0; j <= N; j++) for (let i = 0; i <= N; i++, k++) {
    const x = xs[i], z = zs[j];
    pos.set([x, height(x, z), z], k * 3); uv.set([x / 6, z / 6], k * 2);
    if (i < N && j < N) idx.push(k, k + N + 1, k + 1, k + 1, k + N + 1, k + N + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  // albedo by place: meadow and plain take the grass texture, steep or high ground is rock, then snow
  const nrm = geo.attributes.normal, col = new Float32Array(pos.length), rock = new Float32Array(pos.length / 3);
  const c = new THREE.Color(), MEADOW = new THREE.Color(0.5, 0.72, 0.34), FIELD = new THREE.Color(0.66, 0.74, 0.36), SCRUB = new THREE.Color(0.2, 0.27, 0.15), STONE = new THREE.Color(0.2, 0.19, 0.18), SNOW = new THREE.Color(0.92, 0.94, 0.98);
  for (let k = 0; k < rock.length; k++) {
    const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2], ny = nrm.getY(k);
    const r = Math.max(1 - ss(ny, 0.7, 0.9), ss(y, PLAIN + 40, PLAIN + 140)), snow = ss(y, 430, 520) * ss(ny, 0.45, 0.7);
    c.lerpColors(MEADOW, FIELD, ss(z, -60, -420) * fbm(x / 140, z / 140, 2)).multiplyScalar(0.85 + 0.3 * fbm(x / 40, z / 40, 2));
    // dark rock with scrub on the gentler lower slopes, so the white city stands out against the mountain
    const rk = STONE.clone().multiplyScalar(0.75 + 0.5 * fbm(x / 60, y / 60, 2)).lerp(SCRUB, ss(ny, 0.55, 0.8) * (1 - ss(y, 150, 380)) * fbm(x / 90, z / 90, 3));
    c.lerp(rk, r).lerp(SNOW, snow);
    col.set([c.r, c.g, c.b], k * 3); rock[k] = Math.max(r, snow);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aRock', new THREE.BufferAttribute(rock, 1));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRock; varying float vRock;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRock = aRock;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRock;')
      .replace('#include <map_fragment>', '#ifdef USE_MAP\n diffuseColor.rgb *= mix(vec3(dot(texture2D(map, vMapUv).rgb, vec3(0.33)) / 0.06), vec3(1.0), vRock); // detail only (its dirt browned the meadow), / its mean luminance\n#endif');
  };
  mat.customProgramCacheKey = () => 'citadel-terrain';
  // the grass texture is optional (scripts/get-polyhaven.py); without it the ground is vertex colour only
  new THREE.TextureLoader().load('assets/polyhaven/tex/sparse_grass/diff.jpg', (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    mat.map = t; mat.needsUpdate = true;
  }, undefined, () => {});
  const mesh = new THREE.Mesh(geo, sky.patchReceiver(mat, { aerial: true }));
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
const PROW_W = 42; // half-width of the rock prow where it meets the mountain
function prowFront(y) { // radius of the prow's keel at height y: always a little outside the tier walls
  const ys = [PLAIN - 1, ...CITY.r.map((_, i) => top(i)), top(6) + 10], rs = [CITY.r[0] + 14, ...CITY.r.map((r) => r + 12), CITY.r[6] - 10];
  for (let k = 1; k < ys.length; k++) if (y <= ys[k]) return rs[k - 1] + (rs[k] - rs[k - 1]) * (y - ys[k - 1]) / (ys[k] - ys[k - 1]);
  return rs.at(-1);
}

function city(sky, glowMat) {
  const g = new THREE.Group(), { x: cx, z: cz, r: R } = CITY;
  const stone = sky.patchReceiver(new THREE.MeshStandardMaterial({ color: '#ebe6db', roughness: 0.9 }), { aerial: true });
  const paving = sky.patchReceiver(new THREE.MeshStandardMaterial({ color: '#c9c4b8', roughness: 1 }), { aerial: true });
  const rockMat = sky.patchReceiver(new THREE.MeshStandardMaterial({ color: '#8e8a83', roughness: 1, flatShading: true, side: THREE.DoubleSide }), { aerial: true });
  const houseMat = sky.patchReceiver(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), { aerial: true });
  let rnd = 9; const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);

  // seven tiers: half-cylinders facing the plain, the open back sunk in the mountain
  R.forEach((r, i) => {
    const h = top(i) - PLAIN + 1;
    const geo = new THREE.CylinderGeometry(r, r * 1.012, h, 96, 1, false, -Math.PI / 2, Math.PI);
    const m = new THREE.Mesh(geo, [stone, paving, stone]);
    m.position.set(cx, PLAIN - 1 + h / 2, cz); m.castShadow = m.receiveShadow = true; g.add(m);
  });

  // the prow: a keel of rock rising from the plain to the top tier, the walls running into its flanks
  {
    const pos = [], ys = [PLAIN - 1, ...R.map((_, i) => top(i) - 6), top(6) + 10];
    const ring = ys.map((y, k) => { const w = PROW_W * (0.8 + 0.4 * rand()), rr = prowFront(y) + (k && k < ys.length - 1 ? (rand() - 0.5) * 8 : 0);
      return [new THREE.Vector3(cx, y, cz + rr), new THREE.Vector3(cx - w, y, cz), new THREE.Vector3(cx + w, y, cz)]; });
    const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let k = 0; k + 1 < ring.length; k++) {
      const [f0, l0, r0] = ring[k], [f1, l1, r1] = ring[k + 1];
      tri(f0, l0, l1); tri(f0, l1, f1); tri(f0, r1, r0); tri(f0, f1, r1);
    }
    const [ft, lt, rt] = ring.at(-1); tri(ft, rt, lt);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, rockMat); m.castShadow = m.receiveShadow = true; g.add(m);
  }

  // houses on every terrace (none against the prow), towers among them, lit windows for the night
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), bc = [];
  for (let v = 0; v < 24; v++) bc.push(...(v >= 8 && v < 12 ? [0.42, 0.44, 0.5] : [1, 1, 1])); // +y face = slate roof
  box.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
  const houses = [], glows = [], M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
  const put = (list, x, y, z, rot, sx, sy, sz) => list.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), Q.setFromAxisAngle(Y, rot).clone(), new THREE.Vector3(sx, sy, sz)));
  for (let i = 0; i < 6; i++) {
    const r0 = R[i + 1] + 5, r1 = R[i] - 4, n = Math.round((Math.PI / 2) * (r1 * r1 - r0 * r0) / 200);
    for (let k = 0; k < n; k++) {
      const th = (rand() * 2 - 1) * (Math.PI / 2 - 0.04), rr = r0 + rand() * (r1 - r0);
      if (Math.abs(rr * Math.sin(th)) < PROW_W * 0.6 + 14 * (1 - rr / R[0])) continue;
      const tall = rand() < 0.04, w = tall ? 6 : 7 + rand() * 8, d = tall ? 6 : 7 + rand() * 6, hh = tall ? 22 + rand() * 18 : 6 + rand() * 7 + (rr - r0) / (r1 - r0) * 4;
      const x = cx + rr * Math.sin(th), z = cz + rr * Math.cos(th), y = top(i);
      put(houses, x, y, z, th, w, hh, d);
      if (rand() < 0.55) for (let wdw = 0; wdw < 1 + (rand() * 2 | 0); wdw++) {
        const off = (rand() - 0.5) * w * 0.7, fx = Math.cos(th), fz = -Math.sin(th);
        put(glows, x + Math.sin(th) * (d / 2 + 0.3) + fx * off, y + hh * (0.3 + rand() * 0.4), z + Math.cos(th) * (d / 2 + 0.3) + fz * off, th, 1, 1, 1);
      }
    }
  }
  // the citadel: a long hall behind the tower
  put(houses, cx, top(6), cz + 4, 0, 34, 20, 46);
  const inst = (geo, mat, list) => { const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((m, k) => im.setMatrixAt(k, m)); return im; };
  const hm = inst(box, houseMat, houses); hm.castShadow = hm.receiveShadow = true; g.add(hm);
  const gm = inst(new THREE.PlaneGeometry(2.4, 1.9), glowMat, glows); gm.userData.noAO = true; g.add(gm);

  // the tower on the top tier, just behind the prow's tip
  const tower = new THREE.Group(), tz = cz + 42, ty = top(6);
  const part = (geo, y) => { const m = new THREE.Mesh(geo, stone); m.position.set(cx, ty + y, tz); m.castShadow = true; tower.add(m); };
  part(new THREE.CylinderGeometry(6.5, 7.5, 96, 24), 48);
  part(new THREE.CylinderGeometry(8.4, 8.4, 4, 24), 86);
  part(new THREE.ConeGeometry(7, 22, 24), 107);
  part(new THREE.CylinderGeometry(0.5, 0.5, 10, 6), 122);
  g.add(tower);
  g.traverse((o) => { o.userData.noAO = true; });
  return { group: g, windows: glows.length };
}

// --- the map --------------------------------------------------------------------------------------------
export function createCitadel({ renderer, wind, ambient, key }) {
  useWind(wind.uniforms);
  const g = new THREE.Group(); g.name = 'citadel'; g.visible = false;
  const sky = createVolumetricSky(renderer, { wind });
  // late afternoon, the sun low behind the viewer's right shoulder: the walls take it full on
  Object.assign(sky.values, { elev: 10, azim: -115, cover: 0.45, sunGap: 0 }); sky.apply();
  const lights = createSkyLights(sky, { ambient, key });
  g.add(sky.dome, lights.group);

  g.add(terrain(sky));
  const water = river(); g.add(water);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffb066', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: true });
  g.add(city(sky, glowMat).group);

  // grass round her, denser close in (it thins with distance on the GPU); groves on the slope and the plain.
  // None on the viewer's side of the glass (z > 0.4 m): those blades would stand inches from the eye.
  const grass = grassField(14000, () => {
    const r = 1 + Math.random() ** 1.8 * 48, a = Math.random() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
    return z > 0.2 ? null : [x, height(x, z), z];
  });
  grass.userData.noAO = true; g.add(grass);
  const spots = [[-15, -10, 1.3], [19, -24, 1.5], [-34, -46, 1.7], [40, -60, 1.6]];
  let s = 3; const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 16; k++) {
    const gx = (rand() * 2 - 1) * 1300, gz = -90 - rand() * 1000;
    if (Math.hypot(gx - CITY.x, gz - CITY.z) < CITY.r[0] + 120 || Math.abs(gz - riverZ(gx)) < 40) continue;
    for (let n = 3 + rand() * 9; n > 0; n--) spots.push([gx + (rand() - 0.5) * 60, gz + (rand() - 0.5) * 40, 1.4 + rand()]);
  }
  for (let n = 0; n < 50; n++) { const x = (rand() * 2 - 1) * 1800; spots.push([x, riverZ(x) + (rand() < 0.5 ? -1 : 1) * (26 + rand() * 10), 1.3 + rand() * 0.8]); }
  const grove = trees(spots, height, { refs: false });
  grove.userData.noAO = true; g.add(grove);
  noInk(g);

  const fog = new THREE.FogExp2(0xffffff, 0), origin = new THREE.Vector3();
  const P = { aerial: 0.45, lights: 1 };
  let units = 1;
  const setFog = () => { fog.density = P.aerial / (1500 * units); };
  const num = (id, label, doc, min, max, step, after) => ({ id, label, doc, min, max, step, get: () => P[id], set: (v) => { P[id] = v; after?.(); } });
  return {
    group: g,
    look: { exposure: 1.0, amb: ['#c8ccd4', 1.0], key: ['#ffffff', 0.9], keyDir: new THREE.Vector3(0.3, 0.6, 1), gi: 0.6,
      grade: { tint: [1, 1, 1], sat: 1.05, contrast: 1.05, sepia: 0, vignette: 0.15 }, bloom: 0.35, bloomThreshold: 1.2 },
    params: [
      ...sky.params,
      num('aerial', '공기 원근', 'Aerial perspective: how much the air fades the far city and mountains (optical depth at 1.5 km; squared falloff keeps the meadow clear).', 0, 2, 0.01, setFog),
      num('lights', '성의 불빛', 'Brightness of the lit windows in the city after sunset.', 0, 4, 0.05),
    ],
    sky,
    async fit(scene, U) {
      units = U; g.scale.setScalar(U);
      lights.fitShadow(U, 16);
      setFog(); scene.fog = fog;
    },
    tick(t, { dt, camera }) {
      g.getWorldPosition(origin);
      sky.tick(t, dt, camera, { origin, U: units });
      lights.update();
      const hz = sky.uniforms.uHorizon.value;
      fog.color.copy(hz).multiplyScalar(sky.values.skyGain);
      water.material.color.copy(hz).multiplyScalar(0.9 * sky.values.skyGain);
      glowMat.color.setRGB(1, 0.62, 0.3).multiplyScalar(3 * P.lights * (1 - ss(sky.values.elev, -4, 3)));
    },
  };
}
