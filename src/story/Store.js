// Story saves: slots ('auto' and the player's own) and one 'global' record that outlives them (lines already read,
// for skip; the memories gallery; settings). The dev server keeps them as files in saves/ (/api/save). Without it
// (a static host, an older server) they go to this browser's localStorage under 'ph.save.<slot>' for the rest of the
// session. A request that fails outright (server restarting) falls back for that one call only: the next load reads
// the server, so latching onto localStorage would lose everything saved after.
const SLOT = /^[\w-]{1,32}$/, KEY = 'ph.save.';
const blank = () => ({ read: [], memories: {}, settings: {} });

export function createStore({ base = 'api/save' } = {}) {
  let local = null; // Promise<bool>: the first call asks the list route once; true = localStorage from here on
  const probe = () => local ??= fetch(base, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null)).then((j) => !Array.isArray(j?.slots), () => true) // also catches HTML from a static host (not JSON)
    .then((l) => { if (l) console.warn(`story saves: no ${base} on this server, saving to localStorage`); return l; });
  const gone = () => { console.warn('story saves: server lost, saving to localStorage'); local = Promise.resolve(true); };
  const ls = {
    load: (slot) => { try { return JSON.parse(localStorage.getItem(KEY + slot)); } catch { return null; } },
    save: (slot, obj) => { localStorage.setItem(KEY + slot, JSON.stringify(obj)); }, // throws on a full quota: the caller hears of it
    remove: (slot) => { localStorage.removeItem(KEY + slot); },
    list: () => {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k.startsWith(KEY)) continue;
        const slot = k.slice(KEY.length), o = ls.load(slot) ?? {};
        out.push({ slot, time: o.time ?? 0, label: o.label ?? '', thumb: o.thumb ?? null });
      }
      return out.sort((a, b) => b.time - a.time);
    },
  };
  // one request; a missing route (404/405/501) or no server at all falls through to the local copy of the operation
  async function call(method, slot, body, fallback) {
    if (slot !== null && !SLOT.test(slot)) throw new Error(`bad save slot '${slot}' (letters, digits, _ -, up to 32)`);
    if (await probe()) return fallback();
    let r;
    const json = body && JSON.stringify(body);
    try {
      // keepalive: the autosave on pagehide still lands as the page goes away (already 'hidden' by then). Only then:
      // browsers cap all keepalive bodies in flight together at 64 KB, so two at a scene's end could both fail
      const keepalive = document.visibilityState === 'hidden' && new TextEncoder().encode(json).length < 60000;
      r = await fetch(slot === null ? base : `${base}/${slot}`, { method, cache: 'no-store', ...(json && { headers: { 'Content-Type': 'application/json' }, body: json, keepalive }) });
    } catch { return fallback(); }
    if (method === 'GET' && slot !== null && r.status === 404) return null; // the route is there (probed): just no such slot
    if ([404, 405, 501].includes(r.status)) { gone(); return fallback(); }
    if (!r.ok) throw new Error(`save ${method} ${slot ?? ''}: HTTP ${r.status}`);
    return r.json().catch(() => ({}));
  }

  let gp = null, gObj = null, writing = null, dirty = false;
  const store = {
    load: (slot) => call('GET', slot, null, () => ls.load(slot)),
    save: (slot, obj) => call('PUT', slot, obj, () => ls.save(slot, obj)),
    remove: (slot) => call('DELETE', slot, null, () => ls.remove(slot)),
    async list() {
      const r = await call('GET', null, null, () => ({ slots: ls.list() }));
      return (r?.slots ?? []).filter((s) => s.slot !== 'global');
    },
    /** the same object every time (mutate it, then setGlobal); a failed load isn't cached, so it can't be saved over */
    global() {
      return gp ??= store.load('global').then((o) => (gObj = { ...blank(), ...(o ?? {}) }), (e) => { gp = null; throw e; });
    },
    /** written at most once at a time: a call during a write folds into one more write after it (every line marks a read) */
    setGlobal(obj) {
      gObj = obj; gp = Promise.resolve(obj);
      if (writing) { dirty = true; return writing; }
      return writing = (async () => { do { dirty = false; await store.save('global', gObj); } while (dirty); })().finally(() => { writing = null; });
    },
  };
  return store;
}
