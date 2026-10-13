// A small planet in S² x R: the ground is a sphere 25 m around, up is ordinary. Light runs round it, so every
// thing is seen twice: the short way (direction u, distance d) and the long way round (direction -u, 2πR - d).
// The torii ahead also stands behind you; your own back is ahead of you, 25 m off but as large as if it were
// at arm's length (rays from you spread round the sphere and meet again at you). Drawn like the hyperbolic garden:
// points on the unit sphere, the log map at the eye in the vertex shader, once per image; steps folded into V.
import * as THREE from 'three';

const R = 4, TAU = Math.PI * 2;
export const SDOOR = 1.5; // the way back: a frame 1.5 m from where you arrive, facing +z

// --- SO(3) on (X, Y, Z), the pole (0, 0, 1) being where you stand; map x <-> X, z <-> Y --------------------------
const rotZ = (t) => new THREE.Matrix3().set(Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1);
const tiltX = (d) => new THREE.Matrix3().set(Math.cos(d), 0, Math.sin(d), 0, 1, 0, -Math.sin(d), 0, Math.cos(d));
/** the rotation carrying the pole along a great circle by v (radians, in the X/Y plane) */
const move = (vx, vy) => { const d = Math.hypot(vx, vy), t = Math.atan2(vy, vx); return rotZ(t).multiply(tiltX(d)).multiply(rotZ(-t)); };
const expm = (x, z) => new THREE.Vector3(0, 0, 1).applyMatrix3(move(x / R, z / R)); // tangent metres at the pole -> sphere
const logm = (p) => { const d = Math.acos(THREE.MathUtils.clamp(p.z, -1, 1)), s = Math.hypot(p.x, p.y); return s < 1e-9 ? [0, 0] : [(p.x / s) * d * R, (p.y / s) * d * R]; };
function renorm(M) { // Gram-Schmidt: keep a long product of rotations a rotation
  const e = M.elements, c = [0, 1, 2].map((i) => new THREE.Vector3(e[i * 3], e[i * 3 + 1], e[i * 3 + 2]));
  c[0].normalize(); c[1].addScaledVector(c[0], -c[1].dot(c[0])).normalize(); c[2].crossVectors(c[0], c[1]);
  c.forEach((v, i) => { e[i * 3] = v.x; e[i * 3 + 1] = v.y; e[i * 3 + 2] = v.z; });
  return M;
}

// --- geometry: per vertex spos (unit sphere), height y, kind (0 ground, 1 stone, 2 red, 3 glow, 4 way back, 5 you) --
function build(parts) {
  const S = [], Y = [], K = [];
  for (const [geom, kind, at = [0, 0], yaw = 0] of parts) {
    const p = geom.toNonIndexed().attributes.position, T = move(at[0] / R, at[1] / R), c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) * c + p.getZ(i) * s, z = -p.getX(i) * s + p.getZ(i) * c;
      S.push(expm(x, z).applyMatrix3(T)); Y.push(p.getY(i)); K.push(kind);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('spos', new THREE.Float32BufferAttribute(S.flatMap((v) => [v.x, v.y, v.z]), 3));
  g.setAttribute('position', new THREE.Float32BufferAttribute(Y.flatMap((y) => [0, y, 0]), 3));
  g.setAttribute('kind', new THREE.Float32BufferAttribute(K, 1));
  return g;
}
function ground() { // the whole sphere, finely cut so straight edges stay close to the true curves near the antipode
  const ico = new THREE.IcosahedronGeometry(1, 40).toNonIndexed(), p = ico.attributes.position;
  const S = [];
  for (let i = 0; i < p.count; i++) S.push(p.getX(i), p.getZ(i), p.getY(i)); // its +y is our pole
  const g = new THREE.BufferGeometry();
  g.setAttribute('spos', new THREE.Float32BufferAttribute(S, 3));
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(p.count * 3), 3));
  g.setAttribute('kind', new THREE.Float32BufferAttribute(new Float32Array(p.count), 1));
  return g;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d, Math.ceil(w / 0.3), 1, Math.ceil(d / 0.3)).translate(x, y, z);
const cyl = (r, h, y = 0, s = 12) => new THREE.CylinderGeometry(r, r, h, s).translate(0, y + h / 2, 0);
function lantern() { return [box(0.5, 0.15, 0.5, 0, 0.075, 0), cyl(0.09, 0.8, 0.15), box(0.42, 0.32, 0.42, 0, 1.11, 0), new THREE.ConeGeometry(0.42, 0.3, 4).rotateY(Math.PI / 4).translate(0, 1.42, 0)]; }
function torii() { return [cyl(0.12, 3.2).translate(-1.3, 0, 0), cyl(0.12, 3.2).translate(1.3, 0, 0), box(3.1, 0.16, 0.16, 0, 2.7, 0), box(3.6, 0.2, 0.3, 0, 3.25, 0)]; }
function frame() { const w = 1.2, h = 2.2, t = 0.12; return [box(t, h + t, t, -w / 2 - t / 2, (h + t) / 2, 0), box(t, h + t, t, w / 2 + t / 2, (h + t) / 2, 0), box(w + 2 * t, t, t, 0, h + t / 2, 0)]; }
function you() { // a plain figure: head at eye height, body below, built in the eye's frame (its back toward +z)
  return [new THREE.SphereGeometry(0.12, 24, 16).translate(0, 1.6, 0), new THREE.CapsuleGeometry(0.17, 0.75, 8, 20).translate(0, 1.0, 0.02),
    new THREE.SphereGeometry(0.05, 12, 8).translate(0, 1.66, 0.11)]; // a bun on the back of the head, so you know which side you're seeing
}

const VERT = /* glsl */`
  attribute vec3 spos; attribute float kind;
  uniform mat3 uV; uniform vec3 uAnchor; uniform float uR, uLift, uNear, uFarCut;
  varying vec3 vLocal; varying float vKind, vDist, vBad, vH;
  void main() {
    vec3 p = uV * spos;
    float a = acos(clamp(p.z, -1.0, 1.0)), s = length(p.xy);
    vec2 u = s > 1e-6 ? p.xy / s : vec2(0.0, 1.0);
    // a triangle astride the antipode, or (the long way) astride the eye, has corners in opposite directions:
    // drop it (it would be stretched across the sky)
    vBad = (a > 3.14159265 - uFarCut || a < uNear) ? 1.0 : 0.0;
  #if IMAGE == 1
    a = 6.28318531 - a; u = -u;
  #endif
    float d = a * uR;
    vLocal = uAnchor + vec3(u.x * d, position.y + uLift, u.y * d); vKind = kind; vDist = d; vH = position.y;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vLocal, 1.0);
  }`;
const FRAG = /* glsl */`
  uniform vec3 uFog, uSun, uWho; uniform float uFogFar; varying vec3 vLocal; varying float vKind, vDist, vBad, vH;
  void main() {
    if (vBad > 0.001) discard;
    vec3 n = normalize(cross(dFdx(vLocal), dFdy(vLocal)));
    vec3 base = vKind < 0.5 ? vec3(0.26, 0.42, 0.18) : vKind < 1.5 ? vec3(0.56, 0.54, 0.5) : vKind < 2.5 ? vec3(0.75, 0.12, 0.07) : vKind < 4.5 ? vec3(0.0) : uWho;
    vec3 col = base * (0.45 + 0.15 * abs(n.y) + 0.7 * abs(dot(n, uSun)));
    if (vKind > 2.5 && vKind < 3.5) col = vec3(3.0, 2.2, 1.2); // lantern light
    if (vKind > 3.5 && vKind < 4.5) col = vec3(2.2, 2.8, 3.6); // the way back
    col = mix(col, uFog, smoothstep(uFogFar * 0.8, uFogFar, vDist));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** anchor: where the pole is drawn (map metres); layer: camera layer */
export function smallPlanet(g, anchor, layer) {
  const shared = { uV: { value: new THREE.Matrix3() }, uAnchor: { value: anchor.clone() }, uR: { value: R }, uFog: { value: new THREE.Color('#d9e4f2') },
    uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() }, uWho: { value: new THREE.Color('#e8e2f0') }, uFogFar: { value: TAU * R * 1.6 } }; // fog only past the second images
  const mats = [];
  const mesh = (geom, { near = 0.05, farCut = 0.06, own = {} } = {}) => [0, 1].map((img) => {
    const m = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, side: THREE.DoubleSide, defines: { IMAGE: img },
      uniforms: { ...shared, uLift: { value: 0 }, uNear: { value: img ? near : -1 }, uFarCut: { value: farCut }, ...own } });
    m.userData.outlineParameters = { visible: false }; mats.push(m);
    const o = new THREE.Mesh(geom, m); o.frustumCulled = false; o.layers.set(layer); o.userData.noAO = true; g.add(o);
    return o;
  });
  // a ring of lanterns round where you arrive; a torii 6 m ahead and one 7 m behind, each also seen the long way round
  const parts = [];
  for (let i = 0; i < 8; i++) { const t = (i / 8) * TAU + 0.2; for (const p of lantern()) parts.push([p, 1, [Math.cos(t) * 3.2, Math.sin(t) * 3.2], -t]); parts.push([box(0.3, 0.24, 0.3, 0, 1.11, 0), 3, [Math.cos(t) * 3.2, Math.sin(t) * 3.2], -t]); }
  for (const z of [-6, 7]) for (const p of torii()) parts.push([p, 2, [0, z]]);
  for (const p of frame()) parts.push([p, 1, [0, SDOOR]]);
  parts.push([new THREE.PlaneGeometry(1.2, 2.2, 6, 10).translate(0, 1.1, 0), 4, [0, SDOOR]]);
  for (let i = 0; i < 3; i++) parts.push([new THREE.CylinderGeometry(0, 0.9, 2.6, 10, 4).translate(0, 1.9, 0), 0, [5 * Math.cos(2 + i * 2.1), 5 * Math.sin(2 + i * 2.1)]], [cyl(0.12, 0.6), 1, [5 * Math.cos(2 + i * 2.1), 5 * Math.sin(2 + i * 2.1)]]);
  // near / farCut: radians from the eye / the antipode within which a triangle (a few edges long) is dropped
  mesh(ground(), { near: 0.06, farCut: 0.04 });
  mesh(build(parts), { near: 0.1, farCut: 0.1 });
  // you: only the long way round (the short way, you're inside your own head)
  const youMats = mesh(build(you().map((p) => [p, 5])), { near: 0.01, farCut: 0.02, own: { uV: { value: new THREE.Matrix3() } } });
  youMats[0].visible = false;

  const V = shared.uV.value, O = new THREE.Vector3(0, 0, 1), vi = new THREE.Matrix3();
  return {
    reset() { V.identity(); },
    /** the eye stepped (dx, dz) metres; yaw: which way you face (rad, about up); lift: your eye height - 1.6 m */
    step(dx, dz, yaw, lift) {
      if (dx || dz) V.premultiply(move(-dx / R, -dz / R));
      renorm(V);
      // your figure stands where you are, facing where you face
      youMats[1].material.uniforms.uV.value.copy(rotZ(-yaw)); youMats[1].material.uniforms.uLift.value = lift;
    },
    /** where you stand from the arrival point: [x, z] metres, and how the walk has turned you (rad) */
    where() {
      const Q = vi.copy(V).invert(), p = O.clone().applyMatrix3(Q), [x, z] = logm(p);
      const Rm = move(x / R, z / R).invert().multiply(Q), phi = Math.atan2(Rm.elements[1], Rm.elements[0]);
      return { x, z, phi, near: p.z > Math.cos(3 / R) };
    },
  };
}
