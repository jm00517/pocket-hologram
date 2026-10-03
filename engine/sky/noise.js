// Tileable 3D cloud noise, 64^3 RG8: R = Perlin-Worley (cloud shape), G = Worley fbm (erosion detail).
// Built on the CPU once (~0.3 s) and cached.
import * as THREE from 'three';

let cached = null;
export const getCloudNoise = () => (cached ??= cloudNoise());

// --- tileable 3D noise: R = Perlin-Worley (shape), G = Worley fbm (erosion detail) -----------------------------
export function cloudNoise(N = 64) {
  let s = 1; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const worley = (P) => {
    const pts = Float32Array.from({ length: P * P * P * 3 }, rnd);
    return (x, y, z) => {
      const fx = x * P, fy = y * P, fz = z * P, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      let d = 9;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx, cy = iy + dy, cz = iz + dz, c = ((((cz % P) + P) % P) * P + (((cy % P) + P) % P)) * P + (((cx % P) + P) % P);
        const ox = cx + pts[c * 3] - fx, oy = cy + pts[c * 3 + 1] - fy, oz = cz + pts[c * 3 + 2] - fz, q = ox * ox + oy * oy + oz * oz;
        if (q < d) d = q;
      }
      return Math.max(0, 1 - Math.sqrt(d));
    };
  };
  const value = (P) => {
    const v = Float32Array.from({ length: P * P * P }, rnd), at = (x, y, z) => v[(((z + P) % P) * P + ((y + P) % P)) * P + ((x + P) % P)];
    const sm = (t) => t * t * (3 - 2 * t), lerp = (a, b, t) => a + (b - a) * t;
    return (x, y, z) => {
      const fx = x * P, fy = y * P, fz = z * P, ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      const tx = sm(fx - ix), ty = sm(fy - iy), tz = sm(fz - iz);
      return lerp(lerp(lerp(at(ix, iy, iz), at(ix + 1, iy, iz), tx), lerp(at(ix, iy + 1, iz), at(ix + 1, iy + 1, iz), tx), ty),
        lerp(lerp(at(ix, iy, iz + 1), at(ix + 1, iy, iz + 1), tx), lerp(at(ix, iy + 1, iz + 1), at(ix + 1, iy + 1, iz + 1), tx), ty), tz);
    };
  };
  const [w4, w8, w16, w32] = [4, 8, 16, 32].map(worley), [v4, v8, v16, v32] = [4, 8, 16, 32].map(value);
  const raw = new Float32Array(N * N * N * 2);
  for (let z = 0, i = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++, i++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N, w = (z + 0.5) / N;
    const wf = w4(u, v, w) * 0.625 + w8(u, v, w) * 0.25 + w16(u, v, w) * 0.125;
    const pf = (v4(u, v, w) * 0.5 + v8(u, v, w) * 0.25 + v16(u, v, w) * 0.125 + v32(u, v, w) * 0.0625) / 0.9375;
    const shape = Math.min(1, Math.max(0, (pf - (wf - 1)) / (2 - wf))); // remap(perlin, worley - 1, 1, 0, 1)
    const detail = w8(u, v, w) * 0.625 + w16(u, v, w) * 0.25 + w32(u, v, w) * 0.125;
    raw[i * 2] = shape; raw[i * 2 + 1] = detail;
  }
  // stretch each channel to the full byte range: the raw fbm bunches up around its mean
  const data = new Uint8Array(raw.length);
  for (let c = 0; c < 2; c++) {
    let lo = 1, hi = 0;
    for (let i = c; i < raw.length; i += 2) { lo = Math.min(lo, raw[i]); hi = Math.max(hi, raw[i]); }
    for (let i = c; i < raw.length; i += 2) data[i] = ((raw[i] - lo) / (hi - lo)) * 255;
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGFormat; t.type = THREE.UnsignedByteType; t.unpackAlignment = 1;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

