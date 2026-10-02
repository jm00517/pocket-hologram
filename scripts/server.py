"""Local dev server: static files from the repo root (never cached) + POST /api/tts (Kasane Teto speech).

    python scripts/server.py            # http://localhost:3210

/api/tts  {"text": "こんにちは"} -> {"audio": base64 WAV, "marks": [{"v": "a", "t": 0.12}, ...]}
Needs the Teto CV library in assets/voice/teto/cv (see voice/teto_tts.py); without it /api/tts answers 503.
"""
import base64
import io
import json
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'voice'))
try:
    import soundfile as sf
    import teto_tts
    threading.Thread(target=lambda: [teto_tts.analysis(v[0]) for v in teto_tts.oto().values()], daemon=True).start()  # warm every sample
except Exception as e:  # no voice library / deps: the page falls back to browser TTS
    teto_tts = None
    print('tts disabled:', e)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path != '/api/tts':
            return self.send_error(404)
        if teto_tts is None:
            return self.reply(503, {'error': 'tts unavailable'})
        try:
            text = str(json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}').get('text', '')).strip()
            if not text or len(text) > 300:
                raise ValueError('text must be 1-300 characters')
            y, fs, marks = teto_tts.synth(text)
            buf = io.BytesIO(); sf.write(buf, y, fs, format='WAV', subtype='PCM_16')
            self.reply(200, {'audio': base64.b64encode(buf.getvalue()).decode(), 'marks': marks})
        except ValueError as e:
            self.reply(400, {'error': str(e)})
        except Exception as e:
            self.reply(500, {'error': str(e)})

    def reply(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3210
    print(f'serving {ROOT} on http://localhost:{port}')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
