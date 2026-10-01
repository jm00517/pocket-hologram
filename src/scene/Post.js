// Post-processing chain: scene (with MMD ink outlines) -> GTAO ambient occlusion -> bloom -> tone
// mapping/sRGB -> SMAA. OutlineEffect renders the scene itself, so it gets its own pass.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

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
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.5, 1.15); // strength, radius, threshold (HDR: only lamps/screens/glints)
  const smaa = new SMAAPass(1, 1);
  composer.addPass(render);
  composer.addPass(ao);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.addPass(smaa);
  return {
    composer, ao, bloom,
    setSize(w, h, ratio) {
      composer.setPixelRatio(ratio); composer.setSize(w, h);
      ao.setSize(w * ratio, h * ratio);
    },
    setScale(U) { ao.updateGtaoMaterial({ radius: 0.25 * U }); }, // ~25 cm of the character world
    render() { composer.render(); },
  };
}
