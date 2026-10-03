// Volumetric sky: a raymarched cloud deck whose coverage is a live fluid (CloudFluid), crepuscular rays in the
// haze, and the same clouds shading the ground (sun and shade that move with them) and the subject.
//
//   const sky = createVolumetricSky(renderer, { wind });   // wind: engine.wind
//   scene.add(sky.dome);                                    // or any group; it draws behind everything
//   sky.patchReceiver(groundMaterial, { aerial: true });    // cloud shadow + rays/haze over that surface
//   per frame: sky.tick(t, dt, camera, { origin, U });      // origin: world pos of stage metres (0,0,0)
//   sky.sunlight                                            // 0..1 sun reaching the subject now (smoothed)
//   sky.params                                              // ParamDefs (ids without prefix)
//   sky.sunDir                                              // unit vector toward the sun (stage metres)
//
// How it renders, per frame:
//   1. CloudFluid step: velocity (wind + stirring + vorticity) and cloud water (advected, condensing/evaporating).
//   2. Shadow map: from the cloud base, march the deck toward the sun -> transmittance, 1024^2 over 20 km.
//   3. Sky pass at half resolution: clouds (64 steps, 5-step sun march, two-lobe phase -> silver lining) and the
//      haze in front of them marched against the shadow map (rays). Blended with last frame reprojected by
//      view direction (exact for a sky at infinity).
//   4. The dome (renderOrder -1e6, depth at the far plane) shows it behind everything.
// Units: metres around the eye; altitude is metres above the stage floor.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { getCloudNoise } from './noise.js';
import { createCloudFluid } from './CloudFluid.js';

const SIG = '0.035'; // cloud extinction per metre at density 1
const COMMON = /* glsl */`
  precision highp sampler3D;
  uniform sampler3D tNoise; uniform sampler2D tFluid;
  uniform vec2 uWindOff;
  uniform vec3 uSun;
  uniform float uDensity, uBase, uThick, uTime, uFluidS, uSunGap, uBankR, uGapW, uFan;
  uniform vec3 uGapOff;
  uniform float uGapCut;
  float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
  // lightPath: the shadow-map pass. Small slot-shaped gaps exist only there: they cut the light into rays,
  // while the visible clouds keep soft gaps (seen directly, backlit slivers glittered).
  float density(vec3 p, bool detail, bool lightPath) {
    float h = (p.y - uBase) / uThick;
    if (h <= 0.0 || h >= 1.0) return 0.0;
    vec3 q = p - vec3(uWindOff.x, 0.0, uWindOff.y); // detail rides the mean wind
    float cov = texture2D(tFluid, p.xz / uFluidS + 0.5).r;
    if (uSunGap > 0.0) {
      // Art direction around the sun line (eye -> sun): a lumpy cloud where it enters the deck hides the sun;
      // behind it the line is kept clear, so the sun lights the cloud's back and its thin rim glows. Gaps open in
      // a fan below the sun; their beams run parallel to the sun line -> rays converging on the sun.
      // the whole set piece drifts with the wind (uGapOff) and forms/dissolves on a cycle, like a real cloud
      // crossing the sun: covered (rays, silver rim, the viewer in its shadow), then it moves on and the sun is out
      vec3 pg = p - uGapOff;
      float along = dot(pg, uSun); vec3 w = pg - uSun * along; float r = length(w);
      vec3 down = normalize(uSun * uSun.y - vec3(0.0, 1.0, 0.0)), side = cross(uSun, down);
      float ang = atan(dot(w, side), dot(w, down));
      float tEnt = uBase / max(uSun.y, 0.05), n3 = texture(tNoise, q / 1300.0).r;
      float fan = 1.0 - smoothstep(uFan * 0.6, uFan, abs(ang));
      // a thin broken clear margin all round lights the rim; below the sun, in the fan, coverage drops so the
      // cloud's own shape noise opens a few organic gaps (cutting slots there left backlit shards that glittered)
      float clearR = uBankR * (0.95 + 0.35 * smoothstep(0.35, 0.75, n3));
      float tube = 1.0 - smoothstep(clearR * 0.9, clearR, r + (n3 - 0.5) * uBankR * 1.3);
      float ring = smoothstep(uBankR * 0.8, uBankR * 1.2, r) * (1.0 - smoothstep(uBankR + uGapW * 0.5, uBankR + uGapW, r));
      float behind = smoothstep(tEnt - 400.0, tEnt + 200.0, along);
      float c2 = cov * (1.0 - tube * behind) * (1.0 - uGapCut * fan * ring * behind);
      if (lightPath) c2 *= 1.0 - fan * ring * behind * smoothstep(0.45, 0.55, texture(tNoise, vec3(ang * 2.2, r / 2600.0, 0.11 + uTime * 0.0003)).g);
      float bd = length(pg - uSun * (tEnt + uBankR * 0.7)) / uBankR + (texture(tNoise, q / 650.0).r - 0.5) * 0.8 + (n3 - 0.5) * 0.6;
      c2 = max(c2, 0.97 * (1.0 - smoothstep(0.55, 1.0, bd)));
      cov = mix(cov, c2, uSunGap);
    }
    float prof = smoothstep(0.0, 0.2, h) * smoothstep(1.0, 0.45, h);
    float shape = texture(tNoise, vec3(q.x / 3400.0, q.z / 3400.0, q.y / 2600.0)).r * prof;
    float d = clamp((shape - (1.0 - cov)) / max(cov, 0.05), 0.0, 1.0) * cov;
    if (detail && d > 0.0) { // billows (~700 m) and cauliflower edges (~220 m); thin parts erode most
      float det = texture(tNoise, vec3(q.x / 700.0, q.z / 700.0, q.y / 700.0 + uTime * 0.004)).g * 0.65
                + texture(tNoise, vec3(q.x / 220.0, q.z / 220.0, q.y / 220.0 - uTime * 0.01)).g * 0.35;
      d = clamp(d - (1.0 - det) * 0.38 * (1.0 - d * 0.6), 0.0, 1.0);
      d *= smoothstep(0.0, 0.06, d); // wisps thinner than a march step flicker in and out (glitter): let them go
    }
    return d * uDensity;
  }
`;
// cloud shadow + haze for any point in stage metres; shared by the sky pass and patched surfaces
const LIGHT = /* glsl */`
  uniform sampler2D tShadow; uniform float uShadowSpan, uHaze, uRayGain, uHazeG; uniform vec3 uSunCol, uAmbHigh;
  float cloudShadow(vec3 p) {
    if (p.y >= uBase) return 1.0;
    vec2 uv = (p.xz + uSun.xz * ((uBase - p.y) / max(uSun.y, 0.05))) / uShadowSpan + 0.5;
    return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.08 : texture2D(tShadow, uv).r;
  }
  // haze between o and o + dir * tEnd: returns inscatter, writes transmittance
  vec3 hazeMarch(vec3 o, vec3 dir, float tEnd, float j, int n, out float Ta) {
    float mu = dot(dir, uSun), phA = mix(hg(mu, 0.0), hg(mu, uHazeG), 0.75), prev = 0.0;
    vec3 ins = vec3(0.0); Ta = 1.0;
    for (int i = 0; i < 32; i++) {
      if (i >= n) break;
      float t = tEnd * pow((float(i) + j) / float(n), 2.0), dt = t - prev; prev = t;
      vec3 p = o + dir * t;
      float beta = uHaze * exp(-max(p.y, 0.0) / 1400.0);
      ins += Ta * (uSunCol * cloudShadow(p) * phA * uRayGain + uAmbHigh * 0.09) * beta * dt;
      Ta *= exp(-beta * dt);
    }
    return ins;
  }
`;
const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const shadowFrag = /* glsl */`${COMMON}
  uniform float uShadowSpan; varying vec2 vUv;
  void main() {
    vec3 p = vec3((vUv.x - 0.5) * uShadowSpan, uBase, (vUv.y - 0.5) * uShadowSpan);
    float L = uThick / max(uSun.y, 0.05), dt = L / 24.0, od = 0.0;
    p += uSun * dt * 0.5;
    for (int i = 0; i < 24; i++) { od += density(p, true, true) * dt; p += uSun * dt; } // detail too: it striates the rays
    gl_FragColor = vec4(exp(-od * ${SIG}), 0.0, 0.0, 1.0);
  }`;

const skyFrag = /* glsl */`${COMMON}${LIGHT}
  uniform mat4 uInvProj, uCamRot, uPrevViewProj;
  uniform sampler2D tHistory;
  uniform float uSkyGain, uFrame, uBlend, uG, uGw, uAmbGain;
  uniform vec3 uAmbLow, uZenith, uHorizon, uGround;
  varying vec2 vUv;
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
      ? uGround * (uAmbHigh * 0.55 + uSunCol * max(uSun.y, 0.0) * 0.16 * cloudShadow(o + dir * min(tGround, 40000.0)))
      : skyBg(dir, mu);
    vec3 cc = vec3(0.0); float Tc = 1.0;
    if (dir.y > 0.015 && tCloud < 70000.0) {
      float t1 = min((uBase + uThick - o.y) / dir.y, tCloud + 8000.0), dt = (t1 - tCloud) / 96.0, t = tCloud + dt * j;
      float ph = min(mix(hg(mu, -0.15), hg(mu, uG), uGw), 2.5), ph2 = mix(hg(mu, -0.1), hg(mu, 0.45), 0.5);
      for (int i = 0; i < 96; i++) {
        vec3 p = o + dir * t;
        float d = density(p, true, false);
        if (d > 0.003) {
          float od = 0.0, ls = 50.0; vec3 lp = p;
          for (int k = 0; k < 5; k++) { lp += uSun * ls; od += density(lp, false, false) * ls; ls *= 1.9; }
          float h = (p.y - uBase) / uThick;
          vec3 lum = uSunCol * (exp(-od * ${SIG}) * ph + 0.35 * exp(-od * ${SIG} * 0.2) * ph2) + mix(uAmbLow, uAmbHigh, h) * uAmbGain;
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
    float Ta;
    vec3 ins = hazeMarch(o, dir, min(min(tGround, tCloud), 40000.0), j, 28, Ta);
    vec3 col = ins + Ta * (cc + Tc * bg);
    vec4 pc = uPrevViewProj * vec4(dir, 0.0); // temporal accumulation, reprojected by direction
    vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
    if (pc.w > 0.0 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0) col = mix(col, texture2D(tHistory, puv).rgb, uBlend);
    gl_FragColor = vec4(col, 1.0);
  }`;

export function createVolumetricSky(renderer, { wind } = {}) {
  const P = {
    elev: 24, azim: 15, sun: 14, g: 0.75, gw: 0.5, hazeG: 0.6, amb: 0.75, cover: 0.6, density: 1.0, haze: 1.6, rays: 1.4,
    sunGap: 1, gapCut: 0.35, gapCycle: 70, gapDrift: 3000, bankR: 650, gapW: 1400, fan: 70, base: 1500, thick: 900, skyGain: 1,
    timeScale: 8, stir: 6, swirl: 0.35, life: 240,
  };
  const noise = getCloudNoise();
  const fluid = createCloudFluid(renderer, { noise });
  const U = {
    tNoise: { value: noise }, tFluid: { value: null }, uFluidS: { value: fluid.S }, uWindOff: { value: new THREE.Vector2() },
    uSun: { value: new THREE.Vector3() }, uDensity: { value: 1 }, uBase: { value: 1500 }, uThick: { value: 900 }, uTime: { value: 0 },
    uSunGap: { value: 1 }, uGapOff: { value: new THREE.Vector3() }, uGapCut: { value: 0.35 }, uBankR: { value: 650 }, uGapW: { value: 1400 }, uFan: { value: 1.2 },
    uShadowSpan: { value: 20000 }, tShadow: { value: null }, uHaze: { value: 1.6e-5 }, uRayGain: { value: 1 }, uHazeG: { value: 0.6 },
    uSunCol: { value: new THREE.Color() }, uAmbHigh: { value: new THREE.Color(0.62, 0.68, 0.8) }, uAmbLow: { value: new THREE.Color(0.2, 0.22, 0.26) },
    uInvProj: { value: new THREE.Matrix4() }, uCamRot: { value: new THREE.Matrix4() }, uPrevViewProj: { value: new THREE.Matrix4() }, tHistory: { value: null },
    uSkyGain: { value: 1 }, uFrame: { value: 0 }, uBlend: { value: 0 }, uG: { value: 0.75 }, uGw: { value: 0.5 }, uAmbGain: { value: 0.75 },
    uZenith: { value: new THREE.Color(0.16, 0.34, 0.78) }, uHorizon: { value: new THREE.Color(0.6, 0.68, 0.78) }, uGround: { value: new THREE.Color(0.16, 0.2, 0.12) },
    // receivers: world -> stage metres, and the sun already applied to the light (see patchReceiver)
    uSkyOrigin: { value: new THREE.Vector3() }, uSkyU: { value: 1 }, uSunScale: { value: 1 },
  };
  const shadowRT = new THREE.WebGLRenderTarget(1024, 1024, { type: THREE.HalfFloatType, depthBuffer: false });
  let skyRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false }), histRT = skyRT.clone();
  U.tShadow.value = shadowRT.texture;
  const quad = (frag) => new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false }));
  const shadowQuad = quad(shadowFrag), skyQuad = quad(skyFrag);

  // the dome shows the half-res sky behind everything; other cameras (GI probe, reflections) get a flat stand-in
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

  const sunDir = new THREE.Vector3();
  function apply() {
    const el = THREE.MathUtils.degToRad(P.elev), az = THREE.MathUtils.degToRad(P.azim);
    sunDir.set(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    U.uSun.value.copy(sunDir);
    U.uBase.value = P.base; U.uThick.value = P.thick; U.uDensity.value = P.density;
    U.uSunGap.value = P.sunGap; U.uBankR.value = P.bankR; U.uGapW.value = P.gapW; U.uGapCut.value = P.gapCut; U.uFan.value = THREE.MathUtils.degToRad(P.fan);
    U.uHaze.value = P.haze * 1e-5; U.uSkyGain.value = P.skyGain; U.uRayGain.value = P.rays; U.uG.value = P.g; U.uGw.value = P.gw; U.uHazeG.value = P.hazeG; U.uAmbGain.value = P.amb;
    U.uSunCol.value.setRGB(1, 0.96, 0.9).multiplyScalar(P.sun);
  }
  apply();

  // sunlight at the subject: read one texel of the shadow map now and then (async where supported)
  const px = new Uint16Array(4), probe = new THREE.Vector3(0, 1, 0);
  let sunlight = 1, target = 1, reading = false, frame = 0;
  const readSunlight = () => {
    const uv = new THREE.Vector2(probe.x + sunDir.x * ((P.base - probe.y) / Math.max(sunDir.y, 0.05)), probe.z + sunDir.z * ((P.base - probe.y) / Math.max(sunDir.y, 0.05)))
      .divideScalar(U.uShadowSpan.value).addScalar(0.5);
    const x = Math.min(1023, Math.max(0, Math.floor(uv.x * 1024))), y = Math.min(1023, Math.max(0, Math.floor(uv.y * 1024)));
    const done = () => { target = THREE.DataUtils.fromHalfFloat(px[0]); reading = false; };
    reading = true;
    if (renderer.readRenderTargetPixelsAsync) renderer.readRenderTargetPixelsAsync(shadowRT, x, y, 1, 1, px).then(done, () => { reading = false; });
    else { renderer.readRenderTargetPixels(shadowRT, x, y, 1, 1, px); done(); }
  };

  const num = (id, label, doc, min, max, step) => ({ id, label, doc, min, max, step, get: () => P[id], set: (v) => { P[id] = v; apply(); } });
  return {
    dome, uniforms: U, sunDir, values: P, apply, fluid,
    get sunlight() { return sunlight; },
    params: [
      num('elev', '해 고도', 'Sun elevation, degrees.', 3, 60, 0.5),
      num('azim', '해 방위', 'Sun azimuth, degrees; 0 = straight ahead (-z), + = left.', -90, 90, 1),
      num('sun', '햇빛', 'Sun radiance multiplier (clouds, haze).', 0, 80, 0.5),
      num('cover', '구름 양', 'Share of the sky that wants to be cloud (humidity threshold of the fluid).', 0, 1, 0.01),
      num('density', '구름 밀도', 'Cloud density multiplier.', 0.1, 3, 0.01),
      num('base', '구름 높이', 'Cloud base altitude (m).', 400, 4000, 10),
      num('thick', '구름 두께', 'Cloud layer thickness (m).', 200, 3000, 10),
      num('timeScale', '구름 시간 배속', 'Time-lapse factor for cloud motion and evolution (1 = real time).', 0, 60, 0.5),
      num('stir', '난류', 'Turbulent stirring of the cloud flow (m/s): more = more tearing and swirling.', 0, 30, 0.1),
      num('swirl', '소용돌이', 'Vorticity confinement: keeps small eddies alive.', 0, 2, 0.01),
      num('life', '응결/증발 시간', 'Seconds (sim time) for clouds to form or dissolve toward the humidity field.', 20, 1200, 5),
      num('g', '전방 산란', 'Cloud forward-scattering anisotropy (HG g): higher = sharper, brighter silver lining.', 0, 0.95, 0.01),
      num('gw', '전방 산란 비중', 'Weight of the forward lobe vs a soft back lobe.', 0, 1, 0.01),
      num('amb', '구름 환경광', 'Sky light on clouds; lower = darker bellies, more contrast with sunlit edges.', 0, 2, 0.01),
      num('haze', '헤이즈', 'Haze density (x1e-5 per metre); the medium the rays show in.', 0, 8, 0.05),
      num('rays', '빛줄기 세기', 'Extra gain on sunlit haze only: crepuscular ray contrast.', 0, 8, 0.05),
      num('hazeG', '헤이즈 산란', 'Haze anisotropy: higher = rays and glow hug the sun.', 0, 0.95, 0.01),
      num('sunGap', '해 주변 연출', 'Art direction 0..1: a cloud parked over the sun with a silver rim and a fan of gaps below it (0 = pure simulation).', 0, 1, 0.01),
      num('gapCycle', '해 가림 주기', 'Seconds for the cloud over the sun to form, drift across it with the wind and dissolve; 0 = parked over the sun.', 0, 600, 1),
      num('gapDrift', '해 가림 이동 거리', 'How far (m) that cloud drifts during one cycle; the sun is covered for roughly bankR*2/gapDrift of it.', 0, 10000, 50),
      num('bankR', '해 가린 구름 크기', 'Radius (m) of the cloud over the sun; smaller = brighter silver edges.', 150, 3000, 10),
      num('gapCut', '틈 크기', 'How much the fan below the sun thins the clouds (0..1): small = a few separate gaps (rays), large = one open hole.', 0, 1, 0.01),
      num('gapW', '틈 고리 폭', 'Width (m) of the ring outside it where gaps open; wider = longer rays.', 0, 5000, 10),
      num('fan', '빛줄기 부채각', 'Half-angle (deg) of the fan below the sun where gaps (and so rays) appear.', 0, 180, 1),
      num('skyGain', '하늘 밝기', 'Clear-sky brightness behind the clouds.', 0, 3, 0.01),
    ],
    /**
     * Shade a surface by the clouds: its direct light is multiplied by the cloud shadow above it. The scene's
     * sun light is expected to already be scaled by `sunlight` (so the subject, which isn't patched, gets it);
     * receivers divide that back out. aerial: also add the haze (rays) between the eye and the surface.
     * Assumes the sun is the material's only direct light.
     */
    patchReceiver(mat, { aerial = false } = {}) {
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (sh, r) => {
        prev?.call(mat, sh, r);
        Object.assign(sh.uniforms, U);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSkyW;')
          .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
            #ifdef USE_INSTANCING
              vSkyW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
            #else
              vSkyW = (modelMatrix * vec4(transformed, 1.0)).xyz;
            #endif`);
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
            varying vec3 vSkyW; uniform vec3 uSkyOrigin; uniform float uSkyU, uSunScale;
            ${COMMON}${LIGHT}`)
          .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
            vec3 skyP = (vSkyW - uSkyOrigin) / uSkyU;
            float cs = cloudShadow(skyP) / max(uSunScale, 0.03);
            reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= cs;`);
        if (aerial) sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `
            { vec3 eyeP = (cameraPosition - uSkyOrigin) / uSkyU, d = skyP - eyeP; float Ta;
              float jj = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
              vec3 ins = hazeMarch(eyeP, normalize(d), length(d), jj, 16, Ta);
              gl_FragColor.rgb = gl_FragColor.rgb * Ta + ins; }
            #include <fog_fragment>`);
      };
      const key = mat.customProgramCacheKey?.bind(mat);
      mat.customProgramCacheKey = () => `${key?.() ?? ''}|cloudShadow${aerial}`;
      mat.needsUpdate = true;
      return mat;
    },
    /** origin: world position of stage metres (0,0,0); U: scene units per metre */
    tick(t, dt, camera, { origin, U: units = 1 } = {}) {
      if (!camera) return;
      mainCam = camera;
      if (origin) U.uSkyOrigin.value.copy(origin);
      U.uSkyU.value = units;
      const simDt = dt * P.timeScale;
      // the set piece's cycle (real seconds): drift from upwind to downwind across the sun line, fading in and out
      const ph = P.gapCycle > 0 ? (t / P.gapCycle) % 1 : 0.5, wv = wind?.vector ?? new THREE.Vector3(1, 0, 0), wl = wv.length() || 1;
      U.uGapOff.value.set(wv.x / wl, 0, wv.z / wl).multiplyScalar((ph - 0.5) * P.gapDrift);
      U.uSunGap.value = P.sunGap * Math.pow(Math.sin(Math.PI * ph), 0.6);
      U.uTime.value += simDt;
      fluid.step(simDt, wind?.vector ?? new THREE.Vector3(9, 0, -3), { cover: P.cover, stir: P.stir, conf: P.swirl, tau: P.life });
      U.tFluid.value = fluid.texture; U.uWindOff.value.copy(fluid.windOffset);
      camera.updateMatrixWorld();
      U.uInvProj.value.copy(camera.projectionMatrixInverse);
      U.uCamRot.value.extractRotation(camera.matrixWorld);
      const size = renderer.getDrawingBufferSize(new THREE.Vector2()), w = Math.max(1, size.x >> 1), h = Math.max(1, size.y >> 1);
      [skyRT, histRT] = [histRT, skyRT]; // last frame's result becomes the history
      if (skyRT.width !== w || skyRT.height !== h) { skyRT.setSize(w, h); histRT.setSize(w, h); U.uBlend.value = 0; }
      U.tHistory.value = histRT.texture; U.uFrame.value = (U.uFrame.value + 1) % 64;
      dome.material.uniforms.uRes.value.copy(size);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(shadowRT); shadowQuad.render(renderer);
      renderer.setRenderTarget(skyRT); skyQuad.render(renderer);
      renderer.setRenderTarget(prev);
      dome.material.uniforms.tSky.value = skyRT.texture;
      U.uPrevViewProj.value.copy(camera.projectionMatrix).multiply(new THREE.Matrix4().copy(U.uCamRot.value).transpose());
      U.uBlend.value = 0.88;
      if (!reading && frame++ % 4 === 0) readSunlight();
      sunlight += (target - sunlight) * (1 - Math.exp(-dt / 0.5)); // a cloud edge sweeps over in ~a second
      U.uSunScale.value = Math.max(sunlight, 0.03);
    },
  };
}
