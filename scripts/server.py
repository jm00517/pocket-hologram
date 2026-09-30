"""Local dev server: static files from the repo root + POST /api/generate (text -> motion -> VMD).

    python scripts/server.py            # http://localhost:3210

/api/generate  {"prompt": "a person waves hello", "seconds": 3, "variants": 2}
  -> {"names": ["wave_hello_ab12_0", ...]}   (files in assets/motions/gen/vmd/, index.json updated)
Pipeline: MoMask (.tools/momask) -> BVH -> Blender (scripts/bvh2fbx.py) -> reze-rig fbx2vmd.
ponytail: spawns MoMask per request (~15 s model load); keep a resident model if generation is frequent.
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MOMASK = ROOT / '.tools' / 'momask'
GEN = ROOT / 'assets' / 'motions' / 'gen'
PMX = ROOT / 'assets' / 'sour' / 'Sour式初音ミクVer.1.02' / 'Black.pmx'
BLENDER = os.environ.get('BLENDER', r'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe')
GPU = threading.Lock()  # one generation at a time


def run(cmd, cwd):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if p.returncode != 0:
        raise RuntimeError(f'{Path(cmd[0]).name} failed: {(p.stderr or p.stdout)[-800:]}')
    return p.stdout


def write_index():
    names = sorted(f.stem for f in (GEN / 'vmd').glob('*.vmd'))
    (GEN / 'vmd' / 'index.json').write_text(json.dumps(names), encoding='utf-8')


def generate(prompt, seconds, variants):
    slug = '_'.join(re.findall(r'[a-z]+', prompt.lower())[:4]) or 'motion'
    slug += '_' + hashlib.sha1(f'{prompt}{seconds}{variants}'.encode()).hexdigest()[:4]
    job = GEN / '_job' / slug
    shutil.rmtree(job, ignore_errors=True)
    (job / 'bvh').mkdir(parents=True)
    ext = 'web_' + slug
    run([str(MOMASK / 'venv' / 'Scripts' / 'python.exe'), 'gen_t2m.py', '--gpu_id', '0', '--ext', ext,
         '--text_prompt', prompt, '--motion_length', str(int(seconds * 20)), '--repeat_times', str(variants),
         '--use_res_model'], MOMASK)
    out = MOMASK / 'generation' / ext / 'animations' / '0'
    for f in sorted(out.glob('*_ik.bvh')):
        r = re.search(r'repeat(\d+)', f.name).group(1)
        shutil.copy(f, job / 'bvh' / f'{slug}_{r}.bvh')
    shutil.rmtree(MOMASK / 'generation' / ext, ignore_errors=True)
    run([BLENDER, '--background', '--factory-startup', '--python', str(ROOT / 'scripts' / 'bvh2fbx.py'), '--',
         str(job / 'bvh'), str(job / 'fbx')], ROOT)
    run(['node', str(ROOT / '.tools' / 'fbx2vmd.mjs'), str(job / 'fbx'), '--out', str(GEN / 'vmd'), '--no-bind-ref',
         '--target-pmx', str(PMX)], ROOT)
    (GEN / 'bvh').mkdir(parents=True, exist_ok=True)
    for f in (job / 'bvh').glob('*.bvh'):  # keep sources next to the batch ones
        shutil.copy(f, GEN / 'bvh' / f.name)
    shutil.rmtree(job, ignore_errors=True)
    write_index()
    return sorted(f.stem for f in (GEN / 'vmd').glob(f'{slug}_*.vmd'))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')  # always serve the latest code while iterating
        super().end_headers()

    def do_POST(self):
        if self.path != '/api/generate':
            return self.send_error(404)
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
            prompt = str(body.get('prompt', '')).strip()
            if not prompt or len(prompt) > 200:
                raise ValueError('prompt must be 1-200 characters')
            seconds = min(max(float(body.get('seconds', 4)), 1), 9.8)  # MoMask max 196 frames @ 20 fps
            variants = min(max(int(body.get('variants', 2)), 1), 4)
            with GPU:
                names = generate(prompt, seconds, variants)
            self.reply(200, {'names': names})
        except (ValueError, TypeError) as e:
            self.reply(400, {'error': str(e)})
        except Exception as e:  # report to the page; the server keeps running
            self.reply(500, {'error': str(e)})

    def reply(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3210
    print(f'serving {ROOT} on http://localhost:{port}')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
