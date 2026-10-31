// Story script: everything about the ink text that doesn't need the game. Compiling (inkjs at runtime, INCLUDEs
// fetched first), the tag vocabulary story/README.md documents (COMMANDS, EVENTS, EXTERNALS), cutting one line of
// output into speaker / voice / subtitles / directions, the trigger table from knot tags, a static lint and a
// random-playthrough fuzz. Pure: the game (Runner), the dev tools' editor and scripts/story-check.mjs (node) share it.
import { Compiler, CompilerOptions, Story } from './ink.js';

export const INK_URL = 'https://cdn.jsdelivr.net/npm/inkjs@2.3.2/dist/ink-full.mjs';
export const FX_KINDS = ['heart', 'sparkle', 'sweat', 'anger', 'question', 'exclaim', 'note', 'zzz'];
export const LOOKS = ['you', 'away', 'down', 'up', 'left', 'right', 'free'];
export const PERIODS = ['morning', 'day', 'evening', 'night'];
// what src/character has (Behavior.js EXPRESSIONS, REACTIONS, states); lint takes the running game's catalog over these
const EXPRS = ['neutral', 'smile', 'happy', 'surprised', 'shy', 'sad', 'angry', 'pout', 'wink', 'heart', 'sparkle'];
const REACTS = ['nod', 'shake', 'tilt', 'bounce', 'recoil', 'lookdown', 'wave'];
const STATES = ['idle', 'listening', 'thinking', 'speaking'];
const MAPS = ['crossing', 'classroom', 'pool', 'sky', 'citadel', 'noneuclid', ''];
// what the Japanese voice can sing: kana, kanji and a little punctuation (the same set as scripts/server.py SINGABLE)
const SINGS = /[぀-ヿ一-鿿々ー〜、。！？!?ー〜\s]/u;

const N = (s) => s !== undefined && s !== null && s !== '' && Number.isFinite(Number(s));
// a catalog entry may be names, {name}/{id} objects (engine.commands(), ParamDefs) or a {name: ...} map
const names = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.name ?? x?.id)) : v && typeof v === 'object' ? Object.keys(v) : null);
const cat = (c, key, fallback = null) => names(c?.[key])?.length ? names(c[key]) : fallback;
const one = (list, v, what) => (!list || list.includes(v) ? null : `${what} '${v}' 없음${list.length <= 16 ? ` (${list.filter(Boolean).join(' ')})` : ''}`);
const extra = (list) => (list.length ? `모르는 인자: ${list.join(' ')}` : null);
const kvs = (t, ok) => extra(t.args.slice(1).filter((a) => !ok.some((k) => new RegExp(`^${k}=[\\d.]+$`).test(a))));
const vol = (t) => (t.kv.vol !== undefined && !(+t.kv.vol >= 0 && +t.kv.vol <= 1) ? 'vol은 0-1' : null);

/** '#cmd:<name> <json>', or '#cmd:<name> key=value ...' (each value JSON when it parses, else a string). Ink evaluates
 *  { } inside a tag as logic, so in a .ink file the key=value form is the one that survives. Throws on a bad body. */
export function cmdArgs(tag) {
  const name = tag.args[0] ?? '', body = tag.value.slice(name.length).trim();
  if (!body) return { name, args: {} };
  if (/^[[{]/.test(body)) return { name, args: JSON.parse(body) };
  return { name, args: Object.fromEntries(tag.args.slice(1).map((a) => {
    const i = a.indexOf('=');
    if (i < 1) throw new Error(`'${a}': key=value로 쓴다`);
    const v = a.slice(i + 1);
    try { return [a.slice(0, i), JSON.parse(v)]; } catch { return [a.slice(0, i), v]; }
  })) };
}

// every direction tag. block: the line waits for it (Runner awaits stage.direction). check(tag, catalog) -> problem | null
export const COMMANDS = {
  expr: { args: '<표정> [hold] [len=<초>]', doc: '표정. hold면 다음 표정까지 유지', block: false,
    check: (t, c) => (!t.args[0] ? '표정 이름이 필요하다' : one(cat(c, 'expressions', EXPRS), t.args[0], '표정') ?? extra(t.args.slice(1).filter((a) => a !== 'hold' && !/^len=[\d.]+$/.test(a)))) },
  motion: { args: '<이름>', doc: '모션 클립 재생', block: false, check: (t, c) => (!t.args[0] ? '모션 이름이 필요하다' : one(cat(c, 'motions'), t.args[0], '모션')) },
  react: { args: '<이름>', doc: '짧은 몸 반응 (nod shake tilt bounce recoil lookdown wave)', block: false, check: (t, c) => one(cat(c, 'reactions', REACTS), t.args[0], '반응') },
  state: { args: '<idle|listening|thinking|speaking>', doc: '대화 자세', block: false, check: (t) => one(STATES, t.args[0], '자세') },
  hands: { args: '<모드>', doc: '손 모양 (auto 등)', block: false, check: (t, c) => (!t.args[0] ? '손 모드가 필요하다' : one(cat(c, 'hands'), t.args[0], '손 모드')) },
  look: { args: '<you|away|down|up|left|right|free>', doc: '시선. free = 원래대로 (장면이 끝나면 풀림)', block: false, check: (t) => one(LOOKS, t.args[0], '시선') },
  walk: { args: '<x> <z>', doc: '그 자리(무대 미터, 처음 선 곳이 0,0)로 걸어간다', block: true, check: (t) => (t.args.length === 2 && t.args.every(N) ? null : 'x z 숫자 두 개') },
  place: { args: '<x> <z> [yaw도]', doc: '그 자리로 바로 옮긴다', block: false, check: (t) => (t.args.length >= 2 && t.args.length <= 3 && t.args.every(N) ? null : 'x z [yaw] 숫자') },
  face: { args: 'you | <yaw도>', doc: '나를 보거나 그 방향으로 돈다', block: false, check: (t) => (t.value === 'you' || N(t.value) ? null : "'you' 또는 각도") },
  follow: { args: 'on | off', doc: 'VR에서 나를 따라오기 (장면 중에는 기본 off)', block: false, check: (t) => one(['on', 'off'], t.value, 'follow') },
  map: { args: '<맵 id>', doc: '맵 이동 (grid = 맵 없음)', block: true, check: (t, c) => (!t.args[0] ? '맵 id가 필요하다' : one(cat(c, 'maps') && [...cat(c, 'maps'), 'grid'], t.args[0], '맵')) },
  time: { args: '<morning|day|evening|night>', doc: '맵의 해를 그 시간대로 (실제 시각 연동은 꺼짐)', block: false, check: (t) => one(PERIODS, t.args[0], '시간대') },
  bgm: { args: '<이름> [fade=<초>] [vol=<0-1>] | stop', doc: '배경음악 assets/music/<이름>.ogg|mp3', block: false, check: (t) => (!t.args[0] ? '이름 또는 stop' : vol(t) ?? kvs(t, ['fade', 'vol'])) },
  sfx: { args: '<이름> [vol=<0-1>]', doc: '효과음 assets/sfx/<이름>. 내장: pop chime', block: false, check: (t) => (!t.args[0] ? '효과음 이름이 필요하다' : vol(t) ?? kvs(t, ['vol'])) },
  fx: { args: '<이모트>', doc: '머리 위 만화 기호', block: false, check: (t, c) => one(cat(c, 'fx', FX_KINDS), t.args[0], '이모트') },
  wait: { args: '<초>', doc: '기다린다', block: true, check: (t) => (N(t.value) && +t.value >= 0 ? null : '초 (숫자)') },
  fade: { args: 'out|in [초]', doc: '화면 암전 / 밝아짐 (VR에서도)', block: true, check: (t) => one(['out', 'in'], t.args[0], 'fade') ?? (t.args.length > 2 || (t.args[1] !== undefined && !N(t.args[1])) ? '초 (숫자)' : null) },
  clear: { args: '', doc: '대사 상자를 잠깐 숨긴다', block: false, check: (t) => (t.value ? '인자 없음' : null) },
  memory: { args: '<id> <제목>', doc: '추억 갤러리에 등록 (그 순간의 스크린샷과 함께)', block: false, check: (t) => (!/^[\w-]+$/.test(t.args[0] ?? '') ? 'id (영문 숫자 _ -)' : t.args.length < 2 ? '제목이 필요하다' : null) },
  input: { args: '<변수> <질문>', doc: '플레이어에게 글을 받아 Ink 변수에 넣는다 (VR에서는 말로)', block: true, check: (t) => (!/^\w+$/.test(t.args[0] ?? '') ? '변수 이름이 필요하다' : t.args.length < 2 ? '질문이 필요하다' : null) },
  set: { args: '<param>=<값>', doc: '엔진 파라미터 아무거나', block: false,
    check: (t, c) => { const k = Object.keys(t.kv); return t.args.length !== 1 || k.length !== 1 ? '<param>=<값> 하나' : one(cat(c, 'params'), k[0], '파라미터'); } },
  cmd: { args: '<명령> [key=value ...]', doc: '엔진 명령 아무거나 (#cmd:camera mode=rig)', block: true,
    check: (t, c) => { if (!t.args[0]) return '명령 이름이 필요하다'; try { cmdArgs(t); } catch (e) { return e.message; } return one(cat(c, 'commands'), t.args[0], '명령'); } },
};

export const EVENTS = [
  { name: 'start', doc: '처음 시작(새 게임). 트리거가 없으면 Ink 맨 위 흐름이 재생된다' },
  { name: 'return', doc: '다시 찾아와서 그녀가 처음 반길 때', value: '지난 방문에서 지난 시간(시), 처음이면 -1' },
  { name: 'back', doc: '같은 방문 중 자리를 비웠다 돌아왔을 때 (웹캠/헤드셋)' },
  { name: 'map.<id>', doc: '맵이 바뀌었을 때 (map.pool, map.*)' },
  { name: 'touch.headpat', doc: 'VR에서 머리를 쓰다듬을 때' },
  { name: 'touch.poke', doc: 'VR에서 볼을 찌를 때', value: '왼쪽 -1, 오른쪽 1' },
  { name: 'touch.wave', doc: 'VR에서 손을 흔들 때' },
  { name: 'touch.highfive', doc: 'VR에서 하이파이브' },
  { name: 'touch.hand', doc: 'VR에서 손을 잡을 때' },
  { name: 'near', doc: '얼굴 바로 앞까지 다가갔을 때' },
  { name: 'gaze', doc: 'VR에서 눈을 맞추고 story.gaze초 동안 있었을 때', value: '초' },
  { name: 'head.nod', doc: 'VR에서 고개를 끄덕였을 때' },
  { name: 'head.shake', doc: 'VR에서 고개를 저었을 때' },
  { name: 'chat', doc: '자유 대화(LLM)에서 한 번 주고받을 때마다', value: '그녀가 느낀 기분 -2..2' },
  { name: 'idle', doc: 'story.idle초 동안 아무 일도 없을 때', value: '초' },
  { name: 'vr.enter', doc: 'VR 들어감' },
  { name: 'vr.exit', doc: 'VR 나옴' },
  ...PERIODS.map((p) => ({ name: `time.${p}`, doc: '시간대가 바뀌었을 때 (실제 시계)' })),
];
const EXACT = EVENTS.map((e) => e.name).filter((n) => !n.includes('<'));

export function isKnownEvent(name) {
  if (name === '*' || EXACT.includes(name) || /^map\.[\w-]+$/.test(name)) return true;
  if (!name.endsWith('.*')) return false;
  const p = name.slice(0, -1);
  return p === 'map.' || EXACT.some((n) => n.startsWith(p));
}

/** exact | 'x.*' (everything under x.) | '*' */
export const matches = (pattern, event) => pattern === '*' || pattern === event || (pattern.endsWith('.*') && event.startsWith(pattern.slice(0, -1)));

const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const pick = (r, a) => a[Math.floor(r() * a.length)];
// lib.ink's externals. sample(rng, ...args): a plausible value, for the fuzz (and Inky-like runs without the game)
export const EXTERNALS = {
  hour: { args: [], doc: '지금 시 (0-23, 브라우저 시계)', sample: (r = Math.random) => int(r, 0, 23) },
  minute: { args: [], doc: '지금 분 (0-59)', sample: (r = Math.random) => int(r, 0, 59) },
  weekday: { args: [], doc: '요일: 0 = 일요일 .. 6 = 토요일', sample: (r = Math.random) => int(r, 0, 6) },
  date: { args: [], doc: '"MM-DD" (생일, 기념일)', sample: (r = Math.random) => `${String(int(r, 1, 12)).padStart(2, '0')}-${String(int(r, 1, 28)).padStart(2, '0')}` },
  period: { args: [], doc: '"morning" 5-11시, "day" 11-17시, "evening" 17-20시, "night" 20-5시', sample: (r = Math.random) => pick(r, PERIODS) },
  map: { args: [], doc: '지금 맵 id (맵 없음 = "")', sample: (r = Math.random) => pick(r, MAPS) },
  vr: { args: [], doc: 'VR 헤드셋을 쓰고 있으면 true', sample: (r = Math.random) => r() < 0.5 },
  near: { args: [], doc: '바로 코앞(얼굴 앞)에 있으면 true', sample: (r = Math.random) => r() < 0.3 },
  away: { args: [], doc: '지난번 방문에서 몇 시간 지났나 (처음이면 -1)', sample: (r = Math.random) => (r() < 0.2 ? -1 : int(r, 0, 24 * 30)) },
  visits: { args: [], doc: '몇 번째 방문인가 (1부터)', sample: (r = Math.random) => int(r, 1, 30) },
  has_motion: { args: ['motion_name'], doc: '이 모션 클립이 있나 (에셋이 없을 수도 있다)', sample: (r = Math.random) => r() < 0.9 },
  memory: { args: ['memory_id'], doc: '이 추억이 열려 있나 (세이브와 상관없이)', sample: (r = Math.random) => r() < 0.5 },
};

/** '#expr:shy hold len=3' -> {name:'expr', value:'shy hold len=3', args:['shy','hold','len=3'], kv:{len:'3'}, raw} */
export function parseTag(raw) {
  raw = String(raw ?? '').trim().replace(/^#\s*/, '');
  const i = raw.indexOf(':'), value = i < 0 ? '' : raw.slice(i + 1).trim();
  const args = value ? value.split(/\s+/) : [], kv = {};
  for (const a of args) { const m = /^([\w.-]+)=(.*)$/.exec(a); if (m) kv[m[1]] = m[2]; }
  return { name: (i < 0 ? raw : raw.slice(0, i)).trim().toLowerCase(), value, args, kv, raw };
}

const META = new Set(['on', 'once', 'cooldown', 'chance', 'priority', 'when', 'speaker', 'player']);
const LINE_META = new Set(['yomi', 'style', 'auto', 'timer', 'voice']);
const CHOICE_META = new Set(['nod', 'shake', 'on', 'default']);
const isSub = (n) => /^[a-z]{2}$/.test(n) && !COMMANDS[n] && !META.has(n) && !CHOICE_META.has(n);
/** a tag the stage runs (not trigger meta, subtitle, voice/timing, or choice meta) */
export const isDirection = (t) => !!t.name && !META.has(t.name) && !LINE_META.has(t.name) && !CHOICE_META.has(t.name) && !isSub(t.name);

/** '# speaker: テト = teto, 先生 = none' and '# player: 나' among the global tags -> who speaks with which voice */
export function speakersOf(globalTags = []) {
  const voices = new Map([['ミク', 'miku'], ['미쿠', 'miku'], ['Miku', 'miku']]), player = new Set(['나']);
  for (const t of (globalTags ?? []).map(parseTag)) {
    if (t.name !== 'speaker' && t.name !== 'player') continue;
    for (const part of t.value.split(',')) {
      const [n, v] = part.split('=').map((s) => s.trim());
      if (!n) continue;
      if (t.name === 'player') player.add(n);
      else voices.set(n, !v || v === 'none' ? null : v); // no voice: a name plate, silent
    }
  }
  return { voices, player };
}

/** one Continue() of output + its tags -> Line (see the contract) */
export function parseLine(raw, tags = [], { speakers = speakersOf(), knot = '' } = {}) {
  const ts = (tags ?? []).map((t) => (typeof t === 'string' ? parseTag(t) : t)), get = (n) => ts.find((t) => t.name === n);
  let text = String(raw ?? '').replace(/\s+$/, ''), speaker = null, who = 'narration', voice = null;
  const m = /^\s*([^:：\s][^:：]{0,23}?)\s*[:：]\s*/.exec(text);
  if (m && (speakers.voices.has(m[1]) || speakers.player.has(m[1]))) {
    speaker = m[1]; text = text.slice(m[0].length);
    if (speakers.player.has(speaker)) who = 'player'; else { who = 'her'; voice = speakers.voices.get(speaker); }
  }
  text = text.trim();
  if (get('voice')?.value === 'off') voice = null;
  const subs = {};
  for (const t of ts) if (isSub(t.name)) subs[t.name] = t.value;
  const n = (t) => (t && N(t.value) ? +t.value : null);
  return { id: fnv1a(`${knot}|${text}`), knot, speaker, who, voice, text, say: get('yomi')?.value || text, subs,
    style: get('style')?.value || null, auto: n(get('auto')), timer: n(get('timer')), directions: ts.filter(isDirection) };
}

/** the knot the last Continue() came from ('' = the root flow) */
export function knotAt(story) {
  const k = String(story.state.previousPointer?.path ?? '').split('.')[0];
  return /^\d*$/.test(k) ? '' : k;
}

/** The root's tags. inkjs' own globalTags gives up at the newline that 'INCLUDE lib.ink' leaves ahead of them. */
export function globalTagsOf(story, json = story.ToJson()) {
  const out = [];
  let tag = null;
  for (const x of (typeof json === 'string' ? JSON.parse(json) : json).root?.[0] ?? []) {
    if (x === '#') tag = '';
    else if (x === '/#') { out.push(tag.trim()); tag = null; }
    else if (tag !== null) { if (typeof x === 'string' && x[0] === '^') tag += x.slice(1); }
    else if (x !== '\n') break;
  }
  return out;
}

// Story JSON has no mark for functions, so compile() lists them under an extra top-level key the runtime ignores.
function finish(story, json) {
  const j = JSON.parse(json);
  // ponytail: a JSON from elsewhere (inklecate) has no list: functions with a '~ return' are found, ones without show as knots
  story.inkFunctions = new Set(j.inkFunctions ?? Object.entries(j.root?.[2] ?? {}).filter(([, c]) => Array.isArray(c) && c.includes('~ret')).map(([k]) => k));
  Object.defineProperty(story, 'globalTags', { value: globalTagsOf(story, j), configurable: true });
  story.allowExternalFunctionFallbacks = true;
  return story;
}
/** compiled JSON (string or object) -> Story with globalTags fixed and functions known */
export function storyOf(json) {
  const text = typeof json === 'string' ? json : JSON.stringify(json);
  return finish(new Story(text), text);
}

/** named content of the root that isn't a function */
export function knotsOf(story) {
  const fns = story.inkFunctions ?? new Set();
  return [...story.mainContentContainer.namedContent.keys()].filter((k) => k !== 'global decl' && !fns.has(k));
}

/** knots whose top tags include '# on:' -> Trigger[], in source order */
export function triggersOf(story) {
  const out = [];
  for (const knot of knotsOf(story)) {
    let tags;
    try { tags = (story.TagsForContentAtPath(knot) ?? []).map(parseTag); } catch { continue; } // dynamic tag at the top
    const get = (n) => tags.find((t) => t.name === n), on = tags.filter((t) => t.name === 'on').flatMap((t) => t.value.split(/[,\s]+/)).filter(Boolean);
    if (!on.length) continue;
    out.push({ knot, on, once: !!get('once'), cooldown: N(get('cooldown')?.value) ? +get('cooldown').value : 0,
      chance: N(get('chance')?.value) ? +get('chance').value : 1, priority: N(get('priority')?.value) ? +get('priority').value : 0,
      when: get('when')?.value.replace(/\(\s*\)$/, '').trim() || null, order: out.length });
  }
  return out;
}

// "ERROR: 'main.ink' line 12: Divert target not found" -> Issue
function issue(text, severity, entry) {
  const m = /^(?:RUNTIME )?(?:ERROR|WARNING|TODO)?:?\s*(?:'([^']*)'\s*)?(?:line (\d+):\s*)?([\s\S]*)$/.exec(String(text));
  return { file: m[1] ?? entry, line: m[2] ? +m[2] : 0, message: m[3].split('\n')[0].trim(), severity, code: 'compile' };
}

/** files: {name: source}, names as INCLUDE writes them (relative to story/) -> { story|null, json|null, errors, warnings } */
export function compile(files, entry = 'main.ink') {
  const handler = { ResolveInkFilename: (n) => n, LoadInkFileContents: (n) => { if (n in files) return files[n]; throw new Error('파일이 없다'); } };
  if (!(entry in files)) return { story: null, json: null, errors: [{ file: entry, line: 0, message: `${entry} 파일이 없다`, severity: 'error', code: 'compile' }], warnings: [] };
  // countAllVisits: the dev tools and fuzz show visits per knot, and READ_COUNT works on every knot
  const c = new Compiler(files[entry], new CompilerOptions(entry, [], true, null, handler));
  let story = null, json = null, thrown = null;
  try { story = c.Compile(); } catch (e) { thrown = e; }
  const errors = (c.errors ?? []).map((m) => issue(m, 'error', entry)), warnings = (c.warnings ?? []).map((m) => issue(m, 'warning', entry));
  if (!story && !errors.length) errors.push({ file: entry, line: 0, message: String(thrown?.message ?? thrown ?? '컴파일 실패'), severity: 'error', code: 'compile' });
  if (story && !errors.length) {
    let fns = [];
    try { fns = c.parsedStory.content.filter((x) => x.isFunction).map((x) => x.identifier?.name).filter(Boolean); } catch { /* parser internals moved */ }
    json = story.ToJson();
    if (fns.length) json = `${json.slice(0, -1)},"inkFunctions":${JSON.stringify(fns)}}`;
    finish(story, json);
  } else story = null;
  return { story, json, errors, warnings };
}

const includesOf = (src) => [...src.matchAll(/^\s*INCLUDE\s+([^\r\n]+?)\s*(?:\/\/.*)?$/gm)].map((m) => m[1]);
/** the entry and everything it INCLUDEs (recursively) -> {name: source}. A missing include is left for compile to report. */
export async function fetchSources(base = 'story/', entry = 'main.ink', fetchText = (url) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${url}: HTTP ${r.status}`))))) {
  const files = {};
  const get = async (name) => {
    if (name in files) return;
    files[name] = '';
    try { files[name] = await fetchText(base + name); } catch (e) { delete files[name]; if (name === entry) throw e; return; }
    await Promise.all(includesOf(files[name]).map(get));
  };
  await get(entry);
  return files;
}

// ---- lint: a line-by-line read of the source, the way ink cuts it, for what the compiler can't know ----

const uncomment = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
// a line -> its text and tags. A tag runs to the next '#', the line's end, or (inside a choice's [ ]) the ']'.
// choice: the tag lands on the choice itself, which ink does inside [ ] or when the choice has no [ ] at all.
function cut(line, isChoice) {
  const tags = [], bracketed = isChoice && line.includes('[');
  let text = '', cur = null, br = 0, depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') { const e = ch + (line[i + 1] ?? ''); i++; if (cur) cur.raw += e; else text += e; continue; }
    if (ch === '{') depth++; else if (ch === '}') depth = Math.max(0, depth - 1);
    if (ch === '#' && !depth) { if (cur) tags.push(cur); cur = { raw: '', choice: isChoice && (!bracketed || br > 0) }; continue; }
    if (isChoice && !depth && (ch === '[' || ch === ']')) { br += ch === '[' ? 1 : -1; if (cur) { tags.push(cur); cur = null; } text += ch; continue; }
    if (cur) cur.raw += ch; else text += ch;
  }
  if (cur) tags.push(cur);
  return { text, tags };
}
// what a line shows, roughly: inline logic, glue and diverts out
const shown = (s) => { let t = s, p; do { p = t; t = t.replace(/\{[^{}]*\}/g, ''); } while (t !== p); return t.replace(/\{.*$/, '').replace(/<>/g, '').replace(/(->|<-).*$/, '').replace(/[{}]/g, '').replace(/\\(.)/g, '$1').trim(); };

/** static checks with file:line, plus the compiler's own issues -> Issue[] */
export function lint(files, { story, catalog } = {}) {
  const built = compile(files);
  story ??= built.story;
  const out = [...built.errors, ...built.warnings];
  const add = (file, line, severity, code, message) => out.push({ file, line, message, severity, code });
  const src = Object.entries(files).map(([file, s]) => [file, uncomment(s).split(/\r?\n/)]);
  const vars = new Set(), knots = [], diverted = new Set(), speakerTags = [];
  for (const [file, lines] of src) lines.forEach((l, i) => {
    let m;
    if ((m = /^\s*VAR\s+(\w+)/.exec(l))) vars.add(m[1]);
    if ((m = /^\s*={2,}\s*(function\s+)?(\w+)/.exec(l))) knots.push({ file, line: i + 1, name: m[2], fn: !!m[1] });
    for (const d of l.matchAll(/(?:->|<-)\s*([A-Za-z_]\w*)/g)) diverted.add(d[1]);
    if ((m = /^\s*#\s*((?:speaker|player)\s*:.*)$/.exec(l))) speakerTags.push(m[1]);
  });
  const speakers = speakersOf(story?.globalTags?.length ? story.globalTags : speakerTags), triggered = new Set();

  for (const [file, lines] of src) {
    let knot = null, fn = false, top = false, depth = 0;
    lines.forEach((l, i) => {
      const at = i + 1, inBlock = depth > 0;
      depth = Math.max(0, depth + (l.match(/(?<!\\)\{/g)?.length ?? 0) - (l.match(/(?<!\\)\}/g)?.length ?? 0));
      let t = l.trim(), m;
      if (!t) return;
      if ((m = /^={2,}\s*(function\s+)?(\w+)/.exec(t))) { knot = m[2]; fn = !!m[1]; top = true; return; }
      if (/^=\s*\w+/.test(t)) { top = false; return; }
      if (/^(VAR|CONST|LIST|INCLUDE|EXTERNAL|TODO)\b/.test(t) || t[0] === '~') return;
      const isChoice = /^[*+]/.test(t);
      t = t.replace(/^([*+]\s*)+/, '').replace(/^(-(?!>)\s*)+/, '').replace(/^\(\w+\)\s*/, '');
      if (inBlock && /^\s*-(?!>)/.test(l)) { const c = /^([^:：]*)[:：]\s*/.exec(t); if (c && !speakers.voices.has(c[1].trim()) && !speakers.player.has(c[1].trim())) t = t.slice(c[0].length); } // '- else:'
      const { text, tags } = cut(t, isChoice);
      const body = shown(text);
      for (const tg of tags) {
        const tag = parseTag(tg.raw), n = tag.name, dynamic = tag.value.includes('{');
        if (n === 'on') {
          if (top && knot && !isChoice) triggered.add(knot);
          for (const p of tag.value.split(/[,\s]+/).filter(Boolean)) if (!dynamic && !isKnownEvent(p)) add(file, at, 'warning', 'event', `모르는 이벤트 '${p}'`);
        }
        if (isChoice && !tg.choice && (CHOICE_META.has(n) || n === 'timer')) add(file, at, 'warning', 'choice-tag', `#${n}가 선택지가 아니라 고른 뒤의 줄에 붙는다: [ ] 안에 쓴다 (* [글 #${n}])`);
        if (META.has(n) || LINE_META.has(n) || CHOICE_META.has(n) || isSub(n)) continue;
        const cmd = COMMANDS[n];
        if (!cmd) { add(file, at, 'warning', 'tag', `모르는 태그 #${n}`); continue; }
        if (n === 'cmd' && /\{/.test(tag.value)) { add(file, at, 'warning', 'args', '태그 안의 { }는 Ink가 계산해 버린다: #cmd:<명령> key=value 로 쓴다'); continue; }
        if (dynamic) continue;
        const bad = cmd.check?.(tag, catalog);
        if (bad) add(file, at, 'warning', 'args', `#${n}: ${bad}`);
        if (n === 'input' && tag.args[0] && !vars.has(tag.args[0])) add(file, at, 'error', 'input', `#input의 변수 '${tag.args[0]}'가 VAR로 선언되지 않았다`);
      }
      if (body || isChoice) top = false;
      if (!body || isChoice || fn) return;
      // a dialogue line
      const sp = /^([^:：\s][^:：]{0,23}?)\s*[:：]\s*/.exec(body), name = sp?.[1];
      const known = name && (speakers.voices.has(name) || speakers.player.has(name)), said = known ? body.slice(sp[0].length) : body;
      if (name && !known && name.length <= 12) add(file, at, 'info', 'speaker', `'${name}:'는 선언된 화자가 아니라 나레이션으로 나온다 (# speaker: ${name} = <목소리|none>)`);
      if (said.length > 60) add(file, at, 'info', 'long', `대사가 길다 (${said.length}자 > 60)`);
      const ptags = tags.map((x) => parseTag(x.raw));
      if (!known || !speakers.voices.get(name) || ptags.some((x) => x.name === 'voice' && x.value === 'off')) return;
      const say = shown(ptags.find((x) => x.name === 'yomi')?.value ?? said), bad = [...new Set([...say].filter((ch) => !SINGS.test(ch)))];
      if (bad.length) add(file, at, 'warning', 'sing', `목소리가 못 읽는 글자: ${bad.join(' ')} (일본어 가나/한자와 、。！？ー〜만, 읽기는 #yomi:)`);
      if (!ptags.some((x) => x.name === 'ko')) add(file, at, 'info', 'sub', '#ko: 자막이 없다');
    });
  }
  for (const k of knots) if (!k.fn && !diverted.has(k.name) && !triggered.has(k.name)) add(k.file, k.line, 'warning', 'unused', `노트 '${k.name}'로 가는 길이 없다 (-> ${k.name} 도, # on: 도 없음)`);
  return out;
}

// ---- fuzz: random playthroughs of the compiled story ----

const mulberry32 = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const declared = (s, n) => s.variablesState._globalVariables?.has(n) ?? false; // pinned inkjs: no public "is declared"
const SUFFIX = { 'map.': MAPS.filter(Boolean), 'touch.': ['headpat', 'poke', 'wave', 'highfive', 'hand'], 'time.': PERIODS, 'head.': ['nod', 'shake'], 'vr.': ['enter', 'exit'] };
const eventFor = (p, r) => (p === '*' ? pick(r, EXACT) : p.endsWith('.*') ? p.slice(0, -1) + pick(r, SUFFIX[p.slice(0, -1)] ?? ['x']) : p);
const valueFor = (ev, r) => ({ return: EXTERNALS.away.sample(r), 'touch.poke': r() < 0.5 ? -1 : 1, chat: int(r, -2, 2), gaze: int(r, 2, 10), idle: int(r, 30, 600) })[ev] ?? 0;

/** Random playthroughs: the root flow, then free-mode trigger scenes (about `scenes` per run, once/when honoured),
 *  random choices (eventChance: an event arrives at a choice and picks the one tagged for it). One Story, reset
 *  between runs: the same as a new one, without parsing the JSON once per run. Never throws. */
export function fuzz(json, { runs = 200, steps = 500, eventChance = 0.1, seed = 1, scenes = 8 } = {}) {
  const res = { runs, knots: [], visits: {}, unvisited: [], coverage: 0, errors: [], lines: [], choices: 0, capped: 0 };
  const errs = new Map(), lines = new Map(), choices = new Set(), r = mulberry32(seed);
  let s, err = null;
  try {
    s = storyOf(json);
    for (const [n, x] of Object.entries(EXTERNALS)) s.BindExternalFunction(n, (...a) => x.sample(r, ...a), true);
    s.onError = (m, type) => { if (type !== 1) err ??= m; }; // 1 = ErrorType.Warning
  } catch (e) { res.errors.push({ message: String(e?.message ?? e), knot: '', run: -1, count: 1 }); return res; }
  const knots = res.knots = knotsOf(s), triggers = triggersOf(s), speakers = speakersOf(s.globalTags);
  for (const k of knots) res.visits[k] = 0;
  for (let run = 0; run < runs; run++) {
    let knot = '';
    const fail = (message) => { const key = `${knot}|${message}`; if (errs.has(key)) errs.get(key).count++; else errs.set(key, { message, knot, run, count: 1 }); };
    try {
      s.ResetState(); err = null;
      const done = new Set();
      for (let step = 0, scene = 0; ; step++) {
        if (step >= steps) { res.capped++; break; }
        if (s.canContinue) {
          const text = s.Continue();
          if (err) throw new Error(err);
          knot = knotAt(s);
          const line = parseLine(text, s.currentTags, { speakers, knot });
          if (line.text && !lines.has(line.id)) lines.set(line.id, line);
          for (const t of line.directions) if (t.name === 'input' && declared(s, t.args[0])) s.variablesState[t.args[0]] = 'ゆう';
        } else if (s.currentChoices.length) {
          const cs = s.currentChoices.map((c) => ({ index: c.index, text: c.text, tags: (c.tags ?? []).map(parseTag) }));
          for (const c of cs) choices.add(`${knot}|${c.text}`);
          const tagged = cs.filter((c) => c.tags.some((t) => ['on', 'nod', 'shake'].includes(t.name)));
          s.ChooseChoiceIndex((tagged.length && r() < eventChance ? pick(r, tagged) : pick(r, cs)).index);
          if (err) throw new Error(err);
        } else {
          if (scene++ && r() < 1 / scenes) break;
          const ready = triggers.filter((t) => {
            if (t.once && done.has(t.knot)) return false;
            if (!t.when) return true;
            try { return !!s.EvaluateFunction(t.when); } catch (e) { knot = t.knot; fail(`when: ${t.when}: ${e?.message ?? e}`); return false; }
          });
          if (!ready.length) break;
          const t = pick(r, ready), ev = eventFor(pick(r, t.on), r);
          if (declared(s, 'event')) s.variablesState.event = ev;
          if (declared(s, 'event_value')) s.variablesState.event_value = valueFor(ev, r);
          done.add(t.knot); knot = t.knot;
          s.ChoosePathString(t.knot);
        }
      }
    } catch (e) { fail(String(e?.message ?? e)); }
    for (const k of knots) try { res.visits[k] += s.state.VisitCountAtPathString(k); } catch { /* uncounted */ }
  }
  res.unvisited = knots.filter((k) => !res.visits[k]);
  res.coverage = knots.length ? (knots.length - res.unvisited.length) / knots.length : 1;
  res.errors = [...errs.values()];
  res.lines = [...lines.values()];
  res.choices = choices.size;
  return res;
}

// ---- a spoken answer to a choice ----

const norm = (s) => String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const bigrams = (s) => { const c = [...s]; return c.length < 2 ? c : c.slice(1).map((x, i) => c[i] + x); };
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b), left = new Map();
  if (!A.length || !B.length) return 0;
  for (const g of B) left.set(g, (left.get(g) ?? 0) + 1);
  let hit = 0;
  for (const g of A) if (left.get(g) > 0) { hit++; left.set(g, left.get(g) - 1); }
  return (2 * hit) / (A.length + B.length);
}
/** what the player said -> the index (in choices) of the choice they meant, or -1. Spaces, punctuation and case don't
 *  count; a choice said whole (or a 2+ character piece of it) wins outright, else the closest by character-bigram Dice
 *  if it reaches 0.35 (speech recognition gets a word or two wrong). */
export function matchChoice(heard, choices) {
  const h = norm(heard);
  if (!h) return -1;
  let best = -1, score = 0.35 - 1e-9;
  (choices ?? []).forEach((c, i) => {
    const t = norm(c?.text ?? c);
    if (!t) return;
    const s = h.includes(t) ? 2 + t.length / 1000 : t.includes(h) && h.length >= 2 ? 1.5 + h.length / t.length / 10 : dice(h, t);
    if (s > score) { best = i; score = s; }
  });
  return best;
}

/** FNV-1a 32-bit -> 8 hex digits (stable line ids for read marks) */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(String(str))) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
