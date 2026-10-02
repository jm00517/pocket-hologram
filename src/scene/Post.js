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

export function createPost(renderer, scene, camera, outline) {
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  const render = new OutlineRenderPass(outline, scene, camera);
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.blendIntensity = 0.85;
  ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1, scale: 1 });
  // GTAO's normal/depth pass draws sprites as solid quads (no alpha test), shading dark boxes behind the impostor trees
  const hideFromAO = ao.overrideVisibility.bind(ao);
  ao.overrideVisibility = () => { hideFromAO(); scene.traverse((o) => { if (o.isSprite) o.visible = false; }); };
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.5, 1.15); // strength, radius, threshold (HDR: only lamps/screens/glints)
  const smaa = new SMAAPass(1, 1);
  composer.addPass(render);
  composer.addPass(ao);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(smaa);
  return {
    composer, ao, bloom,
    setSize(w, h, ratio) {
      composer.setPixelRatio(ratio); composer.setSize(w, h);
      ao.setSize(w * ratio, h * ratio);
    },
    setScale(U) { ao.updateGtaoMaterial({ radius: 0.25 * U }); }, // ~25 cm of the character world
    render() { composer.render(); },
    grade(g) {
      const u = grade.uniforms;
      u.tint.value.fromArray(g?.tint ?? [1, 1, 1]); u.sat.value = g?.sat ?? 1; u.contrast.value = g?.contrast ?? 1;
      u.sepia.value = g?.sepia ?? 0; u.vignette.value = g?.vignette ?? 0;
    },
  };
}
