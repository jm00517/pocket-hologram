"""Drive the open page from a shell (for agents). Needs the dev server with the bridge and the app open in a browser.

    python engine/bridge/cli.py status                       # is a page connected?
    python engine/bridge/cli.py describe                     # maps, params (ranges, docs, values), commands, state
    python engine/bridge/cli.py map pool
    python engine/bridge/cli.py set post.bloom=0.4 sky.cover=0.5
    python engine/bridge/cli.py get post.bloom
    python engine/bridge/cli.py snapshot out.jpg [width]     # writes the image file
    python engine/bridge/cli.py perf
    python engine/bridge/cli.py call camera '{"position":[3,1.6,4],"target":[0,1,0]}'
    python engine/bridge/cli.py eval "return engine.map"

--url http://127.0.0.1:3210 (default) picks the server. Prints JSON; exit code 1 on error.
"""
import base64
import json
import sys
import urllib.error
import urllib.request


def request(url, method='GET', body=None, timeout=90):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b'{}') or {'ok': False, 'error': f'HTTP {e.code}'}


def call(base, cmd, args=None):
    return request(f'{base}/api/engine', 'POST', {'cmd': cmd, 'args': args or {}})


def value(s):
    try:
        return json.loads(s)
    except ValueError:
        return s


def main(argv):
    sys.stdout.reconfigure(encoding='utf-8')  # labels are Korean; Windows consoles default to a legacy codepage
    base = 'http://127.0.0.1:3210'
    if '--url' in argv:
        i = argv.index('--url'); base = argv[i + 1]; del argv[i:i + 2]
    if not argv:
        print(__doc__); return 1
    cmd, rest = argv[0], argv[1:]
    if cmd == 'status':
        out = request(f'{base}/api/engine/status')
    elif cmd == 'set':
        out = call(base, 'set', {'values': {k: value(v) for k, v in (a.split('=', 1) for a in rest)}})
    elif cmd == 'get':
        out = call(base, 'get', {'ids': rest} if rest else {})
    elif cmd == 'map':
        out = call(base, 'map', {'id': None if rest[0] in ('none', 'null') else rest[0]})
    elif cmd == 'snapshot':
        path = rest[0] if rest else 'snapshot.jpg'
        out = call(base, 'snapshot', {'type': 'image/png' if path.endswith('.png') else 'image/jpeg', **({'width': int(rest[1])} if len(rest) > 1 else {})})
        if out.get('ok'):
            with open(path, 'wb') as f:
                f.write(base64.b64decode(out['result']['dataUrl'].split(',', 1)[1]))
            out = {'ok': True, 'file': path, 'width': out['result']['width'], 'height': out['result']['height']}
    elif cmd == 'eval':
        out = call(base, 'eval', {'code': ' '.join(rest)})
    elif cmd == 'call':
        out = call(base, rest[0], value(rest[1]) if len(rest) > 1 else {})
    else:
        out = call(base, cmd, value(rest[0]) if rest else {})
    print(json.dumps(out, ensure_ascii=False, indent=1))
    return 0 if out.get('ok', True) else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
