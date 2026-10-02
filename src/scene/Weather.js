// Weather / time-of-day presets for the crossing: Poly Haven HDRI sky (background + IBL) with the sun
// light aligned to the sun in the photo, PBR textures, wet asphalt with real planar reflections,
// falling snow, night lights, and a per-preset colour grade. Assets come from
// scripts/get-polyhaven.py (CC0); without them only the stylised 'anime' preset works.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { REFS, groundY } from './Crossing.js';

const PH = 'assets/polyhaven/';
const deg = THREE.MathUtils.degToRad;
// az: where the sun should sit, degrees around the character (0 = toward the viewer, 90 = viewer's
// right, 180 = behind her). char: lights that only the toon character really feels.
export const WEATHERS = {
  anime: { label: '애니 맑음' },
  day: {
    label: '맑음', hdri: 'day', az: 305, env: 0.85, bg: 1, skySat: 1.6, exposure: 1, sun: ['#fff3df', 3.4], fog: ['#c9dcef', 80, 480],
    char: { amb: ['#b4b4b4', 1.1], key: ['#ffffff', 0.7] }, grade: { tint: [1, 1, 1], sat: 1.06, contrast: 1.03, sepia: 0, vignette: 0.12 }, bloom: 0.3,
  },
  sunset: {
    label: '노을', hdri: 'sunset', az: 228, minElev: 6, env: 0.8, bg: 0.6, exposure: 0.85, sun: ['#ffa458', 3.0], fog: ['#d9946c', 60, 380],
    char: { amb: ['#d9a98c', 0.85], key: ['#ffc58c', 0.8] }, grade: { tint: [1.05, 0.98, 0.9], sat: 1.0, contrast: 1.1, sepia: 0.11, vignette: 0.38 }, bloom: 0.12, bloomThreshold: 1.8, flare: false, // the low sun is already in the photo; flare + bloom smeared it
  },
  // char: her direct light (sun + key) must clearly beat the ambient, so the face sits in the toon ramp's lit band
  // (the flat, bright anime face). Ambient only fills; when it dominates she looks like a raw untextured model.
  // Overcast presets: the sky photo and fog carry the grey mood, her lights stay near neutral.
  rain: {
    label: '비 온 뒤', hdri: 'rain', az: 300, env: 1.15, bg: 1, exposure: 0.95, sun: ['#e4ecf4', 0.6], fog: ['#b4bfc8', 22, 230],
    char: { amb: ['#c4c7cc', 0.65], key: ['#f4f6fa', 3.0] }, grade: { tint: [0.98, 1, 1.02], sat: 0.96, contrast: 1.08, sepia: 0, vignette: 0.32 }, bloom: 0.35, wet: 1, flare: false,
  },
  snow: {
    label: '눈', hdri: 'snow', az: 300, env: 1.2, bg: 1, exposure: 1, sun: ['#f1f5ff', 0.8], fog: ['#e6edf4', 16, 170],
    char: { amb: ['#cdd2d8', 0.65], key: ['#fafbff', 3.0] }, grade: { tint: [0.97, 0.99, 1.04], sat: 0.96, contrast: 1.02, sepia: 0, vignette: 0.26 }, bloom: 0.35, snow: 1, flare: false,
  },
  night: {
    label: '밤', hdri: 'night', skyTame: [0.4, 2.5], az: 120, minElev: 25, env: 0.35, bg: 0.75, exposure: 1.25, sun: ['#9fb3ff', 0.35], fog: ['#141c2e', 20, 260],
    char: { amb: ['#8e9cc8', 0.55], key: ['#ffd2a0', 1.3] }, grade: { tint: [0.92, 0.96, 1.1], sat: 0.95, contrast: 1.08, sepia: 0, vignette: 0.45 }, bloom: 0.55, night: 1, flare: false,
  },
  // よふかしのうた-style night: violet shadows everywhere, magenta/cyan glow off the vending corner rimming her from
  // behind, coloured windows, pink haze on the ground, whole frame graded toward purple
  neon: {
    label: '네온 밤', hdri: 'night', skyTame: [0.4, 2.5], az: 120, minElev: 25, env: 0.35, bg: 0.6, exposure: 1.25, sun: ['#b39dff', 0.3], fog: ['#2a1645', 15, 200],
    char: { amb: ['#8c6ad8', 0.7], key: ['#eadcff', 1.3] }, grade: { tint: [1.04, 0.86, 1.22], sat: 1.15, contrast: 1.04, sepia: 0, vignette: 0.4 }, bloom: 0.6, bloomThreshold: 1.6, night: 1, neon: 1, flare: false,
  },
};

// --- HDRI sky: load, find the sun in the photo ---------------------------------------------------------
const skies = {};
async function loadSky(renderer, name, sat = 1, tame = null) {
  if (skies[name]) return skies[name];
  const tex = await new RGBELoader().loadAsync(`${PH}hdri/${name}.hdr`);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const { width: w, height: h, data } = tex.image;
  const f = data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat : (x) => x;
  let best = -1, bi = 0;
  for (let i = 0; i < w * h; i += 2) {
    const L = 0.2126 * f(data[i * 4]) + 0.7152 * f(data[i * 4 + 1]) + 0.0722 * f(data[i * 4 + 2]);
    if (L > best) { best = L; bi = i; }
  }
  // three's equirect lookup: u = atan(z, x) / 2π + 0.5, v = asin(y) / π + 0.5 (rows flipped on upload)
  const u = ((bi % w) + 0.5) / w, v = 1 - (((bi / w) | 0) + 0.5) / h;
  const phi = (u - 0.5) * Math.PI * 2, theta = (v - 0.5) * Math.PI;
  const sun = new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi));
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(tex).texture;
  pm.dispose();
  if (sat !== 1 || tame) { // background only: the env map above was baked from the original, so lighting is unchanged
    const to = data instanceof Uint16Array ? THREE.DataUtils.toHalfFloat : (x) => x;
    for (let i = 0; i < data.length; i += 4) {
      const r = f(data[i]), g = f(data[i + 1]), b = f(data[i + 2]), L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // tame = [knee, disc]: a real-exposure moon (~5e4) and its photographed halo (7-9x the sky, 14°+ wide)
      // bloomed over half the screen. Keep a crisp disc, roll the halo off softly.
      const k = !tame ? 1 : L > 50 ? tame[1] / L : 1 / (1 + L / tame[0]);
      data[i] = to(Math.max(0, L + (r - L) * sat) * k); data[i + 1] = to(Math.max(0, L + (g - L) * sat) * k); data[i + 2] = to(Math.max(0, L + (b - L) * sat) * k);
    }
    tex.needsUpdate = true;
  }
  return (skies[name] = { tex, env, sun });
}

// --- PBR textures (applied once if present) ------------------------------------------------------------
const loader = new THREE.TextureLoader();
function pbrSet(asset, repeat) {
  const t = (m, srgb) => {
    const x = loader.load(`${PH}tex/${asset}/${m}.jpg`);
    x.wrapS = x.wrapT = THREE.RepeatWrapping; x.repeat.set(...repeat); x.anisotropy = 8;
    if (srgb) x.colorSpace = THREE.SRGBColorSpace;
    return x;
  };
  return { map: t('diff', true), normalMap: t('nor_gl'), roughnessMap: t('rough') };
}
function applyTextures() {
  const set = (mat, tex, extra = {}) => { Object.assign(mat, tex, extra); mat.needsUpdate = true; };
  set(REFS.road.material, pbrSet('asphalt_02', [2, 60]), { roughness: 1, color: new THREE.Color('#d8d8d8') });
  set(REFS.ground.material, pbrSet('sparse_grass', [90, 90]), { roughness: 1, color: new THREE.Color('#b8dc9a') });
  set(REFS.ballast.material, pbrSet('sandy_gravel_02', [110, 1.2]), { roughness: 1, color: new THREE.Color('#d6d0c6') });
  set(REFS.railSide, pbrSet('rusty_metal_02', [120, 1]), { color: new THREE.Color('#ffffff') });
  const plaster = pbrSet('white_plaster_02', [2, 1]), tiles = pbrSet('grey_roof_tiles_02', [4, 2]);
  for (const m of REFS.walls) set(m, plaster, { roughness: 1 });
  for (const m of REFS.roofs) set(m, tiles, { roughness: 1 });
  // remember dry looks so weather can restore them
  for (const m of [REFS.road.material, REFS.ground.material, REFS.ballast.material, ...REFS.roofs, ...REFS.leaves])
    m.userData.dry = { color: m.color.clone(), map: m.map, normalMap: m.normalMap, roughnessMap: m.roughnessMap, roughness: m.roughness };
}

// --- wet asphalt: planar reflection mixed with the asphalt, puddles reflect more ----------------------
function wetRoad() {
  const mask = (() => {
    // 256x512, one tile = 6 x 12 m of road, square pixels (~2.3 cm)
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 256, 512);
    for (let p = 0; p < 4; p++) { // a few puddles per tile, each a lumpy cluster of blobs
      const px = 30 + Math.random() * 196, py = Math.random() * 512;
      for (let i = 0; i < 5; i++) {
        const cx = px + (Math.random() - 0.5) * 40, cy = py + (Math.random() - 0.5) * 30, r = 8 + Math.random() * 18;
        const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, '#fff'); g.addColorStop(0.6, '#ddd'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, r * 1.3, r, Math.random() * 3, 0, 7); x.fill();
      }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })();
  const { width: RW, length: RL, z: RZ } = REFS.roadSpan;
  // follows the hill: local z of the rotated plane is world height (the mirror plane stays flat; the slope is gentle)
  const geo = new THREE.PlaneGeometry(RW, RL, 1, 88), gp = geo.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setZ(i, groundY(RZ - gp.getY(i)));
  const r = new Reflector(geo, {
    textureWidth: Math.min(1024, innerWidth / 2), textureHeight: Math.min(1024, innerHeight / 2), clipBias: 0.002, // half res: only the puddles show it sharply
    shader: {
      uniforms: {
        color: { value: new THREE.Color(1, 1, 1) }, tDiffuse: { value: null }, textureMatrix: { value: null },
        tMap: { value: REFS.road.material.map }, tMask: { value: mask }, ambient: { value: new THREE.Color(0.55, 0.58, 0.62) },
        repeat: { value: new THREE.Vector2(2, RL / 3) },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */`
        uniform mat4 textureMatrix; varying vec4 vUvR; varying vec2 vUv; varying vec3 vWorld;
        void main() { vUv = uv; vUvR = textureMatrix * vec4(position, 1.0); vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse, tMap, tMask; uniform vec3 ambient; uniform vec2 repeat; uniform float uTime;
        varying vec4 vUvR; varying vec2 vUv; varying vec3 vWorld;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // expanding rings from drips off wires and leaves; sparse, each cell has its own rhythm
        vec2 drips(vec2 p) {
          vec2 n = vec2(0.0);
          for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
            vec2 cell = floor(p) + vec2(i, j);
            float h = hash(cell);
            if (h > 0.35) continue;
            vec2 c = cell + vec2(hash(cell + 3.1), hash(cell + 7.7));
            float ph = fract(uTime * (0.25 + h) + h * 17.0);
            vec2 d = p - c; float r = length(d), R = ph * 0.9;
            float wave = sin((r - R) * 40.0) * smoothstep(0.12, 0.0, abs(r - R)) * (1.0 - ph) * (1.0 - ph);
            n += d / (r + 1e-4) * wave;
          }
          return n;
        }
        void main() {
          vec3 base = texture2D(tMap, vUv * repeat).rgb;
          vec4 m = texture2D(tMask, vUv * vec2(1.0, ${(RL / 12).toFixed(3)}));
          float puddle = smoothstep(0.45, 0.6, m.r);
          vec2 pm = vUv * vec2(${RW.toFixed(1)}, ${RL.toFixed(1)}); // meters on the road
          vec2 wind = vec2(sin(pm.y * 3.1 + uTime * 1.7) + sin(pm.x * 4.3 - uTime * 1.3), cos(pm.x * 2.7 + pm.y * 1.9 + uTime * 2.1)) * 0.25;
          vec2 rip = drips(pm * 1.4) + wind;
          vec4 uvr = vUvR; uvr.xy += (base.rg - 0.35) * 0.05 * (1.0 - puddle) * uvr.w; // damp asphalt: reflection broken up by the grain
          uvr.xy += rip * 0.006 * puddle * uvr.w;
          vec3 refl = textureLod(tDiffuse, uvr.xy / uvr.w, mix(4.5, 0.0, puddle)).rgb; // damp film: a low mip = soft, blurry sheen
          vec3 V = normalize(cameraPosition - vWorld);
          float fres = 0.05 + 0.95 * pow(1.0 - max(V.y, 0.0), 5.0);
          float k = mix(0.02 + 0.12 * fres, 0.7 + 0.25 * fres, puddle); // damp asphalt: faint sheen at grazing angles; puddles mirror
          gl_FragColor = vec4(mix(base * ambient * 0.7, refl, k), 1.0);
        }`,
    },
  });
  const rt = r.getRenderTarget().texture; rt.generateMipmaps = true; rt.minFilter = THREE.LinearMipmapLinearFilter;
  r.material.userData.outlineParameters = { visible: false };
  r.rotation.x = -Math.PI / 2;
  r.position.set(0, 0.006, RZ);
  return r;
}

// --- snow: falling flakes + a white cover ------------------------------------------------------------
function snowfall() {
  const N = 9000, pos = new Float32Array(N * 3), speed = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 30; pos[i * 3 + 1] = Math.random() * 14; pos[i * 3 + 2] = 1.5 - Math.random() * 34; speed[i] = 0.6 + Math.random() * 0.8; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const dot = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: dot, size: 0.07, transparent: true, depthWrite: false, color: '#ffffff' }));
  pts.material.userData.outlineParameters = { visible: false };
  pts.frustumCulled = false;
  pts.userData.tick = (t, dt) => {
    for (let i = 0; i < N; i++) {
      pos[i * 3 + 1] -= speed[i] * dt;
      pos[i * 3] += Math.sin(t * 0.8 + i) * 0.15 * dt;
      if (pos[i * 3 + 1] < 0) pos[i * 3 + 1] += 14;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return pts;
}

// --------------------------------------------------------------------------------------------------------
export function createWeather({ renderer, scene, crossing, post, ambient, key }) {
  let hasAssets = null, current = 'anime', reflector = null, snow = null, U = 1;
  const snowCover = (() => { const set = pbrSet('snow_02', [90, 90]); return set; });
  let snowTex = null;
  // grass/plants are buried under snow; the old card grass only shows if the blade grass never loaded
  const showPlants = (on) => {
    if (REFS.grass) { REFS.grass.visible = on; if (REFS.plants) REFS.plants.visible = on; REFS.tufts.visible = false; }
    else REFS.tufts.visible = on;
  };
  const restoreDry = () => {
    for (const m of [REFS.road.material, REFS.ground.material, REFS.ballast.material, ...REFS.roofs, ...REFS.leaves]) {
      const d = m.userData.dry; if (!d) continue;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'roughness']) if (k in d) m[k] = d[k]; // only what was saved: sprites keep their map
      m.color.copy(d.color); m.needsUpdate = true;
    }
  };
  return {
    list: () => Object.entries(WEATHERS).map(([k, v]) => [k, v.label]),
    get current() { return current; },
    tick(t, dt) { snow?.visible && snow.userData.tick(t, dt); if (reflector?.visible) reflector.material.uniforms.uTime.value = t; },
    async set(name, unitsPerMeter) {
      U = unitsPerMeter ?? U;
      hasAssets ??= await fetch(`${PH}hdri/day.hdr`, { method: 'HEAD' }).then((r) => r.ok, () => false);
      if (hasAssets && !REFS.road.material.userData.dry) applyTextures();
      const w = WEATHERS[name]?.hdri && hasAssets ? WEATHERS[name] : WEATHERS.anime;
      current = w === WEATHERS.anime ? 'anime' : name;
      restoreDry();
      if (!w.hdri) { // stylised sky from Crossing.fit
        crossing.fit(scene, U, { force: true });
        renderer.toneMappingExposure = 1; post.grade(null); post.bloom.strength = 0.35; post.bloom.threshold = 1.15;
        ambient.color.set('#aaaaaa'); ambient.intensity = 1.1; key.color.set('#ffffff'); key.intensity = 0.6;
        crossing.flareHolder.visible = true; crossing.redPower = 0;
        for (const m of REFS.vending) m.emissiveIntensity = 0.55;
        for (const m of REFS.windows) m.emissiveIntensity = 0;
        if (REFS.neonHaze) REFS.neonHaze.visible = false;
        for (const m of REFS.neonSigns) m.emissiveIntensity = 0;
        for (const n of REFS.nightLights) { n.light.intensity = 0; if (n.mat) n.mat.emissiveIntensity = 0; }
        if (reflector) reflector.visible = false; REFS.road.visible = true; if (snow) snow.visible = false; showPlants(true);
        return current;
      }
      const sky = await loadSky(renderer, w.hdri, w.skySat, w.skyTame);
      // rotate the photo so its sun sits at the preset's azimuth; the light uses the same direction
      const az0 = Math.atan2(sky.sun.x, sky.sun.z), a = deg(w.az) - az0;
      scene.background = sky.tex; scene.environment = sky.env;
      scene.backgroundRotation.set(0, a, 0); scene.environmentRotation.set(0, a, 0);
      scene.backgroundIntensity = w.bg; scene.environmentIntensity = w.env;
      const dir = sky.sun.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      const minElev = deg(w.minElev ?? 4);
      if (Math.asin(dir.y) < minElev) { const hor = Math.hypot(dir.x, dir.z); dir.set((dir.x / hor) * Math.cos(minElev), Math.sin(minElev), (dir.z / hor) * Math.cos(minElev)); }
      const sun = crossing.sun;
      sun.color.set(w.sun[0]); sun.intensity = w.sun[1];
      sun.position.copy(dir).multiplyScalar(60).add(sun.target.position);
      crossing.flareHolder.position.copy(dir).multiplyScalar(300);
      crossing.flareHolder.visible = !!w.flare || name === 'day';
      scene.fog = new THREE.Fog(w.fog[0], w.fog[1] * U, w.fog[2] * U);
      renderer.toneMappingExposure = w.exposure;
      ambient.color.set(w.char.amb[0]); ambient.intensity = w.char.amb[1];
      key.color.set(w.char.key[0]); key.intensity = w.char.key[1];
      key.position.copy(dir.x > 0 ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(-1, 1, 1)); // always from the viewer's side
      post.grade(w.grade); post.bloom.strength = w.bloom; post.bloom.threshold = w.bloomThreshold ?? 1.15;

      // wet road
      if (w.wet) { if (!reflector) { reflector = wetRoad(); REFS.road.parent.add(reflector); } reflector.visible = true; REFS.road.visible = false; for (const m of REFS.leaves) m.color.multiplyScalar(0.85); REFS.ballast.material.color.multiplyScalar(0.7); }
      else { if (reflector) reflector.visible = false; REFS.road.visible = true; }
      // snow cover + flakes
      if (w.snow) {
        snowTex ??= snowCover();
        Object.assign(REFS.ground.material, snowTex, { roughness: 1 }); REFS.ground.material.color.set('#ffffff'); REFS.ground.material.needsUpdate = true;
        for (const m of REFS.roofs) { Object.assign(m, snowTex); m.color.set('#f4f7fb'); m.needsUpdate = true; }
        for (const m of REFS.leaves) m.color.lerp(new THREE.Color('#eef3f7'), 0.55);
        REFS.road.material.color.set('#eceff2'); REFS.ballast.material.color.lerp(new THREE.Color('#ffffff'), 0.6);
        showPlants(false);
        if (!snow) { snow = snowfall(); REFS.road.parent.add(snow); }
        snow.material.size = 0.14 * U; snow.visible = true;
      } else { showPlants(true); if (snow) snow.visible = false; }
      // night lights
      const night = !!w.night;
      for (const n of REFS.nightLights) {
        n.light.distance = (n.light.userData.d ??= n.light.distance) * U;
        n.light.intensity = night ? n.power * U ** n.light.decay : 0;
        if (n.mat) n.mat.emissiveIntensity = night ? 4 : 0;
      }
      for (const r of REFS.redLights) r.distance = (r.userData.d ??= r.distance) * U;
      crossing.redPower = (night ? 40 : name === 'rain' || name === 'sunset' ? 12 : 0) * U ** 1.6;
      for (const m of REFS.windows) { m.emissiveIntensity = night ? 1.6 : name === 'sunset' ? 0.25 : 0; m.emissive.set(w.neon ? m.userData.neon : '#ffcf8a'); }
      for (const m of REFS.vending) m.emissiveIntensity = w.neon ? 1.0 : night ? 0.6 : w === WEATHERS.sunset ? 0.7 : 0.55;
      if (REFS.neonHaze) REFS.neonHaze.visible = !!w.neon;
      for (const m of REFS.neonSigns) m.emissiveIntensity = w.neon ? 2.2 : night ? 1.2 : 0;
      return current;
    },
  };
}
