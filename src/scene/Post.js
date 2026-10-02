// Post-processing chain: scene (with MMD ink outlines) -> GTAO ambient occlusion -> bloom -> tone
// mapping/sRGB -> SMAA. OutlineEffect renders the scene itself, so it gets its own pass.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Display-space colour grade: tint, saturation, contrast, sepia, vignette.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, tint: { value: new THREE.Vector3(1, 1, 1) }, sat: { value: 1 }, contrast: { value: 1 }, sepia: { value: 0 }, vignette: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 tint; uniform float sat, contrast, sepia, vignette; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * tint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, sat);
      col = mix(col, vec3(l) * vec3(1.07, 0.88, 0.66) * 1.08, sepia);
      col = (col - 0.5) * contrast + 0.5;
      float d = distance(vUv, vec2(0.5)); col *= 1.0 - vignette * smoothstep(0.35, 0.85, d);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

class OutlineRenderPass extends Pass {
  constructor(effect, scene, camera) { super(); this.effect = effect; this.scene = scene; this.camera = camera; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) {
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clear();
    this.effect.render(this.scene, this.camera);
  }
}

// ?perf: GPU ms per pass (EXT_disjoint_timer_query_webgl2), averaged over 60 frames. Timer queries can't
// nest, so a nested segment (shadow maps inside the scene pass) pauses its parent and resumes it after.
function gpuProfiler(renderer, composer) {
  const gl = renderer.getContext(), ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const hud = Object.assign(document.createElement('pre'), { style: 'position:fixed;right:8px;bottom:8px;z-index:99;margin:0;padding:6px 8px;background:#000b;color:#9f9;font:11px monospace;pointer-events:none' });
  document.body.append(hud);
  if (!ext) { hud.textContent = 'no EXT_disjoint_timer_query_webgl2'; return null; }
  const pending = [], sum = {}, stack = [];
  let frames = 0, cpu = 0, last = performance.now(), calls = 0, tris = 0;
  const start = (label) => { const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); pending.push({ q, label }); };
  const begin = (label) => { if (stack.length) gl.endQuery(ext.TIME_ELAPSED_EXT); stack.push(label); start(label); };
  const end = () => { gl.endQuery(ext.TIME_ELAPSED_EXT); stack.pop(); if (stack.length) start(stack.at(-1)); };
  const wrap = (obj, fn, label) => { const f = obj[fn].bind(obj); obj[fn] = (...a) => { begin(label); try { return f(...a); } finally { end(); } }; };
  composer.passes.forEach((p) => wrap(p, 'render', p.constructor.name.replace(/Pass$/, '')));
  wrap(renderer.shadowMap, 'render', 'shadows');
  renderer.info.autoReset = false;
  return {
    frame() {
      const now = performance.now(); cpu += now - last; last = now;
      calls += renderer.info.render.calls; tris += renderer.info.render.triangles; renderer.info.reset();
      while (pending.length && gl.getQueryParameter(pending[0].q, gl.QUERY_RESULT_AVAILABLE)) {
        const { q, label } = pending.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) sum[label] = (sum[label] ?? 0) + gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(q);
      }
      if (++frames < 60) return;
      const rows = Object.entries(sum).sort((a, b) => b[1] - a[1]), total = rows.reduce((s, r) => s + r[1], 0);
      const px = renderer.getDrawingBufferSize(new THREE.Vector2());
      hud.textContent = [`${(1000 / (cpu / frames)).toFixed(0)} fps  ${px.x}x${px.y}  ${(calls / frames) | 0} draws  ${((tris / frames) / 1e6).toFixed(2)}M tris`,
        `gpu ${(total / frames).toFixed(2)} ms`, ...rows.map(([k, v]) => `${k.padEnd(14)}${(v / frames).toFixed(2)}`)].join('\n');
      frames = cpu = calls = tris = 0; for (const k in sum) delete sum[k];
    },
  };
}

export function createPost(renderer, scene, camera, outline) {
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  const render = new OutlineRenderPass(outline, scene, camera);
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.blendIntensity = 0.85;
  ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1, scale: 1 });
  // GTAO re-renders the scene for normals with a plain material: sprites come out as solid quads (dark boxes
  // behind the impostor trees) and wind-swayed foliage lands in the wrong place, so both stay out (userData.noAO)
  const hideFromAO = ao.overrideVisibility.bind(ao);
  ao.overrideVisibility = () => { hideFromAO(); scene.traverse((o) => { if (o.isSprite || o.userData.noAO) o.visible = false; }); };
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.5, 1.15); // strength, radius, threshold (HDR: only lamps/screens/glints)
  const smaa = new SMAAPass(1, 1);
  composer.addPass(render);
  composer.addPass(ao);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(smaa);
  const perf = new URLSearchParams(location.search).has('perf') ? gpuProfiler(renderer, composer) : null;
  return {
    composer, ao, bloom,
    setSize(w, h, ratio) {
      composer.setPixelRatio(ratio); composer.setSize(w, h);
      ao.setSize((w * ratio) / 2, (h * ratio) / 2); // AO is low-frequency: half res is ~4x cheaper and looks the same
    },
    setScale(U) { ao.updateGtaoMaterial({ radius: 0.25 * U }); }, // ~25 cm of the character world
    render() { composer.render(); perf?.frame(); },
    grade(g) {
      const u = grade.uniforms;
      u.tint.value.fromArray(g?.tint ?? [1, 1, 1]); u.sat.value = g?.sat ?? 1; u.contrast.value = g?.contrast ?? 1;
      u.sepia.value = g?.sepia ?? 0; u.vignette.value = g?.vignette ?? 0;
    },
  };
}
