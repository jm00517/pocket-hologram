// Hand layer: finger poses + living micro-motion on top of whatever the body clip does.
// Mocap/generated clips carry no finger tracks (MoMask's SMPL-22 skeleton ends at the wrist), so
// hands would be MMD-rest ramrod straight. Skipped per hand when the current clip animates fingers.
const FINGERS = ['人指', '中指', '薬指', '小指'];
// curl per joint (1,2,3) in radians for index/middle/ring/pinky, thumb [0,1,2]
const P = (idx, mid, ring, pinky, thumb) => ({ f: [idx, mid, ring, pinky], thumb });
export const HAND_POSES = {
  soft: P([0.1, 0.15, 0.1], [0.25, 0.3, 0.2], [0.3, 0.35, 0.25], [0.15, 0.2, 0.15], [0.05, 0.1, 0.1]), // anime-graceful, pinky a bit out
  open: P([0.03, 0.03, 0.02], [0.03, 0.03, 0.02], [0.03, 0.03, 0.02], [0.03, 0.03, 0.02], [0, 0, 0]),
  fist: P([1.3, 1.5, 1.1], [1.35, 1.5, 1.1], [1.4, 1.5, 1.1], [1.45, 1.5, 1.1], [0.3, 0.7, 0.9]),
  point: P([0.05, 0.05, 0.05], [1.35, 1.5, 1.1], [1.4, 1.5, 1.1], [1.45, 1.5, 1.1], [0.3, 0.7, 0.9]),
  peace: P([0.05, 0.05, 0.05], [0.05, 0.05, 0.05], [1.4, 1.5, 1.1], [1.45, 1.5, 1.1], [0.3, 0.7, 0.9]),
  clasp: P([0.55, 0.65, 0.45], [0.6, 0.7, 0.45], [0.65, 0.7, 0.45], [0.7, 0.7, 0.45], [0.2, 0.4, 0.4]),
};
export const HAND_MODES = ['auto', ...Object.keys(HAND_POSES)];
const SIDES = [['左', -1], ['右', 1]]; // curl sign about Z (left hand extends +X)
const CLASP = 0.5; // auto mode: wrists closer than this × shoulder width (upper-arm roots) -> clasp (model-scale independent)

export class Hands {
  constructor(character) {
    this.c = character;
    this.mode = { 左: 'auto', 右: 'auto' };
    this.cur = Object.fromEntries(SIDES.map(([s]) => [s, structuredClone(HAND_POSES.soft)]));
    this.phase = Array.from({ length: 12 }, () => Math.random() * 6.28);
  }

  // side: 'both' | 'left' | 'right'
  set(mode, side = 'both') {
    if (!HAND_MODES.includes(mode)) return;
    for (const s of side === 'both' ? ['左', '右'] : [side === 'left' ? '左' : '右']) this.mode[s] = mode;
  }

  apply(dt) {
    const c = this.c, t = c.t, k = 1 - Math.exp(-dt * 10);
    const clip = c.current?.getClip();
    const W = (n, v) => c.bones[n]?.getWorldPosition(v);
    const [wl, wr, sl, sr] = ['左手首', '右手首', '左腕', '右腕'].map((n, i) => W(n, (this.v ??= [0, 1, 2, 3].map(() => c.mesh.position.clone()))[i]));
    const wristsClose = !!(wl && wr && sl && sr) && wl.distanceTo(wr) < CLASP * sl.distanceTo(sr);
    SIDES.forEach(([s, sg], hi) => {
      if (clip?.tracks.some((tr) => tr.name.includes(`[${s}人指１]`))) return; // clip has real fingers
      const mode = this.mode[s];
      const target = HAND_POSES[mode === 'auto' ? (wristsClose ? 'clasp' : 'soft') : mode];
      const cur = this.cur[s];
      FINGERS.forEach((f, fi) => {
        for (let j = 0; j < 3; j++) {
          cur.f[fi][j] += (target.f[fi][j] - cur.f[fi][j]) * k;
          const fidget = mode === 'fist' ? 0 : Math.sin(t * (0.7 + fi * 0.13) + this.phase[hi * 6 + fi]) * 0.05;
          c.rotate(`${s}${f}${'１２３'[j]}`, 0, 0, sg * (cur.f[fi][j] + fidget * (j === 0 ? 1 : 0.6)));
        }
      });
      for (let j = 0; j < 3; j++) {
        cur.thumb[j] += (target.thumb[j] - cur.thumb[j]) * k;
        // thumb folds about +X on both hands (measured: brings the tip onto the curled index/middle),
        // with a slight inward swing
        c.rotate(`${s}親指${'０１２'[j]}`, cur.thumb[j], -sg * cur.thumb[j] * 0.15, 0);
      }
      // wrist: slow, small, independent per hand
      const p = this.phase[hi * 6 + 4];
      c.rotate(`${s}手首`, Math.sin(t * 0.37 + p) * 0.04, Math.sin(t * 0.29 + p * 2) * 0.05, Math.sin(t * 0.43 + p * 3) * 0.04);
    });
  }
}
