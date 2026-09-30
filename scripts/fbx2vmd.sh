#!/usr/bin/env bash
# Convert every FBX in assets/motions/ (e.g. Mixamo downloads) to VMD retargeted onto the default model.
# Uses reze-rig (MIT, https://github.com/AmyangXYZ/reze-rig), installed once into .tools/ (gitignored).
set -euo pipefail
cd "$(dirname "$0")/.."
PMX="${1:-assets/sour/Sour式初音ミクVer.1.02/Black.pmx}"
if [ ! -f .tools/fbx2vmd.mjs ]; then
  mkdir -p .tools && git clone -q --depth 1 https://github.com/AmyangXYZ/reze-rig.git .tools/reze-rig
  (cd .tools/reze-rig && npm install --no-audit --no-fund --silent &&
   npx esbuild scripts/fbx2vmd.ts --bundle --platform=node --format=esm --outfile=../fbx2vmd.mjs --log-level=warning)
fi
node .tools/fbx2vmd.mjs assets/motions --out assets/motions --target-pmx "$PMX"
