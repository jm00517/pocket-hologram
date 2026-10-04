"""Local dev server: static files from the repo root (never cached) + POST /api/tts (speech)
+ the engine's agent bridge under /api/engine (see engine/bridge/relay.py, engine/bridge/cli.py).

    python scripts/server.py            # http://localhost:3210

/api/tts  {"text": "こんにちは", "voice": "miku"|"teto"} -> {"audio": base64 WAV, "marks": [{"v": "a", "t": 0.12}, ...], "voice": ...}
Voices: miku = VOCALOID6 Hatsune Miku through the headless synth (voice/v6_speech.py), teto = the Kasane Teto UTAU
bank (voice/teto_tts.py). The default is the first one that works on this machine; with neither, /api/tts answers 503.
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
sys.path.insert(0, str(ROOT / 'engine' / 'bridge'))
from relay import Bridge  # engine/bridge/relay.py

BRIDGE = Bridge()
VOICES = {}  # name -> synth(text) -> (wav bytes, marks); insertion order is the default preference
try:
    import soundfile as sf
    import teto_tts

    def teto(text):
        y, fs, marks = teto_tts.synth(text)
        buf = io.BytesIO(); sf.write(buf, y, fs, format='WAV', subtype='PCM_16')
        return buf.getvalue(), marks
    threading.Thread(target=lambda: [teto_tts.analysis(v[0]) for v in teto_tts.oto().values()], daemon=True).start()  # warm every sample
    import v6_speech
    if v6_speech.available():
        VOICES['miku'] = v6_speech.synth
        threading.Thread(target=lambda: v6_speech.synth('あ'), daemon=True).start()  # start the engine and warm it
    VOICES['teto'] = teto
except Exception as e:  # no voice library / deps: the page falls back to browser TTS
    print('tts disabled:', e)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        if not BRIDGE.handle(self):
            super().do_GET()

    def do_POST(self):
        if BRIDGE.handle(self):
            return
        if self.path != '/api/tts':
            return self.send_error(404)
        if not VOICES:
            return self.reply(503, {'error': 'tts unavailable'})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            text, voice = str(req.get('text', '')).strip(), req.get('voice') or next(iter(VOICES))
            if not text or len(text) > 300:
                raise ValueError('text must be 1-300 characters')
            if voice not in VOICES:
                raise ValueError(f'voice must be one of {list(VOICES)}')
            wav, marks = VOICES[voice](text)
            self.reply(200, {'audio': base64.b64encode(wav).decode(), 'marks': marks, 'voice': voice})
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
