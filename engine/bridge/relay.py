"""Server side of the agent bridge: relays commands from HTTP clients (agents, cli.py) to the open page.

Plug into any http.server handler (must be a ThreadingHTTPServer: poll requests block):

    from relay import Bridge           # engine/bridge on sys.path
    BRIDGE = Bridge()
    def do_GET(self):  if BRIDGE.handle(self): return; ...
    def do_POST(self): if BRIDGE.handle(self): return; ...

Routes (prefix /api/engine):
    POST /api/engine          {"cmd", "args", "timeout"?}  -> waits for the page -> {"ok", "result"|"error"}
                              503 if no page polled in the last 60 s, 504 if the page didn't answer in time
    GET  /api/engine/poll     page: blocks up to 25 s for the next job -> {"id","cmd","args"} | 204
    POST /api/engine/result   page: {"id","ok","result"|"error"}
    GET  /api/engine/status   {"page_polling": n, "last_poll_s": seconds | null, "queued": n}
Only bind the server to 127.0.0.1: the "eval" command runs arbitrary JS in the page.
"""
import itertools
import json
import queue
import threading
import time


class Bridge:
    PREFIX = '/api/engine'

    def __init__(self):
        self.jobs = queue.Queue()
        self.waiting = {}            # id -> [Event, reply]
        self.ids = itertools.count(1)
        self.last_poll = None
        self.polling = 0             # pages blocked in /poll right now

    def handle(self, h):
        path = h.path.split('?')[0]
        if not path.startswith(self.PREFIX):
            return False
        route = path[len(self.PREFIX):]
        try:
            if h.command == 'POST' and route == '':
                self._call(h)
            elif h.command == 'GET' and route == '/poll':
                self._poll(h)
            elif h.command == 'POST' and route == '/result':
                self._result(h)
            elif h.command == 'GET' and route == '/status':
                age = None if self.last_poll is None else round(time.time() - self.last_poll, 1)
                _reply(h, 200, {'page_polling': self.polling, 'last_poll_s': age, 'queued': self.jobs.qsize()})
            else:
                _reply(h, 404, {'error': 'unknown bridge route'})
        except (BrokenPipeError, ConnectionResetError):
            pass
        return True

    def _call(self, h):
        body = _body(h)
        if not isinstance(body.get('cmd'), str):
            return _reply(h, 400, {'ok': False, 'error': 'body must be {"cmd": str, "args": object}'})
        if not self.polling and not self.waiting and (self.last_poll is None or time.time() - self.last_poll > 60):
            return _reply(h, 503, {'ok': False, 'error': 'no page connected: open the app in a browser'})
        jid, ev = next(self.ids), threading.Event()
        self.waiting[jid] = [ev, None]
        self.jobs.put({'id': jid, 'cmd': body['cmd'], 'args': body.get('args') or {}})
        if not ev.wait(float(body.get('timeout', 60))):
            self.waiting.pop(jid, None)
            return _reply(h, 504, {'ok': False, 'error': 'page did not answer in time'})
        _reply(h, 200, self.waiting.pop(jid)[1])

    def _poll(self, h):
        self.polling += 1
        try:
            job = self.jobs.get(timeout=25)
        except queue.Empty:
            job = None
        finally:
            self.polling -= 1
            self.last_poll = time.time()
        if job is None:
            h.send_response(204); h.end_headers(); return
        if job['id'] not in self.waiting:   # caller gave up
            h.send_response(204); h.end_headers(); return
        _reply(h, 200, job)

    def _result(self, h):
        r = _body(h)
        slot = self.waiting.get(r.get('id'))
        if slot:
            slot[1] = {k: r.get(k) for k in ('ok', 'result', 'error') if k in r}
            slot[0].set()
        _reply(h, 200, {'ok': True})


def _body(h):
    n = int(h.headers.get('Content-Length', 0) or 0)
    return json.loads(h.rfile.read(n) or b'{}') if n else {}


def _reply(h, code, obj):
    data = json.dumps(obj, ensure_ascii=False).encode()
    h.send_response(code)
    h.send_header('Content-Type', 'application/json')
    h.send_header('Content-Length', str(len(data)))
    h.end_headers()
    h.wfile.write(data)
