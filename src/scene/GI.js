// Character-only lighting for the MMD toon materials, the way anime games light characters apart from the set:
//  * key: her own directional light (fixed world direction, colour/intensity from the weather), run through the
//    toon RE_Direct so the shade line stays crisp. It never lights the background.
//  * bounce: three feeds scene.environment only to MeshStandardMaterial, so capture() shoots a small cube map
//    from where she stands (hidden) and projects it to SH. The shader takes only its hue per normal and tints
//    her ambient with it: a sunset, the vending machine or a neon sign colours the side facing it, while the
//    face's brightness stays flat (a luminance gradient on a toon face reads as muddy smudges).
//  * emitters: things that blink or move (crossing lamps, vending machine, street lamps) can't wait for a
//    capture, so tick() feeds up to MAX_EM of them straight to the shader each frame: soft wrap lighting that tints
//    and slightly brightens the side facing them, in step with their own on/off.
import * as THREE from 'three';
import { LightProbeGenerator } from 'three/addons/lights/LightProbeGenerator.js';

const MAX_EM = 12;

export function createGI(renderer) {
  const sh = { value: Array.from({ length: 9 }, () => new THREE.Vector3()) }, strength = { value: 0.6 };
  const emPos = { value: Array.from({ length: MAX_EM }, () => new THREE.Vector3()) };
  const emCol = { value: Array.from({ length: MAX_EM }, () => new THREE.Vector3()) };
  const emRange = { value: new Float32Array(MAX_EM).fill(1) }, emGain = { value: 1.2 };
  // same shape the weather code already drives on a DirectionalLight (color, intensity, position)
  const key = { color: new THREE.Color('#ffffff'), intensity: 2.5, position: new THREE.Vector3(-1, 1, 1) };
  const tmpC = new THREE.Color(), tmpV = new THREE.Vector3();
  const keyColor = { get value() { return tmpC.copy(key.color).multiplyScalar(key.intensity); } };
  const keyDir = { get value() { return tmpV.copy(key.position).normalize(); } };
  const cam = new THREE.CubeCamera(0.01, 30000, new THREE.WebGLCubeRenderTarget(32, { type: THREE.HalfFloatType }));
  return {
    key, strength, emGain,
    patch(mat) {
      mat.onBeforeCompile = (s) => {
        Object.assign(s.uniforms, { uGI: sh, uGIStrength: strength, uKeyColor: keyColor, uKeyDir: keyDir, uEmPos: emPos, uEmCol: emCol, uEmRange: emRange });
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', `#include <common>
            uniform vec3 uGI[ 9 ];
            uniform float uGIStrength;
            uniform vec3 uKeyColor;
            uniform vec3 uKeyDir;
            uniform vec3 uEmPos[ ${MAX_EM} ];
            uniform vec3 uEmCol[ ${MAX_EM} ];
            uniform float uEmRange[ ${MAX_EM} ];`)
          .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
            // tint only: the probe's brightness gradient on a toon face reads as muddy smudges, so keep its hue
            vec3 giIrr = max( getLightProbeIrradiance( uGI, geometryNormal ), vec3( 0.0 ) );
            float giLum = dot( giIrr, vec3( 0.2126, 0.7152, 0.0722 ) );
            vec3 giTint = giLum > 1e-4 ? clamp( giIrr / giLum, 0.0, 2.0 ) : vec3( 1.0 );
            irradiance *= mix( vec3( 1.0 ), giTint, uGIStrength );
            for ( int i = 0; i < ${MAX_EM}; i ++ ) {
              vec3 toEm = ( viewMatrix * vec4( uEmPos[ i ], 1.0 ) ).xyz - geometryPosition;
              float d = length( toEm ), fall = clamp( 1.0 - d / uEmRange[ i ], 0.0, 1.0 );
              vec3 L = toEm / max( d, 1e-4 );
              float wrap = clamp( ( dot( geometryNormal, L ) + 0.4 ) / 1.4, 0.0, 1.0 );
              irradiance += uEmCol[ i ] * fall * wrap;
              // light from behind her (the crossing lamps) shows as a coloured rim on the silhouette, anime style
              // only the edge on the light's side: its direction projected onto the screen plane picks left/right
              vec3 Ls = L - geometryViewDir * dot( L, geometryViewDir );
              float side = saturate( dot( geometryNormal, Ls / max( length( Ls ), 1e-4 ) ) );
              float rim = pow( 1.0 - saturate( dot( geometryNormal, geometryViewDir ) ), 3.0 ) * saturate( dot( L, - geometryViewDir ) ) * mix( 0.1, 1.0, side );
              reflectedLight.directSpecular += uEmCol[ i ] * fall * rim * 0.5;
            }
            IncidentLight keyLight;
            keyLight.direction = normalize( ( viewMatrix * vec4( uKeyDir, 0.0 ) ).xyz );
            keyLight.color = uKeyColor;
            keyLight.visible = true;
            RE_Direct( keyLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );`);
      };
      mat.customProgramCacheKey = () => 'gi';
      mat.needsUpdate = true;
    },
    tick(emitters) {
      for (let i = 0; i < MAX_EM; i++) {
        const e = emitters[i], col = emCol.value[i];
        let on = !!e;
        e?.obj.traverseAncestors((a) => { on &&= a.visible; });
        if (!on) { col.set(0, 0, 0); continue; }
        e.obj.getWorldPosition(emPos.value[i]);
        emRange.value[i] = e.range * e.obj.getWorldScale(tmpV).x;
        col.set(e.color.r, e.color.g, e.color.b).multiplyScalar(e.power() * emGain.value);
      }
    },
    async capture(scene, at, hide) {
      hide.visible = false; cam.position.copy(at); cam.update(renderer, scene); hide.visible = true;
      const probe = await LightProbeGenerator.fromCubeRenderTarget(renderer, cam.renderTarget);
      probe.sh.coefficients.forEach((c, i) => sh.value[i].copy(c));
    },
  };
}
