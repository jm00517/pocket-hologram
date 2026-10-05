// Every map this app ships, in menu order. A map = defineMap({ id, label, doc, create(ctx) -> MapInstance })
// (contract: engine/types.d.ts). Add one by writing a module and listing it here.
import { defineMap } from '../../engine/index.js';
import { crossingMap } from './crossing/index.js';
import { createClassroom } from './Classroom.js';
import { createPool } from './Pool.js';
import { createSkyLab } from './SkyLab.js';
import { createCitadel } from './Citadel.js';

export const allMaps = (opts = {}) => [
  crossingMap(opts.crossing),
  defineMap({ id: 'classroom', label: '放課後の教室', doc: 'After-school classroom at sunset: low sun through the window wall, light shafts with dust, curtains, chalkboard.', create: (ctx) => createClassroom(ctx.renderer, ctx.wind.uniforms) }),
  defineMap({ id: 'pool', label: '学校のプール', doc: 'School pool, midsummer: mirror water with caustics, lane ropes, flags, school building.', create: (ctx) => createPool(ctx.renderer, ctx.wind.uniforms) }),
  defineMap({ id: 'citadel', label: '성채의 초원', doc: 'Windswept meadow above a river plain; 1.2-2 km out, a white city of seven tiers built against a mountain, split by a rock prow, under the engine volumetric sky. Params: citadel.* (the sky params, plus aerial and lights).', create: (ctx) => createCitadel(ctx) }),
  defineMap({ id: 'sky', label: '하늘 실험실', doc: 'Empty plain under the engine volumetric sky: fluid-simulated clouds driven by wind.*, silver lining, crepuscular rays, moving cloud shadows on the ground and the character. Params: sky.*', create: (ctx) => createSkyLab(ctx) }),
];
