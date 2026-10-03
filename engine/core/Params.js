// Parameter registry: every tunable value in the engine, self-described so UIs and agents can list and drive
// them without reading code. See ParamDef in engine/types.d.ts.
//   define(defs, owner?)  register (owner groups a map's params so they leave with the map)
//   remove(owner)         drop every param of that owner
//   list()                ParamDef[] in definition order
//   get(id) / values()    current value(s)
//   set(id, v)            validated (number clamped, enum checked), may be async (e.g. a weather change)
//   setMany({ id: v })    in order
const coerce = (p, v) => {
  if (p.type === 'number') { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${p.id}: expected a number`); return Math.min(p.max ?? n, Math.max(p.min ?? n, n)); }
  if (p.type === 'bool') return !!v;
  if (p.type === 'enum') { if (!p.values.some(([k]) => k === v)) throw new Error(`${p.id}: expected one of ${p.values.map(([k]) => k).join(', ')}`); return v; }
  return v;
};

export function createParams() {
  const defs = new Map(), listeners = new Set();
  return {
    define(list, owner = 'engine') {
      for (const d of [].concat(list)) defs.set(d.id, { type: 'number', ...d, owner });
    },
    remove(owner) { for (const [id, d] of defs) if (d.owner === owner) defs.delete(id); },
    has: (id) => defs.has(id),
    list: () => [...defs.values()],
    get(id) { const d = defs.get(id); if (!d) throw new Error(`unknown param ${id}`); return d.get(); },
    values: () => Object.fromEntries([...defs.values()].map((d) => [d.id, d.get()])),
    async set(id, v) {
      const d = defs.get(id); if (!d) throw new Error(`unknown param ${id}`);
      await d.set(coerce(d, v));
      for (const f of listeners) f(id, d.get());
      return d.get();
    },
    async setMany(obj) { for (const [id, v] of Object.entries(obj ?? {})) await this.set(id, v); return this.values(); },
    onChange(f) { listeners.add(f); return () => listeners.delete(f); },
  };
}
