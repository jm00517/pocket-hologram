# engine — index

A small three.js engine for "a character standing in a world": anime-style character lighting, a post chain,
swappable maps, a self-describing parameter registry, and a command surface agents drive over HTTP.
No build step; ES modules; peer dependency `three@0.170` imported as bare `'three'` (importmap or bundler).

Read in this order: this file → `types.d.ts` (every interface, with the implementing file) → only then code.

## Where things are

| Concept | File | Export |
|---|---|---|
| Public entry | `index.js` | `createEngine`, `defineMap`, `createParams`, `loadSky`, `connectBridge` |
| All interfaces (stubs + docs) | `types.d.ts` | `Engine`, `MapDef`, `MapInstance`, `MapContext`, `MapLook`, `ParamDef`, `State`, … |
| Renderer, loop, maps, subject, commands | `core/Engine.js` | `createEngine({ canvas })` |
| Param registry | `core/Params.js` | `createParams()` |
| Post chain: ink outlines → GTAO → bloom → tone map → grade → SMAA, GPU profiler | `core/Post.js` | `createPost()` |
| Character-only lighting: key light, SH bounce probe (hue), real-time emitters | `core/GI.js` | `createGI()` |
| HDRI sky + IBL + sun direction | `core/Sky.js` | `loadSky(renderer, url, { sat, tame })` |
| World wind (one for everything): params `wind.*`, shader uniforms | `core/Wind.js` | `createWind()`, `WIND_GLSL`; `engine.wind`, `ctx.wind` |
| Volumetric sky: raymarched clouds, rays, cloud shadows on surfaces and the subject | `sky/VolumetricSky.js` | `createVolumetricSky(renderer, { wind })` |
| Cloud coverage as a 2D fluid (stable fluids, vorticity, condensation/evaporation) | `sky/CloudFluid.js` | `createCloudFluid(renderer, { N, S, noise })` |
| Tileable 3D cloud noise (Perlin-Worley / Worley) | `sky/noise.js` | `getCloudNoise()` |
| Bridge, page side | `bridge/client.js` | `connectBridge(engine)` |
| Bridge, server side (Python, plugs into `http.server`) | `bridge/relay.py` | `Bridge().handle(handler)` |
| Bridge, shell | `bridge/cli.py` | `python engine/bridge/cli.py <cmd>` |

## Concepts

- **Stage and units.** `engine.stage` is the floor point under the subject. Maps are authored in **metres** and
  scaled by `U = subjectHeight / 1.6` scene units per metre. Every position in commands is in stage metres.
- **Subject.** `setSubject(object)` sets the scale, patches its materials for GI and turns on its shadows.
  Nothing renders a map until a subject exists.
- **Map.** `defineMap({ id, label, doc, create(ctx) → MapInstance })`. The instance is a `group` in metres plus
  `fit(scene, U)`. Optional parts:
  - `look`: lights and grade.
  - `params`: registered as `<id>.<param>`.
  - `commands`: registered as `<id>.<name>`.
  - `tick`, `emitters`, `walkable`/`moveTo`.

  The engine resets fog, background and environment between maps.
- **Params.** Every tunable is a `ParamDef` with id, label, doc, type and range, plus get/set. `set` validates and
  clamps. UIs (`src/ui/ParamsPanel.js`) and agents read the same list.
- **Wind.** `engine.wind` is the single wind (`wind.speed`, `wind.dir`, `wind.gust`). Shaders share
  `wind.uniforms` (declare with `WIND_GLSL`): `uWindDir`, `uWindAmp` (1 at 4 m/s), `uWindPhase` (use instead of
  time in sway), `uWindSpeed`. The sky's cloud fluid is driven by `wind.vector`.
- **Sky.** `createVolumetricSky` returns a `dome` to add, `params` (map them under your map id), and
  `tick(t, dt, camera, { origin, U })`. `patchReceiver(material, { aerial })` makes a surface take cloud shadows
  (and the haze/rays in front of it). Scale your sun light by `sky.sunlight`, the sun reaching the subject now,
  so the subject goes in and out of shade, and multiply your sky/fill light by `sky.skylight` so the shade's
  colour follows the cloud cover overhead. `elev` is the time of day: colour your sun light with `sky.sunTint`. See `src/maps/SkyLab.js`.
- **Camera.** In `cameraMode: 'rig'` the app moves the camera in its `beforeFrame` listener. The `camera` command
  switches to `'manual'`, and `{ mode: 'rig' }` hands control back.
- **Events.** `on()` takes these events:
  - `beforeFrame` / `afterFrame`: `(dt, t)`.
  - `map`: `(id)`.
  - `baseline`: lights were replaced wholesale, so UIs re-read values and drop undo.

## Driving it as an agent

Serve with a bridge-enabled server (this repo: `python scripts/server.py`, port 3210) and open the app in a
browser. Then:

```sh
python engine/bridge/cli.py status            # page connected?
python engine/bridge/cli.py describe          # maps, params (+docs, ranges, values), commands, state
python engine/bridge/cli.py map pool
python engine/bridge/cli.py set post.bloom=0.4 sky.cover=0.5
python engine/bridge/cli.py snapshot shot.jpg 960
python engine/bridge/cli.py perf              # GPU ms per pass
python engine/bridge/cli.py call camera '{"position":[3,1.6,4],"target":[0,1,0]}'
python engine/bridge/cli.py call crossing.moveTo '{"x":2,"z":-3}'
python engine/bridge/cli.py eval "return engine.scene.children.length"
```

Plain HTTP works too: `POST /api/engine {"cmd": "...", "args": {...}}` returns `{"ok", "result" | "error"}`.
Commands go to whichever open tab polls first, so keep one tab open.

The `eval` command runs arbitrary JS in the page. Bind the server to `127.0.0.1` only.

## Using it in another project

1. Copy `engine/` or depend on it (`package.json`). Provide `three` through an importmap or a bundler.
2. Create the engine, register maps, give it a subject, start the loop, and optionally connect the bridge:

```js
import { createEngine, defineMap, connectBridge } from './engine/index.js';
const engine = createEngine({ canvas });
engine.registerMap(defineMap({ id: 'box', label: 'Box', create: () => ({ group, fit: (scene, U) => group.scale.setScalar(U) }) }));
await engine.setSubject(characterMesh);   // world scale follows its height
await engine.setMap('box');
engine.on('beforeFrame', (dt) => { /* move the camera, animate the subject */ });
engine.resize(); addEventListener('resize', () => engine.resize());
engine.start();
connectBridge(engine);                     // needs a server mounting bridge/relay.py
```

3. For the Python side, mount the relay:

```py
from relay import Bridge          # engine/bridge on sys.path
BRIDGE = Bridge()
def do_GET(self):  BRIDGE.handle(self) or super().do_GET()
def do_POST(self): BRIDGE.handle(self) or ...
```

`GI.patch` targets MMD/toon materials (`MeshToonMaterial` and the like). Other materials still render; they just
don't get the subject-only lighting.
