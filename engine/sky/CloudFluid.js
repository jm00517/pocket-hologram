// Cloud coverage as a fluid: 2D stable fluids (Stam) on the GPU over a periodic S x S metre domain centred on the eye.
//   velocity (m/s): relaxes toward the wind, stirred by drifting curl noise, swirls kept alive by vorticity
//                   confinement, made divergence-free each step (Jacobi pressure solve)
//   water (0..1):   carried by the flow; condenses toward a humidity field that drifts with the mean wind and
//                   slowly evolves, evaporates where the air is dry -> clouds bunch up, stretch, tear and dissolve
// Read it as coverage: texture(fluid.texture, xz / S + 0.5).r.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const HEAD = /* glsl */`
  precision highp sampler3D;
  uniform sampler2D tVel, tWater, tP, tDiv, tCurl; uniform sampler3D tNoise;
  uniform float uTexel, uH, uDt, uS, uTime;
  varying vec2 vUv;
  vec4 at(sampler2D t, float dx, float dy) { return texture2D(t, vUv + vec2(dx, dy) * uTexel); }
`;
const SHADERS = {
  advectVel: `void main(){ vec2 v = texture2D(tVel, vUv).xy; gl_FragColor = vec4(texture2D(tVel, vUv - v * uDt / uS).xy, 0.0, 1.0); }`,
  curl: `void main(){ gl_FragColor = vec4(((at(tVel,1.,0.).y - at(tVel,-1.,0.).y) - (at(tVel,0.,1.).x - at(tVel,0.,-1.).x)) / (2.0 * uH), 0.0, 0.0, 1.0); }`,
  force: `uniform vec2 uWindV, uStirOff; uniform float uRelax, uConf, uStir;
    float psi(vec2 uv) { return texture(tNoise, vec3(uv * 3.0 + uStirOff, uTime * 0.0006)).r; }
    void main(){
      vec2 v = texture2D(tVel, vUv).xy;
      // target flow = wind + divergence-free stirring (curl of a drifting scalar, ~uStir m/s)
      float e = uTexel * 2.0;
      vec2 dpsi = vec2(psi(vUv + vec2(e, 0.0)) - psi(vUv - vec2(e, 0.0)), psi(vUv + vec2(0.0, e)) - psi(vUv - vec2(0.0, e))) / (2.0 * e);
      vec2 target = uWindV + vec2(dpsi.y, -dpsi.x) * 0.028 * uStir;
      v += (target - v) * (1.0 - exp(-uDt / uRelax));
      float c = texture2D(tCurl, vUv).x;                                     // vorticity confinement
      vec2 g = vec2(abs(at(tCurl,1.,0.).x) - abs(at(tCurl,-1.,0.).x), abs(at(tCurl,0.,1.).x) - abs(at(tCurl,0.,-1.).x));
      g /= length(g) + 1e-6;
      v += uConf * uH * vec2(g.y, -g.x) * c * uDt;
      gl_FragColor = vec4(v, 0.0, 1.0);
    }`,
  div: `void main(){ gl_FragColor = vec4(((at(tVel,1.,0.).x - at(tVel,-1.,0.).x) + (at(tVel,0.,1.).y - at(tVel,0.,-1.).y)) / (2.0 * uH), 0.0, 0.0, 1.0); }`,
  jacobi: `void main(){ gl_FragColor = vec4((at(tP,-1.,0.).x + at(tP,1.,0.).x + at(tP,0.,-1.).x + at(tP,0.,1.).x - texture2D(tDiv, vUv).x * uH * uH) * 0.25, 0.0, 0.0, 1.0); }`,
  project: `void main(){ vec2 v = texture2D(tVel, vUv).xy - vec2(at(tP,1.,0.).x - at(tP,-1.,0.).x, at(tP,0.,1.).x - at(tP,0.,-1.).x) / (2.0 * uH);
    gl_FragColor = vec4(v, 0.0, 1.0); }`,
  water: `uniform vec2 uHumOff; uniform float uHumT, uTau, uInit;
    void main(){
      vec2 v = texture2D(tVel, vUv).xy;
      float d = texture2D(tWater, vUv - v * uDt / uS).r;
      // humidity: large-scale, drifting with the mean wind, evolving slowly
      float hum = texture(tNoise, vec3(vUv * 2.0 + uHumOff, 0.37 + uTime * 0.00025)).r * 0.7 + texture(tNoise, vec3(vUv * 5.0 + uHumOff * 2.5, 0.81 - uTime * 0.0004)).r * 0.3;
      float target = mix(0.25, 0.95, smoothstep(uHumT - 0.18, uHumT + 0.18, hum)); // coverage, not on/off: shape noise does the edges
      d = uInit > 0.5 ? target : d + (target - d) * (1.0 - exp(-uDt / uTau));
      gl_FragColor = vec4(d, 0.0, 0.0, 1.0);
    }`,
};

export function createCloudFluid(renderer, { N = 256, S = 32000, noise } = {}) {
  const rt = () => new THREE.WebGLRenderTarget(N, N, { type: THREE.HalfFloatType, depthBuffer: false, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const pair = () => { const p = { a: rt(), b: rt(), swap() { [p.a, p.b] = [p.b, p.a]; } }; return p; };
  const vel = pair(), water = pair(), pres = pair(), div = rt(), curl = rt();
  const U = {
    tVel: { value: null }, tWater: { value: null }, tP: { value: null }, tDiv: { value: div.texture }, tCurl: { value: curl.texture }, tNoise: { value: noise },
    uTexel: { value: 1 / N }, uH: { value: S / N }, uDt: { value: 0 }, uS: { value: S }, uTime: { value: 0 },
    uWindV: { value: new THREE.Vector2() }, uStirOff: { value: new THREE.Vector2() }, uRelax: { value: 400 }, uConf: { value: 0.35 }, uStir: { value: 6 },
    uHumOff: { value: new THREE.Vector2() }, uHumT: { value: 0.45 }, uTau: { value: 240 }, uInit: { value: 1 },
  };
  const quads = Object.fromEntries(Object.entries(SHADERS).map(([k, f]) => [k, new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: HEAD + f, depthTest: false, depthWrite: false }))]));
  const pass = (name, target) => { renderer.setRenderTarget(target); quads[name].render(renderer); };
  const windOff = new THREE.Vector2();
  let t = 0;
  return {
    S, uniforms: U,
    get texture() { return water.a.texture; },
    /** offset (m) the mean wind has carried things so far: shift detail noise by it so it rides along */
    windOffset: windOff,
    /** dt: sim seconds. wind: THREE.Vector3 m/s. cover: 0..1 share of sky that wants to be cloud. */
    step(dt, wind, { cover = 0.6, stir = 6, conf = 0.35, tau = 240 } = {}) {
      dt = Math.min(dt, 2); t += dt;
      windOff.x += wind.x * dt; windOff.y += wind.z * dt;
      U.uDt.value = dt; U.uTime.value = t;
      U.uWindV.value.set(wind.x, wind.z); U.uStir.value = stir; U.uConf.value = conf; U.uTau.value = tau;
      U.uHumT.value = 0.78 - cover * 0.4; // humidity noise sits around 0.58 U.uHumOff.value.set(-windOff.x / S * 2, -windOff.y / S * 2);
      U.uStirOff.value.set(-windOff.x / S * 3, -windOff.y / S * 3);
      const prev = renderer.getRenderTarget();
      U.tVel.value = vel.a.texture; pass('advectVel', vel.b); vel.swap();
      U.tVel.value = vel.a.texture; pass('curl', curl);
      pass('force', vel.b); vel.swap();
      U.tVel.value = vel.a.texture; pass('div', div);
      for (let i = 0; i < 20; i++) { U.tP.value = pres.a.texture; pass('jacobi', pres.b); pres.swap(); }
      U.tP.value = pres.a.texture; pass('project', vel.b); vel.swap();
      U.tVel.value = vel.a.texture; U.tWater.value = water.a.texture; pass('water', water.b); water.swap();
      U.uInit.value = 0;
      renderer.setRenderTarget(prev);
    },
    reset() { U.uInit.value = 1; },
    /** debug: { water: [min, mean, max], speed: [min, mean, max] m/s } (GPU readback, slow) */
    stats() {
      const read = (t) => { const b = new Uint16Array(N * N * 4); renderer.readRenderTargetPixels(t, 0, 0, N, N, b); return b; };
      const sum = (b, f) => { let lo = Infinity, hi = -Infinity, m = 0; for (let i = 0; i < N * N; i++) { const v = f(b, i * 4); lo = Math.min(lo, v); hi = Math.max(hi, v); m += v; } return [lo, m / (N * N), hi].map((x) => +x.toFixed(3)); };
      const h = THREE.DataUtils.fromHalfFloat;
      return { water: sum(read(water.a), (b, i) => h(b[i])), speed: sum(read(vel.a), (b, i) => Math.hypot(h(b[i]), h(b[i + 1]))) };
    },
  };
}
