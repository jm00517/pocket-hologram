// HeadGestures: a nod or a head shake out of the headset's pose, for choices tagged #nod / #shake and the
// head.nod / head.shake events. Each axis runs a zig-zag filter: a turning point counts only once the head has come
// back from it by the swing threshold, and quickly (SNAP), so tracking jitter (a fraction of a degree) never counts,
// slow looking around never adds up inside the window, and neither does reading (a slow sweep, a flick back, again). Two turning points on one axis within the window, with the other axis
// moving much less, is the gesture. Then a cooldown, so one nod isn't read twice.
const DEG = Math.PI / 180;
const SNAP = 0.35; // s from a turning point to having swung back from it; slower and the turns so far are dropped
const axis = () => ({ dir: 0, ext: null, at: 0, turns: [] });

// feed one sample; returns how many turning points are inside the window
function step(a, v, t, swing, win) {
  if (a.ext === null) { a.ext = v; a.at = t; }
  else if (!a.dir) { if (Math.abs(v - a.ext) >= swing) { a.dir = Math.sign(v - a.ext); a.ext = v; a.at = t; } }
  else if ((v - a.ext) * a.dir > 0) { a.ext = v; a.at = t; } // still going the same way
  else if ((a.ext - v) * a.dir >= swing) { // came back far enough
    if (t - a.at > SNAP) a.turns.length = 0; else a.turns.push(a.at);
    a.dir = -a.dir; a.ext = v; a.at = t;
  }
  while (a.turns.length && a.turns[0] < t - win) a.turns.shift();
  return a.turns.length;
}

export class HeadGestures {
  /** nod / shake: smallest swing (degrees) between turning points; window (s) for two of them; quiet: the other
   *  axis' range over the window must stay under this fraction of the gesture axis' range */
  constructor({ nod = 6, shake = 8, window = 1.1, cooldown = 1, quiet = 0.6 } = {}) {
    this.o = { nod: nod * DEG, shake: shake * DEG, window, cooldown, quiet };
    this.t = 0; this.wait = 0; this.prev = null; this.yaw = 0; this.hist = [];
    this.pitchAxis = axis(); this.yawAxis = axis();
  }

  /** yaw, pitch: radians, head relative to the rig -> 'nod' | 'shake' | null */
  update(dt, yaw, pitch) {
    const o = this.o, t = (this.t += dt);
    this.wait -= dt;
    // unwrapped, so turning round through ±180° isn't a 360° swing
    this.yaw += this.prev === null ? yaw : Math.atan2(Math.sin(yaw - this.prev), Math.cos(yaw - this.prev));
    this.prev = yaw;
    const h = this.hist;
    h.push([t, this.yaw, pitch]);
    while (h[0][0] < t - o.window) h.shift();
    const p = step(this.pitchAxis, pitch, t, o.nod, o.window), y = step(this.yawAxis, this.yaw, t, o.shake, o.window);
    if (this.wait > 0) return null;
    const range = (k) => { let lo = Infinity, hi = -Infinity; for (const s of h) { lo = Math.min(lo, s[k]); hi = Math.max(hi, s[k]); } return hi - lo; };
    const g = p >= 2 && range(1) < o.quiet * range(2) ? 'nod' : y >= 2 && range(2) < o.quiet * range(1) ? 'shake' : null;
    if (g) { this.wait = o.cooldown; this.pitchAxis.turns.length = 0; this.yawAxis.turns.length = 0; }
    return g;
  }
}
