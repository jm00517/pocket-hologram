"""Local dev server: static files from the repo root (never cached) + POST /api/tts (speech)
+ the engine's agent bridge under /api/engine (see engine/bridge/relay.py, engine/bridge/cli.py).

    python scripts/server.py            # http://localhost:3210

/api/tts  {"text": "こんにちは", "voice": "miku"|"teto", "style"?: "whisper"} -> {"audio": base64 WAV, "marks": [{"v": "a", "t": 0.12}, ...], "voice": ...}
Voices: miku = VOCALOID6 Hatsune Miku through the headless synth (voice/v6_speech.py), teto = the Kasane Teto UTAU
bank (voice/teto_tts.py). The default is the first one that works on this machine; with neither, /api/tts answers 503.

/api/chat {"messages": [{"role": "user"|"assistant", "content"}...]} -> {"reply"}: her answer, from a local LLM through
Ollama (PH_LLM, default gemma3:4b), as Miku, in short spoken Japanese. 503 without Ollama.
/api/stt  raw audio (any format ffmpeg/PyAV reads; ?lang=ko) -> {"text", "lang"}: faster-whisper in voice/stt_worker.py.
"""
import base64
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import urllib.request
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


# --- her side of a conversation: a local LLM through Ollama -------------------------------------------------
LLM = os.environ.get('PH_LLM', 'gemma3:4b')
PERSONA = ('あなたは初音ミク。VR空間でユーザーと一緒にいる16歳の女の子。明るくてちょっと照れ屋。'
           '返事は必ず日本語の話し言葉で、1〜2文、40文字以内。絵文字・顔文字・記号（「、。！？」以外）は使わない。'
           'ユーザーは韓国語か日本語で話す。内容を理解して日本語で答える。')
# what her synth can sing: kana, kanji, the prolonged-sound mark and Japanese punctuation (the model adds emoji anyway)
SINGABLE = re.compile(r'[^\u3040-\u30ff\u4e00-\u9fff\u3005\u30fc\u301c、。！？!?ー〜\s]')


def chat(messages):
    msgs = [{'role': 'system', 'content': PERSONA}] + [{'role': m['role'], 'content': str(m['content'])[:300]}
                                                      for m in messages[-12:] if m.get('role') in ('user', 'assistant')]
    body = json.dumps({'model': LLM, 'messages': msgs, 'stream': False, 'keep_alive': '30m',
                       'options': {'temperature': 0.8, 'num_predict': 80}}).encode()
    r = urllib.request.urlopen(urllib.request.Request('http://localhost:11434/api/chat', body, {'Content-Type': 'application/json'}), timeout=120)
    text = SINGABLE.sub('', json.loads(r.read())['message']['content'])
    return re.sub(r'\s+', '', text) or 'えへへ'


# --- your side: speech to text in a worker process (see voice/stt_worker.py) ------------------------------------
_stt, _stt_lock = None, threading.Lock()


def stt(audio, lang=None):
    global _stt
    with _stt_lock:
        if _stt is None or _stt.poll() is not None:
            _stt = subprocess.Popen([sys.executable, str(ROOT / 'voice' / 'stt_worker.py')], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    text=True, encoding='utf-8', bufsize=1)
            if not json.loads(_stt.stdout.readline() or '{}').get('ready'):
                raise RuntimeError('speech recognition did not start')
        with tempfile.NamedTemporaryFile(suffix='.webm', delete=False) as f:
            f.write(audio)
        try:
            _stt.stdin.write(json.dumps({'path': f.name, 'lang': lang}) + '\n'); _stt.stdin.flush()
            r = json.loads(_stt.stdout.readline() or '{}')
        finally:
            os.unlink(f.name)
    if 'error' in r:
        raise RuntimeError(r['error'])
    return r


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
        n = int(self.headers.get('Content-Length', 0))
        if self.path == '/api/chat':
            try:
                return self.reply(200, {'reply': chat(json.loads(self.rfile.read(n) or b'{}').get('messages', []))})
            except OSError as e:  # Ollama isn't running
                return self.reply(503, {'error': f'llm unavailable: {e}'})
            except Exception as e:
                return self.reply(500, {'error': str(e)})
        if self.path.startswith('/api/stt'):
            try:
                lang = (self.path.split('lang=')[1].split('&')[0] if 'lang=' in self.path else None) or None
                return self.reply(200, stt(self.rfile.read(n), lang))
            except Exception as e:
                return self.reply(500, {'error': str(e)})
        if self.path != '/api/tts':
            return self.send_error(404)
        if not VOICES:
            return self.reply(503, {'error': 'tts unavailable'})
        try:
            req = json.loads(self.rfile.read(n) or b'{}')
            text, voice = str(req.get('text', '')).strip(), req.get('voice') or next(iter(VOICES))
            if not text or len(text) > 300:
                raise ValueError('text must be 1-300 characters')
            if voice not in VOICES:
                raise ValueError(f'voice must be one of {list(VOICES)}')
            # style 'whisper' (Miku only): you're right at her ear
            wav, marks = VOICES[voice](text, req['style']) if voice == 'miku' and req.get('style') else VOICES[voice](text)
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
