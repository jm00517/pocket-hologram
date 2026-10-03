// Sky lab (하늘 실험실): an empty plain under a raymarched cloud deck, for working on the sky alone.
// Clouds: a stratocumulus slab of 3D noise (Perlin-Worley shape, Worley detail), marched per pixel at half
// resolution with a short march toward the sun for self-shadowing. A strong forward-scattering lobe makes the
// thin edges near the sun glow (silver lining). Crepuscular rays: the clouds' transmittance toward the sun is
// baked into a top-down shadow map each frame, and the haze between the eye and the clouds is marched against
// it, so the columns of air lit through a gap show up as rays. The sun hides behind a bank with a ragged gap
// a few km nearer the horizon, the way it does in the reference photo.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// --- tileable 3D noise: R = Perlin-Worley (shape), G = Worley fbm (erosion detail) -----------------------------
function cloudNoise(N = 64) {
  let s = 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const worley = (P) => {
    const pts = Float32Array.from({ length: P * P * P * 3 }, rnd);
    return (x, y, z) => {
      const fx = x * P, fy = y * P, fz = z * P, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      let d = 9;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx, cy = iy + dy, cz = iz + dz, c = ((((cz % P) + P) % P) * P + (((cy % P) + P) % P)) * P + (((cx % P) + P) % P);
        const ox = cx + pts[c * 3] - fx, oy = cy + pts[c * 3 + 1] - fy, oz = cz + pts[c * 3 + 2] - fz, q = ox * ox + oy * oy + oz * oz;
        if (q < d) d = q;
      }
      return Math.max(0, 1 - Math.sqrt(d));
    };
  };
  const value = (P) => {
    const v = Float32Array.from({ length: P * P * P }, rnd), at = (x, y, z) => v[(((z + P) % P) * P + ((y + P) % P)) * P + ((x + P) % P)];
    const sm = (t) => t * t * (3 - 2 * t), lerp = (a, b, t) => a + (b - a) * t;
    return (x, y, z) => {
      const fx = x * P, fy = y * P, fz = z * P, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      const tx = sm(fx - ix), ty = sm(fy - iy), tz = sm(fz - iz);
      return lerp(lerp(lerp(at(ix, iy, iz), at(ix + 1, iy, iz), tx), lerp(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), tx), ty),
        lerp(lerp(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), tx), lerp(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), tx), ty), tz);
    };
  };
  const [w4, w8, w16, w32] = [4, 8, 16, 32].map(worley), [v4, v8, v16, v32] = [4, 8, 16, 32].map(value);
  const raw = new Float32Array(N * N * N * 2);
  for (let z = 0, i = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++, i++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N, w = (z + 0.5) / N;
    const wf = w4(u, v, w) * 0.625 + w8(u, v, w) * 0.25 + w16(u, v, w) * 0.125;
    const pf = (v4(u, v, w) * 0.5 + v8(u, v, w) * 0.25 + v16(u, v, w) * 0.125 + v32(u, v, w) * 0.0625) / 0.9375;
    const shape = Math.min(1, Math.max(0, (pf - (wf - 1)) / (2 - wf))); // remap(perlin, worley - 1, 1, 0, 1)
    const detail = w8(u, v, w) * 0.625 + w16(u, v, w) * 0.25 + w32(u, v, w) * 0.125;
    raw[i * 2] = shape; raw[i * 2 + 1] = detail;
  }
  // stretch each channel to the full byte range: the raw fbm bunches up around its mean
  const data = new Uint8Array(raw.length);
  for (let c = 0; c < 2; c++) {
    let lo = 1, hi = 0;
    for (let i = c; i < raw.length; i += 2) { lo = Math.min(lo, raw[i]); hi = Math.max(hi, raw[i]); }
    for (let i = c; i < raw.length; i += 2) data[i] = ((raw[i] - lo) / (hi - lo)) * 255;
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGFormat; t.type = THREE.UnsignedByteType; t.unpackAlignment = 1;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

// --- shared GLSL: the cloud field, in metres around the eye (eye at the origin, 2 m up) -------------------------
const COMMON = /* glsl */`
  precision highp sampler3D;
  uniform sampler3D tNoise;
  uniform vec2 uWind, uHole, uSunSpot;
  uniform vec3 uSun;
  uniform float uCover, uDensity, uHoleR, uBase, uThick, uTime;
  float density(vec3 p, bool detail) {
    float h = (p.y - uBase) / uThick;
    if (h <= 0.0 || h >= 1.0) return 0.0;
    vec3 q = p + vec3(uWind.x, 0.0, uWind.y);
    float cov = smoothstep(0.25, 0.75, texture(tNoise, vec3(q.xz / 16000.0, 0.31)).r) * 0.55 + uCover;
    cov = max(cov, 0.97 * (1.0 - smoothstep(0.55, 1.0, length(p.xz - uSunSpot) / 2000.0))); // bank over the sun
    float hn = texture(tNoise, vec3(p.xz / 1300.0, 0.73)).g;
    cov *= smoothstep(0.5, 1.1, length(p.xz - uHole) / uHoleR + (hn - 0.5) * 1.1);            // the ragged gap
    cov = clamp(cov, 0.0, 1.0);
    float prof = smoothstep(0.0, 0.2, h) * smoothstep(1.0, 0.45, h);
    float shape = texture(tNoise, vec3(q.x / 3400.0, q.z / 3400.0, q.y / 2600.0)).r * prof;
    float d = clamp((shape - (1.0 - cov)) / max(cov, 0.05), 0.0, 1.0) * cov;
    if (detail && d > 0.0) {
      float det = texture(tNoise, vec3(q.x / 700.0, q.z / 700.0, q.y / 700.0 + uTime * 0.004)).g;
      d = clamp(d - (1.0 - det) * 0.32 * (1.0 - d * 0.7), 0.0, 1.0);
    }
    return d * uDensity;
  }
  float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
`;
const SIG = '0.035'; // extinction per metre at density 1

const shadowShader = {
  uniforms: {}, // filled from the shared uniform object
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`${COMMON}
    uniform float uShadowSpan; varying vec2 vUv;
    void main() {
      vec3 p = vec3((vUv.x - 0.5) * uShadowSpan, uBase, (vUv.y - 0.5) * uShadowSpan);
      float L = uThick / max(uSun.y, 0.05), dt = L / 16.0, od = 0.0;
      p += uSun * dt * 0.5;
      for (int i = 0; i < 16; i++) { od += density(p, false) * dt; p += uSun * dt; }
      gl_FragColor = vec4(exp(-od * ${SIG}), 0.0, 0.0, 1.0);
    }`,
};

const skyShader = {
  uniforms: {},
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: /* glsl */`${COMMON}
    uniform mat4 uInvProj, uCamRot;
    uniform sampler2D tShadow;
    uniform float uShadowSpan, uHaze, uSkyGain, uRayGain, uFrame, uBlend;
    uniform sampler2D tHistory; uniform mat4 uPrevViewProj;
    uniform vec3 uSunCol, uAmbHigh, uAmbLow, uZenith, uHorizon, uGround;
    varying vec2 vUv;
    float shadowAt(vec3 p) {
      if (p.y >= uBase) return 1.0;
      vec2 uv = (p.xz + uSun.xz * ((uBase - p.y) / uSun.y)) / uShadowSpan + 0.5;
      return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.08 : texture2D(tShadow, uv).r;
    }
    vec3 skyBg(vec3 d, float mu) {
      vec3 c = mix(uZenith, uHorizon, pow(1.0 - max(d.y, 0.0), 5.0));
      c += uSunCol * 0.012 * hg(mu, 0.8);
      c += uSunCol * 60.0 * smoothstep(0.99985, 0.99996, mu);
      return c * uSkyGain;
    }
    void main() {
      vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
      vec3 dir = normalize((uCamRot * vec4(v.xyz / v.w, 0.0)).xyz);
      vec3 o = vec3(0.0, 2.0, 0.0);
      float mu = dot(dir, uSun), j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.618034);
      float tGround = dir.y < 0.0 ? o.y / -dir.y : 1e9, tCloud = dir.y > 0.0 ? (uBase - o.y) / dir.y : 1e9;
      vec3 bg = dir.y < 0.0
        ? uGround * (uAmbHigh * 0.5 + uSunCol * max(uSun.y, 0.0) * 0.1 * shadowAt(o + dir * min(tGround, 40000.0)))
        : skyBg(dir, mu);

      // clouds
      vec3 cc = vec3(0.0); float Tc = 1.0;
      if (dir.y > 0.015 && tCloud < 70000.0) {
        float t1 = min((uBase + uThick - o.y) / dir.y, tCloud + 14000.0), dt = (t1 - tCloud) / 48.0, t = tCloud + dt * j;
        float ph = mix(hg(mu, -0.15), hg(mu, 0.85), 0.62), ph2 = mix(hg(mu, -0.1), hg(mu, 0.45), 0.5);
        for (int i = 0; i < 48; i++) {
          vec3 p = o + dir * t;
          float d = density(p, true);
          if (d > 0.003) {
            float od = 0.0, ls = 50.0; vec3 lp = p;
            for (int k = 0; k < 5; k++) { lp += uSun * ls; od += density(lp, false) * ls; ls *= 1.9; }
            float h = (p.y - uBase) / uThick;
            vec3 lum = uSunCol * (exp(-od * ${SIG}) * ph + 0.35 * exp(-od * ${SIG} * 0.2) * ph2) + mix(uAmbLow, uAmbHigh, h);
            float ext = max(${SIG} * d, 1e-6), tr = exp(-ext * dt);
            cc += Tc * lum * (1.0 - tr);
            Tc *= tr;
            if (Tc < 0.01) { Tc = 0.0; break; }
          }
          t += dt;
        }
        float f = exp(-tCloud / 28000.0); // far clouds melt into the horizon haze
        cc = mix(uHorizon * uSkyGain * (1.0 - Tc), cc, f);
      }

      // haze in front of the clouds; its sunlit columns are the rays
      float tEnd = min(min(tGround, tCloud), 40000.0), Ta = 1.0, prev = 0.0;
      vec3 ins = vec3(0.0);
      float phA = mix(hg(mu, 0.0), hg(mu, 0.76), 0.75);
      for (int i = 0; i < 28; i++) {
        float t = tEnd * pow((float(i) + j) / 28.0, 2.0), dt = t - prev; prev = t;
        vec3 p = o + dir * t;
        float beta = uHaze * exp(-p.y / 1400.0);
        ins += Ta * (uSunCol * shadowAt(p) * phA * uRayGain + uAmbHigh * 0.09) * beta * dt;
        Ta *= exp(-beta * dt);
      }
      vec3 col = ins + Ta * (cc + Tc * bg);
      // temporal accumulation: the sky is at infinity, so last frame's pixel for this direction is exact
      vec4 pc = uPrevViewProj * vec4(dir, 0.0);
      vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
      if (pc.w > 0.0 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0) col = mix(col, texture2D(tHistory, puv).rgb, uBlend);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createSkyLab(renderer) {
  const g = new THREE.Group(); g.name = 'skylab'; g.visible = false;
  const P = { // tunables (slider-backed)
    elev: 18, azim: 15, cover: 0.42, density: 1.0, haze: 3.5, rays: 2.5, sun: 26, holeAhead: 2.2, holeR: 900, base: 1500, thick: 900, wind: 9, skyGain: 1,
  };
  const U = {
    tNoise: { value: null }, uWind: { value: new THREE.Vector2() }, uHole: { value: new THREE.Vector2() }, uSunSpot: { value: new THREE.Vector2() },
    uSun: { value: new THREE.Vector3() }, uCover: { value: 0 }, uDensity: { value: 1 }, uHoleR: { value: 600 }, uBase: { value: 1500 }, uThick: { value: 900 }, uTime: { value: 0 },
    uShadowSpan: { value: 34000 }, tShadow: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix4() },
    uHaze: { value: 1e-5 }, uSkyGain: { value: 1 }, uRayGain: { value: 1 }, uFrame: { value: 0 }, uBlend: { value: 0 },
    tHistory: { value: null }, uPrevViewProj: { value: new THREE.Matrix4() },
    uSunCol: { value: new THREE.Color() }, uAmbHigh: { value: new THREE.Color(0.62, 0.68, 0.8) }, uAmbLow: { value: new THREE.Color(0.2, 0.22, 0.26) },
    uZenith: { value: new THREE.Color(0.16, 0.34, 0.78) }, uHorizon: { value: new THREE.Color(0.6, 0.68, 0.78) }, uGround: { value: new THREE.Color(0.12, 0.14, 0.11) },
  };
  const shadowRT = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, depthBuffer: false });
  let skyRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }), histRT = skyRT.clone();
  U.tShadow.value = shadowRT.texture;
  const quad = (sh) => new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: U, vertexShader: sh.vertexShader, fragmentShader: sh.fragmentShader, depthTest: false, depthWrite: false }));
  const shadowQuad = quad(shadowShader), skyQuad = quad(skyShader);

  // the dome shows the half-res sky behind everything; other cameras (GI probe) get a flat overcast stand-in
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    uniforms: { tSky: { value: skyRT.texture }, uRes: { value: new THREE.Vector2(1, 1) }, uDirect: { value: 1 }, uAmbHigh: U.uAmbHigh, uAmbLow: U.uAmbLow },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = (projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0)).xyww; }',
    fragmentShader: `uniform sampler2D tSky; uniform vec2 uRes; uniform float uDirect; uniform vec3 uAmbHigh, uAmbLow; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir);
        gl_FragColor = vec4(uDirect > 0.5 ? mix(uAmbLow, uAmbHigh * 1.4, smoothstep(-0.2, 0.4, d.y)) : texture2D(tSky, gl_FragCoord.xy / uRes).rgb, 1.0); }`,
    side: THREE.BackSide, depthWrite: false,
  }));
  dome.frustumCulled = false; dome.renderOrder = -1e6; dome.userData.noAO = true;
  dome.material.userData.outlineParameters = { visible: false };
  let mainCam = null;
  dome.onBeforeRender = (r, s, cam) => { dome.material.uniforms.uDirect.value = cam === mainCam ? 0 : 1; };
  g.add(dome);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(2000, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#6f7a62', roughness: 1 }));
  ground.receiveShadow = true; ground.material.userData.outlineParameters = { visible: false }; g.add(ground);
  const sun = new THREE.DirectionalLight('#fff2e0', 0.5);
  sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  const target = new THREE.Object3D(); sun.target = target;
  const fill = new THREE.HemisphereLight('#c8d2e2', '#4a4f44', 1.1);
  g.add(sun, target, fill);

  const sunDir = new THREE.Vector3();
  function apply() {
    const el = THREE.MathUtils.degToRad(P.elev), az = THREE.MathUtils.degToRad(P.azim);
    sunDir.set(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    U.uSun.value.copy(sunDir);
    U.uBase.value = P.base; U.uThick.value = P.thick; U.uCover.value = P.cover; U.uDensity.value = P.density; U.uHoleR.value = P.holeR;
    U.uHaze.value = P.haze * 1e-5; U.uSkyGain.value = P.skyGain; U.uRayGain.value = P.rays;
    U.uSunCol.value.setRGB(1, 0.96, 0.9).multiplyScalar(P.sun);
    // the bank sits on the sun's line through the cloud base; the gap lies further out, so its beam lands
    // `holeAhead` km in front of the eye and reads as rays fanning down below the sun
    const k = P.base / Math.max(sunDir.y, 0.05), fw = new THREE.Vector2(sunDir.x, sunDir.z).normalize();
    U.uSunSpot.value.set(sunDir.x * k, sunDir.z * k);
    U.uHole.value.copy(U.uSunSpot.value).addScaledVector(fw, P.holeAhead * 1000);
  }
  apply();

  let scale = 1;
  const num = (key, label, min, max, step) => [label, () => P[key], (v) => { P[key] = v; apply(); }, min, max, step];
  return {
    group: g,
    look: { exposure: 1.0, amb: ['#c8ccd4', 1.2], key: ['#ffffff', 0.9], keyDir: new THREE.Vector3(0.3, 0.6, 1), gi: 0.6,
      grade: { tint: [1, 1, 1], sat: 1.05, contrast: 1.05, sepia: 0, vignette: 0.15 }, bloom: 0.35, bloomThreshold: 1.2 },
    gfx: [
      num('elev', '하늘: 해 고도', 3, 60, 0.5), num('azim', '하늘: 해 방위', -90, 90, 1), num('sun', '하늘: 햇빛', 0, 80, 0.5),
      num('cover', '하늘: 구름 양', 0, 1, 0.01), num('density', '하늘: 구름 밀도', 0.1, 3, 0.01), num('haze', '하늘: 헤이즈', 0, 8, 0.05), num('rays', '하늘: 빛줄기 세기', 0, 8, 0.05),
      num('holeR', '하늘: 구멍 크기', 100, 2000, 10), num('holeAhead', '하늘: 구멍 거리(km)', 0, 10, 0.1), num('base', '하늘: 구름 높이', 400, 4000, 10),
      num('thick', '하늘: 구름 두께', 200, 3000, 10), num('wind', '하늘: 바람', 0, 40, 0.5), num('skyGain', '하늘: 하늘 밝기', 0, 3, 0.01),
    ],
    params: P, apply, noiseStats: () => { const d = U.tNoise.value?.image.data; if (!d) return null; let a = [1e9, -1e9, 0], b = [1e9, -1e9, 0]; for (let i = 0; i < d.length; i += 2) { a[0] = Math.min(a[0], d[i]); a[1] = Math.max(a[1], d[i]); a[2] += d[i]; b[0] = Math.min(b[0], d[i + 1]); b[1] = Math.max(b[1], d[i + 1]); b[2] += d[i + 1]; } a[2] /= d.length / 2; b[2] /= d.length / 2; return { shape: a, detail: b }; },
    async fit(scene, U_) {
      scale = U_; g.scale.setScalar(U_);
      if (!U.tNoise.value) U.tNoise.value = cloudNoise();
      sun.position.copy(sunDir).multiplyScalar(40).add(target.position);
      const cam = sun.shadow.camera; cam.left = cam.bottom = -8 * U_; cam.right = cam.top = 8 * U_; cam.near = 1 * U_; cam.far = 100 * U_; cam.updateProjectionMatrix();
      scene.background = null; scene.environment = null;
      scene.fog = new THREE.Fog(new THREE.Color().setRGB(0.5, 0.55, 0.6), 300 * U_, 2000 * U_);
    },
    tick(t, camera) {
      if (!U.tNoise.value || !camera) return;
      mainCam = camera;
      U.uTime.value = t; U.uWind.value.set(t * P.wind, t * P.wind * 0.35);
      sun.position.copy(sunDir).multiplyScalar(40).add(target.position);
      camera.updateMatrixWorld();
      U.uInvProj.value.copy(camera.projectionMatrixInverse);
      U.uCamRot.value.extractRotation(camera.matrixWorld);
      const px = renderer.getDrawingBufferSize(new THREE.Vector2()), w = Math.max(1, px.x >> 1), h = Math.max(1, px.y >> 1);
      [skyRT, histRT] = [histRT, skyRT]; // last frame's result becomes the history
      if (skyRT.width !== w || skyRT.height !== h) { skyRT.setSize(w, h); histRT.setSize(w, h); U.uBlend.value = 0; }
      U.tHistory.value = histRT.texture; U.uFrame.value = (U.uFrame.value + 1) % 64;
      dome.material.uniforms.uRes.value.copy(px);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(shadowRT); shadowQuad.render(renderer);
      renderer.setRenderTarget(skyRT); skyQuad.render(renderer);
      renderer.setRenderTarget(prev);
      dome.material.uniforms.tSky.value = skyRT.texture;
      U.uPrevViewProj.value.copy(camera.projectionMatrix).multiply(new THREE.Matrix4().copy(U.uCamRot.value).transpose());
      U.uBlend.value = 0.88;
    },
  };
}
