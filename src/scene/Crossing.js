// A sunny Japanese railway crossing (踏切) behind the character, Blue Archive style: PBR background
// lit by the sky (IBL) and a shadow-casting sun, toon character on top. Built in meters; the caller
// scales the group to model units via fit(). Character stands at the origin facing +Z (toward the
// viewer); everything lives at z <= 0.5. A train passes periodically: lamps flash, bell rings,
// barriers come down.
import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { createSea } from './Sea.js';

const ROAD_LEN = 17.6;
// The hill: flat where she stands, then the road drops HILL_DROP m to the crossing (a cosine ramp between
// HILL_TOP and HILL_FOOT). Everything from the crossing to the sea sits at the foot, so from her eye line the
// sea shows over the sea wall like it does looking down the real Kamakura-Kokomae slope.
const HILL_TOP = -1.2, HILL_FOOT = -7.2, HILL_DROP = 1.0;
export function groundY(z) {
  if (z >= HILL_TOP) return 0;
  if (z <= HILL_FOOT) return -HILL_DROP;
  const t = (HILL_TOP - z) / (HILL_TOP - HILL_FOOT);
  return -HILL_DROP * (0.5 - 0.5 * Math.cos(Math.PI * t));
}
// bake a ground-hugging mesh into group space and bend it over the hill (needs segments along z)
function drape(mesh) {
  mesh.updateMatrix(); mesh.geometry.applyMatrix4(mesh.matrix);
  mesh.position.set(0, 0, 0); mesh.rotation.set(0, 0, 0); mesh.scale.set(1, 1, 1);
  const p = mesh.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + groundY(p.getZ(i)));
  mesh.geometry.computeVertexNormals(); mesh.userData.draped = true;
  return mesh;
}
// after the scene is built: props sit at groundY(their z); lines and instances bend per point/instance
function settle(g) {
  const m = new THREE.Matrix4(), v = new THREE.Vector3();
  const visit = (o) => {
    if (o.userData.draped) return;
    if (o.userData.settleChildren) { o.children.forEach(visit); return; }
    if (o.isLine) {
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + groundY(p.getZ(i) + o.position.z));
      return;
    }
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); v.setFromMatrixPosition(m); m.setPosition(v.x, v.y + groundY(v.z + o.position.z), v.z); o.setMatrixAt(i, m); }
      o.instanceMatrix.needsUpdate = true;
      return;
    }
    o.position.y += groundY(o.position.z);
  };
  g.children.forEach(visit);
}
const TRACK_Z = -11, CYCLE = 42, TRAIN_SPEED = 17; // m, s, m/s
const SUN_DIR = new THREE.Vector3(-0.45, 0.62, 0.64).normalize(); // high, front-left: lights the face

// Handles the weather system restyles (filled while building)
export const REFS = { walls: [], roofs: [], leaves: [], windows: [], nightLights: [], redLights: [], lowTrees: [], emitters: [], vending: [], neonSigns: [], neonHaze: null, roadSpan: null, sea: null, sand: null, walkable: [] };
// emitters: things that glow onto the character in real time (GI.js). { obj, color, power() 0..1, range in m,
// facing?: emits only out of obj's +z (a lit panel) }
const mats = new Map();
function pbr(color, o = {}) {
  const key = color + JSON.stringify(o, (k, v) => (v?.isTexture ? v.uuid : v));
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o }));
  return mats.get(key);
}
// OutlineEffect reads the flag from the material, not the object
const noOutline = (m) => { for (const mat of [].concat(m.material ?? [])) mat.userData.outlineParameters = { visible: false }; return m; };
const shadows = (o, cast = true, recv = true) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = recv; } }); return o; };

// mean colour of a canvas region, as a linear THREE.Color
function avgColor(canvas, x, y, w, h) {
  const d = canvas.getContext('2d').getImageData(x, y, w, h).data;
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
  const n = (d.length / 4) * 255;
  return new THREE.Color().setRGB(r / n, g / n, b / n, THREE.SRGBColorSpace);
}
function canvasTex(w, h, draw, repeat, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const speckle = (base, spread, n, size = 1.5) => (x, w, h) => {
  x.fillStyle = base; x.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) { const v = spread[0] + Math.random() * spread[1]; x.fillStyle = `rgb(${v},${v + 2},${v + 6})`; x.fillRect(Math.random() * w, Math.random() * h, size, size); }
};
const stripeTex = (n, horizontal, a = '#1d1f23', b = '#ffcf1a') => canvasTex(horizontal ? 512 : 32, horizontal ? 16 : 256, (c, w, h) => {
  for (let i = 0; i < n; i++) { c.fillStyle = i % 2 ? a : b; horizontal ? c.fillRect((i * w) / n, 0, w / n, h) : c.fillRect(0, (i * h) / n, w, h / n); }
});

function box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }
function cyl(r, h, mat, x = 0, y = 0, z = 0, seg = 16, r2 = r) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r2, h, seg), mat); m.position.set(x, y, z); return m; }

// --- sky -------------------------------------------------------------------------------------------
const SKY_TOP = new THREE.Color('#1673ff'), SKY_MID = new THREE.Color('#4fb2ff'), SKY_HOR = new THREE.Color('#dff5ff');
function skyDome(radius) {
  const geo = new THREE.SphereGeometry(radius, 48, 24);
  const p = geo.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / radius;
    const c = y > 0.22 ? SKY_MID.clone().lerp(SKY_TOP, Math.min(1, (y - 0.22) / 0.6)) : SKY_HOR.clone().lerp(SKY_MID, Math.max(0, y / 0.22));
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const dome = noOutline(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  dome.renderOrder = -2;
  return dome;
}
let cloudTex;
function cloudTexture() {
  return cloudTex ??= canvasTex(512, 300, (x, w, h) => {
    const puffs = [[130, 200, 100], [230, 150, 125], [345, 185, 100], [180, 225, 80], [300, 230, 85], [410, 225, 70], [80, 235, 60], [270, 110, 80]];
    for (const [cx, cy, r] of puffs) {
      const gr = x.createRadialGradient(cx - r * 0.2, cy - r * 0.35, r * 0.1, cx, cy, r);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.72, 'rgba(250,252,255,0.97)'); gr.addColorStop(1, 'rgba(225,238,255,0)');
      x.fillStyle = gr; x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    }
    x.globalCompositeOperation = 'source-atop';
    const sh = x.createLinearGradient(0, 170, 0, 300);
    sh.addColorStop(0, 'rgba(150,185,235,0)'); sh.addColorStop(1, 'rgba(130,165,220,0.6)');
    x.fillStyle = sh; x.fillRect(0, 0, w, h);
  });
}
function clouds(scale = 1) {
  const g = new THREE.Group();
  const spots = [[-150, 70, -300, 130], [40, 100, -320, 170], [175, 62, -285, 120], [-60, 140, -340, 190], [115, 165, -330, 130], [-220, 115, -260, 130], [240, 110, -240, 110], [0, 210, -150, 160]];
  for (const [x, y, z, s] of spots) {
    const sp = noOutline(new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTexture(), fog: false, depthWrite: false, transparent: true })));
    sp.position.set(x * scale, y * scale, z * scale);
    sp.scale.set(s * scale, s * 0.6 * scale, 1);
    g.add(sp);
  }
  return g;
}
// The sky lives outside the main scene: rendered once into a cube map for the background (no depth,
// so AO and far-plane clipping never touch it) and into a PMREM env map for image-based lighting
// (sky ambient above, ground bounce below, reflections for metal and glass).
function skyScene(withGround) {
  const s = new THREE.Scene();
  s.add(skyDome(100), clouds(0.3));
  if (withGround) {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 32), new THREE.MeshBasicMaterial({ color: '#7fae62' }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -2;
    s.add(ground);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 13, 11) }));
    sun.position.copy(SUN_DIR).multiplyScalar(90);
    s.add(sun);
  }
  return s;
}
export function bakeEnvironment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(skyScene(true), 0.02, 0.1, 400);
  pm.dispose();
  return rt.texture;
}
export function bakeSky(renderer) {
  const rt = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType });
  const cam = new THREE.CubeCamera(0.1, 400, rt);
  const prev = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
  cam.update(renderer, skyScene(false));
  renderer.toneMapping = prev;
  return rt.texture;
}

// --- ground, road, rails ---------------------------------------------------------------------------
function ground(g) {
  const grassTex = canvasTex(256, 256, speckle('#86c068', [100, 60], 3500, 2), [120, 120]);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 250, 1, 250), pbr('#9ad276', { map: grassTex, roughness: 0.95 }));
  grass.rotation.x = -Math.PI / 2; grass.position.set(0, -0.01, -26 + 125); grass.receiveShadow = true; // ends at the sea wall
  g.add(REFS.ground = drape(grass)); REFS.walkable.push(grass);
  const asphalt = canvasTex(512, 512, speckle('#5f6166', [78, 48], 9000, 1.6), [3, 6]);
  const rough = canvasTex(256, 256, speckle('#d0d0d0', [150, 105], 4000, 2), [3, 6], false);
  // runs down from the viewer, over the tracks, and ends at Route 134 (z -17.1)
  const road = new THREE.Mesh(new THREE.PlaneGeometry(6, ROAD_LEN, 1, 88), pbr('#ffffff', { map: asphalt, roughnessMap: rough, roughness: 0.85 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.002, 0.5 - ROAD_LEN / 2); road.receiveShadow = true;
  REFS.roadSpan = { width: 6, length: ROAD_LEN, z: 0.5 - ROAD_LEN / 2 };
  REFS.road = drape(road); REFS.walkable.push(road);
  g.add(road);
  const paint = pbr('#d6d8d4', { roughness: 0.75 }); // worn road paint, not pure white: full sun pushed it past the bloom threshold
  for (const sx of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.012, ROAD_LEN, 1, 1, 88), paint); l.position.set(sx * 2.75, 0.008, 0.5 - ROAD_LEN / 2); g.add(shadows(drape(l), false)); }
  { const l = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.012, 0.35, 1, 1, 2), paint); l.position.set(0, 0.012, -6.6); g.add(shadows(drape(l), false)); }
  const tomare = canvasTex(512, 256, (x, w, h) => {
    x.fillStyle = '#d6d8d4'; x.font = 'bold 200px "Yu Gothic","Meiryo",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.save(); x.translate(w / 2, h / 2); x.scale(1, 1.25); x.fillText('止まれ', 0, 0); x.restore();
  });
  const t = noOutline(new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.6, 1, 13), new THREE.MeshStandardMaterial({ map: tomare, transparent: true, depthWrite: false, roughness: 0.75 })));
  t.rotation.x = -Math.PI / 2; t.position.set(0, 0.016, -4.3); t.receiveShadow = true;
  g.add(drape(t));
  // manhole
  const mh = canvasTex(256, 256, (x, w) => {
    x.fillStyle = '#4b4f55'; x.beginPath(); x.arc(w / 2, w / 2, w / 2 - 2, 0, 7); x.fill();
    x.strokeStyle = '#6d727a'; x.lineWidth = 6;
    for (let r = 20; r < w / 2; r += 22) { x.beginPath(); x.arc(w / 2, w / 2, r, 0, 7); x.stroke(); }
    for (let a = 0; a < 12; a++) { x.beginPath(); x.moveTo(w / 2, w / 2); x.lineTo(w / 2 + Math.cos(a) * w / 2, w / 2 + Math.sin(a) * w / 2); x.stroke(); }
  });
  const m = noOutline(new THREE.Mesh(new THREE.CircleGeometry(0.32, 32), pbr('#ffffff', { map: mh, roughness: 0.45, metalness: 0.6, transparent: true })));
  m.rotation.x = -Math.PI / 2; m.position.set(-1.1, 0.012, -1.6); m.receiveShadow = true;
  g.add(m);
  // grass clumps along the verges: three crossed blade cards each, alpha-tested
  const blade = canvasTex(128, 128, (c, w, h) => {
    for (let i = 0; i < 28; i++) {
      const x0 = 10 + Math.random() * 108, lean = (Math.random() - 0.5) * 40, ht = 50 + Math.random() * 75;
      const gr = c.createLinearGradient(0, h, 0, h - ht); gr.addColorStop(0, '#4c8f3a'); gr.addColorStop(1, '#a8dc78');
      c.fillStyle = gr; c.beginPath(); c.moveTo(x0 - 4, h); c.quadraticCurveTo(x0 + lean * 0.4, h - ht * 0.6, x0 + lean, h - ht); c.quadraticCurveTo(x0 + lean * 0.4 + 2, h - ht * 0.6, x0 + 4, h); c.fill();
    }
  });
  const card = new THREE.PlaneGeometry(0.7, 0.45); card.translate(0, 0.225, 0);
  const cards = [0, 1, 2].map((k) => card.clone().rotateY((k * Math.PI) / 3));
  const clump = new THREE.BufferGeometry().copy(cards[0]);
  { const merged = cards.map((c) => c.toNonIndexed()); const pos = [], uv = [], nor = [];
    for (const m of merged) { pos.push(...m.attributes.position.array); uv.push(...m.attributes.uv.array); nor.push(...m.attributes.normal.array); }
    clump.setIndex(null); clump.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); clump.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); clump.setAttribute('normal', new THREE.Float32BufferAttribute(nor.map((v, i) => (i % 3 === 1 ? 1 : 0)), 3)); }
  const grassMat = noOutline(new THREE.Mesh(clump, new THREE.MeshStandardMaterial({ map: blade, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 }))).material;
  const tuft = new THREE.InstancedMesh(clump, grassMat, 1400);
  tuft.userData.outlineParameters = { visible: false };
  const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (let i = 0; i < 1400; i++) {
    const side = i % 2 ? 1 : -1, x = side * (3.05 + Math.random() * 6), z = 0.4 - Math.random() * 8.5; // viewer's side of the tracks
    if (Math.abs(z - TRACK_Z) < 2.3) { i--; continue; }
    q.setFromEuler(new THREE.Euler(0, Math.random() * 6.28, 0));
    s.setScalar(0.6 + Math.random() * 0.8);
    tuft.setMatrixAt(i, mx.compose(new THREE.Vector3(x, 0, z), q, s));
  }
  tuft.receiveShadow = true;
  g.add(REFS.tufts = tuft);
}

function railway(g) {
  const z0 = TRACK_Z;
  const ballast = canvasTex(256, 256, speckle('#a29c92', [110, 90], 7000, 3), [80, 1]);
  g.add(REFS.ballast = shadows(box(400, 0.28, 4.2, pbr('#ffffff', { map: ballast, roughness: 1 }), 0, 0.06, z0), false));
  const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.14, 2.4), pbr('#d3cec4', { roughness: 0.9 }), 400);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 400; i++) { m.makeTranslation(-120 + i * 0.6, 0.24, z0); sleepers.setMatrixAt(i, m); }
  sleepers.castShadow = sleepers.receiveShadow = true;
  g.add(sleepers);
  const rail = pbr('#b9c0c8', { metalness: 1, roughness: 0.28 }), railSide = REFS.railSide = pbr('#7a6a5c', { metalness: 0.6, roughness: 0.75 });
  for (const dz of [-0.53, 0.53]) {
    g.add(shadows(box(400, 0.03, 0.07, rail, 0, 0.455, z0 + dz)));       // polished head
    g.add(shadows(box(400, 0.13, 0.045, railSide, 0, 0.375, z0 + dz)));  // rusty web
    g.add(shadows(box(400, 0.03, 0.14, railSide, 0, 0.31, z0 + dz)));
  }
  g.add(shadows(box(6, 0.32, 3.6, pbr('#5d6269', { roughness: 0.8 }), 0, 0.17, z0), false, true));
  for (const dz of [-0.48, 0.48]) g.add(box(6, 0.02, 0.06, pbr('#2a2c30', { roughness: 0.9 }), 0, 0.335, z0 + dz)); // flangeway gaps
  const mast = pbr('#a7b0b8', { metalness: 0.5, roughness: 0.5 });
  for (const x of [-26, 26]) {
    for (const dz of [-2.7, 2.7]) g.add(shadows(cyl(0.13, 6.6, mast, x, 3.3, z0 + dz, 10)));
    g.add(shadows(box(0.16, 0.16, 5.6, mast, x, 6.4, z0)));
  }
  const wire = new THREE.LineBasicMaterial({ color: '#2b2d30' });
  for (const y of [5.6, 6.3]) g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-200, y, z0), new THREE.Vector3(200, y, z0)]), wire));
}

// --- crossing signal + barrier ----------------------------------------------------------------------
function crossingSignal(g, x, z, face, lamps, arms) {
  const s = new THREE.Group();
  s.position.set(x, 0, z); s.rotation.y = face;
  const black = pbr('#1f2125', { roughness: 0.5 }), paintY = pbr('#ffffff', { map: stripeTex(8, false), roughness: 0.45 });
  s.add(cyl(0.075, 3.5, paintY, 0, 1.75, 0));
  s.add(cyl(0.05, 0.25, black, 0, 3.55, 0, 8, 0.08)); // cap
  const buck = canvasTex(256, 40, (c, w, h) => { c.fillStyle = '#1f2125'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffcf1a'; c.fillRect(5, 5, w - 10, h - 10); });
  for (const r of [Math.PI / 4, -Math.PI / 4]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.2, 0.03), pbr('#ffffff', { map: buck, roughness: 0.4 }));
    b.position.set(0, 3.1, 0.09); b.rotation.z = r; s.add(b);
  }
  s.add(box(0.98, 0.4, 0.05, black, 0, 2.38, 0.08));
  for (const dx of [-0.31, 0.31]) {
    const lens = new THREE.MeshStandardMaterial({ color: '#3a0606', emissive: '#ff1e1e', emissiveIntensity: 0, roughness: 0.15 });
    const lamp = noOutline(new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), lens));
    lamp.rotation.x = Math.PI / 2; lamp.scale.y = 0.35; lamp.position.set(dx, 2.38, 0.1);
    s.add(lamp); lamps.push(lens);
    REFS.emitters.push({ obj: lamp, color: new THREE.Color('#ff2a1a'), power: () => lens.emissiveIntensity / 6, range: 22 });
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.17, 20, 1, true, -Math.PI / 2, Math.PI), black);
    hood.rotation.x = Math.PI / 2; hood.position.set(dx, 2.39, 0.18); hood.material.side = THREE.DoubleSide; s.add(hood);
  }
  // ⇔ direction indicator + speaker
  const arrow = canvasTex(128, 48, (c, w, h) => { c.fillStyle = '#111'; c.fillRect(0, 0, w, h); c.fillStyle = '#9ef0ff'; c.font = 'bold 40px sans-serif'; c.textAlign = 'center'; c.fillText('⇔', w / 2, 38); });
  s.add(noOutline(box(0.5, 0.2, 0.05, new THREE.MeshStandardMaterial({ map: arrow, emissive: '#ffffff', emissiveMap: arrow, emissiveIntensity: 0.6 }), 0, 1.98, 0.08)));
  s.add(cyl(0.12, 0.12, black, 0, 3.75, 0.05, 12, 0.06));
  // barrier housing + arm on a pivot (rotation.z animates 0 = down .. 1.45 = up)
  s.add(shadows(box(0.36, 1.0, 0.32, pbr('#eceee8', { roughness: 0.5 }), 0.42, 0.5, 0.25)));
  const pivot = new THREE.Group(); pivot.position.set(0.42, 0.92, 0.45);
  const arm = shadows(box(3.4, 0.09, 0.09, pbr('#ffffff', { map: stripeTex(16, true), roughness: 0.4 }), 1.75, 0, 0));
  pivot.add(arm, shadows(box(0.5, 0.18, 0.18, black, -0.25, 0, 0))); // counterweight
  s.add(pivot); arms.push(pivot);
  g.add(shadows(s));
}

// --- street furniture --------------------------------------------------------------------------------
function utilityPoles(g) {
  const pole = pbr('#c3beb3', { roughness: 0.85 }), arm = pbr('#8e8a82', { metalness: 0.4, roughness: 0.6 }), ins = pbr('#f5f5f0', { roughness: 0.2 });
  const plate = canvasTex(64, 200, (c, w, h) => { c.fillStyle = '#1b4fa8'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 36px "Yu Gothic",sans-serif'; c.textAlign = 'center'; ['桜', '町', '二', '丁', '目'].forEach((ch, i) => c.fillText(ch, w / 2, 40 + i * 38)); });
  // two down the hill road, then a line along Route 134's inland kerb
  const poles = [[-4.2, -2], [-4.2, -16], [-34, -16], [-64, -16], [26, -16], [56, -16]];
  for (const [x, z] of poles) {
    g.add(shadows(cyl(0.16, 10, pole, x, 5, z, 12, 0.19)));
    // cross-arms square to the line the pole carries; the corner pole carries both
    const dirs = z !== -16 ? ['x'] : x === -4.2 ? ['x', 'z'] : ['z'];
    for (const y of [9.2, 8.4]) for (const d of dirs) {
      g.add(shadows(d === 'x' ? box(1.8, 0.1, 0.1, arm, x, y, z) : box(0.1, 0.1, 1.8, arm, x, y, z)));
      for (const o of [-0.75, 0, 0.75]) g.add(cyl(0.05, 0.14, ins, x + (d === 'x' ? o : 0), y + 0.12, z + (d === 'z' ? o : 0), 8));
    }
    g.add(shadows(cyl(0.24, 0.65, pbr('#7b8086', { metalness: 0.5, roughness: 0.5 }), x + 0.38, 7.4, z, 14)));
    const p = noOutline(new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.7), pbr('#ffffff', { map: plate, roughness: 0.4 })));
    p.position.set(x + 0.2, 2.4, z); p.rotation.y = Math.PI / 2; g.add(p);
  }
  const wire = new THREE.LineBasicMaterial({ color: '#2b2d30' });
  const sag = (a, b) => g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -0.9, 0)), b).getPoints(20)), wire));
  const pairs = [[0, 1], [2, 1], [3, 2], [1, 4], [4, 5]]; // hill road, then along Route 134 both ways
  for (const [i, j] of pairs) for (const [d, y] of [[-0.75, 9.32], [0, 9.32], [0.75, 9.32], [-0.75, 8.52], [0.75, 8.52]]) {
    const [ax, az] = poles[i], [bx, bz] = poles[j], along = az === bz;
    sag(new THREE.Vector3(ax + (along ? 0 : d), y, az + (along ? d : 0)), new THREE.Vector3(bx + (along ? 0 : d), y, bz + (along ? d : 0)));
  }
}

// Japanese drink machine: lit sample showcase behind glass (only the showcase glows), price tags and
// push-button LEDs, then an unlit door with coin/bill slots, a tiny LCD and the take-out pocket.
// style: door colour, showcase backlight tint, brand on the door.
const VM_STYLES = {
  cool: { door: '#1e5bb8', glow: '#d8ecff', brand: 'COOL DRINK' },
  sakura: { door: '#e0217f', glow: '#ff3fc0', brand: 'SAKURA' },
  aqua: { door: '#0096ad', glow: '#2fe0ff', brand: 'AQUA' },
  night: { door: '#6b33c9', glow: '#9a5cff', brand: 'MIDNIGHT' },
  matcha: { door: '#4e9c1a', glow: '#9dff3f', brand: 'MATCHA' },
};
function vendingMachine(g, x, z, rotY, style, { bins = true } = {}) {
  const drinks = [ // [label, cap/lid, bottle?]
    ['#e53935', '#c9ccd0'], ['#2e7d32', '#ffffff', 1], ['#f9a825', '#c9ccd0'], ['#1565c0', '#1565c0', 1], ['#6d4c41', '#c9ccd0'],
    ['#ffffff', '#43a047', 1], ['#212121', '#c9ccd0'], ['#00838f', '#ffffff', 1], ['#fb8c00', '#c9ccd0'], ['#8e24aa', '#c9ccd0'],
  ];
  // e = emissive pass: the backlight glows, product fronts only catch a little of it
  const showcase = (e) => (c, w, h) => {
    c.fillStyle = e ? '#d8e6f2' : '#eef4f8'; c.fillRect(0, 0, w, h);
    const rows = 3, cols = 8, rowH = h / rows;
    for (let r = 0; r < rows; r++) {
      const y0 = r * rowH, hot = r === rows - 1;
      // light falls off away from the tube at the top of each shelf
      const gr = c.createLinearGradient(0, y0, 0, y0 + rowH);
      gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(140,160,180,0.4)');
      c.fillStyle = gr; c.fillRect(0, y0, w, rowH);
      for (let i = 0; i < cols; i++) {
        const [lab, lid, bottle] = drinks[(r * 3 + i * 7) % drinks.length], cx = (i + 0.5) * (w / cols), base = y0 + rowH * 0.68;
        const bw = bottle ? 30 : 38, bh = bottle ? 112 : 84, top = base - bh;
        if (bottle) { // PET: clear neck, cap, label band
          c.fillStyle = '#cfe3ee'; c.fillRect(cx - bw / 2, top + 22, bw, bh - 22); c.fillRect(cx - 7, top + 6, 14, 18);
          c.fillStyle = lid; c.fillRect(cx - 8, top, 16, 9);
          c.fillStyle = lab; c.fillRect(cx - bw / 2, top + 48, bw, 40);
        } else { // can: silver lid, full-wrap print
          c.fillStyle = lab; c.fillRect(cx - bw / 2, top + 8, bw, bh - 8);
          c.fillStyle = lid; c.fillRect(cx - bw / 2 + 2, top, bw - 4, 9);
          c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillRect(cx - bw / 2 + 6, top + 26, bw - 12, 14);
        }
        c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(cx - bw / 2 + 4, top + 10, 4, bh - 14); // cylinder highlight
        if (e) { // backlight through the samples: cans block it, PET bottles pass it tinted by their label
          if (bottle) { c.globalAlpha = 0.75; c.fillStyle = lab; c.fillRect(cx - bw / 2, top + 22, bw, bh - 22); c.globalAlpha = 1; }
          else { c.fillStyle = 'rgba(0,0,0,0.85)'; c.fillRect(cx - bw / 2, top, bw, bh); }
        }
        // price tag + push button (blue = cold, red = hot, a couple sold out)
        const ty = base + 10, sold = (r * 5 + i) % 11 === 3;
        c.fillStyle = e ? '#000' : '#ffffff'; c.fillRect(cx - 24, ty, 48, 20);
        c.fillStyle = e ? '#000' : '#222'; c.font = 'bold 17px sans-serif'; c.textAlign = 'center'; c.fillText(bottle ? '160' : '130', cx, ty + 17);
        c.fillStyle = sold ? '#ff2a2a' : hot ? '#ff4a2a' : '#2a90ff';
        c.fillRect(cx - 18, ty + 26, 36, 10);
        if (sold) { c.font = 'bold 12px sans-serif'; c.fillText('売切', cx, ty + 52); }
      }
      c.fillStyle = e ? '#000' : '#5b6670'; c.fillRect(0, y0 + rowH - 6, w, 6); // shelf lip
      if (r === 0 || hot) {
        c.fillStyle = e ? '#000' : hot ? '#d32f2f' : '#1565c0'; c.fillRect(0, y0, 96, 20);
        c.fillStyle = e ? '#000' : '#fff'; c.font = 'bold 14px sans-serif'; c.textAlign = 'left'; c.fillText(hot ? 'あたたか〜い' : 'つめた〜い', 5, y0 + 15);
      }
    }
  };
  const SW = 512, SH = 600, caseMap = canvasTex(SW, SH, showcase(false)), caseGlow = canvasTex(SW, SH, showcase(true));
  // door face: coloured upper frame, white lower door with slots; only the LCD glows
  const doorDraw = (e) => (c, w, h) => {
    c.fillStyle = e ? '#000' : style.door; c.fillRect(0, 0, w, h);
    if (!e) {
      c.fillStyle = '#f4f7fa'; c.fillRect(0, h * 0.6, w, h * 0.4);
      c.fillStyle = style.door; c.fillRect(0, h * 0.6, w, 8);
      c.font = 'italic bold 22px sans-serif'; c.textAlign = 'center'; c.fillText(style.brand, w * 0.34, h * 0.68);
      c.fillStyle = '#9aa3ab'; c.fillRect(w * 0.74, h * 0.635, 40, 60); // coin plate
      c.fillStyle = '#20252a'; c.fillRect(w * 0.74 + 17, h * 0.635 + 8, 6, 20); c.fillRect(w * 0.74 + 8, h * 0.635 + 38, 24, 12);
      c.fillStyle = '#2b3036'; c.fillRect(w * 0.74, h * 0.715, 40, 24); // bill acceptor
      c.fillStyle = '#9aa3ab'; c.fillRect(w * 0.74 + 4, h * 0.715 + 10, 32, 4);
      c.fillStyle = '#5c6670'; c.font = '12px sans-serif'; c.fillText('10 50 100 500 1000', w * 0.34, h * 0.72);
    }
    c.fillStyle = e ? '#3cff7a' : '#0c1a10'; c.fillRect(w * 0.74, h * 0.612, 40, 13); // LCD above the coin slot
    if (e) { c.fillStyle = '#000'; c.font = 'bold 12px monospace'; c.textAlign = 'center'; c.fillText('0', w * 0.74 + 33, h * 0.612 + 11); }
  };
  const doorMap = canvasTex(256, 456, doorDraw(false)), doorGlow = canvasTex(256, 456, doorDraw(true));

  const vm = new THREE.Group(); vm.position.set(x, 0, z); vm.rotation.y = rotY;
  const body = pbr('#e9edf0', { roughness: 0.35, metalness: 0.2 });
  vm.add(shadows(box(1.05, 1.83, 0.72, body, 0, 0.915, -0.02)));
  const door = new THREE.MeshStandardMaterial({ map: doorMap, emissive: '#ffffff', emissiveMap: doorGlow, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.1 });
  vm.add(box(1.0, 1.78, 0.04, [body, body, body, body, door, body], 0, 0.92, 0.36));
  // showcase: lit samples, framed and set back behind glass
  const sh = 0.86 * SH / SW, cy = 1.32;
  const caseMat = new THREE.MeshStandardMaterial({ map: caseMap, emissive: style.glow, emissiveMap: caseGlow, emissiveIntensity: 0.55, roughness: 0.7 });
  const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.86, sh), caseMat);
  sc.position.set(0, cy, 0.385); vm.add(sc); REFS.vending.push(caseMat);
  // one emitter per shelf, facing out of the glass, coloured by what that shelf's samples let through
  const tint = new THREE.Color(style.glow);
  for (let r = 0; r < 3; r++) {
    const a = new THREE.Object3D(); a.position.set(0, sh / 2 - (r + 0.5) * sh / 3, 0.01); sc.add(a);
    REFS.emitters.push({ obj: a, facing: true, color: avgColor(caseGlow.image, 0, (r * SH) / 3, SW, SH / 3).multiply(tint), power: () => caseMat.emissiveIntensity * 1.2, range: 5 });
  }
  const frame = pbr('#c3cad1', { roughness: 0.3, metalness: 0.6 });
  for (const [w, h, fx, fy] of [[0.94, 0.04, 0, cy + sh / 2 + 0.02], [0.94, 0.04, 0, cy - sh / 2 - 0.02], [0.04, sh, -0.45, cy], [0.04, sh, 0.45, cy]]) vm.add(box(w, h, 0.05, frame, fx, fy, 0.405));
  const glass = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.08, roughness: 0.02, metalness: 1, depthWrite: false });
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.86, sh), glass); gl.position.set(0, cy, 0.425); vm.add(gl);
  // take-out pocket with smoked flap, change cup
  vm.add(box(0.62, 0.2, 0.06, pbr('#15181b', { roughness: 0.6 }), -0.08, 0.26, 0.37));
  vm.add(box(0.6, 0.17, 0.01, new THREE.MeshStandardMaterial({ color: '#2a2f35', transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0.3 }), -0.08, 0.27, 0.405));
  vm.add(box(0.12, 0.08, 0.04, pbr('#9aa3ab', { metalness: 0.7, roughness: 0.3 }), 0.36, 0.2, 0.39));
  vm.add(shadows(box(1.08, 0.1, 0.78, pbr('#d6dade', { roughness: 0.4 }), 0, 1.88, -0.02))); // top cap
  vm.add(shadows(box(1.0, 0.06, 0.66, pbr('#3a3f45', { roughness: 0.8 }), 0, 0.03, 0))); // plinth
  // recycle boxes: cans / PET
  if (bins) for (const [bx, col, lab] of [[0.72, '#2c7be5', 'あきかん'], [1.05, '#2e9e5b', 'ペットボトル']]) {
    const t = canvasTex(128, 128, (c, w) => { c.fillStyle = col; c.fillRect(0, 0, w, w); c.fillStyle = '#111'; c.beginPath(); c.arc(w / 2, 34, 18, 0, 7); c.fill(); c.fillStyle = '#fff'; c.font = `bold ${lab.length > 4 ? 14 : 22}px sans-serif`; c.textAlign = 'center'; c.fillText(lab, w / 2, 96); });
    const side = pbr(col, { roughness: 0.35 });
    vm.add(shadows(box(0.3, 0.72, 0.3, [side, side, side, side, pbr('#ffffff', { map: t, roughness: 0.35 }), side], bx, 0.36, 0.15)));
  }
  g.add(vm);
}

// A row of colourful machines on the left verge behind her: the neon night's light source. Their glow reaches
// her as rim/fill (REFS.emitters); one shared point light tints the road, and soft additive sprites fake the
// coloured haze rising off the ground (shown only by the neon preset).
function vendingCorner(g) {
  const styles = [VM_STYLES.sakura, VM_STYLES.aqua, VM_STYLES.night, VM_STYLES.matcha];
  styles.forEach((st, i) => vendingMachine(g, -4.35, -1.6 - i * 1.12, Math.PI / 2 - 0.12, st, { bins: false }));
  const spill = new THREE.PointLight('#ff5ad6', 0, 7, 2); spill.position.set(-3.2, 1.2, -3.3); g.add(spill);
  REFS.nightLights.push({ light: spill, power: 2.5 });
  const haze = new THREE.Group(); haze.visible = false;
  const tex = canvasTex(128, 128, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, w); });
  styles.forEach((st, i) => {
    const m = new THREE.SpriteMaterial({ map: tex, color: st.glow, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    m.userData.outlineParameters = { visible: false };
    const sp = new THREE.Sprite(m); sp.position.set(-3.6, 0.5, -1.6 - i * 1.12); sp.scale.set(3.2, 1.6, 1); haze.add(sp);
  });
  haze.userData.settleChildren = true; g.add(haze); REFS.neonHaze = haze;
}

// Snack-bar A-frame on the verge behind her: pink neon script, low to the ground, so in the neon preset it
// rims her from behind and below like the reference key art. Off by day (REFS.neonSigns, driven by Weather).
function neonSign(g, x, z, rotY) {
  const draw = (e) => (c, w, h) => {
    c.fillStyle = e ? '#000' : '#1a1420'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#ff4fd0'; c.lineWidth = 6; c.lineJoin = 'round';
    c.beginPath(); c.roundRect(14, 14, w - 28, h - 28, 22); c.stroke();
    c.fillStyle = '#ff4fd0'; c.textAlign = 'center';
    c.font = 'bold 64px "Yu Gothic",sans-serif'; c.fillText('スナック', w / 2, h * 0.44);
    c.font = 'italic bold 72px sans-serif'; c.fillText('ミク', w / 2, h * 0.8);
    if (!e) { c.globalCompositeOperation = 'source-atop'; c.fillStyle = 'rgba(255,255,255,0.25)'; c.fillRect(0, 0, w, h); }
  };
  const map = canvasTex(256, 320, draw(false)), glow = canvasTex(256, 320, draw(true));
  const face = new THREE.MeshStandardMaterial({ map, emissive: '#ffffff', emissiveMap: glow, emissiveIntensity: 0, roughness: 0.6 });
  REFS.neonSigns.push(face);
  const dark = pbr('#1a1420', { roughness: 0.6 });
  const s = new THREE.Group(); s.position.set(x, 0, z); s.rotation.y = rotY;
  for (const side of [1, -1]) { // two leaning boards
    const b = shadows(box(0.5, 0.75, 0.02, [dark, dark, dark, dark, side > 0 ? face : dark, dark], 0, 0.36, side * 0.1));
    b.rotation.x = -side * 0.14; s.add(b);
  }
  g.add(s);
  REFS.emitters.push({ obj: s, color: new THREE.Color('#ff4fd0'), power: () => face.emissiveIntensity * 0.6, range: 6 });
}

function curveMirror(g, x, z, rotY) {
  const m = new THREE.Group(); m.position.set(x, 0, z); m.rotation.y = rotY;
  const orange = pbr('#ff7a1a', { roughness: 0.35 });
  m.add(shadows(cyl(0.05, 3.1, orange, 0, 1.55, 0)));
  m.add(shadows(new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 10, 40), orange)).translateY(3.25));
  // convex mirror: chrome dome reflecting the env map
  const dome = noOutline(new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2.6), pbr('#ffffff', { metalness: 1, roughness: 0.02 })));
  dome.rotation.x = Math.PI / 2; dome.scale.y = 0.35; dome.position.set(0, 3.25, 0.02);
  m.add(dome);
  m.add(box(0.95, 0.04, 0.1, orange, 0, 2.75, 0));
  g.add(m);
}

// --- the coast past the crossing (Kamakura-Kokomae): Route 134, a sandy-orange pavement, the sea wall, a
// concrete revetment down to the beach, and the open sea to the horizon with Enoshima far off to the right.
// The sea itself lives in Sea.js.
const SEA_Y = -4, WALL_Z = -26.6;
function seaside(g) {
  // Route 134: two lanes along x, white edge lines, dashed centre
  const asphalt = canvasTex(512, 512, speckle('#5c5e63', [76, 48], 9000, 1.6), [120, 1.4]);
  const r134 = new THREE.Mesh(new THREE.PlaneGeometry(600, 7), pbr('#ffffff', { map: asphalt, roughness: 0.85 }));
  r134.rotation.x = -Math.PI / 2; r134.position.set(0, 0.002, -20.6); r134.receiveShadow = true; g.add(r134); REFS.walkable.push(r134);
  const paint = pbr('#d6d8d4', { roughness: 0.75 });
  for (const z of [-17.4, -23.8]) g.add(shadows(box(600, 0.012, 0.15, paint, 0, 0.008, z), false));
  for (let x = -300; x < 300; x += 8) g.add(box(5, 0.012, 0.15, paint, x, 0.008, -20.6));
  // sandy-orange seaside pavement, kerb, sea wall
  const paveTex = canvasTex(256, 256, speckle('#cf9a63', [150, 60], 5000, 2), [150, 1]);
  const pave = shadows(box(600, 0.14, 2.4, pbr('#ffffff', { map: paveTex, roughness: 0.9 }), 0, 0.07, -25.3), false); g.add(pave); REFS.walkable.push(pave);
  g.add(shadows(box(600, 0.16, 0.2, pbr('#c9c6bd', { roughness: 0.8 }), 0, 0.08, -24.1)));
  const concrete = pbr('#b9b5ab', { roughness: 0.85 });
  g.add(shadows(box(600, 0.95, 0.35, concrete, 0, 0.47, WALL_Z)));
  // revetment slope down to the beach, then sand to the waterline
  const slope = new THREE.Mesh(new THREE.PlaneGeometry(600, Math.hypot(4.2, -SEA_Y)), concrete);
  slope.rotation.x = -Math.PI / 2 - Math.atan2(-SEA_Y, 4.2); // far edge down toward the beach slope.position.set(0, SEA_Y / 2, WALL_Z - 0.2 - 2.1); slope.receiveShadow = true; g.add(slope);
  const sandTex = canvasTex(256, 256, speckle('#cdbb94', [150, 70], 6000, 1.5), [200, 4]);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(600, 14), pbr('#ffffff', { map: sandTex, roughness: 1 }));
  sand.rotation.x = -Math.PI / 2 - 0.035; sand.position.set(0, SEA_Y + 0.1, WALL_Z - 4.4 - 7); sand.receiveShadow = true; g.add(sand);
  REFS.sand = sand.material;
  // the sea (Sea.js); its group sits on the waterline where the sand dips under
  const sea = createSea(); sea.group.position.set(0, SEA_Y + 0.15, WALL_Z - 15.4); g.add(sea.group);
  REFS.sea = sea;
  // Enoshima: a low wooded hump with the Sea Candle, hazed by the fog
  const isle = new THREE.Group(); isle.position.set(1100, SEA_Y, -2600);
  const hump = new THREE.Mesh(new THREE.SphereGeometry(180, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), pbr('#3e5a3c', { roughness: 1 }));
  hump.scale.set(1.4, 0.32, 0.8); isle.add(hump);
  isle.add(cyl(4, 40, pbr('#d8dcdf', { roughness: 0.6 }), -30, 75, 0, 10, 7));
  g.add(isle);
}

function streetLamp(g, x, z, rotY) {
  const l = new THREE.Group(); l.position.set(x, 0, z); l.rotation.y = rotY;
  const metal = pbr('#9aa2aa', { metalness: 0.7, roughness: 0.4 });
  l.add(shadows(cyl(0.07, 5.6, metal, 0, 2.8, 0, 10, 0.09)));
  const arm = shadows(cyl(0.04, 1.4, metal, 0.6, 5.55, 0, 8)); arm.rotation.z = Math.PI / 2 - 0.25; l.add(arm);
  l.add(shadows(box(0.55, 0.12, 0.25, pbr('#c9ced3', { metalness: 0.5, roughness: 0.4 }), 1.25, 5.62, 0)));
  const bulbMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffd9a0', emissiveIntensity: 0 });
  const bulb = box(0.45, 0.03, 0.18, bulbMat, 1.25, 5.55, 0); l.add(bulb);
  REFS.emitters.push({ obj: bulb, color: new THREE.Color('#ffcf8a'), power: () => bulbMat.emissiveIntensity / 4, range: 12 });
  const light = new THREE.SpotLight('#ffcf8a', 0, 26, 1.05, 0.55, 1.6);
  light.position.set(1.25, 5.5, 0); light.target.position.set(1.4, 0, 0);
  l.add(light, light.target);
  g.add(l);
  REFS.nightLights.push({ light, mat: bulbMat, power: 60 });
}

// --- train ---------------------------------------------------------------------------------------------
function train(g, glows) {
  const body = canvasTex(1024, 128, (c, w, h) => {
    c.fillStyle = '#f4f7fa'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1e88e5'; c.fillRect(0, 86, w, 14); c.fillStyle = '#4fc3f7'; c.fillRect(0, 100, w, 6);
    for (let i = 0; i < 8; i++) { // windows with sky reflection
      const x = 40 + i * 122, gr = c.createLinearGradient(0, 22, 0, 72);
      gr.addColorStop(0, '#7fb6dd'); gr.addColorStop(1, '#2a4157'); c.fillStyle = gr; c.fillRect(x, 22, 92, 50);
      c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.moveTo(x + 8, 22); c.lineTo(x + 40, 22); c.lineTo(x + 18, 72); c.lineTo(x + 8, 72); c.fill();
    }
    for (const x of [8, 500, 1000]) { c.fillStyle = '#9aa6b2'; c.fillRect(x, 18, 18, 92); } // doors
  });
  const t = new THREE.Group();
  const shell = pbr('#ffffff', { map: body, roughness: 0.25, metalness: 0.35 });
  const under = pbr('#3a3f45', { roughness: 0.7, metalness: 0.4 }), roof = pbr('#b7bec6', { roughness: 0.4, metalness: 0.5 });
  for (let i = 0; i < 3; i++) {
    const car = new THREE.Group(); car.position.x = i * 20.3;
    car.add(box(19.8, 2.6, 2.8, shell, 0, 2.15, 0), box(19.4, 0.5, 2.5, under, 0, 0.7, 0), box(19.6, 0.25, 2.6, roof, 0, 3.55, 0));
    for (const bx of [-6.5, 6.5]) for (const bz of [-0.53, 0.53]) for (const wx of [-0.9, 0.9]) {
      const wh = cyl(0.42, 0.12, under, bx + wx, 0.5, bz, 16); wh.rotation.x = Math.PI / 2; car.add(wh);
    }
    if (i === 1) { const p = box(1.6, 0.06, 0.06, pbr('#30343a'), 0, 4.35, 0); p.rotation.z = 0.5; car.add(p, box(1.2, 0.05, 1.2, pbr('#30343a'), 0, 4.75, 0)); } // pantograph
    t.add(car);
  }
  for (const [x, sx] of [[-10.05, -1], [50.65, 1]]) { // runs toward +X: headlights at +X, tail lights at -X
    const lightMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: sx > 0 ? '#fff6d8' : '#ff2a2a', emissiveIntensity: 3 });
    glows.push(lightMat);
    for (const z of [-0.85, 0.85]) { const l = noOutline(new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), lightMat)); l.position.set(x + sx * 0.01, 1.5, z); l.rotation.y = sx * Math.PI / 2; t.add(l); }
  }
  t.position.set(-1000, 0.47, TRACK_Z);
  g.add(shadows(t));
  return t;
}

// ---------------------------------------------------------------------------------------------------
export function createCrossing(renderer) {
  const g = new THREE.Group(); g.name = 'crossing';
  ground(g); railway(g);
  const lamps = [], arms = [], glows = [];
  crossingSignal(g, -3.5, TRACK_Z + 2.6, 0, lamps, arms);
  crossingSignal(g, 3.5, TRACK_Z - 2.6, Math.PI, lamps, arms);
  utilityPoles(g); seaside(g);
  vendingMachine(g, 4.0, -3.0, -Math.PI / 2 + 0.25, VM_STYLES.cool);
  vendingCorner(g);
  neonSign(g, 2.85, -1.4, -0.45);
  curveMirror(g, 3.6, -7.6, -0.6);
  streetLamp(g, -3.9, -15.5, 0);
  streetLamp(g, 3.9, -0.6, Math.PI);
  { // vending machine spill + red spill from the flashing signals
    const vm = new THREE.PointLight('#d8ecff', 0, 6, 2); vm.position.set(2.7, 1.2, -2.7); g.add(vm); // 1.3 m out from the face: spill on the road, not a hot spot on the machine
    REFS.nightLights.push({ light: vm, power: 1.5 });
    for (const [x, z] of [[-3.5, TRACK_Z + 2.4], [3.5, TRACK_Z - 2.4]]) {
      const r = new THREE.PointLight('#ff2a1a', 0, 9, 1.6); r.position.set(x, 2.4, z); g.add(r); REFS.redLights.push(r);
    }
  }
  const tr = train(g, glows);
  settle(g);
  // Blue Archive look: ink outlines on the character only, never on the background
  g.traverse((o) => { if (o.material) noOutline(o); });

  // sun: shadows over the near scene; the lens flare sells the summer glare
  const sun = new THREE.DirectionalLight('#fff1d6', 3.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
  const target = new THREE.Object3D(); target.position.set(0, 0, -8);
  sun.target = target;
  g.add(sun, target);
  const flareTex = (r, a, inner = 0) => canvasTex(128, 128, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, inner, w / 2, w / 2, w / 2); gr.addColorStop(0, `rgba(255,250,235,${a})`); gr.addColorStop(r, `rgba(255,240,210,${a * 0.4})`); gr.addColorStop(1, 'rgba(255,240,210,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, w); });
  const flare = new Lensflare();
  flare.addElement(new LensflareElement(flareTex(0.25, 0.8), 170, 0));
  flare.addElement(new LensflareElement(flareTex(0.6, 0.35, 30), 90, 0.5, new THREE.Color('#9fd8ff')));
  flare.addElement(new LensflareElement(flareTex(0.6, 0.3, 20), 140, 0.75, new THREE.Color('#ffd2f0')));
  flare.addElement(new LensflareElement(flareTex(0.6, 0.25, 10), 60, 1.0, new THREE.Color('#b8ffcf')));
  const flareHolder = new THREE.Object3D(); flareHolder.add(flare); g.add(flareHolder);

  // カンカン bell, opt-in (browsers block audio until a click)
  let audio = null, lastBeat = -1, bar = 0;
  const bell = (ctx, at) => {
    for (const [f, gain] of [[740, 0.1], [1480, 0.035], [2220, 0.015]]) {
      const o = ctx.createOscillator(), v = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      v.gain.setValueAtTime(gain, at); v.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
      o.connect(v).connect(ctx.destination); o.start(at); o.stop(at + 0.36);
    }
  };

  return {
    group: g, sun, flareHolder, glows, lamps,
    // where she stands, in crossing metres: the sun's shadow box follows her (it only covers ±22 m)
    setFocus(p) {
      const d = new THREE.Vector3(p.x, p.y, p.z - 8).sub(target.position); // both live in the group's metres
      target.position.set(p.x, p.y, p.z - 8); sun.position.add(d);
    },
    // units per meter of the character world, so lights/shadows/fog can be sized in model units
    fit(scene, U) {
      g.scale.setScalar(U); this.scene = scene; REFS.sea?.setScale(U);
      sun.color.set('#fff1d6'); sun.intensity = 3.6;
      sun.position.copy(SUN_DIR).multiplyScalar(60).add(target.position);
      const cam = sun.shadow.camera;
      cam.left = cam.bottom = -22 * U; cam.right = cam.top = 22 * U; cam.near = 1 * U; cam.far = 140 * U;
      cam.updateProjectionMatrix();
      flareHolder.position.copy(SUN_DIR).multiplyScalar(300);
      scene.fog = new THREE.Fog('#d6efff', 40 * U, 330 * U);
      scene.environment = this.styEnv ??= bakeEnvironment(renderer);
      scene.background = this.sky ??= bakeSky(renderer);
      scene.backgroundRotation.set(0, 0, 0); scene.environmentRotation.set(0, 0, 0);
      scene.backgroundIntensity = 1; scene.environmentIntensity = 0.45;
    },
    unfit(scene) { scene.fog = null; scene.environment = null; scene.background = null; },
    setSound(on) {
      if (on && !audio) audio = new AudioContext();
      if (!on && audio) { audio.close(); audio = null; }
    },
    tick(t, dt) {
      // train schedule: enters from the viewer's left every CYCLE s; warning starts ~5 s before it reaches
      // the road and ends once the tail has cleared it
      const ph = t % CYCLE;
      tr.position.x = -300 + ph * TRAIN_SPEED;
      const head = tr.position.x + 50.8, tail = tr.position.x - 10.1;
      const active = head > -5 * TRAIN_SPEED && tail < 8;
      bar += ((active ? 0 : 1.45) - bar) * (1 - Math.exp(-dt * (active ? 2.2 : 1.4)));
      for (const a of arms) a.rotation.z = bar;
      REFS.sea?.tick(t, this.scene?.fog);
      const beat = Math.floor(t * 2.2);
      for (let i = 0; i < lamps.length; i++) lamps[i].emissiveIntensity = active && (beat + i) % 2 ? 6 : 0;
      for (let i = 0; i < REFS.redLights.length; i++) REFS.redLights[i].intensity = active && (beat + i) % 2 ? this.redPower ?? 0 : 0;
      if (audio && active && beat !== lastBeat) bell(audio, audio.currentTime);
      lastBeat = beat;
    },
  };
}
