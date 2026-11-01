"""Teach reze-rig (.tools/reze-rig/lib/retarget.ts) two more skeleton namings, in place and idempotently; run by fbx2vmd.sh
after the clone, before the bundle is built.
  - 3ds Max Biped written without separators (Wuthering Waves: Bip001LUpperArm): reze-rig splits "LUpperArm" into
    "l upper arm", which its table doesn't have, so every clip lost both upper arms (she kept the rest pose's A-pose).
  - TEKKEN 8 (Hip, L_UpperArm, L_LowerLeg, L_Toe, L_Thumb0..): nothing but Spine2/Neck/Head matched.
"""
import re, sys
p = sys.argv[1] if len(sys.argv) > 1 else '.tools/reze-rig/lib/retarget.ts'
s = open(p, encoding='utf-8').read()
if 'T8_TO_MIXAMO' in s: print('already patched'); sys.exit()
s = s.replace("\t'l upperarm': 'LeftArm',", "\t'l upperarm': 'LeftArm',\n\t'l upper arm': 'LeftArm',", 1)
s = s.replace("\t'r upperarm': 'RightArm',", "\t'r upperarm': 'RightArm',\n\t'r upper arm': 'RightArm',", 1)
t8 = {'hip': 'Hips', 'l_shoulder': 'LeftShoulder', 'l_upperarm': 'LeftArm', 'l_lowerarm': 'LeftForeArm', 'l_hand': 'LeftHand',
      'l_upperleg': 'LeftUpLeg', 'l_lowerleg': 'LeftLeg', 'l_foot': 'LeftFoot', 'l_toe': 'LeftToeBase'}
for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Pinky'):
    for i in range(3): t8['l_%s%d' % (f.lower(), i if f == 'Thumb' else i + 1)] = 'LeftHand%s%d' % (f, i + 1)
t8.update({k.replace('l_', 'r_', 1): v.replace('Left', 'Right', 1) for k, v in list(t8.items()) if k.startswith('l_')})
table = '// TEKKEN 8 (scripts/reze-rig-names.py): Spine1/Spine2/Neck/Head pass through by name.\nconst T8_TO_MIXAMO: Record<string, string> = {\n' + \
        ''.join("\t'%s': '%s',\n" % kv for kv in t8.items()) + '};\n\n'
s = s.replace('function canonicalizeBoneName(rawName: string): string {', table + 'function canonicalizeBoneName(rawName: string): string {', 1)
s = s.replace("\tconst ue = UE_MANNEQUIN_TO_MIXAMO[ueKey];\n\tif (ue) return ue;\n",
              "\tconst ue = UE_MANNEQUIN_TO_MIXAMO[ueKey];\n\tif (ue) return ue;\n\tconst t8 = T8_TO_MIXAMO[ueKey];\n\tif (t8) return t8;\n", 1)
assert s.count('T8_TO_MIXAMO') == 2 and "'l upper arm'" in s, 'retarget.ts changed shape; update this script'
open(p, 'w', encoding='utf-8').write(s); print('patched', p)
