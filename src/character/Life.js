// Inner life: what she pays attention to and how she reacts to you. It only decides; Behavior (face,
// voice) and MotionDirector (clips) do the acting, and Character's look code (eyes snap, head lags) does
// the gaze.
// - gaze: you most of the time, then a glance away or a look at something in the map
//   (MapInstance.interests), and back to you, often with a small smile; a blink on big shifts;
// - presence, from the webcam tracking: greets you when you come back, gets shy if you lean in close,
//   looks around for you while you're gone;
// - now and then says something to herself that fits the map and the hour.
import * as THREE from 'three';

// Hiragana, for the Japanese voices (Miku V6, Teto). Keep them short: they are asides, not speeches.
const LINES = {
  any: ['ふんふふーん…', 'いいかぜ…', 'ねえ、きいてる？', 'なにしようかな', 'ふあ…'],
  citadel: ['おおきい…', 'あのおしろ、いってみたいな', 'とりさんが とんでる', 'かぜが きもちいいね'],
  sky: ['くもが ながれてく…', 'そら、ひろいね'],
  pool: ['みず、つめたそう', 'およぎたいなー'],
  classroom: ['ほうかご、しずかだね', 'ゆうひ、きれい…'],
  crossing: ['でんしゃ、まだかな', 'うみのにおいがする'],
  night: ['ほし、きれい…', 'よる、しずかだね'],
};
const GREET = ['あ、おかえり！', 'やっほー！', 'あ、きた！'];
const SHY = ['ち、ちかいよ…', 'えっ…'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const r = (a, b) => a + Math.random() * (b - a);

export class Life {
  /** say(text): speak through the chat bar's voice; P: shared knobs { on, chatter, curiosity } (life.* params) */
  constructor(character, { say, P }) {
    this.c = character; this.say = say; this.P = P;
    this.target = new THREE.Vector3();
    this.mode = 'you'; this.left = r(2, 5); this.away = 0;
    this.present = null; this.absent = 0; this.seen = false; this.close = 0; this.shyCool = 0;
    this.chat = r(25, 50); this.cue = null;
  }

  /** viewer: the eye (world); present: webcam sees a face (null = no tracking); close: leaning in;
   *  interests: [{ p: world Vector3, label }]; map: active map id; night: sky dark */
  update(dt, { viewer, present = null, close = false, interests = [], map, night = false }) {
    const c = this.c, b = c.behavior, d = c.director, P = this.P;
    if (!P.on) { c.lookTarget = viewer; return; }
    const busy = b.state !== 'idle' || !!b.speech;

    // presence: the moment you appear (after being away) she greets you; while you're gone she searches
    if (present !== null) {
      if (present) {
        if (!this.seen || this.absent > 6) this.greet();
        this.seen = true; this.absent = 0;
      } else this.absent += dt;
    }
    const gone = present === false && this.absent > 3;

    // leaning in: shy, eyes down, a step of embarrassment; cooldown so it isn't a loop
    this.close = close ? this.close + dt : 0;
    this.shyCool -= dt;
    if (this.close > 0.6 && this.shyCool <= 0 && !busy) {
      this.shyCool = 25;
      b.express('shy', { len: 3.5 });
      d.play(Math.random() < 0.5 ? 'g_shy' : 'g_shystand') || b.react('lookdown');
      if (Math.random() < P.chatter) this.say(pick(SHY));
      this.glance(0.35, 1.6); // eyes drop away
    }

    // gaze: hold, then switch; while you are gone she looks around more and longer
    this.left -= dt;
    if (this.mode !== 'you') this.away += dt;
    if (this.cue) { this.mode = 'thing'; this.target.copy(this.cue.p); }
    if (this.left <= 0) {
      if (this.mode !== 'you' && !gone) {
        if (this.away > 1.4 && !busy && Math.random() < 0.6) b.express('smile', { len: 1.6 }); // "oh, there you are"
        this.mode = 'you'; this.away = 0; this.left = r(3, 9) / Math.max(P.curiosity, 0.05) * (b.speech ? 2.5 : 1);
        if (Math.random() < 0.6) c.nextBlink = c.t; // the eyes reset with a blink
      } else if (interests.length && Math.random() < 0.45) {
        this.mode = 'thing'; this.target.copy(pick(interests).p); this.left = r(1.5, 4); if (Math.random() < 0.3) b.express('surprised', { len: 0.9 });
      } else this.glance(r(-0.35, 0.3), r(0.7, 2.4) * (gone ? 1.6 : 1));
      if (Math.random() < 0.5) c.nextBlink = c.t;
    }
    c.lookTarget = this.mode === 'you' ? viewer : this.target;

    // asides: she looks at what she's talking about first, then says it
    this.chat -= dt * (gone ? 0.5 : 1);
    if (this.cue && (this.cue.t -= dt) <= 0) { this.say(this.cue.line); this.cue = null; this.left = r(1, 2); }
    if (this.chat <= 0 && !busy && !this.cue && P.chatter > 0) {
      this.chat = r(45, 100) / P.chatter;
      const pool = [...LINES.any, ...(LINES[map] ?? []), ...(night ? LINES.night : [])];
      const line = pick(pool), thing = (LINES[map] ?? []).includes(line) && interests.length ? pick(interests).p : null;
      if (thing) this.cue = { p: thing.clone(), t: 1.1, line }; else this.say(line);
      b.express('smile', { len: 2.5 });
    }
  }

  greet() {
    const b = this.c.behavior, d = this.c.director;
    if (b.speech) return;
    d.play(pick(['hi', 'wave', 'wave2'])) || b.react('wave');
    b.express('happy', { len: 2.8 });
    if (Math.random() < Math.max(this.P.chatter, 0.3)) this.say(pick(GREET));
    this.mode = 'you'; this.left = r(4, 7);
  }

  // a glance off to the side: yaw left/right of her facing, pitch (+ = down), held for `hold` seconds
  glance(pitch, hold) {
    const c = this.c, head = c.bones['頭'].getWorldPosition(new THREE.Vector3());
    const yaw = (Math.random() < 0.5 ? -1 : 1) * r(0.5, 1.1);
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).transformDirection(c.mesh.matrixWorld);
    this.target.copy(head).addScaledVector(dir, 40); // model faces +Z; 40 units ~ 3 m out
    this.mode = 'glance'; this.left = hold;
  }
}
