// Story editor for tools/dev.html: the .ink files under story/ in CodeMirror 5 with an ink mode, compiled in-page on
// every edit by src/story/Script.js (the same compiler and lint the game runs, so what's red here is red in the game),
// plus lint, fuzz coverage, voice baking and a knot graph. Live hooks into the open game go over the bridge (`call`):
// Ctrl+S saves then story.reload, 여기서 재생 -> story.play, Ctrl+click a line -> story.say. Without a game page all of
// that fails quietly and the editing still works.
import { compile, lint, fuzz, fetchSources, triggersOf, speakersOf, parseLine, COMMANDS } from '../src/story/Script.js';

const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.18/';   // CM5 is a UMD global: injected, not imported
const ENTRY = 'main.ink';
const NAME = /^[\w-]+(\/[\w-]+)*\.ink$/;   // the server's rule for PUT /api/story/<name>
const META = new Set(['on', 'once', 'cooldown', 'chance', 'priority', 'when', 'speaker', 'player', 'yomi', 'style', 'auto', 'timer', 'voice', 'nod', 'shake', 'default']);
const HEAD = /^\s*={2,}\s*(function\s+)?(\w+)/, STITCH = /^\s*=\s*(\w+)/;

// Comments blanked, newlines kept, so every index still points at the editor's line.
export const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ''));

// Knots and stitches (functions left out) with the diverts / threads between them, from source rather than the compiled
// story so the graph still draws while the script doesn't compile. Line numbers are 1-based like Issue.line.
export function scanInk(files, entry = ENTRY) {
  const nodes = [], by = new Map(), knots = new Map(), raw = [];
  const add = (id, o) => { const n = { id, edges: new Set(), ...o }; nodes.push(n); by.set(id, n); return n; };
  add('', { kind: 'root', label: '(시작)', file: entry, line: 1 });
  const order = [entry, ...Object.keys(files).filter((f) => f !== entry).sort()].filter((f) => f in files);
  for (const file of order) {
    let knot = null, from = '', bare = false, stitched = false;
    stripComments(files[file]).split('\n').forEach((text, i) => {
      let m;
      if ((m = text.match(HEAD))) {
        knot = m[2]; from = m[1] ? null : knot; bare = true; stitched = false;
        if (from) { add(knot, { kind: 'knot', label: knot, file, line: i + 1 }); knots.set(knot, new Set()); }
        return;
      }
      if (from === null) return;   // inside a function: its diverts aren't story flow
      if (knot && (m = text.match(STITCH))) {
        from = `${knot}.${m[1]}`; add(from, { kind: 'stitch', label: from, file, line: i + 1 }); knots.get(knot).add(m[1]);
        // a knot with nothing of its own before its first stitch falls straight into it
        if (!stitched && bare) raw.push({ from: knot, target: m[1], knot });
        stitched = true; return;
      }
      if (/\S/.test(text) && !/^\s*#/.test(text)) bare = false;
      for (const d of text.matchAll(/(?:->|<-)\s*([A-Za-z_][\w.]*)/g)) raw.push({ from, target: d[1], knot });
    });
  }
  const resolve = (t, knot) => {
    const [a, b] = t.split('.');
    if (knots.has(a)) return b && knots.get(a).has(b) ? `${a}.${b}` : a;
    if (knot && knots.get(knot)?.has(a)) return `${knot}.${a}`;
    return null;   // DONE / END, labels, divert variables, functions
  };
  for (const r of raw) { const to = resolve(r.target, r.knot); if (to !== null && to !== r.from) by.get(r.from)?.edges.add(to); }
  return nodes;
}

// The flow the cursor is in: 'knot' | 'knot.stitch', '' at the root, null inside a function.
export function flowAt(src, line /*0-based*/) {
  let knot = '', stitch = '', fn = false;
  const ls = stripComments(src).split('\n');
  for (let i = 0; i <= line && i < ls.length; i++) {
    let m;
    if ((m = ls[i].match(HEAD))) { knot = m[2]; stitch = ''; fn = !!m[1]; } else if (knot && (m = ls[i].match(STITCH))) stitch = m[1];
  }
  return fn ? null : stitch ? `${knot}.${stitch}` : knot;
}

// Columns = BFS distance from the entry points (root flow, trigger knots, nodes nothing leads to); a cycle with no way
// in seeds its own BFS. Rows: one barycentre pass so a node sits near what leads into it.
export function layout(nodes) {
  const by = new Map(nodes.map((n) => [n.id, n])), into = new Map(nodes.map((n) => [n.id, []])), col = new Map(), row = new Map();
  for (const n of nodes) for (const t of n.edges) into.get(t)?.push(n.id);
  const bfs = (q) => {
    for (const n of q) col.set(n.id, 0);
    for (let i = 0; i < q.length; i++) for (const t of q[i].edges) if (!col.has(t) && by.has(t)) { col.set(t, col.get(q[i].id) + 1); q.push(by.get(t)); }
  };
  bfs(nodes.filter((n) => n.id === '' || n.on?.length || !into.get(n.id).length));
  for (const n of nodes) if (!col.has(n.id)) bfs([n]);
  const cols = [];
  for (const n of nodes) (cols[col.get(n.id)] ??= []).push(n);
  cols.forEach((c, ci) => {
    const key = new Map(c.map((n, i) => {
      const ps = into.get(n.id).filter((p) => col.get(p) < ci && row.has(p));
      return [n.id, ps.length ? ps.reduce((s, p) => s + row.get(p), 0) / ps.length : i];
    }));
    c.sort((a, b) => key.get(a.id) - key.get(b.id)).forEach((n, r) => row.set(n.id, r));
  });
  return new Map(nodes.map((n) => [n.id, { col: col.get(n.id), row: row.get(n.id) }]));
}

// A source line roughly as Ink would print it (diverts, inline logic, glue, choice-only [..] text and markers out) and
// its tags, so Ctrl+click can voice the line without running the story.
export function sourceLine(src) {
  const [body, ...tags] = src.replace(/\/\/.*$/, '').split('#');
  const text = body.replace(/(?:->|<-)\s*[\w.]*/g, '').replace(/\{[^{}]*\}/g, '').replace(/<>/g, '').replace(/\[[^\]]*\]/g, '')
    .replace(/^\s*([*+-]\s*)*(\(\w+\)\s*)?/, '').trim();
  return { text, tags: tags.map((t) => t.trim()).filter(Boolean) };
}

// CodeMirror mode: knots / stitches / functions, choices and gathers with labels, diverts, glue, `~` logic and inline
// {}, tags (an unknown tag name is underlined: lint says why), comments and a leading `Name:` speaker.
export function inkMode(commands = COMMANDS) {
  const known = (n) => Object.hasOwn(commands, n) || META.has(n) || /^[a-z]{2}$/.test(n);
  return {
    startState: () => ({ comment: false, head: true, tag: false, logic: false }),
    copyState: (s) => ({ ...s }),
    token(st, s) {
      if (st.sol()) { s.head = true; s.tag = false; s.logic = false; }
      if (s.comment) { if (st.skipTo('*/')) { st.pos += 2; s.comment = false; } else st.skipToEnd(); return 'comment'; }
      if (st.match('/*')) { s.comment = true; return 'comment'; }
      if (st.match('//')) { st.skipToEnd(); return 'comment'; }
      if (st.sol()) {
        if (st.match(/^\s*={2,}\s*function\b.*/)) return 'ink-knot ink-fn';
        if (st.match(/^\s*={2,}.*/)) return 'ink-knot';
        if (st.match(/^\s*=\s*\w.*/)) return 'ink-stitch';
        if (st.match(/^\s*(INCLUDE|VAR|CONST|EXTERNAL|LIST|TEMP)\b/)) { s.logic = true; s.head = false; return 'keyword'; }
        if (st.match(/^\s*~/)) { s.logic = true; s.head = false; return 'ink-logic'; }
      }
      if (st.peek() === '#') { s.tag = true; s.head = false; const m = st.match(/^#\s*([^\s:#]*)/); return `ink-tag ${!m[1] || known(m[1]) ? 'ink-tagname' : 'ink-tagbad'}`; }
      if (s.tag) { if (!st.match(/^(?:[^#/]|\/(?!\/))+/)) st.next(); return 'ink-tag'; }
      if (s.logic) { if (!st.match(/^(?:[^/]|\/(?!\/))+/)) st.next(); return 'ink-logic'; }
      if (s.head) {
        if (st.eatSpace()) return null;
        if (st.match(/^([*+]\s*)+/)) return 'ink-choice';
        if (st.match(/^(-(?!>)\s*)+/)) return 'ink-gather';
        if (st.match(/^\(\w+\)/)) return 'ink-label';
        s.head = false;
        if (st.match(/^(?!else\s*[:：])[^\s:：#{}[\]()<>~*+=/|-]{1,24}\s*[:：]/)) return 'ink-speaker';
      }
      if (st.match('->->') || st.match(/^(->|<-)\s*[\w.]*/)) return 'ink-divert';
      if (st.match('<>')) return 'ink-glue';
      if (st.peek() === '{') {   // the whole inline {..} on this line; a multi-line block's head line runs to the end
        let d = 0, i = st.pos;
        for (; i < st.string.length; i++) if (st.string[i] === '{') d++; else if (st.string[i] === '}' && !--d) break;
        st.pos = Math.min(i + 1, st.string.length); return 'ink-logic';
      }
      if (st.eat('}')) return 'ink-logic';
      if (st.eat('[') || st.eat(']')) return 'ink-bracket';
      if (!st.match(/^[^-<#{}/[\]]+/)) st.next();
      return null;
    },
  };
}

const tag = (t, a) => new Promise((ok, no) => document.head.append(Object.assign(document.createElement(t), a,
  { onload: ok, onerror: () => no(new Error(`${a.src ?? a.href} 를 못 불러왔어요`)) })));
async function loadCM() {
  if (!window.CodeMirror) {
    const css = ['codemirror.min.css', 'addon/dialog/dialog.min.css'].map((p) => tag('link', { rel: 'stylesheet', href: CDN + p }));
    // dev.html links editor.css itself; elsewhere bring it, after CM's so ours wins
    if (!document.querySelector('link[href$="editor.css"]')) css.push(tag('link', { rel: 'stylesheet', href: new URL('./editor.css', import.meta.url).href }));
    await tag('script', { src: CDN + 'codemirror.min.js' });
    // Ctrl+F / Ctrl+G / Alt+G: a writer needs find more than anything else CM leaves out
    await Promise.all([...css, ...['addon/search/searchcursor.min.js', 'addon/dialog/dialog.min.js', 'addon/search/search.min.js', 'addon/search/jump-to-line.min.js'].map((p) => tag('script', { src: CDN + p }))]);
  }
  window.CodeMirror.defineMode('ink', () => inkMode());   // not inkMode itself: CM passes its config as the first argument
  return window.CodeMirror;
}

const h = (t, props = {}, ...kids) => { const el = Object.assign(document.createElement(t), props); el.append(...kids); return el; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const enc = (name) => name.split('/').map(encodeURIComponent).join('/');
const ok = async (p) => { const r = await p; if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`); return r; };
const RANK = { error: 0, warning: 1, info: 2 };

export function mountEditor(root, { call, getState = () => null }) {
  // one wrapper inside root: the page owns root's own box (dev.css sizes #editor)
  root.innerHTML = `<div class="ed"><div class="ed-files"><ul></ul><button type="button" class="ed-new" title="story/ 아래에 새 .ink 파일">+ 새 파일</button></div>
<div class="ed-main">
<div class="ed-bar"><b class="ed-name"></b><span class="ed-msg" role="status" aria-live="polite"></span>
<button type="button" data-a="save" title="바뀐 파일을 모두 서버에 저장하고 게임에 다시 불러온다 (Ctrl+S)">저장</button>
<button type="button" data-a="play" title="커서가 있는 노트(스티치)를 게임에서 재생. 저장 안 한 내용도 먼저 게임에 보낸다">여기서 재생</button>
<button type="button" data-a="lint" title="연출 태그, 이벤트, 화자, 자막, 쓰이지 않는 노트 검사 (게임이 열려 있으면 표정/모션 이름까지)">검사</button>
<label title="무작위 플레이 횟수">퍼즈 <input class="ed-runs" type="number" value="200" min="1" max="5000" step="50"></label>
<button type="button" data-a="fuzz" title="무작위 플레이로 커버리지, 못 간 노트, 런타임 오류 찾기">퍼즈</button>
<button type="button" data-a="bake" title="퍼즈에서 나온 목소리 대사를 미리 합성해 캐시에 넣는다">목소리 굽기</button></div>
<div class="ed-cm"></div>
<div class="ed-out"><nav class="ed-tabs"><button type="button" data-t="issues">문제</button><button type="button" data-t="fuzz">퍼즈</button><button type="button" data-t="graph">그래프</button><button type="button" data-t="bake">굽기</button></nav>
<div class="ed-pane" data-p="issues"><ul class="ed-list"></ul></div>
<div class="ed-pane" data-p="fuzz"><p class="ed-hint">퍼즈를 돌리면 여기에 결과가 나온다.</p></div>
<div class="ed-pane" data-p="graph"></div>
<div class="ed-pane" data-p="bake"><div class="ed-row"><progress value="0" max="1"></progress><span class="ed-prog">아직 안 구웠다.</span><button type="button" class="ed-cancel" disabled>취소</button></div><ul class="ed-list"></ul></div>
</div></div></div>`;
  const $ = (s) => root.querySelector(s), pane = (p) => $(`[data-p="${p}"]`);
  const bufs = new Map();   // name -> { doc, gen }: a CodeMirror Doc per file keeps each file's own undo history
  let CM, cm, cur = null, built = null, good = null, issues = [], fz = null, baking = null, timer = 0, tab = 'issues', graphKey = '';

  const msg = (text, bad = false) => { const el = $('.ed-msg'); el.textContent = text; el.classList.toggle('bad', bad); };
  const dirty = (b) => !b.doc.isClean(b.gen);
  const sources = () => Object.fromEntries([...bufs].map(([n, b]) => [n, b.doc.getValue()]));
  const add = (name, text, fresh = false) => { const doc = new CM.Doc(text, 'ink'); bufs.set(name, { doc, gen: fresh ? -1 : doc.changeGeneration() }); };
  const where = (knot) => scanInk(sources()).find((n) => n.id === knot);
  const jump = (knot) => { const n = where(knot); if (n) open(n.file, n.line); else msg(`'${knot}' 노트를 못 찾았어요`, true); };
  const live = async (cmd, args = {}) => { try { return await call(cmd, args); } catch (e) { msg(`게임에 못 보냈어요 (${e.message}) — 게임 페이지가 열려 있나요?`, true); throw e; } };

  function files() {
    const errs = new Map();
    for (const i of issues) if (i.severity === 'error') errs.set(i.file || ENTRY, (errs.get(i.file || ENTRY) ?? 0) + 1);
    const names = [...bufs.keys()].sort((a, b) => (b === ENTRY) - (a === ENTRY) || a.localeCompare(b));
    $('.ed-files ul').replaceChildren(...names.map((n) => h('li', { className: n === cur ? 'on' : '', title: n, onclick: () => open(n) },
      h('span', { textContent: n }), dirty(bufs.get(n)) ? h('i', { className: 'ed-dirty', textContent: '●', title: '저장 안 함' }) : '',
      errs.get(n) ? h('i', { className: 'ed-errs', textContent: errs.get(n), title: '컴파일/검사 오류' }) : '')));
    const b = bufs.get(cur);
    $('.ed-name').textContent = cur ? cur + (b && dirty(b) ? ' ●' : '') : '';
  }

  function open(name = ENTRY, line = 0) {
    if (!cm || !bufs.has(name)) return;
    if (cur !== name) { cur = name; cm.swapDoc(bufs.get(name).doc); files(); mark(); }
    if (line > 0) { cm.setCursor(line - 1, 0); cm.scrollIntoView(null, 120); }
    cm.focus();
  }

  function mark() {
    cm.clearGutter('ed-gut');
    const at = new Map();
    for (const i of issues) if ((i.file || ENTRY) === cur && i.line > 0) (at.get(i.line) ?? at.set(i.line, []).get(i.line)).push(i);
    for (const [line, list] of at) {
      const worst = list.reduce((a, b) => (RANK[b.severity] < RANK[a.severity] ? b : a));
      cm.setGutterMarker(line - 1, 'ed-gut', h('span', { className: `ed-mark ed-${worst.severity}`, textContent: '●', title: list.map((i) => i.message).join('\n') }));
    }
  }

  function setIssues(list) {
    issues = list.slice().sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.file || '').localeCompare(b.file || '') || a.line - b.line);
    const n = (s) => issues.filter((i) => i.severity === s).length;
    pane('issues').firstChild.replaceChildren(...(issues.length ? issues.map((i) => h('li', { className: `ed-${i.severity}`, title: i.code ?? '', onclick: () => open(i.file || ENTRY, i.line) },
      h('span', { className: 'ed-at', textContent: `${i.file || ENTRY}:${i.line}` }), ` ${i.message}`)) : [h('li', { className: 'ed-hint', textContent: '문제 없음' })]));
    $('[data-t="issues"]').textContent = ['문제', ...[['오류', 'error'], ['경고', 'warning'], ['참고', 'info']].filter(([, s]) => n(s)).map(([l, s]) => `${l} ${n(s)}`)].join(' ');
    files(); mark();
  }

  function rebuild() {
    try { built = compile(sources(), ENTRY); } catch (e) { built = { errors: [{ file: ENTRY, line: 0, message: String(e?.message ?? e), severity: 'error' }], warnings: [] }; }
    if (built.story) good = built;
    setIssues([...built.errors, ...built.warnings]);
    if (tab === 'graph') drawGraph();
  }

  async function save() {
    const todo = [...bufs].filter(([, b]) => dirty(b));
    if (!todo.length) return msg('바뀐 게 없어요');
    try {
      for (const [name, b] of todo) {
        const gen = b.doc.changeGeneration(), body = b.doc.getValue();   // edits typed while the PUT is out stay dirty
        await ok(fetch('/api/story/' + enc(name), { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body }));
        b.gen = gen;
      }
    } catch (e) { files(); return msg(`저장 실패: ${e.message}`, true); }
    files();
    try {
      const r = await call('story.reload', {});
      msg(`저장함 · 게임에 다시 불러옴${r?.errors?.length ? ` — 게임 쪽 오류 ${r.errors.length}개` : ''}`, !!r?.errors?.length);
    } catch (e) {   // 503 / no server: no game page open, saving was the point
      if (!e.status || e.status === 503) msg(`저장함 (${todo.length}개 파일, 게임 연결 없음)`);
      else msg(`저장함 · 게임에 다시 불러오기 실패: ${e.message}`, true);
    }
  }

  async function playHere() {
    const path = flowAt(cm.getValue(), cm.getCursor().line);
    if (path === null) return msg('함수 안에서는 재생할 수 없어요', true);
    if (!path) return msg('노트(=== 이름 ===) 안에 커서를 두세요', true);
    try {
      // the game plays what's on screen, saved or not; a later save reloads it from disk anyway
      if ([...bufs.values()].some(dirty)) {
        const r = await live('story.reload', { files: sources() });
        if (r?.errors?.length) return msg(`게임 컴파일 오류 ${r.errors.length}개 — 문제 목록을 보세요`, true);
      }
      await live('story.play', { path });
      msg(`게임에서 ${path} 재생`);
    } catch { /* live() said why */ }
  }

  async function sayLine(n) {
    const { text, tags } = sourceLine(cm.getLine(n) ?? '');
    if (!text) return msg('대사가 없는 줄이에요', true);
    const line = parseLine(text, tags, { speakers: speakersOf(good?.story?.globalTags ?? []), knot: (flowAt(cm.getValue(), n) ?? '').split('.')[0] });
    if (!line.voice) return msg('목소리가 없는 줄이에요 (나레이션 / 내 대사 / #voice:off)', true);
    try { await live('story.say', { text: line.say, voice: line.voice, ...(line.style ? { style: line.style } : {}) }); msg(`말하기: ${line.say}`); } catch { /* reported */ }
  }

  function check() {
    const st = getState();
    let list;
    try { list = lint(sources(), { story: built?.story ?? undefined, catalog: st?.catalog }); } catch (e) { return msg(`검사 실패: ${e.message}`, true); }
    setIssues(list); show('issues');
    msg(`검사 끝 — ${list.length ? `${list.length}건` : '문제 없음'}${st?.catalog ? ' (게임 목록 포함)' : ' (게임 연결 없음: 표정/모션 이름은 안 봄)'}`);
  }

  async function runFuzz() {
    rebuild();
    if (!built.story) { show('issues'); msg('컴파일 오류부터 고쳐 주세요', true); return null; }
    const runs = Math.max(1, Math.min(5000, Math.round(+$('.ed-runs').value) || 200));
    msg(`퍼즈 ${runs}회 도는 중…`);
    await new Promise((r) => setTimeout(r, 30));   // fuzz is synchronous: let the message paint first
    fz = { ...fuzz(built.json, { runs }), json: built.json };
    const all = fz.knots, miss = new Set(fz.unvisited), pct = Math.round(100 * fz.coverage);
    const chip = (k) => h('button', { type: 'button', className: 'ed-chip', textContent: k, onclick: () => jump(k) });
    pane('fuzz').replaceChildren(
      h('p', { className: 'ed-sum' }, h('b', { textContent: `커버리지 ${pct}%` }), ` (${all.length - miss.size}/${all.length} 노트) · ${runs}회 · 대사 ${fz.lines.length} · 선택지 ${fz.choices}` +
        ` · 오류 ${fz.errors.length}${fz.capped ? ` · 스텝 한도에 걸린 판 ${fz.capped}` : ''}`),
      ...(miss.size ? [h('h4', { textContent: '한 번도 못 간 노트' }), h('div', { className: 'ed-chips' }, ...[...miss].map(chip))] : []),
      ...(fz.errors.length ? [h('h4', { textContent: '런타임 오류' }), h('ul', { className: 'ed-list' }, ...fz.errors.map((e) =>
        h('li', { className: 'ed-error', onclick: () => e.knot && jump(e.knot) }, h('span', { className: 'ed-at', textContent: `${e.knot || '(시작)'}${e.count > 1 ? ` ×${e.count}` : ''}` }), ` ${e.message}`)))] : []),
      h('h4', { textContent: '방문 횟수' }), h('div', { className: 'ed-chips' }, ...all.filter((k) => !miss.has(k)).sort((a, b) => fz.visits[b] - fz.visits[a]).map((k) => {
        const c = chip(k); c.append(h('small', { textContent: ` ${fz.visits[k]}` })); return c;
      })));
    show('fuzz');
    msg(`퍼즈 끝 — 커버리지 ${pct}%${fz.errors.length ? `, 오류 ${fz.errors.length}` : ''}`, !!fz.errors.length);
    return fz;
  }

  async function bake() {
    if (baking) return;
    const r = fz && fz.json === built?.json ? fz : await runFuzz();   // the lines of the script as it is now
    if (!r) return;
    const seen = new Set(), todo = r.lines.filter((l) => l.voice && l.say && !seen.has(`${l.voice}|${l.style}|${l.say}`) && seen.add(`${l.voice}|${l.style}|${l.say}`))
      .flatMap((l) => (l.voice === 'miku' && !l.style ? [l, { ...l, style: 'whisper' }] : [l])); // unstyled Miku whispers when you're at her face (ChatBar.say)
    const bar = pane('bake').querySelector('progress'), label = pane('bake').querySelector('.ed-prog'), list = pane('bake').querySelector('ul'), cancel = pane('bake').querySelector('.ed-cancel');
    show('bake'); list.replaceChildren(); bar.max = todo.length || 1; bar.value = 0;
    if (!todo.length) { label.textContent = '구울 목소리 대사가 없다 (퍼즈가 지나간 줄 기준).'; return; }
    baking = new AbortController(); cancel.disabled = false;
    let fails = 0, had = 0, i = 0;
    // one at a time: the synth is one local GPU/CPU process, parallel requests only queue behind each other
    for (; i < todo.length && !baking.signal.aborted; i++) {
      const l = todo[i];
      label.textContent = `${i + 1}/${todo.length} 굽는 중${fails ? ` · 실패 ${fails}` : ''} — ${l.say}`;
      try {
        const r = await ok(fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: baking.signal,
          body: JSON.stringify({ text: l.say, voice: l.voice, ...(l.style ? { style: l.style } : {}), cache: true }) }));
        if ((await r.json()).cached) had++;
      } catch (e) {
        if (baking.signal.aborted) break;
        fails++; list.append(h('li', { className: 'ed-error', title: '클릭 = 그 노트로', onclick: () => l.knot && jump(l.knot) }, h('span', { className: 'ed-at', textContent: l.knot || '(시작)' }), ` ${l.say} — ${e.message}`));
      }
      bar.value = i + 1;
    }
    label.textContent = `${baking.signal.aborted ? '취소함' : '끝'} — ${i}/${todo.length} (이미 있던 것 ${had})${fails ? `, 실패 ${fails}` : ''}`;
    baking = null; cancel.disabled = true;
  }

  function drawGraph() {
    const g = scanInk(sources()), by = new Map(g.map((n) => [n.id, n]));
    try { for (const t of good?.story ? triggersOf(good.story) : []) { const n = by.get(t.knot); if (n) n.on = [...(n.on ?? []), ...t.on]; } } catch { /* stale story: no badges */ }
    const st = getState(), seen = new Map((st?.knots ?? []).map((k) => [k.name, k.visits]));
    graphKey = JSON.stringify([st?.knot, st?.knots]);
    const pos = layout(g), W = 168, H = 38, GX = 64, GY = 14;
    const X = (id) => 12 + pos.get(id).col * (W + GX), Y = (id) => 12 + pos.get(id).row * (H + GY);
    let paths = '', boxes = '', w = 0, hgt = 0;
    for (const n of g) for (const t of n.edges) {
      const [ax, ay, bx, by_] = [X(n.id), Y(n.id), X(t), Y(t)];
      paths += pos.get(t).col > pos.get(n.id).col
        ? `<path d="M${ax + W} ${ay + H / 2}C${ax + W + GX / 2} ${ay + H / 2} ${bx - GX / 2} ${by_ + H / 2} ${bx} ${by_ + H / 2}"/>`
        // back / same-column edges (loops) swing under the boxes
        : `<path class="back" d="M${ax + W / 2} ${ay + H}C${ax + W / 2} ${ay + H + 34} ${bx + W / 2} ${by_ + H + 34} ${bx + W / 2} ${by_ + H}"/>`;
    }
    for (const n of g) {
      const x = X(n.id), y = Y(n.id), v = seen.get(n.id);
      w = Math.max(w, x + W + 12); hgt = Math.max(hgt, y + H + 48);
      const sub = [n.on?.length && `⚡ ${n.on.join(', ')}`, n.kind === 'stitch' && '스티치', v && `${v}회`].filter(Boolean).join(' · ');
      const cls = ['ed-n', n.kind, v > 0 && 'seen', st?.knot && st.knot === n.id && 'now', n.on?.length && 'trig'].filter(Boolean).join(' ');
      const label = n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label;
      boxes += `<g class="${cls}" data-id="${esc(n.id)}" transform="translate(${x} ${y})"><title>${esc(`${n.label}\n${n.file}:${n.line}${v ? `\n방문 ${v}` : ''}${n.on ? `\non: ${n.on.join(', ')}` : ''}`)}</title>` +
        `<rect width="${W}" height="${H}" rx="6"/><text x="8" y="${sub ? 15 : 23}">${esc(label)}</text>${sub ? `<text class="sub" x="8" y="30">${esc(sub.length > 30 ? sub.slice(0, 29) + '…' : sub)}</text>` : ''}</g>`;
    }
    pane('graph').innerHTML = `<p class="ed-hint">${st ? '초록 = 이번 세이브에서 지나간 노트, 밝은 테두리 = 지금 노트' : '게임 연결 없음 (방문 표시 없음)'} · 노란 = 트리거 노트 · 점선 = 되돌아가는 연결 · 클릭 = 편집기로</p>` +
      `<svg class="ed-graph" width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><defs><marker id="ed-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z"/></marker></defs>` +
      `<g class="ed-edges">${paths}</g>${boxes}</svg>`;
  }

  function show(t) {
    tab = t;
    for (const b of root.querySelectorAll('[data-t]')) b.classList.toggle('on', b.dataset.t === t);
    for (const p of root.querySelectorAll('[data-p]')) p.hidden = p.dataset.p !== t;
    if (t === 'graph') drawGraph();
  }

  function newFile() {
    let name = prompt('새 파일 이름 (예: day1.ink, days/day1.ink)')?.trim();
    if (!name) return;
    if (!name.endsWith('.ink')) name += '.ink';
    if (!NAME.test(name)) return msg('이름에는 영문, 숫자, _ - 와 폴더 구분 / 만 쓸 수 있어요', true);
    const same = [...bufs.keys()].find((n) => n.toLowerCase() === name.toLowerCase()); // Day1.ink would overwrite day1.ink on NTFS
    if (same) return open(same);
    if (!bufs.has(name)) { add(name, `// ${name}\n`, true); msg(`${ENTRY}에 INCLUDE ${name} 을 넣어야 컴파일에 들어가요 (저장 전까지는 이 페이지에만 있음)`); }
    open(name);
  }

  async function loadFiles() {
    try {
      const names = (await (await ok(fetch('/api/story'))).json()).files.map((f) => f.name);
      return Object.fromEntries(await Promise.all(names.map(async (n) => [n, await (await ok(fetch('/story/' + enc(n)))).text()])));
    } catch { return fetchSources('/story/', ENTRY).catch(() => ({})); }   // a server without the listing: what main.ink includes
  }

  async function init() {
    msg('편집기 불러오는 중…');
    const [C, texts] = await Promise.all([loadCM(), loadFiles()]);
    CM = C;
    for (const [n, t] of Object.entries(texts)) add(n, t);
    if (!bufs.has(ENTRY)) add(ENTRY, 'INCLUDE lib.ink\n\n', true);
    cm = CM($('.ed-cm'), { value: '', mode: 'ink', lineNumbers: true, lineWrapping: true, indentUnit: 4, tabSize: 4, gutters: ['ed-gut', 'CodeMirror-linenumbers'] });
    cm.on('changes', () => { files(); clearTimeout(timer); timer = setTimeout(rebuild, 400); });
    // Ctrl+click: voice the line under the pointer. preventDefault keeps CM from making it a second cursor.
    cm.on('mousedown', (_, e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      sayLine(cm.coordsChar({ left: e.clientX, top: e.clientY }).line);
    });
    new ResizeObserver(() => cm.refresh()).observe($('.ed-cm'));   // mounted in a hidden/zero-size box: measure again once it has a size
    open(ENTRY);
    rebuild();
    msg(`${bufs.size}개 파일`);
  }

  root.addEventListener('keydown', (e) => {
    // CM's own Ctrl-S binding names a 'save' command nobody defines, so the key reaches us
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); if (cm) save(); }
  });
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a, t = e.target.closest('[data-t]')?.dataset.t, n = e.target.closest('.ed-n')?.dataset.id;
    if (!cm) return;
    if (a) ({ save, play: playHere, lint: check, fuzz: runFuzz, bake })[a]();
    if (t) show(t);
    if (n !== undefined) { const node = scanInk(sources()).find((x) => x.id === n); if (node) open(node.file, node.line); }
  });
  $('.ed-new').onclick = () => cm && newFile();
  pane('bake').querySelector('.ed-cancel').onclick = () => baking?.abort();
  addEventListener('beforeunload', (e) => { if ([...bufs.values()].some(dirty)) { e.preventDefault(); e.returnValue = ''; } });
  // live visit shading: redraw only when the game's knot / visit counts actually moved
  setInterval(() => {
    if (tab !== 'graph' || document.hidden || !cm) return;
    const st = getState();
    if (JSON.stringify([st?.knot, st?.knots]) !== graphKey) drawGraph();
  }, 1000);

  show('issues');
  init().catch((e) => msg(`편집기를 못 열었어요: ${e.message}`, true));
  return { open: (name, line) => open(name, line) };
}
