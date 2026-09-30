// Picks full-body mocap clips (Mixamo → VMD via scripts/fbx2vmd.sh) to match the conversation state.
// Base loop = an idle clip; gestures are one-shots that crossfade back to it. Missing files are skipped,
// so without assets/motions the character just keeps the code-built stand pose.

const DIR = 'assets/motions/vmd/';
export const LIBRARY = {
  base: 'weight shift',
  idle: ['relieved sigh', 'look away gesture'], // occasional fidgets
  listening: ['acknowledging', 'head nod yes', 'lengthy head nod'],
  thinking: ['thoughtful head shake', 'look away gesture'],
  speaking: ['talking', 'happy hand gesture', 'dismissing gesture'],
  reactions: {
    nod: 'head nod yes', hardnod: 'hard head nod', no: 'shaking head no', angry: 'angry gesture',
    annoyed: 'annoyed head shake', sigh: 'relieved sigh', cocky: 'being cocky', sarcastic: 'sarcastic head nod',
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
    const names = new Set([LIBRARY.base, ...LIBRARY.idle, ...LIBRARY.listening, ...LIBRARY.thinking, ...LIBRARY.speaking, ...Object.values(LIBRARY.reactions)]);
    await Promise.all([...names].map(async (n) => {
      try { await this.c.addMotion(n, DIR + encodeURIComponent(n) + '.vmd'); this.have.add(n); } catch { /* not downloaded */ }
    }));
    if (this.have.has(LIBRARY.base) && this.enabled) this.toBase(1);
    return this.have.size;
  }

  has(name) { return this.have.has(name); }

  toBase(fade = FADE) {
    this.gesture = null;
    this.c.play(this.have.has(LIBRARY.base) ? LIBRARY.base : 'stand', { fade });
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
      if (a.time < a.getClip().duration - FADE) return; // let it finish (fade out overlaps the tail)
      this.toBase();
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

