// A hedge garden in H² x R: the ground is the hyperbolic plane, up is ordinary. Rooms are right-angled regular
// pentagons, four at every corner (the {5,4} tiling, impossible on a flat floor), with a gap in every hedge.
// In H² x R a geodesic is a hyperbolic geodesic times a straight line, so what you see from a point is exactly
// its log map: a vertex at hyperbolic distance d in direction u, height y, appears at (u d, y). The vertex shader
// does that for every vertex (points kept on the hyperboloid, Lorentz matrices for the tiles and the viewer).
//
// The viewer never really moves: each frame the eye's step is folded into V (hyperboloid -> viewer) and the rig is
// moved back, so the log map is always taken at the eye. Paths therefore compose as hyperbolic motions: walk a
// loop and you come back turned (holonomy). Tiles are regenerated around the room you're in, carrying their colours.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const RC = 5; // curvature radius, metres
const N = 5, ALPHA = Math.PI / 2;
const INR = Math.acosh(Math.cos(ALPHA / 2) / Math.sin(Math.PI / N)); // centre to edge midpoint (0.628)
const CIR = Math.acosh(1 / (Math.tan(Math.PI / N) * Math.tan(ALPHA / 2))); // centre to corner (0.836)
const MID = (i) => Math.PI / 2 + (2 * Math.PI * i) / N; // edge i's midpoint direction; edge 0 faces +z (the door)
const HEDGE = 2.6, GAP = 1.2, DEPTH = 4, MAX_TILES = 500;
export const DOOR_DIST = INR * RC; // tile centre to the door, metres

// --- Lorentz algebra on (X, Y, W), <a,b> = aX bX + aY bY - aW bW; map x <-> X, z <-> Y ---------------------------
const lor = (a, b) => a.x * b.x + a.y * b.y - a.z * b.z;
const rot = (t) => new THREE.Matrix3().set(Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1);
const boostX = (d) => new THREE.Matrix3().set(Math.cosh(d), 0, Math.sinh(d), 0, 1, 0, Math.sinh(d), 0, Math.cosh(d));
/** the hyperbolic translation by v (curvature units, in the X/Y plane) */
const boost = (vx, vy) => { const d = Math.hypot(vx, vy), t = Math.atan2(vy, vx); return rot(t).multiply(boostX(d)).multiply(rot(-t)); };
const polar = (r, t) => new THREE.Vector3(Math.sinh(r) * Math.cos(t), Math.sinh(r) * Math.sin(t), Math.cosh(r));
const geo = (a, b, s) => { const D = Math.acosh(Math.max(1, -lor(a, b))); if (D < 1e-9) return a.clone(); return a.clone().multiplyScalar(Math.sinh((1 - s) * D) / Math.sinh(D)).addScaledVector(b, Math.sinh(s * D) / Math.sinh(D)); };
/** log map at the origin, in metres: hyperboloid point -> (x, z) */
const logm = (p) => { const d = Math.acosh(Math.max(1, p.z)), s = Math.hypot(p.x, p.y); return s < 1e-9 ? [0, 0] : [(p.x / s) * d * RC, (p.y / s) * d * RC]; };
/** Gram-Schmidt in the Lorentz metric: keeps a long product of matrices an isometry */
function renorm(M) {
  const e = M.elements, c = [0, 1, 2].map((i) => new THREE.Vector3(e[i * 3], e[i * 3 + 1], e[i * 3 + 2]));
  c[2].multiplyScalar(1 / Math.sqrt(-lor(c[2], c[2])));
  for (const i of [0, 1]) {
    c[i].addScaledVector(c[2], lor(c[i], c[2]));
    if (i === 1) c[1].addScaledVector(c[0], -lor(c[1], c[0]));
    c[i].multiplyScalar(1 / Math.sqrt(lor(c[i], c[i])));
  }
  c.forEach((v, i) => { e[i * 3] = v.x; e[i * 3 + 1] = v.y; e[i * 3 + 2] = v.z; });
  return M;
}
// crossing edge i: the neighbour's centre is 2 INR out, turned so its own edge i faces back at us
const NEIGH = Array.from({ length: N }, (_, i) => rot(MID(i)).multiply(boostX(2 * INR)).multiply(rot(Math.PI - MID(i))));

// --- one tile, authored on the hyperboloid: per vertex hpos (X, Y, W), height y, kind (0 floor, 1 hedge, 2 stone, 3 glow)
function tileGeometry() {
  const H = [], Y = [], K = [];
  const tri = (a, b, c, ya, yb, yc, k) => { H.push(a, b, c); Y.push(ya, yb, yc); K.push(k, k, k); };
  const corner = (i) => polar(CIR, MID(i) - Math.PI / N);
  const O = new THREE.Vector3(0, 0, 1), SEG = 8, RINGS = 4;
  for (let i = 0; i < N; i++) {
    const a = corner(i), b = corner(i + 1);
    // floor: rings of a fan, subdivided so straight lines in the shader stay close to the true curves
    for (let r = 0; r < RINGS; r++) for (let s = 0; s < SEG; s++) {
      const p = (rr, ss) => geo(O, geo(a, b, ss / SEG), rr / RINGS);
      if (r === 0) tri(p(0, 0), p(1, s), p(1, s + 1), 0, 0, 0, 0);
      else { tri(p(r, s), p(r + 1, s), p(r + 1, s + 1), 0, 0, 0, 0); tri(p(r, s), p(r + 1, s + 1), p(r, s + 1), 0, 0, 0, 0); }
    }
    // the hedge along the edge, with the gap in its middle
    const L = Math.acosh(-lor(a, b)) * RC, g = GAP / 2 / L;
    for (const [s0, s1] of [[0, 0.5 - g], [0.5 + g, 1]]) for (let s = 0; s < 4; s++) {
      const p = geo(a, b, s0 + ((s1 - s0) * s) / 4), q = geo(a, b, s0 + ((s1 - s0) * (s + 1)) / 4);
      tri(p, q, q, 0, 0, HEDGE, 1); tri(p, q, p, 0, HEDGE, HEDGE, 1);
      // caps on the hedge's top, 30 cm wide toward the room centre
      const pi = geo(p, O, 0.3 / RC / Math.acosh(p.z)), qi = geo(q, O, 0.3 / RC / Math.acosh(q.z));
      tri(p, q, qi, HEDGE, HEDGE, HEDGE, 1); tri(p, qi, pi, HEDGE, HEDGE, HEDGE, 1);
    }
  }
  // a stone post with a glowing orb in the middle of each room (authored flat, exp-mapped: it's small)
  const exp = (x, z) => { const r = Math.hypot(x, z) / RC; return polar(r, Math.atan2(z, x)); };
  const addMesh = (g, k) => {
    const p = g.toNonIndexed().attributes.position;
    for (let i = 0; i < p.count; i += 3) tri(exp(p.getX(i), p.getZ(i)), exp(p.getX(i + 1), p.getZ(i + 1)), exp(p.getX(i + 2), p.getZ(i + 2)), p.getY(i), p.getY(i + 1), p.getY(i + 2), k);
  };
  addMesh(new THREE.CylinderGeometry(0.18, 0.25, 1.1, 10).translate(0, 0.55, 0), 2);
  addMesh(new THREE.IcosahedronGeometry(0.22, 1).translate(0, 1.35, 0), 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('hpos', new THREE.Float32BufferAttribute(H.flatMap((v) => [v.x, v.y, v.z]), 3));
  g.setAttribute('position', new THREE.Float32BufferAttribute(Y.flatMap((y) => [0, y, 0]), 3));
  g.setAttribute('kind', new THREE.Float32BufferAttribute(K, 1));
  return g;
}
// the way back: a glowing curtain in the door gap of the room you came in by (just outside it, so the door from the
// gallery, which clips at the doorway, never shows it)
function curtainGeometry() {
  const a = polar(CIR, MID(0) - Math.PI / N), b = polar(CIR, MID(0) + Math.PI / N), L = Math.acosh(-lor(a, b)) * RC, g = GAP / 2 / L;
  const H = [], Y = [];
  for (let s = 0; s < 4; s++) {
    const p = geo(a, b, 0.5 - g + (2 * g * s) / 4), q = geo(a, b, 0.5 - g + (2 * g * (s + 1)) / 4);
    H.push(p, q, q, p, q, p); Y.push(0, 0, 2.2, 0, 2.2, 2.2);
  }
  const out = boost(0, 0.03 / RC); // 3 cm outward
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('hpos', new THREE.Float32BufferAttribute(H.flatMap((v) => { const w = v.clone().applyMatrix3(out); return [w.x, w.y, w.z]; }), 3));
  gg.setAttribute('position', new THREE.Float32BufferAttribute(Y.flatMap((y) => [0, y, 0]), 3));
  gg.setAttribute('kind', new THREE.Float32BufferAttribute(new Array(Y.length).fill(4), 1));
  return gg;
}

const VERT = /* glsl */`
  attribute vec3 hpos, iL0, iL1, iL2, iColor; attribute float kind;
  uniform mat3 uV; uniform vec3 uAnchor; uniform float uRc;
  varying vec3 vLocal, vColor; varying float vKind, vDist;
  void main() {
    vec3 p = uV * mat3(iL0, iL1, iL2) * hpos;
    float d = acosh(max(p.z, 1.0)), s = length(p.xy);
    vec2 t = s > 1e-6 ? p.xy / s * d * uRc : vec2(0.0);
    vLocal = uAnchor + vec3(t.x, position.y, t.y); vColor = iColor; vKind = kind; vDist = d * uRc;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vLocal, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform vec3 uFog, uSun; varying vec3 vLocal, vColor; varying float vKind, vDist;
  void main() {
    vec3 n = normalize(cross(dFdx(vLocal), dFdy(vLocal)));
    vec3 base = vKind < 0.5 ? vColor : vKind < 1.5 ? vec3(0.11, 0.24, 0.10) : vKind < 2.5 ? vec3(0.55, 0.52, 0.47) : vec3(0.0);
    float lit = 0.45 + 0.15 * abs(n.y) + 0.7 * abs(dot(n, uSun));
    vec3 col = base * lit;
    if (vKind > 2.5) col = vKind < 3.5 ? vColor * 6.0 + 1.5 : vec3(2.2, 2.8, 3.6); // the orbs, the way-back curtain
    col = mix(col, uFog, smoothstep(14.0, 30.0, vDist));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** anchor: where tile space is drawn (map metres); layer: camera layer */
export function hyperGarden(g, anchor, layer) {
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide,
    uniforms: { uV: { value: new THREE.Matrix3() }, uAnchor: { value: anchor.clone() }, uRc: { value: RC }, uFog: { value: new THREE.Color('#cfdcef') }, uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() } } });
  mat.userData.outlineParameters = { visible: false };
  const inst = (geom, n) => {
    const ig = new THREE.InstancedBufferGeometry().copy(geom); ig.instanceCount = 0;
    for (const a of ['iL0', 'iL1', 'iL2', 'iColor']) ig.setAttribute(a, new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    const m = new THREE.Mesh(ig, mat); m.frustumCulled = false; m.layers.set(layer); m.userData.noAO = true; g.add(m);
    return m;
  };
  const tiles = inst(tileGeometry(), MAX_TILES), curtain = inst(curtainGeometry(), 1);
  const V = new THREE.Matrix3(), exitT = new THREE.Matrix3(); // viewer: tile space -> viewer; the room you came in by
  let list = [], hue = 0;
  const setInst = (m, i, L, c) => {
    const e = L.elements, at = m.geometry.attributes;
    for (let k = 0; k < 3; k++) at[`iL${k}`].setXYZ(i, e[k * 3], e[k * 3 + 1], e[k * 3 + 2]);
    at.iColor.setXYZ(i, c.r, c.g, c.b);
  };
  const key = (L) => `${Math.round(L.elements[6] * 50)},${Math.round(L.elements[7] * 50)}`; // the tile centre's X, Y
  // all tiles within DEPTH rooms of the one at the origin; colours carried over by position from the last list
  function regenerate(carry = new Map()) {
    const seen = new Map(), out = [], queue = [[new THREE.Matrix3(), 0]];
    while (queue.length && out.length < MAX_TILES) {
      const [L, d] = queue.shift(), k = key(L);
      if (seen.has(k)) continue;
      const color = carry.get(k) ?? new THREE.Color().setHSL((hue = (hue + 0.618034) % 1), 0.45, 0.62);
      seen.set(k, true); out.push({ L, color });
      if (d < DEPTH) for (const Nb of NEIGH) queue.push([L.clone().multiply(Nb), d + 1]);
    }
    out.forEach((t, i) => setInst(tiles, i, t.L, t.color));
    tiles.geometry.instanceCount = out.length;
    for (const a of ['iL0', 'iL1', 'iL2', 'iColor']) tiles.geometry.attributes[a].needsUpdate = true;
    list = out;
  }
  const updateCurtain = () => {
    setInst(curtain, 0, exitT, new THREE.Color(1, 1, 1)); curtain.geometry.instanceCount = 1;
    for (const a of ['iL0', 'iL1', 'iL2']) curtain.geometry.attributes[a].needsUpdate = true;
  };
  const reset = () => { V.identity(); exitT.identity(); regenerate(); updateCurtain(); mat.uniforms.uV.value.copy(V); };
  reset();

  const vi = new THREE.Matrix3(), O = new THREE.Vector3(0, 0, 1), c = new THREE.Vector3();
  return {
    reset,
    /** the eye stepped (dx, dz) metres in the anchor's frame: fold it into V; rebase when you enter another room */
    step(dx, dz) {
      if (dx || dz) V.premultiply(boost(-dx / RC, -dz / RC));
      renorm(V);
      // you: V^-1 O. The room you're in: the nearest centre among this one and its neighbours
      const you = O.clone().applyMatrix3(vi.copy(V).invert());
      let best = null, bd = -lor(you, O);
      for (const Nb of NEIGH) { c.copy(O).applyMatrix3(Nb); const dd = -lor(you, c); if (dd < bd) { bd = dd; best = Nb; } }
      if (best) { // that room becomes the origin: everything is re-expressed in its frame
        const Bi = best.clone().invert(), carry = new Map(list.map((t) => [key(Bi.clone().multiply(t.L)), t.color]));
        V.multiply(best); exitT.premultiply(Bi); renorm(V); renorm(exitT);
        regenerate(carry); updateCurtain();
      }
      mat.uniforms.uV.value.copy(V);
    },
    /** where you stand in the room you came in by: [x, z] metres from its centre, and how you're turned (rad) */
    inEntry() {
      const Q = exitT.clone().invert().multiply(vi.copy(V).invert()), p = O.clone().applyMatrix3(Q), [x, z] = logm(p);
      const R = boost(x / RC, z / RC).invert().multiply(Q), phi = Math.atan2(R.elements[1], R.elements[0]);
      return { x, z, phi, near: -lor(p, O) < Math.cosh(1.5 * INR) };
    },
  };
}
