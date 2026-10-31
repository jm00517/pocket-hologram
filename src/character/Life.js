// Inner life: what she pays attention to and how she reacts to you. It only decides; Behavior (face,
// voice) and MotionDirector (clips) do the acting, and Character's look code (eyes snap, head lags) does
// the gaze.
// - gaze: you most of the time, then a glance away or a look at something in the map
//   (MapInstance.interests), and back to you, often with a small smile; a blink on big shifts;
// - presence, from the webcam tracking: greets you when you come back, gets shy if you lean in close,
//   looks around for you while you're gone;
// - now and then says something to herself that fits the map and the hour;
// - turns to what happens in the map (MapContext.cue: the train, the chime) on its own clock, not yours;
// - remembers (localStorage): how long you were away picks the greeting, and she notices a change of place;
// - tells the story (event): a return, a return within the visit, leaning in. When the story takes the moment
//   (a scene plays), her own stock line gives way to it; the gesture and the face stay. look() holds her gaze for it.
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
// the first greeting of a visit, by how long you were away
const WELCOME = [[0, ['はじめまして！ミクだよ']], [60, GREET], [6 * 3600, ['おかえり！まってたよ']], [86400, ['ひさしぶり！あいたかった']], [7 * 86400, ['ずっと、まってたんだよ…']]];
const PLACE = { citadel: 'おしろ', crossing: 'ふみきり', classroom: 'きょうしつ', pool: 'プール', sky: 'そら' };
const KEY = 'ph.memory';
let welcomed = false; // once per page, not per character reload
const SHY = ['ち、ちかいよ…', 'えっ…'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const r = (a, b) => a + Math.random() * (b - a);

export class Life {
  /** say(text): speak through the chat bar's voice; P: shared knobs { on, chatter, curiosity } (life.* params);
   *  event(name, value) -> true when the story took it ('return' hours away (-1 never), 'back', 'near');
   *  scene() -> true while a story scene plays: her idle faces would wipe its #expr ... hold */
  constructor(character, { say, P, event = () => false, scene = () => false }) {
    this.c = character; this.say = say; this.P = P; this.event = event; this.scene = scene; this.held = null;
    this.target = new THREE.Vector3();
    this.mode = 'you'; this.left = r(2, 5); this.away = 0;
    this.present = null; this.absent = 0; this.seen = false; this.close = 0; this.shyCool = 0;
    this.chat = r(25, 50); this.cue = null;
    this.memory = { visits: 0, lastSeen: 0, lastMap: null, maps: {} };
    try { Object.assign(this.memory, JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch {}
    this.awaySec = this.memory.lastSeen ? (Date.now() - this.memory.lastSeen) / 1000 : null;
    if (!welcomed) this.memory.visits++;
    this.save(); this.map = null; this.since = 0;
  }

  save() {
    this.memory.lastSeen = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify(this.memory)); } catch {}
  }

  /** something happened in the map (MapContext.cue, world position): look, maybe a gesture or a word */
  notice({ p, line, gesture, hold = 2.5 }) {
    if (!this.P.on) return;
    const c = this.c, b = c.behavior;
    this.mode = 'thing'; this.target.copy(p); this.left = hold; this.away = 0; this.cue = null;
    c.nextBlink = c.t;
    if (b.speech) return;
    if (gesture) c.director.play(gesture);
    if (line && Math.random() < this.P.chatter * 1.4) this.say(line);
  }

  /** the map changed: a first time somewhere is worth a word, and so is having just been elsewhere */
  mapChanged(id) {
    const prev = this.map; this.map = id;
    if (!id) return;
    const first = !this.memory.maps[id];
    this.memory.maps[id] = (this.memory.maps[id] ?? 0) + 1; this.memory.lastMap = id; this.save();
    if (!prev || !this.P.on || Math.random() > Math.max(this.P.chatter, 0.5)) return;
    this.pending = first ? 'わあ、ここ はじめて！' : PLACE[prev] ? `さっきまで ${PLACE[prev]}に いたね` : null;
  }

  /** viewer: the eye (world); present: webcam sees a face (null = no tracking); close: leaning in;
   *  interests: [{ p: world Vector3, label }]; map: active map id; night: sky dark */
  update(dt, { viewer, present = null, close = false, interests = [], map, night = false }) {
    const c = this.c, b = c.behavior, d = c.director, P = this.P;
    this.near = close; // you're at her face: she whispers (the chat bar reads it)
    const held = this.held && this.heldAt(viewer);
    if (!P.on) { c.lookTarget = held || viewer; return; }
    const busy = b.state !== 'idle' || !!b.speech || this.scene();
    this.since += dt;
    if ((this.saveIn = (this.saveIn ?? 30) - dt) <= 0) { this.saveIn = 30; this.save(); }
    // the first greeting of the visit, once she's settled in; then a word about the place, if any
    if (!welcomed && this.since > 2.5 && !busy) { welcomed = true; this.seen = true; this.greet(this.awaySec); }
    else if (this.pending && this.since > 4 && !busy) { this.say(this.pending); this.pending = null; b.express('smile', { len: 2.2 }); }

    // presence: the moment you appear (after being away) she greets you; while you're gone she searches
    if (present !== null) {
      if (present) {
        if (!this.seen || this.absent > 6) { const first = !welcomed; welcomed = true; this.greet(first ? this.awaySec : 0); }
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
      if (!this.event('near') && Math.random() < P.chatter) this.say(pick(SHY));
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
        this.mode = 'thing'; this.target.copy(pick(interests).p); this.left = r(1.5, 4); if (!busy && Math.random() < 0.3) b.express('surprised', { len: 0.9 });
      } else this.glance(r(-0.35, 0.3), r(0.7, 2.4) * (gone ? 1.6 : 1));
      if (Math.random() < 0.5) c.nextBlink = c.t;
    }
    c.lookTarget = held || (this.mode === 'you' ? viewer : this.target);

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

  /** away: seconds since the last visit (null = never), picks the line; a return within a visit is plain GREET */
  greet(away = 0) {
    const b = this.c.behavior, d = this.c.director;
    if (b.speech) return;
    d.play(pick(['hi', 'wave', 'wave2'])) || b.react('wave');
    b.express('happy', { len: 2.8 });
    const lines = away === null ? WELCOME[0][1] : WELCOME.slice(1).filter(([s]) => away >= s).at(-1)?.[1] ?? GREET;
    const told = this.event(away === 0 ? 'back' : 'return', away === null ? -1 : Math.round(away / 360) / 10); // hours, 0.1
    if (!told && (away !== 0 || Math.random() < Math.max(this.P.chatter, 0.3))) this.say(pick(lines)); // the first hello of a visit is always said
    this.mode = 'you'; this.left = r(4, 7);
  }

  /** the story holds her gaze: 'you' | 'away' | 'down' | 'up' | 'left' | 'right' (her own left/right);
   *  'free' or null gives it back to her */
  look(mode) {
    this.held = !mode || mode === 'free' ? null : mode;
    this.heldSide = Math.random() < 0.5 ? -1 : 1; // 'away' picks a side once, not every frame
  }

  heldAt(viewer) {
    if (this.held === 'you') return viewer;
    const [yaw, pitch] = { away: [this.heldSide * 0.9, 0.15], down: [0, 0.55], up: [0, -0.45], left: [1, 0], right: [-1, 0] }[this.held] ?? [0, 0];
    return this.ahead(yaw, pitch, this.heldP ??= new THREE.Vector3());
  }

  // a point out from her head: yaw + = her left (+X), pitch + = down, in her facing
  ahead(yaw, pitch, out) {
    const c = this.c, head = c.bones['頭'].getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).transformDirection(c.mesh.matrixWorld);
    return out.copy(head).addScaledVector(dir, 40); // model faces +Z; 40 units ~ 3 m out
  }

  // a glance off to the side: yaw left/right of her facing, pitch (+ = down), held for `hold` seconds
  glance(pitch, hold) {
    this.ahead((Math.random() < 0.5 ? -1 : 1) * r(0.5, 1.1), pitch, this.target);
    this.mode = 'glance'; this.left = hold;
  }
}
