#!/usr/bin/env bash
# Text -> motion with MoMask (MIT; weights trained on HumanML3D, non-commercial), then BVH -> FBX -> VMD.
# Prompts: scripts/motion_prompts.txt (name|prompt|seconds). Output: assets/motions/gen/vmd/<name>_<n>.vmd
# First run installs MoMask into .tools/momask (venv reusing the system CUDA torch) and patches it for
# current numpy/matplotlib.
set -euo pipefail
cd "$(dirname "$0")/.."
PMX="${PMX:-assets/sour/Sour式初音ミクVer.1.02/Black.pmx}"
BLENDER="${BLENDER:-/c/Program Files/Blender Foundation/Blender 5.2/blender.exe}"
REPEAT="${REPEAT:-3}"
OUT=assets/motions/gen
M=.tools/momask
if [ ! -d "$M/checkpoints/t2m/length_estimator" ]; then
  git clone -q --depth 1 https://github.com/EricGuo5513/momask-codes.git "$M"
  python -m venv --system-site-packages "$M/venv"
  "$M/venv/Scripts/python.exe" -m pip install -q "git+https://github.com/openai/CLIP.git" einops ftfy gdown "vector-quantize-pytorch==1.6.30"
  "$M/venv/Scripts/python.exe" -m pip uninstall -y -q torch || true   # keep the system CUDA build
  TV=$(python -c "import torch;v=torch.__version__.split('+')[0];print({'2.3.1':'0.18.1','2.4.1':'0.19.1','2.5.1':'0.20.1'}.get(v,''))")
  [ -n "$TV" ] && "$M/venv/Scripts/python.exe" -m pip install -q --no-deps "torchvision==$TV" --index-url https://download.pytorch.org/whl/cu118
  mkdir -p "$M/checkpoints/t2m" && (cd "$M/checkpoints/t2m" && ../../venv/Scripts/python.exe -m gdown 1vXS7SHJBgWPt59wupQ5UUzhFObrnGkQ0 -O m.zip && python -c "import zipfile;zipfile.ZipFile('m.zip').extractall('.')" && rm m.zip)
  # patches: numpy.core.umath_tests / np.float removed; matplotlib 3.8 breaks the mp4 preview
  sed -i 's/^import numpy.core.umath_tests as ut$/ut = None/; s/ut\.matrix_multiply(/np.matmul(/g' "$M"/visualization/*.py
  sed -i 's/            import numpy.core.umath_tests as ut/            pass/' "$M/visualization/Quaternions.py"
  grep -rl 'np\.float\b' --include=*.py "$M" | grep -v venv | xargs -r sed -i -E 's/np\.float\b([^0-9_])/np.float64\1/g'
  sed -i -E 's/^(\s*)(plot_3d_motion\()/\1pass  # \2/' "$M/gen_t2m.py"
fi
mapfile -t LINES < <(grep -v '^#' scripts/motion_prompts.txt | grep '|')
: > "$M/prompts.txt"
for l in "${LINES[@]}"; do IFS='|' read -r _ p s <<< "$l"; echo "$p#$((s * 20))" >> "$M/prompts.txt"; done
rm -rf "$M/generation/gen"
(cd "$M" && venv/Scripts/python.exe gen_t2m.py --gpu_id 0 --ext gen --text_path prompts.txt \
   --repeat_times "$REPEAT" --use_res_model 2>&1 | grep -v -i warning | tail -3) || true  # preview mp4 step may fail; BVHs are written first
mkdir -p "$OUT/bvh"
for i in "${!LINES[@]}"; do
  IFS='|' read -r name _ _ <<< "${LINES[$i]}"
  for f in "$M/generation/gen/animations/$i"/*_ik.bvh; do
    r=$(basename "$f" | sed -E 's/.*repeat([0-9]+).*/\1/'); cp "$f" "$OUT/bvh/${name}_${r}.bvh"
  done
done
"$BLENDER" --background --factory-startup --python scripts/bvh2fbx.py -- "$OUT/bvh" "$OUT/fbx" | grep -c wrote
node .tools/fbx2vmd.mjs "$OUT/fbx" --out "$OUT/vmd" --no-bind-ref --target-pmx "$PMX" | tail -1
# index for the web motion menu (a static server can't list directories)
(cd "$OUT/vmd" && ls *.vmd | sed 's/\.vmd$//' | python -c "import sys,json;print(json.dumps([l.strip() for l in sys.stdin if l.strip()]))" > index.json)
