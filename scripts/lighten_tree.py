"""Make a real-time version of a Poly Haven tree: decimate trunk/branches, keep a random subset of
leaf islands (scaled up to keep the canopy full), export a compact .glb next to the source.

    blender --background --factory-startup --python scripts/lighten_tree.py -- <in.gltf> <out.glb> [keep=0.22] [wood=0.1]
"""
import random
import sys

import bmesh
import bpy

src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
args = sys.argv[sys.argv.index('--') + 1:]
keep = float(args[2]) if len(args) > 2 else 0.22
wood = float(args[3]) if len(args) > 3 else 0.1
random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

for ob in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    # split by material so leaves and wood are handled separately
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.separate(type='MATERIAL'); bpy.ops.object.mode_set(mode='OBJECT')

for ob in [o for o in bpy.context.scene.objects if o.type == 'MESH']:
    name = ob.active_material.name.lower() if ob.active_material else ''
    before = len(ob.data.polygons)
    if 'leav' in name:
        bm = bmesh.new(); bm.from_mesh(ob.data); bm.faces.ensure_lookup_table()
        seen, islands = set(), []
        for f in bm.faces:  # linked face islands = individual leaves / leaf clusters
            if f.index in seen: continue
            stack, isl = [f], []
            seen.add(f.index)
            while stack:
                cur = stack.pop(); isl.append(cur)
                for e in cur.edges:
                    for n in e.link_faces:
                        if n.index not in seen: seen.add(n.index); stack.append(n)
            islands.append(isl)
        drop, grow = [], 1 / keep ** 0.5 * 0.85
        for isl in islands:
            if random.random() > keep:
                drop.extend(isl)
            else:  # enlarge kept leaves around their own centre to fill the gaps
                verts = list({v for f in isl for v in f.verts})
                c = verts[0].co.copy() * 0
                for v in verts: c += v.co
                c /= len(verts)
                for v in verts: v.co = c + (v.co - c) * grow
        bmesh.ops.delete(bm, geom=list(set(drop)), context='FACES')
        bm.to_mesh(ob.data); bm.free()
    else:
        mod = ob.modifiers.new('dec', 'DECIMATE'); mod.ratio = wood
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=mod.name)
    print(f'{ob.name}: {before} -> {len(ob.data.polygons)} faces')

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                          export_image_format='JPEG', export_jpeg_quality=85)
print('wrote', dst)
