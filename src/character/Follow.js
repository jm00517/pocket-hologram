// Follow: in VR she comes to you. Walk away more than two metres and she walks after you, stopping about a metre
// short, inside the map's roam area (MapInstance.roam: no walls, so each map says where her feet may go). Go round
// her and she turns to face you. Her steps are Bandai's feminine walk (scripts/get-bandai.sh), made into an in-place
// loop: the clip's own drift is taken out of the センター track and her body is moved at the clip's speed instead,
// so the feet don't slide. Distances in metres; U = world units per metre.
import * as THREE from 'three';
import { IDLE_POSE } from './Character.js';

const WALK = 'assets/motions/bandai/vmd/dataset-1_walk_feminine_001.vmd';
const START = 2.0, STOP = 1.1; // start walking past this distance; stop this far from you

/** One gait loop out of a steady walk: the stretch whose ends match best (all bone rotations), drift removed.
 *  Returns the clip's speed vector (units/s, her local frame) for moving her body. */
function walkLoop(clip) {
  const fps = 30, T = clip.duration, quats = clip.tracks.filter((t) => t.ValueTypeName === 'quaternion');
  const at = (t) => quats.map((tr) => tr.createInterpolant().evaluate(t).slice());
  const t0 = Math.min(1, T * 0.1), a = at(t0);
  let best = T, cost = Infinity;
  for (let t = t0 + 2.5; t < T - 0.2; t += 1 / fps) {
    const b = at(t), c = a.reduce((s, q, i) => s + 1 - Math.abs(q[0] * b[i][0] + q[1] * b[i][1] + q[2] * b[i][2] + q[3] * b[i][3]), 0);
    if (c < cost) { cost = c; best = t; }
  }
  const loop = THREE.AnimationUtils.subclip(clip, clip.name, Math.round(t0 * fps), Math.round(best * fps), fps);
  const v = new THREE.Vector3();
  const centre = loop.tracks.find((t) => /センター/.test(t.name) && t.ValueTypeName === 'vector');
  if (centre) {
    const n = centre.times.length, d = centre.times[n - 1] - centre.times[0] || 1, p = centre.values;
    v.set((p[(n - 1) * 3] - p[0]) / d, 0, (p[(n - 1) * 3 + 2] - p[2]) / d);
    for (let i = 0; i < n; i++) { const dt = centre.times[i] - centre.times[0]; p[i * 3] -= v.x * dt; p[i * 3 + 2] -= v.z * dt; }
  }
  clip.tracks = loop.tracks; clip.duration = loop.duration;
  return v;
}

export class Follow {
  constructor(character) {
    this.c = character; this.state = 'idle'; this.far = 0; this.turn = 0; this.v = null;
    character.addMotion('walk', WALK, (clip) => { this.v = walkLoop(clip); }).catch(() => { /* not downloaded: she stays put */ });
  }

  /** back where she was placed (a new map, out of VR) */
  home() {
    const m = this.c.mesh;
    if (!m) return;
    if (this.state === 'walk') this.stop();
    m.position.set(0, 0, 0); m.rotation.y = 0;
  }

  stop() {
    this.state = 'idle';
    const d = this.c.director;
    if (d) { d.enabled = true; d.toBase(0.4); } else this.c.play(IDLE_POSE, { fade: 0.4 });
  }

  /** viewer: headset (stage metres); roam: [x0, x1, z0, z1] stage metres or null (she stays); U: units per metre */
  update(dt, { viewer, roam, on, U: unit }) {
    const c = this.c, m = c.mesh;
    if (!m || !this.v) return;
    if (!on) { if (this.state === 'walk') this.stop(); return; }
    const me = m.position;
    const here = new THREE.Vector2(me.x / unit, me.z / unit), you = new THREE.Vector2(viewer.x, viewer.z);
    const toYou = you.clone().sub(here), d = toYou.length(), yaw = m.rotation.y;
    const face = (target, rate) => {
      const want = Math.atan2(target.x - here.x, target.y - here.y);
      const diff = Math.atan2(Math.sin(want - yaw), Math.cos(want - yaw));
      m.rotation.y = yaw + Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
      return Math.abs(diff);
    };
    if (this.state === 'idle') {
      this.far = d > START && roam ? this.far + dt : 0;
      // you went round her: turn to you, slowly (a turn on the spot)
      const off = Math.abs(Math.atan2(Math.sin(Math.atan2(toYou.x, toYou.y) - yaw), Math.cos(Math.atan2(toYou.x, toYou.y) - yaw)));
      this.turn = off > 0.9 ? this.turn + dt : off < 0.15 ? 0 : this.turn;
      if (this.turn > 1.2) face(you, 1.2);
      if (this.far > 0.8 && c.behavior.state === 'idle') {
        const goal = this.goal(here, you, d, roam);
        if (goal.distanceTo(here) > 0.4) {
          this.state = 'walk';
          if (c.director) c.director.enabled = false;
          c.play('walk', { fade: 0.35 });
        }
      }
      return;
    }
    // walking: aim at a point a metre short of you (you may still be moving), turn as she goes, slower while turning
    const goal = this.goal(here, you, d, roam), left = goal.distanceTo(here);
    const off = face(goal, 3);
    if (left < 0.2 || d < STOP + 0.15) { this.stop(); return; }
    const speed = Math.hypot(this.v.x, this.v.z) / unit * Math.max(0, Math.cos(Math.min(off, Math.PI / 2))) * Math.min(1, left / 0.5);
    me.x += Math.sin(m.rotation.y) * speed * dt * unit; me.z += Math.cos(m.rotation.y) * speed * dt * unit;
  }

  goal(here, you, d, roam) {
    const g = d > 1e-3 ? you.clone().addScaledVector(you.clone().sub(here).normalize(), -STOP) : here.clone();
    if (roam) { g.x = THREE.MathUtils.clamp(g.x, roam[0], roam[1]); g.y = THREE.MathUtils.clamp(g.y, roam[2], roam[3]); }
    return g;
  }
}
