#!/usr/bin/env bash
# Private study only (ripped game motions, never committed or redistributed): the non-combat clips of the
# sword-motion rips (Wuthering Waves stands / walks / cutscene acting, Tekken 8 intro and win poses; FBX built by
# D:/project_private/ideasketch/sword-motion/work/export_any.py + ww_export.py) -> VMD on the default model with
# reze-rig (scripts/fbx2vmd.sh builds .tools/fbx2vmd.mjs once; it already knows Biped and Tekken bone names).
#   loops/  stands, walks, runs: converted in place (センター stays; Follow.js moves her)
#   acts/   cutscene shots (WW_Cut*_Cam###): their own travel kept
# Tekken 8 clips (fbx_rip/T8*) convert too (scripts/reze-rig-names.py knows the names) but their FBX rest pose is frame 0
# of a fighting stance, so poses come out twisted and the skirt physics flips: left out until a T-pose reference exists.
# Usage: bash scripts/rip2vmd.sh [model.pmx]   -> assets/motions/rip/{loops,acts}/*.vmd (Motions.js RIP lists what's used)
set -euo pipefail
cd "$(dirname "$0")/.."
PMX="${1:-assets/sour/Sour式初音ミクVer.1.02/Black.pmx}"
W=D:/project_private/ideasketch/sword-motion/work
[ -f .tools/fbx2vmd.mjs ] || bash scripts/fbx2vmd.sh "$PMX"
T=$(mktemp -d); mkdir -p "$T/loops" "$T/acts" assets/motions/rip
find "$W/fbx" -name 'WW_*.fbx' | grep -iE 'Stand|Walk|Run|Move|Stop|Change' | grep -viE 'Burst|Skill|SpWalk_Dash|Limit' | xargs -I{} cp {} "$T/loops/"
find "$W/fbx" -name 'WW_*_Cam*.fbx' | xargs -I{} cp {} "$T/acts/"
node .tools/fbx2vmd.mjs "$T/loops" --out assets/motions/rip/loops --in-place --no-bind-ref --target-pmx "$PMX" | grep -v '^\[retarget\]'
node .tools/fbx2vmd.mjs "$T/acts" --out assets/motions/rip/acts --no-bind-ref --target-pmx "$PMX" | grep -v '^\[retarget\]'
rm -rf "$T"
