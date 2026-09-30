#!/usr/bin/env bash
# Fetch a few Bandai Namco Research motion dataset clips (CC BY-NC 4.0, non-commercial only) and convert
# them to VMD for the default model: BVH -> FBX (Blender, computed T-pose bind) -> VMD (reze-rig).
# Needs Blender on PATH or BLENDER=path/to/blender.exe, and .tools/fbx2vmd.mjs (run scripts/fbx2vmd.sh once).
set -euo pipefail
cd "$(dirname "$0")/.."
PMX="${1:-assets/sour/Sour式初音ミクVer.1.02/Black.pmx}"
BLENDER="${BLENDER:-blender}"
R=https://raw.githubusercontent.com/BandaiNamcoResearchInc/Bandai-Namco-Research-Motiondataset/master/dataset
D=assets/motions/bandai
mkdir -p "$D"
get() { [ -f "$D/$2" ] || curl -sfo "$D/$2" "$R/Bandai-Namco-Research-Motiondataset-$1/data/$2"; }
for c in bow bye byebye guide; do for s in feminine childish happy not-confident; do get 1 "dataset-1_${c}_${s}_001.bvh"; done; done
get 1 dataset-1_respond_normal_001.bvh; get 1 dataset-1_call_normal_001.bvh
for c in wave-right-hand wave-both-hands raise-up-right-hand; do for s in feminine youthful; do get 2 "dataset-2_${c}_${s}_001.bvh"; done; done
curl -sfo "$D/LICENSE.txt" "$R/Bandai-Namco-Research-Motiondataset-1/LICENSE"
"$BLENDER" --background --factory-startup --python scripts/bvh2fbx.py -- "$D" "$D/fbx"
node .tools/fbx2vmd.mjs "$D/fbx" --out "$D/vmd" --bind-ref "$D/tpose.fbx" --target-pmx "$PMX"
