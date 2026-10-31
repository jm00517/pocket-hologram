// The story layer, wired up. The Runner (ink) plays scenes on the Stage made here: two views, DomView on the monitor and
// XRView in the headset, that both get every call (the first answer from either one wins), plus the Director (her,
// the engine, sound and effects). Also here: the story.* settings (kept in the 'global' save), the game events that
// become triggers (map, VR, how a chat made her feel, head nods and shakes, eye contact, idling, the time of day), the
// menu, the per-frame ticks, the story.* engine commands the dev tools (tools/dev.html) drive, and the save on leaving.
// Her model can be swapped at any moment: everything that touches her goes through getCharacter() and copes with null.
import * as THREE from 'three';
import { COMMANDS, EVENTS, EXTERNALS, parseTag, fetchSources, lint, matchChoice } from './Script.js';
import { Runner } from './Runner.js';
import { HeadGestures } from './Gestures.js';
import { createDirector } from './Director.js';
import { createAudio } from './Audio.js';
import { createFx } from './Fx.js';
import { createStore } from './Store.js';
import { createDomView } from './DomView.js';
import { createXRView } from './XRView.js';

const DEG = Math.PI / 180, READ_S = 0.05; // auto mode, a line without voice: this long per character to read it
const MODE = { idle: '자유', scene: '장면', choice: '선택지', input: '입력 대기', replay: '추억 재생' };
const SETTING = /^(story\.|xr\.text)/; // the settings page, and what the 'global' save keeps
// the bands of lib.ink's period() (story/README.md)
const periodOf = (h) => (h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 17 ? 'day' : h >= 17 && h < 20 ? 'evening' : 'night');
const pad = (n) => String(n).padStart(2, '0');
const pluck = (o, keys) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.fromEntries(keys.map((x) => [x, v[x]]))])); // no functions over the bridge

/** controllers(): [{ray, grip, src}] indexed like renderer.xr.getController(i); tips(): [Vector3|null] bare fingertips */
export function mountStory({ engine, chat, getCharacter, controllers = () => [], tips = () => [] }) {
  const P = { textSpeed: 40, autoDelay: 1.2, auto: 0, skipUnread: 0, subs: 'ko', voice: 1, idle: 120, gaze: 3 };
  const st = { skip: false };
  let runner = null, pend = null, logOpen = false, menuOpen = false, booted = false, early = null, files = null, broken = '';
  let idleT = 0, gazeT = 0, gazeCool = 0, period = null, wasScene = false, applying = false, settingsTimer = 0;

  const store = createStore(), audio = createAudio(engine), fx = createFx(engine);
  const views = [createDomView({ params: engine.params }), createXRView({ engine, getCharacter })], xr = views[1];
  const all = (m, ...a) => { for (const v of views) v[m](...a); };
  // a bad tag goes to the dev tools' log as well as the console (a warning: the scene goes on)
  const director = createDirector({ engine, getCharacter, chat, audio, fx, log: (m) => { console.warn(m); runner?.emit('error', { message: m, warning: true }); } });
  const life = () => getCharacter()?.life ?? null;
  const status = () => all('status', { auto: !!P.auto, skip: st.skip, scene: !!runner?.busy });
  const setSkip = (on) => { if (st.skip === on) return; st.skip = on; status(); pend?.arm?.(); };

  const num = (id, label, doc, min, max, step, key) => ({ id, label, doc, min, max, step, get: () => P[key], set: (v) => { P[key] = v; } });
  engine.params.define([
    num('story.textSpeed', '글자 속도', 'Story text: characters typed per second (0 = the whole line at once).', 0, 120, 5, 'textSpeed'),
    num('story.autoDelay', '자동 진행 대기', 'Auto mode: seconds after her voice ends (or, without voice, after the text has had time to be read) before the next line.', 0, 5, 0.1, 'autoDelay'),
    { ...num('story.auto', '자동 진행', 'Auto mode: lines move on by themselves (A, or the 자동 button).', 0, 1, 1, 'auto'), set: (v) => { P.auto = v; status(); pend?.arm?.(); } },
    num('story.skipUnread', '안 읽은 대사도 스킵', 'Skip (hold Ctrl, or the 스킵 button) runs past lines never read before too; off = skip stops at the first unread line.', 0, 1, 1, 'skipUnread'),
    { id: 'story.subs', label: '자막', doc: 'Subtitle language under her lines (#ko: / #en: tags), or off.', type: 'enum', values: [['ko', '한국어'], ['en', 'English'], ['off', '끔']], get: () => P.subs, set: (v) => { P.subs = v; } },
    num('story.voice', '대사 목소리', 'Her story lines are spoken (0 = text only).', 0, 1, 1, 'voice'),
    num('story.idle', '심심해질 때까지 (초)', "Seconds with nothing happening (no scene, no talk, no event) before an 'idle' event.", 10, 1200, 10, 'idle'),
    num('story.gaze', '눈맞춤 (초)', "In VR: seconds of looking her in the face (within ~8 deg, under 3 m) before a 'gaze' event.", 1, 10, 0.5, 'gaze'),
  ]);
  // every story.* / xr.text* change goes into the 'global' save (debounced: a slider sends a stream of values)
  engine.params.onChange((id, v) => {
    if (!SETTING.test(id) || applying || !runner?.gOk) return;
    runner.g.settings = { ...runner.g.settings, [id]: v };
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => store.setGlobal(runner.g).catch((e) => console.warn('story settings', e)), 800);
  });

  // ---- the Stage: what the Runner waits on is `pend` (one at a time); views and voice answer it ----
  // a spoken answer (or one typed in the chat bar, which shows for it: body.story-listen): hear() until take() accepts one
  function listen(w, take) {
    document.body.classList.add('story-listen');
    const again = () => chat.hear().then((text) => { if (pend === w && !take(text)) again(); });
    again();
  }
  function settle(w) {
    if (pend !== w) return false;
    pend = null; document.body.classList.remove('story-listen'); chat.unhear();
    return true;
  }
  const stage = {
    line(l, { read }) {
      const skipping = st.skip && (read || !!P.skipUnread);
      if (st.skip && !skipping) setSkip(false); // skip stops at a line never read
      const shown = Promise.all(views.map((v) => v.show(l, { cps: skipping ? 0 : P.textSpeed, sub: P.subs })));
      const voice = l.voice && P.voice && !skipping ? director.voice(l) : null; // skipped lines aren't sent to the synth at all
      return new Promise((resolve) => {
        const t0 = performance.now(), w = { kind: 'line', typed: 0, voiced: voice ? 0 : -1, timer: 0 };
        w.done = () => { clearTimeout(w.timer); if (!settle(w)) return; if (!w.voiced) director.stopVoice(); resolve(); }; // leaving: cut her off
        // the earliest of: skip, #auto, auto mode (voice over, or text typed and read) + story.autoDelay
        w.arm = () => {
          clearTimeout(w.timer);
          if (menuOpen || logOpen) return; // nothing moves on behind the menu or the backlog; closing them arms again
          if (st.skip && (read || P.skipUnread)) { w.timer = setTimeout(w.done, 60); return; }
          const at = [];
          if (l.auto !== null) at.push(t0 + l.auto * 1000);
          const base = voice ? w.voiced && w.typed && Math.max(w.voiced, w.typed) : w.typed && w.typed + [...l.text].length * READ_S * 1000;
          if (P.auto && base > 0) at.push(base + P.autoDelay * 1000);
          if (at.length) w.timer = setTimeout(w.done, Math.max(0, Math.min(...at) - performance.now()));
        };
        pend = w;
        shown.then(() => { w.typed = performance.now(); if (pend === w) w.arm(); });
        voice?.then(() => { w.voiced = performance.now(); if (pend === w) w.arm(); });
        w.arm();
      });
    },
    choose(choices, { timer, def }) {
      setSkip(false); // skip stops at choices
      all('choices', choices, { timer });
      return new Promise((resolve) => {
        const w = { kind: 'choice', timer: 0, left: timer * 1000, t: 0 };
        w.done = (i) => { clearTimeout(w.timer); if (!settle(w)) return; all('clearChoices'); resolve(i); };
        // the time left runs only while no menu or backlog covers the choices
        w.arm = () => {
          clearTimeout(w.timer);
          if (!(timer > 0)) return;
          if (w.t) { w.left -= performance.now() - w.t; w.t = 0; }
          if (menuOpen || logOpen) return;
          w.t = performance.now(); w.timer = setTimeout(() => w.done(def), Math.max(0, w.left));
        };
        pend = w;
        w.arm();
        listen(w, (text) => { const i = matchChoice(text, choices); if (i >= 0) w.done(choices[i].index); return i >= 0; });
      });
    },
    ask(prompt) {
      all('prompt', prompt);
      return new Promise((resolve) => {
        const w = { kind: 'ask' };
        w.done = (text) => { if (!settle(w)) return; all('clearPrompt'); resolve(String(text ?? '').trim()); };
        pend = w;
        listen(w, (text) => { if (text.trim()) w.done(text); return !!text.trim(); });
      });
    },
    direction(tag, line) { if (tag.name === 'clear') all('hide'); else return director.run(tag, line); },
    clear() {
      pend?.done();
      all('hide'); all('clearChoices'); all('clearPrompt');
      director.reset();
      all('status', { auto: !!P.auto, skip: st.skip, scene: false });
    },
    advance() { if (pend?.kind === 'line') pend.done(); },
    pick(i) { if (pend?.kind === 'choice') pend.done(i); },
    thumb() { try { return engine.xr ? null : engine.snapshot({ width: 320, type: 'image/jpeg', quality: 0.7 }).dataUrl; } catch { return null; } },
  };

  // ---- menu and backlog ----
  async function menuData(page) {
    let slots = [];
    try { slots = await store.list(); } catch (e) { console.warn('story slots', e); }
    return { slots, memories: runner.g?.memories ?? {}, settings: engine.params.list().filter((p) => SETTING.test(p.id)), page };
  }
  async function openMenu(page) { menuOpen = true; pend?.arm?.(); const d = await menuData(page); if (menuOpen) all('menu', d); }
  async function refreshMenu() { if (!menuOpen) return; const d = await menuData(); if (menuOpen) all('menu', d); } // no page: the tab stays
  const closeMenu = () => { menuOpen = false; pend?.arm?.(); all('menu', null); };
  const need = () => { if (!runner.story) throw new Error(broken || 'no story loaded'); };
  async function onMenu(action, arg) {
    try {
      if (action === 'close') closeMenu();
      else if (action === 'set') await engine.params.set(arg.id, arg.value);
      else if (action === 'save') { need(); await runner.save(arg); await refreshMenu(); }
      else if (action === 'remove') { await store.remove(arg); await refreshMenu(); }
      else {
        closeMenu(); need();
        if (action === 'load') await runner.loadSlot(arg);
        else if (action === 'replay') runner.replay(arg);
        else if (action === 'new') runner.newGame();
      }
    } catch (e) { console.error('story menu', e); runner.error(`menu ${action}: ${e?.message ?? e}`); }
  }
  for (const v of views) Object.assign(v, {
    onAdvance: () => stage.advance(),
    onPick: (i) => stage.pick(i),
    onAnswer: (text) => { if (pend?.kind === 'ask') pend.done(text); },
    onToggle(what, page) {
      if (what === 'auto') engine.params.set('story.auto', P.auto ? 0 : 1);
      else if (what === 'skip') setSkip(!st.skip);
      else if (what === 'log') { logOpen = !logOpen; pend?.arm?.(); all('backlog', logOpen ? runner.backlog : null); } // a view that closed itself still says so
      else if (what === 'menu') openMenu(page);
    },
    onMenu,
  });

  // ---- the Runner: lib.ink's externals live, then load + boot ----
  const externals = {
    hour: () => new Date().getHours(), minute: () => new Date().getMinutes(), weekday: () => new Date().getDay(),
    date: () => { const d = new Date(); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },
    period: () => periodOf(new Date().getHours()),
    map: () => engine.map ?? '', vr: () => !!engine.xr, near: () => !!life()?.near,
    away: () => { const s = life()?.awaySec; return s == null ? -1 : Math.round(s / 360) / 10; }, // hours, 0.1
    visits: () => life()?.memory?.visits ?? 1,
    has_motion: (n) => director.hasMotion(String(n)),
    // memory(id): the Runner's own (its global record)
  };
  runner = new Runner({ stage, store, externals });
  const $ = (s) => document.querySelector(s);
  const drawer = () => { const el = $('#storyStatus'); if (el) el.textContent = broken || `${MODE[runner.mode] ?? runner.mode}${runner.knot ? ` · ${runner.knot}` : ''}${runner.fresh ? ' · 시작 전' : ''}`; };
  // The chat bar steps aside (and she stops talking) once a scene shows something: its first line, choices or
  // question, not between lines (her voice is the scene's then), and not for a scene with nothing to show (on_chat
  // only adds to a variable: hiding the bar for it would steal the focus from someone typing).
  const engage = () => { if (!wasScene) { wasScene = true; chat.setEnabled(false); chat.stop(); } };
  runner.on((ev) => {
    if (ev.type === 'line') { engage(); return drawer(); }
    if (ev.type !== 'mode') return;
    if (ev.mode === 'idle') { wasScene = false; chat.setEnabled(true); } else if (ev.mode === 'choice' || ev.mode === 'input') engage();
    idleT = 0; status(); drawer();
  });

  async function install(src) {
    const r = await runner.load(src);
    for (const e of r.errors) console.error(`story: ${e.file}:${e.line} ${e.message}`);
    if (r.errors.length) broken = runner.story ? '' : `스토리 컴파일 실패: ${r.errors[0].file}:${r.errors[0].line} ${r.errors[0].message}`;
    else { files = src; broken = ''; }
    if (runner.story && !booted) {
      await runner.boot();
      applying = true; // the settings saved last time
      for (const [id, v] of Object.entries(runner.g?.settings ?? {})) if (engine.params.has(id)) await engine.params.set(id, v).catch((e) => console.warn('story setting', id, e));
      applying = false;
      booted = true; period = periodOf(new Date().getHours());
      if (early) fire(...early); // she greeted before the story was ready
    }
    drawer();
    return r;
  }
  fetchSources().then(install).catch((e) => { console.error('story', e); broken = `스토리 없음: ${e?.message ?? e}`; drawer(); });

  // ---- events -> triggers ----
  function fire(event, value = 0) {
    if (event !== 'idle') idleT = 0;
    if (!booted) { if (event === 'start' || event === 'return') early = [event, value]; return false; }
    return runner.fire(event, value);
  }
  engine.on('map', (id) => { if (id && fire(`map.${id}`)) { const l = life(); if (l) l.pending = null; } }); // the scene says it instead of her stock line
  engine.renderer.xr.addEventListener('sessionstart', () => fire('vr.enter'));
  engine.renderer.xr.addEventListener('sessionend', () => fire('vr.exit'));
  setInterval(() => { const p = periodOf(new Date().getHours()); if (period && p !== period) fire(`time.${p}`); if (booted) period = p; }, 30000);

  const gestures = new HeadGestures(), euler = new THREE.Euler(), eye = new THREE.Vector3(), fwd = new THREE.Vector3(), head = new THREE.Vector3();
  engine.on('beforeFrame', (dt) => {
    audio.tick(dt, { ducked: chat.speaking() }); fx.tick(dt);
    const h = getCharacter()?.bones?.['頭']?.getWorldPosition(head) ?? null;
    xr.update(dt, { camera: engine.camera, herHead: h, controllers: controllers(), tips: tips() });
    if (!booted) return;
    if (runner.busy || chat.speaking()) idleT = 0;
    else if ((idleT += dt) >= P.idle) { const s = Math.round(idleT); idleT = 0; fire('idle', s); }
    if (!engine.xr) { gazeT = 0; return; }
    // the headset's pose in the rig (the camera's local transform in VR) -> nods and shakes
    const cam = engine.camera;
    euler.setFromQuaternion(cam.quaternion, 'YXZ');
    const g = gestures.update(dt, euler.y, euler.x);
    if (g) fire(`head.${g}`);
    // eye contact: looking at her face, close enough, long enough; a gaze nothing took may come again
    gazeCool -= dt;
    if (h) {
      cam.getWorldPosition(eye); cam.getWorldDirection(fwd);
      const to = head.sub(eye), k = engine.rig.scale.x || 1;
      // not while you two talk (listening, thinking, speaking): you look at her then, and a scene would drop her answer
      const talking = !runner.busy && (chat.speaking() || (getCharacter()?.behavior.state ?? 'idle') !== 'idle');
      gazeT = !talking && to.length() / k < 3 && fwd.angleTo(to) < 8 * DEG ? gazeT + dt : 0;
      if (gazeT >= P.gaze && gazeCool <= 0) { if (fire('gaze', Math.round(gazeT))) gazeCool = 45; gazeT = 0; }
    } else gazeT = 0;
  });

  // ---- the drawer's 스토리 section and the bar's 📖 ----
  $('#storyBtn')?.addEventListener('click', () => openMenu());
  $('#storyMenuBtn')?.addEventListener('click', () => openMenu());
  $('#storyNewBtn')?.addEventListener('click', () => { if (runner.story && confirm('처음부터 다시 시작할까요? (저장 슬롯은 그대로 남아요)')) runner.newGame(); });
  $('#storyDevBtn')?.addEventListener('click', () => open('tools/dev.html', '_blank'));

  // ---- engine commands (tools/dev.html, cli.py). The bridge runs one job at a time: never wait on a scene or speech ----
  const later = (p) => { Promise.resolve(p).catch((e) => console.error('story', e)); };
  const settings = () => Object.fromEntries(engine.params.list().filter((p) => SETTING.test(p.id)).map((p) => [p.id, p.get()]));
  const SCHEMA = { commands: pluck(COMMANDS, ['args', 'doc', 'block']), events: EVENTS, externals: pluck(EXTERNALS, ['args', 'doc']) };
  const cmd = (name, doc, args, run) => engine.command(name, doc, args, run);
  cmd('story.state', 'The story now: mode, knot, line, choices, vars, triggers (last fired, ready), knots (visits), backlog, errors, memories; plus the director catalog, the story.* settings and the tag/event/external schema.', {},
    () => ({ ...runner.snapshot(), catalog: director.catalog(), settings: settings(), schema: SCHEMA }));
  cmd('story.log', 'Story events after seq `since` (mode line choices chose direction var trigger event error save load reload memory).', { since: 'seq (default 0)' }, ({ since = 0 } = {}) => runner.log(since));
  cmd('story.play', 'Play from a knot (stops the scene on now). No path: go on from where the story stands.', { path: "knot | knot.stitch | '0' (the root flow from the top)" },
    ({ path } = {}) => { need(); later(runner.play(path || undefined)); return { mode: runner.mode }; });
  cmd('story.stop', 'End the scene now.', {}, () => { runner.stop(); return { mode: runner.mode }; });
  cmd('story.new', 'New game: reset the ink state, fired triggers and backlog, play the start.', {}, () => { need(); later(runner.newGame()); return { mode: runner.mode }; });
  cmd('story.advance', 'Move on from the line on screen.', {}, () => { runner.advance(); return { mode: runner.mode }; });
  cmd('story.choose', 'Pick a choice (while mode is choice).', { index: 'choice index' }, ({ index }) => ({ ok: runner.choose(+index) }));
  cmd('story.fire', 'A game event, as if it happened (see schema.events).', { event: 'e.g. touch.headpat', value: 'event_value (optional)' }, ({ event, value = 0 }) => ({ handled: fire(String(event), value) }));
  cmd('story.set', 'Set an ink global.', { name: 'VAR name', value: 'new value' }, ({ name, value }) => ({ ok: runner.set(name, value) }));
  cmd('story.run', "Carry out one direction tag now ('expr:shy hold', 'fade:out 0.5', 'clear').", { tag: 'tag without #' }, ({ tag }) => {
    const t = parseTag(tag);
    if (t.name === 'clear') all('hide'); else later(director.run(t, runner.line));
    return { known: !!COMMANDS[t.name] };
  });
  cmd('story.say', 'She says this now (the story voice; cached like baked lines).', { text: 'Japanese', voice: "'miku' | 'teto' (optional)", style: "'whisper' | '' (optional)" },
    ({ text, voice, style }) => { later(chat.say(String(text ?? ''), { voice, style, cache: true })); return { ok: true }; });
  cmd('story.reload', 'Recompile and hot-swap the story (state kept). files absent: fetched again from story/.', { files: '{name: source} (optional)' },
    async ({ files: f } = {}) => { const { errors, warnings } = await install(f ?? await fetchSources()); return { errors, warnings }; });
  cmd('story.save', 'Save to a slot (with a screenshot).', { slot: "slot name (default 'auto')" }, async ({ slot = 'auto' } = {}) => { need(); const ok = await runner.save(slot); await refreshMenu(); return { ok }; });
  cmd('story.load', 'Load a slot (one saved mid-scene goes back into the scene).', { slot: 'slot name' }, async ({ slot }) => { need(); return { ok: await runner.loadSlot(slot) }; });
  cmd('story.slots', 'Saved slots.', {}, async () => ({ slots: await store.list() }));
  cmd('story.remove', 'Delete a slot.', { slot: 'slot name' }, async ({ slot }) => { await store.remove(slot); await refreshMenu(); return { ok: true }; });
  cmd('story.replay', 'Replay a memory (its knot to the end; the state comes back after).', { id: 'memory id' }, ({ id }) => { need(); const ok = !!runner.g?.memories?.[id]; if (ok) later(runner.replay(id)); return { ok }; });
  cmd('story.lint', "Lint the loaded story with the game's catalog (expressions, motions, maps, params, commands).", {}, () => (files ? lint(files, { story: runner.story, catalog: director.catalog() }) : []));
  cmd('story.answer', 'Answer the #input question on screen (mode input).', { text: 'the answer' }, ({ text }) => { const ok = pend?.kind === 'ask' && !!String(text ?? '').trim(); if (ok) pend.done(text); return { ok }; });

  return {
    runner, director, fire,
    get busy() { return runner.busy; },
    get followOverride() { return director.follow; },
    xrSelect: (i) => xr.select(i), xrSelectEnd: (i) => xr.selectEnd(i),
    /** the autosave as the page goes: no screenshot (keepalive bodies are capped), and not before the game has begun */
    save: () => (booted && !runner.fresh ? runner.save('auto', { thumb: null }).catch((e) => console.warn('story save', e)) : null),
  };
}
