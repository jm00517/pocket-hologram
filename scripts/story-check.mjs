// story-check: the story from the shell. Compiles story/*.ink, prints the lint, fuzzes it (coverage, runtime errors),
// then runs the Runner and HeadGestures self-checks against a fake stage and store. Exit 1 on any error.
//   node scripts/story-check.mjs [story/main.ink]
// The story modules import the bare name 'inkjs' (an importmap in the browser); a module hook points it at
// .tools/inkjs-2.3.2.mjs, fetched from the CDN on the first run. Node 24, no node_modules, no test framework.
import { registerHooks } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INK = path.join(ROOT, '.tools', 'inkjs-2.3.2.mjs');
if (!fs.existsSync(INK)) {
  const url = /INK_URL = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'src/story/Script.js'), 'utf8'))[1];
  console.log(`fetching ${url}`);
  const r = await fetch(url);
  if (!r.ok) { console.error(`inkjs: HTTP ${r.status}`); process.exit(1); }
  fs.mkdirSync(path.dirname(INK), { recursive: true });
  fs.writeFileSync(INK, await r.text());
}
// 'three' is an empty module here: XRView's pure helpers (its selfCheck) never touch it at load
registerHooks({ resolve: (spec, ctx, next) => (spec === 'inkjs' ? { url: pathToFileURL(INK).href, shortCircuit: true }
  : spec === 'three' ? { url: 'data:text/javascript,export{}', shortCircuit: true } : next(spec, ctx)) });
const S = await import('../src/story/Script.js');
const { Runner } = await import('../src/story/Runner.js');
const { HeadGestures } = await import('../src/story/Gestures.js');
const DomView = await import('../src/story/DomView.js'), XRView = await import('../src/story/XRView.js');

const entryPath = path.resolve(ROOT, process.argv[2] ?? 'story/main.ink');
const dir = path.dirname(entryPath) + path.sep, entry = path.basename(entryPath);
const files = await S.fetchSources(dir, entry, (p) => fs.promises.readFile(p, 'utf8'));
let failed = 0;
const show = (i) => console.log(`  ${i.severity.padEnd(7)} ${i.file}:${i.line} [${i.code ?? ''}] ${i.message}`);

// ---- the story ----
console.log(`story: ${path.relative(ROOT, entryPath)} (${Object.keys(files).join(', ')})`);
const built = S.compile(files, entry);
const issues = S.lint(files, { story: built.story ?? undefined });
console.log(`lint: ${issues.filter((i) => i.severity === 'error').length} errors, ${issues.filter((i) => i.severity === 'warning').length} warnings, ${issues.filter((i) => i.severity === 'info').length} info`);
issues.forEach(show);
failed += issues.filter((i) => i.severity === 'error').length;
if (built.story) {
  const t0 = Date.now(), f = S.fuzz(built.json, { runs: 200 });
  console.log(`fuzz: ${f.runs} runs in ${Date.now() - t0} ms, coverage ${Math.round(f.coverage * 100)}% (${f.knots.length - f.unvisited.length}/${f.knots.length} knots), ` +
    `${f.lines.length} lines, ${f.choices} choices, ${f.capped} runs at the step cap, ${f.errors.length} errors`);
  if (f.unvisited.length) console.log(`  unvisited: ${f.unvisited.join(', ')}`);
  for (const e of f.errors) console.log(`  error   ${e.knot || '(root)'}: ${e.message} (run ${e.run}, x${e.count})`);
  failed += f.errors.length;
  console.log(`triggers: ${S.triggersOf(built.story).map((t) => `${t.knot}<-${t.on.join('|')}`).join(' ')}`);
}

// ---- self-checks ----
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const until = async (cond, what) => { for (let i = 0; i < 200; i++) { if (cond()) return; await tick(); } throw new Error(`timed out waiting for ${what}`); };

function fakeStage() {
  const st = {
    lines: [], dirs: [], asked: [], picks: [], clears: 0, answer: 'ゆう', hold: false, chooser: null, choosing: null,
    line(l) { st.lines.push(l); return st.hold ? new Promise(() => {}) : Promise.resolve(); },
    choose(cs, o) { st.choosing = { cs, o }; return st.chooser ? Promise.resolve(st.chooser(cs, o)) : new Promise(() => {}); },
    direction(t) { st.dirs.push(t.raw); },
    ask(prompt, name) { st.asked.push([prompt, name]); return Promise.resolve(st.answer); },
    clear() { st.clears++; }, pick(i) { st.picks.push(i); }, thumb: () => 'data:thumb',
  };
  return st;
}
function fakeStore() {
  const m = new Map();
  const store = { m,
    load: async (s) => structuredClone(m.get(s) ?? null), save: async (s, o) => { m.set(s, structuredClone(o)); }, remove: async (s) => { m.delete(s); },
    global: async () => { if (!m.has('global')) m.set('global', { read: [], memories: {}, settings: {} }); return m.get('global'); },
    setGlobal: async (o) => { m.set('global', o); } };
  return store;
}
const LIB = fs.readFileSync(path.join(ROOT, 'story/lib.ink'), 'utf8');
const SRC = `INCLUDE lib.ink
# speaker: テト = teto
VAR affection = 0
VAR pname = ""
VAR hits = 0
ミク: はじめまして #ko:처음 #expr:happy #wait:0
#input:pname 이름?
ミク: よろしく{pname}
* [はい #nod]
    ~ affection += 1
* [いいえ #shake]
- ミク: おわり #fx:heart #memory:m1 첫 만남
-> DONE

=== pat ===
# on: touch.headpat
# cooldown: 10
~ hits += 1
ミク: えへへ
-> DONE

=== pat_love ===
# on: touch.headpat
# priority: 5
# when: loves
ミク: だいすき
-> DONE

=== hello ===
# on: touch.hand
# once
テト: よろしく
-> DONE

=== mapper ===
# on: map.*
~ hits = event_value
{event}
-> DONE

=== chooser ===
# on: gaze
* [あ]
* そう #on:touch.hand #timer:3
* [う #default]
- おしまい
-> DONE

=== broken ===
# on: vr.enter
~ temp d = -> chooser
~ d = 5
-> d

=== function loves() ===
~ return affection >= 5

=== function persona() ===
ユーザーは{pname}。好感度{affection}。
`;
const mk = async (src = SRC, o = {}) => {
  let t = 1000;
  const stage = fakeStage(), store = fakeStore(), r = new Runner({ stage, store, now: () => t, random: () => 0.5, ...o });
  const res = await r.load({ 'main.ink': src, 'lib.ink': LIB });
  assert.deepEqual(res.errors, []);
  await r.boot();
  return { r, stage, store, clock: (s) => { t += s * 1000; } };
};
const idle = (r) => until(() => r.mode === 'idle', 'idle');

check('parseTag / parseLine', () => {
  assert.deepEqual(S.parseTag('#expr:shy hold len=3'), { name: 'expr', value: 'shy hold len=3', args: ['shy', 'hold', 'len=3'], kv: { len: '3' }, raw: 'expr:shy hold len=3' });
  assert.equal(S.parseTag('nod').name, 'nod');
  assert.equal(S.parseTag('ko:안녕, 반가워!').value, '안녕, 반가워!');
  const sp = S.speakersOf(['speaker: テト = teto, 先生 = none', 'player: 僕']);
  const l = S.parseLine('テト: こんにちは\n', ['ko:안녕', 'expr:smile', 'fx:heart', 'yomi:こんにちわ', 'on: near', 'nod', 'timer:5'], { speakers: sp, knot: 'k' });
  assert.equal(l.speaker, 'テト'); assert.equal(l.voice, 'teto'); assert.equal(l.who, 'her'); assert.equal(l.text, 'こんにちは'); assert.equal(l.say, 'こんにちわ');
  assert.deepEqual(l.subs, { ko: '안녕' }); assert.equal(l.timer, 5); assert.deepEqual(l.directions.map((t) => t.name), ['expr', 'fx']);
  assert.equal(l.id, S.fnv1a('k|こんにちは'));
  assert.equal(S.parseLine('先生: はい', [], { speakers: sp }).voice, null);
  assert.equal(S.parseLine('僕: うん', [], { speakers: sp }).who, 'player');
  assert.equal(S.parseLine('시각: 3시', [], { speakers: sp }).who, 'narration');
  assert.equal(S.parseLine('ミク: ね #', ['voice:off'], { speakers: sp }).voice, null);
  assert.deepEqual(S.cmdArgs(S.parseTag('cmd:camera mode=rig fov=40')), { name: 'camera', args: { mode: 'rig', fov: 40 } });
  assert.deepEqual(S.cmdArgs(S.parseTag('cmd:crossing.moveTo {"x":2}')), { name: 'crossing.moveTo', args: { x: 2 } });
  assert.ok(S.matches('map.*', 'map.pool') && !S.matches('map.*', 'mapx') && S.matches('*', 'near') && !S.matches('near', 'nearby'));
  assert.ok(S.isKnownEvent('map.pool') && S.isKnownEvent('touch.*') && S.isKnownEvent('time.night') && !S.isKnownEvent('time.noon') && !S.isKnownEvent('tuch.headpat'));
});

check('compile: globalTags past INCLUDE, functions out of knots, triggers', () => {
  const b = S.compile({ 'main.ink': SRC, 'lib.ink': LIB });
  assert.deepEqual(b.story.globalTags, ['speaker: テト = teto']);
  assert.deepEqual(S.knotsOf(b.story), ['pat', 'pat_love', 'hello', 'mapper', 'chooser', 'broken']);
  assert.deepEqual(S.knotsOf(S.storyOf(b.json)), S.knotsOf(b.story));
  const t = S.triggersOf(b.story);
  assert.deepEqual(t.find((x) => x.knot === 'pat_love'), { knot: 'pat_love', on: ['touch.headpat'], once: false, cooldown: 0, chance: 1, priority: 5, when: 'loves', order: 1 });
  const bad = S.compile({ 'main.ink': 'hi\n-> nowhere\n' }), lost = S.compile({ 'main.ink': 'INCLUDE nope.ink\nhi\n' });
  assert.equal(bad.story, null);
  assert.deepEqual(bad.errors.map((e) => [e.file, e.line, e.severity]), [['main.ink', 2, 'error']]); assert.match(bad.errors[0].message, /nowhere/);
  assert.match(lost.errors[0].message, /nope\.ink/);
});

check('lint catches what it promises', () => {
  const src = 'INCLUDE lib.ink\nVAR x = 0\n-> a\n=== a ===\n# on: tuch.pat\nミク: ok #ko:k #expr:grin\n#input:nope 질문\n#wiggle\n#cmd:camera {"mode":"rig"}\n* [y] #nod\n- ミク: Hello #ko:h\nミク: はい\n선생: 네\n-> DONE\n=== lost ===\n-> DONE\n';
  const codes = S.lint({ 'main.ink': src, 'lib.ink': LIB }).map((i) => `${i.code}:${i.line}:${i.severity}`);
  for (const want of ['event:5:warning', 'args:6:warning', 'input:7:error', 'tag:8:warning', 'args:9:warning', 'choice-tag:10:warning', 'sing:11:warning', 'sub:12:info', 'speaker:13:info', 'unused:15:warning'])
    assert.ok(codes.includes(want), `missing ${want} in ${codes.join(' ')}`);
  assert.ok(!codes.some((c) => c.startsWith('unused:4')), 'a is diverted to');
});

check('fuzz: coverage, errors, never throws', () => {
  const b = S.compile({ 'main.ink': SRC, 'lib.ink': LIB }), f = S.fuzz(b.json, { runs: 60 });
  assert.ok(f.errors.some((e) => e.knot === 'broken'), 'the broken knot is caught');
  assert.deepEqual(f.unvisited.filter((k) => k !== 'pat_love'), []);
  assert.ok(f.lines.some((l) => l.voice === 'teto'));
  assert.equal(S.fuzz('{nope', { runs: 1 }).errors.length, 1);
});

check('play: lines, directions, input, choice by nod, memory, autosave', async () => {
  const { r, stage, store } = await mk();
  assert.equal(r.fresh, true);
  assert.equal(r.fire('touch.headpat'), false, 'nothing plays before the game has begun');
  assert.equal(r.fire('start'), true);
  await until(() => r.mode === 'choice', 'choice');
  assert.equal(stage.lines[0].text, 'はじめまして'); assert.equal(stage.lines[0].voice, 'miku'); assert.equal(stage.lines[0].subs.ko, '처음');
  assert.deepEqual(stage.dirs.slice(0, 2), ['expr:happy', 'wait:0']);
  assert.deepEqual(stage.asked, [['이름?', 'pname']]); assert.equal(r.get('pname'), 'ゆう');
  assert.equal(stage.lines[1].text, 'よろしくゆう', 'a tag-only #input line: the line after it has the answer');
  assert.equal(stage.choosing.o.def, 1); assert.equal(stage.choosing.o.timer, null);
  assert.equal(r.fire('touch.poke'), false, 'no choice is tagged for it');
  assert.equal(r.fire('head.nod'), true);
  await idle(r);
  assert.deepEqual(stage.picks, [0]); assert.equal(r.get('affection'), 1);
  assert.equal(stage.lines.at(-1).text, 'おわり');
  const g = await store.global();
  assert.equal(g.memories.m1.title, '첫 만남'); assert.equal(g.memories.m1.thumb, 'data:thumb'); assert.equal(g.read.length, 3);
  assert.ok(store.m.get('auto')?.ink, 'autosaved'); assert.equal(r.fresh, false);
  const ev = r.log().events.map((e) => e.type);
  for (const t of ['mode', 'line', 'direction', 'choices', 'chose', 'memory', 'save', 'event', 'var']) assert.ok(ev.includes(t), `event ${t}`);
});

check('triggers: priority, when, cooldown, once, chance, event vars', async () => {
  const { r, stage, clock } = await mk();
  r.fire('start'); await until(() => r.mode === 'choice', 'choice'); r.choose(1); await idle(r);
  assert.equal(r.fire('touch.headpat'), true); await idle(r);
  assert.equal(r.get('hits'), 1); assert.equal(stage.lines.at(-1).text, 'えへへ');
  assert.equal(r.fire('touch.headpat'), false, 'cooldown');
  clock(11); assert.equal(r.fire('touch.headpat'), true); await idle(r); assert.equal(r.get('hits'), 2);
  r.set('affection', 5); assert.equal(r.fire('touch.headpat'), true); await idle(r);
  assert.equal(stage.lines.at(-1).text, 'だいすき', 'higher priority, when true');
  assert.equal(r.fire('touch.hand'), true); await idle(r);
  assert.equal(stage.lines.at(-1).voice, 'teto');
  assert.equal(r.fire('touch.hand'), false, 'once');
  assert.equal(r.fire('map.pool', 7), true); await idle(r);
  assert.equal(r.get('event'), 'map.pool'); assert.equal(r.get('hits'), 7); assert.equal(stage.lines.at(-1).text, 'map.pool');
  const { r: r2 } = await mk(SRC.replace('# cooldown: 10', '# chance: 0.4'), { random: () => 0.9 });
  r2.fire('start'); await until(() => r2.mode === 'choice', 'choice'); r2.choose(0); await idle(r2);
  assert.equal(r2.fire('touch.headpat'), false, 'chance roll failed');
  assert.ok(!r.busy && r.snapshot().triggers.find((t) => t.knot === 'hello').ready === false);
});

check('choices: #on: picks, timer/default, player echo, api choose', async () => {
  const { r, stage } = await mk();
  r.fire('start'); await until(() => r.mode === 'choice', 'choice'); r.choose(0); await idle(r);
  assert.equal(r.fire('gaze'), true); await until(() => r.mode === 'choice', 'choice');
  assert.deepEqual(stage.choosing.o, { timer: 3, def: 2 });
  assert.equal(r.fire('touch.headpat'), false, 'a trigger never cuts into a scene');
  assert.equal(r.fire('touch.hand'), true); await idle(r);
  const l = stage.lines.slice(-2);
  assert.equal(l[0].text, 'そう'); assert.equal(l[0].who, 'player'); assert.equal(l[0].speaker, '나'); assert.equal(l[1].text, 'おしまい');
  assert.equal(r.log().events.filter((e) => e.type === 'chose').at(-1).by, 'touch.hand');
  stage.chooser = (cs, o) => o.def;
  r.fire('gaze'); await idle(r); // 'そう' was a * choice, used up: [あ, う], and う is the #default
  assert.equal(r.log().events.filter((e) => e.type === 'chose').at(-1).text, 'う');
});

check('save / load round trip, mid-scene save resumes the line', async () => {
  const { r, stage, store } = await mk();
  r.fire('start'); await until(() => r.mode === 'choice', 'choice'); r.choose(0); await idle(r);
  r.fire('touch.headpat'); await idle(r);
  await r.save('s1', { map: 'pool' });
  assert.equal(store.m.get('s1').map, 'pool'); assert.equal(store.m.get('s1').scene, null);
  r.set('affection', 99); r.fired = {};
  assert.equal(await r.loadSlot('s1'), true);
  assert.equal(r.get('affection'), 1); assert.ok(r.fired.pat); assert.equal(r.mode, 'idle');
  r.fire('gaze'); await until(() => r.mode === 'choice', 'choice');
  await r.save('mid'); r.stop(); assert.equal(r.mode, 'idle');
  assert.equal(store.m.get('mid').scene, 'chooser');
  stage.choosing = null; stage.chooser = () => 0;
  await r.loadSlot('mid');
  assert.notEqual(r.mode, 'idle', 'back in the scene');
  await idle(r);
  assert.ok(stage.choosing, 'the choices came again'); assert.equal(stage.lines.at(-1).text, 'おしまい');
  // the page left mid-scene (the pagehide autosave): the next visit's boot goes back into it on 'start'/'return'
  const next = new Runner({ stage: fakeStage(), store, now: () => 1000, random: () => 0.5 });
  store.m.set('auto', store.m.get('mid'));
  await next.load({ 'main.ink': SRC, 'lib.ink': LIB }); await next.boot();
  assert.equal(next.fire('touch.headpat'), false, 'nothing else plays before it goes on');
  next.stage.chooser = () => 0;
  assert.equal(next.fire('return'), true); assert.equal(next.knot, 'chooser');
  await idle(next);
  assert.ok(next.stage.choosing, 'back at the saved choices'); assert.equal(next.resume, false);
});

check('hot reload keeps variables; a broken edit keeps the old story', async () => {
  const { r, stage } = await mk();
  r.fire('start'); await until(() => r.mode === 'choice', 'choice'); r.choose(0); await idle(r);
  r.set('affection', 42);
  const res = await r.load({ 'main.ink': SRC.replace('VAR hits = 0', 'VAR hits = 0\nVAR fresh_var = 3').replace('=== pat ===', '=== new_knot ===\nnew\n-> DONE\n=== pat ==='), 'lib.ink': LIB });
  assert.deepEqual(res.errors, []);
  assert.equal(r.get('affection'), 42); assert.equal(r.get('fresh_var'), 3); assert.equal(r.get('pname'), 'ゆう');
  assert.ok(r.knots.includes('new_knot'));
  const bad = await r.load({ 'main.ink': SRC + '\n-> nowhere\n', 'lib.ink': LIB });
  assert.ok(bad.errors.length); assert.ok(r.knots.includes('new_knot'), 'old story kept'); assert.equal(r.get('affection'), 42);
  // the knot the story last stood in is edited away: variables and visit counts still come over
  r.fire('touch.hand'); await idle(r); r.fire('touch.headpat'); await idle(r);
  assert.equal(stage.lines.at(-1).text, 'だいすき'); // affection 42: pat_love
  const gone = SRC.replace(/=== pat_love ===[\s\S]*?-> DONE\n/, '');
  assert.deepEqual((await r.load({ 'main.ink': gone, 'lib.ink': LIB })).errors, []);
  assert.ok(!r.knots.includes('pat_love')); assert.equal(r.get('affection'), 42);
  assert.equal(r.snapshot().knots.find((k) => k.name === 'hello').visits, 1, 'visit counts kept');
  assert.equal(r.fire('touch.hand'), false, 'and which triggers fired');
});

check('persona, replay, runtime error, stop', async () => {
  const { r, stage, store } = await mk();
  r.fire('start'); await until(() => r.mode === 'choice', 'choice'); r.choose(0); await idle(r);
  assert.equal(r.persona(), 'ユーザーはゆう。好感度1。');
  r.set('affection', 3); stage.chooser = () => 0;
  const n = stage.lines.length, saves = () => r.log().events.filter((e) => e.type === 'save').length, saved = saves();
  assert.equal(await r.replay('m1'), true); // m1 was unlocked in the root flow: the replay plays it from the top
  assert.equal(r.mode, 'idle');
  assert.equal(stage.lines[n].text, 'はじめまして', 'the memory played'); assert.equal(r.get('affection'), 3, 'state put back');
  assert.equal(saves(), saved, 'no save');
  assert.equal(await r.replay('nope'), false);
  const errs = r.errors.length; r.fire('vr.enter'); await idle(r);
  assert.equal(r.errors.length, errs + 1); assert.equal(r.mode, 'idle');
  stage.hold = true; r.fire('gaze'); await until(() => r.mode === 'choice', 'choice');
  const clears = stage.clears; r.stop(); assert.equal(r.mode, 'idle'); assert.equal(stage.clears, clears + 1);
  const snap = r.snapshot();
  assert.ok(snap.knots.find((k) => k.name === 'pat') && snap.speakers.voices.テト === 'teto' && JSON.stringify(snap));
});

check(`${entry} through the Runner: a new game, then every event three times, no errors`, async () => {
  if (!built.story) throw new Error('does not compile');
  let t = 0, seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647), stage = fakeStage();
  stage.chooser = (cs) => Math.floor(rand() * cs.length);
  const r = new Runner({ stage, store: fakeStore(), now: () => (t += 60e3), random: rand }); // a minute per tick: cooldowns pass
  assert.deepEqual((await r.load(files)).errors, []);
  await r.boot();
  assert.equal(r.fire('start'), true); await idle(r);
  for (let i = 0; i < 3; i++) for (const ev of S.EVENTS) { r.fire(ev.name.replace('<id>', 'pool'), { chat: 2, 'touch.poke': -1, return: 30 }[ev.name] ?? 5); await idle(r); }
  assert.deepEqual(r.errors.map((e) => e.message), []);
  assert.ok(stage.lines.length > 10 && stage.lines.every((l) => l.text));
  assert.notEqual(r.persona(), '');
});

check('head gestures: nod, shake, nothing from slow looks or jitter', () => {
  const at = (f, secs) => { const g = new HeadGestures(), out = []; for (let i = 0, t = 0; t < secs; t = ++i / 72) { const [y, p] = f(t); const r = g.update(1 / 72, y, p); if (r) out.push([r, t]); } return out; };
  const run = (f, secs = 1) => at(f, secs).map(([r]) => r);
  const D = Math.PI / 180, wave = (deg, hz) => (t) => deg * D * Math.sin(2 * Math.PI * hz * t);
  assert.deepEqual(run((t) => [0.02 * Math.sin(t), wave(10, 2)(t)]), ['nod']);
  assert.deepEqual(run((t) => [wave(15, 2)(t), 0.02 * Math.sin(t)]), ['shake']);
  assert.deepEqual(run((t) => [wave(30, 0.2)(t), wave(10, 0.15)(t)], 8), [], 'looking around');
  let seed = 3; const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * D;
  assert.deepEqual(run(() => [noise(), noise()], 6), [], 'tracking jitter');
  assert.deepEqual(run((t) => [wave(12, 2)(t), wave(12, 2)(t)]), [], 'a circle is neither');
  assert.deepEqual(run((t) => [0, t < 0.25 ? -10 * D * Math.sin(Math.PI * t / 0.25) : 0]), [], 'one dip is not a nod');
  const nods = at((t) => [0, wave(10, 2.5)(t)], 3).map(([, t]) => t);
  assert.ok(nods.length >= 2 && nods.every((t, i) => !i || t - nods[i - 1] >= 1), `cooldown between nods: ${nods}`);
  assert.deepEqual(run((t) => [Math.PI - 0.01 + wave(15, 2)(t), 0]), ['shake'], 'across ±180°');
  // reading cards line by line: a slow sweep across, a flick back to the next line's start, a card lower each time
  const read = (t) => { const L = 0.88, u = t % L; return [(u < 0.8 ? -5 + 10 * u / 0.8 : 5 - 10 * (u - 0.8) / 0.08) * D, -5 * Math.floor(t / L) * D]; };
  assert.deepEqual(run(read, 4), [], 'reading is not a shake');
});

check('matchChoice: a spoken answer picks the choice it means', () => {
  const cs = [{ text: '응, 같이 걷자' }, { text: '손을 내민다' }, { text: '오늘은 여기 있을래' }, { text: '잘 모르겠어' }];
  assert.equal(S.matchChoice('응 같이 걷자!', cs), 0, 'whole, spaces and punctuation aside');
  assert.equal(S.matchChoice('음... 잘 모르겠어요', cs), 3, 'said inside a longer answer');
  assert.equal(S.matchChoice('여기 있을래', cs), 2, 'a piece of it');
  assert.equal(S.matchChoice('오늘은 여기 이쓸래', cs), 2, 'misheard a little (bigram Dice)');
  assert.equal(S.matchChoice('바나나', cs), -1, 'nothing like any');
  assert.equal(S.matchChoice('', cs), -1, 'silence'); assert.equal(S.matchChoice('응', cs), -1, 'one character is too little to go on');
  assert.equal(S.matchChoice('YES', [{ text: 'no' }, { text: 'yes' }]), 1, 'case');
});
check('DomView pure helpers (keys, typing, setting kinds)', () => assert.equal(DomView.selfCheck(), true));
check('XRView pure helpers (line breaking, fitting, paging, settings steps)', () => assert.equal(XRView.selfCheck(), true));

for (const [name, fn] of checks) {
  try { await fn(); console.log(`  ok      ${name}`); } catch (e) { failed++; console.log(`  FAIL    ${name}: ${e.message}`); }
}
console.log(failed ? `story-check: ${failed} problem(s)` : 'story-check: ok');
process.exit(failed ? 1 : 0);
