// Sky lab (하늘 실험실): an empty plain under the engine's volumetric sky (engine/sky/VolumetricSky.js), for working
// on the sky alone. The ground takes the clouds' moving shadows and the rays' haze; the sun light on the
// character follows the cloud shadow where she stands, so she steps in and out of sunlight as the clouds pass.
import * as THREE from 'three';
import { createVolumetricSky } from '../../engine/sky/VolumetricSky.js';

export function createSkyLab(renderer, wind) {
  const g = new THREE.Group(); g.name = 'skylab'; g.visible = false;
  const sky = createVolumetricSky(renderer, { wind });
  g.add(sky.dome);
  // the disc fades out at its rim into the sky pass's own distant ground (the camera's far plane is ~2.4 km)
  const rim = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    const gr = x.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0.7, '#fff'); gr.addColorStop(1, '#000'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); return c; })());
  const groundMat = sky.patchReceiver(new THREE.MeshStandardMaterial({ color: '#7b8a68', roughness: 1, alphaMap: rim, transparent: true }), { aerial: true });
  groundMat.userData.outlineParameters = { visible: false };
  const ground = new THREE.Mesh(new THREE.CircleGeometry(2000, 96).rotateX(-Math.PI / 2), groundMat);
  ground.receiveShadow = true; g.add(ground);
  const SUN = 3.2; // full sun; scaled by the cloud shadow at the character every frame
  const sun = new THREE.DirectionalLight('#fff2e0', SUN);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004;
  const target = new THREE.Object3D(); sun.target = target;
  const fill = new THREE.HemisphereLight('#c8d2e2', '#4a4f44', 0.7);
  g.add(sun, target, fill);
  const origin = new THREE.Vector3();
  let units = 1;
  return {
    group: g,
    look: { exposure: 1.0, amb: ['#c8ccd4', 1.0], key: ['#ffffff', 0.9], keyDir: new THREE.Vector3(0.3, 0.6, 1), gi: 0.6,
      grade: { tint: [1, 1, 1], sat: 1.05, contrast: 1.05, sepia: 0, vignette: 0.15 }, bloom: 0.35, bloomThreshold: 1.2 },
    params: sky.params,
    sky,
    async fit(scene, U) {
      units = U; g.scale.setScalar(U);
      const cam = sun.shadow.camera; cam.left = cam.bottom = -10 * U; cam.right = cam.top = 10 * U; cam.near = 1 * U; cam.far = 120 * U; cam.updateProjectionMatrix();
      scene.fog = null; // the receiver patch puts real haze on the ground
    },
    tick(t, { dt, camera }) {
      g.getWorldPosition(origin);
      sky.tick(t, dt, camera, { origin, U: units });
      sun.position.copy(sky.sunDir).multiplyScalar(40).add(target.position);
      sun.intensity = SUN * sky.sunlight;
    },
  };
}
