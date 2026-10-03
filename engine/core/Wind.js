// One wind for the whole world: grass, trees, flags, curtains and clouds all read it, so changing it once
// changes everything consistently. Params: wind.speed (m/s), wind.dir (deg), wind.gust (0..1).
//   dir: where the wind blows TOWARD, measured from straight ahead (-z, away from the viewer); 90 = to the right (+x)
//   vector: m/s in stage metres (y = 0)
//   uniforms (share these objects in shaders; declare with WIND_GLSL):
//     uWindDir   vec2 unit direction on xz
//     uWindAmp   sway amplitude: 1 at 4 m/s, grows with speed, pulses with gusts
//     uWindPhase use instead of time in sway sines: runs faster in stronger wind without jumping when speed changes
//     uWindSpeed m/s
import * as THREE from 'three';

export const WIND_GLSL = 'uniform vec2 uWindDir;\nuniform float uWindAmp, uWindPhase, uWindSpeed;\n';

export function createWind({ speed = 4, dir = 90, gust = 0.4 } = {}) {
  const uniforms = {
    uWindDir: { value: new THREE.Vector2(1, 0) }, uWindAmp: { value: 1 }, uWindPhase: { value: 0 }, uWindSpeed: { value: speed },
  };
  const wind = {
    speed, dir, gust, uniforms,
    vector: new THREE.Vector3(),
    tick(dt, t) {
      const a = THREE.MathUtils.degToRad(wind.dir), s = Math.sin(a), c = Math.cos(a);
      uniforms.uWindDir.value.set(s, -c);
      wind.vector.set(s * wind.speed, 0, -c * wind.speed);
      const g = 1 + wind.gust * (0.6 * Math.sin(t * 0.37) + 0.4 * Math.sin(t * 0.91 + 1.3)); // slow gusts
      uniforms.uWindAmp.value = (wind.speed / 4) * Math.max(0, g);
      uniforms.uWindSpeed.value = wind.speed;
      uniforms.uWindPhase.value += dt * (0.7 + 0.075 * wind.speed);
    },
    params: [
      { id: 'wind.speed', label: '바람 세기', doc: 'Wind speed, m/s. Sways foliage/flags/curtains and drives the clouds.', min: 0, max: 25, step: 0.1, get: () => wind.speed, set: (v) => { wind.speed = v; } },
      { id: 'wind.dir', label: '바람 방향', doc: 'Direction the wind blows toward, degrees: 0 = away from the viewer (-z), 90 = to the right (+x).', min: 0, max: 360, step: 1, get: () => wind.dir, set: (v) => { wind.dir = v; } },
      { id: 'wind.gust', label: '돌풍', doc: 'Gustiness 0..1: slow pulsing of the sway amplitude.', min: 0, max: 1, step: 0.01, get: () => wind.gust, set: (v) => { wind.gust = v; } },
    ],
  };
  wind.tick(0, 0);
  return wind;
}
