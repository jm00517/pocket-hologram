// Equirect HDRI sky for background + image-based lighting, plus where its sun is.
//   loadSky(renderer, url, { sat, tame }) -> Promise<{ tex, env, sun }>
//   tex: background texture (optionally saturated / with a bright moon tamed), env: PMREM for scene.environment
//   (always from the untouched photo), sun: unit vector toward the brightest pixel, in three's equirect frame.
// Cached per (url, sat, tame).
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const skies = {};
export async function loadSky(renderer, url, { sat = 1, tame = null } = {}) {
  const id = `${url}|${sat}|${tame}`;
  if (skies[id]) return skies[id];
  const tex = await new RGBELoader().loadAsync(url);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const { width: w, height: h, data } = tex.image;
  const f = data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat : (x) => x;
  let best = -1, bi = 0;
  for (let i = 0; i < w * h; i += 2) {
    const L = 0.2126 * f(data[i * 4]) + 0.7152 * f(data[i * 4 + 1]) + 0.0722 * f(data[i * 4 + 2]);
    if (L > best) { best = L; bi = i; }
  }
  // three's equirect lookup: u = atan(z, x) / 2π + 0.5, v = asin(y) / π + 0.5 (rows flipped on upload)
  const u = ((bi % w) + 0.5) / w, v = 1 - (((bi / w) | 0) + 0.5) / h;
  const phi = (u - 0.5) * Math.PI * 2, theta = (v - 0.5) * Math.PI;
  const sun = new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi));
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromEquirectangular(tex).texture;
  pm.dispose();
  if (sat !== 1 || tame) { // background only: the env map above was baked from the original, so lighting is unchanged
    const to = data instanceof Uint16Array ? THREE.DataUtils.toHalfFloat : (x) => x;
    for (let i = 0; i < data.length; i += 4) {
      const r = f(data[i]), g = f(data[i + 1]), b = f(data[i + 2]), L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      // tame = [knee, disc]: a real-exposure moon (~5e4) and its photographed halo (7-9x the sky, 14°+ wide)
      // bloomed over half the screen. Keep a crisp disc, roll the halo off softly.
      const k = !tame ? 1 : L > 50 ? tame[1] / L : 1 / (1 + L / tame[0]);
      data[i] = to(Math.max(0, L + (r - L) * sat) * k); data[i + 1] = to(Math.max(0, L + (g - L) * sat) * k); data[i + 2] = to(Math.max(0, L + (b - L) * sat) * k);
    }
    tex.needsUpdate = true;
  }
  return (skies[id] = { tex, env, sun });
}
