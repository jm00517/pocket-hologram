// Touch: what your hands do to her in VR. It reads the controllers' world positions each frame and acts
// through Behavior (face, voice), Life (gaze) and the character's procedural lean, no new clips:
// - a hand rubbing the top of her head is a pat: eyes close in a smile, the head leans into the hand,
//   now and then "えへへ"; kept up too long she gets embarrassed. The controller buzzes softly;
// - a poke at a cheek startles her into a pout;
// - a raised hand waving side to side gets a wave back (as a Life cue).
// Distances are in metres; U = world units per metre.
import * as THREE from 'three';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);

export class Touch {
  constructor(character, { say, P }) {
    this.c = character; this.say = say; this.P = P;
    this.pat = 0; this.patSaid = false; this.buzz = 0; this.pokeCool = 0; this.waveCool = 0;
    this.prev = []; this.wave = [];
  }

  /** hands: [{ p: world Vector3, src: XRInputSource | null }]; viewer: headset world position */
  update(dt, { hands, viewer, U }) {
    const c = this.c, b = c.behavior, life = c.life;
    if (!c.mesh) return;
    const head = c.bones['頭'].getWorldPosition(new THREE.Vector3()).addScaledVector(up, 0.08 * U); // bone sits at the jaw
    const top = head.clone().addScaledVector(up, 0.11 * U);
    const fwd = v.set(0, 0, 1).transformDirection(c.mesh.matrixWorld).clone(), side = new THREE.Vector3().crossVectors(up, fwd);
    let patting = false, patSide = 0;
    this.pokeCool -= dt; this.waveCool -= dt;

    hands.forEach((h, i) => {
      const last = this.prev[i] ?? h.p.clone(), vel = h.p.clone().sub(last).divideScalar(Math.max(dt, 1e-3) * U); // m/s
      this.prev[i] = h.p.clone();
      // pat: in the zone over her crown and moving (a hand just resting there is not a pat)
      if (h.p.distanceTo(top) < 0.15 * U) {
        if (vel.length() > 0.05) this.movedAt = c.t; // poses can repeat between frames: count a hand that moved just now
        if (c.t - (this.movedAt ?? -1) < 0.3) { patting = true; patSide = Math.sign(h.p.clone().sub(head).dot(side)) || 1; this.patHand = h; }
      }
      // poke: the tip of the controller at a cheek
      for (const s of [-1, 1]) {
        const cheek = head.clone().addScaledVector(up, -0.03 * U).addScaledVector(fwd, 0.07 * U).addScaledVector(side, s * 0.05 * U);
        if (this.pokeCool <= 0 && h.p.distanceTo(cheek) < 0.05 * U) {
          this.pokeCool = 4; b.express('surprised', { len: 0.5 });
          setTimeout(() => { b.express('pout', { len: 2.2 }); if (Math.random() < this.P.chatter * 1.6) this.say(pick(['むぅ', 'もー、なにするの'])); }, 450);
          h.src?.gamepad?.hapticActuators?.[0]?.pulse?.(0.5, 40);
        }
      }
      // wave: hand up near your head height, side-to-side swings (direction flips) within 1.5 s
      const w = (this.wave[i] ??= { flips: [], dir: 0 });
      const lateral = vel.dot(side);
      if (h.p.y > viewer.y - 0.3 * U && h.p.distanceTo(head) > 0.35 * U && Math.abs(lateral) > 0.5) { // not a pat over her head
        const d = Math.sign(lateral);
        if (w.dir && d !== w.dir) w.flips.push(c.t);
        w.dir = d;
      }
      w.flips = w.flips.filter((t) => c.t - t < 1.5);
      if (w.flips.length >= 3 && this.waveCool <= 0) {
        this.waveCool = 8; w.flips = [];
        life?.notice({ p: h.p.clone(), gesture: pick(['wave', 'wave2', 'hi']), line: pick(['やっほー！', 'はーい！']), hold: 2 });
      }
    });

    // the pat builds up while the hand keeps moving and fades a moment after it stops
    this.pat = patting ? this.pat + dt : Math.max(0, this.pat - dt * 2);
    const k = 1 - Math.exp(-dt * 5), on = this.pat > 0.3;
    c.lean.roll += ((on ? -patSide * 0.16 : 0) - c.lean.roll) * k; // into the hand
    c.lean.pitch += ((on ? 0.1 : 0) - c.lean.pitch) * k;
    if (on) {
      if (life) { life.mode = 'you'; life.left = Math.max(life.left, 1); }
      if (this.pat > 7) { if (b.expr?.name !== 'shy') { b.express('shy', { len: 3 }); if (!b.speech) this.say(pick(['も、もう…', 'はずかしいよ…'])); } }
      else if (b.expr?.name !== 'happy') b.express('happy', { len: 2 });
      if (!this.patSaid && this.pat > 1.5) { this.patSaid = true; if (!b.speech && Math.random() < Math.max(this.P.chatter, 0.4)) this.say(pick(['えへへ…', 'ふふっ'])); }
      if ((this.buzz -= dt) <= 0) { this.buzz = 0.35; this.patHand?.src?.gamepad?.hapticActuators?.[0]?.pulse?.(0.15, 25); }
    } else if (this.pat === 0) this.patSaid = false;
  }
}
