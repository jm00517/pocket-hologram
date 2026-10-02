// Conversational body language on top of Character's procedural layer.
// States blend smoothly (idle / listening / thinking / speaking); reactions are one-shot envelopes;
// the mouth follows a text-derived vowel timeline (Korean, Japanese kana, Latin).
import * as THREE from 'three';
import { LIBRARY } from './Motions.js';

const clamp = THREE.MathUtils.clamp;
const STATES = ['idle', 'listening', 'thinking', 'speaking'];
const env = (t, len, fade = 0.15) => clamp(Math.min(t / fade, (len - t) / fade), 0, 1); // 0→1→0 over [0,len]

// --- text → vowels ('a','i','u','e','o', or ' ' for a closed mouth) --------------------------------
// Hangul medial vowel index (0..20) → mouth shape
const HANGUL_V = 'aeaeoeoeoaeeouoeuuuii'; // ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ
const KANA_V = { a: 'あかさたなはまやらわがざだばぱぁゃ', i: 'いきしちにひみりぎじぢびぴぃ', u: 'うくすつぬふむゆるぐずづぶぷぅゅ', e: 'えけせてねへめれげぜでべぺぇ', o: 'おこそとのほもよろをごぞどぼぽぉょ' };
const kanaVowel = {};
for (const [vw, chars] of Object.entries(KANA_V)) for (const c of chars) kanaVowel[c] = vw;

export function toVowels(text) {
  const out = [];
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) out.push(HANGUL_V[Math.floor((c - 0xac00) / 28) % 21]);
    else if (kanaVowel[ch]) out.push(kanaVowel[ch]);
    else if (c >= 0x30a1 && c <= 0x30f6 && kanaVowel[String.fromCodePoint(c - 0x60)]) out.push(kanaVowel[String.fromCodePoint(c - 0x60)]); // katakana
    else if (ch === 'ん' || ch === 'ン' || ch === 'っ' || ch === 'ッ') out.push(' ');
    else if (/[aeiou]/i.test(ch)) out.push(ch.toLowerCase());
    else if (/[\s,.!?、。！？…~]/.test(ch)) out.push(' ');
    // consonants / other chars: skip (they ride on the neighbouring vowel)
  }
  return out;
}

// Facial expressions: face morphs only, no body. Each entry lists [morph, weight] alternatives in
// priority order per slot, so models missing a morph fall back (Sour has 照れ, Classic only はぅ).
export const EXPRESSIONS = {
  smile: [[['にこり', 0.8]], [['口角上げ', 0.5]]],
  happy: [[['笑い', 1]], [['にこり', 0.6]]],
  surprised: [[['びっくり', 1]], [['瞳小', 0.6]], [['お', 0.5]]],
  shy: [[['照れ', 1], ['はぅ', 0.5]], [['困る', 0.5]]],
  sad: [[['悲しい', 1], ['困る', 0.8]], [['口角下げ', 0.5]]],
  angry: [[['怒り', 1]], [['真面目', 0.4]]],
  pout: [[['じと目', 0.8]], [['ω', 0.6]]],
  wink: [[['ウィンク', 1], ['ウィンク２', 1]], [['にこり', 0.5]]],
  heart: [[['はぁと', 1]], [['にこり', 0.6]]],
  sparkle: [[['星目', 1], ['瞳大', 0.8]], [['にこり', 0.6]]],
};
const EXPR_MORPHS = [...new Set(Object.values(EXPRESSIONS).flat(2).map(([m]) => m))];
export const REACTIONS = ['nod', 'shake', 'tilt', 'bounce', 'recoil', 'lookdown', 'wave'];

export class Behavior {
  constructor(character) {
    this.c = character;
    this.state = 'idle';
    this.w = Object.fromEntries(STATES.map((s) => [s, s === 'idle' ? 1 : 0])); // blended weights
    this.reactions = []; // {name, t, len}
    this.mouth = { a: 0, i: 0, u: 0, e: 0, o: 0 };
    this.speech = null; // {vowels, start, rate}
    this.written = new Map(); // morph -> last value we wrote (so we don't stomp motion-driven morphs)
    this.nextNod = 2;
  }

  setState(s) { if (STATES.includes(s)) this.state = s; }

  // Face only. hold = keep until another expression (or 'neutral'); else fades after len seconds.
  express(name, { len = 2.5, hold = false } = {}) {
    this.expr = name === 'neutral' || !EXPRESSIONS[name] ? null : { name, t: 0, len, hold };
  }

  // Body only (procedural or a mocap clip when one is loaded).
  react(name, len = { nod: 0.7, shake: 0.9, tilt: 1.6, bounce: 1.8, recoil: 1.2, lookdown: 2.2, wave: 2.0 }[name] ?? 1) {
    // prefer a mocap clip when one is loaded (nod/shake map onto Mixamo's nod / head-shake)
    const clip = LIBRARY.reactions[{ nod: 'nod', shake: 'no' }[name] ?? name];
    if (clip && this.c.director?.play(clip)) return;
    this.reactions = this.reactions.filter((r) => r.name !== name);
    this.reactions.push({ name, t: 0, len });
  }

  // Start a text-timed mouth track. rate = vowels per second (≈ syllables/s). Call again on TTS boundaries to resync.
  speak(text, { rate = 7, from = 0 } = {}) {
    const vowels = toVowels(text).slice(from);
    this.speech = vowels.length ? { vowels, t: 0, rate } : null;
    this.setState('speaking');
  }

  // Start a mouth track from TTS mora marks [{ v: 'a'|'i'|'u'|'e'|'o'|'n', t: seconds }] (audio-accurate).
  speakTimed(marks) {
    this.speech = marks.length ? { marks, t: 0 } : null;
    this.setState('speaking');
  }

  stopSpeaking() { this.speech = null; if (this.state === 'speaking') this.setState('idle'); }

  morph(name, v) {
    const c = this.c;
    if (c.morphs[name] === undefined) return false;
    const last = this.written.get(name) ?? 0;
    if (v < 1e-3 && last < 1e-3) return true; // leave it to motions
    c.morph(name, v);
    this.written.set(name, v);
    return true;
  }

  apply(dt) {
    const c = this.c, t = c.t;
    const k = 1 - Math.exp(-dt * 5);
    for (const s of STATES) this.w[s] += ((s === this.state ? 1 : 0) - this.w[s]) * k;
    const { listening: L, thinking: T, speaking: S } = this.w;

    // listening: lean in, head tilted, small "uh-huh" nods now and then
    let nod = 0;
    if (t > this.nextNod) { if (this.state === 'listening' && !this.c.director?.has(LIBRARY.listening[0])) this.react('nod', 0.5); this.nextNod = t + 2.5 + Math.random() * 3; }
    c.rotate('上半身', 0.05 * L - 0.02 * T, 0, 0);
    c.rotate('頭', 0, 0, 0.12 * L - 0.08 * T);

    // thinking: gaze up and to the side, slight frown, slow sway
    c.rotate('首', -0.1 * T, 0.15 * T, 0);
    c.rotate('両目', -0.2 * T, 0.25 * T, 0);

    // speaking: syllable-driven head bob + mouth
    let open = 0;
    const target = { a: 0, i: 0, u: 0, e: 0, o: 0 };
    if (this.speech) {
      const sp = this.speech;
      sp.t += dt;
      if (sp.marks) {
        const ms = sp.marks, last = ms[ms.length - 1];
        let i = 0; while (i + 1 < ms.length && ms[i + 1].t <= sp.t) i++;
        if (sp.t > last.t + 0.3) this.stopSpeaking();
        else if (sp.t >= ms[0].t) {
          const dur = Math.max(0.06, (ms[i + 1]?.t ?? ms[i].t + 0.14) - ms[i].t), ph = (sp.t - ms[i].t) / dur;
          open = Math.sin(Math.PI * Math.min(1, ph * 1.2));
          if (ms[i].v in target) target[ms[i].v] = 0.4 + 0.6 * open;
          nod = Math.sin(sp.t * 8) * 0.015;
        }
      } else {
      const f = sp.t * sp.rate, idx = Math.floor(f);
      if (idx >= sp.vowels.length) this.stopSpeaking();
      else {
        const vw = sp.vowels[idx], ph = f - idx;
        open = Math.sin(Math.PI * Math.min(1, ph * 1.3)); // open then close within the syllable
        if (vw !== ' ') target[vw] = 0.4 + 0.6 * open;
        nod = Math.sin(f * Math.PI) * 0.02; // tiny bob with syllables
      }
      }
    }
    const m = this.mouth, km = 1 - Math.exp(-dt * 25);
    for (const vw in m) m[vw] += (target[vw] - m[vw]) * km;
    const hasE = c.morphs['え'] !== undefined;
    this.morph('あ', m.a + (hasE ? 0 : m.e * 0.4));
    this.morph('い', m.i + (hasE ? 0 : m.e * 0.5));
    this.morph('う', m.u);
    if (hasE) this.morph('え', m.e);
    this.morph('お', m.o);
    c.rotate('頭', nod * S, 0, 0);

    // one-shot body reactions (no face)
    for (const r of this.reactions) {
      r.t += dt;
      const a = env(r.t, r.len), p = r.t / r.len;
      switch (r.name) {
        case 'nod': c.rotate('頭', Math.sin(p * Math.PI * 2) ** 2 * 0.22 * a, 0, 0); break;
        case 'shake': c.rotate('頭', 0, Math.sin(p * Math.PI * 4) * 0.25 * a, 0); break;
        case 'tilt': c.rotate('頭', 0, 0, 0.25 * a); break;
        case 'bounce': c.rotate('上半身', 0, 0, Math.sin(r.t * 9) * 0.03 * a); break;
        case 'recoil': c.rotate('上半身', -0.12 * a, 0, 0); c.rotate('頭', -0.12 * a, 0, 0); break;
        case 'lookdown': c.rotate('頭', 0.25 * a, 0, 0.1 * a); c.rotate('両目', 0.2 * a, 0, 0); break;
        case 'wave': {
          // upper arm out to the side, forearm up, waving from the elbow
          c.rotate('右腕', 0, 0, -1.25 * a);
          c.rotate('右ひじ', 0, 0, (-1.6 + Math.sin(r.t * 12) * 0.3) * a);
          break;
        }
      }
    }
    this.reactions = this.reactions.filter((r) => r.t < r.len);

    // facial expression (face only); thinking adds a slight frown on top
    const w = Object.fromEntries(EXPR_MORPHS.map((n) => [n, 0]));
    if (this.expr) {
      const x = this.expr;
      x.t += dt;
      const a = x.hold ? Math.min(1, x.t / 0.15) : env(x.t, x.len);
      for (const slot of EXPRESSIONS[x.name]) {
        const hit = slot.find(([n]) => c.morphs[n] !== undefined);
        if (hit) w[hit[0]] = hit[1] * a;
      }
      if (!x.hold && x.t >= x.len) this.expr = null;
    }
    w['困る'] = Math.max(w['困る'] ?? 0, 0.35 * T);
    w['にこり'] = Math.max(w['にこり'] ?? 0, 0.3 * S); // pleasant brows while talking
    if (w['お']) w['お'] = Math.max(w['お'], m.o); else delete w['お']; // the lip sync owns the mouth
    for (const [n, v] of Object.entries(w)) this.morph(n, v);
  }
}
