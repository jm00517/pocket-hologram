// Public entry of the engine package. Start here: engine/INDEX.md (map of everything), engine/types.d.ts
// (every interface, documented). Peer dependency: three@0.170 (bare 'three' import; importmap or bundler).
export { createEngine } from './core/Engine.js';
export { createParams } from './core/Params.js';
export { loadSky } from './core/Sky.js';
export { connectBridge } from './bridge/client.js';

/**
 * Declare a map. Returns the definition unchanged after checking its shape, so map files read as data.
 * @param {import('./types').MapDef} def
 * @returns {import('./types').MapDef}
 */
export function defineMap(def) {
  for (const k of ['id', 'label', 'create']) if (!def?.[k]) throw new Error(`defineMap: missing ${k}`);
  return def;
}
