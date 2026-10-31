// The story's view inside VR: the same View API as DomView (src/story/DomView.js), drawn with canvas 2D into textures
// on quads, because WebXR shows no DOM. A dialogue board floats between you and her (just under her face, facing you),
// choice cards and the "answer by voice" card hang under it, and the menu or the backlog opens in front of you.
// Point a controller's laser and pull the trigger, or poke a panel with a bare fingertip; A advances, B is auto, X the
// log, Y the menu. A canvas is redrawn only when its content changes (the typewriter at most 20 times a second);
// hover is a highlight quad over the button, not a redraw. Sizes are metres times the rig's scale (the viewer's metre:
// U, or whatever a portal made of it), so the board is the same size in the room however big the map is.
import * as THREE from 'three';
import { graphemes, typed, settingKind } from './DomView.js';

const FONT = '"Noto Sans KR","Noto Sans JP","Malgun Gothic","Yu Gothic","Hiragino Sans",sans-serif';
// DomView's palette (style.css '/* story */'), so a scene reads the same on the monitor and in the headset
const C = { bg: 'rgba(8,11,16,.88)', edge: 'rgba(255,255,255,.17)', her: '#99ffdd', herBg: '#0b2226', me: '#ffc38a', meBg: '#2a1d0e', meText: '#ffe3c4',
  text: '#ffffff', narr: '#d8dde8', sub: '#bfe2ff', dim: '#8d96aa', btn: 'rgba(255,255,255,.07)', row: 'rgba(255,255,255,.045)', on: '#99ffdd', onText: '#062019' };
const DEG = Math.PI / 180, SLOTS = 12, PER = 8; // DomView's 12 manual slots; menu rows per page
const PAGES = [['save', '저장'], ['load', '불러오기'], ['memories', '추억'], ['settings', '설정']];
const QUICK = [['menu', '메뉴'], ['log', '로그'], ['skip', '스킵'], ['auto', '자동']]; // laid out right to left
const when = (t) => { const d = new Date(t); return t == null || isNaN(d) ? '' : d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const ms = (t) => +new Date(t ?? 0) || 0;
const slotName = (s) => (s === 'auto' ? '자동 저장' : /^slot\d+$/.test(s) ? `슬롯 ${s.slice(4)}` : s);

// Line breaking. Kana and kanji may break anywhere; a run of anything else (Hangul words, Latin) breaks only at a
// space unless it is wider than a whole line. Kinsoku: closing marks and small kana never start a line, opening
// brackets never end one.
const NO_START = new Set(graphemes('、。，．,.!?！？)）]］}｝」』】〉》〕ー～〜…‥ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ々・：:;；%％'));
const NO_END = new Set(graphemes('「『（([［｛〈《【〔“‘'));
const ANY = /[\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-･]/u;
const canBreak = (a, b) => !NO_START.has(b) && !NO_END.has(a) && (ANY.test(a) || ANY.test(b));
/** text -> lines (strings) no wider than maxW; measure(grapheme) -> width */
export function wrapText(text, maxW, measure) {
  const out = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = [], w = 0;
    for (const c of graphemes(para)) {
      if (!line.length && c === ' ') continue;
      line.push(c); w += measure(c);
      if (w <= maxW || line.length < 2) continue;
      let p = line.length - 1;
      while (p > 0 && !canBreak(line[p - 1], line[p])) p--;
      if (!p) { if (NO_START.has(c)) continue; p = line.length - 1; } // one word wider than the line is split; a lone closing mark hangs
      out.push(line.slice(0, p).join('').trimEnd());
      line = line.slice(p); while (line[0] === ' ') line.shift();
      w = line.reduce((a, x) => a + measure(x), 0);
    }
    out.push(line.join('').trimEnd());
  }
  return out;
}
/** the largest size whose wrapped lines fit maxH (else the smallest): measureFor(size) -> measure */
export function fitText(text, sizes, maxW, maxH, lh, measureFor) {
  for (const size of sizes) { const lines = wrapText(text, maxW, measureFor(size)); if (lines.length * size * lh <= maxH || size === sizes[sizes.length - 1]) return { size, lines }; }
}
/** the topmost (last drawn) item under canvas pixel x, y */
export function itemAt(items, x, y) {
  for (let i = items.length; i--;) { const r = items[i]; if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r; }
  return null;
}
/** a ParamDef's value one step up (dir 1) or down (-1): numbers on the step grid, clamped; enums cycle; switches flip */
export function stepParam(d, v, dir) {
  if (settingKind(d) === 'check') return d.type === 'bool' ? !v : +v ? 0 : 1;
  if (d.type === 'enum') { const vs = d.values ?? [], i = vs.findIndex(([k]) => k === v); return vs.length ? vs[(((i < 0 ? 0 : i + dir) % vs.length) + vs.length) % vs.length][0] : v; }
  const st = d.step || ((d.max ?? 1) - (d.min ?? 0)) / 20 || 0.1, base = d.min ?? 0;
  return Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, +(base + (Math.round((Number(v) - base) / st) + dir) * st).toFixed(10)));
}
export function fmtParam(d, v) {
  if (d.type === 'enum') return d.values?.find(([k]) => k === v)?.[1] ?? String(v);
  if (settingKind(d) === 'check') return +v ? '켬' : '끔';
  return Number(v).toFixed(Math.max(0, Math.min(3, Math.ceil(-Math.log10(d.step || 0.01) - 1e-9))));
}
/** backlog paging: the first index of the entries that fit avail, counting back from (length - skip); at least one */
export function fitFromEnd(heights, avail, skip = 0) {
  let i = Math.max(0, heights.length - skip), sum = 0;
  while (i > 0 && (sum === 0 || sum + heights[i - 1] <= avail)) sum += heights[--i];
  return i;
}

export function createXRView({ engine, getCharacter }) {
  const P = { dist: 0.9, drop: 7, size: 1 };
  engine.params.define([
    { id: 'xr.textDist', label: 'VR 대사판 거리', doc: 'In VR: how far (m) from your eyes the dialogue board floats on the way to her (at most 60% of the way, never nearer than 0.4 m).', min: 0.4, max: 2, step: 0.05, get: () => P.dist, set: (v) => { P.dist = v; } },
    { id: 'xr.textDrop', label: 'VR 대사판 높이', doc: 'In VR: degrees below the line from your eyes to her face where the top of the dialogue board sits (0 = over her face).', min: 0, max: 40, step: 1, get: () => P.drop, set: (v) => { P.drop = v; } },
    { id: 'xr.textSize', label: 'VR 대사판 크기', doc: 'In VR: scale of the story panels (dialogue board, choices, menu, log).', min: 0.6, max: 1.6, step: 0.05, get: () => P.size, set: (v) => { P.size = v; } },
  ]);

  // --- scene objects. Panels draw over the world in a fixed order (depthTest off), out of the ink lines and AO.
  const PLANE = new THREE.PlaneGeometry(1, 1), aniso = Math.min(8, engine.renderer.capabilities.getMaxAnisotropy());
  const noInk = (m) => { m.userData.outlineParameters = { visible: false }; return m; };
  // depthWrite: VR's outline pass draws her ink again after everything, depth-tested; the panels' depth keeps it off them
  const mat = (o) => noInk(new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: true, toneMapped: false, ...o }));
  const quad = (m, order) => { const q = new THREE.Mesh(PLANE, m); q.renderOrder = order; q.userData.noAO = true; q.frustumCulled = false; q.layers.mask = layerMask; return q; };
  let order = 9e5, layerMask = 1;
  function panel(kind, W, H, wm, parent) {
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = aniso;
    const p = { kind, g: canvas.getContext('2d'), tex, mesh: quad(mat({ map: tex }), (order += 10)), W, H, h: (wm * H) / W, items: [], dirty: true };
    p.mesh.scale.set(wm, p.h, 1); p.mesh.visible = false; p.mesh.userData.panel = p; parent.add(p.mesh);
    return p;
  }
  const root = new THREE.Group(); root.visible = false; engine.scene.add(root);
  const anchor = () => { const obj = new THREE.Group(); root.add(obj); return { obj, goal: new THREE.Vector3(), on: false }; };
  const dlg = anchor(), front = anchor(); // the board's place between you and her; the menu's in front of you
  const board = panel('board', 1024, 400, 0.6, dlg.obj), ask = panel('prompt', 896, 232, 0.5, dlg.obj);
  const menuP = panel('menu', 1024, 1024, 0.56, front.obj), logP = panel('log', 1024, 1024, 0.56, front.obj);
  const cards = [], card = (i) => (cards[i] ??= panel('card', 896, 112, 0.5, dlg.obj));
  const bar = quad(mat({ color: 0x99ffdd }), 1e6 - 10); dlg.obj.add(bar); // the choice timer
  // hover: a rounded rect drawn by a distance field, so it fits any button exactly with no canvas redraw
  const hl = [0, 1].map(() => {
    const m = noInk(new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false,
      uniforms: { size: { value: new THREE.Vector2(1, 1) }, r: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
      fragmentShader: 'uniform vec2 size; uniform float r; varying vec2 vUv; void main(){ vec2 q = abs(vUv - .5) * size - (size * .5 - r); float d = length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; gl_FragColor = vec4(1., 1., 1., .17 * clamp(.5 - d, 0., 1.)); }' }));
    const q = quad(m, 0); q.visible = false; root.add(q); return q;
  });
  const laserGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), dotGeo = new THREE.CircleGeometry(0.006, 16);
  const lasers = [];
  function laser(i, ray) {
    const L = (lasers[i] ??= (() => {
      const line = new THREE.Line(laserGeo, noInk(new THREE.LineBasicMaterial({ color: 0x99ffdd, transparent: true, opacity: 0.65, depthTest: false, depthWrite: false, toneMapped: false })));
      line.renderOrder = 1e6 + 1; line.frustumCulled = false; line.userData.noAO = true; line.layers.mask = layerMask;
      const dot = quad(mat({ color: 0xffffff }), 1e6 + 2); dot.geometry = dotGeo; root.add(dot);
      return { line, dot };
    })());
    if (!ray.parent) engine.rig.add(ray); // target-ray space is reported in the rig's room space, like the grips
    if (L.line.parent !== ray) ray.add(L.line);
    return L;
  }

  // --- state
  const st = { auto: false, skip: false, scene: false };
  let cur = null, boardOn = false, choiceList = [], picked = false, timerAll = 0, timerLeft = 0, promptText = null;
  let menuData = null, page = 'save', pg = 0, armed = null, setSig = '', setPoll = 0;
  let logLines = null, logEntries = [], logSkip = 0, logBack = [], subLang = 'ko', now = 0, drawnAt = -1;
  const pulse = (src, a, t) => src?.gamepad?.hapticActuators?.[0]?.pulse?.(a, t);
  const headV = new THREE.Vector3(), headOf = () => getCharacter?.()?.bones?.['頭']?.getWorldPosition(headV) ?? null;
  const overlay = () => !!(menuData || logLines);
  function finish() { if (!cur) return; if (!cur.done) { cur.shown = cur.total; cur.done = true; board.dirty = true; } const r = cur.resolve; cur.resolve = null; r?.(); }
  // the trigger / A on the board: finish the typing first, then move on (DomView does the same with a click)
  // -> whether it did anything: a trigger on the board that doesn't advance (choices, #input) goes to the mic
  const advance = () => { if (!boardOn || choiceList.length || promptText != null || overlay()) return false; if (!view.complete()) view.onAdvance(); return true; };
  const pick = (i) => { if (picked || !choiceList[i]) return; picked = true; view.onPick(choiceList[i].index ?? i); };
  const closeMenu = () => { menuData = null; armed = null; };
  const act = (a, arg) => { closeMenu(); view.onMenu(a, arg); };
  // VR has no confirm(): a destructive button arms on the first press ("한 번 더") and acts on a second within 3 s
  const twice = (key, fn) => () => { if (armed?.key === key) { armed = null; fn(); } else armed = { key, until: now + 3 }; menuP.dirty = true; };
  const mf = (g, style) => (size) => { g.font = `${style} ${size}px ${FONT}`; return (c) => g.measureText(c).width; };

  // --- drawing
  function frame(p, r = 30) {
    const g = p.g; p.items.length = 0; g.clearRect(0, 0, p.W, p.H);
    g.beginPath(); g.roundRect(2, 2, p.W - 4, p.H - 4, r); g.fillStyle = C.bg; g.fill(); g.strokeStyle = C.edge; g.lineWidth = 3; g.stroke();
    g.textAlign = 'left'; g.textBaseline = 'top';
    return g;
  }
  function button(p, key, x, y, w, h, label, run, { on = false, off = false, size = 28 } = {}) {
    const g = p.g, r = Math.min(18, h / 2);
    g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = on ? C.on : off ? 'rgba(255,255,255,.02)' : C.btn; g.fill(); g.strokeStyle = C.edge; g.lineWidth = 2; g.stroke();
    g.fillStyle = on ? C.onText : off ? '#4c5466' : C.text; g.font = `600 ${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, x + w / 2, y + h / 2 + 1, w - 12); g.textAlign = 'left'; g.textBaseline = 'top';
    if (!off) p.items.push({ key, x, y, w, h, r, run });
  }
  function drawBoard() {
    const p = board, g = frame(p), l = cur?.line;
    let x = p.W - 24;
    for (const [id, label] of QUICK) { x -= 96; button(p, id, x, 22, 88, 50, label, () => view.onToggle(id), { on: !!st[id], size: 24 }); x -= 8; }
    if (!l) return;
    if (l.speaker && l.who !== 'narration') {
      const me = l.who === 'player'; g.font = `600 30px ${FONT}`; const w = Math.min(x - 40, g.measureText(l.speaker).width + 44);
      g.beginPath(); g.roundRect(28, 22, w, 50, 14); g.fillStyle = me ? C.meBg : C.herBg; g.fill(); g.strokeStyle = me ? '#ffc38a66' : '#99ffdd66'; g.lineWidth = 2; g.stroke();
      g.fillStyle = me ? C.me : C.her; g.textBaseline = 'middle'; g.fillText(l.speaker, 50, 48, w - 44); g.textBaseline = 'top';
    }
    const L = cur.lay, k = cur.shown, narr = l.who === 'narration', whisper = l.style === 'whisper';
    g.fillStyle = l.who === 'player' ? C.meText : narr ? C.narr : C.text; g.globalAlpha = whisper ? 0.85 : 1;
    g.font = `${narr ? 'italic ' : ''}500 ${L.size}px ${FONT}`;
    let y = 92, left = k;
    for (const ln of L.lines) { if (left <= 0) break; g.fillText(left >= ln.length ? ln.join('') : ln.slice(0, left).join(''), 44, y); left -= ln.length; y += L.size * 1.3; }
    g.globalAlpha = 1;
    if (L.sub) { // types in proportion, so both finish together (as on the desktop)
      let m = cur.total ? Math.round((k / cur.total) * L.subTotal) : L.subTotal;
      y = 92 + L.lines.length * L.size * 1.3 + 10; g.fillStyle = C.sub; g.font = `400 ${L.sub.size}px ${FONT}`;
      for (const ln of L.sub.lines) { if (m <= 0) break; g.fillText(m >= ln.length ? ln.join('') : ln.slice(0, m).join(''), 44, y); m -= ln.length; y += L.sub.size * 1.3; }
    }
    if (cur.done && !choiceList.length) { g.fillStyle = C.her; g.font = `400 26px ${FONT}`; g.fillText('▼', p.W - 58, p.H - 50); }
  }
  function drawCard(p, i) {
    const g = frame(p), c = choiceList[i];
    g.beginPath(); g.arc(58, p.H / 2, 26, 0, 7); g.fillStyle = C.herBg; g.fill(); g.strokeStyle = '#99ffdd66'; g.lineWidth = 2; g.stroke();
    g.fillStyle = C.her; g.font = `600 26px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), 58, p.H / 2 + 1);
    const f = fitText(c.text, [38, 34, 30, 26], p.W - 140, p.H - 16, 1.2, mf(g, '500'));
    g.textAlign = 'left'; g.fillStyle = C.text; g.font = `500 ${f.size}px ${FONT}`; g.textBaseline = 'middle';
    f.lines.slice(0, 2).forEach((ln, j, a) => g.fillText(ln, 104, p.H / 2 + (j - (a.length - 1) / 2) * f.size * 1.2, p.W - 140));
    g.textBaseline = 'top'; p.items.push({ key: 'card', x: 0, y: 0, w: p.W, h: p.H, r: 30, run: () => pick(i) });
  }
  function drawPrompt() {
    const p = ask, g = frame(p);
    g.fillStyle = C.her; g.font = `600 30px ${FONT}`; g.fillText('말로 대답해 줘', 40, 24);
    const f = fitText(promptText, [34, 30, 26], p.W - 80, 100, 1.3, mf(g, '500'));
    g.fillStyle = C.text; g.font = `500 ${f.size}px ${FONT}`; f.lines.slice(0, 3).forEach((ln, j) => g.fillText(ln, 40, 70 + j * f.size * 1.3));
    g.fillStyle = C.dim; g.font = `400 22px ${FONT}`; g.fillText('트리거(맨손은 핀치)를 누른 채 말하고, 다 말하면 놓기', 40, p.H - 40, p.W - 80);
  }
  const thumbs = new Map();
  function img(url) { // slot / memory screenshots arrive as data URLs; the menu redraws when one has decoded
    if (!url) return null;
    let im = thumbs.get(url);
    if (!im) { im = new Image(); im.onload = () => { menuP.dirty = true; }; im.src = url; thumbs.set(url, im); }
    return im.complete && im.naturalWidth ? im : null;
  }
  function rowsOf(d) {
    const have = new Map((d.slots ?? []).filter((s) => s.slot !== 'global').map((s) => [s.slot, s]));
    if (page === 'save') return Array.from({ length: SLOTS }, (_, i) => {
      const slot = `slot${i + 1}`, s = have.get(slot), save = () => { view.onMenu('save', slot); }; // stays open: the integrator sends the new list
      return { key: slot, title: slotName(slot), sub: s ? [when(s.time), s.label].filter(Boolean).join('  ') : '빈 슬롯', thumb: s?.thumb, run: s ? twice('save:' + slot, save) : save, armed: armed?.key === 'save:' + slot };
    });
    if (page === 'load') return [...have.values()].sort((a, b) => (b.slot === 'auto') - (a.slot === 'auto') || ms(b.time) - ms(a.time)).map((s) => {
      const load = () => act('load', s.slot);
      return { key: s.slot, title: slotName(s.slot), sub: [when(s.time), s.label].filter(Boolean).join('  '), thumb: s.thumb, run: st.scene ? twice('load:' + s.slot, load) : load, armed: armed?.key === 'load:' + s.slot, del: s.slot !== 'auto' && s.slot };
    });
    if (page === 'memories') { const m = d.memories, list = Array.isArray(m) ? m : Object.entries(m ?? {}).map(([id, v]) => ({ id, ...v })); // Store keeps them as {id: {...}}
      return list.map((x) => ({ key: x.id, title: x.title || x.id, sub: when(x.time), thumb: x.thumb, run: () => act('replay', x.id) })); }
    return (d.settings ?? []).map((def) => ({ key: def.id, def }));
  }
  function settingRow(p, d, y) {
    const g = p.g, v = d.get?.() ?? d.value, set = (nv) => { view.onMenu('set', { id: d.id, value: nv }); p.dirty = true; }, R = p.W - 40;
    g.fillStyle = C.text; g.font = `500 28px ${FONT}`; g.textBaseline = 'middle'; g.fillText(d.label ?? d.id, 44, y + 44, R - 400); g.textBaseline = 'top';
    if (settingKind(d) === 'check') return button(p, 'set:' + d.id, R - 160, y + 16, 160, 56, +v ? '켬' : '끔', () => set(stepParam(d, d.get?.() ?? v, 1)), { on: !!+v });
    button(p, 'dec:' + d.id, R - 340, y + 16, 72, 56, '−', () => set(stepParam(d, d.get?.() ?? v, -1)), { size: 34 });
    button(p, 'inc:' + d.id, R - 72, y + 16, 72, 56, '+', () => set(stepParam(d, d.get?.() ?? v, 1)), { size: 34 });
    g.fillStyle = C.sub; g.font = `600 28px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(fmtParam(d, v), R - 170, y + 44, 180); g.textAlign = 'left'; g.textBaseline = 'top';
  }
  function drawMenu() {
    const p = menuP, g = frame(p, 36), d = menuData, rows = rowsOf(d), pages = Math.max(1, Math.ceil(rows.length / PER));
    PAGES.forEach(([k, label], i) => button(p, 'tab:' + k, 24 + i * 176, 24, 166, 64, label, () => { page = k; pg = 0; armed = null; p.dirty = true; }, { on: page === k, size: 30 }));
    button(p, 'close', p.W - 154, 24, 130, 64, '닫기', () => { closeMenu(); view.onMenu('close'); }, { size: 30 });
    pg = Math.min(pg, pages - 1);
    rows.slice(pg * PER, pg * PER + PER).forEach((r, j) => {
      const y = 108 + j * 96, w = p.W - 48;
      g.beginPath(); g.roundRect(24, y, w, 88, 16); g.fillStyle = C.row; g.fill();
      if (r.def) return settingRow(p, r.def, y);
      p.items.push({ key: 'row:' + r.key, x: 24, y, w, h: 88, r: 16, run: r.run });
      g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(36, y + 8, 128, 72);
      const im = img(r.thumb);
      if (im) { const s = Math.max(128 / im.naturalWidth, 72 / im.naturalHeight), sw = 128 / s, sh = 72 / s; g.drawImage(im, (im.naturalWidth - sw) / 2, (im.naturalHeight - sh) / 2, sw, sh, 36, y + 8, 128, 72); }
      g.fillStyle = r.armed ? C.her : C.text; g.font = `600 30px ${FONT}`; g.fillText(r.armed ? `${r.title} — 한 번 더 누르면 ${page === 'save' ? '덮어써요' : '불러와요'}` : r.title, 184, y + 12, w - 330);
      g.fillStyle = C.dim; g.font = `400 22px ${FONT}`; g.fillText(r.sub ?? '', 184, y + 54, w - 330);
      if (r.del) button(p, 'del:' + r.del, p.W - 160, y + 18, 120, 52, armed?.key === 'del:' + r.del ? '한 번 더' : '삭제', twice('del:' + r.del, () => view.onMenu('remove', r.del)), { on: armed?.key === 'del:' + r.del, size: 26 });
    });
    if (!rows.length) {
      g.fillStyle = C.dim; g.font = `400 28px ${FONT}`; g.textAlign = 'center';
      g.fillText(page === 'memories' ? '아직 추억이 없어요. 함께 시간을 보내면 여기에 쌓여요.' : page === 'load' ? '저장된 게 없어요.' : '설정할 항목이 없어요.', p.W / 2, 460, p.W - 80); g.textAlign = 'left';
    }
    if (pages > 1) {
      button(p, 'prev', 24, 920, 96, 64, '◀', () => { pg--; p.dirty = true; }, { off: pg === 0, size: 30 });
      g.fillStyle = C.dim; g.font = `500 28px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(`${pg + 1} / ${pages}`, 186, 952); g.textAlign = 'left'; g.textBaseline = 'top';
      button(p, 'next', 252, 920, 96, 64, '▶', () => { pg++; p.dirty = true; }, { off: pg >= pages - 1, size: 30 });
    }
    const sure = armed?.key === 'new';
    button(p, 'new', p.W - 304, 920, 280, 64, sure ? '한 번 더: 처음부터' : '새로 시작', twice('new', () => act('new')), { on: sure, size: 28 });
  }
  function layoutLog() {
    const g = logP.g, sub = (l) => { const s = subLang === 'off' ? null : l.subs?.[subLang]; return s && s !== l.text ? s : null; };
    logEntries = (logLines ?? []).slice(-200).map((l) => {
      const named = !!l.speaker && l.who !== 'narration';
      const t = wrapText(l.text, 950, mf(g, l.who === 'narration' ? 'italic 500' : '500')(30)), s = sub(l) ? wrapText(sub(l), 950, mf(g, '400')(24)) : [];
      return { l, named, t, s, h: (named ? 38 : 0) + t.length * 40 + s.length * 32 + 22 };
    });
  }
  function drawLog() {
    const p = logP, g = frame(p, 36), n = logEntries.length;
    g.fillStyle = C.her; g.font = `600 34px ${FONT}`; g.textBaseline = 'middle'; g.fillText('지난 대사', 40, 56); g.textBaseline = 'top';
    button(p, 'close', p.W - 154, 24, 130, 64, '닫기', () => { logLines = null; view.onToggle('log'); }, { size: 30 });
    logSkip = Math.min(logSkip, Math.max(0, n - 1));
    const end = n - logSkip, start = fitFromEnd(logEntries.map((e) => e.h), 790, logSkip);
    g.save(); g.beginPath(); g.rect(0, 104, p.W, 796); g.clip();
    let y = 110;
    for (let i = start; i < end; i++) {
      const { l, named, t, s } = logEntries[i], me = l.who === 'player';
      if (named) { g.fillStyle = me ? C.me : C.her; g.font = `600 26px ${FONT}`; g.fillText(l.speaker, 40, y); y += 38; }
      g.fillStyle = me ? C.meText : l.who === 'narration' ? C.narr : C.text; g.font = `${l.who === 'narration' ? 'italic ' : ''}500 30px ${FONT}`;
      for (const ln of t) { g.fillText(ln, 40, y); y += 40; }
      g.fillStyle = C.sub; g.font = `400 24px ${FONT}`;
      for (const ln of s) { g.fillText(ln, 40, y); y += 32; }
      y += 22;
    }
    g.restore();
    if (!n) { g.fillStyle = C.dim; g.font = `400 28px ${FONT}`; g.textAlign = 'center'; g.fillText('아직 지난 대사가 없어요.', p.W / 2, 460); g.textAlign = 'left'; }
    button(p, 'older', 24, 920, 200, 64, '▲ 이전', () => { logBack.push(logSkip); logSkip = n - start; p.dirty = true; }, { off: start === 0, size: 28 });
    button(p, 'newer', 236, 920, 200, 64, '▼ 다음', () => { logSkip = logBack.pop() ?? 0; p.dirty = true; }, { off: logSkip === 0, size: 28 });
  }
  const draw = (p, fn) => { if (!p.dirty) return; p.dirty = false; fn(); p.tex.needsUpdate = true; };

  // --- per frame (scratch objects reused: no allocation in the loop beyond three's raycast hits)
  const eye = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3(), side = new THREE.Vector3(), dir = new THREE.Vector3(), tgt = new THREE.Vector3(), tmp = new THREE.Vector3();
  const rc = new THREE.Raycaster(), hits = [], targets = [];
  const hoverP = [null, null], hoverI = [null, null], lastP = [null, null], lastK = [null, null], srcs = [null, null], pressed = [false, false];
  const btn = [[false, false], [false, false]], tipZ = [1, 1], tipCool = [0, 0], tipT = [0, 0];
  // lazy follow: the goal jumps only when the ideal spot has drifted past `slack` (text you read doesn't swim),
  // then the panel glides there; it always turns to face you
  function glide(a, target, dt, slack, s) {
    if (!a.on || a.obj.position.distanceTo(target) > 1.5 * s) a.obj.position.copy(target); // a jump (a portal, a rescale): no flying in
    if (!a.on || a.goal.distanceTo(target) > slack) a.goal.copy(target);
    a.on = true; a.obj.position.lerp(a.goal, 1 - Math.exp(-6 * dt));
    a.obj.scale.setScalar(s); a.obj.up.copy(up); a.obj.lookAt(eye); a.obj.updateMatrixWorld(true);
  }
  function press(p, item, i) { // -> consumed
    if (item) { item.run(); pulse(srcs[i], 0.35, 25); return true; }
    if (p.kind === 'board') return advance();
    return p.kind !== 'prompt'; // pointing at the voice card and pulling the trigger is how you answer: let the mic have it
  }

  const view = {
    onAdvance() {}, onPick() {}, onAnswer() {}, onToggle() {}, onMenu() {},
    /** -> Promise that resolves when the line is fully out (typed, completed, replaced or hidden), like DomView's */
    show(line, { cps = 0, sub = 'ko' } = {}) {
      finish(); subLang = sub;
      const g = board.g, sl = sub === 'off' ? null : line.subs?.[sub], s = sl && sl !== line.text ? fitText(sl, [30, 26], 936, 84, 1.3, mf(g, '400')) : null;
      const m = fitText(line.text ?? '', [46, 40, 34, 30], 936, 280 - (s ? s.lines.length * s.size * 1.3 + 10 : 0), 1.3, mf(g, line.who === 'narration' ? 'italic 500' : '500'));
      const lines = m.lines.map(graphemes), sLines = s?.lines.map(graphemes), total = lines.reduce((a, x) => a + x.length, 0);
      const lay = { size: m.size, lines, sub: s && { size: s.size, lines: sLines }, subTotal: sLines?.reduce((a, x) => a + x.length, 0) ?? 0 };
      cur = { line, lay, t: 0, cps, total, shown: typed(0, cps, total), done: false, resolve: null };
      cur.done = cur.shown >= total; boardOn = true; board.dirty = true;
      return new Promise((r) => { if (cur.done) r(); else cur.resolve = r; });
    },
    complete() { if (!cur || cur.done) return false; finish(); return true; },
    get typing() { return !!cur && !cur.done; },
    hide() { finish(); boardOn = false; },
    choices(list, { timer = null } = {}) {
      choiceList = list ?? []; picked = false; timerAll = timerLeft = timer > 0 ? timer : 0;
      choiceList.forEach((_, i) => { card(i).dirty = true; }); board.dirty = true; // the ▼ goes while choices are up
    },
    clearChoices() { choiceList = []; timerAll = 0; board.dirty = true; },
    prompt(text) { promptText = String(text ?? ''); ask.dirty = true; },
    clearPrompt() { promptText = null; },
    status(s) { Object.assign(st, s); board.dirty = true; menuP.dirty = true; },
    backlog(lines) { logLines = lines; logSkip = 0; logBack = []; if (lines) { layoutLog(); logP.dirty = true; } },
    menu(data) {
      if (!data) return closeMenu();
      if (!menuData) pg = 0;
      if (PAGES.some(([k]) => k === data.page) && data.page !== page) { page = data.page; pg = 0; }
      menuData = data; menuP.dirty = true;
    },
    /** trigger pressed on controller i: true when it hit a panel (the caller then doesn't start the mic) */
    select(i) { const p = hoverP[i]; return (pressed[i] = !!(engine.xr && p?.mesh.visible && p.mesh.parent.visible && press(p, hoverI[i], i))); },
    /** trigger released: true when its press was ours */
    selectEnd(i) { const u = pressed[i]; pressed[i] = false; return u; },

    update(dt, { camera = engine.camera, herHead = null, controllers = [], tips = [] } = {}) {
      now += dt;
      if (cur && !cur.done) { const k = typed((cur.t += dt) * 1000, cur.cps, cur.total); if (k !== cur.shown) { cur.shown = k; board.dirty = true; } if (k >= cur.total) finish(); }
      if (timerLeft > 0 && !menuData && !logLines) timerLeft = Math.max(0, timerLeft - dt); // paused behind them, like the choice's timer
      if (armed && now > armed.until) { armed = null; menuP.dirty = true; }
      if (!engine.xr) {
        if (root.visible) { root.visible = false; for (const L of lasers) if (L) L.line.visible = false; dlg.on = front.on = false; hoverP.fill(null); hoverI.fill(null); }
        return;
      }
      root.visible = true;
      if (camera.layers.mask !== layerMask) { // a portal map (NonEuclid) moves the camera between layers: stay seen
        layerMask = rc.layers.mask = camera.layers.mask; root.traverse((o) => { o.layers.mask = layerMask; }); for (const L of lasers) if (L) L.line.layers.mask = layerMask;
      }
      const ov = overlay(), dOn = !ov && (boardOn || choiceList.length > 0 || promptText != null);
      dlg.obj.visible = dOn; front.obj.visible = ov;
      board.mesh.visible = boardOn; ask.mesh.visible = promptText != null;
      for (let i = 0; i < cards.length; i++) cards[i].mesh.visible = i < choiceList.length;
      menuP.mesh.visible = !!menuData; logP.mesh.visible = !menuData && !!logLines;
      // the stack under the board (cards / voice card / timer), anchor-local metres; without the board it starts at its top
      let y = boardOn ? -(board.h / 2 + 0.02) : board.h / 2;
      if (promptText != null) { ask.mesh.position.y = y - ask.h / 2; y -= ask.h + 0.012; }
      for (let i = 0; i < choiceList.length; i++) { const c = cards[i]; c.mesh.position.y = y - c.h / 2; y -= c.h + 0.012; }
      bar.visible = timerAll > 0 && choiceList.length > 0;
      if (bar.visible) { const f = timerLeft / timerAll; bar.scale.set(Math.max(1e-4, 0.5 * f), 0.008, 1); bar.position.set(-0.25 * (1 - f), y - 0.002, 0); bar.material.color.setHex(f < 0.3 ? 0xff8a7a : 0x99ffdd); }

      if (board.dirty && boardOn && (cur?.done || now - drawnAt > 0.05)) { drawnAt = now; draw(board, drawBoard); } // typewriter: 20 redraws/s at most
      for (let i = 0; i < choiceList.length; i++) { const c = cards[i]; if (c.dirty) draw(c, () => drawCard(c, i)); }
      if (promptText != null && ask.dirty) draw(ask, drawPrompt);
      if (menuData) {
        if (page === 'settings' && (setPoll -= dt) <= 0) { // a value changed elsewhere (dev tools, the drawer) shows here too
          setPoll = 0.3; const sig = (menuData.settings ?? []).map((d) => d.get?.()).join('|'); if (sig !== setSig) { setSig = sig; menuP.dirty = true; }
        }
        draw(menuP, drawMenu);
      } else if (logLines) draw(logP, drawLog);

      // placement, in world space
      const k = engine.rig.scale.x || 1, s = k * P.size;
      camera.getWorldPosition(eye); up.set(0, 1, 0).applyQuaternion(engine.rig.quaternion);
      camera.getWorldDirection(fwd).projectOnPlane(up); if (fwd.lengthSq() < 1e-8) fwd.set(0, 0, -1).applyQuaternion(engine.rig.quaternion); fwd.normalize();
      if (dOn) {
        const head = herHead ?? headOf(); let d = P.dist;
        // past 6 m (another space of the gallery, far down a garden) the board belongs in front of you
        const m = head ? dir.subVectors(head, eye).length() / k : 0;
        if (m > 0.05 && m < 6) { dir.divideScalar(m * k); d = Math.max(0.4, Math.min(P.dist, 0.6 * m)); } else dir.copy(fwd);
        side.crossVectors(dir, up); if (side.lengthSq() < 1e-8) side.crossVectors(fwd, up); side.normalize();
        dir.applyAxisAngle(side, -P.drop * DEG); // the board's top edge sits this far under her face
        tgt.copy(eye).addScaledVector(dir, d * k).addScaledVector(up, (-board.h / 2) * s);
        glide(dlg, tgt, dt, 0.08 * k, s);
      } else dlg.on = false;
      if (ov) { side.crossVectors(fwd, up).normalize(); dir.copy(fwd).applyAxisAngle(side, -12 * DEG); tgt.copy(eye).addScaledVector(dir, 0.75 * k); glide(front, tgt, dt, 0.35 * k, s); } else front.on = false;

      targets.length = 0;
      if (dOn) { if (boardOn) targets.push(board.mesh); if (promptText != null) targets.push(ask.mesh); for (let i = 0; i < choiceList.length; i++) targets.push(cards[i].mesh); }
      if (ov) targets.push((menuData ? menuP : logP).mesh);

      for (let i = 0; i < 2; i++) {
        const c = controllers[i], src = (srcs[i] = c?.src ?? null);
        let hp = null, hi = null;
        const L = c?.ray ? laser(i, c.ray) : lasers[i];
        if (L) L.line.visible = L.dot.visible = false;
        if (src && L && targets.length) { // the laser
          c.ray.updateWorldMatrix(true, false);
          rc.ray.origin.setFromMatrixPosition(c.ray.matrixWorld); rc.ray.direction.set(0, 0, -1).transformDirection(c.ray.matrixWorld);
          rc.far = 8 * k; hits.length = 0; rc.intersectObjects(targets, false, hits);
          const hit = hits[0];
          L.line.visible = true; L.line.scale.z = (hit ? hit.distance : 1.5 * k) / c.ray.matrixWorld.getMaxScaleOnAxis();
          if (hit) {
            hp = hit.object.userData.panel; hi = itemAt(hp.items, hit.uv.x * hp.W, (1 - hit.uv.y) * hp.H);
            L.dot.visible = true; L.dot.position.copy(hit.point); hit.object.getWorldQuaternion(L.dot.quaternion); L.dot.scale.setScalar(k);
          }
        }
        const tip = tips[i]; tipCool[i] -= dt;
        // a bare fingertip: press on crossing the face from the front, at most every 0.4 s, and only after a slow approach
        // (tipT: time just in front, inside the footprint): a hand reaching past to touch her goes straight through.
        // The board's empty face takes no poke: advancing stays on the pinch, the trigger and A
        if (tip && targets.length) {
          let best = null, bz = 1, bu = 0, bv = 0;
          for (const m of targets) {
            tmp.copy(tip); m.worldToLocal(tmp); const z = tmp.z * P.size; // the panel's local z is (scaled) metres
            if (Math.abs(tmp.x) <= 0.5 && Math.abs(tmp.y) <= 0.5 && Math.abs(z) < 0.15 && z < bz) { best = m; bz = z; bu = tmp.x + 0.5; bv = tmp.y + 0.5; }
          }
          if (best) {
            const p = best.userData.panel;
            if (bz < 0.06 && bz > -0.05) { hp = p; hi = itemAt(p.items, bu * p.W, (1 - bv) * p.H); } // this close, the finger wins over the ray
            if (bz >= 0.06) tipT[i] = 0; else if (bz >= 0.01) tipT[i] += dt;
            if (bz < 0.01 && bz > -0.05 && tipZ[i] >= 0.01 && tipCool[i] <= 0 && tipT[i] >= 0.06 && (hi || p.kind !== 'board')) { tipCool[i] = 0.4; tipT[i] = 0; press(p, hi, i); }
            tipZ[i] = bz;
          } else { tipZ[i] = 1; tipT[i] = 0; }
        } else tipT[i] = 0;
        hoverP[i] = hp; hoverI[i] = hi;
        if (hp !== lastP[i] || (hi?.key ?? null) !== lastK[i]) { if (hi) pulse(src, 0.12, 12); lastP[i] = hp; lastK[i] = hi?.key ?? null; } // a tick per new button
        const q = hl[i];
        if (hi) {
          if (q.parent !== hp.mesh) hp.mesh.add(q);
          q.renderOrder = hp.mesh.renderOrder + 1; q.position.set((hi.x + hi.w / 2) / hp.W - 0.5, 0.5 - (hi.y + hi.h / 2) / hp.H, 0); q.scale.set(hi.w / hp.W, hi.h / hp.H, 1);
          q.material.uniforms.size.value.set(hi.w, hi.h); q.material.uniforms.r.value = hi.r ?? 0; q.visible = true;
        } else q.visible = false;
        // face buttons, edge-detected: A (right 4) advance, B (right 5) auto, X (left 4) log, Y (left 5) menu
        const gp = src && !src.hand ? src.gamepad : null, b = btn[i], b4 = !!gp?.buttons[4]?.pressed, b5 = !!gp?.buttons[5]?.pressed, left = src?.handedness === 'left';
        if (b4 && !b[0]) { if (!left) advance(); else { if (logLines) logLines = null; view.onToggle('log'); } }
        if (b5 && !b[1]) { if (!left) view.onToggle('auto'); else if (menuData) { closeMenu(); view.onMenu('close'); } else view.onToggle('menu'); } // Y closes like 닫기 (DomView's Esc)
        b[0] = b4; b[1] = b5;
      }
    },
  };
  return view;
}

/** DOM- and GL-free check of the pure helpers (node, with 'three' resolved to anything); throws on a failure */
export function selfCheck() {
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`XRView: ${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }, one = () => 1;
  eq(wrapText('あいうえおかきくけこ', 5, one), ['あいうえお', 'かきくけこ'], 'kana break anywhere');
  eq(wrapText('あいうえお。かき', 5, one), ['あいうえ', 'お。かき'], 'no 。 at a line start');
  eq(wrapText('あい「うえ', 3, one), ['あい', '「うえ'], 'no 「 at a line end');
  eq(wrapText('안녕 반가워 오늘은', 6, one), ['안녕 반가워', '오늘은'], 'Hangul wraps at spaces');
  eq(wrapText('hello world', 7, one), ['hello', 'world'], 'Latin words');
  eq(wrapText('abcdefghij', 4, one), ['abcd', 'efgh', 'ij'], 'a word wider than the line');
  eq(wrapText('一行\n二行', 9, one), ['一行', '二行'], 'newlines'); eq(wrapText('', 5, one), [''], 'empty');
  eq(fitText('あいうえおかきくけこ', [10, 5], 5, 10, 1, (s) => () => s / 5).size, 5, 'fit shrinks'); eq(fitText('あい', [10, 5], 5, 10, 1, (s) => () => s / 5).size, 10, 'fit keeps big');
  const items = [{ x: 0, y: 0, w: 10, h: 10, key: 'a' }, { x: 5, y: 5, w: 10, h: 10, key: 'b' }];
  eq(itemAt(items, 6, 6)?.key, 'b', 'topmost item'); eq(itemAt(items, 2, 2)?.key, 'a', 'item'); eq(itemAt(items, 20, 1), null, 'miss');
  const n = { min: 0, max: 1, step: 0.05 };
  eq(stepParam(n, 0.35, 1), 0.4, 'step up'); eq(stepParam(n, 0.33, -1), 0.3, 'snaps to the grid'); eq(stepParam(n, 1, 1), 1, 'clamped');
  eq(stepParam({ type: 'enum', values: [['a', 'A'], ['b', 'B']] }, 'b', 1), 'a', 'enum wraps'); eq(stepParam({ type: 'enum', values: [['a', 'A'], ['b', 'B']] }, 'a', -1), 'b', 'enum back');
  eq(stepParam({ min: 0, max: 1, step: 1 }, 1, 1), 0, 'switch'); eq(stepParam({ type: 'bool' }, false, 1), true, 'bool');
  eq(fmtParam(n, 0.4), '0.40', 'fmt step'); eq(fmtParam({ min: 0, max: 60, step: 1 }, 12), '12', 'fmt int'); eq(fmtParam({ type: 'enum', values: [['a', '에이']] }, 'a'), '에이', 'fmt enum');
  eq(fitFromEnd([3, 3, 3], 7), 1, 'page from the end'); eq(fitFromEnd([3, 3, 3], 7, 1), 0, 'older page'); eq(fitFromEnd([9], 7), 0, 'at least one'); eq(fitFromEnd([], 7), 0, 'none');
  return true;
}
