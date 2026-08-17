#!/usr/bin/env python3
"""shoal — a living ecosystem in your terminal.

Fish shoals (boids), a hungry shark, and drifting food motes, rendered at
2x4 sub-character resolution with Unicode braille glyphs and 24-bit color.

Pure Python 3 stdlib. Run:  python3 shoal.py

Keys:
  q       quit
  space   pause
  f       drop food
  s / d   add / remove shark
  + / -   add / remove fish
"""

import atexit
import math
import random
import select
import shutil
import sys
import termios
import time
import tty

FPS = 30
DT = 1.0 / FPS

# ---------------------------------------------------------------------------
# Terminal layer
# ---------------------------------------------------------------------------

_saved_termios = None


def term_setup():
    global _saved_termios
    fd = sys.stdin.fileno()
    _saved_termios = termios.tcgetattr(fd)
    tty.setcbreak(fd)  # cbreak keeps ISIG, so Ctrl-C still raises KeyboardInterrupt
    sys.stdout.write("\x1b[?1049h\x1b[?25l")  # alt screen, hide cursor
    sys.stdout.flush()
    atexit.register(term_restore)


def term_restore():
    global _saved_termios
    sys.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l")  # reset, show cursor, main screen
    sys.stdout.flush()
    if _saved_termios is not None:
        termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, _saved_termios)
        _saved_termios = None


def read_keys():
    keys = []
    while select.select([sys.stdin], [], [], 0)[0]:
        keys.append(sys.stdin.read(1))
    return keys


# ---------------------------------------------------------------------------
# Braille canvas: each terminal cell is a 2x4 pixel block
# ---------------------------------------------------------------------------

# braille dot bit for (px_in_cell_x, px_in_cell_y)
DOT_BITS = ((0x01, 0x02, 0x04, 0x40), (0x08, 0x10, 0x20, 0x80))


class Canvas:
    def __init__(self, cols, rows):
        self.cols = cols
        self.rows = rows
        self.w = cols * 2   # pixel width
        self.h = rows * 4   # pixel height
        self.cells = {}     # (cx, cy) -> [bits, r, g, b, count]

    def set(self, x, y, color):
        x = int(x) % self.w
        y = int(y) % self.h
        cx, cy = x >> 1, y >> 2
        bit = DOT_BITS[x & 1][y & 3]
        cell = self.cells.get((cx, cy))
        if cell is None:
            self.cells[(cx, cy)] = [bit, color[0], color[1], color[2], 1]
        else:
            cell[0] |= bit
            cell[1] += color[0]
            cell[2] += color[1]
            cell[3] += color[2]
            cell[4] += 1

    def render(self, buf):
        # group by row, emit with cursor jumps; frames are sparse so this is cheap
        rows = {}
        for (cx, cy), cell in self.cells.items():
            rows.setdefault(cy, []).append((cx, cell))
        for cy in sorted(rows):
            last_cx = None
            for cx, (bits, r, g, b, n) in sorted(rows[cy]):
                if last_cx is None or cx != last_cx + 1:
                    buf.append("\x1b[%d;%dH" % (cy + 1, cx + 1))
                buf.append("\x1b[38;2;%d;%d;%dm%s" % (r // n, g // n, b // n, chr(0x2800 + bits)))
                last_cx = cx


# ---------------------------------------------------------------------------
# Simulation
# ---------------------------------------------------------------------------

SHOAL_COLORS = [
    (80, 200, 220),    # teal
    (255, 160, 70),    # orange
    (190, 130, 255),   # violet
]
FOOD_COLOR = (255, 230, 120)
SHARK_COLOR = (255, 80, 100)

NEIGHBOR_R = 12.0     # px
SEP_R = 4.0
PANIC_R = 22.0
FOOD_R = 30.0
FISH_SPEED = 28.0     # px/s
SHARK_SPEED = 40.0
EAT_R = 3.0


class Boid:
    __slots__ = ("x", "y", "vx", "vy", "shoal")

    def __init__(self, w, h, shoal=None):
        self.x = random.uniform(0, w)
        self.y = random.uniform(0, h)
        a = random.uniform(0, math.tau)
        self.vx = math.cos(a) * FISH_SPEED
        self.vy = math.sin(a) * FISH_SPEED
        self.shoal = shoal if shoal is not None else random.randrange(len(SHOAL_COLORS))


class Shark:
    __slots__ = ("x", "y", "vx", "vy")

    def __init__(self, w, h):
        self.x = random.uniform(0, w)
        self.y = random.uniform(0, h)
        self.vx, self.vy = SHARK_SPEED, 0.0


class Food:
    __slots__ = ("x", "y", "phase")

    def __init__(self, x, y):
        self.x = x
        self.y = y
        self.phase = random.uniform(0, math.tau)


class World:
    def __init__(self, w, h):
        self.w = w
        self.h = h
        self.t = 0.0
        self.boids = [Boid(w, h) for _ in range(120)]
        self.sharks = [Shark(w, h)]
        self.food = []
        self.respawn = []  # [time_left, shoal]
        self.eaten = 0

    def resize(self, w, h):
        self.w, self.h = w, h
        for b in self.boids + self.sharks + self.food:
            b.x %= w
            b.y %= h

    def current(self, x, y):
        # gentle time-varying flow so idle water still looks alive
        t = self.t
        cx = math.sin(y * 0.05 + t * 0.4) * 4.0 + math.cos(x * 0.03 - t * 0.23) * 2.5
        cy = math.cos(x * 0.05 + t * 0.3) * 2.0
        return cx, cy

    def _buckets(self):
        grid = {}
        for b in self.boids:
            grid.setdefault((int(b.x // NEIGHBOR_R), int(b.y // NEIGHBOR_R)), []).append(b)
        return grid

    def step(self, dt):
        self.t += dt
        w, h = self.w, self.h
        grid = self._buckets()

        for b in self.boids:
            # gather neighbors from 3x3 buckets
            gx, gy = int(b.x // NEIGHBOR_R), int(b.y // NEIGHBOR_R)
            ax = ay = 0.0                       # accumulated steering
            cx = cy = avx = avy = 0.0           # cohesion / alignment sums
            n = 0
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for o in grid.get((gx + dx, gy + dy), ()):
                        if o is b or o.shoal != b.shoal:
                            continue
                        ox, oy = o.x - b.x, o.y - b.y
                        d2 = ox * ox + oy * oy
                        if d2 > NEIGHBOR_R * NEIGHBOR_R:
                            continue
                        n += 1
                        cx += ox
                        cy += oy
                        avx += o.vx
                        avy += o.vy
                        if d2 < SEP_R * SEP_R and d2 > 1e-6:
                            k = 1.0 - math.sqrt(d2) / SEP_R
                            ax -= ox * k * 6.0
                            ay -= oy * k * 6.0
            if n:
                ax += (cx / n) * 0.9            # cohesion
                ay += (cy / n) * 0.9
                ax += (avx / n - b.vx) * 1.4    # alignment
                ay += (avy / n - b.vy) * 1.4

            # flee sharks
            for s in self.sharks:
                ox, oy = b.x - s.x, b.y - s.y
                d2 = ox * ox + oy * oy
                if d2 < PANIC_R * PANIC_R and d2 > 1e-6:
                    d = math.sqrt(d2)
                    k = (1.0 - d / PANIC_R) * 220.0
                    ax += ox / d * k
                    ay += oy / d * k

            # nibble toward nearby food
            for f in self.food:
                ox, oy = f.x - b.x, f.y - b.y
                d2 = ox * ox + oy * oy
                if d2 < FOOD_R * FOOD_R and d2 > 1e-6:
                    d = math.sqrt(d2)
                    ax += ox / d * 18.0
                    ay += oy / d * 18.0

            ccx, ccy = self.current(b.x, b.y)
            b.vx += (ax + ccx * 0.4) * dt * 3.0
            b.vy += (ay + ccy * 0.4) * dt * 3.0
            sp = math.hypot(b.vx, b.vy) or 1e-6
            top = FISH_SPEED * 1.25 if any(
                (b.x - s.x) ** 2 + (b.y - s.y) ** 2 < PANIC_R * PANIC_R for s in self.sharks
            ) else FISH_SPEED
            if sp > top:
                b.vx *= top / sp
                b.vy *= top / sp
            elif sp < FISH_SPEED * 0.5:
                b.vx *= FISH_SPEED * 0.5 / sp
                b.vy *= FISH_SPEED * 0.5 / sp
            b.x = (b.x + b.vx * dt) % w
            b.y = (b.y + b.vy * dt) % h

        # sharks hunt the nearest fish
        for s in self.sharks:
            target, best = None, 1e18
            for b in self.boids:
                d2 = (b.x - s.x) ** 2 + (b.y - s.y) ** 2
                if d2 < best:
                    best, target = d2, b
            if target is not None:
                d = math.sqrt(best) or 1e-6
                s.vx += (target.x - s.x) / d * 60.0 * dt
                s.vy += (target.y - s.y) / d * 60.0 * dt
            sp = math.hypot(s.vx, s.vy) or 1e-6
            if sp > SHARK_SPEED:
                s.vx *= SHARK_SPEED / sp
                s.vy *= SHARK_SPEED / sp
            s.x = (s.x + s.vx * dt) % w
            s.y = (s.y + s.vy * dt) % h
            if target is not None and best < EAT_R * EAT_R:
                self.boids.remove(target)
                self.eaten += 1
                self.respawn.append([random.uniform(3.0, 6.0), target.shoal])
                # remains drift off as a food mote
                self.food.append(Food(target.x, target.y))

        # eaten fish come back after a while (population stays stable)
        for r in self.respawn:
            r[0] -= dt
        for r in [r for r in self.respawn if r[0] <= 0]:
            self.respawn.remove(r)
            self.boids.append(Boid(w, h, r[1]))

        # food drifts down with a sway; fish that reach it consume it
        for f in list(self.food):
            f.y = (f.y + 3.5 * dt) % h
            f.x = (f.x + math.sin(self.t * 1.5 + f.phase) * 3.0 * dt) % w
            for b in self.boids:
                if (b.x - f.x) ** 2 + (b.y - f.y) ** 2 < EAT_R * EAT_R:
                    self.food.remove(f)
                    break

    # ------ drawing ------

    def draw(self, canvas):
        for b in self.boids:
            col = SHOAL_COLORS[b.shoal]
            sp = math.hypot(b.vx, b.vy) or 1e-6
            ux, uy = b.vx / sp, b.vy / sp
            canvas.set(b.x, b.y, col)
            canvas.set(b.x - ux, b.y - uy, tuple(c * 2 // 3 for c in col))  # tail

        for f in self.food:
            canvas.set(f.x, f.y, FOOD_COLOR)

        for s in self.sharks:
            sp = math.hypot(s.vx, s.vy) or 1e-6
            ux, uy = s.vx / sp, s.vy / sp
            px, py = -uy, ux
            for i in range(-1, 5):  # body streak, nose to tail
                shade = SHARK_COLOR if i < 2 else (170, 60, 75)
                canvas.set(s.x - ux * i, s.y - uy * i, shade)
            canvas.set(s.x - ux * 2 + px, s.y - uy * 2 + py, (170, 60, 75))  # fins
            canvas.set(s.x - ux * 2 - px, s.y - uy * 2 - py, (170, 60, 75))


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main():
    cols, rows = shutil.get_terminal_size()
    world = World(cols * 2, (rows - 1) * 4)  # bottom row reserved for HUD
    term_setup()
    paused = False
    fps_shown = FPS
    try:
        while True:
            frame_start = time.monotonic()

            # handle resize by polling size (avoids SIGWINCH/select races)
            ncols, nrows = shutil.get_terminal_size()
            if (ncols, nrows) != (cols, rows):
                cols, rows = ncols, nrows
                world.resize(cols * 2, (rows - 1) * 4)

            for k in read_keys():
                if k == "q":
                    return
                elif k == " ":
                    paused = not paused
                elif k == "f":
                    fx, fy = random.uniform(0, world.w), random.uniform(0, world.h * 0.3)
                    world.food.extend(
                        Food(fx + random.uniform(-4, 4), fy + random.uniform(-4, 4))
                        for _ in range(6)
                    )
                elif k == "s":
                    world.sharks.append(Shark(world.w, world.h))
                elif k == "d" and world.sharks:
                    world.sharks.pop()
                elif k in "+=":
                    world.boids.extend(Boid(world.w, world.h) for _ in range(10))
                elif k == "-" and len(world.boids) > 10:
                    del world.boids[-10:]

            if not paused:
                world.step(DT)

            canvas = Canvas(cols, rows - 1)
            world.draw(canvas)
            buf = ["\x1b[2J"]
            canvas.render(buf)
            hud = " %d fish  %d shark%s  %d motes  %d eaten  %2.0f fps %s" % (
                len(world.boids), len(world.sharks),
                "" if len(world.sharks) == 1 else "s",
                len(world.food), world.eaten, fps_shown,
                "[paused]" if paused else "",
            )
            keys_help = "q quit  space pause  f food  s/d shark  +/- fish "
            pad = max(1, cols - len(hud) - len(keys_help))
            buf.append("\x1b[%d;1H\x1b[38;2;110;125;140m%s%s%s\x1b[0m"
                       % (rows, hud[:cols], " " * pad, keys_help[:max(0, cols - len(hud) - pad)]))
            sys.stdout.write("".join(buf))
            sys.stdout.flush()

            elapsed = time.monotonic() - frame_start
            if elapsed < DT:
                time.sleep(DT - elapsed)
            fps_shown = fps_shown * 0.9 + (1.0 / max(elapsed, DT)) * 0.1
    except KeyboardInterrupt:
        pass
    finally:
        term_restore()


if __name__ == "__main__":
    main()
