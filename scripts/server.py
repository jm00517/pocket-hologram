"""Local dev server: static files from the repo root (never cached), her voice and conversation, the story's files and
save slots, and the engine's agent bridge under /api/engine (see engine/bridge/relay.py, engine/bridge/cli.py).

    python scripts/server.py [port]     # http://localhost:3210
    python scripts/server.py --check    # self-check of the reply parser and the path rules (no Ollama, no voices)

/api/tts  {"text": "こんにちは", "voice"?: "miku"|"teto", "style"?: "whisper", "cache"?: bool}
          -> {"audio": base64 WAV, "marks": [{"v": "a", "t": 0.12}, ...], "voice", "cached"?: true}
  Voices: miku = VOCALOID6 Hatsune Miku through the headless synth (voice/v6_speech.py), teto = the Kasane Teto UTAU bank
  (voice/teto_tts.py). The default is the first one that works on this machine; with neither, 503 unless the line is in
  the cache. Cache: assets/voicecache/<sha1 of JSON [voice, style|null, text]>.json, the reply itself. Every request
  reads it; "cache": true also writes it after synthesis (the dev tools bake a story's lines this way).
/api/chat {"messages": [{"role": "user"|"assistant", "content"}...], "context"?: str <= 2000} -> {"reply", "feeling"}:
  her answer from a local LLM through Ollama (PH_LLM, default gemma3:4b), as Miku, in short spoken Japanese, and how
  your last message made her feel (-2..2, Ollama structured output). context (the story's persona()) is appended to
  her persona. 503 without Ollama.
/api/stt  raw audio (any format ffmpeg/PyAV reads; ?lang=ko) -> {"text", "lang"}: faster-whisper in voice/stt_worker.py.
/api/story              GET -> {"files": [{"name": "ch1/intro.ink", "size", "mtime": ms}]}   (story/**/*.ink)
/api/story/<name>.ink   PUT (body: UTF-8 text) -> {"ok", "name", "size"}. name: [\\w-]+ segments joined by '/'.
                        Reading is the static GET /story/<name>.
/api/save               GET -> {"slots": [{"slot", "time", "label", "thumb"}]}   ('global' too: the dev tools list it)
/api/save/<slot>        GET (404 if missing) | PUT (body: a JSON object) | DELETE -> saves/<slot>.json. slot: [\\w-]{1,32}.
"""
import base64
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORY, SAVES, VOICECACHE = ROOT / 'story', ROOT / 'saves', ROOT / 'assets' / 'voicecache'
sys.path.insert(0, str(ROOT / 'voice'))
sys.path.insert(0, str(ROOT / 'engine' / 'bridge'))
from relay import Bridge  # engine/bridge/relay.py

BRIDGE = Bridge()
VOICES = {}  # name -> synth(text[, style]) -> (wav bytes, marks); insertion order is the default preference


def load_voices():
    # not at import: --check must not start a synth engine
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


def tts_key(voice, style, text):
    return hashlib.sha1(json.dumps([voice, style, text], ensure_ascii=False).encode()).hexdigest()


# --- her side of a conversation: a local LLM through Ollama -------------------------------------------------
LLM = os.environ.get('PH_LLM', 'gemma3:4b')
PERSONA = ('あなたは初音ミク。VR空間でユーザーと一緒にいる16歳の女の子。明るくてちょっと照れ屋。'
           '返事は必ず日本語の話し言葉で、1〜2文、40文字以内。絵文字・顔文字・記号（「、。！？」以外）は使わない。'
           'ユーザーは韓国語か日本語で話す。内容を理解して日本語で答える。'
           'JSONで答える。reply = あなたの返事。feeling = ユーザーの最後の言葉であなたがどう感じたか、'
           '-2（とても嫌）〜 0（ふつう）〜 2（とても嬉しい）の整数。')
# the answer's shape, enforced by Ollama's structured output; feeling feeds the story's 'chat' event
ANSWER = {'type': 'object', 'required': ['reply', 'feeling'],
          'properties': {'reply': {'type': 'string'}, 'feeling': {'type': 'integer', 'minimum': -2, 'maximum': 2}}}
# what her synth can sing: kana, kanji, the prolonged-sound mark and Japanese punctuation (the model adds emoji anyway)
SINGABLE = re.compile(r'[^\u3040-\u30ff\u4e00-\u9fff\u3005\u30fc\u301c、。！？!?ー〜\s]')


def parse_answer(content):
    """The model's message -> (reply, feeling). Not the JSON asked for (an old Ollama, a cut-off answer): all of it is
    the reply and she feels nothing; SINGABLE then strips the JSON punctuation and keys along with the emoji."""
    content = content if isinstance(content, str) else ''
    try:
        d = json.loads(content)
    except ValueError:
        d = None
    if not (isinstance(d, dict) and isinstance(d.get('reply'), str)):
        d = {'reply': content}
    try:
        feeling = max(-2, min(2, round(float(d.get('feeling', 0)))))
    except (TypeError, ValueError, OverflowError):
        feeling = 0
    return re.sub(r'\s+', '', SINGABLE.sub('', d['reply'])) or 'えへへ', feeling


def chat(messages, context=''):
    system = PERSONA + ('\n' + context[:2000] if context else '')
    msgs = [{'role': 'system', 'content': system}] + [{'role': m['role'], 'content': str(m['content'])[:300]}
                                                      for m in messages[-12:] if m.get('role') in ('user', 'assistant')]
    body = json.dumps({'model': LLM, 'messages': msgs, 'stream': False, 'keep_alive': '30m', 'format': ANSWER,
                       'options': {'temperature': 0.8, 'num_predict': 120}}).encode()  # the JSON wrapper costs ~20 tokens
    r = urllib.request.urlopen(urllib.request.Request('http://localhost:11434/api/chat', body, {'Content-Type': 'application/json'}), timeout=120)
    return parse_answer(json.loads(r.read())['message']['content'])


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


# --- story files and save slots: names from the URL become paths, so they are checked hard ------------------------
STORY_NAME = re.compile(r'[\w-]+(/[\w-]+)*\.ink', re.ASCII)  # no dots but the extension: no '..', no drive, no '\'
SLOT = re.compile(r'[\w-]{1,32}', re.ASCII)
SLOT_FILE = re.compile(SLOT.pattern + r'\.json', re.ASCII)
DEVICE = re.compile(r'(con|prn|aux|nul|com\d|lpt\d)', re.I)  # Windows opens these as devices, extension or not
MAX_STORY, MAX_SAVE = 2 << 20, 16 << 20  # a save carries a thumbnail data URL and the ink state


def inside(base, rel, rule):
    """base/rel if rel passes rule and lands inside base (a junction in story/ can't lead out), else None."""
    if not isinstance(rel, str) or not rule.fullmatch(rel) or any(DEVICE.fullmatch(s.split('.')[0]) for s in rel.split('/')):
        return None
    p = (base / rel).resolve()
    return p if p.is_relative_to(base.resolve()) else None


def story_path(name):
    return inside(STORY, name, STORY_NAME)


def save_path(slot):
    return inside(SAVES, f'{slot}.json', SLOT_FILE) if isinstance(slot, str) else None


def write(path, data):
    # write beside, then swap: a crash mid-write never leaves half a story or a broken save
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f'.{path.name}.{threading.get_ident()}.tmp')
    tmp.write_bytes(data)
    os.replace(tmp, path)


def story_files():
    return [{'name': p.relative_to(STORY).as_posix(), 'size': (s := p.stat()).st_size, 'mtime': int(s.st_mtime * 1000)}
            for p in sorted(STORY.rglob('*.ink')) if p.is_file()]


def save_slots():
    slots = []
    for p in sorted(SAVES.glob('*.json')):
        if not SLOT.fullmatch(p.stem):
            continue
        if p.stem == 'global':  # the store's read marks/memories (up to 20000 ids), not a save: nothing to show
            slots.append({'slot': 'global', 'time': None, 'label': None, 'thumb': None})
            continue
        try:
            d = json.loads(p.read_text('utf-8'))
        except ValueError:
            d = None
        d = d if isinstance(d, dict) else {}
        slots.append({'slot': p.stem, 'time': d.get('time'), 'label': d.get('label'), 'thumb': d.get('thumb')})
    return slots


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def route(self, prefix):
        """'/api/x/<rest>' -> unquoted rest ('' for '/api/x' itself), or None if the path is elsewhere."""
        path = urllib.parse.urlsplit(self.path).path
        if path == prefix:
            return ''
        return urllib.parse.unquote(path[len(prefix) + 1:]) if path.startswith(prefix + '/') else None

    def body(self, limit):
        n = int(self.headers.get('Content-Length', 0) or 0)
        if n > limit:
            raise OverflowError(f'body over {limit >> 20} MB')
        return self.rfile.read(n)

    def do_GET(self):
        if BRIDGE.handle(self):
            return
        if self.route('/api/story') == '':
            return self.reply(200, {'files': story_files()})
        slot = self.route('/api/save')
        if slot == '':
            return self.reply(200, {'slots': save_slots()})
        if slot is not None:
            p = save_path(slot)
            if not p:
                return self.reply(400, {'error': 'slot must match [\\w-]{1,32}'})
            return self.send(200, p.read_bytes()) if p.is_file() else self.reply(404, {'error': f'no save {slot}'})
        super().do_GET()

    def do_PUT(self):
        try:
            if (name := self.route('/api/story')) is not None:
                p = story_path(name)
                if not p:
                    return self.reply(400, {'error': 'name must be [\\w-]+ segments joined by / ending in .ink'})
                if p.exists() and p.name != name.rsplit('/', 1)[-1]:  # resolve() gives the case on disk: NTFS would overwrite it
                    return self.reply(409, {'error': f'{p.name} already exists (name differs only in case)'})
                data = self.body(MAX_STORY)
                data.decode('utf-8')  # reject anything the compiler would choke on
                write(p, data)
                return self.reply(200, {'ok': True, 'name': name, 'size': len(data)})
            if (slot := self.route('/api/save')) is not None:
                p = save_path(slot)
                if not p:
                    return self.reply(400, {'error': 'slot must match [\\w-]{1,32}'})
                data = self.body(MAX_SAVE)
                if not isinstance(json.loads(data), dict):
                    raise ValueError('a save is a JSON object')
                write(p, data)
                return self.reply(200, {'ok': True, 'slot': slot})
            self.reply(404, {'error': 'not found'})
        except OverflowError as e:
            self.reply(413, {'error': str(e)})
        except ValueError as e:  # bad JSON, bad UTF-8
            self.reply(400, {'error': str(e)})
        except OSError as e:
            self.reply(500, {'error': str(e)})

    def do_DELETE(self):
        if (slot := self.route('/api/save')) is None:
            return self.reply(404, {'error': 'not found'})
        p = save_path(slot)
        if not p:
            return self.reply(400, {'error': 'slot must match [\\w-]{1,32}'})
        try:
            p.unlink(missing_ok=True)
        except OSError as e:  # held open on Windows
            return self.reply(500, {'error': str(e)})
        self.reply(200, {'ok': True, 'slot': slot})

    def do_POST(self):
        if BRIDGE.handle(self):
            return
        n = int(self.headers.get('Content-Length', 0))
        if self.path == '/api/chat':
            try:
                req = json.loads(self.rfile.read(n) or b'{}')
                reply, feeling = chat(req.get('messages', []), str(req.get('context') or ''))
                return self.reply(200, {'reply': reply, 'feeling': feeling})
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
        try:
            req = json.loads(self.rfile.read(n) or b'{}')
            text, voice = str(req.get('text', '')).strip(), str(req.get('voice') or next(iter(VOICES), ''))
            if not text or len(text) > 300:
                raise ValueError('text must be 1-300 characters')
            style = (req.get('style') or None) if voice == 'miku' else None  # 'whisper' (Miku only): you're right at her ear
            cached = VOICECACHE / f'{tts_key(voice, style, text)}.json'
            if voice and cached.is_file():
                try:
                    return self.reply(200, {**json.loads(cached.read_text('utf-8')), 'cached': True})
                except ValueError:
                    pass  # a broken entry: synthesise again (and rewrite it if asked)
            if not VOICES:
                return self.reply(503, {'error': 'tts unavailable'})
            if voice not in VOICES:
                raise ValueError(f'voice must be one of {list(VOICES)}')
            wav, marks = VOICES[voice](text, style) if style else VOICES[voice](text)
            out = {'audio': base64.b64encode(wav).decode(), 'marks': marks, 'voice': voice}
            if req.get('cache'):
                write(cached, json.dumps(out, ensure_ascii=False).encode())
            self.reply(200, out)
        except ValueError as e:
            self.reply(400, {'error': str(e)})
        except Exception as e:
            self.reply(500, {'error': str(e)})

    def reply(self, code, obj):
        self.send(code, json.dumps(obj, ensure_ascii=False).encode())

    def send(self, code, data):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def selfcheck():
    assert parse_answer('{"reply": "こんにちは！", "feeling": 2}') == ('こんにちは！', 2)
    assert parse_answer('{"reply": "やだ", "feeling": -7}') == ('やだ', -2)
    assert parse_answer('{"reply": "うん", "feeling": "x"}') == ('うん', 0)
    assert parse_answer('{"reply": "うん"}') == ('うん', 0)
    assert parse_answer('ありがとう 😊 またね') == ('ありがとうまたね', 0)  # plain text: all reply
    assert parse_answer('{"reply": "こんにち') == ('こんにち', 0)  # cut off mid-JSON: the keys and quotes go
    assert parse_answer('{"reply": 3, "feeling": 1}') == ('えへへ', 0)
    assert parse_answer('') == ('えへへ', 0) and parse_answer(None) == ('えへへ', 0)
    for ok in ('main.ink', 'lib.ink', 'ch1/intro.ink', 'a-b_c/d/e-1.ink'):
        assert story_path(ok) == (STORY / ok).resolve(), ok
    for bad in ('../x.ink', 'a/../b.ink', '/abs.ink', 'C:/x.ink', 'C:x.ink', 'a\\b.ink', '..\\x.ink', 'x.txt', 'x.ink.txt',
                '.ink', 'a//b.ink', 'a/.ink', 'main.ink/', 'main.ink\n', 'con.ink', 'a/NUL.ink', 'lpt1/x.ink', 'é.ink',
                'a b.ink', '', None, '%2e%2e/x.ink', '\\\\server\\share.ink'):
        assert story_path(bad) is None, bad
    for ok in ('auto', 'slot-1', 'q_2', 'a' * 32):
        assert save_path(ok) == (SAVES / f'{ok}.json').resolve(), ok
    for bad in ('', 'a' * 33, '../x', 'a b', 'a.b', 'con', 'x/y', 'x\\y', 'é', None):
        assert save_path(bad) is None, bad
    assert tts_key('miku', None, 'あ') == tts_key('miku', None, 'あ') != tts_key('miku', 'whisper', 'あ')
    print('server self-check ok')


if __name__ == '__main__':
    if sys.argv[1:] == ['--check']:
        sys.exit(selfcheck())
    load_voices()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3210
    print(f'serving {ROOT} on http://localhost:{port}')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
