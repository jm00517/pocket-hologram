// Story effects: manga emotes over her head (#fx) and fades to and from a colour (#fade).
// Emotes are canvas-drawn sprites (no image files), drawn over everything (a heart half inside her hair reads as
// nothing), sized in metres x engine.units and following the point the director hands in each frame; one at a
// time, a new one replaces the last. The fade is a DOM sheet over the canvas on the desktop. In VR the page isn't
// what you see, so a sphere around the headset, inside out, does the same; it's only visible while presenting, so
// the window view's post chain (GTAO's normal pass, bloom) never sees it. Both track one opacity, so leaving VR
// mid-fade stays consistent. The sphere's renderOrder (ORDER) sits under the story's VR panels (XRView, 9e5 up) so
// text can show on black, and over the emotes.
import * as THREE from 'three';

const LIFE = 1.6, SIZE = 0.17, RISE = 0.1, ORDER = 9000; // s, m, m
const ink = (g, fill, draw) => { g.lineJoin = 'round'; g.lineWidth = 12; g.strokeStyle = '#fff'; draw(); g.stroke(); g.fillStyle = fill; g.fill(); };
const glyph = (g, fill, text, px = 104, x = 64, y = 68) => {
  g.font = `900 ${px}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = '#fff'; g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y);
};
const star = (g, x, y, r) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 - Math.PI / 2, k = i % 2 ? r * 0.28 : r; g.lineTo(x + Math.cos(a) * k, y + Math.sin(a) * k); } g.closePath(); };
// one 128 px drawing per FX_KINDS entry
const DRAW = {
  heart: (g) => ink(g, '#ff4f7a', () => { g.beginPath(); g.moveTo(64, 112); g.bezierCurveTo(10, 72, 8, 30, 38, 22); g.bezierCurveTo(52, 18, 62, 28, 64, 40); g.bezierCurveTo(66, 28, 76, 18, 90, 22); g.bezierCurveTo(120, 30, 118, 72, 64, 112); g.closePath(); }),
  sparkle: (g) => { ink(g, '#ffd23f', () => star(g, 56, 70, 50)); ink(g, '#ffe98a', () => star(g, 100, 28, 18)); },
  sweat: (g) => ink(g, '#7cc8ff', () => { g.beginPath(); g.moveTo(64, 10); g.quadraticCurveTo(30, 60, 30, 84); g.arc(64, 84, 34, Math.PI, 0, true); g.quadraticCurveTo(98, 60, 64, 10); g.closePath(); }),
  // the cross-vein mark: four arcs bulging toward the middle
  anger: (g) => {
    g.lineCap = 'round';
    for (const [w, c] of [[30, '#fff'], [16, '#ff3b3b']]) for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const a = Math.atan2(-sy, -sx); g.beginPath(); g.arc(64 + sx * 46, 64 + sy * 46, 34, a - 0.7, a + 0.7); g.lineWidth = w; g.strokeStyle = c; g.stroke();
    }
  },
  question: (g) => glyph(g, '#3a63c9', '?'),
  exclaim: (g) => glyph(g, '#ff5a3c', '!'),
  note: (g) => glyph(g, '#3fa9f5', '♪'),
  zzz: (g) => { glyph(g, '#7c7cf0', 'Z', 72, 46, 82); glyph(g, '#7c7cf0', 'z', 50, 94, 38); },
};
const easeOutBack = (x) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;

export function createFx(engine) {
  const textures = {};
  const tex = (kind) => textures[kind] ??= (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    (DRAW[kind] ?? DRAW.question)(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  let emotes = [];
  const remove = (e) => { engine.scene.remove(e.m); e.m.material.dispose(); };

  const sheet = Object.assign(document.createElement('div'), { style: 'position:fixed;inset:0;z-index:2;pointer-events:none;opacity:0;background:#000' });
  document.body.append(sheet);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), new THREE.MeshBasicMaterial({ color: '#000', side: THREE.BackSide, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
  ball.material.userData.outlineParameters = { visible: false }; ball.userData.noAO = true;
  ball.renderOrder = ORDER; ball.frustumCulled = false; ball.visible = false;
  engine.camera.add(ball); // camera space is metres in VR (the rig carries the scale), and 0.5 m clears the 5 cm near plane
  const F = { a: 0, to: 0, rate: 0, done: null };
  const settle = () => { const d = F.done; F.done = null; d?.(); };

  const fx = {
    ORDER,
    /** kind: one of FX_KINDS; at(): world point over her head, read every frame (null = stay where it was) */
    emote(kind, at) {
      for (const e of emotes) remove(e);
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(kind), transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false }));
      m.material.userData.outlineParameters = { visible: false }; m.userData.noAO = true; m.renderOrder = ORDER - 1;
      m.scale.setScalar(0); engine.scene.add(m);
      emotes = [{ m, at, t: 0, p: at()?.clone() ?? new THREE.Vector3() }];
    },
    /** 'out' to the colour, 'in' back to the scene, over s seconds; resolves when there (or when another fade takes over) */
    fade(dir, s = 0.6, color = '#000') {
      settle();
      sheet.style.background = color; ball.material.color.set(color);
      F.to = dir === 'out' ? 1 : 0; F.rate = 1 / Math.max(s, 1e-3);
      if (s <= 0) F.a = F.to;
      return new Promise((done) => { F.done = done; fx.tick(0); });
    },
    /** the scene is over: emotes gone, and a fade it left on comes back up */
    clear() {
      for (const e of emotes) remove(e);
      emotes = [];
      if (F.a > 0 || F.to > 0) fx.fade('in', 0.5);
    },
    tick(dt) {
      const U = engine.units;
      emotes = emotes.filter((e) => {
        e.t += dt;
        if (e.t >= LIFE) { remove(e); return false; }
        const p = e.at(); if (p) e.p.copy(p);
        const u = e.t / LIFE;
        e.m.position.copy(e.p).y += RISE * U * (1 - (1 - u) ** 2);
        e.m.scale.setScalar(SIZE * U * (e.t < 0.28 ? easeOutBack(e.t / 0.28) : 1)); // pop
        e.m.material.opacity = Math.min(1, (LIFE - e.t) / 0.45) * (1 - F.a); // under the fade: VR's ink pass draws sprites again over the ball
        return true;
      });
      F.a += Math.sign(F.to - F.a) * Math.min(Math.abs(F.to - F.a), F.rate * dt);
      sheet.style.opacity = F.a;
      ball.material.opacity = F.a; ball.visible = engine.xr && F.a > 0;
      ball.layers.mask = engine.camera.layers.mask; // a map's other spaces draw on their own camera layers (NonEuclid)
      if (F.a === F.to) settle();
    },
  };
  return fx;
}
