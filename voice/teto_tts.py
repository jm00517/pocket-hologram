"""Japanese text -> speech with the Kasane Teto UTAU CV library (assets/voice/teto/cv, not redistributed).

Concatenative "talkloid": OpenJTalk splits the text into morae and accent phrases, a Tokyo pitch-accent
contour gives each mora a pitch, and every mora is cut from its CV sample per oto.ini (consonant kept,
vowel stretched to length), re-pitched with the WORLD vocoder and joined.

    python voice/teto_tts.py "こんにちは、テトだよ。" out.wav
"""
import functools, json, os, re, sys
import numpy as np
import pyopenjtalk
import pyworld
import soundfile as sf

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'voice', 'teto', 'cv')
FP = 5.0                 # WORLD frame period, ms
BASE_HZ = 245.0          # speaking pitch (low tone); high tone is +4 semitones
MORA_S = 0.125           # target mora length at rate 1
KATA = {chr(c): chr(c - 0x60) for c in range(0x30A1, 0x30F7)}  # katakana -> hiragana
VOWEL = {**{k: 'a' for k in 'あかさたなはまやらわがざだばぱぁゃ'}, **{k: 'i' for k in 'いきしちにひみりぎじぢびぴぃ'},
         **{k: 'u' for k in 'うくすつぬふむゆるぐずづぶぷぅゅゔ'}, **{k: 'e' for k in 'えけせてねへめれげぜでべぺぇ'},
         **{k: 'o' for k in 'おこそとのほもよろをごぞどぼぽぉょ'}, 'ん': 'n'}


@functools.lru_cache(None)
def oto():
    """alias -> (wav, offset, consonant, cutoff, preutter, overlap) in ms; plain CV aliases only."""
    out = {}
    for line in open(os.path.join(ROOT, 'oto.ini'), encoding='cp932'):
        if '=' not in line:
            continue
        wav, rest = line.strip().split('=', 1)
        alias, *v = rest.split(',')
        if alias and not alias.startswith(('-', '*')) and alias not in out:
            out[alias] = (wav, *map(float, v))
    return out


@functools.lru_cache(None)
def analysis(wav):
    """WORLD analysis of one sample, cached in memory and on disk next to the library (local only)."""
    cache = os.path.join(ROOT, '..', 'world_cache', os.path.splitext(wav)[0] + '.npz')
    if os.path.exists(cache):
        d = np.load(cache)
        return d['f0'], d['sp'].astype(np.float64), d['ap'].astype(np.float64), int(d['fs'])
    x, fs = sf.read(os.path.join(ROOT, wav))
    x = x.astype(np.float64) if x.ndim == 1 else x.mean(1).astype(np.float64)
    f0, t = pyworld.dio(x, fs, frame_period=FP)
    f0 = pyworld.stonemask(x, f0, t, fs)
    sp, ap = pyworld.cheaptrick(x, f0, t, fs), pyworld.d4c(x, f0, t, fs)
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    np.savez(cache, f0=f0, sp=sp.astype(np.float32), ap=ap.astype(np.float32), fs=fs)
    return f0, sp, ap, fs


def morae(text):
    """text -> list of accent phrases, each a list of hiragana morae; pauses as None, plus the accent nucleus."""
    phrases, cur, acc = [], [], 0
    for w in pyopenjtalk.run_frontend(text):
        pron = w['pron'].replace('’', '')
        if w['pos'] == '記号' or pron == '、':
            if cur:
                phrases.append((cur, acc))
            phrases.append((None, 0))
            cur = []
            continue
        if w['chain_flag'] != 1 and cur:
            phrases.append((cur, acc))
            cur = []
        if not cur:
            acc = w['acc']
        kana = ''.join(KATA.get(c, c) for c in pron)
        for m in re.findall(r'.[ゃゅょぁぃぅぇぉ]?', kana):
            cur.append(m)
    if cur:
        phrases.append((cur, acc))
    return phrases


def pitch_plan(phrases):
    """-> [(mora or None, hz)] with Tokyo accent and a gentle declination over the sentence."""
    out, k, total = [], 0, sum(len(p) for p, _ in phrases if p)
    for p, acc in phrases:
        if p is None:
            out.append((None, 0))
            continue
        for i, m in enumerate(p):
            high = (i == 0 and acc == 1) or (i > 0 and (acc == 0 or i < acc))
            decl = 2 ** (-2.5 * k / max(total, 1) / 12)        # ~2.5 semitones down across the sentence
            out.append((m, BASE_HZ * (2 ** (4 / 12) if high else 1) * decl))
            k += 1
    return out


def sample_for(m):
    o = oto()
    if m == 'ー' or m == 'っ':
        return None
    for alias in (m, m.replace('を', 'お'), m[0]):
        if alias in o:
            return o[alias]
    return None


def synth(text, rate=1.0):
    """-> (wave float32, fs, [{v, t}]) where t is each mora's start in seconds."""
    plan = pitch_plan(morae(text))
    F0, SP, AP, marks, fs, prev = [], [], [], [], None, None
    nfr = lambda ms: max(1, int(round(ms / FP)))
    for m, hz in plan:
        t0 = sum(len(a) for a in F0) * FP / 1000
        if m is None or m == 'っ':                       # pause / geminate: silence
            n = nfr((260 if m is None else 90) / rate)
            if fs is not None:
                F0.append(np.zeros(n)); SP.append(np.tile(SP[-1][-1:] * 1e-6, (n, 1))); AP.append(np.ones((n, AP[-1].shape[1])))
            continue
        if m == 'ー' and prev is not None:                # long vowel: hold the previous vowel
            f0, sp, ap = prev
            n = nfr(MORA_S * 1000 / rate)
            F0.append(np.full(n, hz)); SP.append(np.tile(sp[-1:], (n, 1))); AP.append(np.tile(ap[-1:], (n, 1)))
            marks.append({'v': marks[-1]['v'] if marks else 'a', 't': t0})
            continue
        s = sample_for(m)
        if s is None:
            continue
        wav, off, cons, cut, pre, ovl = s
        f0, sp, ap, fs = analysis(wav)
        a = nfr(max(off, 0))
        end = (len(f0) - nfr(cut)) if cut >= 0 else a + nfr(-cut)
        c = min(a + nfr(cons), end - 2)
        consonant = slice(max(a, a + nfr(cons) - nfr(min(pre, 90))), c)   # at most ~90 ms of lead-in
        n_cons = consonant.stop - consonant.start
        n_vow = max(nfr(45), nfr(MORA_S * 1000 / rate) - n_cons)
        idx = np.linspace(c, end - 1, n_vow).astype(int)              # stretch/compress the steady vowel
        sel = np.r_[np.arange(consonant.start, consonant.stop), idx]
        g = f0[sel].copy()
        g[g > 0] = hz                                                  # unvoiced frames stay unvoiced
        F0.append(g); SP.append(sp[sel]); AP.append(ap[sel])
        marks.append({'v': VOWEL.get(m[-1] if m[-1] in VOWEL else m[0], 'a'), 't': t0 + n_cons * FP / 1000})
        prev = (g, sp[sel], ap[sel])
    if fs is None:
        return np.zeros(1, np.float32), 44100, []
    f0 = np.concatenate(F0)
    # glide between morae instead of stepping: smooth the voiced pitch track
    v = f0 > 0
    if v.any():
        lf = np.log(np.where(v, f0, np.interp(np.arange(len(f0)), np.flatnonzero(v), f0[v])))
        lf = np.convolve(np.pad(lf, 6, mode='edge'), np.ones(13) / 13, mode='valid')
        f0 = np.where(v, np.exp(lf), 0)
    y = pyworld.synthesize(f0, np.ascontiguousarray(np.concatenate(SP)), np.ascontiguousarray(np.concatenate(AP)), fs, FP)
    y = y / max(1e-6, np.abs(y).max()) * 0.8
    return y.astype(np.float32), fs, marks


if __name__ == '__main__':
    p = pitch_plan(morae('今日はいい天気'))
    assert p[0][0] == 'きょ' and p[1][0] == 'ー', p
    y, fs, marks = synth(sys.argv[1] if len(sys.argv) > 1 else 'こんにちは、テトだよ。')
    sf.write(sys.argv[2] if len(sys.argv) > 2 else 'out.wav', y, fs)
    print(json.dumps({'seconds': round(len(y) / fs, 2), 'morae': len(marks)}))
