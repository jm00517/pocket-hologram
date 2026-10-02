// Character-only lighting for the MMD toon materials, the way anime games light characters apart from the set:
//  * key: her own directional light (fixed world direction, colour/intensity from the weather), run through the
//    toon RE_Direct so the shade line stays crisp. It never lights the background.
//  * bounce: three feeds scene.environment only to MeshStandardMaterial, so capture() shoots a small cube map
//    from where she stands (hidden), projects it to SH, and adds only its directional part (L1/L2) to her
//    indirect light. Colour from the sky, lit road, vending machine or a neon sign tints the side facing it.
import * as THREE from 'three';
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js';

export function createGI(renderer) {
  const sh = { value: Array.from({ length: 9 }, () => new THREE.Vector3()) }, strength = { value: 0.6 };
  // same shape the weather code already drives on a DirectionalLight (color, intensity, position)
  const key = { color: new THREE.Color('#ffffff'), intensity: 2.5, position: new THREE.Vector3(-1, 1, 1) };
  const tmpC = new THREE.Color(), tmpV = new THREE.Vector3();
  const keyColor = { get value() { return tmpC.copy(key.color).multiplyScalar(key.intensity); } };
  const keyDir = { get value() { return tmpV.copy(key.position).normalize(); } };
  const cam = new THREE.CubeCamera(0.01, 30000, new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType }));
  return {
    key, strength,
    patch(mat) {
      mat.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, { uGI: sh, uGIStrength: strength, uKeyColor: keyColor, uKeyDir: keyDir });
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uGI[ 9 ];\nuniform float uGIStrength;\nuniform vec3 uKeyColor;\nuniform vec3 uKeyDir;')
          .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
            irradiance += uGIStrength * getLightProbeIrradiance( uGI, geometryNormal );
            IncidentLight keyLight;
            keyLight.direction = normalize( ( viewMatrix * vec4( uKeyDir, 0.0 ) ).xyz );
            keyLight.color = uKeyColor;
            keyLight.visible = true;
            RE_Direct( keyLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );`);
      };
      mat.customProgramCacheKey = () => 'gi';
      mat.needsUpdate = true;
    },
    async capture(scene, at, hide) {
      hide.visible = false; cam.position.copy(at); cam.update(renderer, scene); hide.visible = true;
      const probe = await LightProbeGenerator.fromCubeRenderTarget(renderer, cam.renderTarget);
      probe.sh.coefficients.forEach((c, i) => sh.value[i].copy(c));
      sh.value[0].set(0, 0, 0); // the average (L0) is the per-weather ambient's job; keep only where the light comes from
    },
  };
}
