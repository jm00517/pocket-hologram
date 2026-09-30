// Conversational body language on top of Character's procedural layer.
// States blend smoothly (idle / listening / thinking / speaking); reactions are one-shot envelopes;
// the mouth follows a text-derived vowel timeline (Korean, Japanese kana, Latin).
import * as THREE from 'three';

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

  react(name, len = { nod: 0.7, shake: 0.9, tilt: 1.6, happy: 1.8, surprised: 1.2, shy: 2.2, wave: 2.0 }[name] ?? 1) {
    this.reactions = this.reactions.filter((r) => r.name !== name);
    this.reactions.push({ name, t: 0, len });
  }

  // Start a text-timed mouth track. rate = vowels per second (≈ syllables/s). Call again on TTS boundaries to resync.
  speak(text, { rate = 7, from = 0 } = {}) {
    const vowels = toVowels(text).slice(from);
    this.speech = vowels.length ? { vowels, t: 0, rate } : null;
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
    if (t > this.nextNod) { if (this.state === 'listening') this.react('nod', 0.5); this.nextNod = t + 2.5 + Math.random() * 3; }
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
      const f = sp.t * sp.rate, idx = Math.floor(f);
      if (idx >= sp.vowels.length) this.stopSpeaking();
      else {
        const vw = sp.vowels[idx], ph = f - idx;
        open = Math.sin(Math.PI * Math.min(1, ph * 1.3)); // open then close within the syllable
        if (vw !== ' ') target[vw] = 0.4 + 0.6 * open;
        nod = Math.sin(f * Math.PI) * 0.02; // tiny bob with syllables
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
    this.morph('にこり', 0.3 * S); // pleasant brows while talking
    c.rotate('頭', nod * S, 0, 0);

    // one-shot reactions
    let happy = 0, surprised = 0, shy = 0;
    for (const r of this.reactions) {
      r.t += dt;
      const a = env(r.t, r.len), p = r.t / r.len;
      switch (r.name) {
        case 'nod': c.rotate('頭', Math.sin(p * Math.PI * 2) ** 2 * 0.22 * a, 0, 0); break;
        case 'shake': c.rotate('頭', 0, Math.sin(p * Math.PI * 4) * 0.25 * a, 0); break;
        case 'tilt': c.rotate('頭', 0, 0, 0.25 * a); break;
        case 'happy': happy = a; c.rotate('上半身', 0, 0, Math.sin(r.t * 9) * 0.03 * a); break;
        case 'surprised': surprised = a; c.rotate('上半身', -0.12 * a, 0, 0); c.rotate('頭', -0.12 * a, 0, 0); break;
        case 'shy': shy = a; c.rotate('頭', 0.25 * a, 0, 0.1 * a); c.rotate('両目', 0.2 * a, 0, 0); break;
        case 'wave': {
          // upper arm out to the side, forearm up, waving from the elbow
          c.rotate('右腕', 0, 0, -1.25 * a);
          c.rotate('右ひじ', 0, 0, (-1.6 + Math.sin(r.t * 12) * 0.3) * a);
          break;
        }
      }
    }
    this.reactions = this.reactions.filter((r) => r.t < r.len);
    this.morph('笑い', happy);
    this.morph('びっくり', surprised);
    this.morph('瞳小', surprised * 0.6);
    if (surprised) this.morph('お', Math.max(m.o, surprised * 0.5));
    this.morph('照れ', shy) || this.morph('はぅ', shy * 0.5);
    this.morph('困る', 0.35 * T + 0.5 * shy);
  }
}
