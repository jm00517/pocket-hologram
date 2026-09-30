import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';
import { Behavior } from './Behavior.js';

// Assets are NOT redistributed in this repo (MMD licenses forbid it); loaded at runtime from three.js r170.
// Miku v2 (Animasa) + wavefile motion + KEITEL poses (non-commercial, modify/redistribute OK).
// Poses 9/10 are lying down (need foot IK off) so they're left out.
export const IDLE_POSE = 'stand';
// Upright rest pose built in code. Arms are lowered to ARM_DROP below horizontal, measured from each
// model's own rest pose (T-pose vs A-pose differ), elbows slightly bent.
const ARM_DROP = 1.2; // radians below horizontal (~70°); ponytail: one angle for all models, tune if hands clip the skirt
const MMD = 'https://raw.githubusercontent.com/mrdoob/three.js/r170/examples/models/mmd/';
export const DEFAULT_MODEL = MMD + 'miku/miku_v2.pmd';
export const BUILTIN_MOTIONS = {
  dance: MMD + 'vmds/wavefile_v2.vmd',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 11].map((i) => [`pose${i}`, MMD + `vpds/${String(i).padStart(2, '0')}.vpd`])),
};

let ammo;
function loadAmmo() {
  return ammo ??= new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/ammo.wasm.js';
    s.onload = () => globalThis.Ammo().then((A) => { globalThis.Ammo = A; ok(); });
    s.onerror = err;
    document.head.append(s);
  });
}

const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();

export class Character {
  constructor() {
    this.helper = new MMDAnimationHelper({ sync: false, resetPhysicsOnLoop: false });
    this.actions = {};
    this.current = null;
    this.idle = true;        // procedural idle (breath, sway, blink) on top of the current clip
    this.lookTarget = null;  // THREE.Vector3 in world space; head/eyes follow it
    this.t = 0;
    this.look = { yaw: 0, pitch: 0 };
    this.eyeGain = 1; // eye bone rotation multiplier; ponytail: tune per model if irises over/under-shoot
    this.nextBlink = 2;
    this.offsets = new Map(); // bone -> quaternion applied last frame (undone before the mixer runs)
  }

  // manager: optional LoadingManager (maps dropped texture files by name)
  async load(url = DEFAULT_MODEL, manager) {
    const physics = loadAmmo().then(() => true, () => false);
    this.loader = new MMDLoader(manager);
    this.mesh = await this.loader.loadAsync(url);
    this.bones = Object.fromEntries(this.mesh.skeleton.bones.map((b) => [b.name, b]));
    this.morphs = this.mesh.morphTargetDictionary;
    this.rest = new Map(this.mesh.skeleton.bones.map((b) => [b, b.position.clone()]));
    this.behavior = new Behavior(this); // conversation states, reactions, lip sync
    const base = this.standClip();
    this.helper.add(this.mesh, { animation: [base], physics: await physics });
    this.mixer = this.helper.objects.get(this.mesh).mixer;
    this.current = this.actions[IDLE_POSE] = this.mixer.clipAction(base);
    for (const a of Object.values(this.actions)) a.setEffectiveWeight(a === this.current ? 1 : 0);
    // Procedural layer runs right after the mixer, before IK/physics, so hair and skirt react to it.
    const update = this.mixer.update.bind(this.mixer);
    this.mixer.update = (dt) => { this.undo(); update(dt); this.procedural(dt); return this.mixer; };
    return this.mesh;
  }

  standClip() {
    this.mesh.updateMatrixWorld(true);
    const at = (n) => this.bones[n] && this.mesh.worldToLocal(this.bones[n].getWorldPosition(new THREE.Vector3()));
    const pose = {};
    for (const [arm, elbow, side] of [['左腕', '左ひじ', 1], ['右腕', '右ひじ', -1]]) {
      const a = at(arm), b = at(elbow);
      if (!a || !b) continue;
      const restDrop = Math.atan2(a.y - b.y, Math.abs(b.x - a.x)); // how far the arm already hangs
      pose[arm] = [0, 0, -side * (ARM_DROP - restDrop)];
      pose[elbow] = [0, -side * 0.25, 0];
    }
    const tracks = Object.entries(pose).map(([n, r]) => {
      const qa = q.setFromEuler(e.set(...r)).toArray();
      return new THREE.QuaternionKeyframeTrack(`.bones[${n}].quaternion`, [0, 1], [...qa, ...qa]);
    });
    return new THREE.AnimationClip(IDLE_POSE, 1, tracks);
  }

  // VPD pose → 2-key clip so it blends with VMD motions in the same mixer.
  async poseClip(url, name) {
    const vpd = await new Promise((ok, err) => this.loader.loadVPD(url, false, ok, undefined, err));
    const tracks = [];
    for (const bp of vpd.bones) {
      const b = this.bones[bp.name];
      if (!b) continue;
      const t = v.fromArray(bp.translation);
      if (b.name === 'センター') t.x = t.z = 0; // poses are authored side-by-side for two people; recenter
      const p = this.rest.get(b).clone().add(t);
      tracks.push(new THREE.VectorKeyframeTrack(`.bones[${b.name}].position`, [0, 1], [...p.toArray(), ...p.toArray()]));
      tracks.push(new THREE.QuaternionKeyframeTrack(`.bones[${b.name}].quaternion`, [0, 1], [...bp.quaternion, ...bp.quaternion]));
    }
    return new THREE.AnimationClip(name, 1, tracks);
  }

  // url or File. .vpd → static pose, .vmd → motion clip.
  async addMotion(name, src) {
    const url = src instanceof File ? URL.createObjectURL(src) : src;
    const isPose = /\.vpd$/i.test(src.name ?? src);
    const clip = isPose ? await this.poseClip(url, name) : await new Promise((ok, err) => this.loader.loadAnimation(url, this.mesh, ok, undefined, err));
    clip.name = name;
    const a = this.mixer.clipAction(clip);
    a.setEffectiveWeight(0).play();
    this.actions[name] = a;
    return a;
  }

  async play(name, { fade = 0.4, once = false } = {}) {
    if (!this.actions[name]) {
      if (!BUILTIN_MOTIONS[name]) throw new Error(`unknown motion: ${name}`);
      await this.addMotion(name, BUILTIN_MOTIONS[name]);
    }
    const next = this.actions[name], prev = this.current;
    if (next === prev) return;
    next.reset().setEffectiveWeight(1).setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity).play();
    next.clampWhenFinished = once;
    if (prev) prev.crossFadeTo(next, fade, false);
    this.current = next;
  }

  morph(name, w) { const i = this.morphs[name]; if (i !== undefined) this.mesh.morphTargetInfluences[i] = w; }

  rotate(boneName, x, y, z) {
    const b = this.bones[boneName];
    if (!b) return;
    q.setFromEuler(e.set(x, y, z));
    b.quaternion.multiply(q);
    const prev = this.offsets.get(b);
    this.offsets.set(b, prev ? prev.multiply(q) : q.clone());
  }

  undo() {
    for (const [b, o] of this.offsets) b.quaternion.multiply(o.invert());
    this.offsets.clear();
  }

  procedural(dt) {
    this.t += dt;
    const t = this.t;
    if (this.idle) {
      this.rotate('上半身', Math.sin(t * 1.6) * 0.02, 0, Math.sin(t * 0.5) * 0.02); // breath + sway
      this.rotate('下半身', 0, 0, -Math.sin(t * 0.5) * 0.015);
      // blink: ~120 ms close/open every 2–6 s
      const bt = t - this.nextBlink;
      this.morph('まばたき', bt < 0 ? 0 : bt < 0.06 ? bt / 0.06 : bt < 0.12 ? 1 - (bt - 0.06) / 0.06 : 0);
      if (bt > 0.12) this.nextBlink = t + 2 + Math.random() * 4;
    }
    if (this.lookTarget) {
      const head = this.mesh.worldToLocal(this.bones['頭'].getWorldPosition(v));
      const local = this.mesh.worldToLocal(this.lookTarget.clone()).sub(head);
      // model faces +Z: yaw about +Y, pitch about -X (up = negative)
      const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.2, 1.2);
      const pitch = THREE.MathUtils.clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.6, 0.6);
      // Eyes snap to you, head follows with a lag — reads as attention rather than a turret.
      const k = 1 - Math.exp(-dt * 4);
      this.look.yaw += (yaw - this.look.yaw) * k;
      this.look.pitch += (pitch - this.look.pitch) * k;
      const hy = this.look.yaw * 0.7, hp = this.look.pitch * 0.7; // head+neck cover 70%
      this.rotate('首', hp * 0.4, hy * 0.4, 0);
      this.rotate('頭', hp * 0.6, hy * 0.6, 0);
      const c = THREE.MathUtils.clamp;
      this.rotate('両目', c(pitch - hp, -0.25, 0.25) * this.eyeGain, c(yaw - hy, -0.4, 0.4) * this.eyeGain, 0);
    }
    this.behavior.apply(dt);
  }

  // Call after moving the mesh (or its parents): otherwise dynamic bodies (skirt, hair) lag behind the
  // teleport and get flung. Resets bodies to the current bone pose and settles them.
  resetPhysics() {
    const p = this.helper.objects.get(this.mesh)?.physics;
    if (!p) return;
    this.mesh.updateMatrixWorld(true);
    p.reset();
    p.warmup(60);
  }

  update(dt) { if (this.mesh) this.helper.update(dt); }
}
