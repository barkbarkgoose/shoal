// Starting configurations. Each is a plain object consumed by MagPhys.create.
// Angles are in radians; +y is up, so pi/2 points a moment straight up.
// AC magnets carry `unit` (which lift unit they belong to) and `phase0`; the
// "phase step" knob sets phase = phase0 + unit * step.
(function (root) {
  'use strict';
  const UP = Math.PI / 2, DOWN = -Math.PI / 2;
  const XS = [-0.105, -0.035, 0.035, 0.105];

  const plate = (over) => ({
    mass: 0.5, width: 0.3, height: 0.02, x: 0, y: 0.036, theta: 0,
    magnets: XS.map((x) => ({ x, y: -0.01, angle: DOWN, m0: 1, mode: 'static' })),
    ...over,
  });
  const floorRow = () => XS.map((x) => ({ x, y: 0, angle: UP, m0: 1, mode: 'static' }));
  const coil = (x, y, angle, m0, unit, freq, over) => ({
    x, y, angle, m0, mode: 'ac', bias: 0, amp: 1, freq, unit, phase0: Math.PI / 2, phase: Math.PI / 2, ...over,
  });

  const presets = {
    'your-idea': {
      title: 'Phased push/pull pairs',
      short: 'Your idea',
      blurb:
        'Four lift units. In each, a floor coil pushes and a ceiling coil pulls on the platform magnet between them, so both lift together. Units are staggered 90° apart, so at every instant about half of them are lifting. The other half are pushing down just as hard, and the mean lift sits near zero. Try the phase step at 0°, then compare with the AC trap presets.',
      platform: plate({ y: 0.035, magnets: XS.map((x) => ({ x, y: 0, angle: UP, m0: 1, mode: 'static' })) }),
      fixed: XS.flatMap((x, i) => [coil(x, 0, DOWN, 1.5, i, 8), coil(x, 0.07, UP, 1.5, i, 8)]),
      phaseStep: 90,
      bounds: { floor: 0, ceil: 0.07, half: 0.6, ceilSolid: true },
      dt: 5e-5,
    },
    closed: {
      title: 'Magnets only on board',
      short: 'Closed system',
      blurb:
        'Every magnet rides on the platform: oscillating pairs pushing and pulling on each other as hard as you like. The internal-force readout shows those forces summing to zero, pair by pair (Newton’s third law). It falls exactly like a brick. Lift needs something outside the platform to push against.',
      platform: plate({
        y: 0.25, height: 0.06,
        magnets: XS.flatMap((x, i) => [
          { ...coil(x, -0.02, UP, 1, i, 8) },
          { x, y: 0.02, angle: UP, m0: 1, mode: 'static' },
        ]),
      }),
      fixed: [],
      dt: 5e-5,
    },
    'static-repel': {
      title: 'Static repulsion',
      short: 'Static magnets',
      blurb:
        'Four permanent magnets in the floor push up on four in the platform. Vertically this is a good spring. Sideways it is not: a 1 mm offset grows until the platform slides off in about 0.2 s. That is Earnshaw’s theorem. No arrangement of static magnets is stable in every direction at once.',
      platform: plate({ x: 0.001, y: 0.037 }),
      fixed: floorRow(),
      dt: 5e-5,
    },
    'static-rails': {
      title: 'Static + guide rails',
      short: 'With rails',
      blurb:
        'Same magnets, with sideways motion and tilt locked, as if the platform ran in a slot. Now it bobs and floats forever. The magnets can carry the weight. The only thing missing was sideways stability, and every working levitator is a way of supplying that one direction.',
      platform: plate({ x: 0.001, y: 0.03 }),
      fixed: floorRow(),
      lock: { x: true, theta: true },
      airDrag: 0.05,
      dt: 5e-5,
    },
    feedback: {
      title: 'Active feedback',
      short: 'Feedback',
      blurb:
        'Two electromagnets in a ceiling rail pull the platform up. Hanging is stable sideways but unstable vertically, so a controller reads the gap continuously and trims each coil’s current. This is how EMS maglev trains (Transrapid) work. Turn the gains down to watch it lose control.',
      platform: plate({ y: 0.16, magnets: [-0.1, 0.1].map((x) => ({ x, y: 0.01, angle: UP, m0: 1, mode: 'static' })) }),
      fixed: [-0.1, 0.1].map((x) => ({ x, y: 0.19, angle: UP, m0: 1, mode: 'feedback' })),
      feedback: { target: 0.17, bias: 0.65, kp: 300, kd: 5, max: 4 },
      bounds: { floor: 0, ceil: 0.19, half: 0.6, ceilSolid: true },
      dt: 5e-5,
    },
    'ac-puck': {
      title: 'AC trap: one magnet',
      short: 'AC trap',
      blurb:
        'Two floor coils driven with pure AC: zero average current, so they spend exactly half of each cycle pushing and half pulling. First-order lift is zero, yet a 20 g magnet hovers and stays centred. The magnet shakes slightly in time with the drive and is always a little farther away during the pull. That leaves a small net upward push (the Kapitza/Paul-trap effect).',
      platform: {
        mass: 0.02, width: 0.01, height: 0.01, x: 0.0005, y: 0.02, theta: 0,
        magnets: [{ x: 0, y: 0, angle: UP, m0: 0.5, mode: 'static' }],
      },
      fixed: [-0.02, 0.02].map((x) => coil(x, 0, UP, 12, 0, 120)),
      phaseStep: 0,
      soft: 0.003,
      bounds: { floor: 0, ceil: 1, half: 0.3 },
      dt: 1e-5,
      view: { cx: 0, cy: 0.025, half: 0.06 },
    },
    'ac-platform': {
      title: 'AC trap: platform',
      short: 'AC platform',
      blurb:
        'Your platform, built from four AC traps. With every unit in phase (all push together, all pull together), it hovers and holds itself level. Now raise the phase step. Past about 45° the units stop shaking the platform up and down together and start rocking it, and it drops. Having half the units pull while half push is exactly what breaks it.',
      platform: {
        mass: 0.08, width: 0.24, height: 0.01, x: 0.001, y: 0.02, theta: 0.002,
        magnets: [-0.09, -0.03, 0.03, 0.09].map((x) => ({ x, y: 0, angle: UP, m0: 0.5, mode: 'static' })),
      },
      fixed: [-0.09, -0.03, 0.03, 0.09].flatMap((x, i) => [-0.02, 0.02].map((d) => coil(x + d, 0, UP, 20, i, 120))),
      phaseStep: 0,
      soft: 0.003,
      bounds: { floor: 0, ceil: 1, half: 0.3 },
      dt: 1e-5,
      view: { cx: 0, cy: 0.04, half: 0.17 },
    },
  };

  // Knobs shared by the UI and the explorer. get/set read and write a config.
  const acFixed = (c) => c.fixed.filter((m) => m.mode === 'ac');
  const drive = (c) => c.fixed.filter((m) => m.mode !== 'static');
  const knobs = {
    freq: {
      label: 'Drive frequency', unit: 'Hz', min: 1, max: 300, step: 1,
      has: (c) => acFixed(c).length > 0 || c.platform.magnets.some((m) => m.mode === 'ac'),
      get: (c) => (acFixed(c)[0] || c.platform.magnets.find((m) => m.mode === 'ac')).freq,
      set: (c, v) => [...c.fixed, ...c.platform.magnets].forEach((m) => { if (m.mode === 'ac') m.freq = v; }),
    },
    coil: {
      label: 'Coil strength (peak)', unit: 'A·m²', min: 0, max: 40, step: 0.5,
      has: (c) => drive(c).length > 0,
      get: (c) => drive(c)[0].m0,
      set: (c, v) => drive(c).forEach((m) => (m.m0 = v)),
    },
    bias: {
      label: 'DC bias (fraction of peak)', unit: '', min: 0, max: 2, step: 0.05,
      has: (c) => acFixed(c).length > 0,
      get: (c) => acFixed(c)[0].bias,
      set: (c, v) => acFixed(c).forEach((m) => (m.bias = v)),
    },
    phaseStep: {
      label: 'Phase step between units', unit: '°', min: 0, max: 180, step: 5,
      has: (c) => c.phaseStep !== undefined,
      get: (c) => c.phaseStep,
      set: (c, v) => {
        c.phaseStep = v;
        [...c.fixed, ...c.platform.magnets].forEach((m) => {
          if (m.unit !== undefined) m.phase = m.phase0 + (m.unit * v * Math.PI) / 180;
        });
      },
    },
    mass: {
      label: 'Platform mass', unit: 'kg', min: 0.005, max: 1, step: 0.005,
      has: () => true,
      get: (c) => c.platform.mass,
      set: (c, v) => (c.platform.mass = v),
    },
    kp: {
      label: 'Controller gain P', unit: '', min: 0, max: 800, step: 10,
      has: (c) => !!c.feedback, get: (c) => c.feedback.kp, set: (c, v) => (c.feedback.kp = v),
    },
    kd: {
      label: 'Controller gain D', unit: '', min: 0, max: 20, step: 0.5,
      has: (c) => !!c.feedback, get: (c) => c.feedback.kd, set: (c, v) => (c.feedback.kd = v),
    },
  };
  for (const c of Object.values(presets)) if (c.phaseStep !== undefined) knobs.phaseStep.set(c, c.phaseStep);

  const api = { presets, knobs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MagPresets = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
