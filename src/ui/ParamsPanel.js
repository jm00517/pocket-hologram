// Drawer controls generated from the engine's param registry (number -> slider, enum -> select, bool -> checkbox).
// Rebuilt whenever the map changes (map params come and go with their map). Ctrl+Z / Ctrl+Shift+Z (Ctrl+Y)
// undo/redo per drag; a map switch or weather change is a new baseline and clears the history.
export function mountParamsPanel(engine, root, { onReset } = {}) {
  const undo = [], redo = [];
  const fmt = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));
  const row = (p) => {
    const v = p.get(), label = document.createElement('label');
    if (p.type === 'enum') {
      label.className = 'grid'; label.innerHTML = `<select data-id="${p.id}" title="${p.doc ?? ''}">${p.values.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>`;
      label.firstChild.value = v;
      label.firstChild.onchange = (e) => engine.params.set(p.id, e.target.value).catch(console.error);
      return label;
    }
    if (p.type === 'bool') {
      label.className = 'slider'; label.innerHTML = `${p.label}<input type="checkbox" data-id="${p.id}" title="${p.doc ?? ''}">`;
      label.lastChild.checked = v; label.lastChild.onchange = (e) => engine.params.set(p.id, e.target.checked);
      return label;
    }
    label.className = 'slider'; label.title = p.doc ?? '';
    label.innerHTML = `${p.label}<input type="range" min="${p.min}" max="${p.max}" step="${p.step}" data-id="${p.id}"><output></output>`;
    const el = label.querySelector('input'), out = label.querySelector('output');
    el.value = v; out.textContent = fmt(v);
    const mark = () => { el._before ??= p.get(); };
    el.addEventListener('pointerdown', mark); el.addEventListener('keydown', mark);
    el.oninput = () => { mark(); engine.params.set(p.id, +el.value); };
    el.onchange = () => { if (el._before !== undefined && el._before !== +el.value) { undo.push([p.id, el._before]); redo.length = 0; } el._before = undefined; };
    return label;
  };
  function build() {
    root.replaceChildren();
    const list = engine.params.list();
    for (const owner of ['map', 'engine']) for (const p of list.filter((x) => x.owner === owner)) root.append(row(p));
    const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: '맵 기본값으로' });
    reset.onclick = () => onReset?.();
    root.append(reset);
  }
  function sync() {
    for (const el of root.querySelectorAll('[data-id]')) {
      if (!engine.params.has(el.dataset.id)) continue;
      const v = engine.params.get(el.dataset.id);
      if (el.type === 'checkbox') el.checked = v; else el.value = v;
      if (el.nextElementSibling?.tagName === 'OUTPUT') el.nextElementSibling.textContent = fmt(v);
    }
  }
  engine.params.onChange(() => sync());
  engine.on('map', build);
  engine.on('baseline', () => { undo.length = redo.length = 0; sync(); });
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.target.closest?.('input[type=text],textarea,select,#chat')) return;
    const isRedo = e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey), isUndo = e.code === 'KeyZ' && !e.shiftKey;
    const [from, to] = isUndo ? [undo, redo] : isRedo ? [redo, undo] : [];
    if (!from?.length) return;
    e.preventDefault();
    const [id, v] = from.pop();
    if (!engine.params.has(id)) return;
    to.push([id, engine.params.get(id)]); engine.params.set(id, v);
  });
  build();
  return { build, sync };
}
