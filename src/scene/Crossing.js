// A sunny Japanese railway crossing (踏切) behind the character, Blue Archive style: PBR background
// lit by the sky (IBL) and a shadow-casting sun, toon character on top. Built in meters; the caller
// scales the group to model units via fit(). Character stands at the origin facing +Z (toward the
// viewer); everything lives at z <= 0.5. A train passes periodically: lamps flash, bell rings,
// barriers come down.
import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

const TRACK_Z = -11, CYCLE = 42, TRAIN_SPEED = 17; // m, s, m/s
const SUN_DIR = new THREE.Vector3(-0.45, 0.62, 0.64).normalize(); // high, front-left: lights the face

const mats = new Map();
function pbr(color, o = {}) {
  const key = color + JSON.stringify(o, (k, v) => (v?.isTexture ? v.uuid : v));
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o }));
  return mats.get(key);
}
// OutlineEffect reads the flag from the material, not the object
const noOutline = (m) => { for (const mat of [].concat(m.material ?? [])) mat.userData.outlineParameters = { visible: false }; return m; };
const shadows = (o, cast = true, recv = true) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = recv; } }); return o; };

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
  g.add(shadows(box(400, 0.1, 400, pbr('#9ad276', { map: grassTex, roughness: 0.95 }), 0, -0.06, -150), false));
  const asphalt = canvasTex(512, 512, speckle('#5f6166', [78, 48], 9000, 1.6), [3, 60]);
  const rough = canvasTex(256, 256, speckle('#d0d0d0', [150, 105], 4000, 2), [3, 60], false);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(6, 180), pbr('#ffffff', { map: asphalt, roughnessMap: rough, roughness: 0.85 }));
  road.rotation.x = -Math.PI / 2; road.position.set(0, 0.002, -89.5); road.receiveShadow = true;
  g.add(road);
  const paint = pbr('#f6f8fa', { roughness: 0.55 });
  for (const sx of [-1, 1]) g.add(shadows(box(0.15, 0.012, 180, paint, sx * 2.75, 0.008, -89.5), false));
  g.add(shadows(box(5.3, 0.012, 0.35, paint, 0, 0.01, -6.6), false));
  const tomare = canvasTex(512, 256, (x, w, h) => {
    x.fillStyle = '#f6f8fa'; x.font = 'bold 200px "Yu Gothic","Meiryo",sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.save(); x.translate(w / 2, h / 2); x.scale(1, 1.25); x.fillText('止まれ', 0, 0); x.restore();
  });
  const t = noOutline(new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.6), new THREE.MeshStandardMaterial({ map: tomare, transparent: true, depthWrite: false, roughness: 0.55 })));
  t.rotation.x = -Math.PI / 2; t.position.set(0, 0.014, -4.3); t.receiveShadow = true;
  g.add(t);
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
    const side = i % 2 ? 1 : -1, x = side * (3.05 + Math.random() * 6), z = 0.4 - Math.random() * 70;
    if (Math.abs(z - TRACK_Z) < 2.3) { i--; continue; }
    q.setFromEuler(new THREE.Euler(0, Math.random() * 6.28, 0));
    s.setScalar(0.6 + Math.random() * 0.8);
    tuft.setMatrixAt(i, mx.compose(new THREE.Vector3(x, 0, z), q, s));
  }
  tuft.receiveShadow = true;
  g.add(tuft);
}

function railway(g) {
  const z0 = TRACK_Z;
  const ballast = canvasTex(256, 256, speckle('#a29c92', [110, 90], 7000, 3), [80, 1]);
  g.add(shadows(box(400, 0.28, 4.2, pbr('#ffffff', { map: ballast, roughness: 1 }), 0, 0.06, z0), false));
  const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.14, 2.4), pbr('#d3cec4', { roughness: 0.9 }), 400);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 400; i++) { m.makeTranslation(-120 + i * 0.6, 0.24, z0); sleepers.setMatrixAt(i, m); }
  sleepers.castShadow = sleepers.receiveShadow = true;
  g.add(sleepers);
  const rail = pbr('#b9c0c8', { metalness: 1, roughness: 0.28 }), railSide = pbr('#7a6a5c', { metalness: 0.6, roughness: 0.75 });
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
  const zs = [-2, -32, -62, -92, -122];
  for (const z of zs) {
    const x = -4.2;
    g.add(shadows(cyl(0.16, 10, pole, x, 5, z, 12, 0.19)));
    for (const y of [9.2, 8.4]) {
      g.add(shadows(box(1.8, 0.1, 0.1, arm, x, y, z)));
      for (const dx of [-0.75, 0, 0.75]) g.add(cyl(0.05, 0.14, ins, x + dx, y + 0.12, z, 8));
    }
    g.add(shadows(cyl(0.24, 0.65, pbr('#7b8086', { metalness: 0.5, roughness: 0.5 }), x + 0.38, 7.4, z, 14)));
    const p = noOutline(new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.7), pbr('#ffffff', { map: plate, roughness: 0.4 })));
    p.position.set(x + 0.2, 2.4, z); p.rotation.y = Math.PI / 2; g.add(p);
  }
  const wire = new THREE.LineBasicMaterial({ color: '#2b2d30' });
  for (const [dx, y] of [[-0.75, 9.32], [0, 9.32], [0.75, 9.32], [-0.75, 8.52], [0.75, 8.52]]) {
    for (let i = 0; i < zs.length - 1; i++) {
      const a = new THREE.Vector3(-4.2 + dx, y, zs[i]), b = new THREE.Vector3(-4.2 + dx, y, zs[i + 1]);
      const mid = a.clone().lerp(b, 0.5); mid.y -= 0.9;
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(a, mid, b).getPoints(20)), wire));
    }
  }
  // a service drop across the road to the houses
  const a = new THREE.Vector3(-3.45, 8.52, -2), b = new THREE.Vector3(9, 5.5, -18);
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, -1.2, 0)), b).getPoints(24)), wire));
}

function vendingMachine(g, x, z, rotY, glows) {
  const panel = canvasTex(256, 460, (c, w, h) => {
    c.fillStyle = '#f7fbff'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#1565c0'; c.fillRect(0, 0, w, 60);
    c.fillStyle = '#ffffff'; c.font = 'bold 34px "Yu Gothic",sans-serif'; c.textAlign = 'center'; c.fillText('つめた〜い', w / 2, 42);
    const cols = ['#e53935', '#43a047', '#fdd835', '#1e88e5', '#8e24aa', '#fb8c00', '#00acc1', '#6d4c41'];
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) {
      const cx = 22 + i * 42, cy = 90 + r * 95;
      c.fillStyle = cols[(r * 3 + i) % cols.length]; c.fillRect(cx - 12, cy, 24, 52);
      c.fillStyle = '#e0e0e0'; c.fillRect(cx - 12, cy, 24, 8);
      c.fillStyle = r === 2 && i > 3 ? '#e53935' : '#1e88e5'; c.fillRect(cx - 13, cy + 60, 26, 9);
    }
    c.fillStyle = '#263238'; c.fillRect(30, 390, w - 60, 46);
  });
  const vm = new THREE.Group(); vm.position.set(x, 0, z); vm.rotation.y = rotY;
  vm.add(shadows(box(1.05, 1.85, 0.75, pbr('#eef1f4', { roughness: 0.35, metalness: 0.15 }), 0, 0.925, 0)));
  const faceMat = new THREE.MeshPhysicalMaterial({ map: panel, emissive: '#ffffff', emissiveMap: panel, emissiveIntensity: 0.9, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 });
  const face = noOutline(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.6), faceMat));
  face.position.set(0, 0.98, 0.38); vm.add(face); glows.push(faceMat);
  vm.add(shadows(box(1.0, 0.08, 0.6, pbr('#d6dade', { roughness: 0.4 }), 0, 1.9, 0)));
  const bin = shadows(cyl(0.2, 0.7, pbr('#2c7be5', { roughness: 0.35 }), 0.75, 0.35, 0.15, 16));
  vm.add(bin);
  g.add(vm);
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

function busStop(g, x, z) {
  const sign = canvasTex(256, 256, (c, w) => {
    c.fillStyle = '#ffffff'; c.beginPath(); c.arc(w / 2, w / 2, w / 2 - 4, 0, 7); c.fill();
    c.strokeStyle = '#d32f2f'; c.lineWidth = 18; c.stroke();
    c.fillStyle = '#1a237e'; c.font = 'bold 54px "Yu Gothic",sans-serif'; c.textAlign = 'center'; c.fillText('バス停', w / 2, w / 2 - 6);
    c.font = 'bold 30px "Yu Gothic",sans-serif'; c.fillText('踏切前', w / 2, w / 2 + 40);
  });
  const s = new THREE.Group(); s.position.set(x, 0, z);
  s.add(shadows(cyl(0.035, 2.2, pbr('#c8ccd0', { metalness: 0.8, roughness: 0.35 }), 0, 1.1, 0)));
  const d = noOutline(new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), pbr('#ffffff', { map: sign, roughness: 0.35, side: THREE.DoubleSide })));
  d.position.set(0, 2.2, 0); d.rotation.y = 0.35; s.add(d);
  s.add(shadows(box(0.6, 0.5, 0.35, pbr('#4b5a66', { roughness: 0.4 }), 0, 0.25, 0))); // weighted base
  g.add(s);
}

function guardrails(g) {
  const rail = pbr('#f2f4f5', { metalness: 0.55, roughness: 0.3 }), post = pbr('#e6e8ea', { metalness: 0.5, roughness: 0.35 });
  for (const [x, z0, z1] of [[3.2, -15.5, -40], [-3.2, -15.5, -28]]) {
    const len = z0 - z1;
    g.add(shadows(box(0.06, 0.32, len, rail, x, 0.7, (z0 + z1) / 2)));
    for (let z = z0; z >= z1; z -= 2) g.add(shadows(cyl(0.045, 0.75, post, x, 0.375, z, 8)));
  }
}

function townscape(g) {
  const walls = ['#f5efe2', '#eaf2f4', '#f7e7d6', '#e8eee1', '#f3f0f7'], roofs = ['#3d6f9a', '#2f8f8a', '#b05a43', '#5a6470', '#3f5f8f'];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const win = canvasTex(64, 64, (c, w, h) => { c.fillStyle = '#9fc7e6'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(255,255,255,0.6)'; c.fillRect(6, 6, 18, 52); c.strokeStyle = '#e8edf0'; c.lineWidth = 6; c.strokeRect(0, 0, w, h); c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.stroke(); });
  const glass = pbr('#ffffff', { map: win, metalness: 0.3, roughness: 0.08 });
  for (const side of [-1, 1]) {
    for (let z = -16; z > -150; z -= 9 + rnd() * 6) {
      const w = 6 + rnd() * 4, d = 6 + rnd() * 3, h = 3 + rnd() * 3.5, x = side * (9 + rnd() * 10);
      const house = new THREE.Group();
      house.add(box(w, h, d, pbr(walls[(rnd() * 5) | 0], { roughness: 0.75 }), 0, h / 2, 0));
      const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, d * 0.72, 1.8, 4, 1), pbr(roofs[(rnd() * 5) | 0], { roughness: 0.55, metalness: 0.1 }));
      roof.rotation.y = Math.PI / 4; roof.scale.set(w / d, 1, 1); roof.position.y = h + 0.9;
      house.add(roof);
      for (let i = 0; i < 2; i++) { const wdw = box(1.1, 1.1, 0.05, glass, (i - 0.5) * w * 0.45, h * 0.55, d / 2 + 0.03); house.add(wdw); }
      if (rnd() > 0.5) house.add(box(w * 0.5, 0.1, 1, pbr('#c9ced3', { metalness: 0.4, roughness: 0.4 }), 0, h * 0.62, d / 2 + 0.5)); // balcony
      house.position.set(x, 0, z);
      house.lookAt(0, 0, z); house.rotateY(Math.PI); // face the road
      g.add(shadows(house));
    }
  }
  const leaf = [pbr('#4fae58', { roughness: 0.85 }), pbr('#3f9a50', { roughness: 0.85 }), pbr('#67bf5f', { roughness: 0.85 })], trunk = pbr('#7a5a3c');
  for (let i = 0; i < 46; i++) {
    const side = i % 2 ? 1 : -1, x = side * (6 + rnd() * 30), z = -14 - rnd() * 130;
    if (Math.abs(z - TRACK_Z) < 4) continue;
    const t = new THREE.Group();
    t.add(cyl(0.18, 2.4, trunk, 0, 1.2, 0, 8));
    const r = 1.4 + rnd() * 1.3;
    for (let k = 0; k < 3; k++) {
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(r * (0.7 + k * 0.15), 1), leaf[(i + k) % 3]);
      crown.position.set((rnd() - 0.5) * r, 2.4 + r * (0.6 + k * 0.35), (rnd() - 0.5) * r);
      t.add(crown);
    }
    t.position.set(x, 0, z);
    g.add(shadows(t));
  }
  const hill = pbr('#86c39a', { roughness: 1 });
  for (const [x, z, r] of [[-150, -260, 90], [-20, -300, 120], [140, -270, 100], [260, -230, 80]]) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), hill);
    h.scale.y = 0.35; h.position.set(x, -2, z); g.add(h);
  }
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
  utilityPoles(g); guardrails(g);
  vendingMachine(g, 4.0, -3.0, -Math.PI / 2 + 0.25, glows);
  curveMirror(g, 3.6, -7.6, -0.6);
  busStop(g, -3.4, -4.6);
  townscape(g);
  const tr = train(g, glows);
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
  flare.addElement(new LensflareElement(flareTex(0.25, 1), 380, 0));
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
    group: g,
    // units per meter of the character world, so lights/shadows/fog can be sized in model units
    fit(scene, U) {
      g.scale.setScalar(U);
      sun.position.copy(SUN_DIR).multiplyScalar(60).add(target.position);
      const cam = sun.shadow.camera;
      cam.left = cam.bottom = -22 * U; cam.right = cam.top = 22 * U; cam.near = 1 * U; cam.far = 140 * U;
      cam.updateProjectionMatrix();
      flareHolder.position.copy(SUN_DIR).multiplyScalar(300);
      scene.fog = new THREE.Fog('#d6efff', 40 * U, 330 * U);
      scene.environment ??= bakeEnvironment(renderer);
      scene.background = this.sky ??= bakeSky(renderer);
      scene.environmentIntensity = 0.45;
    },
    unfit(scene) { scene.fog = null; scene.environment = null; scene.background = null; },
    setSound(on) {
      if (on && !audio) audio = new AudioContext();
      if (!on && audio) { audio.close(); audio = null; }
    },
    tick(t, dt) {
      this.t = t;
      // train schedule: enters from the viewer's left every CYCLE s; warning starts ~5 s before it reaches
      // the road and ends once the tail has cleared it
      const ph = t % CYCLE;
      tr.position.x = -300 + ph * TRAIN_SPEED;
      const head = tr.position.x + 50.8, tail = tr.position.x - 10.1;
      const active = head > -5 * TRAIN_SPEED && tail < 8;
      this.debug = { ph, x: tr.position.x, active, bar };
      bar += ((active ? 0 : 1.45) - bar) * (1 - Math.exp(-dt * (active ? 2.2 : 1.4)));
      for (const a of arms) a.rotation.z = bar;
      const beat = Math.floor(t * 2.2);
      for (let i = 0; i < lamps.length; i++) lamps[i].emissiveIntensity = active && (beat + i) % 2 ? 6 : 0;
      if (audio && active && beat !== lastBeat) bell(audio, audio.currentTime);
      lastBeat = beat;
    },
  };
}
