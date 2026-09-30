// Picks full-body mocap clips (VMD, see scripts/get-bandai.sh) to match the conversation state.
// Base loop = an idle clip; gestures are one-shots that crossfade back to it. Missing files are skipped,
// so without assets/motions the character just keeps the code-built stand pose.

const DIR = 'assets/motions/';
// Bandai Namco Research motion dataset (CC BY-NC 4.0, © Bandai Namco Research Inc.), fetched by
// scripts/get-bandai.sh — Japanese performers, feminine/childish styles. Name → file under DIR.
const BN = (f) => `bandai/vmd/dataset-${f}_001`;
const DD = (f) => `mmd/deedee524/Idle Animations Pack - Copy/${f}`;
const FILES = {
  bow: BN('1_bow_feminine'), hi: BN('1_bye_feminine'), byebye: BN('1_byebye_childish'), wave: BN('2_wave-right-hand_feminine'),
  wave2: BN('2_wave-both-hands_youthful'), raise: BN('2_raise-up-right-hand_youthful'), guide: BN('1_guide_feminine'),
  guide2: BN('1_guide_happy'), guide3: BN('1_guide_childish'), respond: BN('1_respond_normal'), call: BN('1_call_normal'), shybow: BN('1_bow_not-confident'),
  // MMD community motions (user-downloaded into assets/motions/mmd):
  // "MMO用待機モーションセット" (BowlRoll 8900) — looping stands made for anime-girl MMD models
  st_koa: 'mmd/mmo/koa_stand', st_rea: 'mmd/mmo/rea_stand', st_marieru: 'mmd/mmo/marieru_stand',
  st_usa: 'mmd/mmo/usa_stand', st_ten: 'mmd/mmo/ten_stand',
  // deedee524 "Idle Animations Pack" (DeviantArt; credit deedee524, don't redistribute originals)
  stretch: DD('Stretching Idle Animation/Stretching'), fixhair: DD('Fixing Hair or Wig Idle Animation/Fixing Hair or Wig'),
  tidy: DD('Tidy Idle Animation/Brushoff Nice and Tidy'), shyidle: DD('Shy Idle Animation/Shy'),
  sway: DD('Swaying Idle Animation/Swaying Arms and Hips'), confident: DD('Confident Idle Animation/Crossed Arms Look Around Confident'),
  impatient: DD('Impatient Idle Animation/Impatient Foot Tapping'), sky: DD('Skywatching Idle Animation/Something In The Sky'),
  sniff: DD('Air Scent Idle Animation/Smelling Something in the Air'),
};
const fileOf = (name) => DIR + (FILES[name] ?? 'vmd/' + name).split('/').map(encodeURIComponent).join('/') + '.vmd';
// Idle = MMD community motions (anime-girl stances); conversation gestures = Bandai. Missing files are
// skipped, falling back to the code-built stand pose and procedural nods.
export const LIBRARY = {
  base: ['st_koa', 'st_rea', 'st_marieru', 'st_usa', 'st_ten'], // looping stands, rotated each cycle
  idle: ['stretch', 'fixhair', 'tidy', 'shyidle', 'sway', 'confident', 'impatient'], // occasional fidgets
  listening: ['respond'],
  thinking: ['sky', 'sniff'],
  speaking: ['guide', 'guide2', 'guide3'],
  reactions: {
    bow: 'bow', hi: 'hi', byebye: 'byebye', wave: 'wave', wave2: 'wave2', raise: 'raise', call: 'call', shybow: 'shybow',
  },
};
const FADE = 0.5;
const pick = (arr, not) => { const a = arr.filter((n) => n !== not); return a[Math.floor(Math.random() * a.length)] ?? arr[0]; };

export class MotionDirector {
  constructor(character) {
    this.c = character;
    this.have = new Set();
    this.enabled = true;
    this.gesture = null; // name of the running one-shot
    this.last = null;
    this.wait = 3; // seconds until the next idle/listening gesture
    this.prevState = null;
  }

  async load() {
    const names = new Set([...LIBRARY.base, ...LIBRARY.idle, ...LIBRARY.listening, ...LIBRARY.thinking, ...LIBRARY.speaking, ...Object.values(LIBRARY.reactions)].filter(Boolean));
    await Promise.all([...names].map(async (n) => {
      try { await this.c.addMotion(n, fileOf(n)); this.have.add(n); } catch { /* not downloaded */ }
    }));
    if (this.enabled) this.toBase(1);
    return this.have.size;
  }

  has(name) { return this.have.has(name); }

  // Base stands play once each and rotate, so the idle never visibly loops.
  toBase(fade = FADE) {
    this.gesture = null;
    const bases = LIBRARY.base.filter((n) => this.have.has(n));
    this.base = bases.length ? pick(bases, this.base) : 'stand';
    this.c.play(this.base, { fade, once: this.base !== 'stand' });
  }

  play(name) {
    if (!this.enabled || !this.have.has(name)) return false;
    this.gesture = this.last = name;
    this.c.play(name, { once: true, fade: FADE });
    return true;
  }

  tick(dt) {
    if (!this.enabled || !this.have.size) return;
    const state = this.c.behavior.state;
    const entered = state !== this.prevState;
    this.prevState = state;

    if (this.gesture) {
      const a = this.c.actions[this.gesture];
      if (a.time < a.getClip().duration - 0.15) return; // let it finish; the inertial switch hides the seam
      this.toBase();
    } else if (this.base && this.base !== 'stand' && this.c.current === this.c.actions[this.base]) {
      const a = this.c.actions[this.base];
      if (a.time >= a.getClip().duration - 0.15) this.toBase(); // next stand
    }
    const pool = (LIBRARY[state] ?? []).filter((n) => this.have.has(n));
    if (!pool.length) return;
    if (state === 'speaking' || (state === 'thinking' && entered)) { this.play(pick(pool, this.last)); return; }
    if (entered) this.wait = state === 'listening' ? 0.8 + Math.random() * 1.5 : 10 + Math.random() * 15;
    this.wait -= dt;
    if (this.wait <= 0 && state !== 'thinking') {
      this.play(pick(pool, this.last));
      this.wait = state === 'listening' ? 2 + Math.random() * 3 : 12 + Math.random() * 18;
    }
  }
}

