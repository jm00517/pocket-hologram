"""Download the Poly Haven (CC0) HDRIs and PBR textures used by the crossing scene into
assets/polyhaven/. Re-runnable: skips files that already exist.

    python scripts/get-polyhaven.py
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'polyhaven')
HDRIS = {  # weather preset -> pure-sky HDRI (no ground, so our scene's horizon wins)
    'day': 'kloofendal_48d_partly_cloudy_puresky',
    'sunset': 'belfast_sunset_puresky',
    'rain': 'kloofendal_overcast_puresky',
    'snow': 'snow_field_puresky',
    'night': 'kloppenheim_02_puresky',
}
TEXTURES = ['asphalt_02', 'sandy_gravel_02', 'sparse_grass', 'snow_02', 'white_plaster_02',
            'concrete_floor_worn_001', 'rusty_metal_02', 'grey_roof_tiles_02',
            'plank_flooring_02', 'plastered_wall_04']  # last two: the after-school classroom
MAPS = {'diff': 'Diffuse', 'nor_gl': 'nor_gl', 'rough': 'Rough'}
MODELS = ['fern_02', 'weed_plant_02', 'shrub_sorrel_01', 'shrub_04', 'dandelion_01', 'wall_clock']  # glTF 1k


UA = {'User-Agent': 'pocket-hologram/1.0 (personal project)'}  # Poly Haven rejects urllib's default UA


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA))


def api(asset):
    with get(f'https://api.polyhaven.com/files/{asset}') as r:
        return json.load(r)


def fetch(url, dest):
    if os.path.exists(dest):
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print('get', os.path.relpath(dest, ROOT))
    with get(url) as r, open(dest + '.part', 'wb') as f:
        f.write(r.read())
    os.replace(dest + '.part', dest)


def main():
    for preset, asset in HDRIS.items():
        fetch(api(asset)['hdri']['2k']['hdr']['url'], os.path.join(ROOT, 'hdri', f'{preset}.hdr'))
    for asset in TEXTURES:
        files = api(asset)
        for short, key in MAPS.items():
            fetch(files[key]['1k']['jpg']['url'], os.path.join(ROOT, 'tex', asset, f'{short}.jpg'))
    for asset in MODELS:
        g = api(asset)['gltf']['1k']['gltf']
        base = os.path.join(ROOT, 'models', asset)
        fetch(g['url'], os.path.join(base, f'{asset}.gltf'))
        for rel, inc in g.get('include', {}).items():
            fetch(inc['url'], os.path.join(base, *rel.split('/')))
    with open(os.path.join(ROOT, 'CREDITS.txt'), 'w', encoding='utf-8') as f:
        f.write('Poly Haven (https://polyhaven.com), CC0.\n' + '\n'.join(list(HDRIS.values()) + TEXTURES + MODELS) + '\n')
    print('done')


if __name__ == '__main__':
    sys.exit(main())
