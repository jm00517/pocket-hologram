// Desktop view of a story scene: the dialogue box over the 3D view (name plate, typewriter text, subtitle,
// quick buttons), choice buttons with a timer bar, the #input prompt, the backlog and the menu (저장 / 불러오기 /
// 추억 / 설정, 새로 시작). Same View API as src/story/XRView.js; the integrator (src/story/index.js) wires the
// callbacks to the Runner. Story text only ever goes in through textContent: #input answers come back inside
// lines, so nothing a player types can turn into markup. Style: the '/* story */' section of src/style.css.

const SLOTS = 12; // manual save slots 'slot1'..'slot12'; the Runner's own 'auto' sits in front of them on 불러오기
const PAGES = [['save', '저장'], ['load', '불러오기'], ['memories', '추억'], ['settings', '설정']];
const QUICK = [['auto', '자동', '자동 진행 (A)'], ['skip', '스킵', '읽은 대사 넘기기 (Ctrl 누르고 있기)'], ['log', '로그', '지난 대사 (L, 휠 위로)'],
  ['save', '저장', '저장'], ['load', '불러오기', '불러오기'], ['menu', '메뉴', '메뉴 (Esc)']];
const HOLD_MS = 200; // Ctrl held this long is a skip; shorter, with another key, is a shortcut (Ctrl+Z in the params panel)

// Graphemes, not UTF-16 units: an emoji or a kana with a combining mark types out as one character
const seg = new Intl.Segmenter('ja', { granularity: 'grapheme' });
export const graphemes = (s) => Array.from(seg.segment(s ?? ''), (x) => x.segment);
/** characters of n out after ms at cps (0 = all at once); the first shows at once so a click always gets an answer */
export const typed = (ms, cps, n) => (cps > 0 ? Math.min(n, 1 + Math.floor((ms * cps) / 1000)) : n);
/** ParamDef -> control: a 0..1 step 1 number is a switch in all but name */
export const settingKind = (p) => (p.type === 'enum' ? 'select' : p.type === 'bool' || (p.min === 0 && p.max === 1 && p.step === 1) ? 'check' : 'slider');
const fmt = (v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : String(v));

/**
 * Key -> action ('advance' | 'pick:<i>' | 'auto' | 'skip' | 'log' | 'menu' | 'close' | null).
 * ui: { scene, choices (how many), menu, log, prompt, flying (free cam: WASD/Space/C move the camera) }.
 * Outside a scene only Esc (the menu) is ours: Space and F belong to the free cam.
 */
export function keyAction(e, ui) {
  const c = e.code;
  if (e.repeat || e.altKey || e.metaKey) return null;
  if (c === 'Escape') return ui.menu ? 'close' : ui.log ? 'log' : ui.prompt ? null : 'menu';
  if (ui.menu || ui.prompt) return null;
  if (ui.log) return c === 'KeyL' ? 'log' : null;
  if (!ui.scene) return null;
  if (/^Control/.test(c)) return 'skip';
  if (e.ctrlKey) return null;
  const k = /^(?:Digit|Numpad)([1-9])$/.exec(c)?.[1];
  if (k) return +k <= ui.choices ? `pick:${k - 1}` : null;
  if (c === 'Enter' || c === 'NumpadEnter' || (c === 'Space' && !ui.flying)) return ui.choices ? null : 'advance';
  if (c === 'KeyA' && !ui.flying) return 'auto';
  return c === 'KeyL' ? 'log' : null;
}

const h = (tag, props, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.flat().filter((k) => k != null && k !== false));
  return el;
};
const when = (t) => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const slotName = (s) => (s === 'auto' ? '자동 저장' : /^slot\d+$/.test(s) ? `슬롯 ${s.slice(4)}` : s);

/** params: engine.params, optional: settings read their live value from it and follow changes made elsewhere (dev tools) */
export function createDomView({ params } = {}) {
  const st = { auto: false, skip: false, scene: false };
  let boxShown = false, choiceList = null, picked = false, logOpen = false, promptOpen = false, menuData = null, page = 'save';
  let subLang = 'ko', tw = null, raf = 0, ctrlTimer = 0, ctrlHeld = false, lastWheel = 0;

  const t1 = h('span', {}), t2 = h('span', { className: 'story-rest' }), s1 = h('span', {}), s2 = h('span', { className: 'story-rest' });
  const nameEl = h('div', { className: 'story-name' }), subEl = h('div', { className: 'story-sub' }, s1, s2);
  const qb = {};
  const quick = h('div', { className: 'story-quick' }, QUICK.map(([k, label, title]) => (qb[k] = h('button', { type: 'button', textContent: label, title, onclick: () => quickBtn(k) }))));
  const box = h('div', { className: 'story-box hidden' }, nameEl, h('div', { className: 'story-text' }, t1, t2), subEl, h('div', { className: 'story-next', textContent: '▼' }), quick);
  const choicesEl = h('div', { className: 'story-choices hidden' });
  const root = h('div', { id: 'story' }, choicesEl, box);
  const logList = h('div', { className: 'story-loglist' });
  const logEl = h('div', { id: 'storyLog', className: 'story-overlay hidden' },
    h('div', { className: 'story-panel story-log' }, h('div', { className: 'story-tabs' }, h('b', {}, '지난 대사'), h('span', { className: 'sp' }), h('button', { type: 'button', textContent: '닫기', onclick: () => closeLog() })), logList));
  const menuPanel = h('div', { className: 'story-panel' });
  const menuEl = h('div', { id: 'storyMenu', className: 'story-overlay hidden' }, menuPanel);
  const qEl = h('p', {}), answer = h('input', { type: 'text', autocomplete: 'off', maxLength: 40, placeholder: '여기에 입력' });
  const promptEl = h('div', { id: 'storyPrompt', className: 'story-overlay hidden' },
    h('form', { className: 'story-panel story-prompt', onsubmit: (e) => { e.preventDefault(); const v = answer.value.trim(); if (!v) return answer.focus(); closePrompt(); view.onAnswer(v); } },
      qEl, answer, h('button', { textContent: '확인' })));
  document.body.append(root, logEl, menuEl, promptEl);

  const ui = () => ({ scene: !!(st.scene || boxShown || choiceList), choices: choiceList?.length ?? 0, menu: !!menuData, log: logOpen, prompt: promptOpen,
    flying: !!(document.pointerLockElement || document.querySelector('#freeBtn.on')) });
  function sync() {
    document.body.classList.toggle('story-scene', !!(st.scene || boxShown || choiceList || promptOpen));
    qb.auto.classList.toggle('on', !!st.auto); qb.skip.classList.toggle('on', !!st.skip);
    choicesEl.classList.toggle('hidden', !choiceList);
  }
  function quickBtn(k) {
    if (k === 'save' || k === 'load') { page = k; view.onToggle('menu', k); } // the page goes along; menu(data) without a page keeps it too
    else view.onToggle(k);
  }

  // Typewriter: the untyped rest stays in the layout, hidden, so words don't jump to the next line as they type.
  // The subtitle types in proportion, so both finish together.
  function paint(k) {
    const { g, s } = tw, m = g.length ? Math.round((k / g.length) * s.length) : s.length;
    t1.textContent = g.slice(0, k).join(''); t2.textContent = g.slice(k).join('');
    s1.textContent = s.slice(0, m).join(''); s2.textContent = s.slice(m).join('');
  }
  function frame() {
    const k = typed(performance.now() - tw.t0, tw.cps, tw.g.length);
    paint(k);
    if (k >= tw.g.length) finish(); else raf = requestAnimationFrame(frame);
  }
  function finish() {
    if (!tw) return;
    cancelAnimationFrame(raf); paint(tw.g.length);
    const done = tw.resolve; tw = null;
    box.classList.add('done'); done();
  }
  const subOf = (l) => { const s = subLang === 'off' ? null : l.subs?.[subLang]; return s && s !== l.text ? s : null; };

  function closeLog() { if (!logOpen) return; logOpen = false; logEl.classList.add('hidden'); view.onToggle('log'); }
  function closeMenu() { menuData = null; menuEl.classList.add('hidden'); sync(); }
  function closePrompt() { promptOpen = false; promptEl.classList.add('hidden'); sync(); }
  const act = (action, arg) => { closeMenu(); view.onMenu(action, arg); };

  // Menu pages
  const cur = (p) => (params?.has?.(p.id) ? params.get(p.id) : p.get ? p.get() : p.value);
  const set = (p, value) => view.onMenu('set', { id: p.id, value });
  function slotCell(r, mode) {
    const pick = () => {
      if (mode === 'load') { if (!st.scene || confirm('지금 장면의 진행은 사라져요. 불러올까요?')) act('load', r.slot); return; }
      if (!r.saved || confirm(`${r.name}에 덮어쓸까요?`)) view.onMenu('save', r.slot); // stays open: the integrator sends the new slot list
    };
    return h('div', { className: 'story-cell' },
      h('button', { type: 'button', className: 'story-slot', disabled: mode === 'load' && !r.saved, onclick: pick },
        r.thumb ? h('img', { src: r.thumb, alt: '' }) : h('div', { className: 'story-thumb' }),
        h('b', {}, r.name), h('small', {}, r.saved ? when(r.time) : '빈 슬롯'), r.label ? h('small', {}, r.label) : null),
      mode === 'load' && r.saved && r.slot !== 'auto'
        ? h('button', { type: 'button', className: 'story-del', title: '삭제', textContent: '×', onclick: () => confirm(`${r.name}을(를) 지울까요?`) && view.onMenu('remove', r.slot) })
        : null);
  }
  function slotsPage(mode) {
    const have = new Map((menuData.slots ?? []).filter((s) => s.slot !== 'global').map((s) => [s.slot, s]));
    const numbered = Array.from({ length: SLOTS }, (_, i) => `slot${i + 1}`);
    const ids = mode === 'save' ? numbered : ['auto', ...numbered, ...[...have.keys()].filter((s) => s !== 'auto' && !numbered.includes(s))];
    return h('div', { className: 'story-grid' }, ids.map((slot) => slotCell({ ...have.get(slot), slot, name: slotName(slot), saved: have.has(slot) }, mode)));
  }
  function memoriesPage() {
    const m = menuData.memories, list = Array.isArray(m) ? m : Object.entries(m ?? {}).map(([id, v]) => ({ id, ...v })); // Store keeps them as {id: {...}}
    if (!list.length) return h('p', { className: 'story-empty' }, '아직 추억이 없어요. 함께 시간을 보내면 여기에 쌓여요.');
    return h('div', { className: 'story-grid' }, list.map((x) => h('div', { className: 'story-cell' },
      h('button', { type: 'button', className: 'story-slot', title: '다시 보기', onclick: () => act('replay', x.id) },
        x.thumb ? h('img', { src: x.thumb, alt: '' }) : h('div', { className: 'story-thumb' }), h('b', {}, x.title || x.id), x.time ? h('small', {}, when(x.time)) : null))));
  }
  function settingsPage() {
    const defs = menuData.settings ?? [];
    if (!defs.length) return h('p', { className: 'story-empty' }, '설정할 항목이 없어요.');
    return h('div', { className: 'story-settings' }, defs.map((p) => {
      const v = cur(p), kind = settingKind(p), row = h('label', { className: 'slider', title: p.doc ?? '' }, p.label ?? p.id);
      let el;
      if (kind === 'select') {
        el = h('select', {}, (p.values ?? []).map(([k, l]) => h('option', { value: k }, l)));
        el.value = v; el.onchange = () => set(p, el.value); row.append(el);
      } else if (kind === 'check') {
        el = h('input', { type: 'checkbox', checked: +v === 1 });
        el.onchange = () => set(p, p.type === 'bool' ? el.checked : el.checked ? 1 : 0); row.append(el);
      } else {
        el = h('input', { type: 'range', min: p.min ?? 0, max: p.max ?? 1, step: p.step ?? 0.01 });
        const out = h('output', {}, fmt(v));
        el.value = v; el.oninput = () => { out.textContent = fmt(+el.value); set(p, +el.value); }; row.append(el, out);
      }
      el.dataset.id = p.id;
      return row;
    }));
  }
  function renderMenu() {
    menuPanel.replaceChildren(
      h('div', { className: 'story-tabs' },
        PAGES.map(([k, label]) => h('button', { type: 'button', className: k === page ? 'on' : '', textContent: label, onclick: () => { page = k; renderMenu(); } })),
        h('span', { className: 'sp' }),
        h('button', { type: 'button', textContent: '새로 시작', onclick: () => confirm('처음부터 다시 시작할까요? (저장 슬롯은 그대로 남아요)') && act('new') }),
        h('button', { type: 'button', textContent: '닫기', onclick: () => { closeMenu(); view.onMenu('close'); } })),
      page === 'save' || page === 'load' ? slotsPage(page) : page === 'memories' ? memoriesPage() : settingsPage());
  }
  // a value changed from somewhere else (dev tools, the drawer) shows here; the control being dragged is left alone
  params?.onChange?.((id, v) => {
    const el = menuData && menuPanel.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!el || el === document.activeElement) return;
    if (el.type === 'checkbox') el.checked = +v === 1; else el.value = v;
    if (el.nextElementSibling?.tagName === 'OUTPUT') el.nextElementSibling.textContent = fmt(v);
  });

  // Input. A clicked button keeps focus, and Space on a focused button clicks it again: drop focus after every click.
  for (const el of [root, logEl, menuEl]) el.addEventListener('click', (e) => e.target.closest?.('button')?.blur());
  logEl.onclick = (e) => { if (e.target === logEl) closeLog(); };
  menuEl.onclick = (e) => { if (e.target === menuEl) { closeMenu(); view.onMenu('close'); } };
  // Capture: a click that advances the line doesn't also poke the map under it (main.js listens on the canvas)
  addEventListener('click', (e) => {
    if (!(e.target.id === 'scene' || e.target.closest?.('.story-box')) || e.target.closest?.('button')) return;
    const u = ui();
    if (!boxShown || u.choices || u.menu || u.log || u.prompt || (u.flying && e.target.id === 'scene')) return; // a canvas click in free cam grabs the mouse
    e.stopPropagation();
    if (!view.complete()) view.onAdvance();
  }, true);
  addEventListener('wheel', (e) => {
    if (e.target.closest?.('#drawer,#chat,#storyMenu,#storyPrompt') || performance.now() - lastWheel < 400) return; // one flick, one toggle
    if (logOpen) {
      const l = logEl.firstChild;
      if (e.deltaY > 0 && l.scrollTop + l.clientHeight >= l.scrollHeight - 2) { lastWheel = performance.now(); closeLog(); }
    } else if (e.deltaY < 0 && ui().scene && !menuData && !promptOpen) { lastWheel = performance.now(); view.onToggle('log'); }
  }, { passive: true });
  const releaseCtrl = () => {
    clearTimeout(ctrlTimer); ctrlTimer = 0;
    if (ctrlHeld) { ctrlHeld = false; if (st.skip) view.onToggle('skip'); } // the Runner may have stopped skipping by itself (unread line)
  };
  addEventListener('keydown', (e) => {
    if (!/^Control/.test(e.code)) releaseCtrl(); // Ctrl with another key is a shortcut (Ctrl+Z): no skip, or no more of it
    // a focused drawer button isn't excluded: preventDefault on 'advance' keeps Space/Enter from clicking it again
    if (e.target.closest?.('input,textarea,select,#chat') && !(e.code === 'Escape' && e.target.closest('#storyMenu'))) return;
    const a = keyAction(e, ui());
    if (!a) return;
    e.preventDefault();
    if (a === 'advance') { if (!view.complete()) view.onAdvance(); }
    else if (a.startsWith('pick:')) pick(+a.slice(5));
    else if (a === 'skip') { if (!st.skip && !ctrlHeld && !ctrlTimer) ctrlTimer = setTimeout(() => { ctrlTimer = 0; ctrlHeld = true; view.onToggle('skip'); }, HOLD_MS); }
    else if (a === 'close') { closeMenu(); view.onMenu('close'); }
    else if (a === 'log' && logOpen) closeLog();
    else view.onToggle(a);
  });
  addEventListener('keyup', (e) => { if (/^Control/.test(e.code)) releaseCtrl(); });
  addEventListener('blur', releaseCtrl);

  function pick(i) {
    if (picked || !choiceList?.[i]) return;
    picked = true; choicesEl.querySelectorAll('.story-choice')[i]?.classList.add('picked');
    view.onPick(choiceList[i].index);
  }

  const view = {
    onAdvance() {}, onPick() {}, onAnswer() {}, onToggle() {}, onMenu() {},
    /** -> Promise that resolves when the line is fully out (typed, completed, replaced or hidden): auto mode can count from it */
    show(line, { cps = 0, sub = 'ko' } = {}) {
      finish();
      subLang = sub;
      for (const w of ['her', 'player', 'narration']) box.classList.toggle(w, line.who === w);
      box.classList.toggle('whisper', line.style === 'whisper');
      box.classList.remove('done', 'hidden');
      nameEl.textContent = line.who === 'narration' ? '' : line.speaker ?? '';
      const s = graphemes(subOf(line) ?? '');
      subEl.classList.toggle('hidden', !s.length);
      boxShown = true; sync();
      return new Promise((resolve) => { tw = { g: graphemes(line.text), s, t0: performance.now(), cps, resolve }; frame(); });
    },
    complete() { if (!tw) return false; finish(); return true; },
    get typing() { return !!tw; },
    hide() { finish(); boxShown = false; box.classList.add('hidden'); sync(); },
    choices(list, { timer = null } = {}) {
      choiceList = list; picked = false;
      choicesEl.replaceChildren(...[
        timer > 0 ? h('div', { className: 'story-timer', style: `--t:${timer}s` }) : null,
        ...list.map((c, i) => h('button', { type: 'button', className: 'story-choice', onclick: () => pick(i) }, i < 9 ? h('kbd', {}, String(i + 1)) : null, h('span', {}, c.text))),
      ].filter(Boolean));
      sync();
    },
    clearChoices() { choiceList = null; choicesEl.replaceChildren(); sync(); },
    prompt(text) {
      promptOpen = true; qEl.textContent = text ?? ''; answer.value = '';
      promptEl.classList.remove('hidden'); sync();
      requestAnimationFrame(() => answer.focus());
    },
    clearPrompt: closePrompt,
    status(s) { Object.assign(st, s); sync(); },
    backlog(lines) {
      if (!lines) { logOpen = false; logEl.classList.add('hidden'); return; }
      logList.replaceChildren(...lines.map((l) => h('div', { className: `story-entry ${l.who}` },
        l.who !== 'narration' && l.speaker ? h('b', {}, l.speaker) : null, h('p', {}, l.text), subOf(l) ? h('p', { className: 'story-sub' }, subOf(l)) : null)));
      if (!lines.length) logList.append(h('p', { className: 'story-empty' }, '아직 지난 대사가 없어요.'));
      logOpen = true; logEl.classList.remove('hidden');
      logEl.firstChild.scrollTop = logEl.firstChild.scrollHeight; // newest at the bottom, where you left off
    },
    menu(data) {
      if (!data) return closeMenu();
      menuData = data;
      if (PAGES.some(([k]) => k === data.page)) page = data.page;
      renderMenu(); menuEl.classList.remove('hidden'); sync();
    },
  };
  return view;
}

/** DOM-free check of the pure helpers (node: import this file and call it; throws on a failure) */
export function selfCheck() {
  const eq = (a, b, m) => { if (a !== b) throw new Error(`DomView: ${m}: got ${a}, want ${b}`); };
  eq(typed(0, 20, 10), 1, 'first char at once'); eq(typed(250, 20, 100), 6, 'cps'); eq(typed(9e9, 20, 10), 10, 'clamped'); eq(typed(0, 0, 7), 7, 'cps 0 = instant'); eq(typed(0, 20, 0), 0, 'empty');
  eq(graphemes('👍🏽が').length, 2, 'graphemes'); eq(graphemes(null).length, 0, 'null text');
  eq(settingKind({ type: 'enum' }), 'select', 'enum'); eq(settingKind({ min: 0, max: 1, step: 1 }), 'check', '0..1 step 1'); eq(settingKind({ type: 'bool' }), 'check', 'bool'); eq(settingKind({ min: 0, max: 60, step: 1 }), 'slider', 'number');
  const ui = (o) => ({ scene: true, choices: 0, menu: false, log: false, prompt: false, flying: false, ...o }), k = (code, o, e) => keyAction({ code, ...e }, ui(o));
  eq(k('Space', { scene: false }), null, 'Space is the free cam\'s outside a scene'); eq(k('KeyF'), null, 'F never'); eq(k('Escape', { scene: false }), 'menu', 'Esc opens the menu anywhere');
  eq(k('Space'), 'advance', 'Space'); eq(k('Enter', { flying: true }), 'advance', 'Enter while flying'); eq(k('Space', { flying: true }), null, 'Space while flying'); eq(k('KeyA', { flying: true }), null, 'A while flying');
  eq(k('Space', { choices: 3 }), null, 'no advance past choices'); eq(k('Digit2', { choices: 3 }), 'pick:1', 'digit'); eq(k('Numpad3', { choices: 3 }), 'pick:2', 'numpad'); eq(k('Digit4', { choices: 3 }), null, 'digit out of range');
  eq(k('ControlLeft', {}, { ctrlKey: true }), 'skip', 'Ctrl'); eq(k('KeyZ', {}, { ctrlKey: true }), null, 'Ctrl+Z'); eq(k('Space', {}, { repeat: true }), null, 'repeat');
  eq(k('Escape', { menu: true }), 'close', 'Esc closes the menu'); eq(k('Escape', { log: true }), 'log', 'Esc closes the log'); eq(k('Space', { log: true }), null, 'log open'); eq(k('KeyL', { log: true, scene: false }), 'log', 'L closes the log');
  eq(k('Escape', { prompt: true }), null, 'prompt keeps Esc'); eq(k('KeyA'), 'auto', 'A'); eq(k('KeyL'), 'log', 'L');
  return true;
}
