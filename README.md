# shoal

A living ecosystem in your terminal. Fish shoals flock, a shark hunts, food
drifts down — all rendered at 2×4 sub-character resolution with Unicode
braille glyphs and 24-bit color.

Pure Python 3 stdlib, zero dependencies.

```sh
python3 shoal.py
```

## Keys

| key     | action              |
|---------|---------------------|
| `q`     | quit                |
| `space` | pause               |
| `f`     | drop food           |
| `s` / `d` | add / remove shark |
| `+` / `-` | add / remove fish  |

## How it works

- **Boids**: each fish steers by separation, alignment, and cohesion against
  neighbors of its own shoal (three shoals, three colors), found via spatial
  hash buckets so it stays fast at hundreds of fish.
- **Predator**: the shark chases the nearest fish; fish inside its panic
  radius get a speed boost and scatter, then the shoal reforms. Eaten fish
  leave a food mote behind and respawn a few seconds later.
- **Rendering**: the screen is a pixel grid at twice the column and four
  times the row resolution; every 2×4 block maps to one braille codepoint
  (U+2800–U+28FF), colored by averaging the pixels that landed in it.
- A gentle time-varying current keeps the water moving even when nothing is
  chasing anything.

Needs a terminal with truecolor support (iTerm2, Ghostty, kitty, recent
Terminal.app, anything inside tmux ≥ 3.2 with `tmux-256color`).
