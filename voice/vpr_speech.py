"""Text (hiragana) -> VOCALOID6 .vpr that 'speaks' it (talkloid style).

Uses the user's own .vpr as a template so voice/part settings match their editor.
ponytail: simple declining pitch contour; add real accent (OpenJTalk) if it sounds too sing-songy.
"""
import copy, json, sys, zipfile

# VOCALOID Japanese phoneme set (hiragana -> phoneme string).
BASE = {
    'あ': 'a', 'い': 'i', 'う': 'M', 'え': 'e', 'お': 'o',
    'か': 'k a', 'き': "k' i", 'く': 'k M', 'け': 'k e', 'こ': 'k o',
    'さ': 's a', 'し': 'S i', 'す': 's M', 'せ': 's e', 'そ': 's o',
    'た': 't a', 'ち': 'tS i', 'つ': 'ts M', 'て': 't e', 'と': 't o',
    'な': 'n a', 'に': 'J i', 'ぬ': 'n M', 'ね': 'n e', 'の': 'n o',
    'は': 'h a', 'ひ': 'C i', 'ふ': 'p\\ M', 'へ': 'h e', 'ほ': 'h o',
    'ま': 'm a', 'み': "m' i", 'む': 'm M', 'め': 'm e', 'も': 'm o',
    'や': 'j a', 'ゆ': 'j M', 'よ': 'j o',
    'ら': '4 a', 'り': "4' i", 'る': '4 M', 'れ': '4 e', 'ろ': '4 o',
    'わ': 'w a', 'を': 'o', 'ん': 'N\\',
    'が': 'g a', 'ぎ': "g' i", 'ぐ': 'g M', 'げ': 'g e', 'ご': 'g o',
    'ざ': 'dz a', 'じ': 'dZ i', 'ず': 'dz M', 'ぜ': 'dz e', 'ぞ': 'dz o',
    'だ': 'd a', 'ぢ': 'dZ i', 'づ': 'dz M', 'で': 'd e', 'ど': 'd o',
    'ば': 'b a', 'び': "b' i", 'ぶ': 'b M', 'べ': 'b e', 'ぼ': 'b o',
    'ぱ': 'p a', 'ぴ': "p' i", 'ぷ': 'p M', 'ぺ': 'p e', 'ぽ': 'p o',
    'ー': '-',
}
YOON_C = {'き': "k'", 'し': 'S', 'ち': 'tS', 'に': 'J', 'ひ': 'C', 'み': "m'", 'り': "4'",
          'ぎ': "g'", 'じ': 'dZ', 'び': "b'", 'ぴ': "p'"}
YOON_V = {'ゃ': 'a', 'ゅ': 'M', 'ょ': 'o'}
PAUSE = set('、。 ,.!?！？')


def moras(text):
    """hiragana -> [(lyric, phoneme)], (None, None) for a pause."""
    out, i = [], 0
    while i < len(text):
        c, n = text[i], text[i + 1] if i + 1 < len(text) else ''
        if n in YOON_V and c in YOON_C:
            out.append((c + n, f'{YOON_C[c]} {YOON_V[n]}'))
            i += 2
            continue
        if c in BASE:
            out.append((c, BASE[c]))
        elif c in PAUSE:
            out.append((None, None))
        else:
            raise ValueError(f'unsupported char: {c!r} (hiragana only for now)')
        i += 1
    return out


def build(text, template, out, tick=110, base_note=64):
    """Write `out` .vpr speaking `text`. tick = mora length (480 = quarter note)."""
    seq = json.loads(zipfile.ZipFile(template).read('Project/sequence.json'))
    part = seq['tracks'][0]['parts'][0]
    proto = part['notes'][0]
    notes, pos, k = [], 0, 0
    for lyric, ph in moras(text):
        if lyric is None:
            pos += tick * 2
            k = 0
            continue
        n = copy.deepcopy(proto)
        # speech-like contour: rise on the 2nd mora, then drift down across the phrase
        n.update(lyric=lyric, phoneme=ph, isProtected=True, pos=pos, duration=tick,
                 number=base_note + (2 if k == 1 else 0) - k // 4, isAiVibratoEnabled=False)
        notes.append(n)
        pos += tick
        k += 1
    part['notes'] = notes
    part['pos'] = 1920  # one bar lead-in
    part['duration'] = pos + 480
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as o:
        o.writestr('Project/sequence.json', json.dumps(seq, ensure_ascii=False))
    return len(notes), pos


if __name__ == '__main__':
    assert [p for _, p in moras('きゃく')] == ["k' a", 'k M'], moras('きゃく')
    assert moras('ん、')[1] == (None, None)
    print(build(sys.argv[1], sys.argv[2], sys.argv[3]))
