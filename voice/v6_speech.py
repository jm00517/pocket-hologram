"""Speech through VOCALOID6 (Hatsune Miku V6): one note per mora under a drawn pitch line (Fujisaki model of the
Tokyo accent from teto_tts), speech durations and phrase dynamics.

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
            _proc.kill()  # else every later request starts another engine holding a voice model
            _proc = None
            raise RuntimeError(f'VOCALOID6 engine did not start: {ready}')
    return _proc


# --- speech prosody ------------------------------------------------------------------------------------------
# Notes alone sing: every mora the same length on a semitone step. Speech glides. The score carries a pitch line
# drawn through the notes (the engine's direct pitch, cents from A4) from a Fujisaki model of Tokyo Japanese:
#   ln F0(t) = ln Fb + sum Ap Gp(t - T0) + sum Aa (Ga(t - T1) - Ga(t - T2))
# a phrase command at the start and after each pause (the voice starts up and sinks through the phrase) and an
# accent command over each phrase's high morae (from the accent nucleus); a question rises at the end.
# Durations: phrase-final morae lengthen, devoiced i/u (です's す, きた's き) shrink, a slight jitter so it isn't
# a metronome. Dynamics follow the phrase: strong at its start, fading toward the sentence end.
MORA_S = 0.118
ALPHA, BETA, GAMMA = 3.0, 20.0, 0.9          # Fujisaki phrase / accent time constants (1/s), accent ceiling
FB_HZ = teto_tts.BASE_HZ * 0.93
VOICELESS = set('かきくけこさしすせそたちつてとはひふへほぱぴぷぺぽきゃきゅきょしゃしゅしょちゃちゅちょ')


def _gp(t): return ALPHA * ALPHA * t * math.exp(-ALPHA * t) if t > 0 else 0.0
def _ga(t): return min(1 - (1 + BETA * t) * math.exp(-BETA * t), GAMMA) if t > 0 else 0.0


def _devoiced(m, nxt):
    v = teto_tts.VOWEL.get(m[-1] if m[-1] in teto_tts.VOWEL else m[0], 'a')
    return v in 'iu' and m[0] in VOICELESS and (nxt is None or nxt[0] in VOICELESS)


def score(text):
    """text -> ({'notes', 'pitch', 'controllers'}, marks): speech prosody (see above)."""
    phrases = teto_tts.morae(text)
    question = text.rstrip().endswith(('？', '?'))
    rnd = __import__('random').Random(hash(text) & 0xffff)  # same text, same reading
    # timeline: (kind, mora, start s, dur s, high?) ; pauses advance time only
    t, items, phrase_cmds, accent_cmds = 0.0, [], [], []
    seq = [m for p, _ in phrases if p for m in p]
    k = 0
    for pi, (p, acc) in enumerate(phrases):
        if p is None:
            t += 0.2 if items and any(q for q, _ in phrases[pi + 1:]) else 0.0  # only between phrases, not after the last
            continue
        if not phrase_cmds or (pi > 0 and phrases[pi - 1][0] is None):
            # the command comes before the voice (during the pause), so the phrase is already sinking when it starts;
            # Gp peaks at alpha/e ~ 1.1: +4.8 st, +3 st
            phrase_cmds.append((t - 0.2, 0.25 if not phrase_cmds else 0.16))
        a0 = a1 = None
        last_phrase = all(q is None for q, _ in phrases[pi + 1:])
        before_pause = pi + 1 >= len(phrases) or phrases[pi + 1][0] is None
        for i, m in enumerate(p):
            nxt = seq[k + 1] if k + 1 < len(seq) else None
            d = MORA_S * rnd.uniform(0.94, 1.06)
            if m == 'ん': d *= 0.9
            if _devoiced(m, nxt): d *= 0.6
            if i == len(p) - 1 and before_pause: d *= 1.6 if last_phrase else 1.3
            high = (i == 0 and acc == 1) or (i > 0 and (acc == 0 or i < acc))
            if high and a0 is None: a0 = t
            if high: a1 = t + d
            items.append((m, t, d))
            t, k = t + d, k + 1
        if a0 is not None:
            accent_cmds.append((a0 - 0.02, a1 - 0.03, 0.22))  # ~ +3.8 st on the high morae
    end = t
    if not question:
        phrase_cmds.append((end - 0.45, -0.12))  # final lowering: a statement settles down at its end

    def ln_f0(x):
        v = math.log(FB_HZ) + sum(ap * _gp(x - t0) for t0, ap in phrase_cmds)
        v += sum(aa * (_ga(x - t1) - _ga(x - t2)) for t1, t2, aa in accent_cmds)
        if question and items:
            m_last, s_last, d_last = items[-1]
            v += 0.32 * min(max((x - s_last - d_last * 0.3) / (d_last * 0.7), 0.0), 1.0)
        return v

    midi = lambda x: 69 + 12 * (ln_f0(x) - math.log(440)) / math.log(2)
    tick = lambda s: int(round(s * TPS))
    notes, marks = [], []
    for m, s, d in items:
        if m in ('ー', 'っ') and notes:  # long vowel: hold the note; geminate: hold (the gap is the next consonant)
            notes[-1]['duration'] = tick(s + d) - notes[-1]['start']
            continue
        notes.append({'start': tick(s), 'duration': max(30, tick(s + d) - tick(s)), 'pitch': round(midi(s + d / 2)), 'lyric': m})
        marks.append({'v': teto_tts.VOWEL.get(m[-1] if m[-1] in teto_tts.VOWEL else m[0], 'a'), 't': tick(s) / TPS})
    pitch = [{'tick': tk, 'value': round((midi(tk / TPS) - 69) * 100, 1)} for tk in range(0, tick(end) + 40, 20)]
    dyn = [{'type': 'Dynamics', 'tick': tk, 'value': int(round(56 + 22 * min(1.0, sum(ap * _gp(tk / TPS - t0) for t0, ap in phrase_cmds) / 0.27)
                                                                   - 10 * (tk / TPS / max(end, 1e-3)) ** 2))} for tk in range(0, tick(end) + 60, 60)]
    return {'notes': notes, 'pitch': pitch, 'controllers': dyn}, marks


def score_flat(text):
    """The old reading, for comparison: one fixed-length note per mora on semitone steps (teto_tts.pitch_plan)."""
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
        # read inside the lock: every render writes the same file, and a parallel request would overwrite it
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
    sc, marks = score_flat('きょうは、いいてんき')
    n = sc['notes']  # きょう -> one held note; は is sung as pronounced (わ); the pause is two ticks of silence
    assert [x['lyric'] for x in n] == ['きょ', 'わ', 'い', 'い', 'て', 'ん', 'き'] and n[0]['duration'] == 2 * TICK and n[2]['start'] == 5 * TICK, n
    assert marks[0]['v'] == 'o' and marks[1]['t'] == 2 * TICK / TPS, marks[:2]
    sc, marks = score('きょうは、いいてんき')  # speech: phrase-final morae longer, a pitch line, falling through the sentence
    n, p = sc['notes'], sc['pitch']
    assert [x['lyric'] for x in n] == ['きょ', 'わ', 'い', 'い', 'て', 'ん', 'き'] and len(marks) == 7, n
    assert n[1]['duration'] > n[2]['duration'] and p[0]['tick'] == 0 and sc['controllers'][0]['type'] == 'Dynamics', n
    q = score('いいてんき？')[0]['pitch']; s = score('いいてんき')[0]['pitch']
    assert q[-1]['value'] > s[-1]['value'] + 300, (q[-1], s[-1])  # a question ends higher
    t0 = time.time(); wav, marks = synth(sys.argv[1] if len(sys.argv) > 1 else 'こんにちは、ミクです')
    print(json.dumps({'ms': round((time.time() - t0) * 1000), 'bytes': len(wav), 'morae': len(marks)}))
