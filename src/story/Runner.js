// Runner: plays the ink story against a Stage (the views and the director, wired up by src/story/index.js). It owns
// the ink Story, the scene loop (lines, directions in tag order, input, choices), the trigger table that turns game
// events into scenes while nothing is playing, saves (ink state + when each trigger last fired), read marks and the
// memories gallery, and a ring buffer of events the dev tools poll. No DOM, no three: scripts/story-check.mjs runs it
// in node with a fake stage and store.
import { compile, storyOf, parseLine, parseTag, speakersOf, knotsOf, triggersOf, matches, knotAt, COMMANDS } from './Script.js';

const BACKLOG = 200, READ_CAP = 20000, LOG = 500;
// pinned inkjs has no public list of globals: VariablesState keeps them in this Map
const varNames = (s) => [...(s.variablesState._globalVariables?.keys() ?? [])];
const declared = (s, n) => s.variablesState._globalVariables?.has(n) ?? false;
const plain = (v) => (v === null || v === undefined || ['number', 'string', 'boolean'].includes(typeof v) ? v ?? null : String(v)); // InkList, divert -> text
const msg = (e) => String(e?.message ?? e);

/** saved ink state -> story. 'exact', or 'merged' when the saved position is gone from an edited story (variables,
 *  visit and turn counts kept, position back at the root), or false (state reset). */
function restore(s, json) {
  try { s.state.LoadJson(json); return 'exact'; } catch { /* edited since */ }
  try {
    const o = JSON.parse(json), n = JSON.parse(s.state.toJson());
    for (const k of ['variablesState', 'visitCounts', 'turnIndices', 'turnIdx', 'storySeed', 'previousRandom']) if (k in o) n[k] = o[k];
    s.state.LoadJson(JSON.stringify(n)); // undeclared variables are dropped, new ones keep their defaults
    return 'merged';
  } catch { s.ResetState(); return false; }
}

export class Runner {
  constructor({ stage, store, externals = {}, now = () => Date.now(), random = Math.random }) {
    Object.assign(this, { stage, store, externals, now, random });
    this.story = null; this.mode = 'idle'; this.fresh = true; this.knot = null; this.line = null; this.choices = [];
    this.backlog = []; this.fired = {}; this.errors = []; this.triggers = []; this.knots = []; this.speakers = speakersOf();
    this.run = null; this.resume = false; this.g = null; this.gOk = false; this.read = new Set(); this.subs = new Set(); this.seq = 0; this.events = [];
  }

  get busy() { return this.mode !== 'idle'; }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  log(since = 0) { return { seq: this.seq, events: this.events.filter((e) => e.seq > since) }; }
  emit(type, o = {}) {
    const ev = { seq: ++this.seq, t: this.now(), type, ...o };
    this.events.push(ev);
    if (this.events.length > LOG) this.events.shift();
    for (const fn of this.subs) try { fn(ev); } catch (e) { console.warn('story listener', e); }
    return ev;
  }
  error(e, o = {}) {
    const message = msg(e);
    this.errors.push({ message, knot: this.knot, t: this.now(), ...o });
    if (this.errors.length > 20) this.errors.shift();
    this.emit('error', { message, ...o });
  }
  setMode(mode) { if (mode !== this.mode) { this.mode = mode; this.emit('mode', { mode }); } }

  // ---- story ----

  /** files {name: source} (compiled here) or { json }. A hot reload keeps the state; a failed compile keeps the old story. */
  async load(src) {
    let r;
    if (src?.json) {
      try { r = { story: storyOf(src.json), errors: [], warnings: [] }; } catch (e) { r = { story: null, errors: [{ file: '', line: 0, message: msg(e), severity: 'error', code: 'json' }], warnings: [] }; }
    } else r = compile(src);
    if (r.story) { this.stop(); this.install(r.story); }
    this.emit('reload', { errors: r.errors, warnings: r.warnings });
    return { errors: r.errors, warnings: r.warnings };
  }

  install(s) {
    const old = this.story;
    s.onError = (message, type) => { if (type === 1) this.emit('error', { message, warning: true }); else this.err ??= message; }; // ErrorType 1 = warning
    for (const [n, fn] of Object.entries({ memory: (id) => !!this.g?.memories?.[id], ...this.externals })) s.BindExternalFunction(n, fn, false);
    if (old && !restore(s, old.state.toJson())) for (const n of varNames(old)) if (declared(s, n)) try { s.variablesState[n] = old.variablesState[n]; } catch { /* type changed */ }
    this.story = s;
    for (const n of varNames(s)) s.ObserveVariable(n, (name, value) => this.emit('var', { name, value: plain(value) }));
    this.triggers = triggersOf(s); this.knots = knotsOf(s); this.speakers = speakersOf(s.globalTags);
  }

  /** after load: the global record (read marks, memories) and the 'auto' save, without starting a scene */
  async boot() {
    try { this.g = await this.store.global(); this.gOk = true; } catch (e) { this.g = { read: [], memories: {}, settings: {} }; this.error(`global: ${msg(e)}`); }
    this.g.read ??= []; this.g.memories ??= {};
    this.read = new Set(this.g.read);
    let save = null;
    try { save = await this.store.load('auto'); } catch (e) { this.error(`auto save: ${msg(e)}`); }
    this.fresh = !save;
    if (save) this.apply(save);
    return !this.fresh;
  }

  apply(save) {
    const how = save.ink ? restore(this.story, save.ink) : false;
    if (!how) this.error('세이브의 Ink 상태를 읽지 못했다: 처음 상태로');
    this.fired = { ...(save.fired ?? {}) }; this.backlog = [...(save.backlog ?? [])]; this.line = this.backlog.at(-1) ?? null;
    // saved mid-scene: the next play() with no path goes on from that line (loadSlot at once, boot on 'start'/'return')
    this.resume = how === 'exact' && save.scene != null;
    if (this.resume) this.knot = save.scene;
    return how;
  }

  // ---- scenes ----

  newGame() {
    this.stop();
    this.story.ResetState(); this.fired = {}; this.backlog = []; this.line = null; this.fresh = false;
    const t = this.ready('start');
    if (!t) return this.play();
    this.begin(t, 'start', 0);
    return this.play(t.knot);
  }

  /** run until the story has nothing more to say; path: a knot (or 'knot.stitch'), '0' = the root flow from the top */
  play(path, { replay = null } = {}) {
    this.stop(); this.resume = false;
    const run = this.run = { stopped: false, replay, mark: null, timer: null, chosen: null, pick: null };
    run.halt = new Promise((r) => (run.abort = r));
    return this.loop(run, path);
  }

  stop() {
    const run = this.run;
    if (!run) return;
    run.stopped = true; run.abort();
    this.finish(run);
  }

  /** the scene is over. autosave: taken before 'idle' goes out, since a listener may start the next scene at once */
  finish(run, autosave = false) {
    if (this.run !== run) return null;
    this.run = null; this.choices = [];
    if (run.replay) restore(this.story, run.replay);
    const saved = autosave && !run.replay ? this.save('auto').catch((e) => this.error(`auto save: ${msg(e)}`)) : null;
    try { this.stage.clear(); } catch (e) { this.error(e); }
    this.setMode('idle');
    return saved;
  }

  async loop(run, path) {
    const s = this.story, st = this.stage, wait = (p) => Promise.race([p, run.halt]);
    const scene = run.replay ? 'replay' : 'scene';
    this.err = null;
    this.setMode(scene);
    try {
      if (path) { s.ChoosePathString(path); this.knot = /^\d/.test(path) ? '' : path.split('.')[0]; }
      for (;;) {
        if (s.canContinue) {
          run.mark = s.state.toJson(); // a save mid-scene starts again from the line now coming
          const next = () => { const text = s.Continue(); this.check(); return parseLine(text, s.currentTags, { speakers: this.speakers, knot: knotAt(s) }); };
          let line = next();
          const answers = {};
          this.knot = line.knot;
          if (line.timer !== null) run.timer = line.timer;
          for (let k = 0; k < line.directions.length; k++) {
            const tag = line.directions[k];
            this.emit('direction', { tag });
            if (tag.name === 'memory') { if (!run.replay) await wait(this.memory(tag.args[0], tag.value.slice(tag.args[0]?.length ?? 0).trim(), await wait(this.thumb()))); }
            else if (tag.name === 'input') {
              const name = tag.args[0] ?? '';
              this.setMode(run.replay ? scene : 'input');
              const answer = await wait(st.ask(tag.value.slice(name.length).trim(), name));
              if (run.stopped) return;
              // ink worked this line out before the question was asked, and a tag-only '#input' line joins the line
              // after it, which usually says the answer: work it out again with the answer in (same tags, so k holds)
              answers[name] = String(answer ?? '');
              s.state.LoadJson(run.mark);
              for (const [n, v] of Object.entries(answers)) this.set(n, v);
              line = next();
              this.setMode(scene);
            } else {
              const p = this.direct(tag, line);
              if (COMMANDS[tag.name]?.block) await wait(p);
            }
            if (run.stopped) return;
          }
          if (run.chosen !== null && line.text) { // ink echoing the chosen text (a choice without [ ]): that's me talking
            if (line.text === run.chosen) Object.assign(line, { who: 'player', speaker: [...this.speakers.player][0] ?? null, voice: null });
            run.chosen = null;
          }
          if (!line.text) continue;
          this.line = line;
          this.emit('line', { line });
          if (!run.replay) { this.backlog.push(line); if (this.backlog.length > BACKLOG) this.backlog.shift(); }
          await wait(st.line(line, { read: this.read.has(line.id) }));
          if (run.stopped) return;
          if (!run.replay) this.markRead(line.id);
        } else if (s.currentChoices.length) {
          const i = await this.pick(run, wait, scene);
          if (run.stopped) return;
          s.ChooseChoiceIndex(i);
          this.check();
        } else break;
      }
    } catch (e) {
      if (run.stopped) return;
      this.error(e, { knot: this.knot });
    }
    if (this.run !== run) return;
    await this.finish(run, true);
  }

  check() { if (this.err) { const m = this.err; this.err = null; throw new Error(m); } }

  /** one direction on the stage; a failing one is reported, the scene goes on */
  direct(tag, line) {
    try { return Promise.resolve(this.stage.direction(tag, line)).catch((e) => this.error(e, { tag: tag.raw })); } catch (e) { this.error(e, { tag: tag.raw }); return null; }
  }

  async pick(run, wait, scene) {
    const choices = this.choices = this.story.currentChoices.map((c) => ({ index: c.index, text: c.text, tags: (c.tags ?? []).map(parseTag) }));
    const tagged = (n) => choices.findIndex((c) => c.tags.some((t) => t.name === n));
    const tt = choices.flatMap((c) => c.tags).find((t) => t.name === 'timer' && +t.value > 0);
    const timer = run.timer ?? (tt ? +tt.value : null), def = tagged('default') >= 0 ? tagged('default') : choices.length - 1;
    run.timer = null;
    this.emit('choices', { choices });
    this.setMode(run.replay ? scene : 'choice');
    const picked = new Promise((r) => (run.pick = r));
    const staged = Promise.resolve(this.stage.choose(choices, { timer, def })).then((index) => ({ index, by: 'stage' }));
    const { index, by } = (await wait(Promise.race([staged, picked]))) ?? {};
    if (run.stopped) return -1; // finish() cleared them; this.choices may already be the next scene's
    run.pick = null; this.choices = [];
    const i = choices[index] ? index : def;
    this.emit('chose', { index: i, text: choices[i].text, by });
    run.chosen = choices[i].text;
    this.setMode(scene);
    return i;
  }

  advance() { this.stage.advance?.(); }

  /** during 'choice': pick choice i (the views are told through stage.pick) */
  choose(i, by = 'api') {
    if (!this.run?.pick || !this.choices[i]) return false;
    this.run.pick({ index: i, by });
    this.stage.pick?.(i);
    return true;
  }

  // ---- triggers ----

  /** a game event. At choices: the choice tagged for it (#on:, #nod = head.nod, #shake = head.shake). Before the game
   *  has begun: 'start'/'return' begin it, nothing else plays. Idle: the best ready trigger becomes a scene. */
  fire(event, value = 0) {
    let handled = false;
    if (this.run?.pick) {
      const i = this.choices.findIndex((c) => c.tags.some((t) => (t.name === 'on' && t.value.split(/[,\s]+/).some((p) => p && matches(p, event)))
        || (t.name === 'nod' && event === 'head.nod') || (t.name === 'shake' && event === 'head.shake')));
      handled = i >= 0 && this.choose(i, event);
    } else if (this.story && (this.fresh || this.resume)) { // other events wait for the game to begin (or go on)
      if (event === 'start' || event === 'return') { if (this.fresh) this.newGame(); else this.play(); handled = true; }
    } else if (this.story && !this.busy) {
      const t = this.ready(event);
      if (t) { this.begin(t, event, value); this.play(t.knot); handled = true; }
    }
    this.emit('event', { event, value, handled });
    return handled;
  }

  begin(t, event, value) {
    const s = this.story;
    if (declared(s, 'event')) s.variablesState.event = String(event);
    if (declared(s, 'event_value')) s.variablesState.event_value = Number(value) || 0;
    this.fired[t.knot] = this.now();
    this.emit('trigger', { knot: t.knot, event, value });
  }

  /** the trigger that would play for this event now: priority, then source order; chance rolled per candidate */
  ready(event) {
    return [...this.triggers].sort((a, b) => b.priority - a.priority || a.order - b.order)
      .find((t) => t.on.some((p) => matches(p, event)) && this.isReady(t) && (t.chance >= 1 || this.random() < t.chance)) ?? null;
  }

  isReady(t, quiet = false) {
    const last = this.fired[t.knot];
    if (last !== undefined && (t.once || this.now() - last < t.cooldown * 1000)) return false;
    if (!t.when) return true;
    // a throw leaves inkjs' function frame and eval stack behind, which breaks a scene playing (dev tools poll this)
    const s = this.story, j = s.state.toJson(), err = this.err;
    try { return !!s.EvaluateFunction(t.when); } catch (e) { s.state.LoadJson(j); this.err = err; if (!quiet) this.error(`when: ${t.when}: ${msg(e)}`, { knot: t.knot }); return false; }
  }

  // ---- variables ----

  get(name) { return this.story && declared(this.story, name) ? plain(this.story.variablesState[name]) : undefined; }
  set(name, value) {
    if (!this.story || !declared(this.story, name)) return false;
    try { this.story.variablesState[name] = value; return true; } catch (e) { this.error(`${name}: ${msg(e)}`); return false; }
  }
  vars() { return this.story ? Object.fromEntries(varNames(this.story).map((n) => [n, plain(this.story.variablesState[n])])) : {}; }

  /** the story's persona() text, appended to her character for free chat */
  persona() {
    const s = this.story;
    if (!s || !(s.inkFunctions?.has('persona') ?? s.HasFunction('persona'))) return '';
    try { return String(s.EvaluateFunction('persona', [], true)?.output ?? '').trim(); } catch (e) { this.error(`persona: ${msg(e)}`); return ''; }
  }

  // ---- saves, read marks, memories ----

  async thumb() { try { return (await this.stage.thumb?.()) ?? null; } catch { return null; } }

  /** a mid-scene save holds the state from the start of the line on screen, so loading it plays that line again */
  async save(slot = 'auto', extra = {}) {
    if (!this.story || this.run?.replay) return false;
    const mid = this.run?.mark ?? null, l = this.line;
    const data = { v: 1, time: this.now(), label: (l ? `${l.speaker ? `${l.speaker}: ` : ''}${l.text}` : this.knot ?? '').slice(0, 40),
      ink: mid ?? this.story.state.toJson(), scene: mid ? this.knot ?? '' : null, fired: { ...this.fired }, backlog: this.backlog.slice(-30) };
    data.thumb = extra.thumb !== undefined ? extra.thumb : await this.thumb();
    await this.store.save(slot, { ...data, ...extra });
    this.emit('save', { slot });
    return true;
  }

  /** restore a slot; one saved mid-scene goes back into that scene (when the story still has its place) */
  async loadSlot(slot) {
    const save = await this.store.load(slot);
    if (!save) return false;
    this.stop();
    this.apply(save);
    this.fresh = false;
    this.emit('load', { slot });
    if (this.resume) this.play();
    return true;
  }

  markRead(id) {
    if (this.read.has(id)) return;
    this.read.add(id); this.g.read.push(id);
    if (this.g.read.length > READ_CAP) for (const old of this.g.read.splice(0, this.g.read.length - READ_CAP)) this.read.delete(old);
    this.persist();
  }
  persist() { if (this.gOk) return Promise.resolve(this.store.setGlobal(this.g)).catch((e) => this.error(`global: ${msg(e)}`)); }

  async memory(id, title, thumb = null) {
    if (!id || !this.g || this.g.memories[id]) return false;
    this.g.memories[id] = { title: title || id, knot: this.knot ?? '', time: this.now(), thumb };
    this.emit('memory', { id, title: title || id });
    await this.persist();
    return true;
  }

  /** play a memory's knot again; the state is put back afterwards (no saves, no read marks, no backlog) */
  async replay(id) {
    const m = this.g?.memories?.[id];
    if (!m || !this.story) return false;
    this.stop();
    await this.play(m.knot || '0', { replay: this.story.state.toJson() });
    return true;
  }

  // ---- dev tools ----

  snapshot() {
    const s = this.story, visits = (k) => { try { return s.state.VisitCountAtPathString(k); } catch { return 0; } };
    return {
      mode: this.mode, fresh: this.fresh, knot: this.knot, line: this.line, choices: this.choices, vars: this.vars(),
      triggers: this.triggers.map((t) => ({ ...t, last: this.fired[t.knot] ?? null, ready: !!s && this.isReady(t, true) })),
      knots: s ? this.knots.map((name) => ({ name, visits: visits(name) })) : [],
      speakers: { voices: Object.fromEntries(this.speakers.voices), player: [...this.speakers.player] },
      backlog: this.backlog.slice(-50), errors: this.errors.slice(-20), memories: this.g?.memories ?? {}, globalTags: s?.globalTags ?? [],
    };
  }
}
