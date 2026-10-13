// Freeze the character into still statues: one of her motion clips, at a moment, skinned once on the CPU into a
// plain geometry (metres, feet at the origin, facing +z). A copy of her skeleton poses, so she is never touched.
// IK and grant bones go through three's MMDAnimationHelper; hair physics doesn't run (it hangs at rest).
import * as THREE from 'three';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';

/** mesh: the subject (SkinnedMesh with userData.actions), U: its units per metre, at: clip names and phases (0..1).
 *  Returns [{ name, geometry, materials }]; materials are the mesh's own (read their map/color/alphaTest). */
export function bakePoses(mesh, U, at) {
  // her bones alone, rebuilt (cloning the mesh would also clone whatever hangs off them, her voice on the head)
  const src0 = mesh.skeleton.bones, bones = src0.map((b) => Object.assign(new THREE.Bone(), { name: b.name }));
  src0.forEach((b, i) => { const pi = src0.indexOf(b.parent); if (pi >= 0) bones[pi].add(bones[i]); });
  const doll = new THREE.SkinnedMesh(mesh.geometry, mesh.material);
  for (const b of bones) if (!b.parent) doll.add(b);
  doll.bind(new THREE.Skeleton(bones, mesh.skeleton.boneInverses.map((m) => m.clone())), mesh.bindMatrix.clone());
  const helper = new MMDAnimationHelper({ sync: false, afterglow: 0 });
  const src = mesh.geometry, pos = src.attributes.position, v = new THREE.Vector3(), out = [];
  for (const [name, phase] of at) {
    const clip = mesh.userData.actions?.[name]?.getClip();
    if (!clip) continue;
    doll.skeleton.pose(); // from rest, so bones this clip doesn't key don't keep the last statue's pose
    helper.add(doll, { animation: clip, physics: false });
    helper.update(Math.max(1e-3, clip.duration * phase)); // the mixer jumps to that moment; IK and grants follow
    doll.updateMatrixWorld(true);
    const p = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i); doll.applyBoneTransform(i, v);
      p[i * 3] = v.x / U; p[i * 3 + 1] = v.y / U; p[i * 3 + 2] = v.z / U;
    }
    helper.remove(doll);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('uv', src.attributes.uv);
    g.setIndex(src.index);
    for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    g.computeVertexNormals();
    out.push({ name, geometry: g, materials: [].concat(mesh.material) });
  }
  return out;
}
