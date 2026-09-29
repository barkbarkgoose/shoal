// maglev physics — rigid platform + point magnetic dipoles + gravity, in a
// vertical 2D plane. Shared by the browser page (index.html) and the headless
// experiment runner (experiments.js).
//
// Model
//   - Every magnet is an ideal point dipole. Fields are the real 3D dipole
//     field evaluated in the x/y plane (moments lie in the plane), so the
//     force law is the genuine 1/r^4 dipole-dipole law, not a 2D analogue.
//   - The platform is one rigid body with x, y, tilt (theta). Any magnet
//     attached to it moves with it; everything else is bolted to the world.
//   - Magnets attached to the same platform still exert forces on each other;
//     those forces are computed and summed so you can watch them cancel.
//   - Softening length `soft` keeps the 1/r^4 law finite when magnets touch.
//
// Units are SI: metres, kilograms, seconds, A·m^2 (a 1 cm N52 cube is ~1 A·m^2).
(function (root) {
  'use strict';

  const K = 1e-7; // mu0 / 4pi
  const TAU = Math.PI * 2;

  // Moment vector of a magnet at time t. `extraAngle` is the platform tilt for
  // attached magnets. `u` is the feedback controller's output (if any).
  function moment(mag, t, extraAngle, u) {
    let dir = mag.angle + extraAngle;
    let s = mag.m0;
    const w = TAU * (mag.freq || 0) * t + (mag.phase || 0);
    switch (mag.mode) {
      case 'ac': // electromagnet with sinusoidal current: bias + amp*sin
        s *= (mag.bias ?? 0) + (mag.amp ?? 1) * Math.sin(w);
        break;
      case 'rotate': // permanent magnet spun by a motor
        dir += w;
        break;
      case 'feedback': // electromagnet driven by the controller
        s *= u;
        break;
      default: // 'static' permanent magnet
        break;
    }
    return [s * Math.cos(dir), s * Math.sin(dir)];
  }

  // Force on dipole 2 from dipole 1, and dipole 1's field at dipole 2.
  // r = p2 - p1. Writes [Fx, Fy, Bx, By] into out.
  function pair(m1x, m1y, m2x, m2y, rx, ry, soft, out) {
    const r2 = rx * rx + ry * ry + soft * soft;
    const r = Math.sqrt(r2);
    const nx = rx / r, ny = ry / r;
    const a = m1x * nx + m1y * ny; // m1·r̂
    const b = m2x * nx + m2y * ny; // m2·r̂
    const c = m1x * m2x + m1y * m2y; // m1·m2
    const r4 = r2 * r2;
    const f = (3 * K) / r4;
    out[0] = f * (a * m2x + b * m1x + (c - 5 * a * b) * nx);
    out[1] = f * (a * m2y + b * m1y + (c - 5 * a * b) * ny);
    const g = K / (r2 * r);
    out[2] = g * (3 * a * nx - m1x);
    out[3] = g * (3 * a * ny - m1y);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Build a live simulation from a plain config object (see presets.js).
  function create(cfg) {
    cfg = clone(cfg);
    const p = cfg.platform;
    const I = p.inertia ?? (p.mass * (p.width * p.width + p.height * p.height)) / 12;
    const sim = {
      cfg,
      t: 0,
      s: { x: p.x ?? 0, y: p.y, th: p.theta ?? 0, vx: p.vx ?? 0, vy: p.vy ?? 0, w: p.omega ?? 0 },
      I,
      status: 'flying', // 'flying' | 'crashed' | 'escaped'
      statusT: 0,
      last: null, // diagnostics from the most recent force evaluation
      u: {}, // feedback outputs by magnet index
    };
    return sim;
  }

  // World-space position of a platform-local point.
  function toWorld(s, lx, ly) {
    const c = Math.cos(s.th), n = Math.sin(s.th);
    return [s.x + lx * c - ly * n, s.y + lx * n + ly * c];
  }

  // Height of the platform's underside directly below world x (for feedback).
  function feedbackOutputs(sim) {
    const { cfg, s } = sim;
    const fb = cfg.feedback;
    if (!fb) return;
    const top = cfg.platform.height / 2;
    cfg.fixed.forEach((m, i) => {
      if (m.mode !== 'feedback') return;
      // gap sensor: platform top surface height under this magnet
      const dx = m.x - s.x;
      const yTop = s.y + dx * Math.tan(s.th) + top / Math.cos(s.th);
      const vTop = s.vy + dx * s.w / (Math.cos(s.th) ** 2);
      const e = yTop - fb.target; // + means too high (too close to ceiling)
      let u = fb.bias - fb.kp * e - fb.kd * vTop;
      sim.u[i] = Math.max(0, Math.min(fb.max, u));
    });
  }

  // Net force and torque on the platform at the current state.
  const tmp = [0, 0, 0, 0];
  function forces(sim) {
    const { cfg, s, t } = sim;
    const P = cfg.platform;
    const soft = cfg.soft ?? 0.004;
    const att = P.magnets.map((m) => {
      const [wx, wy] = toWorld(s, m.x, m.y);
      const [mx, my] = moment(m, t, s.th, 1);
      return { wx, wy, mx, my };
    });
    const fix = cfg.fixed.map((m, i) => {
      const [mx, my] = moment(m, t, 0, sim.u[i] ?? 0);
      return { wx: m.x, wy: m.y, mx, my };
    });
    let fx = 0, fy = 0, tq = 0;
    let ex = 0, ey = 0; // external magnetic force only
    let ix = 0, iy = 0, itq = 0; // internal (platform-on-platform) sums
    const perMag = att.map(() => [0, 0]);
    for (let j = 0; j < att.length; j++) {
      const A = att[j];
      const lx = A.wx - s.x, ly = A.wy - s.y;
      for (let i = 0; i < fix.length; i++) {
        const F = fix[i];
        pair(F.mx, F.my, A.mx, A.my, A.wx - F.wx, A.wy - F.wy, soft, tmp);
        ex += tmp[0]; ey += tmp[1];
        perMag[j][0] += tmp[0]; perMag[j][1] += tmp[1];
        tq += lx * tmp[1] - ly * tmp[0] + (A.mx * tmp[3] - A.my * tmp[2]);
      }
      for (let k = 0; k < att.length; k++) {
        if (k === j) continue;
        const B = att[k];
        pair(B.mx, B.my, A.mx, A.my, A.wx - B.wx, A.wy - B.wy, soft, tmp);
        ix += tmp[0]; iy += tmp[1];
        itq += lx * tmp[1] - ly * tmp[0] + (A.mx * tmp[3] - A.my * tmp[2]);
      }
    }
    const g = cfg.gravity ?? 9.81;
    const M = P.mass;
    const damp = cfg.airDrag ?? 0;
    fx = ex + ix - damp * s.vx;
    fy = ey + iy - M * g - damp * s.vy;
    tq += itq - damp * 0.01 * s.w;
    sim.last = { fx, fy, tq, ex, ey, ix, iy, itq, perMag, att, fix, weight: M * g };
    return sim.last;
  }

  // Advance by `dt` using semi-implicit (symplectic) Euler.
  function step(sim, dt) {
    if (sim.status !== 'flying') return;
    const { cfg, s } = sim;
    const P = cfg.platform;
    const lock = cfg.lock || {};
    feedbackOutputs(sim);
    const f = forces(sim);
    if (!lock.x) s.vx += (f.fx / P.mass) * dt;
    if (!lock.y) s.vy += (f.fy / P.mass) * dt;
    if (!lock.theta) s.w += (f.tq / sim.I) * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.th += s.w * dt;
    sim.t += dt;
    checkBounds(sim);
  }

  function corners(sim) {
    const { s } = sim;
    const w = sim.cfg.platform.width / 2, h = sim.cfg.platform.height / 2;
    return [[-w, -h], [w, -h], [w, h], [-w, h]].map(([a, b]) => toWorld(s, a, b));
  }

  function checkBounds(sim) {
    const b = sim.cfg.bounds || { floor: 0, ceil: 1, half: 0.6 };
    const cs = corners(sim);
    let lo = Infinity, hi = -Infinity;
    for (const [, y] of cs) { lo = Math.min(lo, y); hi = Math.max(hi, y); }
    if (lo <= b.floor || (b.ceilSolid && hi >= b.ceil)) {
      sim.status = 'crashed';
      sim.statusT = sim.t;
    } else if (Math.abs(sim.s.x) > b.half || sim.s.y > b.ceil * 3 || Math.abs(sim.s.th) > Math.PI * 4) {
      sim.status = 'escaped';
      sim.statusT = sim.t;
    }
  }

  // Run headless for `duration` seconds. Returns a summary used by the
  // explorer heat-map and by experiments.js.
  function run(cfg, duration, opts = {}) {
    const sim = create(cfg);
    const dt = opts.dt ?? cfg.dt ?? 2e-5;
    const every = Math.max(1, Math.round((opts.sampleEvery ?? 0.01) / dt));
    let n = 0;
    let fyAvg = 0, cnt = 0, yMin = Infinity, yMax = -Infinity, xMax = 0, thMax = 0;
    const trace = opts.trace ? [] : null;
    while (sim.t < duration && sim.status === 'flying') {
      step(sim, dt);
      fyAvg += sim.last.ey; cnt++;
      if (++n % every === 0) {
        const s = sim.s;
        yMin = Math.min(yMin, s.y); yMax = Math.max(yMax, s.y);
        xMax = Math.max(xMax, Math.abs(s.x - (cfg.platform.x ?? 0)));
        thMax = Math.max(thMax, Math.abs(s.th));
        if (trace) trace.push([sim.t, s.x, s.y, s.th]);
      }
    }
    return {
      status: sim.status,
      survived: sim.status === 'flying' ? duration : sim.statusT,
      liftRatio: cnt ? fyAvg / cnt / (cfg.platform.mass * (cfg.gravity ?? 9.81)) : 0,
      yMin, yMax, xMax, thMax,
      final: { ...sim.s },
      trace,
    };
  }

  // Set a dotted path like "fixed.*.freq" or "platform.mass" on a config.
  function setPath(cfg, path, value) {
    const parts = path.split('.');
    const walk = (obj, i) => {
      const k = parts[i];
      if (i === parts.length - 1) {
        if (k === '*') obj.forEach((_, j) => (obj[j] = value));
        else obj[k] = value;
        return;
      }
      if (k === '*') obj.forEach((o) => walk(o, i + 1));
      else walk(obj[k], i + 1);
    };
    walk(cfg, 0);
    return cfg;
  }

  const api = { K, moment, pair, create, step, forces, run, corners, toWorld, clone, setPath };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MagPhys = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
