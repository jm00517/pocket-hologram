// Inertialized transitions (Bollo / Holden style): switch clips instantly, then decay the pose
// difference — carrying the old motion's velocity — with a critically damped spring per bone.
// Per-bone half-lives give overlapping action: eyes and head settle first, hands trail.
import * as THREE from 'three';

const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), va = new THREE.Vector3();

export function halflifeOf(name) {
  if (/目/.test(name)) return 0.05;
  if (/頭/.test(name)) return 0.08;
  if (/首/.test(name)) return 0.1;
  if (/上半身|下半身|センター|グルーブ|腰|全ての親/.test(name)) return 0.15;
  if (/肩/.test(name)) return 0.17;
  if (/ひじ/.test(name)) return 0.24;
  if (/手|指/.test(name)) return 0.28;
  if (/腕/.test(name)) return 0.2;
  return 0.18;
}

// quaternion <-> rotation vector (axis * angle), shortest arc
export function qlog(q, out) {
  const s = q.w < 0 ? -1 : 1, w = Math.min(1, q.w * s);
  const half = Math.acos(w), sin = Math.sqrt(1 - w * w);
  const k = sin < 1e-6 ? 2 : (2 * half) / sin;
  return out.set(q.x * s * k, q.y * s * k, q.z * s * k);
}
export function qexp(v, out) {
  const a = v.length();
  return a < 1e-8 ? out.identity() : out.setFromAxisAngle(va.copy(v).divideScalar(a), a);
}

// critically damped spring toward 0 (Holden, "Spring-It-On"); mutates x, v
function decay(x, v, halflife, dt) {
  const y = (4 * Math.LN2) / (halflife + 1e-5) / 2;
  const j1 = va.copy(x).multiplyScalar(y).add(v);
  const e = Math.exp(-y * dt);
  v.addScaledVector(j1, -y * dt).multiplyScalar(e);
  x.addScaledVector(j1, dt).multiplyScalar(e);
}

export class Inertializer {
  constructor(bones) {
    this.bones = bones;
    this.h = bones.map((b) => halflifeOf(b.name));
    this.lastQ = bones.map((b) => b.quaternion.clone()); // displayed pose last frame (for velocity)
    this.lastP = bones.map((b) => b.position.clone());
    this.w = bones.map(() => new THREE.Vector3());       // displayed angular velocity
    this.u = bones.map(() => new THREE.Vector3());       // displayed linear velocity
    this.rx = bones.map(() => new THREE.Vector3());      // rotation offset (rotation vector)
    this.rv = bones.map(() => new THREE.Vector3());
    this.px = bones.map(() => new THREE.Vector3());      // position offset
    this.pv = bones.map(() => new THREE.Vector3());
    this.before = null;
  }

  // Call with the bones holding the OLD animation's pose (before the mixer switches clips).
  capture() {
    this.before = this.bones.map((b, i) => [b.quaternion.clone().multiply(qexp(this.rx[i], qa)), b.position.clone().add(this.px[i])]);
  }

  // Call after the mixer produced the NEW pose; `apply(dt)` then blends from what was on screen.
  // rotate/move: the Character's bookkeeping helpers so offsets are undone next frame.
  apply(dt, rotateQ, move) {
    const bs = this.bones;
    if (this.before) {
      for (let i = 0; i < bs.length; i++) {
        const [q0, p0] = this.before[i];
        qlog(qa.copy(bs[i].quaternion).invert().multiply(q0), this.rx[i]); // new * off = old
        this.rv[i].copy(this.w[i]);
        this.px[i].copy(p0).sub(bs[i].position);
        this.pv[i].copy(this.u[i]);
      }
      this.before = null;
    }
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i], rx = this.rx[i], px = this.px[i];
      if (rx.lengthSq() > 1e-10 || this.rv[i].lengthSq() > 1e-10) {
        decay(rx, this.rv[i], this.h[i], dt);
        rotateQ(b, qexp(rx, qb));
      }
      if (px.lengthSq() > 1e-10 || this.pv[i].lengthSq() > 1e-10) {
        decay(px, this.pv[i], this.h[i], dt);
        move(b, px.x, px.y, px.z);
      }
      // velocity of what is displayed, used to seed the next transition
      if (dt > 0) {
        qlog(qa.copy(this.lastQ[i]).invert().multiply(b.quaternion), this.w[i]).divideScalar(dt);
        this.u[i].copy(b.position).sub(this.lastP[i]).divideScalar(dt);
      }
      this.lastQ[i].copy(b.quaternion);
      this.lastP[i].copy(b.position);
    }
  }
}
