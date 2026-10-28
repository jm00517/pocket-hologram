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
| `src/maps/NonEuclid.js` | 비유클리드 갤러리: portals between door frames (M = F_B F_A^-1 may move, turn and scale: Alice's door shrinks you to 1/10, the corridor turns a quarter every 8 m, the diorama holds the gallery at 1/20). Views render to targets (oblique near plane, recursion, per eye in VR); walking through applies M to `engine.rig`, whose scale the engine's light rescale follows. Spaces sit 400 m apart on camera layers 0/10/11 (12, 13 = the two endless corridors alone). Params `noneuclid.res`, `noneuclid.depth`. In VR the left stick glides and the right stick snap-turns (`xrMove` in `src/main.js`). |
| `src/maps/Hyperbolic.js` | The gallery's green door: a hedge garden in H² x R, right-angled pentagons four to a corner ({5,4}). Points live on the hyperboloid; the vertex shader draws each at its log map from the eye. The eye's steps are folded into a Lorentz matrix each frame (so loops leave you turned), tiles regrow around your room. Statues of her stand in the rooms near you (`noneuclid.crowd` per room): `src/maps/PoseBake.js` freezes moments of her motion clips into still geometry (a copy of her skeleton, IK included), drawn through the same log map. |
| `src/maps/Spherical.js` | The gallery's night-blue door: a planet 25 m round in S² x R. Each thing is drawn twice, the short way and the long way round (the torii ahead also stands behind you; your figure smears round the horizon). Same log-map shader and step folding as the garden; triangles astride the antipode are dropped. |
| `src/character/` | MMD character: `Character.js` (load, physics, play), `Behavior.js` (speech/expressions, `speakTimed`), `Motions.js` (director), `Touch.js` (VR hands: head pats, cheek pokes, waves), `Life.js` (attention, reactions to the viewer and to map cues, asides, memory of visits in localStorage `ph.memory`; `life.*` params), `Hands.js`, `Inertia.js`. |
| Real-time clock | In `src/main.js`: `time.real` drives every sky map's `<map>.elev` and the crossing's weather from the browser clock (`time.lat`). Moving a sun by hand turns it off. |
| `src/ui/` | `ParamsPanel.js` (controls generated from the param registry), `ChatBar.js` (TTS + lip sync), `CalibrationPanel.js`. |
| `src/tracking/`, `src/spatial/`, `src/calibration/` | Face/iris tracking, `OffAxisCamera`, physical screen calibration. |
| `scripts/server.py` | Dev server on port 3210. It serves static files with no-store, `/api/tts` (speech: `voice` miku or teto), `/api/chat` (her replies from a local LLM through Ollama, `PH_LLM`, default gemma3:4b), `/api/stt` (speech to text, `voice/stt_worker.py`, faster-whisper in its own process) and `/api/engine` (bridge). The chat bar talks through them: type, or hold the mic (VR: a trigger or a pinch); the browser's own speech recognition is used first when it has one. |
| `scripts/get-audio.py` | Downloads the ambience and spot sounds into `assets/audio/` (gitignored; sources and licences in the script and `assets/audio/CREDITS.txt`): waves, the crossing recording, cicadas, higurashi, school ground, pool, meadow, night insects, rain. |
| `scripts/get-polyhaven.py` | Downloads the CC0 textures, HDRIs and plant models into `assets/polyhaven/` (gitignored). |
| `voice/v6_speech.py` | Japanese speech through the local VOCALOID6 Hatsune Miku V6 model: one note per mora, accent from `teto_tts`. Needs the headless synth CLI (`V6_SYNTH`) and the installed licences; not redistributed. |
| `voice/teto_tts.py` | Japanese concatenative TTS on the local Kasane Teto UTAU bank (pyopenjtalk accent, WORLD re-pitch). Not redistributed. |
| `voice/vpr_speech.py` | Hiragana -> VOCALOID6 `.vpr` project that speaks it, for the editor. |
| `assets/` | Gitignored except `assets/models/` (CC-BY props, credits in `CREDITS.txt`). A scanned city at `assets/sketchfab/minas_tirith/scene.glb` (local only) replaces the citadel's procedural one (`citadel.scan*` params). |

## Run and verify

```sh
python scripts/server.py                  # http://localhost:3210  (?bg=crossing|classroom|pool|sky|grid, ?perf, ?weather=, ?foliage=, ?xremu = fake Quest 2 for VR)
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
