"""Speech-to-text worker for scripts/server.py: one request per stdin line {"path": audio file}, one JSON line back
{"text", "lang"} (or {"error"}). Its own process because faster-whisper's CTranslate2 brings an OpenMP runtime that
clashes with Anaconda's (OMP #15): KMP_DUPLICATE_LIB_OK is set here only, not in the server.

Model: faster-whisper large-v3-turbo on the CPU (int8). The GPU is left to the page and the LLM; CTranslate2 4.5 also
wants cuDNN 9, which this machine's torch (cuDNN 8) doesn't ship. Set STT_DEVICE=cuda once it does.
"""
import json
import os
import sys

os.environ.setdefault('KMP_DUPLICATE_LIB_OK', 'TRUE')
from faster_whisper import WhisperModel  # noqa: E402

MODEL = os.environ.get('STT_MODEL', 'mobiuslabsgmbh/faster-whisper-large-v3-turbo')
DEVICE = os.environ.get('STT_DEVICE', 'cpu')
model = WhisperModel(MODEL, device=DEVICE, compute_type='int8' if DEVICE == 'cpu' else 'int8_float16', cpu_threads=os.cpu_count() or 4)
print(json.dumps({'ready': True}), flush=True)
for line in sys.stdin:
    try:
        req = json.loads(line)
        segs, info = model.transcribe(req['path'], beam_size=1, language=req.get('lang') or None, vad_filter=True)
        print(json.dumps({'text': ''.join(s.text for s in segs).strip(), 'lang': info.language}, ensure_ascii=False), flush=True)
    except Exception as e:
        print(json.dumps({'error': str(e)}), flush=True)
