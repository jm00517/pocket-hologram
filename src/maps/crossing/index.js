// Map: the Kamakura-Kokomae style railway crossing. Wraps Crossing (world), Weather (sky/sun/look presets) and
// Foliage (grass, plants, trees) into one MapInstance. Weather is a param; walking the subject is a command.
import * as THREE from 'three';
import { defineMap } from '../../../engine/index.js';
import { createCrossing, REFS, groundY } from './Crossing.js';
import { createWeather } from './Weather.js';
import { addFoliage, useWind } from './Foliage.js';

/** @param {{ weather?: string, foliage?: 'full'|'grass'|'off' }} opts */
export const crossingMap = ({ weather = 'sunset', foliage = 'full' } = {}) => defineMap({
  id: 'crossing',
  label: '踏切',
  doc: 'Seaside railway crossing (Enoden style): sea, Route 134, hill, vending machines, train every ~42 s. Look comes from the weather param.',
  create(ctx) {
    useWind(ctx.wind.uniforms);
    const crossing = createCrossing(ctx.renderer);
    const w = createWeather({ renderer: ctx.renderer, scene: ctx.scene, crossing, post: ctx.post, ambient: ctx.ambient, key: ctx.key });
    let fol = null, current = weather, bell = false;
    if (foliage !== 'off') addFoliage(crossing.group, ctx.renderer, { models: foliage === 'full' }).then((f) => { fol = f; }).catch((e) => console.error('foliage', e));
    // Walking: she stays at the stage origin and the crossing slides under her (her physics never sees a jump);
    // the camera moves with the world, so on screen it's her that moves.
    const focus = new THREE.Vector3();
    let gi = 0;
    const moveTo = (p) => {
      const U = ctx.units;
      ctx.camera.position.addScaledVector(p.clone().sub(focus), -U);
      focus.copy(p); crossing.group.position.copy(p).multiplyScalar(-U); crossing.setFocus(p);
      clearTimeout(gi); gi = setTimeout(ctx.captureGI, 300); // re-shoot her bounce light where she landed
    };
    // what she looks at (Life.js), in crossing metres -> stage metres (the crossing slides under her when she walks)
    const at = (x, y, z) => [x - focus.x, y - focus.y, z - focus.z];
    const SPOTS = [['vending', 4.0, 1.4, -3.0], ['vending', -4.35, 1.4, -2.2], ['sea', -6, 0.5, -70], ['track', -18, 1.5, -11], ['mirror', 3, 2.2, -8], ['sky', 25, 40, -120]];
    // sound: waves always, the season's insects by the hour, rain in rain; the real crossing (bells, the train,
    // the gate lifting) from the track. The recording's train is 36 s in; ours reaches the road 5 s after the bells.
    const A = 'assets/audio/', bed = (f) => ctx.sound(A + f, { gain: 0 });
    const beds = { waves: bed('waves.mp3'), cicadas: bed('cicadas.mp3'), higurashi: bed('higurashi.mp3'), night: bed('night-insects.mp3'), rain: bed('town-rain.mp3') };
    const MIX = { day: { waves: 0.45, cicadas: 0.35 }, anime: { waves: 0.45, cicadas: 0.35 }, sunset: { waves: 0.45, higurashi: 0.4 },
      night: { waves: 0.4, night: 0.45 }, neon: { waves: 0.3, night: 0.35 }, rain: { waves: 0.25, rain: 0.6 }, snow: { waves: 0.3 } };
    const bells = ctx.sound(A + 'crossing.mp3', { loop: false, at: [0, 2, -11], ref: 6, gain: 0.9 }); crossing.group.add(bells);
    crossing.onTrain = (k) => {
      if (k === 'coming' && bells.buffer) { if (bells.isPlaying) bells.stop(); bells.offset = 31; bells.play(); }
      ctx.cue(k === 'coming'
      ? { p: at(-35, 2, -11), label: 'train coming', line: 'あ、でんしゃ！', hold: 3 }
      : { p: at(0, 2, -11), label: 'train passing', gesture: 'wave', line: 'ばいばーい', hold: 3.5 });
    };
    return {
      group: crossing.group,
      interests: () => SPOTS.map(([label, x, y, z]) => ({ p: at(x, y, z), label })),
      emitters: REFS.emitters,
      walkable: REFS.walkable,
      moveTo,
      params: [
        { id: 'weather', label: '날씨', type: 'enum', values: w.list(), doc: 'Weather / time-of-day preset: sky HDRI, sun, fog, character light, grade, wet road, snow, night lights.',
          get: () => current, set: async (v) => { current = await w.set(v, ctx.units); ctx.changed(); } },
        { id: 'sun', label: '해', doc: 'Sun (directional light) intensity.', min: 0, max: 8, step: 0.05, get: () => crossing.sun.intensity, set: (v) => { crossing.sun.intensity = v; } },
        { id: 'bell', label: '종소리', type: 'bool', doc: 'Crossing bell sound while the lights flash.', get: () => bell, set: (v) => { bell = v; crossing.setSound(v); } },
      ],
      commands: {
        moveTo: { doc: 'Walk the subject to (x, z) in crossing metres; y follows the hill. x across the road, z toward the sea is negative.', args: { x: 'm', z: 'm' },
          run: ({ x = 0, z = 0 }) => { moveTo(new THREE.Vector3(x, groundY(z), z)); return { x, z }; } },
      },
      async fit(scene, U) {
        crossing.fit(scene, U); crossing.group.position.copy(focus).multiplyScalar(-U); // a new character height changes U: the walked-to spot keeps up
        current = await w.set(current, U);
      },
      unfit(scene) { crossing.unfit(scene); },
      tick(t, { dt }) {
        crossing.tick(t, dt); w.tick(t, dt); fol?.tick(t);
        const mix = MIX[current] ?? MIX.day;
        for (const [k, s] of Object.entries(beds)) ctx.fade(s, mix[k] ?? 0, dt);
      },
    };
  },
});
