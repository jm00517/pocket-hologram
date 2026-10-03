// After-school classroom (放課後の教室): a Japanese high-school classroom at sunset, seen from the back of
// the room toward the blackboard. Low sun through the window wall on the left lays long window-frame shadows
// over the desks; light shafts with drifting dust, curtains breathing in the breeze, chalk notes left on the
// board. Same conventions as Crossing: metres inside `group`, fit(scene, U) scales it to the character world.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadSky } from '../../engine/index.js';

// room box: window wall at X0, board at Z0; Z1 is the screen plane (the 'window' the viewer looks through), so
// nothing stands on the viewer's side of it
const W = 9, X0 = -4.5, X1 = 4.5, Z0 = -8, Z1 = 0.4, H = 3.1;
const SILL = 0.9, HEAD = 2.65;                                   // window opening
const SUN_DIR = new THREE.Vector3(-0.84, 0.21, 0.5).normalize(); // toward the sun: low, from the window side
const TEX = 'assets/polyhaven/tex/';

const noInk = (o) => { o.traverse((m) => { for (const mat of [].concat(m.material ?? [])) mat.userData.outlineParameters = { visible: false }; }); return o; };
const shade = (o, cast = true, recv = true) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = recv; } }); return o; };
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
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

// --- the room ----------------------------------------------------------------------------------------
function shell(g) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, Z1 - Z0), pbrSet('plank_flooring_02', [3, 3.2], '#f2e2cf'));
  floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, (Z0 + Z1) / 2); g.add(shade(floor, false));
  const wall = pbrSet('plastered_wall_04', [3, 1.2], '#f1ebe0'), wainscot = pbrSet('plank_flooring_02', [3, 0.4], '#a8825e');
  const ceil = new THREE.MeshStandardMaterial({ roughness: 0.95, map: canvasTex(256, 256, (c, w) => { // perforated ceiling tile
    c.fillStyle = '#ecebe6'; c.fillRect(0, 0, w, w); c.fillStyle = '#c9c7c0';
    for (let i = 0; i < 900; i++) c.fillRect(Math.random() * w, Math.random() * w, 2, 2);
    c.strokeStyle = '#cfcdc6'; c.lineWidth = 3; c.strokeRect(0, 0, w, w);
  }) });
  ceil.map.wrapS = ceil.map.wrapT = THREE.RepeatWrapping; ceil.map.repeat.set(15, 16);
  const c = new THREE.Mesh(new THREE.PlaneGeometry(W, Z1 - Z0), ceil); c.rotation.x = Math.PI / 2; c.position.set(0, H, (Z0 + Z1) / 2); g.add(shade(c, false));
  const D = Z1 - Z0, cz = (Z0 + Z1) / 2;
  // front (board), back and corridor walls with a wooden wainscot
  for (const [w, x, z, ry] of [[W, 0, Z0, 0], [W, 0, Z1, Math.PI], [D, X1, cz, -Math.PI / 2]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, H), wall); p.position.set(x, H / 2, z); p.rotation.y = ry; g.add(shade(p, false));
    const k = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.9), wainscot); k.position.set(x, 0.45, z); k.rotation.y = ry; k.translateZ(0.012); g.add(shade(k, false));
  }
  // window wall: solid below the sill and above the head, pillars between the bays
  for (const [y0, y1] of [[0, SILL], [HEAD, H]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.2, y1 - y0, D), wall); p.position.set(X0 - 0.1, (y0 + y1) / 2, cz); g.add(shade(p));
  }
  const alu = new THREE.MeshStandardMaterial({ color: '#c8c9c4', metalness: 0.7, roughness: 0.35 });
  const bays = [-7.4, -5.4, -3.4, -1.4, 0.4];
  for (const z of bays) g.add(shade(box(0.22, HEAD - SILL, 0.24, wall, X0 - 0.1, (SILL + HEAD) / 2, z)));
  for (let i = 0; i < bays.length - 1; i++) { // two sliding panes per bay: frames, a mid rail, glass
    const za = bays[i] + 0.12, zb = bays[i + 1] - 0.12, mid = (za + zb) / 2;
    for (const z of [za, mid, zb]) g.add(shade(box(0.06, HEAD - SILL, 0.05, alu, X0 + 0.02, (SILL + HEAD) / 2, z)));
    for (const y of [SILL + 0.02, HEAD - 0.02, 1.85]) g.add(shade(box(0.06, 0.05, zb - za, alu, X0 + 0.02, y, mid)));
  }
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(D, HEAD - SILL), new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.07, metalness: 1, roughness: 0.04, depthWrite: false }));
  glass.rotation.y = Math.PI / 2; glass.position.set(X0 + 0.03, (SILL + HEAD) / 2, cz); g.add(glass);
  // sill board
  g.add(shade(box(0.28, 0.04, D, new THREE.MeshStandardMaterial({ color: '#d9d4c8', roughness: 0.6 }), X0 + 0.1, SILL, cz)));
  return bays;
}

// --- blackboard, platform, teacher's desk, clock -----------------------------------------------------------
function chalkBoard() {
  return canvasTex(2048, 600, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#24453a'); g.addColorStop(1, '#1d3a31');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) { // eraser swipes
      c.fillStyle = `rgba(230,240,235,${0.02 + Math.random() * 0.03})`;
      c.beginPath(); c.ellipse(Math.random() * w, Math.random() * h, 60 + Math.random() * 160, 18 + Math.random() * 30, (Math.random() - 0.5) * 0.4, 0, 7); c.fill();
    }
    const chalk = (text, x, y, size, color = '#f2f2ea', rot = 0, font = '"Yu Gothic","Meiryo",sans-serif') => {
      c.save(); c.translate(x, y); c.rotate(rot); c.font = `bold ${size}px ${font}`; c.fillStyle = color; c.globalAlpha = 0.85;
      c.fillText(text, 0, 0); c.restore();
    };
    chalk('10月3日 (金)', 60, 110, 64);
    chalk('日直', w - 170, 120, 54); chalk('初音', w - 150, 230, 58, '#ffd9e8'); chalk('鏡音', w - 150, 330, 58);
    chalk('文化祭まで あと 12日!!', 520, 150, 76, '#fff3a8', -0.03);
    chalk('今日の連絡', 80, 260, 46); chalk('・ 6限 体育館に集合', 100, 330, 40); chalk('・ 提出物 金曜まで', 100, 390, 40);
    // 相合傘 (umbrella with two names)
    c.save(); c.translate(1330, 470); c.strokeStyle = '#ffd0e0'; c.lineWidth = 6; c.globalAlpha = 0.85;
    c.beginPath(); c.arc(0, -40, 120, Math.PI, 0); c.stroke(); c.beginPath(); c.moveTo(0, -160); c.lineTo(0, 100); c.stroke();
    c.beginPath(); c.arc(-14, 100, 14, 0, Math.PI); c.stroke(); c.restore();
    chalk('ミ', 1260, 520, 54, '#ffd0e0'); chalk('ク', 1260, 580, 54, '#ffd0e0'); chalk('？', 1360, 550, 54, '#ffd0e0');
    chalk('★', 980, 470, 60, '#a8e8ff'); chalk('またね〜', 860, 560, 52, '#bff5d8', 0.05);
    for (let i = 0; i < 9000; i++) { // chalk grain: knock tiny holes out of the strokes
      c.fillStyle = 'rgba(36,66,56,0.55)'; c.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
  });
}
function front(g) {
  const bw = 4.6, bh = 1.25, by = 0.9 + bh / 2;
  const board = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshStandardMaterial({ map: chalkBoard(), roughness: 0.9 }));
  board.position.set(0, by, Z0 + 0.03); g.add(shade(board, false));
  const alu = new THREE.MeshStandardMaterial({ color: '#b9bab4', metalness: 0.6, roughness: 0.4 });
  for (const [w, h, x, y] of [[bw + 0.1, 0.05, 0, by + bh / 2 + 0.02], [0.05, bh, -bw / 2 - 0.02, by], [0.05, bh, bw / 2 + 0.02, by]]) g.add(shade(box(w, h, 0.04, alu, x, y, Z0 + 0.03)));
  g.add(shade(box(bw + 0.1, 0.04, 0.12, alu, 0, 0.9, Z0 + 0.07))); // chalk tray
  const chalks = ['#f4f4ee', '#ffd0e0', '#fff3a8', '#a8e8ff'];
  chalks.forEach((col, i) => { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 6), new THREE.MeshStandardMaterial({ color: col, roughness: 1 })); s.rotation.z = Math.PI / 2; s.position.set(-1.6 + i * 0.12, 0.93, Z0 + 0.07); g.add(s); });
  g.add(shade(box(0.13, 0.04, 0.05, new THREE.MeshStandardMaterial({ color: '#3b3f8f', roughness: 0.9 }), 1.4, 0.94, Z0 + 0.07))); // eraser
  // 教壇 platform and 教卓
  const wood = pbrSet('plank_flooring_02', [3, 0.3], '#b78c62');
  g.add(shade(box(6.4, 0.18, 1.3, wood, 0, 0.09, Z0 + 0.65)));
  const desk = new THREE.MeshStandardMaterial({ color: '#8a6446', roughness: 0.55 });
  g.add(shade(box(1.2, 0.9, 0.55, desk, 0.2, 0.18 + 0.45, Z0 + 0.95)));
  g.add(shade(box(1.3, 0.04, 0.62, new THREE.MeshStandardMaterial({ color: '#a77a54', roughness: 0.4 }), 0.2, 0.18 + 0.92, Z0 + 0.95)));
  // class schedule + notices beside the board
  const notice = (text, x, y, w2, h2, bg) => {
    const t = canvasTex(256, 360, (c, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = '#333'; c.font = 'bold 30px "Yu Gothic",sans-serif'; c.fillText(text, 20, 50); for (let i = 0; i < 9; i++) c.fillRect(20, 80 + i * 30, 120 + Math.random() * 100, 6); });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w2, h2), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 })); p.position.set(x, y, Z0 + 0.02); g.add(p);
  };
  notice('時間割', -3.1, 1.75, 0.55, 0.75, '#fdfbf2'); notice('お知らせ', 3.0, 1.7, 0.5, 0.7, '#fff6d9'); notice('献立表', 3.6, 1.6, 0.45, 0.62, '#eef7ff');
  // speaker box
  g.add(shade(box(0.4, 0.3, 0.14, new THREE.MeshStandardMaterial({ color: '#e7e3d7', roughness: 0.7 }), 2.9, 2.75, Z0 + 0.08)));
}

// --- desks and chairs (JIS steel-frame type), instanced ----------------------------------------------------
function desks(g) {
  const geo = (parts) => mergeGeometries(parts.map(([w, h, d, x, y, z]) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)));
  const tube = (x, z, h, y0 = 0) => [0.025, h, 0.025, x, y0 + h / 2, z];
  const top = geo([[0.65, 0.025, 0.45, 0, 0.7, 0]]);
  const frame = geo([tube(-0.3, -0.2, 0.69), tube(0.3, -0.2, 0.69), tube(-0.3, 0.2, 0.69), tube(0.3, 0.2, 0.69),
    [0.6, 0.02, 0.02, 0, 0.12, -0.2], [0.6, 0.02, 0.02, 0, 0.12, 0.2], [0.58, 0.1, 0.36, 0, 0.62, 0.0]]); // rails + book box
  const seat = geo([[0.4, 0.02, 0.38, 0, 0.42, 0], [0.38, 0.22, 0.02, 0, 0.72, 0.19]]);
  const cframe = geo([tube(-0.17, -0.16, 0.41), tube(0.17, -0.16, 0.41), tube(-0.17, 0.17, 0.84), tube(0.17, 0.17, 0.84)]);
  const plywood = new THREE.MeshStandardMaterial({ color: '#dcc08f', roughness: 0.55, map: canvasTex(256, 256, (c, w) => {
    c.fillStyle = '#e2c99b'; c.fillRect(0, 0, w, w);
    for (let i = 0; i < 60; i++) { c.strokeStyle = `rgba(150,110,60,${0.08 + Math.random() * 0.1})`; c.lineWidth = 1 + Math.random() * 2; c.beginPath(); const y = Math.random() * w; c.moveTo(0, y); c.bezierCurveTo(w / 3, y + 6, w / 2, y - 6, w, y + 3); c.stroke(); }
  }) });
  const steel = new THREE.MeshStandardMaterial({ color: '#8c8a7e', metalness: 0.6, roughness: 0.45 });
  const cols = [-3.45, -2.1, -0.8, 0.8, 2.1, 3.45], rows = [-1.6, -2.85, -4.1, -5.35];
  const dm = [], cm = [];
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  for (const z of rows) for (const x of cols) {
    dm.push(m.compose(new THREE.Vector3(x + (rnd() - 0.5) * 0.06, 0, z + (rnd() - 0.5) * 0.06), q.setFromEuler(e.set(0, (rnd() - 0.5) * 0.08, 0)), one).clone());
    const out = rnd() < 0.35 ? 0.15 + rnd() * 0.25 : 0; // some chairs left pulled out, a bit askew
    cm.push(m.compose(new THREE.Vector3(x + (rnd() - 0.5) * 0.08, 0, z + 0.42 + out), q.setFromEuler(e.set(0, (rnd() - 0.5) * (out ? 0.5 : 0.1), 0)), one).clone());
  }
  for (const [gm, mat, list] of [[top, plywood, dm], [frame, steel, dm], [seat, plywood, cm], [cframe, steel, cm]]) {
    const im = new THREE.InstancedMesh(gm, mat, list.length);
    list.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.castShadow = im.receiveShadow = true; g.add(im);
  }
  // lived-in: a few bags on the hooks, notebooks and a pencil case left on desks
  const bag = new THREE.MeshStandardMaterial({ color: '#2b2f45', roughness: 0.6 }), note = ['#f4e7b0', '#bfe0f5', '#f6c6d0', '#d6f0c8'];
  dm.forEach((mm, i) => {
    const p = new THREE.Vector3().setFromMatrixPosition(mm);
    if (i % 5 === 1) { const b = shade(box(0.3, 0.32, 0.1, bag, p.x + 0.36, 0.5, p.z)); b.rotation.y = Math.PI / 2; g.add(b); }
    if (i % 3 === 0) { const n = shade(box(0.18, 0.012, 0.25, new THREE.MeshStandardMaterial({ color: note[i % 4], roughness: 0.9 }), p.x - 0.1, 0.72, p.z)); n.rotation.y = rnd() - 0.5; g.add(n); }
    if (i % 7 === 2) g.add(shade(box(0.2, 0.04, 0.06, new THREE.MeshStandardMaterial({ color: '#e86f8c', roughness: 0.5 }), p.x + 0.15, 0.735, p.z - 0.1)));
  });
}

// --- corridor side, back of the room, ceiling lights ---------------------------------------------------------
function rest(g) {
  const door = new THREE.MeshStandardMaterial({ color: '#b48d66', roughness: 0.6 }), alu = new THREE.MeshStandardMaterial({ color: '#c3c4bf', metalness: 0.6, roughness: 0.4 });
  const pane = new THREE.MeshStandardMaterial({ color: '#cfe2ec', transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.3 });
  for (const z of [-6.6, -0.6]) { // sliding doors with a window
    g.add(shade(box(0.06, 2.0, 0.95, door, X1 - 0.03, 1.0, z)));
    const w = box(0.07, 0.5, 0.5, pane, X1 - 0.04, 1.45, z); g.add(w);
  }
  for (let z = -7.4; z < 0.2; z += 1.1) g.add(box(0.05, 0.3, 0.9, pane, X1 - 0.03, 2.75, z)); // transom windows
  g.add(shade(box(0.05, 0.04, Z1 - Z0, alu, X1 - 0.03, 2.58, (Z0 + Z1) / 2)));
  // fluorescent fixtures, switched off at sunset
  const tubeMat = new THREE.MeshStandardMaterial({ color: '#f4f4f0', emissive: '#f8fbff', emissiveIntensity: 0, roughness: 0.3 });
  const body = new THREE.MeshStandardMaterial({ color: '#ecece6', roughness: 0.5 });
  for (const x of [-2.5, 0, 2.5]) for (const z of [-6.2, -3.6, -1.0]) {
    g.add(shade(box(0.2, 0.08, 1.3, body, x, H - 0.05, z), false));
    g.add(box(0.06, 0.03, 1.2, tubeMat, x, H - 0.1, z));
  }
}

// --- light: sun shafts with dust, curtains --------------------------------------------------------------
function shafts(g, bays) {
  // one prism per window bay: the opening swept along the sun ray into the room, fading with depth
  const L = 7, back = SUN_DIR.clone().multiplyScalar(-L);
  const pos = [], fade = [], idx = [];
  for (let i = 0; i < bays.length - 1; i++) {
    const za = bays[i] + 0.15, zb = bays[i + 1] - 0.15, b = pos.length / 3;
    const ring = [[za, SILL], [zb, SILL], [zb, HEAD], [za, HEAD]];
    for (const [z, y] of ring) { pos.push(X0, y, z); fade.push(0); }
    for (const [z, y] of ring) { pos.push(X0 + back.x, y + back.y, z + back.z); fade.push(1); }
    for (let k = 0; k < 4; k++) { const k2 = (k + 1) % 4; idx.push(b + k, b + k2, b + 4 + k2, b + k, b + 4 + k2, b + 4 + k); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#ffb46b') }, uStrength: { value: 0.09 } },
    vertexShader: 'attribute float aFade; varying float vF; varying vec3 vW; void main(){ vF = aFade; vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying float vF; varying vec3 vW;
      void main(){ float a = (1.0 - vF) * (1.0 - vF) * (0.75 + 0.25 * sin(vW.y * 9.0 + vW.z * 3.0)); gl_FragColor = vec4(uColor * a * uStrength, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const beams = new THREE.Mesh(geo, mat); beams.userData.noAO = true; beams.userData.noShadow = true; g.add(beams);
  // dust motes drifting inside the beams
  const N = 900, p = new Float32Array(N * 3), seed = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const bay = (Math.random() * (bays.length - 1)) | 0, t = Math.random() * 0.8;
    p[i * 3] = X0 + back.x * t; p[i * 3 + 1] = SILL + Math.random() * (HEAD - SILL) + back.y * t; p[i * 3 + 2] = bays[bay] + 0.2 + Math.random() * 1.8 + back.z * t;
    seed[i] = Math.random() * 100;
  }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(p, 3)); dg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const dust = new THREE.Points(dg, new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 } },
    vertexShader: `attribute float aSeed; uniform float uTime, uScale; varying float vA;
      void main(){ vec3 p = position + vec3(sin(uTime * 0.13 + aSeed), sin(uTime * 0.09 + aSeed * 1.7) * 0.6, cos(uTime * 0.11 + aSeed * 0.7)) * 0.12;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 1.3 + aSeed * 5.0)); gl_PointSize = uScale * 9.0 / -mv.z; }`,
    fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(vec3(1.0, 0.8, 0.55) * vA * (1.0 - d * 2.0) * 0.5, 1.0); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  dust.frustumCulled = false; g.add(dust);
  return { beams: mat, dust: dust.material };
}
function curtains(g, bays) {
  const time = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ color: '#f3ead6', roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 0.92 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aBillow;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float down = clamp((${HEAD.toFixed(2)} - position.y) / 1.9, 0.0, 1.0);
        transformed.x += sin(position.z * 26.0) * 0.035 + aBillow * down * down * (0.35 + 0.25 * sin(uTime * 0.9 + position.z * 2.0) + 0.12 * sin(uTime * 2.3));
        transformed.z += aBillow * down * 0.08 * sin(uTime * 1.1);`);
  };
  mat.customProgramCacheKey = () => 'curtain';
  const parts = [];
  bays.forEach((z, i) => { // a gathered curtain at each pillar; one billows into the room
    const w = 0.55, geo = new THREE.PlaneGeometry(w, HEAD - SILL + 0.35, 22, 16);
    geo.rotateY(Math.PI / 2); geo.translate(X0 + 0.12, (SILL + HEAD) / 2 + 0.1, z + (i ? -0.3 : 0.3));
    geo.setAttribute('aBillow', new THREE.Float32BufferAttribute(new Array(geo.attributes.position.count).fill(i === 2 ? 1 : i === 3 ? 0.35 : 0.08), 1));
    parts.push(geo);
  });
  const cur = new THREE.Mesh(mergeGeometries(parts), mat); cur.castShadow = true; cur.receiveShadow = true; g.add(cur);
  g.add(shade(box(0.04, 0.04, Z1 - Z0, new THREE.MeshStandardMaterial({ color: '#c3c4bf', metalness: 0.6 }), X0 + 0.12, HEAD + 0.18, (Z0 + Z1) / 2)));
  return time;
}

// --- outside: schoolyard far below and a town skyline in the dusk -----------------------------------------
function outside(g) {
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#b8926a', roughness: 1 }));
  yard.rotation.x = -Math.PI / 2; yard.position.set(-150, -9, -40); g.add(yard);
  const town = new THREE.MeshStandardMaterial({ color: '#5e5568', roughness: 1 });
  let s = 9; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const parts = [];
  for (let i = 0; i < 70; i++) { const w = 6 + rnd() * 14, h = 6 + rnd() * 22; parts.push(new THREE.BoxGeometry(w, h, w).translate(-90 - rnd() * 140, -9 + h / 2, -120 + rnd() * 220)); }
  g.add(new THREE.Mesh(mergeGeometries(parts), town));
  const trees = new THREE.MeshStandardMaterial({ color: '#3d4a33', roughness: 1 });
  const tp = []; for (let i = 0; i < 26; i++) tp.push(new THREE.SphereGeometry(3 + rnd() * 2, 8, 6).translate(-30 - rnd() * 10, -6 + rnd() * 2, -40 + i * 3.2));
  g.add(new THREE.Mesh(mergeGeometries(tp), trees));
}

export function createClassroom(renderer) {
  const g = new THREE.Group(); g.name = 'classroom'; g.visible = false;
  const bays = shell(g); front(g); desks(g); rest(g); outside(g);
  const fx = shafts(g, bays), curtainTime = curtains(g, bays);
  new GLTFLoader().loadAsync('assets/polyhaven/models/wall_clock/wall_clock.gltf').then((m) => {
    const c = m.scene; const b = new THREE.Box3().setFromObject(c), sz = b.getSize(new THREE.Vector3());
    c.scale.setScalar(0.34 / Math.max(sz.x, sz.y)); c.position.set(0, 2.68, Z0 + 0.05); noInk(c); g.add(shade(c));
  }).catch(() => {});
  const sun = new THREE.DirectionalLight('#ffb070', 4.2);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
  const target = new THREE.Object3D(); target.position.set(0, 0, -3); sun.target = target;
  sun.position.copy(SUN_DIR).multiplyScalar(30).add(target.position);
  const fill = new THREE.HemisphereLight('#ffd8b0', '#5a4636', 0.35);       // dim sky + warm floor bounce
  const bounce = new THREE.PointLight('#ffb27a', 0, 9, 2); bounce.position.set(1.5, 0.6, -2.5); // sunlit floor glow
  g.add(sun, target, fill, bounce);
  noInk(g);
  return {
    group: g,
    // what main applies to the character lights and the post chain
    look: { exposure: 0.9, amb: ['#ffd2b0', 0.5], key: ['#ffd2ab', 2.4], keyDir: SUN_DIR.clone().setY(0.45), gi: 0.7,
      grade: { tint: [1.03, 0.98, 0.93], sat: 1.04, contrast: 1.08, sepia: 0.03, vignette: 0.4 }, bloom: 0.4, bloomThreshold: 1.0 },
    async fit(scene, U) {
      g.scale.setScalar(U);
      const cam = sun.shadow.camera;
      cam.left = cam.bottom = -9 * U; cam.right = cam.top = 9 * U; cam.near = 1 * U; cam.far = 60 * U; cam.updateProjectionMatrix();
      bounce.intensity = 3 * U ** 2; bounce.distance = 9 * U;
      fx.dust.uniforms.uScale.value = U * 1.2;
      scene.fog = null;
      const sky = await loadSky(renderer, 'assets/polyhaven/hdri/sunset.hdr');
      const a = Math.atan2(SUN_DIR.x, SUN_DIR.z) - Math.atan2(sky.sun.x, sky.sun.z);
      scene.background = sky.tex; scene.environment = sky.env;
      scene.backgroundRotation.set(0, a, 0); scene.environmentRotation.set(0, a, 0);
      scene.backgroundIntensity = 0.85; scene.environmentIntensity = 0.3;
    },
    tick(t) { curtainTime.value = t; fx.dust.uniforms.uTime.value = t; },
  };
}
