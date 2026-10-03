// Interface stubs for the engine. Read this instead of the implementation: every public shape is here,
// with the file that implements it. Runtime is plain JS (ES modules); these types are documentation + editor help.
import type * as THREE from 'three';

// ---------------------------------------------------------------------------------------------------------
// Engine (engine/core/Engine.js: createEngine)
// ---------------------------------------------------------------------------------------------------------
export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** camera far plane, scene units (default 30000) */
  far?: number;
  /** cap on devicePixelRatio (default 2) */
  maxPixelRatio?: number;
}

export interface Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** floor point under the subject. Map groups and the subject are children; position it from the app. */
  stage: THREE.Group;
  post: Post;
  gi: GI;
  ambient: THREE.AmbientLight;
  /** the subject-only key light (see GI) */
  key: GI['key'];
  params: Params;
  wind: Wind;
  /** 'rig' = app moves the camera in its beforeFrame listener; 'manual' = set by setCamera/the camera command */
  cameraMode: 'rig' | 'manual';
  /** scene units per metre = subject height / 1.6 */
  readonly units: number;
  readonly map: string | null;
  readonly mapInstance: MapInstance | null;
  readonly subject: THREE.Object3D | null;

  on(event: 'beforeFrame' | 'afterFrame', fn: (dt: number, t: number) => void): () => void;
  /** after a map switch finished (id null = no map) */
  on(event: 'map', fn: (id: string | null) => void): () => void;
  /** lights/look were replaced wholesale (map switch, weather change): UIs re-read values, drop undo */
  on(event: 'baseline', fn: () => void): () => void;

  registerMap(def: MapDef): Engine;
  maps(): { id: string; label: string; doc?: string; active: boolean }[];
  /** null = no map. Resolves when the map's sky/textures are in. Before setSubject it only remembers the id. */
  setMap(id: string | null): Promise<string | null>;
  /** the object the world is scaled to (the character). Patches its materials for GI, enables its shadows. */
  setSubject(obj: THREE.Object3D, opts?: { height?: number }): Promise<string | null>;
  clearSubject(): void;
  /** re-shoot the subject's bounce-light probe */
  captureGI(): void;
  /** stage metres -> world / world -> stage metres */
  toWorld(p: [number, number, number]): THREE.Vector3;
  toMetres(v: THREE.Vector3): [number, number, number];

  /** every command available now (core + the active map's), for agents */
  commands(): CommandInfo[];
  call(name: string, args?: object): Promise<unknown>;
  describe(): Description;
  state(): State;
  load(state: Partial<State>): Promise<State>;
  setCamera(opts: { position?: Vec3; target?: Vec3; fov?: number; mode?: 'rig' }): State['camera'];
  snapshot(opts?: { type?: 'image/jpeg' | 'image/png'; quality?: number; width?: number }): Snapshot;
  /** starts GPU timing on first use and waits for a 60-frame window */
  perf(): Promise<PerfStats | { error: string }>;
  resize(w?: number, h?: number): void;
  /** starts the render loop: beforeFrame -> map.tick -> gi.tick(map.emitters) -> post.render -> afterFrame */
  start(): void;
}

export type Vec3 = [number, number, number];

export interface State {
  map: string | null;
  params: Record<string, number | string | boolean>;
  camera: { mode: Engine['cameraMode']; position: Vec3 };
}
export interface Description {
  units: { perMetre: number; subjectHeight: number; note: string };
  maps: ReturnType<Engine['maps']>;
  params: (Omit<ParamDef, 'get' | 'set'> & { owner: string; value: unknown })[];
  commands: CommandInfo[];
  state: State;
}
export interface Snapshot { dataUrl: string; width: number; height: number }
export interface PerfStats { frames: number; fps: number; width: number; height: number; draws: number; tris: number; gpu: number; passes: Record<string, number> }

// ---------------------------------------------------------------------------------------------------------
// Commands (engine/core/Engine.js; bridge: engine/bridge/*)
// Core: describe, state, load{state}, map{id}, get{ids?}, set{values}, snapshot{type,quality,width}, perf,
//       camera{position,target,fov | mode:'rig'}, eval{code}
// Map commands are namespaced: '<mapId>.<name>' (e.g. crossing.moveTo{x,z}), present only while that map is active.
// ---------------------------------------------------------------------------------------------------------
export interface CommandInfo { name: string; doc: string; args: Record<string, string> }
export interface MapCommand { doc: string; args?: Record<string, string>; run(args: any): unknown }

// ---------------------------------------------------------------------------------------------------------
// Params (engine/core/Params.js: createParams)
// ids: core 'render.*', 'light.*', 'gi.*', 'env.*', 'post.*', 'grade.*'; a map's own are '<mapId>.<id>'.
// ---------------------------------------------------------------------------------------------------------
export interface ParamDef {
  id: string;
  /** UI label (Korean in this app) */
  label: string;
  /** what it does, for agents */
  doc?: string;
  type?: 'number' | 'enum' | 'bool';
  min?: number; max?: number; step?: number;
  /** enum: [value, label][] */
  values?: [string, string][];
  get(): any;
  /** may be async (e.g. a weather switch); the value arrives validated and clamped */
  set(v: any): void | Promise<void>;
}
export interface Params {
  define(defs: ParamDef | ParamDef[], owner?: string): void;
  remove(owner: string): void;
  has(id: string): boolean;
  list(): (ParamDef & { owner: string })[];
  get(id: string): any;
  values(): Record<string, any>;
  set(id: string, v: any): Promise<any>;
  setMany(values: Record<string, any>): Promise<Record<string, any>>;
  onChange(fn: (id: string, v: any) => void): () => void;
}

// ---------------------------------------------------------------------------------------------------------
// Maps (contract; examples: src/maps/*)
// ---------------------------------------------------------------------------------------------------------
export interface MapDef {
  id: string;
  label: string;
  /** one or two sentences for agents: what's there, what the params do */
  doc?: string;
  /** called once, on first use; keep it synchronous (load assets in fit) */
  create(ctx: MapContext): MapInstance;
}
export interface MapContext {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; stage: THREE.Group;
  post: Post; gi: GI; ambient: THREE.AmbientLight; key: GI['key']; params: Params; wind: Wind;
  readonly units: number;
  captureGI(): void;
  /** the map replaced its lights/sky on its own (e.g. weather param): re-shoots GI and emits 'baseline' */
  changed(): void;
}
export interface MapInstance {
  /** authored in metres; the engine adds it to the stage. fit() scales it by U. */
  group: THREE.Group;
  /** applied before fit(); omit when fit() sets lights itself (the crossing's weather does) */
  look?: MapLook;
  /** called on every switch to this map: scale group by U, set sky/fog/env, load what's needed. The engine
   *  resets fog/background/environment before calling it. */
  fit(scene: THREE.Scene, U: number): void | Promise<void>;
  unfit?(scene: THREE.Scene): void;
  tick?(t: number, frame: { dt: number; camera: THREE.Camera }): void;
  /** registered as '<mapId>.<id>' while active */
  params?: ParamDef[];
  /** registered as '<mapId>.<name>' while active */
  commands?: Record<string, MapCommand>;
  /** real-time lights for the subject (see GI.tick) */
  emitters?: Emitter[];
  /** clickable ground + how to walk the subject there (map-local metres) */
  walkable?: THREE.Object3D[];
  moveTo?(p: THREE.Vector3): void;
}
/** lights and post a self-lit map wants; also the engine's default when there is no map */
export interface MapLook {
  exposure: number;
  amb: [color: string, intensity: number];
  key: [color: string, intensity: number];
  keyDir: THREE.Vector3 | Vec3;
  /** GI hue strength */
  gi?: number;
  grade?: { tint: Vec3; sat: number; contrast: number; sepia: number; vignette: number } | null;
  bloom?: number;
  bloomThreshold?: number;
}

// ---------------------------------------------------------------------------------------------------------
// Rendering pieces (engine/core/Post.js, GI.js, Sky.js)
// ---------------------------------------------------------------------------------------------------------
export interface Post {
  composer: any; ao: any; bloom: { strength: number; threshold: number }; gradeU: Record<string, { value: any }>;
  setSize(w: number, h: number, ratio: number): void;
  /** GTAO radius follows the world scale */
  setScale(U: number): void;
  render(): void;
  grade(g: MapLook['grade']): void;
  profile(): PerfStats | null;
}
export interface Emitter { obj: THREE.Object3D; color: THREE.Color; power(): number; range: number; facing?: boolean }
export interface GI {
  key: { color: THREE.Color; intensity: number; position: THREE.Vector3 };
  strength: { value: number };
  emGain: { value: number };
  /** inject key/bounce/emitter lighting into a (toon) material */
  patch(mat: THREE.Material): void;
  tick(emitters: Emitter[]): void;
  capture(scene: THREE.Scene, at: THREE.Vector3, hide: THREE.Object3D): Promise<void>;
}
/** engine/core/Sky.js */
export function loadSky(renderer: THREE.WebGLRenderer, url: string, opts?: { sat?: number; tame?: [number, number] | null }):
  Promise<{ tex: THREE.Texture; env: THREE.Texture; sun: THREE.Vector3 }>;

// ---------------------------------------------------------------------------------------------------------
// Wind (engine/core/Wind.js) and the volumetric sky (engine/sky/*)
// ---------------------------------------------------------------------------------------------------------
export interface Wind {
  /** m/s */ speed: number;
  /** degrees the wind blows toward: 0 = -z (away from the viewer), 90 = +x */ dir: number;
  /** 0..1 */ gust: number;
  /** m/s on stage xz (y = 0) */ vector: THREE.Vector3;
  uniforms: { uWindDir: { value: THREE.Vector2 }; uWindAmp: { value: number }; uWindPhase: { value: number }; uWindSpeed: { value: number } };
  tick(dt: number, t: number): void;
  params: ParamDef[];
}
export const WIND_GLSL: string;
export function createWind(opts?: { speed?: number; dir?: number; gust?: number }): Wind;

export interface VolumetricSky {
  /** add to the scene/map group: draws the sky behind everything */
  dome: THREE.Mesh;
  /** unit vector toward the sun (stage metres) */
  sunDir: THREE.Vector3;
  /** 0..1 sun reaching the subject right now (cloud shadow at the stage origin, smoothed) */
  readonly sunlight: number;
  /** ids without prefix: elev, azim, sun, cover, density, base, thick, timeScale, stir, swirl, life, g, gw, amb, haze, rays, hazeG, sunGap, bankR, gapW, fan, skyGain */
  params: ParamDef[];
  fluid: CloudFluid;
  patchReceiver(mat: THREE.Material, opts?: { aerial?: boolean }): THREE.Material;
  tick(t: number, dt: number, camera: THREE.Camera, opts: { origin: THREE.Vector3; U: number }): void;
}
export function createVolumetricSky(renderer: THREE.WebGLRenderer, opts?: { wind?: Wind }): VolumetricSky;
export interface CloudFluid {
  S: number;
  texture: THREE.Texture;
  windOffset: THREE.Vector2;
  step(dt: number, wind: THREE.Vector3, opts?: { cover?: number; stir?: number; conf?: number; tau?: number }): void;
  reset(): void;
  stats(): { water: [number, number, number]; speed: [number, number, number] };
}

// ---------------------------------------------------------------------------------------------------------
// Bridge (engine/bridge/client.js page side, relay.py server side, cli.py shell)
// ---------------------------------------------------------------------------------------------------------
export function connectBridge(engine: Engine, opts?: { url?: string }): { stop(): void };
export function defineMap(def: MapDef): MapDef;
export function createEngine(opts: EngineOptions): Engine;
export function createParams(): Params;
