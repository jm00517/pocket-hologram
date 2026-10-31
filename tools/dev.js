// Story dev tool, live half (tools/dev.html): the page shell, the editor mount (./editor.js) and the tabs that drive the
// running game through the engine bridge (POST /api/engine {cmd: 'story.*'} -> the open game page, engine/bridge/relay.py).
// The game is optional: with no game page (503) the editor keeps working and the tabs keep the last state, dimmed.
// Polls only while this tab is visible, so a dev page left in the background costs the game nothing. The page's bridge
// client runs jobs one at a time, so every poll waits for the previous one and uses a short bridge timeout.
const $ = (s) => document.querySelector(s);
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && !k.includes('-')) el[k] = v;
    else el.setAttribute(k, v);
  }
  el.append(...kids.flat(9).filter((k) => k != null && k !== false && k !== ''));
  return el;
}
const fmt = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
const date = (t) => (t ? new Date(t < 1e12 ? t * 1000 : t) : null); // seconds (file mtimes) or ms
const clock = (t) => date(t)?.toLocaleTimeString('sv-SE') ?? '—'; // sv-SE: 13:46:44 and 2026-10-31 13:46:44
const stamp = (t) => date(t)?.toLocaleString('sv-SE') ?? '—';
const nm = (x) => (typeof x === 'string' ? x : x?.id ?? x?.name ?? String(x));
// the snapshot's tables arrive as arrays or as {key: {...}} (COMMANDS, memories): read both
const rows = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.entries(x).map(([k, v]) => ({ name: k, id: k, ...v })) : []);
const count = (x) => (Array.isArray(x) ? x.length : x ?? 0);
const pref = (k, d) => { try { return JSON.parse(localStorage.getItem('ph.dev.' + k)) ?? d; } catch { return d; } };
const keep = (k, v) => { try { localStorage.setItem('ph.dev.' + k, JSON.stringify(v)); } catch { /* private window */ } };
const MODE = { idle: '자유', scene: '장면', choice: '선택지', input: '입력 대기', replay: '추억 재생' };
const PERIODS = ['morning', 'day', 'evening', 'night'];

// --- transport -------------------------------------------------------------------------------------------------
const CONN = { wait: '연결 중…', on: '연결됨', off: '게임 페이지가 열려 있지 않음', slow: '게임이 응답하지 않음',
  err: '스토리 상태를 읽지 못함', server: '서버에 연결할 수 없음' };
const BANNER = { wait: '연결 중…', off: '게임 페이지가 열려 있지 않음 — 게임을 열면 저절로 연결된다. 편집기는 그대로 쓸 수 있다.',
  slow: '게임이 응답하지 않음 (바쁘거나 멈췄거나 방금 닫힘)', server: '서버에 연결할 수 없음 — python scripts/server.py' };
let conn = 'wait';
function setConn(c, why = '') {
  $('#connLabel').title = $('#conn').title = why;
  if (c === conn) return;
  conn = c;
  $('#conn').className = 'dot ' + c; $('#connLabel').textContent = CONN[c];
  document.body.classList.toggle('offline', c !== 'on');
  $('#offline').hidden = c === 'on';
  $('#offline').textContent = c === 'err' ? `${CONN.err}: ${why} (게임에 story.* 명령이 있나?)` : BANNER[c];
  if (c !== 'on') publish(null);
}
// cmd over the bridge -> result; throws Error with .status (0 = no server, 503 = no game page, 504 = page busy)
async function call(cmd, args = {}, { timeout = 10 } = {}) {
  let r;
  try { r = await fetch('/api/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd, args, timeout }) }); }
  catch { setConn('server'); throw Object.assign(new Error(CONN.server), { status: 0 }); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 503) { setConn('off'); throw Object.assign(new Error(CONN.off), { status: 503 }); }
  if (r.status === 504) throw Object.assign(new Error('게임이 제때 답하지 않음'), { status: 504 });
  if (!r.ok || !j.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
  return j.result;
}
// run fn every ms while the page is visible, never two at once; now() = run again as soon as possible
function every(ms, fn) {
  let timer = null, running = false, again = false;
  const tick = async () => {
    timer = null;
    if (document.hidden) return;
    running = true; again = false;
    try { await fn(); } catch { /* call() already reflected it in the connection state */ }
    running = false;
    if (!document.hidden && !timer) timer = setTimeout(tick, again ? 0 : ms);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !timer && !running) tick(); });
  tick();
  return { now() { if (running) again = true; else { clearTimeout(timer); tick(); } } };
}
function note(text, bad = false) {
  const m = $('#msg'); m.textContent = text; m.className = bad ? 'bad' : '';
  clearTimeout(note.t); note.t = setTimeout(() => { m.textContent = ''; }, bad ? 8000 : 3500);
}
async function act(cmd, args = {}, done) {
  try {
    const r = await call(cmd, args);
    note(typeof done === 'function' ? done(r) : done ?? `${cmd} 완료`);
    statePoll.now();
    return r;
  } catch (e) { note(`${cmd}: ${e.message}`, true); }
}

// --- state -----------------------------------------------------------------------------------------------------
// state = the game's answer to the last poll (null while not connected); shown = the last good one, kept on screen
let state = null, shown = null, stateKey = '';
const subs = new Set();
function publish(s) {
  const k = s ? JSON.stringify(s) : '';
  if (k === stateKey) return;
  stateKey = k; state = s; if (s) shown = s;
  for (const fn of subs) { try { fn(s); } catch (e) { console.error(e); } }
  render();
}
// repaint el from data only when the data changed; focus survives on the element with the same data-k
const painted = new WeakMap();
function paint(el, data, build) {
  const k = JSON.stringify(data ?? null);
  if (painted.get(el) === k) return;
  painted.set(el, k);
  const fk = el.contains(document.activeElement) && document.activeElement.dataset.k;
  el.replaceChildren(...[build(data)].flat(9).filter(Boolean));
  if (fk) el.querySelector(`[data-k="${CSS.escape(fk)}"]`)?.focus();
}
function render() {
  const s = shown;
  $('#mode').textContent = s ? MODE[s.mode] ?? s.mode : '—'; $('#mode').dataset.m = s?.mode ?? '';
  $('#knot').textContent = s?.knot ? '@' + s.knot : '';
  $('#line').textContent = s?.line ? (s.line.speaker ? s.line.speaker + ': ' : '') + s.line.text : s?.fresh ? '새 게임 전 (첫 start / return 이벤트에서 시작)' : '';
  if (s) TABS[tab](s);
}

// --- 실행 -------------------------------------------------------------------------------------------------------
const badges = (tags) => (tags ?? []).map((t) => h('span', { class: 'tag', title: t.raw }, '#' + (t.raw ?? t.name)));
const lineView = (l) => h('div', { class: 'ln ' + l.who },
  l.speaker && h('b', {}, l.speaker), h('span', { class: 'tx' }, l.text),
  Object.entries(l.subs ?? {}).map(([k, v]) => h('div', { class: 'sub' }, `${k}: ${v}`)),
  l.say && l.say !== l.text && h('div', { class: 'sub' }, `읽기: ${l.say}`),
  h('div', { class: 'meta' }, [l.knot && `@${l.knot}`, l.voice ? `목소리 ${l.voice}` : '목소리 없음', l.style, l.auto && `auto ${l.auto}s`,
    l.timer && `timer ${l.timer}s`].filter(Boolean).map((x) => h('span', {}, x)), (l.directions ?? []).map((t) =>
      h('button', { class: 'tag', title: '이 연출만 다시 실행', onclick: (e) => { e.stopPropagation(); act('story.run', { tag: t.raw }, `#${t.raw}`); } }, '#' + t.raw))));
const resay = (l) => l.voice && act('story.say', { text: l.say ?? l.text, voice: l.voice, style: l.style ?? undefined }, `다시 말함: ${l.text}`);
const choose = (c, i) => act('story.choose', { index: c.index ?? i }, `선택: ${c.text}`);
function run(s) {
  paint($('#knotList'), s.knots, (ks) => rows(ks).map((k) => h('option', { value: nm(k) })));
  paint($('#curLine'), [s.line, s.mode], ([l, mode]) => l ? lineView(l)
    : h('p', { class: 'muted' }, { idle: '장면 없음 (자유 모드)', input: '입력 대기: 아래 칸이나 게임 화면에서 대답' }[mode] ?? '—'));
  $('#answerForm').hidden = s.mode !== 'input';
  paint($('#curChoices'), s.choices ?? [], (cs) => cs.length ? cs.map((c, i) =>
    h('button', { class: 'choice game', 'data-k': 'c' + i, onclick: () => choose(c, i) }, h('kbd', {}, String(i + 1)), h('span', {}, c.text), badges(c.tags)))
    : h('p', { class: 'muted' }, '없음'));
  paint($('#errors'), s.errors ?? [], (es) => es.length && [h('h3', { class: 'bad' }, `오류 ${es.length}`),
    h('ul', { class: 'errs' }, es.map((e) => h('li', {}, typeof e === 'string' ? e : e.message ?? fmt(e))))]);
  paint($('#backlog'), s.backlog ?? [], (ls) => ls.slice().reverse().map((l) =>
    h('li', { class: l.voice ? 'voiced' : '', title: l.voice ? '다시 말하기' : '', onclick: () => resay(l) }, lineView(l))));
}
$('#advance').onclick = () => act('story.advance', {}, '다음');
$('#stop').onclick = () => act('story.stop', {}, '장면 중지');
$('#newGame').onclick = () => confirm('지금 진행을 버리고 새 게임을 시작할까? (자동 저장도 덮어씀)') && act('story.new', {}, '새 게임');
$('#answerForm').onsubmit = (e) => { e.preventDefault(); const text = $('#answerText').value.trim(); if (text) act('story.answer', { text }, `대답: ${text}`); $('#answerText').value = ''; };
$('#playForm').onsubmit = (e) => { e.preventDefault(); const path = $('#playPath').value.trim(); if (path) act('story.play', { path }, `재생: ${path}`); };

// --- 변수 -------------------------------------------------------------------------------------------------------
const kind = (v) => (v === null ? 'null' : typeof v);
let varSig = '';
const varRows = new Map(); // name -> input
function parseVar(inp, name) {
  const t = inp.dataset.kind, raw = inp.value;
  if (t === 'boolean') return inp.checked;
  if (t === 'number') { const n = Number(raw.trim()); if (raw.trim() === '' || !Number.isFinite(n)) throw new Error(`${name}: 숫자가 아님`); return n; }
  if (t === 'string') return raw;
  try { return JSON.parse(raw); } catch { throw new Error(`${name}: JSON이 아님`); }
}
function setVar(name, inp) {
  let value;
  try { value = parseVar(inp, name); } catch (e) { note(e.message, true); return; }
  act('story.set', { name, value }, `${name} = ${fmt(value)}`);
}
function filterVars() {
  const q = $('#varFilter').value.trim().toLowerCase();
  for (const [n, inp] of varRows) inp.closest('tr').hidden = !!q && !n.toLowerCase().includes(q);
}
function vars(s) {
  const v = s.vars ?? {}, sig = Object.keys(v).map((n) => n + ':' + kind(v[n])).join('\n');
  if (sig !== varSig) {
    varSig = sig; varRows.clear();
    $('#varTable tbody').replaceChildren(...Object.keys(v).map((n) => {
      const bool = kind(v[n]) === 'boolean';
      const inp = h('input', { type: bool ? 'checkbox' : 'text', autocomplete: 'off', 'data-k': 'v:' + n, 'aria-label': n });
      inp.dataset.kind = kind(v[n]); inp.spellcheck = false;
      inp.onchange = () => setVar(n, inp);
      inp.onkeydown = (e) => { if (e.key === 'Escape') { inp.value = fmt(state?.vars?.[n] ?? v[n]); inp.blur(); } };
      varRows.set(n, inp);
      return h('tr', {}, h('th', { title: kind(v[n]) }, n), h('td', {}, inp));
    }));
    if (!varRows.size) $('#varTable tbody').append(h('tr', {}, h('td', { colspan: 2, class: 'muted' }, '전역 변수 없음')));
    filterVars();
  }
  for (const [n, inp] of varRows) {
    if (inp.type === 'checkbox') inp.checked = !!v[n];
    else if (document.activeElement !== inp) inp.value = fmt(v[n]); // don't type over an edit in progress
  }
  paint($('#visitTable tbody'), s.knots ?? [], (ks) => rows(ks).map((k) => h('tr', { class: k.visits ? '' : 'muted' },
    h('td', {}, k.name), h('td', { class: 'num' }, k.visits ?? 0),
    h('td', {}, h('button', { class: 'game small', 'data-k': 'p:' + k.name, title: '이 노트부터 재생', onclick: () => act('story.play', { path: k.name }, `재생: ${k.name}`) }, '재생')))));
}
$('#varFilter').oninput = filterVars;

// --- 트리거 -----------------------------------------------------------------------------------------------------
const eventValue = () => { const v = $('#fireValue').value.trim(); return v === '' ? undefined : Number.isFinite(+v) ? +v : v; };
function fire(event) {
  const value = eventValue();
  act('story.fire', value === undefined ? { event } : { event, value }, (r) => `${event}${value === undefined ? '' : ' ' + value}: ${r?.handled ? '처리됨' : '받는 곳 없음'}`);
}
// 'map.<id>' / 'map.*' are patterns, not events: put the stem in the box to finish by hand
const fireOrFill = (ev) => { if (!/[<*]/.test(ev)) return fire(ev); $('#fireEvent').value = ev.split(/[<*]/)[0]; $('#fireEvent').focus(); };
const events = (s) => rows(s.schema?.events);
function trig(s) {
  const maps = rows(s.catalog?.maps).map(nm);
  paint($('#eventList'), [events(s), maps], ([es]) => es.flatMap((e) =>
    e.name.includes('<id>') ? maps.map((m) => e.name.replace('<id>', m)) : e.name.includes('<period>') ? PERIODS.map((p) => e.name.replace('<period>', p)) : [e.name])
    .map((value) => h('option', { value })));
  paint($('#eventChips'), events(s), (es) => es.map((e) =>
    h('button', { class: 'chip game', 'data-k': 'e:' + e.name, title: (e.doc ?? '') + (e.value ? ` · 값: ${e.value}` : ''), onclick: () => fireOrFill(e.name) }, e.name)));
  paint($('#trigTable tbody'), s.triggers ?? [], (ts) => ts.length ? ts.map((t) => h('tr', { class: t.ready ? 'ready' : '' },
    h('td', {}, h('span', { class: 'dot ' + (t.ready ? 'on' : 'idle'), title: t.ready ? '받을 수 있음' : '쉬는 중 / 조건 안 맞음' }), t.knot),
    h('td', {}, (t.on ?? []).map((ev) => h('button', { class: 'chip game', 'data-k': `t:${t.knot}:${ev}`, title: '이 이벤트 발사 (값은 위 칸)', onclick: () => fireOrFill(ev) }, ev))),
    h('td', { class: 'cond' }, [t.once && '한 번', t.cooldown && `쿨다운 ${t.cooldown}s`, t.chance != null && t.chance < 1 && `확률 ${t.chance}`,
      t.priority && `우선 ${t.priority}`, t.when && `when ${t.when}()`].filter(Boolean).join(' · ')),
    h('td', { class: 'num' }, clock(t.last)),
    h('td', {}, h('button', { class: 'game small', 'data-k': 'tp:' + t.knot, title: '조건을 무시하고 바로 재생', onclick: () => act('story.play', { path: t.knot }, `재생: ${t.knot}`) }, '재생'))))
    : h('tr', {}, h('td', { colspan: 5, class: 'muted' }, '트리거 노트 없음 (노트 맨 위에 # on: 이벤트)')));
}
$('#fireForm').onsubmit = (e) => { e.preventDefault(); fire($('#fireEvent').value.trim()); };

// --- 연출 -------------------------------------------------------------------------------------------------------
const CATALOG = { expr: 'expressions', react: 'reactions', motion: 'motions', hands: 'hands', map: 'maps', set: 'params', cmd: 'commands', fx: 'fx' };
const SUFFIX = { set: '=', cmd: ' ' };
const commands = (s) => rows(s?.schema?.commands);
// arg values for a command: the game's catalog, else the alternatives in its usage string ('<you|away|...>')
function argValues(name, c, s) {
  const cat = CATALOG[name] && s?.catalog?.[CATALOG[name]];
  if (cat) return rows(cat).map((x) => nm(x) + (SUFFIX[name] ?? ''));
  const usage = c?.args ?? '';
  return usage.includes('|') ? [...new Set(usage.replace(/[<>[\]]/g, ' ').split(/[\s|]+/).filter((w) => w && !w.includes('=')))] : [];
}
function suggest() {
  const v = $('#runTag').value.replace(/^#/, ''), i = v.indexOf(':'), name = (i < 0 ? v : v.slice(0, i)).trim(), cs = commands(shown);
  const c = cs.find((x) => x.name === name);
  const opts = i < 0 ? cs.map((x) => [x.name + (x.args ? ':' : ''), x.doc]) : argValues(name, c, shown).map((a) => [`${name}:${a}`, '']);
  paint($('#tagList'), opts, (os) => os.map(([value, label]) => h('option', { value }, label)));
  $('#runDoc').textContent = c ? `#${c.name}${c.args ? ':' + c.args : ''} — ${c.doc ?? ''}${c.block ? ' (끝날 때까지 기다림)' : ''}` : '';
}
const runTag = (tag) => act('story.run', { tag }, `#${tag}`);
function fx(s) {
  suggest();
  const cat = s.catalog ?? {};
  paint($('#quick'), [cat.expressions, cat.reactions, cat.motions, cat.fx], ([ex, re, mo, em]) => [['표정', 'expr', ex], ['반응', 'react', re], ['모션', 'motion', mo], ['이모트', 'fx', em]]
    .filter(([, , xs]) => rows(xs).length).map(([title, cmd, xs]) => [h('h3', {}, title), h('div', { class: 'chips' }, rows(xs).map((x) =>
      h('button', { class: 'chip game', 'data-k': `q:${cmd}:${nm(x)}`, title: x.label ?? x.doc ?? `#${cmd}:${nm(x)}`, onclick: () => runTag(`${cmd}:${nm(x)}`) }, nm(x))))]));
  paint($('#cmdTable tbody'), commands(s), (cs) => cs.map((c) => h('tr', {},
    h('td', {}, h('button', { class: 'chip', 'data-k': 'k:' + c.name, onclick: () => { $('#runTag').value = c.name + (c.args ? ':' : ''); $('#runTag').focus(); suggest(); } }, '#' + c.name)),
    h('td', { class: 'mono' }, c.args ?? ''), h('td', {}, c.doc ?? '', c.block ? h('small', { class: 'muted' }, ' · 기다림') : ''))));
}
$('#runTag').oninput = suggest;
$('#runForm').onsubmit = (e) => { e.preventDefault(); const t = $('#runTag').value.trim().replace(/^#/, ''); runTag(t); $('#runTag').select(); };
$('#sayForm').onsubmit = (e) => {
  e.preventDefault();
  const text = $('#sayText').value.trim(), voice = $('#sayVoice').value || undefined, style = $('#sayStyle').value || undefined;
  act('story.say', { text, voice, style }, `말함: ${text}`);
};

// --- 세이브 (the server's slots through /api/save, so export / import / delete work without the game) ------------
const SLOT = /^[\w-]{1,32}$/;
let slotList = [];
async function http(method, url, body) {
  const r = await fetch(url, { method, body, headers: body ? { 'Content-Type': 'application/json' } : {} }).catch(() => { throw new Error(CONN.server); });
  if (r.status === 404 && url === '/api/save') throw new Error('서버에 /api/save가 없음 (서버를 다시 시작)');
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r;
}
async function slots() {
  try { slotList = (await (await http('GET', '/api/save')).json()).slots ?? []; }
  catch (e) { slotList = []; paint($('#slotTable tbody'), e.message, (m) => h('tr', {}, h('td', { class: 'bad' }, m))); return; }
  slotList.sort((a, b) => (a.slot === 'global') - (b.slot === 'global') || (date(b.time) ?? 0) - (date(a.time) ?? 0));
  paint($('#slotTable tbody'), slotList, (ss) => ss.length ? ss.map((x) => h('tr', {},
    h('td', {}, x.thumb ? h('img', { class: 'thumb', src: x.thumb, alt: '' }) : ''),
    h('td', {}, h('b', {}, x.slot), x.slot === 'global' ? h('div', { class: 'muted' }, '전역: 읽은 대사, 추억, 설정') : x.label && h('div', {}, x.label), h('div', { class: 'muted' }, stamp(x.time))),
    h('td', { class: 'acts' },
      x.slot !== 'global' && h('button', { class: 'game small', 'data-k': 'l:' + x.slot, onclick: () => act('story.load', { slot: x.slot }, `불러옴: ${x.slot}`) }, '불러오기'),
      h('button', { class: 'small', 'data-k': 'x:' + x.slot, onclick: () => exportSlot(x.slot) }, '내보내기'),
      h('button', { class: 'small bad', 'data-k': 'd:' + x.slot, onclick: () => removeSlot(x.slot) }, '삭제'))))
    : h('tr', {}, h('td', { class: 'muted' }, '세이브 없음')));
}
async function exportSlot(slot) {
  try {
    const blob = await (await http('GET', `/api/save/${encodeURIComponent(slot)}`)).blob();
    const a = h('a', { href: URL.createObjectURL(blob), download: `ph-save-${slot}.json` });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { note(`내보내기: ${e.message}`, true); }
}
async function removeSlot(slot) {
  if (!confirm(`세이브 '${slot}'을(를) 지울까?${slot === 'global' ? ' (읽은 대사와 추억이 모두 사라짐)' : ''}`)) return;
  try { await http('DELETE', `/api/save/${encodeURIComponent(slot)}`); note(`지움: ${slot}`); } catch (e) { note(`삭제: ${e.message}`, true); }
  slots();
}
async function importFiles(files) {
  for (const f of files) {
    try {
      const obj = JSON.parse(await f.text());
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('세이브 JSON이 아님');
      const guess = f.name.replace(/\.json$/i, '').replace(/^ph-save-/, '').replace(/[^\w-]/g, '_').slice(0, 32);
      const slot = prompt(`'${f.name}'을(를) 어느 슬롯에 넣을까?`, guess)?.trim();
      if (!slot) continue;
      if (!SLOT.test(slot)) throw new Error('슬롯 이름은 영문, 숫자, _ - 32자까지');
      if (slotList.some((x) => x.slot === slot) && !confirm(`'${slot}'을(를) 덮어쓸까?`)) continue;
      await http('PUT', `/api/save/${encodeURIComponent(slot)}`, JSON.stringify(obj));
      note(`가져옴: ${slot}`);
    } catch (e) { note(`${f.name}: ${e.message}`, true); }
  }
  slots();
}
function save(s) {
  paint($('#memList'), rows(s.memories), (ms) => ms.length ? ms.map((m) => h('div', { class: 'mem' },
    m.thumb ? h('img', { class: 'thumb', src: m.thumb, alt: '' }) : h('span', { class: 'thumb' }),
    h('div', {}, h('b', {}, m.title ?? m.id), h('div', { class: 'muted' }, `${m.id} · @${m.knot ?? '?'} · ${stamp(m.time)}`)),
    h('button', { class: 'game small', 'data-k': 'm:' + m.id, onclick: () => act('story.replay', { id: m.id }, `추억 재생: ${m.title ?? m.id}`) }, '다시 보기')))
    : h('p', { class: 'muted' }, '열린 추억 없음 (#memory:id 제목)'));
}
$('#saveForm').onsubmit = async (e) => {
  e.preventDefault();
  const slot = $('#saveSlot').value.trim();
  if (!SLOT.test(slot) || slot === 'global') return note('슬롯 이름은 영문, 숫자, _ - 32자까지 (global은 예약됨)', true);
  await act('story.save', { slot }, `저장: ${slot}`); slots();
};
$('#slotsRefresh').onclick = slots;
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = (e) => { importFiles([...e.target.files]); e.target.value = ''; };

// --- 로그 -------------------------------------------------------------------------------------------------------
const SUMMARY = {
  mode: (e) => `→ ${MODE[e.mode] ?? e.mode}`,
  line: ({ line: l }) => `${l.speaker ? l.speaker + ': ' : ''}${l.text}${l.subs?.ko ? '   / ' + l.subs.ko : ''}`,
  choices: (e) => rows(e.choices).map((c, i) => `${i + 1}) ${c.text}`).join('   '),
  chose: (e) => `${(e.index ?? 0) + 1}) ${e.text ?? ''}${e.by ? ` (${e.by})` : ''}`,
  direction: (e) => '#' + (e.tag?.raw ?? e.tag?.name ?? e.tag),
  var: (e) => `${e.name} = ${fmt(e.value)}`,
  trigger: (e) => `${e.knot} ← ${e.event}${e.value ? ' ' + fmt(e.value) : ''}`,
  event: (e) => `${e.event}${e.value ? ' ' + fmt(e.value) : ''} → ${e.handled ? '처리됨' : '받는 곳 없음'}`,
  error: (e) => e.message,
  save: (e) => e.slot, load: (e) => e.slot,
  reload: (e) => `오류 ${count(e.errors)} · 경고 ${count(e.warnings)}`,
  memory: (e) => `${e.id} ${e.title ?? ''}`,
};
const hiddenTypes = new Set(pref('logOff', []));
const knownTypes = new Set();
let unseenErrors = 0;
function typeChip(type) {
  if (knownTypes.has(type)) return;
  knownTypes.add(type);
  const b = h('button', { class: 'chip ' + type, 'aria-pressed': String(!hiddenTypes.has(type)), title: '이 종류 보이기 / 숨기기' }, type);
  b.onclick = () => {
    hiddenTypes.has(type) ? hiddenTypes.delete(type) : hiddenTypes.add(type);
    b.setAttribute('aria-pressed', String(!hiddenTypes.has(type))); keep('logOff', [...hiddenTypes]); filterLog();
  };
  $('#logTypes').append(b);
}
Object.keys(SUMMARY).forEach(typeChip);
const logQuery = () => $('#logFilter').value.trim().toLowerCase();
const showRow = (row, q) => { row.hidden = hiddenTypes.has(row.dataset.type) || (!!q && !row.textContent.toLowerCase().includes(q)); };
function filterLog() { const q = logQuery(); for (const r of $('#logList').children) showRow(r, q); }
// e = a story.log event, null = a separator (the game page reloaded)
function logRow(e) {
  const list = $('#logList'), atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 24;
  let row;
  if (!e) row = h('div', { class: 'sep', 'data-type': '' }, '— 게임 페이지가 다시 열림 —');
  else {
    typeChip(e.type);
    let text; try { text = SUMMARY[e.type]?.(e) ?? fmt(e); } catch { text = fmt(e); }
    row = h('details', { class: 'ev ' + e.type, 'data-type': e.type },
      h('summary', {}, h('time', {}, clock(e.t)), h('i', {}, e.type), h('span', {}, text)));
    row.ontoggle = () => { if (row.open && !row.querySelector('pre')) row.append(h('pre', {}, JSON.stringify(e, null, 1))); };
    if (e.type === 'error' && tab !== 'log') { unseenErrors++; badge(); }
    if ((e.type === 'save' || e.type === 'load') && tab === 'save') slots();
  }
  showRow(row, logQuery());
  list.append(row);
  while (list.childElementCount > 2000) list.firstElementChild.remove();
  if (atEnd) list.scrollTop = list.scrollHeight;
}
function badge() { const b = $('#t-log .badge'); b.hidden = !unseenErrors; b.textContent = unseenErrors; }
$('#logFilter').oninput = filterLog;
$('#logClear').onclick = () => $('#logList').replaceChildren();

// --- tabs and keys ----------------------------------------------------------------------------------------------
const TABS = { run, vars, trig, fx, save, log() {} };
const tabButtons = [...document.querySelectorAll('#tabs [role=tab]')];
let tab = TABS[pref('tab', 'run')] ? pref('tab', 'run') : 'run';
function open(name, focus = false) {
  tab = name; keep('tab', name);
  for (const b of tabButtons) {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
    $('#tab-' + b.dataset.tab).hidden = !on;
    if (on && focus) b.focus();
  }
  if (name === 'log') { unseenErrors = 0; badge(); }
  if (name === 'save') slots();
  if (shown) TABS[name](shown);
}
for (const b of tabButtons) b.onclick = () => open(b.dataset.tab);
$('#tabs').onkeydown = (e) => { // the ARIA tabs pattern: arrows move between tabs
  const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (!d) return;
  const i = tabButtons.findIndex((b) => b.dataset.tab === tab);
  open(tabButtons[(i + d + tabButtons.length) % tabButtons.length].dataset.tab, true); e.preventDefault();
};
const typing = (t) => t.closest?.('input, textarea, select, [contenteditable], #editor');
addEventListener('keydown', (e) => {
  if (e.altKey && /^Digit[1-6]$/.test(e.code)) { open(tabButtons[e.code.slice(5) - 1].dataset.tab, true); e.preventDefault(); }
  else if (e.key === 'F8') { e.shiftKey ? act('story.stop', {}, '장면 중지') : act('story.advance', {}, '다음'); e.preventDefault(); }
  else if (tab === 'run' && /^[1-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey && !typing(e.target)) {
    const c = shown?.choices?.[e.key - 1];
    if (c) { choose(c, e.key - 1); e.preventDefault(); }
  }
});
open(tab);

// --- polling (started last: everything it renders is defined by now) ---------------------------------------------
const statePoll = every(1000, async () => {
  try { const s = await call('story.state', {}, { timeout: 5 }); setConn('on'); publish(s); }
  catch (e) {
    if (!('status' in e)) console.error(e); // a bug of ours while rendering, not the connection
    else if (e.status === 504) setConn('slow');
    else if (e.status && e.status !== 503) setConn('err', e.message);
  }
});
let since = 0;
const logPoll = every(500, async () => {
  if (conn !== 'on') return;
  const r = await call('story.log', { since }, { timeout: 5 });
  if (r.seq < since) { since = 0; logRow(null); return logPoll.now(); } // the game page reloaded: its counter restarted
  for (const e of r.events ?? []) if (e.seq > since) logRow(e);
  since = Math.max(since, r.seq ?? 0);
});

// --- the editor and the page API ---------------------------------------------------------------------------------
// window.dev.onState(fn): fn(state | null) on every change; null = the game went away. Returns an unsubscribe.
window.dev = { call, get state() { return state; }, onState(fn) { subs.add(fn); return () => subs.delete(fn); } };
// imported dynamically so a broken or missing editor leaves the live tabs working
import('./editor.js').then(({ mountEditor }) => mountEditor($('#editor'), { call, getState: () => state })).catch((e) => {
  console.error(e);
  $('#editor').replaceChildren(h('p', { class: 'muted pad' }, `편집기를 불러오지 못함: ${e.message}`));
});
