#!/usr/bin/env node
// Headless runs behind the findings in README.md. Run: node experiments.js
'use strict';
const P = require('./physics.js');
const { presets, knobs } = require('./presets.js');

function report(name, cfg, T) {
  const r = P.run(cfg, T, { dt: cfg.dt });
  const s = r.status === 'flying' ? `still up after ${T}s` : `${r.status} at ${r.survived.toFixed(2)}s`;
  console.log(
    `${name.padEnd(44)} ${s.padEnd(22)} mean lift/weight ${r.liftRatio.toFixed(3).padStart(6)}` +
      `  drift ${(r.xMax * 1000).toFixed(1).padStart(6)} mm  tilt ${r.thMax.toFixed(3)} rad`,
  );
}
const withKnob = (key, k, v) => {
  const c = P.clone(presets[key]);
  knobs[k].set(c, v);
  return c;
};

console.log('\n1. Every preset, 3 s');
for (const [k, c] of Object.entries(presets)) report(`${k} (${c.title})`, c, 3);

// Hold the platform still and measure what the coils deliver over whole cycles.
function held(cfg, T) {
  const c = P.clone(cfg);
  c.lock = { x: true, y: true, theta: true };
  const sim = P.create(c);
  const dt = c.dt;
  let sum = 0, n = 0, lo = Infinity, hi = -Infinity;
  while (sim.t < T) {
    P.step(sim, dt);
    const r = sim.last.ey / sim.last.weight;
    sum += r; n++; lo = Math.min(lo, r); hi = Math.max(hi, r);
  }
  return { mean: sum / n, lo, hi };
}

console.log('\n2a. Your idea, platform held still for 1 s: lift as a multiple of weight');
for (const [st, b] of [[0, 0], [45, 0], [90, 0], [180, 0], [90, 1]]) {
  const c = withKnob('your-idea', 'phaseStep', st);
  knobs.bias.set(c, b);
  const h = held(c, 1);
  console.log(`step ${String(st).padStart(3)}\u00b0, bias ${b}`.padEnd(44) +
    ` mean ${h.mean.toFixed(3).padStart(6)}   range ${h.lo.toFixed(2)} .. ${h.hi.toFixed(2)}`);
}

console.log('\n2b. Your idea, released');
for (const st of [0, 45, 90, 180]) report(`your-idea, step ${st}°`, withKnob('your-idea', 'phaseStep', st), 3);
for (const b of [1, 1.5]) report(`your-idea, step 90°, bias ${b}`, withKnob('your-idea', 'bias', b), 3);

console.log('\n3. AC platform: phase step between the four traps');
for (const st of [0, 20, 45, 90, 180]) report(`ac-platform, step ${st}°`, withKnob('ac-platform', 'phaseStep', st), 3);

console.log('\n4. AC platform: drive frequency');
for (const f of [30, 60, 120, 200]) report(`ac-platform, ${f} Hz`, withKnob('ac-platform', 'freq', f), 3);

console.log('\n5. AC trap control: coils off');
report('ac-puck, coil strength 0', withKnob('ac-puck', 'coil', 0), 1);
