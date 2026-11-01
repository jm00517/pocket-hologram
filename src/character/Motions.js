// Picks full-body mocap clips (VMD, see scripts/get-bandai.sh) to match the conversation state.
// Base loop = an idle clip; gestures are one-shots that crossfade back to it. Missing files are skipped,
// so without assets/motions the character just keeps the code-built stand pose.

const DIR = 'assets/motions/';
// Bandai Namco Research motion dataset (CC BY-NC 4.0, © Bandai Namco Research Inc.), fetched by
// scripts/get-bandai.sh — Japanese performers, feminine/childish styles. Name → file under DIR.
const BN = (f) => `bandai/vmd/dataset-${f}_001`;
const DD = (f) => `mmd/deedee524/Idle Animations Pack - Copy/${f}`;
const WL = (f) => 'rip/loops/WW_' + f, WA = (f) => 'rip/acts/WW_Cut' + f;
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
  // text-to-motion clips (gen/vmd), vetted on the Sour Miku: these hold up; idle_look (she lies down),
  // idle_breathe (whips the hair), think (just spreads the arms) and every Mixamo conversion in vmd/
  // (hair physics explodes) do not
  g_cheer: 'gen/vmd/cheer_0', g_clap: 'gen/vmd/clap_0', g_shy: 'gen/vmd/shy_0', g_shystand: 'gen/vmd/a_person_stands_shyly_0051_0',
  g_nod: 'gen/vmd/listen_nod_0', g_nod2: 'gen/vmd/listen_nod_1', g_talk: 'gen/vmd/talk_both_0', g_talk2: 'gen/vmd/talk_both_1', g_talkr: 'gen/vmd/talk_right_0',
  // Wuthering Waves rips (private study only: scripts/rip2vmd.sh -> assets/motions/rip, never committed). The clips that
  // survived the retarget onto the Sour Miku, vetted on frame sheets: the sits, turns-away, weapon draws and the shots
  // that walk off did not. loops/ = character stands (in place), acts/ = cutscene acting shots.
  w_stand: WL('Chun_Base_Stand1'), w_stand2: WL('Jinxi_Stand2'), w_calm: WL('Chun_Stand1_Action01'), w_calm2: WL('Yangyang_Stand1_Action01'),
  w_calm3: WL('Stand1_Action02'), w_calm4: WL('TaiDaoNv_Stand1_Action01'), w_calm5: WL('Fuludelisi_Stand1_Action01'),
  w_face: WL('Chun_Stand1_Action02'), w_hair: WL('Chun_Stand2'), w_chest: WL('Sanhua_Stand1_Action02'), w_clasp: WL('Yangyang_Stand1_Action03'), w_wave: WL('Chun_Stand1_Action03'),
  w_talk: WA('ChangLiB_Cam004'), w_talk2: WA('ChangLi_Cam012'), w_talk3: WA('ChangLi_Cam033'), w_talk4: WA('ChangLi_Cam035'), w_talk5: WA('ChangLi_Cam054'),
  w_talk6: WA('ChangLi_Cam055'), w_talk7: WA('Rover_Cam015'), w_talk8: WA('Rover_Cam027'), w_talk9: WA('Rover_Cam054'), w_talk10: WA('Kati_Cam020'),
  w_nod: WA('Suo_Cam001'), w_clasp2: WA('ChangLi_Cam013'), w_step: WA('Suo_Cam002'), w_lookup: WA('ChangLi_Cam015'), w_aside: WA('Suo_Cam004'),
  w_hip: WA('ChangLiB_Cam007'), w_hip2: WA('ChangLi_Cam032'), w_wave2: WA('Fleur_Cam019'), w_wave3: WA('You_Cam013'), w_open: WA('Fleur_Cam026'),
  w_spread: WA('Yang_Cam013'), w_turn: WA('Rover_Cam010'), w_turn2: WA('Rover_Cam016'), w_bow: WA('Suo_Cam015A'),
};
const fileOf = (name) => DIR + (FILES[name] ?? 'vmd/' + name).split('/').map(encodeURIComponent).join('/') + '.vmd';
// Idle = MMD community motions (anime-girl stances); conversation gestures = Bandai. Missing files are
// skipped, falling back to the code-built stand pose and procedural nods.
export const LIBRARY = {
  base: ['st_koa', 'st_rea', 'st_marieru', 'st_usa', 'st_ten', 'w_stand', 'w_stand2', 'w_calm', 'w_calm2', 'w_calm3', 'w_calm4', 'w_calm5'], // looping stands, rotated each cycle
  idle: ['stretch', 'fixhair', 'tidy', 'shyidle', 'sway', 'confident', 'impatient', 'w_face', 'w_hair', 'w_chest', 'w_clasp', 'w_wave', 'w_hip', 'w_hip2'], // occasional fidgets
  listening: ['respond', 'g_nod', 'g_nod2', 'w_nod', 'w_clasp2', 'w_step'],
  thinking: ['sky', 'sniff', 'w_lookup', 'w_aside'],
  speaking: ['guide', 'guide2', 'guide3', 'g_talk', 'g_talk2', 'g_talkr', 'w_talk', 'w_talk2', 'w_talk3', 'w_talk4', 'w_talk5', 'w_talk6', 'w_talk7', 'w_talk8', 'w_talk9', 'w_talk10'],
  reactions: {
    bow: 'bow', hi: 'hi', byebye: 'byebye', wave: 'wave', wave2: 'wave2', raise: 'raise', call: 'call', shybow: 'shybow',
    cheer: 'g_cheer', clap: 'g_clap', shy: 'g_shy', shystand: 'g_shystand',
    wave3: 'w_wave2', wave4: 'w_wave3', open: 'w_open', spread: 'w_spread', turn: 'w_turn', turn2: 'w_turn2', bow2: 'w_bow', hip: 'w_hip', lookup: 'w_lookup',
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
    const a = this.c.actions[this.base];
    if (a && this.c.current === a) { a.reset().play(); return; } // only one stand: play() would skip it and it'd freeze at its end
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

