"""Download the ambience and spot sounds into assets/audio/ (gitignored). Re-runnable: skips files that exist.

    python scripts/get-audio.py

Freesound: the HQ previews (128 kbps mp3), which need no account; every file here is CC0 except the
Kamakura train (CC BY 4.0: credit volivieri). 効果音ラボ (soundeffect-lab.info): free, no credit needed, their
terms allow the files on GitHub but not as a sound pack, so they stay local like the rest.
"""
import os
import sys
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'audio')
FS = 'https://cdn.freesound.org/'
LAB = 'https://soundeffect-lab.info/sound/environment/'
SOUNDS = {  # file -> (url, credit)
    'waves.mp3': (FS + 'previews/610/610325_6089496-hq.mp3', 'jackmichaelking, Freesound 610325, CC0'),
    'crossing.mp3': (FS + 'previews/872/872621_19256798-hq.mp3', 'KoimeMatsuchiya, Freesound 872621, CC0'),
    'kamakura-train.mp3': (FS + 'previews/76/76584_374422-hq.mp3', 'volivieri, Freesound 76584, CC BY 4.0'),
    'pool.mp3': (FS + 'previews/238/238386_1661766-hq.mp3', 'felix.blume, Freesound 238386, CC0'),
    'meadow.mp3': (FS + 'previews/672/672330_1661766-hq.mp3', 'felix.blume, Freesound 672330, CC0'),
    'night-insects.mp3': (FS + 'previews/365/365257_179538-hq.mp3', 'RutgerMuller, Freesound 365257, CC0'),
    'cicadas.mp3': (LAB + 'mp3/hyalessa-maculaticollis-thickets1.mp3', '効果音ラボ ミンミンゼミが鳴く雑木林'),
    'higurashi.mp3': (LAB + 'mp3/summer-mountain2.mp3', '効果音ラボ 夏の山2 (ヒグラシ)'),
    'school-ground.mp3': (LAB + 'mp3/high-school-ground1.mp3', '効果音ラボ 高校のグラウンド'),
    'classroom.mp3': (LAB + 'mp3/class-room-quiet1.mp3', '効果音ラボ 静まり返る教室'),
    'rain.mp3': (LAB + 'mp3/rain2.mp3', '効果音ラボ 雨が降る2'),
    'town-rain.mp3': (LAB + 'mp3/town-rain1.mp3', '効果音ラボ 雨の街の道路'),
}
# 効果音ラボ serves its files only to its own pages (hotlink guard), as a browser on the page would fetch them
HEADERS = {'User-Agent': 'Mozilla/5.0 (pocket-hologram, personal project)', 'Referer': LAB}


def main():
    os.makedirs(ROOT, exist_ok=True)
    for name, (url, credit) in SOUNDS.items():
        out = os.path.join(ROOT, name)
        if os.path.exists(out):
            continue
        with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as r:
            if not r.headers.get('Content-Type', '').startswith('audio/'):
                sys.exit(f'{name}: not audio ({r.headers.get("Content-Type")}) from {url}')
            data = r.read()
        with open(out, 'wb') as f:
            f.write(data)
        print(f'{name}  {len(data) // 1024} KB  ({credit})')
    with open(os.path.join(ROOT, 'CREDITS.txt'), 'w', encoding='utf-8') as f:
        f.write(''.join(f'{n}: {c}  {u}\n' for n, (u, c) in SOUNDS.items()))


if __name__ == '__main__':
    main()
