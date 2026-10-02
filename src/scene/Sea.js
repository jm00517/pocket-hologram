// The open sea off Kamakura-Kokomae. A MeshStandardMaterial extended in its shader, so it keeps three's sun,
// IBL sky reflection and glints, plus:
//  * Gerstner swell (4 waves rolling toward the beach) on a dense patch the size of the camera's view; past it
//    a flat plane runs to the horizon (amplitude fades out before the seam),
//  * two scrolling detail normal layers at different scales/directions (no visible tiling), faded with distance,
//  * clear tropical water: sand showing through at the edge, turquoise to cobalt by depth, reef patches,
//    a caustic web in the shallows, a thin lace line lapping the sand,
//  * distance haze toward the scene's fog colour (the sea itself skips three's fog so the far water isn't grey).
// Local frame: origin on the waterline, +z toward the beach, y up, metres (the crossing group scales by U).
import * as THREE from 'three';

const WAVES = [ // direction (toward shore = +z), wavelength m, amplitude m, steepness
  [0.18, 1, 34, 0.13, 0.5], // a calm, glassy lagoon swell (reference: clear tropical water)
  [-0.4, 1, 19, 0.065, 0.45],
  [0.7, 1, 11, 0.03, 0.4],
  [-0.9, 0.5, 6, 0.012, 0.35],
];
const NEAR_W = 500, NEAR_D = 320;

function noiseTex(N, draw) {
  const c = document.createElement('canvas'); c.width = c.height = N;
  draw(c.getContext('2d'), N);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
// tileable ripple normals: integer wave numbers over the tile
function detailNormals() {
  const N = 256, h = new Float32Array(N * N);
  // ~24 random integer wave vectors (tileable), amplitude ~ 1/|k|, random phases: isotropic, no lattice
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ks = [];
  while (ks.length < 24) {
    const kx = Math.round((rnd() - 0.5) * 40), ky = Math.round((rnd() - 0.5) * 40), k = Math.hypot(kx, ky);
    if (k >= 2) ks.push([kx, ky, 1 / k, rnd() * Math.PI * 2]);
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    for (const [kx, ky, a, ph] of ks) v += a * Math.sin(((kx * x + ky * y) / N) * Math.PI * 2 + ph);
    h[y * N + x] = v;
  }
  return noiseTex(N, (c) => {
    const img = c.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)], dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
      const l = Math.hypot(dx * 12, dy * 12, 1), i = (y * N + x) * 4;
      img.data[i] = (-dx * 12 / l * 0.5 + 0.5) * 255; img.data[i + 1] = (-dy * 12 / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  });
}
function foamTex() {
  return noiseTex(256, (c, N) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, N, N);
    for (let i = 0; i < 1400; i++) {
      const x = Math.random() * N, y = Math.random() * N, r = 1 + Math.random() * 6;
      c.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.6})`;
      for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) { c.beginPath(); c.arc(x + ox, y + oy, r, 0, 7); c.fill(); }
    }
  });
}

export function createSea() {
  const uniforms = {
    uTime: { value: 0 }, uU: { value: 1 },
    tDetail: { value: detailNormals() }, tFoam: { value: foamTex() },
    // clear water: sand showing through at the edge, turquoise, sky blue, cobalt offshore; darker reef/seagrass
    uSandTint: { value: new THREE.Color('#bfe9e0') }, uShallow: { value: new THREE.Color('#45c9c6') },
    uMid: { value: new THREE.Color('#2a9fd0') }, uDeep: { value: new THREE.Color('#0a55a8') }, uReef: { value: new THREE.Color('#0d5f72') },
    uHaze: { value: new THREE.Color('#cfe0ee') },
  };
  const wavesGLSL = WAVES.map(([dx, dz, L, A, Q]) => {
    const l = Math.hypot(dx, dz), k = (2 * Math.PI) / L, c = Math.sqrt(9.8 / k);
    return `seaWave(p, vec2(${(dx / l).toFixed(4)}, ${(dz / l).toFixed(4)}), ${k.toFixed(4)}, ${(k * c).toFixed(4)}, ${A.toFixed(3)} * amp, ${Q.toFixed(3)}, disp, nrm);`;
  }).join('\n');
  const make = (ampScale) => {
    const m = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0.05, envMapIntensity: 0.55, fog: false });
    m.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, uniforms, { uAmp: { value: ampScale } });
      s.vertexShader = s.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime, uAmp;
          varying vec3 vSea; varying float vCrest; varying vec3 vT, vB;
          void seaWave(vec2 p, vec2 d, float k, float w, float a, float q, inout vec3 disp, inout vec3 nrm) {
            float f = k * dot(d, p) - w * uTime, S = sin(f), C = cos(f);
            disp += vec3(q * a * d.x * C, a * S, q * a * d.y * C);
            nrm -= vec3(d.x * k * a * C, q * k * a * S, d.y * k * a * C);
          }`)
        .replace('#include <beginnormal_vertex>', `
          vec2 p = position.xz;
          // calm right on the sand, and gone before the seam with the flat far plane
          float amp = uAmp * mix(0.35, 1.0, smoothstep(0.0, 12.0, -p.y)) * (1.0 - smoothstep(${(NEAR_D - 90).toFixed(1)}, ${(NEAR_D - 10).toFixed(1)}, -p.y));
          vec3 disp = vec3(0.0), nrm = vec3(0.0, 1.0, 0.0);
          ${wavesGLSL}
          vec3 objectNormal = normalize(nrm);
          vCrest = disp.y / max(0.6 * amp + 1e-3, 1e-3);
          vT = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
          vB = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', `vec3 transformed = position + disp; vSea = transformed;`);
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uTime, uU; uniform sampler2D tDetail, tFoam; uniform vec3 uSandTint, uShallow, uMid, uDeep, uReef, uHaze;
          varying vec3 vSea; varying float vCrest; varying vec3 vT, vB;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float seaDist = length(vViewPosition) / uU;          // metres from the eye
          float shoreD = -vSea.z;                               // metres out from the waterline
          // surf: a band that runs up and drains back every ~7 s, broken up by the foam texture
          // a thin wet lace line that laps up and back
          float run = 0.9 + 0.7 * sin(uTime * 0.9);
          float foamN = texture2D(tFoam, vSea.xz / 9.0 + vec2(0.0, uTime * 0.05)).r;
          float surf = (smoothstep(run - 0.9, run - 0.4, shoreD) - smoothstep(run - 0.2, run + 0.5, shoreD)) * smoothstep(0.2, 0.6, foamN + 0.2) * 0.8;
          float crest = smoothstep(0.88, 1.1, vCrest) * smoothstep(0.35, 0.7, texture2D(tFoam, vSea.xz / 5.0 - uTime * 0.02).r);
          float foam = clamp(surf + crest * 0.4 * (1.0 - smoothstep(60.0, 220.0, seaDist)), 0.0, 1.0);
          // clear water: its colour is the light scattered back from the body and the bottom, by depth
          vec3 water = mix(uSandTint, uShallow, smoothstep(0.0, 14.0, shoreD));
          water = mix(water, uMid, smoothstep(14.0, 90.0, shoreD));
          water = mix(water, uDeep, smoothstep(90.0, 320.0, shoreD));
          float reef = smoothstep(0.42, 0.62, texture2D(tFoam, vSea.xz / 70.0 + 0.3).r * 0.5 + texture2D(tFoam, vSea.xz / 23.0).r * 0.5);
          water = mix(water, uReef, reef * 0.55 * smoothstep(18.0, 40.0, shoreD) * (1.0 - smoothstep(160.0, 280.0, shoreD)));
          diffuseColor.rgb = mix(water * 0.45, vec3(0.95), foam); // the sun is ~3.4: more and the shallows go neon`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = mix(mix(0.16, 0.24, smoothstep(30.0, 1500.0, seaDist)), 0.85, foam); // blurs the sky reflection into soft sheen // sharper glints bloomed into squares`)
        .replace('#include <normal_fragment_maps>', `
          vec2 q = vSea.xz;
          vec3 n1 = texture2D(tDetail, q / 20.0 + uTime * vec2(0.006, 0.018)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(tDetail, q / 57.0 + uTime * vec2(-0.009, 0.007)).xyz * 2.0 - 1.0;
          vec3 nd = normalize(vec3((n1.xy + n2.xy) * 0.07, n1.z * n2.z)); // broad and soft: dense ripples turned the sky reflection into busy speckle
          nd = normalize(mix(nd, vec3(0.0, 0.0, 1.0), smoothstep(30.0, 350.0, seaDist))); // far ripples alias into radial streaks
          normal = normalize(vT * nd.x + vB * nd.y + normal * nd.z);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          // caustic web on the shallow bottom: bright where the two ripple layers focus light; scales with the sun
          #if NUM_DIR_LIGHTS > 0
            vec2 cq = vSea.xz;
            vec2 c1 = texture2D(tDetail, cq / 4.0 + uTime * vec2(0.03, 0.05)).xy - 0.5, c2 = texture2D(tDetail, cq / 6.5 - uTime * vec2(0.04, 0.02)).xy - 0.5;
            float caust = pow(clamp(1.0 - length(c1 - c2) * 3.2, 0.0, 1.0), 5.0) * (1.0 - smoothstep(3.0, 30.0, shoreD)) * (1.0 - foam);
            totalEmissiveRadiance += vec3(0.55, 1.0, 0.95) * caust * 0.05 * dot(directionalLights[ 0 ].color, vec3(0.3333));
          #endif`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          // single-pixel sun glints past the bloom threshold bloomed into squares: keep them just under it
          gl_FragColor.rgb = min(mix(gl_FragColor.rgb, uHaze, smoothstep(900.0, 4000.0, seaDist) * 0.45), vec3(1.1)); // keep the deep-blue band at the horizon`);
    };
    m.customProgramCacheKey = () => `sea${ampScale}`;
    return m;
  };
  const group = new THREE.Group();
  group.userData.noAO = true; // the AO normal pass would draw it flat, without the swell
  const nearGeo = new THREE.PlaneGeometry(NEAR_W, NEAR_D, 250, 160).rotateX(-Math.PI / 2).translate(0, 0, -NEAR_D / 2 + 2);
  const farGeo = new THREE.PlaneGeometry(9000, 4200).rotateX(-Math.PI / 2).translate(0, 0, -NEAR_D + 2 - 2100);
  const near = new THREE.Mesh(nearGeo, make(1)), far = new THREE.Mesh(farGeo, make(0));
  near.receiveShadow = true; near.frustumCulled = false;
  // the far plane must also cover the sides of the near patch
  for (const x of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(4250, NEAR_D).rotateX(-Math.PI / 2).translate(x * (NEAR_W / 2 + 2125), 0, -NEAR_D / 2 + 2), far.material);
    group.add(side);
  }
  group.add(near, far);
  for (const o of group.children) o.material.userData.outlineParameters = { visible: false };
  return {
    group,
    tick(t, fog) { uniforms.uTime.value = t; if (fog) uniforms.uHaze.value.copy(fog.color); },
    setScale(U) { uniforms.uU.value = U; },
  };
}
