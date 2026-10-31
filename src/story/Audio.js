// Story sound: background music (#bgm) and one-shot effects (#sfx). Not placed in the world: plain THREE.Audio on
// the engine's listener, so audio.volume still rules them. Music is assets/music/<name>.ogg|mp3, effects
// assets/sfx/<name>.ogg|wav|mp3 (both gitignored), each fetched and decoded once. A name the checkout doesn't have
// is a warning, not an error: a story can name sounds that are fetched separately. 'pop' and 'chime' are made here
// so a story has something to play out of the box. The music dips while she speaks (tick's ducked).
import * as THREE from 'three';

export function createAudio(engine) {
  const L = engine.listener, ctx = L.context, P = { bgm: 0.5, sfx: 0.8 };
  const buffers = new Map(); // dir/name -> Promise<AudioBuffer|null>; a miss is cached too, so it warns once
  const load = (dir, name, exts) => {
    const key = `${dir}/${name}`;
    if (!buffers.has(key)) buffers.set(key, (async () => {
      for (const e of exts) {
        try { const r = await fetch(`assets/${dir}/${encodeURI(name)}.${e}`); if (r.ok) return await ctx.decodeAudioData(await r.arrayBuffer()); } catch { /* next extension (Safari decodes no ogg) */ }
      }
      console.warn(`story audio: no assets/${dir}/${name}.{${exts.join(',')}}`);
      return null;
    })());
    return buffers.get(key);
  };
  const synth = (len, f) => {
    const n = Math.round(ctx.sampleRate * len), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = f(i / ctx.sampleRate);
    return b;
  };
  const TAU = Math.PI * 2;
  const BUILTIN = {
    // a bubble: a sine sliding down from ~900 Hz to 300 Hz in a few tens of ms
    pop: () => { let ph = 0; return synth(0.12, (t) => { ph += TAU * (300 + 600 * Math.exp(-t / 0.025)) / ctx.sampleRate; return Math.sin(ph) * Math.exp(-t / 0.03) * Math.min(1, t / 0.002) * 0.8; }); },
    // two bell strikes a fifth apart (C6, G6), each with an inharmonic partial that dies first
    chime: () => synth(1.6, (t) => [[0, 1046.5], [0.13, 1568]].reduce((s, [t0, f]) => {
      const u = t - t0;
      return u < 0 ? s : s + (Math.sin(TAU * f * u) + 0.35 * Math.sin(TAU * f * 2.76 * u) * Math.exp(-u / 0.15)) * Math.exp(-u / 0.5) * Math.min(1, u / 0.003) * 0.3;
    }, 0)),
  };
  const made = {};
  const drop = (s) => { if (s.isPlaying) s.stop(); s.disconnect(); s.gain.disconnect(); };

  let tracks = [], seq = 0, duck = 1; // tracks: { name, s, env 0..1, target, rate /s, vol }; the old one fades out under the new
  function bgm(name, { fade = 1.5, vol = 1 } = {}) {
    const my = ++seq, rate = 1 / Math.max(fade, 0.01), cur = tracks.find((t) => t.target > 0);
    if (name && cur?.name === name) { cur.vol = vol; return; } // the same tune again: only its level
    for (const t of tracks) { t.target = 0; t.rate = rate; }
    if (!name) return;
    load('music', name, ['ogg', 'mp3']).then((b) => {
      if (!b || my !== seq) return; // another #bgm came while this one loaded
      const s = new THREE.Audio(L); s.setBuffer(b); s.setLoop(true); s.setVolume(0); s.play();
      tracks.push({ name, s, env: 0, target: 1, rate, vol });
    });
  }
  async function sfx(name, { vol = 1 } = {}) {
    const b = BUILTIN[name] ? (made[name] ??= BUILTIN[name]()) : await load('sfx', name, ['ogg', 'wav', 'mp3']);
    if (!b) return;
    const s = new THREE.Audio(L); s.setBuffer(b); s.setVolume(vol * P.sfx);
    s.onEnded = () => { s.isPlaying = false; drop(s); }; // one node set per shot, let go when it's done
    s.play();
  }
  function tick(dt, { ducked = false } = {}) {
    duck += ((ducked ? 0.45 : 1) - duck) * (1 - Math.exp(-dt / 0.25));
    tracks = tracks.filter((t) => {
      t.env += Math.sign(t.target - t.env) * Math.min(Math.abs(t.target - t.env), t.rate * dt);
      if (!t.target && !t.env) { drop(t.s); return false; }
      t.s.setVolume(t.env * t.vol * P.bgm * duck);
      return true;
    });
  }
  const params = [
    { id: 'story.bgm', label: '배경음악', doc: 'Story background music volume (#bgm); it dips while she speaks. 0 = off.', min: 0, max: 1, step: 0.05, get: () => P.bgm, set: (v) => { P.bgm = v; } },
    { id: 'story.sfx', label: '효과음', doc: 'Story sound effect volume (#sfx).', min: 0, max: 1, step: 0.05, get: () => P.sfx, set: (v) => { P.sfx = v; } },
  ];
  engine.params.define(params);
  return { bgm, sfx, tick, params };
}
