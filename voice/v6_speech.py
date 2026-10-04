"""Speech through VOCALOID6 (Hatsune Miku V6): one mora per short note, Tokyo pitch accent from teto_tts.

Talks to the headless synth CLI from D:/project_private/VOCALOID6-analysis (`synth-cli serve <model>`), one
resident process that renders a score JSON to WAV in ~30 ms per mora after warm-up (9 morae 275 ms, 28 morae
0.6-1.0 s measured). Needs the installed VOCALOID6 models and licences on this PC; nothing is redistributed.

    synth('こんにちは') -> (wav bytes, marks)      marks: [{'v': 'o', 't': 0.0}, ...] for lip sync
"""
import io, json, math, os, subprocess, tempfile, threading, wave
from pathlib import Path

import teto_tts

RUNTIME = Path(os.environ.get('V6_SYNTH', r'D:\project_private\VOCALOID6-analysis\synth-runtime'))
MODEL = os.environ.get('V6_MODEL', 'HATSUNE_MIKU_V6_ORIGINAL')
TICK = 110               # one mora; 960 ticks = 1 s at the engine's 120 bpm -> 0.115 s, like teto's MORA_S
TPS = 960
OUT = Path(tempfile.gettempdir()) / 'pocket-hologram-v6.wav'

_proc, _lock = None, threading.Lock()


def available():
    return (RUNTIME / 'bin' / 'synth-cli.exe').exists()


def _engine():
    global _proc
    if _proc is None or _proc.poll() is not None:
        _proc = subprocess.Popen([str(RUNTIME / 'bin' / 'synth-cli.exe'), 'serve', MODEL], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, text=True, encoding='utf-8', bufsize=1)
        ready = json.loads(_proc.stdout.readline() or '{}')
        if not ready.get('ready'):
            _proc = None
            raise RuntimeError(f'VOCALOID6 engine did not start: {ready}')
    return _proc


def score(text):
    """text -> ({'notes': [...]}, marks). Pitch accent and declination come from teto_tts.pitch_plan."""
    notes, marks, pos = [], [], 0
    for m, hz in teto_tts.pitch_plan(teto_tts.morae(text)):
        if m is None:
            pos += TICK * 2
        elif m in ('ー', 'っ') and notes:  # long vowel: hold the note; geminate: hold, then a gap
            notes[-1]['duration'] += TICK
            pos += TICK
        else:
            notes.append({'start': pos, 'duration': TICK, 'pitch': round(69 + 12 * math.log2(hz / 440)), 'lyric': m})
            marks.append({'v': teto_tts.VOWEL.get(m[-1] if m[-1] in teto_tts.VOWEL else m[0], 'a'), 't': pos / TPS})
            pos += TICK
    return {'notes': notes}, marks


def synth(text):
    sc, marks = score(text)
    if not sc['notes']:
        raise ValueError('nothing to say')
    with _lock:
        p = _engine()
        p.stdin.write(json.dumps({'score': sc, 'outputPath': str(OUT)}, ensure_ascii=False) + '\n'); p.stdin.flush()
        r = json.loads(p.stdout.readline() or '{}')
        if not r.get('ok'):
            raise RuntimeError(r.get('error', 'render failed'))
    # the engine pads the part with half a second of silence: cut it, so clauses played back to back don't gap
    last = sc['notes'][-1]
    with wave.open(str(OUT)) as w:
        keep = int(((last['start'] + last['duration']) / TPS + 0.12) * w.getframerate())
        params, frames = w.getparams(), w.readframes(keep)
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as o:
        o.setparams(params); o.writeframes(frames)
    return buf.getvalue(), marks


if __name__ == '__main__':
    import sys, time
    sc, marks = score('きょうは、いいてんき')
    n = sc['notes']  # きょう -> one held note; は is sung as pronounced (わ); the pause is two ticks of silence
    assert [x['lyric'] for x in n] == ['きょ', 'わ', 'い', 'い', 'て', 'ん', 'き'] and n[0]['duration'] == 2 * TICK and n[2]['start'] == 5 * TICK, n
    assert marks[0]['v'] == 'o' and marks[1]['t'] == 2 * TICK / TPS, marks[:2]
    t0 = time.time(); wav, marks = synth(sys.argv[1] if len(sys.argv) > 1 else 'こんにちは、ミクです')
    print(json.dumps({'ms': round((time.time() - t0) * 1000), 'bytes': len(wav), 'morae': len(marks)}))
