"""BVH -> FBX with Mixamo bone names, so reze-rig (scripts/fbx2vmd.sh) can retarget it onto MMD models.
Handles two skeletons, detected per file:
  - Bandai Namco Research motion dataset (cm, UpperLeg_L...; needs the computed T-pose bind)
  - SMPL / HumanML3D output, e.g. MoMask (m, LeftUpLeg...; rest is already a T-pose)

Run:  blender --background --factory-startup --python scripts/bvh2fbx.py -- <in_dir> <out_dir>
"""
import os
import sys

import bpy
from mathutils import Matrix, Vector

RENAME = {
    'Hips': 'Hips', 'Spine': 'Spine', 'Chest': 'Spine2', 'Neck': 'Neck', 'Head': 'Head',
    'Shoulder_L': 'LeftShoulder', 'UpperArm_L': 'LeftArm', 'LowerArm_L': 'LeftForeArm', 'Hand_L': 'LeftHand',
    'Shoulder_R': 'RightShoulder', 'UpperArm_R': 'RightArm', 'LowerArm_R': 'RightForeArm', 'Hand_R': 'RightHand',
    'UpperLeg_L': 'LeftUpLeg', 'LowerLeg_L': 'LeftLeg', 'Foot_L': 'LeftFoot', 'Toes_L': 'LeftToeBase',
    'UpperLeg_R': 'RightUpLeg', 'LowerLeg_R': 'RightLeg', 'Foot_R': 'RightFoot', 'Toes_R': 'RightToeBase',
}

RENAME_SMPL = {n: n for n in ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']}
for side in ('Left', 'Right'):
    RENAME_SMPL.update({side + n: side + n for n in ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot']})
    RENAME_SMPL[side + 'Toe'] = side + 'ToeBase'


def is_bandai(path):
    with open(path, encoding='utf-8', errors='ignore') as f:
        return 'UpperLeg_L' in f.read(4000)


UP_CHAIN = ['Hips', 'Spine', 'Chest', 'Neck', 'Head']
ARM = ['Shoulder_{s}', 'UpperArm_{s}', 'LowerArm_{s}', 'Hand_{s}']
LEG = ['UpperLeg_{s}', 'LowerLeg_{s}']
FOOT = ['Foot_{s}', 'Toes_{s}']


def load(path):
    bandai = is_bandai(path)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_anim.bvh(filepath=path, global_scale=0.01 if bandai else 1.0, update_scene_fps=True,
                            update_scene_duration=True)
    arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    arm.name = 'Armature'
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    # update_scene_duration doesn't take in Blender 5 background mode: without this every clip is
    # exported at the default 250 frames with a frozen tail
    sc = bpy.context.scene
    fs, fe = arm.animation_data.action.frame_range
    sc.frame_start, sc.frame_end = int(fs), int(fe)
    arm['rename'] = 'bandai' if bandai else 'smpl'
    normalize(arm, *(('UpperLeg_L', 'UpperLeg_R') if bandai else ('LeftUpLeg', 'RightUpLeg')))
    return arm


def normalize(arm, leg_l, leg_r):
    """Each take was captured at a different spot on the stage, facing a different way (bow is turned
    ~28°). The retargeter reads that as hip/foot offsets from the bind (feet crossed, hips shoved
    sideways), so re-root every frame so frame 1 has the hips over the origin, facing -Y."""
    sc, pb = bpy.context.scene, arm.pose.bones
    sc.frame_set(sc.frame_start)
    W = lambda n: pb[n].head.copy()  # armature space (object has identity transform)
    left = W(leg_l) - W(leg_r)
    left.z = 0
    left.normalize()
    fwd = left.cross(Vector((0, 0, 1)))
    yaw = Vector((0, -1, 0)).to_2d().angle_signed(fwd.to_2d())  # rotate fwd onto -Y
    hips = W('Hips')
    fix = Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Translation((-hips.x, -hips.y, 0))
    # Bake into Hips itself: the retargeter ignores the unmapped joint_Root's rotation.
    p = pb['Hips']
    rot = 'rotation_quaternion' if p.rotation_mode == 'QUATERNION' else 'rotation_euler'
    frames = range(sc.frame_start, sc.frame_end + 1)
    mats = []
    for f in frames:
        sc.frame_set(f)
        mats.append(fix @ p.matrix)
    for f, m in zip(frames, mats):
        sc.frame_set(f)
        p.matrix = m
        p.keyframe_insert('location', frame=f)
        p.keyframe_insert(rot, frame=f)


def rename_and_export(arm, out):
    table = RENAME if arm.get('rename') == 'bandai' else RENAME_SMPL
    for b in arm.data.bones:
        if b.name in table:
            b.name = 'mixamorig:' + table[b.name]  # also renames the action's fcurve paths
    bpy.ops.export_scene.fbx(filepath=out, use_selection=True, object_types={'ARMATURE'}, add_leaf_bones=False,
                             bake_anim=True, bake_anim_use_nla_strips=False, bake_anim_use_all_actions=False)
    print('wrote', out)


def write_tpose(bvh, out):
    """The dataset's zero-rotation rest is not a human pose (joint axes lie along X), so the retargeter
    can't use it as a bind. Build a proper T-pose on the same skeleton, facing the way the actor faces
    in frame 1 of `bvh` (a neutral standing clip), and export it as a 2-frame clip for --bind-ref."""
    arm = load(bvh)
    pb = arm.pose.bones
    bpy.context.scene.frame_set(1)
    left = pb['UpperArm_L'].head - pb['UpperArm_R'].head
    up = Vector((0, 0, 1))
    left = (left - up * left.dot(up)).normalized()
    fwd = left.cross(up).normalized()
    targets = {b: up for b in UP_CHAIN}
    for s, side in (('L', left), ('R', -left)):
        targets.update({b.format(s=s): side for b in ARM})
        targets.update({b.format(s=s): -up for b in LEG})
        targets.update({b.format(s=s): fwd for b in FOOT})
    arm.animation_data.action = None
    bpy.ops.object.mode_set(mode='POSE')
    for p in pb:  # restore the frame-1 pose without the action, then straighten parents-first
        p.rotation_mode = 'QUATERNION'
    bpy.context.view_layer.update()
    for name in [b.name for b in arm.data.bones]:  # data.bones is parent-before-child
        if name not in targets:
            continue
        p = pb[name]
        m = p.matrix.copy()
        cur = (m.to_3x3() @ Vector((0, 1, 0))).normalized()
        rot = cur.rotation_difference(targets[name]).to_matrix().to_4x4()
        head = Matrix.Translation(m.translation)
        p.matrix = head @ rot @ head.inverted() @ m
        bpy.context.view_layer.update()
    for f in (1, 2):
        for p in pb:
            p.keyframe_insert('rotation_quaternion', frame=f)
            p.keyframe_insert('location', frame=f)
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 2
    bpy.ops.object.mode_set(mode='OBJECT')
    rename_and_export(arm, out)


src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
os.makedirs(dst, exist_ok=True)
bvhs = sorted(n for n in os.listdir(src) if n.lower().endswith('.bvh'))
for name in bvhs:
    rename_and_export(load(os.path.join(src, name)), os.path.join(dst, os.path.splitext(name)[0] + '.fbx'))
bandai = [n for n in bvhs if is_bandai(os.path.join(src, n))]
if bandai:  # only the Bandai skeleton needs a synthetic bind pose
    neutral = next((n for n in bandai if 'respond_normal' in n), bandai[0])
    write_tpose(os.path.join(src, neutral), os.path.join(os.path.dirname(dst.rstrip('/\\')) or '.', 'tpose.fbx'))
