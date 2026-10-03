// The engine: renderer + post chain + character lighting + map lifecycle + param registry + command surface.
// It knows nothing about the app (tracking, calibration, UI, which character); the app drives the camera from
// an 'beforeFrame' listener and hands over the character with setSubject(). Full API: engine/types.d.ts (Engine).
import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { createPost } from './Post.js';
import { createGI } from './GI.js';
import { createParams } from './Params.js';
import { createWind } from './Wind.js';

// Lights/post for "no map" (and the shape every map's `look` follows; see MapLook in types.d.ts).
const DEFAULT_LOOK = { exposure: 1, grade: null, bloom: 0.35, bloomThreshold: 1.15, amb: ['#aaaaaa', 2], key: ['#ffffff', 2.5], keyDir: [-1, 1, 1], gi: 0.6 };
const SUBJECT_HEIGHT_M = 1.6; // the subject is taken to be this tall: scene units per metre U = height / 1.6

export function createEngine({ canvas, far = 30000, maxPixelRatio = 2 } = {}) {
  // antialias off: the post chain antialiases (4x MSAA target + SMAA); the canvas only gets a fullscreen quad
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, maxPixelRatio));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1; // applied by the post chain's OutputPass
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x03050a);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, far);
  const stage = new THREE.Group(); scene.add(stage); // floor point under the subject; maps and the subject live here
  const ambient = new THREE.AmbientLight(0xaaaaaa, 2); scene.add(ambient);
  const gi = createGI(renderer), key = gi.key;
  const outline = new OutlineEffect(renderer); // MMD-style ink lines, subject only (maps set outlineParameters.visible=false)
  const post = createPost(renderer, scene, camera, outline);
  const params = createParams();
  const wind = createWind();
  const listeners = {};
  const emit = (ev, ...a) => { for (const f of listeners[ev] ?? []) f(...a); };

  const defs = new Map(), instances = new Map();
  let wanted = null, active = null, inst = null, subject = null, subjectH = 0, U = 1, token = 0;

  const applyLook = (L) => {
    renderer.toneMappingExposure = L.exposure ?? 1; post.grade(L.grade ?? null);
    post.bloom.strength = L.bloom ?? 0.35; post.bloom.threshold = L.bloomThreshold ?? 1.15;
    ambient.color.set(L.amb[0]); ambient.intensity = L.amb[1]; key.color.set(L.key[0]); key.intensity = L.key[1];
    key.position.set(...(L.keyDir.isVector3 ? L.keyDir.toArray() : L.keyDir)); gi.strength.value = L.gi ?? 0.6;
  };
  const captureGI = () => subject && gi.capture(scene, subject.getWorldPosition(new THREE.Vector3()).setY(stage.position.y + subjectH * 0.6), subject);
  const resetScene = () => {
    scene.fog = null; scene.environment = null; scene.background = new THREE.Color(0x03050a);
    scene.backgroundRotation.set(0, 0, 0); scene.environmentRotation.set(0, 0, 0); scene.backgroundIntensity = 1; scene.environmentIntensity = 1;
  };
  // stage metres <-> world
  const toWorld = (p) => stage.localToWorld(new THREE.Vector3(...p).multiplyScalar(U));
  const toMetres = (v) => stage.worldToLocal(v.clone()).divideScalar(U).toArray().map((x) => +x.toFixed(3));

  // map lifecycle context: what a map's create() gets (MapContext in types.d.ts)
  const ctx = {
    renderer, scene, camera, stage, post, gi, ambient, key, params, wind,
    get units() { return U; },
    captureGI: () => captureGI(),
    /** call when a map changed its lights/sky by itself (e.g. a weather switch): re-shoots GI, tells UIs */
    changed() { captureGI(); emit('baseline'); },
  };

  const coreParams = [
    ['render.exposure', '노출', 'Tone-mapping exposure.', () => renderer.toneMappingExposure, (v) => { renderer.toneMappingExposure = v; }, 0.3, 2, 0.01],
    ['light.ambient', '앰비언트', 'Ambient light intensity (lights the character mostly).', () => ambient.intensity, (v) => { ambient.intensity = v; }, 0, 3, 0.01],
    ['light.key', '키라이트', "Character-only key light intensity (toon shading's lit band).", () => key.intensity, (v) => { key.intensity = v; }, 0, 6, 0.05],
    ['gi.tint', 'GI 색조', 'How much the captured surroundings tint the character (hue only).', () => gi.strength.value, (v) => { gi.strength.value = v; }, 0, 1.5, 0.01],
    ['gi.emitters', '발광체 빛', 'Gain of real-time emitters (lamps, vending machines) on the character.', () => gi.emGain.value, (v) => { gi.emGain.value = v; }, 0, 5, 0.05],
    ['env.reflect', '하늘 반사', 'scene.environmentIntensity: image-based light on PBR surfaces.', () => scene.environmentIntensity, (v) => { scene.environmentIntensity = v; }, 0, 2, 0.01],
    ['env.background', '하늘 밝기', 'scene.backgroundIntensity: brightness of an HDRI background.', () => scene.backgroundIntensity, (v) => { scene.backgroundIntensity = v; }, 0, 2, 0.01],
    ['post.bloom', '블룸', 'Bloom strength.', () => post.bloom.strength, (v) => { post.bloom.strength = v; }, 0, 2, 0.01],
    ['post.bloomThreshold', '블룸 기준', 'HDR luminance where bloom starts.', () => post.bloom.threshold, (v) => { post.bloom.threshold = v; }, 0.2, 3, 0.01],
    ['post.ao', 'AO', 'Ambient occlusion blend.', () => post.ao.blendIntensity, (v) => { post.ao.blendIntensity = v; }, 0, 1.5, 0.01],
    ['grade.sat', '채도', 'Colour grade: saturation.', () => post.gradeU.sat.value, (v) => { post.gradeU.sat.value = v; }, 0, 2, 0.01],
    ['grade.contrast', '대비', 'Colour grade: contrast.', () => post.gradeU.contrast.value, (v) => { post.gradeU.contrast.value = v; }, 0.5, 1.5, 0.01],
    ['grade.sepia', '세피아', 'Colour grade: sepia mix.', () => post.gradeU.sepia.value, (v) => { post.gradeU.sepia.value = v; }, 0, 1, 0.01],
    ['grade.vignette', '비네트', 'Colour grade: vignette.', () => post.gradeU.vignette.value, (v) => { post.gradeU.vignette.value = v; }, 0, 1, 0.01],
  ].map(([id, label, doc, get, set, min, max, step]) => ({ id, label, doc, get, set, min, max, step }));
  params.define(coreParams);
  params.define(wind.params);

  const commands = new Map();
  const command = (name, doc, args, run) => commands.set(name, { name, doc, args, run, owner: 'engine' });

  const engine = {
    renderer, scene, camera, stage, post, gi, ambient, key, params, wind,
    /** 'rig': the app drives the camera (head-coupled window, free cam). 'manual': set by the camera command. */
    cameraMode: 'rig',
    get units() { return U; },
    get map() { return active; },
    get mapInstance() { return inst; },
    get subject() { return subject; },
    on(ev, f) { (listeners[ev] ??= new Set()).add(f); return () => listeners[ev].delete(f); },

    registerMap(def) {
      if (!def?.id || typeof def.create !== 'function') throw new Error('registerMap: needs { id, create(ctx) }');
      defs.set(def.id, def); return engine;
    },
    maps: () => [...defs.values()].map(({ id, label, doc }) => ({ id, label, doc, active: id === active })),

    /** Switch map (null = none). Waits for the map's sky/textures. Before a subject exists it is only remembered. */
    async setMap(id) {
      if (id && !defs.has(id)) throw new Error(`unknown map ${id}; maps: ${[...defs.keys()].join(', ')}`);
      wanted = id ?? null;
      if (!subject) return null;
      const my = ++token;
      if (inst && active !== wanted) inst.unfit?.(scene);
      for (const i of instances.values()) i.group.visible = false;
      params.remove('map'); for (const [n, c] of commands) if (c.owner === 'map') commands.delete(n);
      resetScene();
      active = wanted; inst = null;
      if (!active) { applyLook(DEFAULT_LOOK); post.setScale(U); captureGI(); emit('map', null); emit('baseline'); return null; }
      if (!instances.has(active)) { const i = defs.get(active).create(ctx); instances.set(active, i); stage.add(i.group); }
      inst = instances.get(active);
      inst.group.visible = true;
      params.define((inst.params ?? []).map((p) => ({ ...p, id: `${active}.${p.id}` })), 'map');
      for (const [n, c] of Object.entries(inst.commands ?? {})) commands.set(`${active}.${n}`, { ...c, name: `${active}.${n}`, owner: 'map' });
      if (inst.look) applyLook(inst.look);
      post.setScale(U);
      await inst.fit(scene, U);
      if (my !== token) return active; // superseded by a later switch
      captureGI(); emit('map', active); emit('baseline');
      return active;
    },

    /** The character (or any object) the world is scaled to. height in scene units (default: bbox). */
    async setSubject(obj, { height } = {}) {
      subject = obj;
      subjectH = height ?? new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).y;
      U = subjectH / SUBJECT_HEIGHT_M;
      obj.traverse((m) => { if (m.isMesh) { for (const mat of [].concat(m.material)) gi.patch(mat); m.castShadow = true; } });
      return engine.setMap(wanted);
    },
    clearSubject() { subject = null; },
    captureGI,
    toWorld, toMetres,

    // --- command surface (what the bridge and agents call) ---
    commands: () => [...commands.values()].map(({ name, doc, args }) => ({ name, doc, args })),
    async call(name, args = {}) {
      const c = commands.get(name);
      if (!c) throw new Error(`unknown command ${name}; commands: ${[...commands.keys()].join(', ')}`);
      return c.run(args ?? {});
    },
    describe() {
      return {
        units: { perMetre: U, subjectHeight: subjectH, note: 'positions in commands are metres from the floor point under the subject' },
        maps: engine.maps(),
        params: params.list().map(({ id, label, doc, type, min, max, step, values, owner }) => ({ id, label, doc, type, min, max, step, values, owner, value: params.get(id) })),
        commands: engine.commands(),
        state: engine.state(),
      };
    },
    state() {
      return { map: active, params: params.values(), camera: { mode: engine.cameraMode, position: toMetres(camera.position) } };
    },
    async load(st) {
      if (st.map !== undefined && st.map !== active) await engine.setMap(st.map);
      if (st.params) await params.setMany(st.params);
      if (st.camera?.position) engine.setCamera(st.camera);
      return engine.state();
    },
    /** {position, target} in stage metres -> manual camera; {mode:'rig'} hands it back to the app. */
    setCamera({ position, target, fov = 60, mode } = {}) {
      if (mode === 'rig') { engine.cameraMode = 'rig'; return engine.state().camera; }
      engine.cameraMode = 'manual';
      if (position) camera.position.copy(toWorld(position));
      if (target) camera.lookAt(toWorld(target));
      camera.fov = fov; camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
      return engine.state().camera;
    },
    /** -> { dataUrl, width, height }. width downsizes (keeps aspect). */
    snapshot({ type = 'image/jpeg', quality = 0.85, width } = {}) {
      post.render();
      const src = renderer.domElement;
      if (!width || width >= src.width) return { dataUrl: src.toDataURL(type, quality), width: src.width, height: src.height };
      const c = document.createElement('canvas'); c.width = width; c.height = Math.round((src.height * width) / src.width);
      c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
      return { dataUrl: c.toDataURL(type, quality), width: c.width, height: c.height };
    },
    /** GPU ms per pass; waits for one 60-frame window on first use. */
    async perf() {
      const s = post.profile(); if (!s) return { error: 'no EXT_disjoint_timer_query_webgl2' };
      const f0 = s.frames; for (let i = 0; i < 100 && s.frames === f0; i++) await new Promise((r) => setTimeout(r, 100));
      return { ...s };
    },
    resize(w = innerWidth, h = innerHeight) { renderer.setSize(w, h, false); post.setSize(w, h, renderer.getPixelRatio()); },
    start() {
      const clock = new THREE.Clock();
      const frame = () => {
        const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
        emit('beforeFrame', dt, t);
        wind.tick(dt, t);
        inst?.tick?.(t, { dt, camera });
        gi.tick(inst?.emitters ?? []);
        post.render();
        emit('afterFrame', dt, t);
        requestAnimationFrame(frame);
      };
      frame();
    },
  };

  command('describe', 'Everything an agent needs: maps, params (with ranges/docs/values), commands, state.', {}, () => engine.describe());
  command('state', 'Current map, every param value, camera.', {}, () => engine.state());
  command('load', 'Restore a state() object.', { state: 'object from state()' }, ({ state }) => engine.load(state));
  command('map', 'Switch map (null = none).', { id: 'map id | null' }, ({ id }) => engine.setMap(id ?? null));
  command('get', 'Param values (all, or the listed ids).', { ids: 'string[]?' }, ({ ids }) => (ids ? Object.fromEntries(ids.map((i) => [i, params.get(i)])) : params.values()));
  command('set', 'Set params; validated and clamped. Returns all values.', { values: '{ id: value }' }, ({ values }) => params.setMany(values));
  command('snapshot', 'Render and return the frame as a data URL.', { type: "'image/jpeg' | 'image/png'", quality: '0..1', width: 'px, optional downscale' }, (a) => engine.snapshot(a));
  command('perf', 'GPU ms per post pass, fps, draws, triangles (averaged over 60 frames).', {}, () => engine.perf());
  command('camera', 'Place the camera in stage metres ({position,target,fov}); {mode:"rig"} returns control to the app.', { position: '[x,y,z]', target: '[x,y,z]', fov: 'deg', mode: "'rig'" }, (a) => engine.setCamera(a));
  command('eval', 'Run JS in the page: new Function("engine","THREE", code). Return value must be JSON-able.', { code: 'string' }, ({ code }) => new Function('engine', 'THREE', code)(engine, THREE));
  return engine;
}
