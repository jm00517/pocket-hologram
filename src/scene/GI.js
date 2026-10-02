// Bounce light for the MMD character. three feeds scene.environment only to MeshStandardMaterial, so the toon
// materials never saw the sky or the street. capture() renders the scene into a small cube map from where the
// character stands (character hidden) and projects it to 9 SH coefficients; patch() adds that irradiance to the
// toon shader's indirect light. Anything bright around her (sky, lit road, vending machine, a neon sign) tints her.
import * as THREE from 'three';
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js';

export function createGI(renderer) {
  const sh = { value: Array.from({ length: 9 }, () => new THREE.Vector3()) }, strength = { value: 0.35 }; // on top of the per-weather ambient; 0.8 washed the hair out
  const cam = new THREE.CubeCamera(0.01, 30000, new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType }));
  return {
    strength,
    patch(mat) {
      mat.onBeforeCompile = (s) => {
        s.uniforms.uGI = sh; s.uniforms.uGIStrength = strength;
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uGI[ 9 ];\nuniform float uGIStrength;')
          .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\nirradiance += uGIStrength * getLightProbeIrradiance( uGI, geometryNormal );');
      };
      mat.customProgramCacheKey = () => 'gi';
      mat.needsUpdate = true;
    },
    async capture(scene, at, hide) {
      hide.visible = false; cam.position.copy(at); cam.update(renderer, scene); hide.visible = true;
      const probe = await LightProbeGenerator.fromCubeRenderTarget(renderer, cam.renderTarget);
      probe.sh.coefficients.forEach((c, i) => sh.value[i].copy(c));
    },
  };
}
