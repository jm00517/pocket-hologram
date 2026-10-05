# pocket-hologram — map for agents

A head-coupled "window" viewer. A webcam tracks the viewer's eyes, the screen is treated as a real window
(off-axis projection), and an MMD character stands in a 3D map behind it. No build step. Three.js 0.170 comes
from a CDN importmap (`index.html`).

## Layout

| Path | What |
|---|---|
| `engine/` | Reusable engine package. **Start at `engine/INDEX.md`, then `engine/types.d.ts`.** |
| `src/main.js` | The app around the engine: tracking → camera rig, calibration/window layout, character loading, drawer UI, bridge hookup. |
| `src/maps/index.js` | Every map, in menu order. Map contract: `MapDef` / `MapInstance` in `engine/types.d.ts`. |
| `src/maps/crossing/` | `index.js` (adapter: weather param, `moveTo` command), `Crossing.js` (world), `Weather.js` (presets), `Sea.js`, `Foliage.js`. |
| `src/maps/Classroom.js`, `Pool.js`, `SkyLab.js`, `Citadel.js` | Self-lit maps (`look` + `fit`). SkyLab and Citadel run on the engine sky (`engine/sky/`, lights via `createSkyLights`); their params are `sky.*` / `citadel.*`. Citadel's backdrop reaches 2 km, inside the ~2.4 km far plane. |
| `src/character/` | MMD character: `Character.js` (load, physics, play), `Behavior.js` (speech/expressions, `speakTimed`), `Motions.js` (director), `Hands.js`, `Inertia.js`. |
| `src/ui/` | `ParamsPanel.js` (controls generated from the param registry), `ChatBar.js` (TTS + lip sync), `CalibrationPanel.js`. |
| `src/tracking/`, `src/spatial/`, `src/calibration/` | Face/iris tracking, `OffAxisCamera`, physical screen calibration. |
| `scripts/server.py` | Dev server on port 3210. It serves static files with no-store, `/api/tts` (speech: `voice` miku or teto), and `/api/engine` (bridge). |
| `scripts/get-polyhaven.py` | Downloads the CC0 textures, HDRIs and plant models into `assets/polyhaven/` (gitignored). |
| `voice/v6_speech.py` | Japanese speech through the local VOCALOID6 Hatsune Miku V6 model: one note per mora, accent from `teto_tts`. Needs the headless synth CLI (`V6_SYNTH`) and the installed licences; not redistributed. |
| `voice/teto_tts.py` | Japanese concatenative TTS on the local Kasane Teto UTAU bank (pyopenjtalk accent, WORLD re-pitch). Not redistributed. |
| `voice/vpr_speech.py` | Hiragana -> VOCALOID6 `.vpr` project that speaks it, for the editor. |
| `assets/` | Gitignored except `assets/models/` (CC-BY props, credits in `CREDITS.txt`). |

## Run and verify

```sh
python scripts/server.py                  # http://localhost:3210  (?bg=crossing|classroom|pool|sky|grid, ?perf, ?weather=, ?foliage=)
python engine/bridge/cli.py status        # with the page open in a browser
python engine/bridge/cli.py describe
python engine/bridge/cli.py snapshot shot.jpg 960
python engine/bridge/cli.py perf
```

Verify visual changes through the bridge on the open page: `snapshot`, then `perf`. Don't run long headless runs
of the full scene. After changing `scripts/server.py` or `engine/bridge/relay.py`, restart the server.

## Conventions

- Maps are authored in metres and scaled by `U = characterHeight / 1.6` in `fit`.
- Map meshes opt out of the character's ink outlines: `material.userData.outlineParameters = { visible: false }`.
- `userData.noAO` keeps sprites, alpha cards and water out of GTAO.
- Every tunable value is a param with a `doc`. Add new knobs as params, not as UI code.
- Comments explain *why*. Each module's header says what it is.
