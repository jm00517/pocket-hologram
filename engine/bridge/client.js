// Page side of the agent bridge. Long-polls the dev server for commands, runs them with engine.call(), posts
// the result back. Server side: engine/bridge/relay.py. Agents use engine/bridge/cli.py or plain HTTP:
//   POST /api/engine {"cmd": "set", "args": {"values": {"post.bloom": 0.4}}}  ->  {"ok": true, "result": ...}
// Without a bridge-enabled server the first poll 404s and the client stops quietly.
export function connectBridge(engine, { url = '/api/engine' } = {}) {
  let stopped = false, fails = 0;
  (async function loop() {
    while (!stopped) {
      let job;
      try {
        const r = await fetch(`${url}/poll`, { cache: 'no-store' });
        if (r.status === 404) return; // server has no bridge
        if (r.status === 204) { fails = 0; continue; } // poll timed out, nothing to do
        job = await r.json(); fails = 0;
      } catch {
        await new Promise((res) => setTimeout(res, Math.min(10000, 500 * 2 ** fails++))); // server restarting
        continue;
      }
      let reply;
      try { reply = { id: job.id, ok: true, result: await engine.call(job.cmd, job.args) }; }
      catch (e) { reply = { id: job.id, ok: false, error: String(e?.message ?? e) }; }
      try { reply = JSON.parse(JSON.stringify(reply)); } catch (e) { reply = { id: job.id, ok: false, error: `result not JSON-able: ${e.message}` }; }
      await fetch(`${url}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reply) }).catch(() => {});
    }
  })();
  return { stop() { stopped = true; } };
}
