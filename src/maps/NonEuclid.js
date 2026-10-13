// 비유클리드 갤러리: a small white gallery whose doors don't lead where its walls say they should.
// - the blue booth on the left opens into a pillared hall 70 m long (bigger on the inside);
// - the doorway in the back wall opens onto a corridor of torii gates that never ends (its far end is its start);
// - the gold frame on the right shows a floating island in the sky from the front, the hall's far end from behind.
// Every door works both ways: from the hall or the island you look back through it at her.
//
// Portals: a door here and its twin there are related by a pure translation T (map metres). A door's surface
// shows what a virtual camera (the eye moved by T, its near plane clipped obliquely to the twin's plane) rendered
// this frame into a target, sampled in screen space: so it lines up for the off-axis window camera and per eye
// in VR (the eyes sit side by side in the framebuffer and in the target). The corridor's end is recursive:
// deepest view first, each level showing the next through its own door. Walk through a door (VR, free cam)
// and the rig moves by T. The spaces sit 400 m apart and each sees only its own lights, through camera layers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadSky } from '../../engine/index.js';
import { trees, useWind, noInk } from './crossing/Foliage.js';

const MAIN = 0, HALL = 10, ISLAND = 11, CORR = 12, GRAV = 13; // camera layers (1 and 2 are three's per-eye layers in VR)
// CORR, GRAV: the torii corridor / the turning corridor alone (also in MAIN), for their recursion. Seen from k x 6 m back, an oblique near plane drags
// the far plane in and cuts the far gates off; with only the corridor on the layer there is nothing to clip.
const HX = 400, IX = -400; // where the hall and the island are
const BOOTH = new THREE.Vector3(-2.4, 1.05, -1.2), FRAME = new THREE.Vector3(2.4, 1.15, -1.2), CZ = -7, CL = 6; // corridor CZ..CZ-CL
const F = (x, y, z, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));
// door frames (door space: opening centred on the origin, facing +z)
const ALICE = F(-5.98, 1.05, 1.5, Math.PI / 2), DOLL = F(-0.8, 0.105, 0.8, 0, 0, 0.1); // a normal door -> one a tenth that size
const DIORAMA = F(-4.3, 1.18, -3.29), FRONT = F(0, 2.1, 4.99, 0, 0, 20); // the box's 60 x 21 cm glass -> the 12 x 4.2 m front wall
const GX = 6.2, GL = 8, GZ = -4.5; // the turning corridor: x GX..GX+GL, 3 m square around y 1.5, z GZ
const GEND = F(GX + GL, 1.5, GZ, -Math.PI / 2), GSTART = F(GX, 1.5, GZ, -Math.PI / 2, Math.PI / 2); // its end -> its start, a quarter turned
const rnd = ((s) => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const cyl = (r, h, x, y, z, s = 20) => new THREE.CylinderGeometry(r, r, h, s).translate(x, y + h / 2, z);
function add(g, mat, geos, { cast = true, layer = MAIN } = {}) {
  const m = new THREE.Mesh(mergeGeometries(geos), mat);
  m.castShadow = cast; m.receiveShadow = true; m.layers.set(layer); g.add(m);
  return m;
}
const std = (color, roughness = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
function canvasTex(w, h, paint, repeat = [1, 1]) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 8;
  return t;
}
const setLayer = (o, l) => { o.traverse((m) => m.layers.set(l)); return o; };

// --- the gallery, the booth, the frame, the corridor (layer MAIN) ---------------------------------------
function gallery(g) {
  const plaster = std('#f2efe9', 0.9), oak = std('#c7a57a', 0.45, { map: canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#c9a77c'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 * 96; x < w + 192; x += 192) {
      c.fillStyle = `hsl(32, 38%, ${52 + rnd() * 12}%)`; c.fillRect(x - 192, y, 190, 30);
    }
  }, [6, 6]) });
  add(g, oak, [box(12, 0.1, 12, 0, -0.05, -1)]);
  // walls with a doorway in the back one (the corridor); front wall behind where you start
  add(g, plaster, [box(0.2, 4.2, 8.05, -6.1, 2.1, -2.975), box(0.2, 4.2, 3.05, -6.1, 2.1, 3.475), box(0.2, 2.1, 0.9, -6.1, 3.15, 1.5),
    box(0.2, 4.2, 1, 6.1, 2.1, -6.5), box(0.2, 4.2, 8, 6.1, 2.1, 1), box(0.2, 1.2, 3, 6.1, 3.6, -4.5), box(12.4, 4.2, 0.2, 0, 2.1, 5.1),
    box(4.8, 4.2, 0.2, -3.6, 2.1, CZ + 0.1), box(4.8, 4.2, 0.2, 3.6, 2.1, CZ + 0.1), box(2.4, 1.2, 0.2, 0, 3.6, CZ + 0.1),
    box(12.4, 0.2, 12.4, 0, 4.3, -1)], { cast: false });
  // ceiling light panels
  add(g, std('#fff', 1, { emissive: '#fff6ea', emissiveIntensity: 1.6 }), [-3, 0, 3].flatMap((x) => [box(1.6, 0.02, 1.6, x, 4.19, -4), box(1.6, 0.02, 1.6, x, 4.19, 1)]), { cast: false });
  // two plinths with slowly turning knots, gallery pieces
  add(g, std('#eceae4', 0.7), [box(0.6, 1, 0.6, -4.5, 0.5, 2.5), box(0.6, 1, 0.6, 4.5, 0.5, 2.5)]);
  const knots = [-4.5, 4.5].map((x, i) => {
    const k = new THREE.Mesh(new THREE.TorusKnotGeometry(0.18, 0.055, 160, 16, 2 + i, 3), std(i ? '#c9a14a' : '#8fb7d9', 0.18, { metalness: 1 }));
    k.position.set(x, 1.45, 2.5); k.castShadow = true; g.add(k); return k;
  });

  // the booth: a blue wooden box a metre deep; its door is the first portal
  const blue = std('#1f3f7a', 0.55), bx = BOOTH.x, bz = BOOTH.z;
  add(g, blue, [box(0.15, 2.5, 1, bx - 0.55, 1.25, bz - 0.5), box(0.15, 2.5, 1, bx + 0.55, 1.25, bz - 0.5), box(1.25, 0.15, 1, bx, 2.43, bz - 0.5),
    box(1.25, 2.5, 0.1, bx, 1.25, bz - 0.95), box(0.2, 0.3, 0.12, bx - 0.5, 2.25, bz), box(0.2, 0.3, 0.12, bx + 0.5, 2.25, bz), box(1.2, 0.25, 0.12, bx, 2.28, bz),
    box(1.1, 0.12, 0.12, bx, 2.62, bz - 0.5)]);
  add(g, std('#fff', 1, { emissive: '#ffffff', emissiveIntensity: 1.2 }), [box(0.9, 0.14, 0.02, bx, 2.28, bz + 0.065)], { cast: false });
  // the frame: gilded, free-standing on two feet, a portal on each face
  goldFrame(g, FRAME, MAIN);

  // the corridor: torii every 1.5 m and a lantern every 3 m, both dividing its 6 m so the loop is seamless
  const red = std('#c8321f', 0.5, { emissive: '#3a0802', emissiveIntensity: 0.6 }), black = std('#1b1a18', 0.6);
  const corr = [add(g, std('#6d6a64', 0.8), [box(2.4, 0.1, CL, 0, -0.05, CZ - CL / 2)])];
  corr.push(add(g, std('#e7dcc6', 0.95), [box(0.2, 3.2, CL, -1.3, 1.6, CZ - CL / 2), box(0.2, 3.2, CL, 1.3, 1.6, CZ - CL / 2), box(2.8, 0.2, CL, 0, 3.3, CZ - CL / 2)], { cast: false }));
  const toriiR = [], toriiB = [];
  for (let z = CZ - 0.75; z > CZ - CL; z -= 1.5) {
    toriiR.push(cyl(0.09, 2.7, -0.95, 0, z), cyl(0.09, 2.7, 0.95, 0, z), box(2.2, 0.12, 0.12, 0, 2.3, z), box(2.5, 0.12, 0.2, 0, 2.72, z));
    toriiB.push(box(2.6, 0.08, 0.24, 0, 2.82, z), cyl(0.11, 0.25, -0.95, 0, z), cyl(0.11, 0.25, 0.95, 0, z));
  }
  corr.push(add(g, red, toriiR), add(g, black, toriiB));
  const paper = std('#fff', 1, { emissive: '#ffb36b', emissiveIntensity: 2.2 }), lamps = [];
  for (const z of [CZ - 1.5, CZ - 4.5]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.4, 16), paper); m.position.set(0, 2.95, z); g.add(m);
    const l = new THREE.PointLight('#ffb36b', 1, 6, 2); l.position.set(0, 2.6, z); g.add(l); lamps.push([l, 2.2]); corr.push(m, l);
  }
  for (const o of corr) o.layers.enable(CORR);

  // Alice's door in the left wall (white, "DRINK ME"), and the doll's door it leads to, 21 cm tall at her feet
  const white = std('#f6f4ef', 0.5);
  add(g, white, doorFrame(ALICE, 0.9, 2.1, 0.08));
  add(g, white, doorFrame(DOLL, 0.9, 2.1, 0.08, true));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.18), new THREE.MeshStandardMaterial({ map: canvasTex(512, 128, (c, w, h) => {
    c.fillStyle = '#f7f1e3'; c.fillRect(0, 0, w, h); c.fillStyle = '#5a3a2a'; c.font = 'italic 64px Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('DRINK ME', w / 2, h / 2 + 4);
  }), roughness: 0.8 }));
  sign.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 1.3, 0.03).premultiply(ALICE)); g.add(sign);

  // the diorama: a wooden box on a plinth; through its glass, this whole gallery at 1/20, diorama and all
  const wood = std('#6b4a32', 0.6), D = DIORAMA.elements, dx = D[12], dy = D[13], dz = D[14];
  add(g, std('#eceae4', 0.7), [box(0.9, dy - 0.18, 0.75, dx, (dy - 0.18) / 2, dz - 0.31)]);
  add(g, wood, [box(0.8, 0.06, 0.64, dx, dy - 0.15, dz - 0.31), box(0.8, 0.07, 0.64, dx, dy + 0.14, dz - 0.31), box(0.1, 0.36, 0.64, dx - 0.35, dy, dz - 0.31),
    box(0.1, 0.36, 0.64, dx + 0.35, dy, dz - 0.31), box(0.8, 0.36, 0.04, dx, dy, dz - 0.61)]);
  add(g, std('#c9a14a', 0.3, { metalness: 1 }), [box(0.64, 0.02, 0.02, dx, dy - 0.115, dz + 0.01), box(0.64, 0.02, 0.02, dx, dy + 0.115, dz + 0.01)], { cast: false });

  // the turning corridor through the right wall: every 8 m it turns a quarter about its own axis, so the next
  // stretch's floor is this one's wall. Rug, lamps and bench on the floor, paintings on one wall, windows on the other
  const tw = [];
  tw.push(add(g, std('#7a5a40', 0.6), [box(GL, 0.1, 3, GX + GL / 2, -0.05, GZ)]), add(g, std('#efe9de', 0.9), [box(GL, 0.1, 3, GX + GL / 2, 3.05, GZ)], { cast: false }));
  tw.push(add(g, std('#b8322a', 0.9), [box(GL - 1, 0.012, 1.2, GX + GL / 2, 0.006, GZ)], { cast: false }));
  tw.push(add(g, std('#dfe6ea', 0.9), [box(GL, 3, 0.1, GX + GL / 2, 1.5, GZ - 1.55), box(GL, 3, 0.1, GX + GL / 2, 1.5, GZ + 1.55)], { cast: false }));
  const art = ['#e2a33b', '#3b7fe2', '#3be28c'].map((c, i) => new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), std(c, 0.8)).translateX(GX + 1.5 + i * 2.5).translateY(1.7).translateZ(GZ - 1.47));
  tw.push(...art, add(g, std('#c9a14a', 0.3, { metalness: 1 }), art.map((a) => box(1.25, 0.95, 0.04, a.position.x, 1.7, GZ - 1.5))));
  for (const a of art) g.add(a);
  tw.push(add(g, std('#000', 1, { emissive: '#bcd8ff', emissiveIntensity: 1.6 }), [0, 1, 2].map((i) => box(1.2, 1.6, 0.02, GX + 1.5 + i * 2.5, 1.6, GZ + 1.49)), { cast: false }));
  tw.push(add(g, std('#3a3330', 0.5), [box(1.4, 0.08, 0.4, GX + 4, 0.45, GZ - 1.1), box(0.08, 0.45, 0.35, GX + 3.4, 0.22, GZ - 1.1), box(0.08, 0.45, 0.35, GX + 4.6, 0.22, GZ - 1.1),
    cyl(0.03, 1.6, GX + 1.2, 0, GZ + 1.1), cyl(0.03, 1.6, GX + 6.8, 0, GZ + 1.1)]));
  const shade = std('#fff', 1, { emissive: '#ffd6a0', emissiveIntensity: 2 });
  tw.push(add(g, shade, [new THREE.CylinderGeometry(0.12, 0.22, 0.3, 16).translate(GX + 1.2, 1.7, GZ + 1.1), new THREE.CylinderGeometry(0.12, 0.22, 0.3, 16).translate(GX + 6.8, 1.7, GZ + 1.1)], { cast: false }));
  for (const x of [GX + 2, GX + 6]) { // on the axis, so every quarter-turned copy is lit the same
    const l = new THREE.PointLight('#ffe2bd', 1, 7, 2); l.position.set(x, 1.5, GZ); g.add(l); lamps.push([l, 3]); tw.push(l);
  }
  for (const o of tw) o.layers.enable(GRAV);
  return { knots, lamps };
}

// a door's frame in door space (opening w x h centred on the origin, facing +z), placed by the door's matrix F
function doorFrame(F, w, h, t, sill = false) {
  return [box(t, h + t, t, -w / 2 - t / 2, t / 2, 0), box(t, h + t, t, w / 2 + t / 2, t / 2, 0), box(w + 2 * t, t, t, 0, h / 2 + t / 2, 0), ...(sill ? [box(w + 2 * t + 0.4, 0.05, 0.5, 0, -h / 2 - 0.025, 0)] : [])]
    .map((b) => b.applyMatrix4(F));
}

function goldFrame(g, c, layer) {
  const gold = std('#c9a14a', 0.25, { metalness: 1 }), w = 1.2, h = 2.1, t = 0.12, y0 = c.y - h / 2;
  add(g, gold, [box(w + 2 * t, t, t, c.x, y0 - t / 2, c.z), box(w + 2 * t, t, t, c.x, y0 + h + t / 2, c.z), box(t, h, t, c.x - w / 2 - t / 2, c.y, c.z), box(t, h, t, c.x + w / 2 + t / 2, c.y, c.z),
    ...[-1, 1].flatMap((sx) => [1, -1].map((sy) => new THREE.SphereGeometry(0.09, 16, 12).translate(c.x + sx * (w / 2 + t / 2), c.y + sy * (h / 2 + t / 2), c.z))),
    new THREE.SphereGeometry(0.14, 16, 12).translate(c.x, y0 + h + 0.2, c.z),
    box(0.5, 0.05, 0.5, c.x - w / 2 - t / 2, y0 - 0.12 + 0.025, c.z), box(0.5, 0.05, 0.5, c.x + w / 2 + t / 2, y0 - 0.12 + 0.025, c.z)], { layer });
}

// --- the hall (layer HALL): 36 x 70 x 22 m of marble and columns, lit by hanging lamps --------------------
function hall(g) {
  const z0 = 5, z1 = -65, W = 18, H = 22, door = BOOTH.clone().add(new THREE.Vector3(HX - BOOTH.x, 0, z0 - BOOTH.z)), fr = new THREE.Vector3(HX, FRAME.y, z1);
  const floor = std('#fff', 0.25, { map: canvasTex(256, 256, (c, w, h) => {
    for (let i = 0; i < 4; i++) { c.fillStyle = (i % 2) ^ (i >> 1) ? '#e9e3d6' : '#2c2a2e'; c.fillRect((i % 2) * w / 2, (i >> 1) * h / 2, w / 2, h / 2); }
  }, [18, 35]), envMapIntensity: 0.4 });
  add(g, floor, [box(W * 2, 0.2, z0 - z1, HX, -0.1, (z0 + z1) / 2)], { layer: HALL });
  const stone = std('#b9a689', 0.85, { envMapIntensity: 0.3 });
  const dw = 0.45, dh = 2.15; // door holes, a little larger than the doors
  add(g, stone, [box(0.6, H, z0 - z1, HX - W - 0.3, H / 2, (z0 + z1) / 2), box(0.6, H, z0 - z1, HX + W + 0.3, H / 2, (z0 + z1) / 2),
    ...[[door.x, dw, dh, z0 + 0.3], [fr.x, 0.62, FRAME.y + 1.1, z1 - 0.3]].flatMap(([x, hw, top, z]) => [
      box(x - hw - (HX - W), H, 0.6, (HX - W + x - hw) / 2, H / 2, z), box(HX + W - x - hw, H, 0.6, (HX + W + x + hw) / 2, H / 2, z), box(2 * hw, H - top, 0.6, x, (H + top) / 2, z)]),
    box(W * 2 + 1.2, 0.6, z0 - z1 + 1.2, HX, H + 0.3, (z0 + z1) / 2)], { cast: false, layer: HALL });
  // columns in two rows, with plinths and capitals
  const cols = [], caps = [];
  for (let z = z0 - 6; z > z1 + 3; z -= 7) for (const x of [HX - 10, HX + 10]) {
    cols.push(cyl(0.85, H - 1.6, x, 0.8, z, 28)); caps.push(box(2.2, 0.8, 2.2, x, 0.4, z), box(2.2, 0.8, 2.2, x, H - 0.4, z));
  }
  add(g, std('#ece6da', 0.4, { envMapIntensity: 0.4 }), cols, { layer: HALL }); add(g, stone, caps, { layer: HALL });
  // tall windows of blue dusk light along both walls
  add(g, std('#000', 1, { emissive: '#7fa9ff', emissiveIntensity: 2.2 }), Array.from({ length: 9 }, (_, i) => z0 - 6 - i * 7).flatMap((z) => [box(0.05, 9, 2.6, HX - W + 0.02, 10, z), box(0.05, 9, 2.6, HX + W - 0.02, 10, z)]), { cast: false, layer: HALL });
  // the booth door seen from inside (a little blue door in a huge wall) and the frame on the far wall
  add(g, std('#1f3f7a', 0.55), [box(0.15, 2.4, 0.2, door.x - 0.475, 1.2, z0 - 0.05), box(0.15, 2.4, 0.2, door.x + 0.475, 1.2, z0 - 0.05), box(1.1, 0.3, 0.2, door.x, 2.25, z0 - 0.05)], { layer: HALL });
  goldFrame(g, fr, HALL);
  // lamps: chandeliers down the middle, glowing orbs drifting up through the air
  const lamps = [], glow = std('#fff', 1, { emissive: '#ffd59a', emissiveIntensity: 4 });
  for (let z = z0 - 9; z > z1; z -= 14) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 16), glow); m.position.set(HX, 12, z); m.layers.set(HALL); g.add(m);
    add(g, std('#3b3128', 0.5, { metalness: 1 }), [cyl(0.03, H - 12.7, HX, 12.7, z)], { cast: false, layer: HALL });
    const l = new THREE.PointLight('#ffcf8f', 1, 45, 2); l.position.set(HX, 11, z); l.layers.set(HALL); g.add(l); lamps.push([l, 320]);
  }
  const hemi = new THREE.HemisphereLight('#8fa6d8', '#3a2c22', 0.22); hemi.layers.set(HALL); g.add(hemi);
  const N = 60, orbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 10, 8), std('#fff', 1, { emissive: '#bfe3ff', emissiveIntensity: 6 }), N);
  orbs.layers.set(HALL); orbs.userData.noAO = true; g.add(orbs);
  const seeds = Array.from({ length: N }, () => [HX + (rnd() - 0.5) * 30, rnd() * H, z1 + rnd() * (z0 - z1), rnd() * 6.28, 0.3 + rnd() * 0.5]);
  const m4 = new THREE.Matrix4();
  const drift = (t) => { seeds.forEach(([x, y, z, ph, v], i) => orbs.setMatrixAt(i, m4.makeTranslation(x + Math.sin(t * 0.3 + ph) * 0.8, (y + t * v) % (H - 1), z + Math.cos(t * 0.23 + ph) * 0.8))); orbs.instanceMatrix.needsUpdate = true; };
  return { door, fr, lamps, drift };
}

// --- the island (layer ISLAND): grass on a floating rock above a sea of clouds, under the sky ----------------
function island(g) {
  const cz = -8, R = 22, fr = new THREE.Vector3(IX, FRAME.y, 0), L = [];
  L.push(add(g, std('#5d9443', 0.95), [new THREE.CylinderGeometry(R, R * 0.96, 0.8, 64).translate(IX, -0.4, cz)]));
  const under = new THREE.ConeGeometry(R * 0.96, 18, 40, 6).rotateX(Math.PI).translate(IX, -9.8, cz), p = under.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y < -1) { p.setX(i, p.getX(i) + (rnd() - 0.5) * 2.4); p.setZ(i, p.getZ(i) + (rnd() - 0.5) * 2.4); } }
  under.computeVertexNormals();
  const rock = std('#7a6a5a', 0.95, { flatShading: true });
  L.push(add(g, rock, [under]));
  // other islets drifting at a distance
  L.push(add(g, rock, Array.from({ length: 9 }, (_, i) => {
    const a = i * 0.7 + 0.3, d = 60 + rnd() * 70, s = 2 + rnd() * 6;
    return new THREE.DodecahedronGeometry(s, 1).scale(1, 0.6, 1).translate(IX + Math.cos(a) * d, -8 + rnd() * 30, cz - 20 + Math.sin(a) * d);
  })));
  // the sea of clouds below, soft blobs on a huge disc
  const clouds = canvasTex(512, 512, (c, w, h) => {
    c.fillStyle = '#e9eef6'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { const x = rnd() * w, y = rnd() * h, r = 20 + rnd() * 60, gr = c.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(x - r, y - r, 2 * r, 2 * r);
      const sh = c.createRadialGradient(x + r * 0.3, y + r * 0.4, 0, x + r * 0.3, y + r * 0.4, r); sh.addColorStop(0, 'rgba(150,165,190,0.12)'); sh.addColorStop(1, 'rgba(150,165,190,0)'); c.fillStyle = sh; c.fillRect(x - r, y - r, 2 * r, 2 * r); }
  }, [30, 30]);
  const sea = new THREE.Mesh(new THREE.CircleGeometry(1800, 64).rotateX(-Math.PI / 2).translate(IX, -45, cz), new THREE.MeshStandardMaterial({ map: clouds, color: '#c9d3e2', roughness: 1 }));
  sea.receiveShadow = true; g.add(sea); L.push(sea);
  // trees and flowers
  const t = trees(Array.from({ length: 7 }, (_, i) => { const a = i * 0.9 + 1, d = 8 + rnd() * 10; return [IX + Math.cos(a) * d, cz + Math.sin(a) * d - 3, 0.8 + rnd() * 0.5]; }), () => 0, { refs: false });
  g.add(t); L.push(t);
  const N = 400, fl = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.05, 0), std('#fff', 0.8), N), m4 = new THREE.Matrix4(), col = new THREE.Color();
  for (let i = 0; i < N; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * (R - 1); fl.setMatrixAt(i, m4.makeTranslation(IX + Math.cos(a) * d, 0.05, cz + Math.sin(a) * d)); fl.setColorAt(i, col.set(['#fff6a8', '#ffffff', '#f7a8c8', '#a8c8ff'][i % 4])); }
  g.add(fl); L.push(fl);
  goldFrame(g, fr, ISLAND);
  const sun = new THREE.DirectionalLight('#fff1dc', 3); sun.position.set(IX + 30, 50, cz + 20); sun.target.position.set(IX, 0, cz);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  const hemi = new THREE.HemisphereLight('#cfe3ff', '#7a8a5a', 0.7);
  g.add(sun, sun.target, hemi); L.push(sun, hemi);
  for (const o of L) setLayer(o, ISLAND);
  return { fr, sun, R, cz };
}

// --- portals -----------------------------------------------------------------------------------------
// A door is a frame matrix F (door space: the opening w x h centred on the origin, facing +z, in its own units; F may
// rotate and scale). Through door A you see what lies behind door B: M = F_B F_A^-1 carries A's side of the world
// onto B's, and the eye with it. M can turn (the corridor) and scale (Alice's door, the diorama).
const PORTAL_VERT = 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
const PORTAL_FRAG = /* glsl */`
  uniform sampler2D tView; uniform vec2 uFull; uniform vec3 uP, uN; uniform float uDim; varying vec3 vW;
  void main() {
    if (dot(cameraPosition - uP, uN) < 0.0) discard; // one-way: the back of a door is not a door
    gl_FragColor = vec4(texture2D(tView, gl_FragCoord.xy / uFull).rgb * uDim, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;
const RY = new THREE.Matrix4().makeRotationY(Math.PI);
/** opts: w, h (door units), from/to (space layers), view (layer the far side is drawn with; a layer of its own
 *  means nothing needs clipping), depth (recursion; 'depth' = the corridor param), walk (can you step through),
 *  active() (is the door there now), onCross() */
function portal(g, Fa, Fb, { w, h, from, to, view = to, depth = 1, walk = true, active = null, onCross = null }) {
  // an open box behind the doorway, drawn from inside (BackSide): flat until an eye comes close, then 0.4 deep,
  // so the near plane passing through the doorway still finds the other side behind it
  const mat = new THREE.ShaderMaterial({ vertexShader: PORTAL_VERT, fragmentShader: PORTAL_FRAG, side: THREE.BackSide,
    uniforms: { tView: { value: null }, uFull: { value: new THREE.Vector2(1, 1) }, uP: { value: new THREE.Vector3() }, uN: { value: new THREE.Vector3() }, uDim: { value: 1 } } });
  mat.userData.outlineParameters = { visible: false };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1).translate(0, 0, -0.5), mat);
  mesh.matrixAutoUpdate = false; mesh.layers.set(from); if (view !== to) mesh.layers.enable(view);
  mesh.userData.noAO = true; mesh.frustumCulled = false; g.add(mesh);
  return { mesh, F: Fa.clone(), Fi: Fa.clone().invert(), M: Fb.clone().multiply(Fa.clone().invert()), w, h, from, to, view, depth, walk, active, onCross, rts: [] };
}
/** a door and its twin at the far end, looking back */
const pair = (g, Fa, Fb, opts) => [portal(g, Fa, Fb, opts), portal(g, Fb.clone().multiply(RY), Fa.clone().multiply(RY), { ...opts, from: opts.to, to: opts.from, view: opts.from })];

const vcam = new THREE.PerspectiveCamera(), clipPlane = new THREE.Plane(), q4 = new THREE.Vector4(), c4 = new THREE.Vector4();
vcam.matrixAutoUpdate = false; vcam.matrixWorldAutoUpdate = false;
// Lengyel's oblique near plane (as three's Reflector): plane in view space, normal toward what to keep
function oblique(P, plane) {
  const e = P.elements;
  c4.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
  q4.set((Math.sign(c4.x) + e[8]) / e[0], (Math.sign(c4.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
  c4.multiplyScalar(2 / c4.dot(q4));
  e[2] = c4.x; e[6] = c4.y; e[10] = c4.z + 1; e[14] = c4.w;
}

/** ctx: MapContext (sound, wind) */
export function createNonEuclid(ctx) {
  const { renderer } = ctx;
  useWind(ctx.wind.uniforms);
  const g = new THREE.Group(); g.name = 'noneuclid'; g.visible = false;
  const gal = gallery(g), H = hall(g), I = island(g);
  const T = (v, ry = 0) => F(v.x, v.y, v.z, ry);
  let twist = 0; // quarter turns taken down the turning corridor; only every fourth lets you back out
  const portals = [
    ...pair(g, T(BOOTH), T(H.door), { w: 0.8, h: 2.1, from: MAIN, to: HALL }),
    ...pair(g, T(FRAME), T(I.fr), { w: 1.2, h: 2.1, from: MAIN, to: ISLAND }),
    ...pair(g, T(FRAME, Math.PI), T(H.fr, Math.PI), { w: 1.2, h: 2.1, from: MAIN, to: HALL }),
    portal(g, F(0, 1.6, CZ - CL), F(0, 1.6, CZ), { w: 2.4, h: 3.2, from: MAIN, to: MAIN, view: CORR, depth: 'depth' }),
    ...pair(g, ALICE, DOLL, { w: 0.9, h: 2.1, from: MAIN, to: MAIN }),
    portal(g, DIORAMA, FRONT, { w: 0.6, h: 0.21, from: MAIN, to: MAIN, depth: 3, walk: false }),
    portal(g, GEND, GSTART, { w: 3, h: 3, from: MAIN, to: MAIN, view: GRAV, depth: 'depth', onCross: () => twist++ }),
    // walking back out of a turned stretch: its doorway is the end of the stretch before
    portal(g, GSTART.clone().multiply(RY), GEND.clone().multiply(RY), { w: 3, h: 3, from: MAIN, to: MAIN, active: () => twist % 4 !== 0, onCross: () => twist-- }),
  ];
  noInk(g);
  ctx.sound('assets/audio/meadow.mp3', { gain: 0.7, at: [IX, 1, I.cz], ref: 10 });

  const P = { res: 0.8, depth: 6 };
  let U = 1, space = MAIN, rigRef = null, base = null; // base: the rig before the first door
  const lent = [];
  const cameraOf = () => rigRef?.children.find((c) => c.isCamera);
  // entering or leaving VR the engine places the rig itself: whatever doors it went through are forgotten
  const home = () => { base = null; space = MAIN; twist = 0; hadEye.v = false; cameraOf()?.layers.set(MAIN); };
  renderer.xr.addEventListener('sessionend', home);
  renderer.xr.addEventListener('sessionstart', () => { if (base) rigRef.quaternion.identity(); home(); }); // the engine resets position and scale only
  const prevEye = new THREE.Vector3(), eye = new THREE.Vector3(), hadEye = { v: false };
  const tmp = new THREE.Vector3(), l0 = new THREE.Vector3(), l1 = new THREE.Vector3(), frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), bb = new THREE.Box3();
  const full = new THREE.Vector2(), ptLights = [], Gi = new THREE.Matrix4(), Mk = new THREE.Matrix4(), Mw = new THREE.Matrix4(), Fd = new THREE.Matrix4(), keep = new THREE.Vector3(), destW = new THREE.Vector3();
  const on = (p) => p.from === space && (p.active?.() ?? true);
  const levelsOf = (p) => (p.depth === 'depth' ? P.depth : p.depth);
  // map-space M^k -> world: G M^k G^-1
  const worldM = (M, k, out) => { out.identity(); for (let i = 0; i < k; i++) out.premultiply(M); return out.premultiply(g.matrixWorld).multiply(Gi.copy(g.matrixWorld).invert()); };
  const rtFor = (p, i) => {
    const w = Math.max(1, Math.round(full.x * P.res)), h = Math.max(1, Math.round(full.y * P.res));
    let rt = p.rts[i];
    if (!rt) rt = p.rts[i] = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    return rt;
  };

  // walk through a door: the eye's last step crossed its plane inside the opening, front to back
  function cross(camera) {
    camera.getWorldPosition(eye); g.worldToLocal(eye);
    if (!hadEye.v) { prevEye.copy(eye); hadEye.v = true; }
    for (const p of portals) {
      if (!p.walk || !on(p)) continue;
      l0.copy(prevEye).applyMatrix4(p.Fi); l1.copy(eye).applyMatrix4(p.Fi);
      if (!(l0.z >= 0 && l1.z < 0)) continue;
      const hit = tmp.copy(l0).lerp(l1, l0.z / (l0.z - l1.z));
      if (Math.abs(hit.x) > p.w / 2 || Math.abs(hit.y) > p.h / 2) continue;
      const rig = camera.parent;
      rig.updateMatrix(); if (!base) base = rig.matrix.clone();
      rig.matrix.premultiply(worldM(p.M, 1, Mw)).decompose(rig.position, rig.quaternion, rig.scale); rig.updateMatrixWorld(true);
      space = p.to; camera.layers.set(space); p.onCross?.();
      eye.applyMatrix4(p.M);
      break;
    }
    prevEye.copy(eye);
  }

  function render(camera) {
    const xr = renderer.xr.isPresenting;
    let eyes;
    if (xr) {
      renderer.xr.updateCamera(camera); // again: a door may have just moved the rig
      eyes = renderer.xr.getCamera().cameras;
      full.set(Math.max(...eyes.map((e) => e.viewport.x + e.viewport.z)), Math.max(...eyes.map((e) => e.viewport.y + e.viewport.w)));
    } else { camera.updateMatrixWorld(); eyes = [camera]; renderer.getDrawingBufferSize(full); }
    const viewCam = xr ? renderer.xr.getCamera() : camera;
    frustum.setFromProjectionMatrix(pv.multiplyMatrices(viewCam.projectionMatrix, viewCam.matrixWorldInverse));
    viewCam.getWorldPosition(eye); g.worldToLocal(eye);
    const todo = portals.filter((p) => {
      p.mesh.visible = on(p);
      const l = tmp.copy(eye).applyMatrix4(p.Fi);
      // deepen the doorway's box when the eye is about to step through it
      p.mesh.matrix.copy(p.F).multiply(Mk.makeScale(1, 1, l.z > 0 && l.z < 0.6 && Math.abs(l.x) < p.w && Math.abs(l.y) < p.h ? 0.4 : 1e-3));
      p.mesh.updateMatrixWorld();
      const u = p.mesh.material.uniforms;
      u.uP.value.setFromMatrixPosition(p.mesh.matrixWorld); u.uN.value.set(0, 0, 1).transformDirection(p.mesh.matrixWorld); u.uFull.value.copy(full); u.uDim.value = 1;
      return p.mesh.visible && l.z > 0 && frustum.intersectsBox(bb.setFromObject(p.mesh));
    });
    if (!todo.length) return;

    // offscreen: XR off (else three swaps in the eye cameras, see VolumetricSky), one matrix update for every pass
    const prevRT = renderer.getRenderTarget(), xrOn = renderer.xr.enabled, autoShadow = renderer.shadowMap.autoUpdate;
    let root = g; while (root.parent) root = root.parent;
    root.updateMatrixWorld(); const mwa = root.matrixWorldAutoUpdate; root.matrixWorldAutoUpdate = false;
    renderer.xr.enabled = false;
    ptLights.length = 0; root.traverse((o) => { if (o.isPointLight || o.isSpotLight) ptLights.push([o, o.intensity, o.distance]); });
    for (const p of portals) p.mesh.visible = false;

    for (const p of todo) {
      const levels = levelsOf(p);
      // the far door's plane, keeping what lies behind it
      Fd.copy(g.matrixWorld).multiply(p.M).multiply(p.F);
      destW.setFromMatrixPosition(Fd); keep.set(0, 0, -1).transformDirection(Fd);
      vcam.layers.set(p.view);
      renderer.shadowMap.autoUpdate = p.to !== MAIN; // the main room's shadows are this frame's already
      if (levels > 1) p.mesh.visible = true;
      for (let k = levels; k >= 1; k--) {
        const rt = rtFor(p, k % 2), u = p.mesh.material.uniforms;
        u.tView.value = p.rts[(k + 1) % 2]?.texture ?? null; u.uDim.value = 0.86; // the deeper, the darker
        u.uFull.value.set(full.x * P.res, full.y * P.res); // gl_FragCoord is in target pixels here
        worldM(p.M, k, Mk);
        for (const e of eyes) {
          const vp = xr ? e.viewport : q4.set(0, 0, full.x, full.y);
          rt.viewport.set(vp.x * P.res, vp.y * P.res, vp.z * P.res, vp.w * P.res); rt.scissor.copy(rt.viewport); rt.scissorTest = true;
          vcam.matrixWorld.multiplyMatrices(Mk, e.matrixWorld); vcam.matrixWorldInverse.copy(vcam.matrixWorld).invert();
          // view space is f world units per unit (the rig's scale, then the door's), and three lights in view space
          const f = vcam.matrixWorld.getMaxScaleOnAxis();
          for (const [o, i0, d0] of ptLights) { o.intensity = i0 / f ** o.decay; o.distance = d0 / f; }
          vcam.projectionMatrix.copy(e.projectionMatrix);
          if (p.view === p.to) oblique(vcam.projectionMatrix, clipPlane.setFromNormalAndCoplanarPoint(keep, destW).applyMatrix4(vcam.matrixWorldInverse));
          vcam.projectionMatrixInverse.copy(vcam.projectionMatrix).invert();
          renderer.setRenderTarget(rt); renderer.clear(); renderer.render(root, vcam);
        }
      }
      p.mesh.visible = false;
      const u = p.mesh.material.uniforms; u.tView.value = p.rts[1].texture; u.uDim.value = 1; u.uFull.value.copy(full); // level 1 lands in rts[1]
    }

    for (const p of portals) p.mesh.visible = on(p);
    for (const [o, i, d] of ptLights) { o.intensity = i; o.distance = d; }
    renderer.shadowMap.autoUpdate = autoShadow; root.matrixWorldAutoUpdate = mwa;
    renderer.setRenderTarget(prevRT); renderer.xr.enabled = xrOn;
  }

  return {
    group: g,
    look: { exposure: 1.0, amb: ['#f4f0ea', 1.0], key: ['#fff6ea', 1.0], keyDir: new THREE.Vector3(0.3, 1, 0.6), gi: 0.5,
      grade: { tint: [1, 1, 1], sat: 1.05, contrast: 1.03, sepia: 0, vignette: 0.1 }, bloom: 0.35, bloomThreshold: 1.1 },
    interests: () => [{ p: [BOOTH.x, 1.6, BOOTH.z], label: 'booth' }, { p: [FRAME.x, 1.3, FRAME.z], label: 'frame' }, { p: [0, 1.6, CZ - 3], label: 'corridor' },
      { p: [-4.3, 1.2, -3.3], label: 'diorama' }, { p: [-0.8, 0.1, 0.8], label: 'little door' }, { p: [6, 1.5, GZ], label: 'turning corridor' }],
    params: [
      { id: 'res', label: '포털 해상도', doc: 'Resolution of the views through the doors, as a share of the screen (VR: of both eyes). Each visible door costs one more scene render per eye.', min: 0.3, max: 1, step: 0.05, get: () => P.res, set: (x) => { P.res = x; } },
      { id: 'depth', label: '복도 깊이', doc: 'How many times the endless corridors are rendered inside themselves (one scene render per eye each).', type: 'number', min: 1, max: 10, step: 1, get: () => P.depth, set: (x) => { P.depth = Math.round(x); } },
    ],
    async fit(scene, u) {
      U = u; g.scale.setScalar(U);
      for (const [l, I0] of [...gal.lamps, ...H.lamps]) { l.intensity = I0 * U * U; l.distance = (l.userData.d ??= l.distance) * U; }
      const sc = I.sun.shadow.camera; sc.left = sc.bottom = -I.R * U; sc.right = sc.top = I.R * U; sc.near = 1 * U; sc.far = 120 * U; sc.updateProjectionMatrix();
      const sky = await loadSky(renderer, 'assets/polyhaven/hdri/day.hdr', { sat: 1.3 });
      scene.background = sky.tex; scene.environment = sky.env; scene.backgroundIntensity = 1; scene.environmentIntensity = 0.6;
      // the room's lights (the engine's look among them) light the corridors' recursions too
      scene.traverse((o) => { if (o.isLight && o.layers.isEnabled(MAIN) && !o.layers.isEnabled(CORR)) { o.layers.enable(CORR); o.layers.enable(GRAV); lent.push(o); } });
      hadEye.v = false;
    },
    unfit() {
      for (const o of lent) { o.layers.disable(CORR); o.layers.disable(GRAV); }
      lent.length = 0;
      for (const p of portals) { for (const rt of p.rts) rt?.dispose(); p.rts.length = 0; }
      // back to where the rig was before any door, in the gallery
      if (base && rigRef) { base.decompose(rigRef.position, rigRef.quaternion, rigRef.scale); rigRef.updateMatrixWorld(true); }
      home();
    },
    tick(t, { camera }) {
      rigRef = camera.parent;
      gal.knots.forEach((k, i) => { k.rotation.y = t * (0.3 + i * 0.1); k.rotation.x = t * 0.17; });
      H.drift(t);
      if (renderer.xr.isPresenting) renderer.xr.updateCamera(camera); // this frame's head, before checking the doors
      cross(camera);
      render(camera);
    },
  };
}
