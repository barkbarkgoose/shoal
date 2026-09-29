# maglev bench

A gravity + magnetism simulator for testing levitation ideas: a rigid platform,
point magnetic dipoles (permanent magnets, AC coils, feedback-controlled
electromagnets, all using the real 3D dipole–dipole force law), and gravity, in
a vertical plane.

```sh
cd maglev
python3 -m http.server 8000   # then open http://localhost:8000
node experiments.js           # headless runs behind the findings below
```

Plain JS, no dependencies. `physics.js` and `presets.js` load in both the
browser page and Node.

## What's in the page

- **Setups**: your phased push/pull idea, a closed system with every magnet on
  board, static repulsion, static magnets with guide rails, active feedback
  (EMS maglev style), and two AC traps (one magnet, and a four-trap platform).
- **Knobs** (applied live): drive frequency, coil strength, DC bias, phase step
  between units, platform mass, controller gains. You can also lock sideways
  motion or tilt, nudge the platform, and run it in slow motion.
- **Explorer**: sweeps any two knobs over a grid, runs each combination
  headless, and draws a map of how long the platform stayed up. Click a cell to
  load it.

## Findings (from `experiments.js`)

| Setup | Result |
|---|---|
| Phased push/pull pairs, held still | Mean lift is exactly 0 at any stagger. At 90° the units cancel instant by instant (±1% of weight). |
| Phased push/pull pairs, released | Falls in < 0.1 s. With DC bias it gets lift but tips over in 0.2 s. |
| All magnets on the platform | Internal forces sum to ~1e-16 N. Falls at exactly g. |
| Static repulsion | Slides off sideways in 0.16 s (Earnshaw's theorem). |
| Static + rails (sideways and tilt locked) | Floats indefinitely. |
| Active feedback | Floats, gap held to 0.1 mm. |
| **Pure AC trap (zero-mean current)** | **Floats and stays centred.** Stable 10 s+, robust to time step. |
| AC platform, phase step 0–45° | Floats. |
| AC platform, phase step 90° / 180° | Falls in 0.25 s / 0.07 s. |

The interesting one: coils driven with zero-average current (half push, half
pull) *can* levitate a magnet stably. The platform shakes slightly in time
with the drive and is a little farther away during the pull, so repulsion wins
on average. It is the Kapitza/Paul-trap effect, and Earnshaw's theorem does not
forbid it because the field isn't static. But it only works when the units run
**in phase**. Staggering them so half pull while half push cancels the
shaking that produces the lift.

## Limits

Point dipoles (3–4 mm softening), motion confined to one vertical plane (a real
platform has three more ways to move, and each must also be stable), ideal
coils (no inductance, eddy currents, heating or iron), semi-implicit Euler at
10–50 µs steps. Treat anything surprising as a lead to check, not a result.
