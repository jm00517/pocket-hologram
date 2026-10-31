// Story director: carries out a line's direction tags (#expr, #walk, #bgm, #fade ... story/README.md; COMMANDS in
// Script.js) on her (Behavior, MotionDirector, Hands, Life, Follow), on the engine (params, maps, commands) and on
// the story's own sound and effects. A bad tag is logged and skipped, never thrown: a typo in a script should cost
// that one direction, not the scene. Blocking tags (COMMANDS[x].block) return a promise the runner waits on.
// #memory and #input are the runner's, #clear the view's; this skips them quietly.
import * as THREE from 'three';
import { COMMANDS, FX_KINDS, LOOKS, PERIODS, cmdArgs } from './Script.js';
import { EXPRESSIONS, REACTIONS } from '../character/Behavior.js';
import { LIBRARY } from '../character/Motions.js';
import { HAND_MODES } from '../character/Hands.js';

// #time: where each period puts the sun (sky maps' <map>.elev, degrees) and the crossing's matching preset;
// the same bands the real-time clock in main.js uses (above 12 day, above -4 sunset)
const ELEV = { morning: 15, day: 45, evening: 4, night: -12 };
const WEATHER = { morning: 'day', day: 'day', evening: 'sunset', night: 'night' };
const motionOf = (name) => LIBRARY.reactions[name] ?? name; // 'cheer' is the clip g_cheer
const num = (s, d) => (s === undefined || s === '' || !Number.isFinite(+s) ? d : +s);
const literal = (s) => { try { return JSON.parse(s); } catch { return s; } }; // #set:x=0.6 a number, =rain a string
const delay = (s) => new Promise((r) => setTimeout(r, Math.max(0, s) * 1000));
const up = new THREE.Vector3(0, 1, 0);

export function createDirector({ engine, getCharacter, chat, audio, fx, log = console.warn }) {
  const her = () => { const c = getCharacter(); if (!c?.mesh) throw new Error('no character loaded'); return c; };
  // over her head and a little to her right, where a manga artist puts the sweat drop (head bone sits at the jaw)
  const overHead = () => {
    const c = getCharacter(), U = engine.units;
    if (!c?.mesh) return null;
    return c.bones['頭'].getWorldPosition(new THREE.Vector3()).addScaledVector(up, 0.3 * U)
      .add(new THREE.Vector3(-1, 0, 0).transformDirection(c.mesh.matrixWorld).multiplyScalar(0.14 * U));
  };
  const coords = (args, n) => { const v = args.slice(0, n).map(Number); if (v.length < n || !v.every(Number.isFinite)) throw new Error(`needs ${n} numbers`); return v; };
  const touched = new Set(); // what this scene set, so reset() leaves the drawer's own hand mode and state alone
  const oneOf = (v, list, what) => { if (!list.includes(v)) throw new Error(`unknown ${what} '${v}' (${list.join(' ')})`); return v; };

  async function setTime(p) {
    oneOf(p, PERIODS, 'time');
    const P = engine.params, id = engine.map;
    if (P.has('time.real')) await P.set('time.real', 0); // a scripted hour holds until someone turns the real clock back on
    if (id && P.has(`${id}.elev`)) await P.set(`${id}.elev`, ELEV[p]);
    if (id === 'crossing') await P.set('crossing.weather', WEATHER[p]);
  }

  function exec(tag) {
    const { name, value, args, kv } = tag, [a0, a1, a2] = args;
    switch (name) {
      case 'expr': { if (a0 !== 'neutral') oneOf(a0, Object.keys(EXPRESSIONS), 'expression'); return her().behavior.express(a0, { hold: args.includes('hold'), len: num(kv.len, 2.5) }); }
      case 'motion': {
        const d = her().director;
        if (a0 === 'idle') return d.toBase();
        if (!d.play(motionOf(a0))) throw new Error(d.has(motionOf(a0)) ? 'she is walking (or a drawer clip holds her)' : 'clip not loaded (assets/motions)');
        return;
      }
      case 'react': return her().behavior.react(oneOf(a0, REACTIONS, 'reaction'));
      case 'state': { const b = her().behavior; b.setState(a0); if (b.state !== a0) throw new Error(`unknown state '${a0}'`); return; }
      case 'hands': return her().hands.set(oneOf(a0, HAND_MODES, 'hand mode'), oneOf(a1 ?? 'both', ['both', 'left', 'right'], 'side'));
      case 'look': return her().life.look(a0 === 'free' ? null : oneOf(a0, LOOKS, 'look'));
      case 'walk': return her().follow.walkTo(...coords(args, 2));
      case 'place': return her().follow.place(...coords(args, 2), a2 === undefined ? undefined : coords([a2], 1)[0]);
      case 'face': return her().follow.face(a0 === 'you' ? 'you' : coords([a0], 1)[0]);
      case 'follow': director.follow = oneOf(a0, ['on', 'off'], 'follow') === 'on'; return;
      case 'map': return engine.setMap(a0 === 'grid' ? null : oneOf(a0, engine.maps().map((m) => m.id), 'map')); // '#map:' alone must not clear it
      case 'time': return setTime(a0);
      case 'bgm': return audio.bgm(a0 === 'stop' ? null : a0, { fade: num(kv.fade, 1.5), vol: num(kv.vol, 1) });
      case 'sfx': return audio.sfx(a0, { vol: num(kv.vol, 1) });
      case 'fx': her(); return fx.emote(oneOf(a0, FX_KINDS, 'fx'), overHead);
      case 'wait': return delay(num(a0, 1));
      case 'fade': return fx.fade(oneOf(a0, ['out', 'in'], 'fade'), num(a1, 0.6));
      case 'set': { const i = value.indexOf('='); if (i < 1) throw new Error('use #set:<param>=<value>'); return engine.params.set(value.slice(0, i).trim(), literal(value.slice(i + 1).trim())); }
      case 'cmd': { const c = cmdArgs(tag); if (!c.name) throw new Error('use #cmd:<command> key=value ...'); return engine.call(c.name, c.args); } // key=value: ink eats { } in a tag
      case 'clear': case 'memory': case 'input': return;
      default: throw new Error('not carried out by the director');
    }
  }

  const director = {
    follow: null, // #follow: null = the app's default, true / false = the story's call (main.js reads it)
    /** one direction; returns a promise for the ones worth waiting on. Never throws: problems go to log. */
    run(tag, line) {
      if (!COMMANDS[tag.name]) { log(`story: unknown direction #${tag.raw}`); return; }
      const fail = (e) => log(`story: #${tag.raw}: ${e?.message ?? e}`);
      touched.add(tag.name);
      try { const r = exec(tag, line); return r?.then ? r.then(() => {}, fail) : undefined; } catch (e) { fail(e); }
    },
    /** her line in her voice; resolves when she's done or cut off (at once for an unvoiced line) */
    voice(line) {
      if (!line?.voice || !line.say || !chat) return Promise.resolve();
      return chat.say(line.say, { voice: line.voice, style: line.style ?? undefined, cache: true, interrupt: true }); // no style: near -> whisper
    },
    stopVoice() { chat?.stop?.(); },
    /** the scene is over: what a scene sets only for itself goes back */
    reset() {
      director.follow = null; fx.clear();
      const c = getCharacter(), t = new Set(touched);
      touched.clear();
      if (!c?.mesh) return;
      if (t.has('look')) c.life?.look(null);
      if (t.has('hands')) c.hands?.set('auto');
      if (t.has('state') && c.behavior.state !== 'speaking') c.behavior.setState('idle'); // a voice still finishing ends in idle by itself
    },
    /** lib.ink has_motion(): a name #motion would play right now (aliases included) */
    hasMotion(name) { const d = getCharacter()?.director; return name === 'idle' || !!d?.has(motionOf(name)); },
    /** every name a tag may use (for lint and the dev tools); motions: every clip the library knows, loaded or not */
    catalog() {
      const L = LIBRARY, have = getCharacter()?.director?.have ?? [];
      const motions = new Set(['idle', ...L.base, ...L.idle, ...L.listening, ...L.thinking, ...L.speaking, ...Object.keys(L.reactions), ...Object.values(L.reactions), ...have]);
      return {
        expressions: ['neutral', ...Object.keys(EXPRESSIONS)], reactions: [...REACTIONS], motions: [...motions], hands: [...HAND_MODES],
        maps: [...engine.maps().map((m) => m.id), 'grid'], params: engine.params.list().map((p) => p.id),
        commands: engine.commands().map((c) => c.name), fx: [...FX_KINDS],
      };
    },
  };
  return director;
}
