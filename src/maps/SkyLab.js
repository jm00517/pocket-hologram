// Sky lab (하늘 실험실): an empty plain under the engine's volumetric sky (engine/sky/VolumetricSky.js), for working
// on the sky alone. The ground takes the clouds' moving shadows and the rays' haze; the sun light on the
// character follows the cloud shadow where she stands, so she steps in and out of sunlight as the clouds pass.
import * as THREE from 'three';
import { createVolumetricSky, createSkyLights } from '../../engine/sky/VolumetricSky.js';

export function createSkyLab({ renderer, wind, ambient, key }) {
  const g = new THREE.Group(); g.name = 'skylab'; g.visible = false;
  const sky = createVolumetricSky(renderer, { wind });
  const lights = createSkyLights(sky, { ambient, key });
  g.add(sky.dome, lights.group);
  // the disc fades out at its rim into the sky pass's own distant ground (the camera's far plane is ~2.4 km)
  const rim = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    const gr = x.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0.7, '#fff'); gr.addColorStop(1, '#000'); x.fillStyle = gr; x.fillRect(0, 0, 256, 256); return c; })());
  const groundMat = sky.patchReceiver(new THREE.MeshStandardMaterial({ color: '#7b8a68', roughness: 1, alphaMap: rim, transparent: true }), { aerial: true });
  groundMat.userData.outlineParameters = { visible: false };
  const ground = new THREE.Mesh(new THREE.CircleGeometry(2000, 96).rotateX(-Math.PI / 2), groundMat);
  ground.receiveShadow = true; g.add(ground);
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
      lights.fitShadow(U, 10);
      scene.fog = null; // the receiver patch puts real haze on the ground
    },
    tick(t, { dt, camera }) {
      g.getWorldPosition(origin);
      sky.tick(t, dt, camera, { origin, U: units });
      lights.update();
    },
  };
}
