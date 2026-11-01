"""Draws the detailed platformer asset set from code: every asset from one palette.

Run from this folder: `python3 make.py` (Pillow). It writes the 1x art under
`art/`, nearest-neighbour previews under `previews/`, the composed mockup, and
the comparisons with the first set (`../platformer-assets/`). Everything is a
function of fixed seeds, so a run makes the same bytes.

The first set draws 8 px tiles and a 16 px climber; this one draws 16 px tiles
and a 48 px frame, so most things here are built from shapes and rules (a
puppet for the player, materials for the tiles) rather than typed pixel by
pixel: at this size a typed grid is too slow to pose and too easy to make
inconsistent.
"""

import json
import math
import os
import random
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "art")
PREVIEWS = os.path.join(HERE, "previews")
SET_ONE = os.path.join(HERE, "..", "platformer-assets")

# --- The palette -------------------------------------------------------------
# 60 colors of AAP-64 (Adigun A. Polack), by name, in ramps from dark to light.
# AAP-64 has long ramps (six steps of brown, khaki, green, teal, and grey), which
# is what a larger sprite needs: a material gets a contour, a shade, a base, a
# light, and a highlight. Set one's Endesga 32 has three or four.
RAMPS = {
    # The shared darks: outlines on the shaded side, and the deepest shadow.
    "ink": ["#141013"],
    # Daylight sky, toward the haze: lavender at the top to cream at the horizon.
    "sky": ["#849be4", "#b9bffb", "#e3e6ff", "#fef3c0"],
    # Steel: girders, spikes, the backpack, the far city (cool grey).
    "steel": ["#333941", "#4a5462", "#6d758d", "#8b93af", "#b3b9d1", "#dae0ea", "#ffffff"],
    # Teal: the jungle and ruins behind the play (backdrop only).
    "teal": ["#122020", "#24523b", "#23674e", "#328464", "#477d85", "#5daf8d", "#92dcba", "#cdf7e2"],
    # Leaf: live green on the play layer (grass, moss, ferns).
    "leaf": ["#1a7a3e", "#14a02e", "#59c135", "#9cdb43", "#d6f264"],
    # Earth: soil and wood, warm.
    "earth": ["#221c1a", "#322b28", "#71413b", "#bb7547", "#dba463"],
    # Stone: the masonry the player stands on (khaki).
    "stone": ["#423934", "#5a4e44", "#796755", "#a08662", "#c7b08b", "#e4d2aa"],
    # Rose: skin shadows, rust.
    "rose": ["#422433", "#5b3138", "#8e5252", "#ba756a", "#e9b5a3", "#fad6b8"],
    # Blue: the player's jacket, hers alone.
    "blue": ["#143464", "#285cc4", "#249fde", "#20d6c7", "#a6fcdb"],
    # Fire: the player's hair, warning paint, embers.
    "fire": ["#3b1725", "#73172d", "#b4202a", "#df3e23", "#fa6a0a"],
    # Gold: what can be taken (the cog), the dash while it is ready, the beacon.
    "gold": ["#f9a31b", "#ffd541", "#fffc40"],
    # Violet: the enemy, alone.
    "violet": ["#242234", "#403353", "#793a80", "#bc4a9b", "#e86a73"],
}

# Every color by a short name: the ramp's name and the step, from 0 (darkest).
PALETTE = {}
for _ramp, _colors in RAMPS.items():
    for _i, _hex in enumerate(_colors):
        PALETTE[_ramp if len(_colors) == 1 else f"{_ramp}{_i}"] = _hex


def rgb(name):
    h = PALETTE[name].lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def ramp_of(name):
    """The ramp's name and the step of a color name ("blue2" -> ("blue", 2))."""
    if name == "ink":
        return "ink", 0
    base = name.rstrip("0123456789")
    return base, int(name[len(base):])


def shade(name, by):
    """The same material, `by` steps lighter (positive) or darker, kept inside its ramp."""
    base, i = ramp_of(name)
    if base == "ink":
        return name
    n = len(RAMPS[base])
    return f"{base}{max(0, min(n - 1, i + by))}"


class Canvas:
    """A grid of palette names (None is transparent)."""

    def __init__(self, w, h, fill=None):
        self.w, self.h = w, h
        self.px = [[fill] * w for _ in range(h)]

    def get(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y][x]
        return None

    def set(self, x, y, c):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = c

    def rect(self, x, y, w, h, c):
        for j in range(y, y + h):
            for i in range(x, x + w):
                self.set(i, j, c)

    def blit(self, other, x, y, wrap=False):
        for j in range(other.h):
            for i in range(other.w):
                c = other.px[j][i]
                if c is not None:
                    tx = (x + i) % self.w if wrap else x + i
                    self.set(tx, y + j, c)

    def copy(self):
        c = Canvas(self.w, self.h)
        c.px = [row[:] for row in self.px]
        return c

    def flipped(self):
        c = Canvas(self.w, self.h)
        c.px = [row[::-1] for row in self.px]
        return c

    def crop(self, x, y, w, h):
        c = Canvas(w, h)
        for j in range(h):
            for i in range(w):
                c.px[j][i] = self.get(x + i, y + j)
        return c

    def image(self):
        img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        img.putdata([(0, 0, 0, 0) if c is None else rgb(c) + (255,) for row in self.px for c in row])
        return img


def from_rows(rows, keys):
    """A canvas from text rows, one key per pixel ('.' is transparent)."""
    c = Canvas(len(rows[0]), len(rows))
    for y, row in enumerate(rows):
        assert len(row) == c.w, (rows, row)
        for x, k in enumerate(row):
            if k != ".":
                c.px[y][x] = keys[k]
    return c


def recolor(c, swap):
    out = c.copy()
    out.px = [[swap.get(k, k) for k in row] for row in c.px]
    return out


# A ramp whose darkest step is still bright gets a darker outline on its lit side.
LIT_OUTLINE = {"gold": "fire2", "sky": "steel1", "rose": "rose1"}


def selout(c, light=(1, -1)):
    """A selective outline: a one-pixel line on the four sides (round corners), dark ink
    on the side away from the light and the material's own darkest step on the lit
    side, so a sprite keeps a hard edge without a black cut-out look (Metal Slug's way)."""
    out = c.copy()
    lx, ly = light
    for y in range(c.h):
        for x in range(c.w):
            if c.px[y][x] is not None:
                continue
            best = None
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                n = c.get(x + dx, y + dy)
                if n is None:
                    continue
                # This empty pixel lies on the side (-dx, -dy) of the shape; that side is lit
                # when it faces the light.
                lit = (-dx * lx + -dy * ly) > 0
                col = "ink"
                if lit:
                    base, _ = ramp_of(n)
                    col = "ink" if base == "ink" else LIT_OUTLINE.get(base, f"{base}0")
                # Ink wins over a colored outline where they meet, so the shadow side stays solid.
                if best is None or col == "ink":
                    best = col
            if best is not None:
                out.px[y][x] = best
    return out


def save(c, rel, scale=4, bg="sky2", art=True):
    """Writes the 1x art and an enlarged preview; previews of sprites sit on a mid sky tone."""
    img = c.image() if isinstance(c, Canvas) else c
    if art:
        path = os.path.join(ART, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        img.save(path, optimize=True)
    if scale:
        prev = os.path.join(PREVIEWS, rel.replace(".png", f"@{scale}x.png"))
        os.makedirs(os.path.dirname(prev), exist_ok=True)
        shown = Image.new("RGBA", img.size, rgb(bg) + (255,))
        shown.alpha_composite(img.convert("RGBA"))
        shown.resize((img.width * scale, img.height * scale), Image.NEAREST).save(prev, optimize=True)
    return img


def save_gif(frames, durations, path, scale):
    """Writes an animated GIF, merging equal frames in a row into one longer frame."""
    merged, times = [], []
    for img, ms in zip(frames, durations):
        if merged and img.tobytes() == merged[-1].tobytes():
            times[-1] += ms
        else:
            merged.append(img)
            times.append(ms)
    big = [m.convert("RGB").resize((m.width * scale, m.height * scale), Image.NEAREST) for m in merged]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    big[0].save(path, save_all=True, append_images=big[1:], duration=times, loop=0, optimize=True, disposal=1)


# --- The game's grid ---------------------------------------------------------

W, H = 384, 216  # the screen in art pixels
TILE = 16
FRAME = 48  # the player's frame
LIGHT = (1, -1)  # the sun: high, ahead of the player (upper right)


# --- The player --------------------------------------------------------------
# A scavenger in a blue jacket, khaki cargo trousers, boots, and a backpack
# whose cell glows gold while a dash is ready, with a red ponytail that trails
# every move. She is a puppet: limbs are tapered capsules between joints, posed
# by angles (so lengths never change from frame to frame), shaded in bands
# along each limb from the one light, and joined with a contour where a part
# crosses another. The head is drawn by hand. Each frame gets one selective
# outline at the end, so every frame has the same edge.

THIGH, SHIN, FOOT = 7.5, 7.0, 4.0
UPPER, FORE = 6.0, 5.5
SPINE = 11.0
TAIL = [3.0, 3.0, 2.8, 2.6]
GROUND = 46  # the soles' last row; the outline takes row 47

HEAD_KEYS = {
    "1": "fire1", "2": "fire2", "3": "fire3", "4": "fire4",
    "s": "rose5", "m": "rose4", "d": "rose3", "r": "rose3", "n": "rose1",
    "e": "ink", "w": "steel6", "k": "steel1", "f": "steel3", "g": "blue2", "G": "blue3",
}
# Facing right, lit from the upper right. The goggles ride on the hair.
HEAD = [
    "....11122.....",
    "..11223333....",
    ".1122ffff33...",
    ".122fgGGf43...",
    "1122ffff4443..",
    "112223333443..",
    "1122233sss34..",
    "112223ssssss3.",
    "11222dsss11ss.",
    "1122dmssssess.",
    ".112dmmsssesss",
    "..12ddmsssssm.",
    "...1rdmmssnm..",
    "....rddmmmm...",
    ".....rrdd.....",
]
HEAD_NECK = (7, 14)  # the head pixel that sits on the neck
HEAD_TAIL = (2, 3)  # where the ponytail leaves the head


def head_variant(kind):
    rows = list(HEAD)
    if kind == "blink":
        rows[9] = "1122dmssssmss."
        rows[10] = ".112dmmsssnsss"
    if kind == "grit":  # dash and landing: the brow down, the mouth set
        rows[8] = "11222dss111ss."
        rows[12] = "...1rdmmsnnm.."
    return rows


def vec(deg, length):
    """A limb from its angle: 0 points straight down, positive swings forward (to +x)."""
    a = math.radians(deg)
    return (math.sin(a) * length, math.cos(a) * length)


def add(p, q):
    return (p[0] + q[0], p[1] + q[1])


class Body:
    """Parts painted back to front. Each part is a set of pixels with colors; a part's
    edge pixels that cover an earlier part become its contour (its darkest step)."""

    def __init__(self):
        self.c = Canvas(FRAME, FRAME)
        self.owner = [[None] * FRAME for _ in range(FRAME)]
        self.n = 0

    def paint(self, pixels, contour=True):
        self.n += 1
        keys = set(pixels)
        for (x, y), col in pixels.items():
            if not (0 <= x < FRAME and 0 <= y < FRAME):
                continue
            edge = False
            if contour:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    if (x + dx, y + dy) not in keys and self.c.get(x + dx, y + dy) is not None:
                        edge = True
            if edge:
                base, _ = ramp_of(col)
                col = "ink" if base in ("ink",) else f"{base}0" if base not in ("rose",) else "rose1"
            self.c.px[y][x] = col
            self.owner[y][x] = self.n


def capsule(a, b, ra, rb, color_at, light=LIGHT):
    """A tapered limb from a to b. color_at(t, side) gives the color, where t runs 0..1 along
    the limb and side runs -1 (away from the light) to 1 (toward it)."""
    out = {}
    dx, dy = b[0] - a[0], b[1] - a[1]
    ln2 = dx * dx + dy * dy or 1e-9
    ln = math.sqrt(ln2)
    # The perpendicular that faces the light.
    nx, ny = -dy / ln, dx / ln
    if nx * light[0] + ny * light[1] < 0:
        nx, ny = -nx, -ny
    r = max(ra, rb)
    for y in range(int(min(a[1], b[1]) - r - 2), int(max(a[1], b[1]) + r + 3)):
        for x in range(int(min(a[0], b[0]) - r - 2), int(max(a[0], b[0]) + r + 3)):
            px, py = x + 0.5, y + 0.5
            t = max(0.0, min(1.0, ((px - a[0]) * dx + (py - a[1]) * dy) / ln2))
            qx, qy = a[0] + dx * t, a[1] + dy * t
            rr = ra + (rb - ra) * t
            d = math.hypot(px - qx, py - qy)
            if d <= rr:
                side = ((px - qx) * nx + (py - qy) * ny) / rr
                out[(x, y)] = color_at(t, side)
    return out


def banded(base, lit=0.35, dark=-0.45):
    """Three bands along a limb: the light step toward the sun, the shade away from it."""
    def f(t, side):
        if side > lit:
            return shade(base, 1)
        if side < dark:
            return shade(base, -1)
        return base
    return f


def pose_points(p):
    """Joint positions for a pose."""
    hip = p["hip"]
    lean = p.get("lean", 0)
    neck = add(hip, vec(180 - lean, SPINE))  # straight up, tipped forward by the lean
    pts = {"hip": hip, "neck": neck}
    for side, off in (("far", -1.0), ("near", 1.0)):
        th, sh, ft = p["legs"][side]
        h = add(hip, (off * 0.5, 0))
        k = add(h, vec(th, THIGH))
        an = add(k, vec(sh, SHIN))
        toe = add(an, vec(ft, FOOT))
        pts[side + "-leg"] = (h, k, an, toe)
        up, fo = p["arms"][side]
        sh_pt = add(add(hip, vec(180 - lean, SPINE - 2.0)), (off * 0.8 - 0.5, 0))
        el = add(sh_pt, vec(up, UPPER))
        hand = add(el, vec(fo, FORE))
        pts[side + "-arm"] = (sh_pt, el, hand)
    return pts


def leg_part(h, k, an, toe, far):
    dim = -1 if far else 0
    trousers = shade("stone3", dim)
    boot = shade("earth2", dim)
    thigh = capsule(h, k, 3.2, 2.6, banded(trousers))
    shin = capsule(k, an, 2.6, 2.3, lambda t, s: banded(boot if t > 0.6 else trousers)(t, s))
    # The boot: a rounded toe and a heel, with a dark sole on the side toward the ground.
    foot = capsule(add(an, vec(0, 0.6)), toe, 2.5, 2.1, lambda t, s: shade(boot, 1) if s > 0.5 else boot)
    sole_dir = vec(0, 1)
    for (x, y) in list(foot):
        below = (x, y + 1)
        if below not in foot and below not in shin:
            foot[(x, y)] = "earth0"
    out = {}
    out.update(thigh)
    out.update(shin)
    out.update(foot)
    # A knee pad: the lit side of the knee, a cluster, not a line.
    return out


def arm_part(sh, el, hand, far):
    dim = -1 if far else 0
    # The near sleeve is a step lighter than the jacket, so the arm reads over the body.
    sleeve = "blue0" if far else "blue2"
    skin = shade("rose4", dim)
    glove = shade("earth2", dim)
    upper = capsule(sh, el, 2.4, 2.1, banded(sleeve))
    # The sleeve is rolled to the elbow: a cuff, then the forearm.
    fore = capsule(el, hand, 1.9, 1.7, lambda t, s: banded(sleeve, 0.2)(t, s) if t < 0.25 else banded(skin)(t, s))
    fist = capsule(hand, add(hand, (0.01, 0.01)), 2.1, 2.1, banded(glove, 0.2, -0.3))
    out = {}
    out.update(upper)
    out.update(fore)
    out.update(fist)
    return out


def torso_part(p, pts):
    """The jacket over a belt and the top of the trousers, drawn in the torso's own frame:
    u runs up the spine (0 hip, 1 neck), v across it (positive in front)."""
    hip, neck = pts["hip"], pts["neck"]
    sx, sy = neck[0] - hip[0], neck[1] - hip[1]
    ln = math.hypot(sx, sy)
    ux, uy = sx / ln, sy / ln
    fx_, fy_ = -uy, ux  # front: the spine turned a quarter toward +x
    if fx_ < 0:
        fx_, fy_ = -fx_, -fy_
    breath = p.get("breath", 0)

    def half(u, front):
        # The profile of the body: hips, waist, chest, shoulders.
        pts_ = [(-0.12, 3.4), (0.0, 4.8), (0.3, 4.5), (0.62, 5.4 + breath * 0.6), (0.92, 5.0), (1.06, 3.0)] if front else \
               [(-0.12, 3.4), (0.0, 4.8), (0.3, 4.0), (0.7, 4.6), (0.95, 4.2), (1.06, 2.4)]
        for (u0, w0), (u1, w1) in zip(pts_, pts_[1:]):
            if u0 <= u <= u1:
                return w0 + (w1 - w0) * (u - u0) / (u1 - u0)
        return None

    out = {}
    for y in range(FRAME):
        for x in range(FRAME):
            px, py = x + 0.5 - hip[0], y + 0.5 - hip[1]
            u = (px * ux + py * uy) / ln
            v = px * fx_ + py * fy_
            w = half(u, v >= 0)
            if w is None or abs(v) > w:
                continue
            s = v / w  # -1 back .. 1 front
            # Light from the upper right lights the front and the shoulders.
            if u < 0.13:
                col = "stone3"  # the trousers' seat, under the belt
                if s < -0.3:
                    col = "stone2"
            elif u < 0.24:
                col = "earth1" if s < -0.2 else "earth2"  # the belt
                if s > 0.55 and u > 0.15:
                    col = "gold0"  # the buckle
            else:
                col = "blue1"
                if s > 0.35 or (u > 0.82 and s > -0.2):
                    col = "blue2"
                if s > 0.8 and 0.5 < u < 0.85:
                    col = "blue3"
                if s < -0.55:
                    col = "blue0"
                # The hem's shadow under the jacket's flap.
                if u < 0.32 and s < 0.4:
                    col = "blue0"
                # The collar and a pale shirt at the throat.
                if u > 0.88 and s > 0.2:
                    col = "stone4"
                # The backpack strap over the shoulder.
                if -0.45 <= s <= -0.1 and 0.5 < u < 0.97:
                    col = "earth2" if u > 0.85 else "earth1"
            out[(x, y)] = col
    return out


def pack_part(p, pts, charged):
    """The backpack against the shoulders, with the dash cell on top."""
    hip, neck = pts["hip"], pts["neck"]
    lean = p.get("lean", 0)
    up = vec(180 - lean, 1)
    back = (-up[1], up[0]) if -up[1] < 0 else (up[1], -up[0])  # the side away from the front
    centre = add(add(hip, (up[0] * 7.2, up[1] * 7.2)), (back[0] * 4.6, back[1] * 4.6))
    out = {}
    for y in range(FRAME):
        for x in range(FRAME):
            dx, dy = x + 0.5 - centre[0], y + 0.5 - centre[1]
            a = dx * up[0] + dy * up[1]  # along the spine
            b = dx * back[0] + dy * back[1]  # away from the body
            if abs(a) <= 4.6 and abs(b) <= 3.0 and not (abs(a) > 3.8 and abs(b) > 2.2):
                col = "steel2"
                if a > 2.6 or b < -1.0:
                    col = "steel3"
                if b > 1.6 and a < 2.6:
                    col = "steel1"
                if -0.2 < a < 0.8:
                    col = "steel1"  # the flap's seam
                out[(x, y)] = col
            # The cell: a glowing canister strapped to the back of the pack.
            if 3.0 < b <= 5.4 and -3.0 <= a <= 2.6 and not (b > 4.6 and abs(a) > 2.2):
                lit = a > 0.8 and b < 4.6
                if charged:
                    out[(x, y)] = "gold2" if lit else "gold1" if a > -1.6 else "gold0"
                else:
                    out[(x, y)] = "steel4" if lit else "steel3" if a > -1.6 else "steel2"
    return out


def tail_part(start, angles):
    out = {}
    p = start
    r = 2.2
    n = len(TAIL)
    for i, (a, ln) in enumerate(zip(angles, TAIL)):
        q = add(p, vec(a, ln))
        r1 = 2.2 - 1.3 * (i + 1) / n
        seg = capsule(p, q, r, r1, banded("fire2", 0.25, -0.35))
        for k, v in seg.items():
            out.setdefault(k, v)
        p, r = q, r1
    return out


def head_part(at, kind):
    rows = head_variant(kind)
    hx = round(at[0]) - HEAD_NECK[0]
    hy = round(at[1]) - HEAD_NECK[1]
    out = {}
    for j, row in enumerate(rows):
        for i, k in enumerate(row):
            if k != ".":
                out[(hx + i, hy + j)] = HEAD_KEYS[k]
    return out, (hx + HEAD_TAIL[0] + 0.5, hy + HEAD_TAIL[1] + 0.5)


def draw_pose(p, charged=True, raw=False):
    pts = pose_points(p)
    b = Body()
    neck = pts["neck"]
    hd = p.get("head", (0, 0, "normal"))
    head_at = add(neck, (hd[0] + 0.6, hd[1] + 1.5))
    head, tail_root = head_part(head_at, hd[2])
    tail = tail_part(tail_root, p.get("tail", [-30, -25, -20, -15, -10]))
    b.paint(tail, contour=False)
    b.paint(arm_part(*pts["far-arm"], far=True))
    b.paint(leg_part(*pts["far-leg"], far=True))
    b.paint(pack_part(p, pts, charged))
    b.paint(leg_part(*pts["near-leg"], far=False))
    b.paint(torso_part(p, pts))
    neck_px = capsule(neck, add(neck, (hd[0] * 0.5, -2.5)), 2.0, 2.0, banded("rose3"))
    b.paint(neck_px)
    b.paint(head)
    b.paint(arm_part(*pts["near-arm"], far=False))
    c = b.c
    if raw:
        return c
    for y in range(FRAME):
        for x in range(FRAME):
            if c.px[y][x] is not None:
                assert 0 < x < FRAME - 1 and 0 < y < FRAME - 1, ("fill touches the frame edge", x, y, p)
    return selout(c)


def fitted(p):
    """Moves an airborne pose up or down the fewest pixels that keep it inside the frame."""
    steps = sorted(((dx, dy) for dx in range(-6, 7) for dy in range(-6, 7)), key=lambda d: (abs(d[0]) + abs(d[1]), d))
    for dx, dy in steps:
        q = dict(p)
        q["hip"] = (p["hip"][0] + dx, p["hip"][1] + dy)
        try:
            draw_pose(q)
            return q
        except AssertionError:
            continue
    raise AssertionError(("no room for the pose", p))


def fill_box(p):
    """The pose's drawn pixels before the outline: (left, right, top, bottom)."""
    c = draw_pose(p, raw=True)
    pts = [(x, y) for y in range(FRAME) for x in range(FRAME) if c.px[y][x] is not None]
    return min(x for x, _ in pts), max(x for x, _ in pts), min(y for _, y in pts), max(y for _, y in pts)


def grounded(p):
    """Moves a standing pose's hips so its lowest sole sits exactly on the ground row."""
    q = dict(p)
    q["hip"] = (p["hip"][0], 0.0)
    pts = pose_points(q)
    low = max(max(pts[s + "-leg"][2][1] + 0.6 + 2.5, pts[s + "-leg"][3][1] + 2.1) for s in ("far", "near"))
    q["hip"] = (p["hip"][0], round(GROUND + 0.5 - low) + 0.0)
    for _ in range(3):
        bottom = fill_box(q)[3]
        if bottom == GROUND:
            break
        q["hip"] = (q["hip"][0], q["hip"][1] + GROUND - bottom)
    return q


WALL = 29  # the wall-slide frames press a wall whose first column is here, right of the hitbox


def against_wall(p):
    """Moves a wall pose sideways so its hands and boot touch the wall at WALL."""
    q = dict(p)
    right = fill_box(q)[1]
    q["hip"] = (q["hip"][0] + WALL - 1 - right, q["hip"][1])
    return q


def idle_poses():
    """Breathing: the chest swells and the shoulders rise a pixel, the arms follow,
    and the ponytail sways a beat behind. One blink."""
    frames = []
    for i in range(6):
        ph = math.sin(2 * math.pi * i / 6)
        lag = math.sin(2 * math.pi * (i - 1) / 6)
        p = grounded({
            "hip": (21.5, 0), "lean": 2 + ph * 0.6, "breath": 0.5 + ph * 0.5,
            "legs": {"far": (-4, -12, 86), "near": (12, 2, 94)},
            "arms": {"far": (-6 + ph, 6), "near": (10 + ph * 1.5, 22 + ph * 2)},
            "head": (0, round(-ph * 0.6), "blink" if i == 4 else "normal"),
            "tail": [-60 + lag * 4, -30 + lag * 6, -12 + lag * 8, -4 + lag * 10],
        })
        frames.append(p)
    return frames


# Eight frames of a run: contact, down, pass, up, then the same on the other leg.
# Thigh and shin angles of one leg over the cycle; the other leg is four frames on.
RUN_LEG = [(38, 14, 108), (20, -4, 92), (2, -12, 90), (-24, -40, 50), (-36, -78, 20), (-12, -100, -10), (30, -48, 30), (50, 10, 100)]
RUN_BOB = [0.5, 2.0, 1.0, -1.0, 0.5, 2.0, 1.0, -1.0]
RUN_AIR = [0, 0, 0, 1.0, 0, 0, 0, 1.0]


def run_poses():
    frames = []
    for i in range(8):
        ph = 2 * math.pi * i / 8
        swing = math.cos(ph)  # near leg forward at 1
        near, far = RUN_LEG[i], RUN_LEG[(i + 4) % 8]
        lag = math.cos(ph - 1.2)
        p = {
            "hip": (22, 30.5 + RUN_BOB[i]), "lean": 14,
            "legs": {"far": far, "near": near},
            # Arms swing against the legs, bent at the elbow.
            "arms": {"far": (38 * swing, 38 * swing + 85), "near": (-44 * swing, -44 * swing + 90)},
            "head": (1, 0, "normal"),
            "tail": [-80 + lag * 6, -88 + lag * 12, -94 + lag * 16, -98 + lag * 22],
            "breath": 0.6,
        }
        p = grounded(p)
        # The up frames leave the ground: both feet off it for a moment.
        p["hip"] = (p["hip"][0], p["hip"][1] - RUN_AIR[i])
        frames.append(p)
    return frames


def air_poses():
    """Jump: the push off (one knee driven up, the reaching arm high, the ponytail
    dragged down), the rise, and the top, where both legs tuck. Fall: the legs reach
    for the ground, the arms go up and out, the ponytail streams up; two frames flutter."""
    jump = [
        {"hip": (22, 30), "lean": 4, "breath": 1,
         "legs": {"far": (-14, -18, 30), "near": (62, -8, 70)},
         "arms": {"far": (150, 165), "near": (-40, -10)},
         "head": (1, -1, "normal"), "tail": [-30, -12, 0, 6]},
        {"hip": (22, 29), "lean": 6, "breath": 1,
         "legs": {"far": (-4, -30, 40), "near": (70, 0, 80)},
         "arms": {"far": (130, 115), "near": (-60, -30)},
         "head": (1, -1, "normal"), "tail": [-45, -25, -10, -2]},
        {"hip": (22, 28), "lean": 8, "breath": 0.6,
         "legs": {"far": (28, -40, 50), "near": (74, 10, 90)},
         "arms": {"far": (-100, -70), "near": (100, 80)},
         "head": (1, 0, "normal"), "tail": [-80, -70, -60, -55]},
    ]
    fall = []
    for k in range(2):
        f = k * 2 - 1
        fall.append({"hip": (22, 29), "lean": -4, "breath": 0.8,
                     "legs": {"far": (-6, -28, 40), "near": (36, 6, 70)},
                     "arms": {"far": (-112 + f * 6, -132 + f * 10), "near": (108 - f * 6, 128 + f * 8)},
                     "head": (0, 0, "normal"),
                     "tail": [-118 + f * 4, -126 - f * 6, -120 + f * 10, -112 - f * 12]})
    return [fitted(p) for p in jump], [fitted(p) for p in fall]


def dash_poses():
    """A lunge: the body tips nearly flat behind a thrown fist, legs and ponytail straight back."""
    return [fitted(p) for p in [
        {"hip": (18, 30), "lean": 30, "breath": 1,
         "legs": {"far": (-30, -60, 20), "near": (40, -20, 90)},
         "arms": {"far": (-70, -40), "near": (70, 100)},
         "head": (1, 0, "grit"), "tail": [-110, -100, -95, -90]},
        {"hip": (16, 28), "lean": 58, "breath": 1,
         "legs": {"far": (-80, -96, -30), "near": (-58, -96, -20)},
         "arms": {"far": (-96, -80), "near": (92, 92)},
         "head": (2, 1, "grit"), "tail": [-100, -96, -92, -90]},
        {"hip": (16, 28), "lean": 58, "breath": 1,
         "legs": {"far": (-84, -100, -30), "near": (-62, -92, -25)},
         "arms": {"far": (-100, -84), "near": (92, 92)},
         "head": (2, 1, "grit"), "tail": [-96, -100, -88, -96]},
    ]]


def slide_poses():
    """Sliding down a wall on the right: both hands drag on it, a boot braces against it,
    and the ponytail lifts with the slide."""
    out = []
    for k in range(2):
        out.append({"hip": (22, 28), "lean": 4, "breath": 0.5,
                    "legs": {"far": (-4, -18, 40), "near": (38, -6, 70)},
                    "arms": {"far": (150, 158), "near": (70 + k * 4, 128 + k * 4)},
                    "head": (0, 0, "normal"),
                    "tail": [-124 + k * 6, -128 - k * 6, -118 + k * 8, -110 - k * 8]})
    return [against_wall(fitted(p)) for p in out]


def land_poses():
    """The squash: knees deep, the body folded over them, arms down for balance; then up."""
    return [
        grounded({"hip": (22, 0), "lean": 24, "breath": 0,
                  "legs": {"far": (-10, -76, 90), "near": (70, -14, 92)},
                  "arms": {"far": (-30, 20), "near": (40, 70)},
                  "head": (1, 1, "grit"), "tail": [10, 25, 35, 40]}),
        grounded({"hip": (22, 0), "lean": 12, "breath": 0.3,
                  "legs": {"far": (-8, -40, 90), "near": (42, -2, 92)},
                  "arms": {"far": (-14, 10), "near": (24, 46)},
                  "head": (1, 0, "normal"), "tail": [-20, -5, 10, 20]}),
    ]


def player_animations(charged=True):
    """Every animation as (frames, ms per frame, loops)."""
    jump, fall = air_poses()
    anims = {
        "idle": (idle_poses(), 160, True),
        "run": (run_poses(), 70, True),
        "jump": (jump, 80, False),
        "fall": (fall, 110, True),
        "dash": (dash_poses(), 50, False),
        "wall-slide": (slide_poses(), 120, True),
        "land": (land_poses(), 70, False),
    }
    return {k: ([draw_pose(p, charged) for p in ps], ms, loop) for k, (ps, ms, loop) in anims.items()}


def player_sheet(anims):
    """Every animation on a row of its own; JSON in the hash format Pixi, Phaser, and Aseprite read."""
    cols = max(len(f) for f, _, _ in anims.values())
    c = Canvas(cols * FRAME, len(anims) * FRAME)
    frames, tags, timing = {}, [], {}
    n = 0
    for row, (name, (fs, ms, loop)) in enumerate(anims.items()):
        names = []
        for i, f in enumerate(fs):
            c.blit(f, i * FRAME, row * FRAME)
            key = f"{name} {i}"
            frames[key] = {"frame": {"x": i * FRAME, "y": row * FRAME, "w": FRAME, "h": FRAME}, "duration": ms,
                           "anchor": {"x": 0.5, "y": 1}}
            names.append(key)
        tags.append({"name": name, "from": n, "to": n + len(fs) - 1, "direction": "forward"})
        timing[name] = {"frames": names, "msPerFrame": ms, "loop": loop}
        n += len(fs)
    data = {"frames": frames, "animations": {k: v["frames"] for k, v in timing.items()}, "timing": timing,
            "meta": {"image": "player.png", "size": {"w": c.w, "h": c.h}, "frameSize": {"w": FRAME, "h": FRAME}, "scale": "1",
                     "about": "Soles on row 46, outline on row 47; the anchor is the middle of the bottom row. "
                              "Hitbox 12x34 from x 17..28, y 13..46. Faces right; flip for left. "
                              "The wall-slide frames press a wall whose first column is x 29, just right of the hitbox. player-spent.png is the same sheet with the dash spent.",
                     "frameTags": tags}}
    return c, data


# --- Tiles -------------------------------------------------------------------
# Terrain is one 16x16 autotile drawn per pixel from its eight neighbours: cut
# stone blocks (the ruins) under a mat of grass and moss where open air is
# above, a lit rim on the right (the sun's side), a shaded rim on the left and
# below, a selective outline on every open side, and outer corners rounded by
# two pixels. Deep inside, the blocks sink into shadow, so the edges the
# player touches carry the contrast.

N, NE, E, SE, S, SW, Wb, NW = 1, 2, 4, 8, 16, 32, 64, 128
DIRS = {N: (0, -1), NE: (1, -1), E: (1, 0), SE: (1, 1), S: (0, 1), SW: (-1, 1), Wb: (-1, 0), NW: (-1, -1)}


def canonical(mask):
    """Corners only count when both sides beside them are solid (the 47-tile blob set)."""
    for corner, a, b in ((NE, N, E), (SE, S, E), (SW, S, Wb), (NW, N, Wb)):
        if not (mask & a and mask & b):
            mask &= ~corner
    return mask


BLOB = sorted({canonical(m) for m in range(256)})

# How far the grass mat hangs down each column (it loops across the tile).
GRASS = [4, 5, 5, 4, 3, 4, 6, 7, 6, 4, 4, 5, 4, 3, 4, 5]
# Blade tips: columns where the top row of grass is open, so the mat's top is ragged.
BLADE_GAP = {2, 6, 11, 14}


JOINTS = {0: (0, 10), 1: (5, 13)}  # where blocks meet in each course of a tile: blocks of 10, 6, 8, and 8


def block_texture(x, y, variant):
    """The stone under the rims, in tile coordinates, as (step, mortar). Two courses of
    blocks 8 high with their joints staggered and uneven, each block bevelled toward the
    sun (lit top and right, shaded bottom and left). The pattern loops on all four sides."""
    course = y // 8
    by = y % 8
    js = JOINTS[course]
    start = max((j for j in js if j <= x), default=js[-1] - 16)
    nxt = min((j for j in js if j > x), default=js[0] + 16)
    bx, w = x - start, nxt - start
    if by == 0 or bx == 0:
        return 0, True
    step = 3
    if by == 1 or bx == w - 1:
        step = 4
    if by == 7 or bx == 1:
        step = 2
    # Worn pits: a small cluster in the wider blocks.
    if w >= 8 and (bx, by) in ((3, 4), (4, 4), (4, 5)):
        step = 2
    if w >= 8 and (bx, by) == (3, 3):
        step = 4 if course else 3
    if variant == 1:  # a crack down the first block
        if course == 0 and (bx, by) in ((5, 1), (5, 2), (6, 3), (6, 4), (7, 5), (7, 6)):
            return 0, True
        if course == 0 and (bx, by) in ((6, 2), (7, 4), (8, 5)):
            step = 4
    if variant == 2:  # a chipped corner: a dark hole where a piece fell out
        if course == 1 and bx >= w - 5 and by <= 4 and (w - 1 - bx) + by <= 4:
            return (1 if (w - 1 - bx) + by >= 1 else 0), True
    if variant == 3:  # moss in a joint
        if course == 1 and by <= 2 and 1 <= bx <= 6 and not (by == 2 and bx in (1, 6)):
            return -1, False
    return step, False


# Buried stones in the earth behind the facing, per fill variant; each loops on its tile.
EARTH_STONES = [
    ["................", "................", "..........eee...", "................",
     "................", "....cdd.........", "...bccdd........", "...abbcc........",
     "....aab.........", "................", "...........ee...", "eee.............",
     "............cd..", "...........bccd.", "...........abb..", "................"],
    ["................", "..cdd...........", ".bccdd..........", ".abbcc..........",
     "..aab...........", "...........eeee.", "................", "................",
     "........cdd.....", ".......bccdd....", ".......abbccd...", "........aabb....",
     "................", "..eee...........", "................", "................"],
    ["................", "...........cd...", "..........bccd..", "..........abb...",
     "................", "..eeee..........", "................", "................",
     "................", "...........eee..", "..cdd...........", ".bccdd..........",
     ".abbcc..........", "..aab...........", "................", "................"],
    ["................", "................", "................", ".....eeee.......",
     "................", "................", "............cd..", "...........bccd.",
     "...........abb..", "................", "................", "................",
     "....cdd.........", "...bccdd........", "...abbcc........", "....aab........."],
]


def terrain_tile(mask, variant=0):
    solid = [[False] * 48 for _ in range(48)]
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            bit = next((b for b, d in DIRS.items() if d == (dx, dy)), None)
            if (dx, dy) == (0, 0) or (bit is not None and mask & bit):
                for y in range(16 + dy * 16, 32 + dy * 16):
                    for x in range(16 + dx * 16, 32 + dx * 16):
                        solid[y][x] = True

    def empty(x, y):
        return not (0 <= x < 48 and 0 <= y < 48) or not solid[y][x]

    def run(x, y, dx, dy):
        k = 1
        while k < 12 and not empty(x + dx * k, y + dy * k):
            k += 1
        return k  # 1: the next pixel that way is open

    def depth(x, y):
        for d in range(1, 20):
            for j in range(-d, d + 1):
                for i in range(-d, d + 1):
                    if max(abs(i), abs(j)) == d and empty(x + i, y + j):
                        return d
        return 20

    c = Canvas(16, 16)
    for ty in range(16):
        for tx in range(16):
            x, y = tx + 16, ty + 16
            up, down, left, right = run(x, y, 0, -1), run(x, y, 0, 1), run(x, y, -1, 0), run(x, y, 1, 0)
            # Round the outer corners by two pixels.
            vert = min(up, down)
            horiz = min(left, right)
            if (vert == 1 and horiz <= 2) or (vert == 2 and horiz == 1):
                continue
            d = depth(x, y)
            step, mortar = block_texture(tx, ty, variant)
            if d > 12:
                # Behind the facing: packed dark earth with a few buried stones, quiet.
                col = "earth1"
                stone = EARTH_STONES[variant][ty][tx]
                if stone != ".":
                    col = {"a": "earth0", "b": "stone0", "c": "stone1", "d": "stone2", "e": "earth2"}[stone]
            elif step == -1:
                col = "leaf1" if (tx + ty) % 3 else "leaf0"
            else:
                # The facing of cut blocks, darker as it goes in.
                if d > 9:
                    step -= 2
                elif d > 5:
                    step -= 1
                col = "stone0" if mortar else f"stone{max(0, min(5, step))}"
                if mortar and d > 9:
                    col = "earth1"
            # Rims: lit toward the sun (right), shaded away from it (left) and below.
            if right == 2 and up > 2:
                col = "stone5"
            elif right == 3 and up > 3 and not mortar:
                col = "stone4"
            if left == 2 or down == 2:
                col = "stone1"
            if down == 3 and not mortar:
                col = "stone2" if col not in ("stone0", "earth1") else col
            # The grass mat on every top that has open air above.
            g = GRASS[tx]
            if up <= g:
                if up == 1 and tx in BLADE_GAP:
                    continue
                col = {1: "leaf4", 2: "leaf3", 3: "leaf2"}.get(up, "leaf1")
                if up == 1 and tx % 5 == 0:
                    col = "leaf3"
                if up == g:
                    col = "leaf0"  # the mat's shadow on the stone
                if right <= 2:
                    col = "leaf3" if up < g else col
            # The outline on open sides: ink away from the sun, the material's darkest toward it.
            if left == 1 or down == 1:
                col = "ink"
            elif up == 1 or right == 1:
                col = "leaf0" if up <= g else "stone0"
                if up == 1:
                    col = "leaf0"
            elif d == 1:
                col = "ink"
            c.px[ty][tx] = col
    return c


def platform_tiles():
    """A one-way catwalk: a steel girder with a lit deck, a truss web with rivets, and a
    post that holds it up. Thin and open below, so it never reads as a solid block."""
    def girder(kind):
        c = Canvas(16, 16)
        for x in range(16):
            c.set(x, 0, "steel0")       # outline on top (lit side: the steel's darkest)
            c.set(x, 1, "steel6" if x % 4 else "steel5")  # the deck's lit edge, plate joints
            c.set(x, 2, "steel4")
            c.set(x, 3, "steel3")
            c.set(x, 4, "steel1")       # the deck's underside
            c.set(x, 5, "ink")
            c.set(x, 10, "steel0")      # the bottom chord
            c.set(x, 11, "steel2")
            c.set(x, 12, "ink")
        # The truss web between the chords: diagonals that meet every 8 pixels.
        for k in range(4):
            for x in range(16):
                if (x + k) % 8 == 0 or (x - k) % 8 == 0:
                    c.set(x, 6 + k, "steel2" if (x - k) % 8 == 0 else "steel1")
        for x in (3, 11):
            c.set(x, 3, "steel5")  # rivet heads catch the sun
        if kind == "left":
            for y in range(0, 13):
                for x in range(0, 2):
                    c.set(x, y, None)
            for y in range(1, 12):
                c.set(1, y, "ink")
            c.set(2, 1, "steel5")
        if kind == "right":
            for y in range(0, 13):
                for x in range(14, 16):
                    c.set(x, y, None)
            for y in range(1, 12):
                c.set(14, y, "steel0")
            c.set(13, 2, "steel6")
        return c

    post = Canvas(16, 16)
    for y in range(16):
        post.set(5, y, "ink")
        post.set(6, y, "steel1")
        post.set(7, y, "steel2")
        post.set(8, y, "steel3")
        post.set(9, y, "steel4")
        post.set(10, y, "steel0")
        if y % 8 == 3:
            post.set(8, y, "steel5")
        if y % 8 == 4:
            post.set(7, y, "steel1")
    return {"platform-left": girder("left"), "platform-mid": girder("mid"), "platform-right": girder("right"), "platform-post": post}


def spike_tiles():
    """Spikes: two steel blades, the brightest thing in the room, lit on the sun's side,
    on a rusted base plate. One drawing turned four ways."""
    up = Canvas(16, 16)
    tone = {-3: "steel2", -2: "steel3", -1: "steel3", 0: "steel6", 1: "steel5", 2: "steel5", 3: "steel4"}
    for y in range(0, 13):
        half = -1 if y < 1 else 0 if y < 3 else 1 if y < 6 else 2 if y < 9 else 3
        for x in range(16):
            c = min((4, 12), key=lambda cc: abs(x - cc))
            dx = x - c
            if abs(dx) <= half:
                up.set(x, y, tone[dx])
            elif abs(dx) == half + 1 or (dx == 0 and y == 0):
                # The outline: ink on the shaded left, the steel's darkest on the lit right.
                if up.get(x, y) is None:
                    up.set(x, y, "ink" if dx < 0 else "steel0")
    # The base plate in warning paint: the hazard's own stripes, gold and ink.
    for x in range(16):
        up.set(x, 13, "gold1" if (x // 2) % 2 == 0 else "ink")
        up.set(x, 14, "gold0" if ((x + 1) // 2) % 2 == 0 else "ink")
        up.set(x, 15, "ink")

    def rot(c):  # 90 degrees clockwise
        r = Canvas(c.h, c.w)
        for y in range(c.h):
            for x in range(c.w):
                r.px[x][c.h - 1 - y] = c.px[y][x]
        return r

    right = rot(up)
    down = rot(right)
    left = rot(down)
    return {"spikes-up": up, "spikes-right": right, "spikes-down": down, "spikes-left": left}


def selout_tile(c):
    """An outline that stays inside the tile: the shape's own edge pixels in the dark."""
    out = c.copy()
    for y in range(c.h):
        for x in range(c.w):
            if c.px[y][x] is None:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, -1)):
                n = c.get(x + dx, y + dy)
                if n is None and 0 <= x + dx < c.w and 0 <= y + dy < c.h:
                    out.px[y][x] = "ink" if dx < 0 else "steel1"
    return out


def deco_tiles():
    """Decoration on its own layer over the terrain: never collides, never looks like it does."""
    keys = {"a": "leaf0", "b": "leaf1", "c": "leaf2", "d": "leaf3", "e": "leaf4", "i": "ink",
            "s": "stone1", "t": "stone2", "u": "stone3", "v": "stone4", "w": "stone5", "o": "stone0",
            "f": "fire4", "g": "gold1", "y": "sky3", "r": "fire2", "h": "earth2", "k": "steel1", "m": "steel3", "n": "steel4", "j": "steel0", "p": "fire1"}
    fern = from_rows([
        "................",
        "................",
        "................",
        "........e.......",
        ".......ed.......",
        "...e...dc...e...",
        "..edd..dc..dd...",
        "....cd.c..dc..e.",
        ".e...ccbc.c..dd.",
        "..dd..cbbcb.dc..",
        "....cc.bbb.cc...",
        "..e..cbbabbc..e.",
        "...dc.bbabc.cd..",
        ".....cbaaab.c...",
        "..dcbbaaaaabbcd.",
        ".cbbaaaaaaaaabc.",
    ], keys)
    flowers = from_rows([
        "................",
        "................",
        "................",
        "................",
        "................",
        "....y...........",
        "...ygy......f...",
        "....y......fgf..",
        "....c...y...f...",
        "....c..ygy..c...",
        "...dc...y...c...",
        "....cd..c..dc...",
        "..d.c.d.c.d.c...",
        "...dcd.dcd..cd..",
        "..cbcbccbcbcbc..",
        ".cbbbbbbbbbbbbc.",
    ], keys)
    rubble = from_rows([
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "......iiii......",
        ".....ituvwo.....",
        "...iiituuvo.....",
        "..ituvituvvoii..",
        ".ituuvoisttituo.",
        ".isttuoostuuvvo.",
        "itssttoosstuuvvo",
        "iiiiiiiiiiiiiiii",
    ], keys)
    vine = from_rows([
        "abbcabbcbaabcbba",
        ".bc.cbd..bc.cb..",
        ".c..bd...c..d...",
        ".d..c....cd.e...",
        ".c..dc....c.....",
        ".b...c....d.....",
        ".cd..d....c.....",
        "..c..e....bd....",
        "..d.......c.....",
        "..c.......d.....",
        "..be......e.....",
        "..c.............",
        "..d.............",
        "...e............",
        "................",
        "................",
    ], keys)
    pipe = from_rows([
        "................",
        "................",
        "................",
        "................",
        "................",
        "................",
        "....jjjjjj......",
        "...jkmmnnkj.....",
        "...jkkmmnkj.....",
        "....jkmnkj......",
        "....jkmnkjd.....",
        "....jkpmkjcd....",
        "....jkppkj.c....",
        "...jkkmnnkj.d...",
        "..bjkkmnnnkjcb..",
        ".cbjjjjjjjjjbbc.",
    ], keys)
    return {"deco-fern": fern, "deco-flowers": flowers, "deco-rubble": rubble, "deco-vine": vine, "deco-pipe": pipe}


def sheet(tiles, columns):
    rows = (len(tiles) + columns - 1) // columns
    c = Canvas(columns * TILE, rows * TILE)
    for i, t in enumerate(tiles):
        c.blit(t, (i % columns) * TILE, (i // columns) * TILE)
    return c


def tileset():
    """The atlas: the 47 terrain tiles, three more fills, then the props on new rows."""
    terrain = [terrain_tile(m) for m in BLOB] + [terrain_tile(255, v) for v in (1, 2, 3)]
    props = {}
    props.update(platform_tiles())
    props.update(spike_tiles())
    props.update(deco_tiles())
    cols = 10
    names = [f"terrain-{m}" for m in BLOB] + ["terrain-255-v1", "terrain-255-v2", "terrain-255-v3"]
    tiles = terrain[:]
    while len(tiles) % cols:
        tiles.append(Canvas(TILE, TILE))
        names.append(None)
    for name, t in props.items():
        tiles.append(t)
        names.append(name)
    atlas = sheet(tiles, cols)
    index = {n: i for i, n in enumerate(names) if n}
    data = {
        "tile": TILE,
        "columns": cols,
        "terrain": {
            "about": "47-tile blob autotile: the bits name which of the 8 neighbours are terrain; a corner bit counts only when both sides beside it are set.",
            "bits": {"N": N, "NE": NE, "E": E, "SE": SE, "S": S, "SW": SW, "W": Wb, "NW": NW},
            "byMask": {str(m): index[f"terrain-{m}"] for m in BLOB},
            "fillVariants": [index["terrain-255"], index["terrain-255-v1"], index["terrain-255-v2"], index["terrain-255-v3"]],
        },
        "tiles": {n: i for n, i in index.items() if not n.startswith("terrain")},
    }
    return atlas, data, props


# --- Backdrop planes ---------------------------------------------------------
# A jungle that has swallowed an industrial city, in hazy afternoon light. Each
# plane loops over the screen's width (every wave has a whole number of cycles
# across W, and every shape wraps), and each plane back has less contrast and
# moves toward the sky's colors.


def wave(x, terms):
    return sum(a * math.sin(2 * math.pi * (k * x / W) + p) for a, k, p in terms)


def wrapdx(x, cx):
    d = (x - cx) % W
    return d - W if d > W / 2 else d


def blobs_shade(c, circles, tones, base_y=None, light=LIGHT, scallop=0.0):
    """Paints lumps (cx, cy, r) one over another, each shaded as pixel artists shade a ball:
    the base, a lit disc pushed toward the sun, a small top light further on, and a shadow
    crescent on the far side. tones: (shadow, base, light, top). Lumps drawn later cover
    earlier ones, so a bush or a cloud reads as a pile of rounded masses. A flat underside
    at base_y if given. Wraps horizontally."""
    lx, ly = light[0] / math.hypot(*light), light[1] / math.hypot(*light)
    for n_, (cx, cy, r) in enumerate(circles):
        for y in range(int(cy - r - 1), int(cy + r + 2)):
            if base_y is not None and y > base_y:
                continue
            for xx in range(int(cx - r - 1), int(cx + r + 2)):
                px, py = xx + 0.5, y + 0.5
                # A scalloped edge for leaves: the radius ripples around the lump.
                ang = math.atan2(py - cy, px - cx)
                edge = r * (1 + scallop * math.sin(ang * max(5, round(r * 0.9)) + n_))
                if math.hypot(px - cx, py - cy) > edge:
                    continue
                t = tones[1]
                if math.hypot(px - (cx - lx * r * 0.35), py - (cy - ly * r * 0.35)) > r:
                    t = tones[0]
                if math.hypot(px - (cx + lx * r * 0.3), py - (cy + ly * r * 0.3)) < r * 0.62:
                    t = tones[2]
                if r >= 6 and math.hypot(px - (cx + lx * r * 0.5), py - (cy + ly * r * 0.5)) < r * 0.28:
                    t = tones[3]
                c.set(xx % W, y, t)


def sky():
    c = Canvas(W, H)
    bands = [(0, "sky0"), (46, "sky1"), (104, "sky2"), (150, "sky3"), (186, "rose5")]
    for x in range(W):
        off = round(wave(x, [(2.0, 2, 0.4), (1.0, 5, 1.9)]))
        for y in range(H):
            col = "sky0"
            for edge, name in bands:
                if y >= edge + (off if edge else 0):
                    col = name
            c.px[y][x] = col
    # Thin streaks where two bands meet, instead of a checker: a lighter line across the darker band.
    rng = random.Random(5)
    for edge, name in bands[1:]:
        for k in range(6):
            x0, ln = rng.randrange(W), rng.randint(20, 70)
            y0 = edge - rng.randint(3, 7)
            for x in range(x0, x0 + ln):
                yy = y0 + round(wave(x, [(2.0, 2, 0.4), (1.0, 5, 1.9)]))
                c.set(x % W, yy, name)
    # The sun, high on the right: the one light. A white disc in a cream halo.
    sx, sy = 296, 38
    for y in range(sy - 22, sy + 23):
        for x in range(sx - 22, sx + 23):
            d = math.hypot(x + 0.5 - sx, y + 0.5 - sy)
            if d <= 11:
                c.set(x, y, "steel6")
            elif d <= 14:
                c.set(x, y, "sky3")
            elif d <= 19 and c.get(x, y) == "sky0":
                c.set(x, y, "sky1")
    # Clouds: a bank along the horizon and a few drifting high, lit from the sun's side.
    rng = random.Random(9)
    tones = ("sky1", "sky2", "steel6", "steel6")
    x = 0
    while x < W:
        cx, w = x + rng.randint(10, 30), rng.randint(40, 80)
        base = rng.randint(150, 168)
        circles = []
        for k in range(rng.randint(4, 7)):
            px = cx + rng.uniform(-w / 2, w / 2)
            r = rng.uniform(7, 15) * (1 - abs(px - cx) / w)
            circles.append((px, base - r * 0.5, max(4, r)))
        blobs_shade(c, sorted(circles, key=lambda q: q[2]), ("sky2", "sky3", "steel6", "steel6"), base_y=base)
        x += w + rng.randint(10, 40)
    for cx, cy, w in ((60, 70, 70), (180, 52, 44), (330, 92, 56)):
        circles = []
        for k in range(5):
            px = cx + (k - 2) * w / 6 + rng.uniform(-3, 3)
            r = (w / 5) * (1 - abs(k - 2) * 0.22)
            circles.append((px, cy - r * 0.4, r))
        blobs_shade(c, sorted(circles, key=lambda q: q[2]), ("sky1", "sky2", "steel6", "steel6"), base_y=cy)
    return c


def far_city():
    """Far: a broken skyline in the haze, flat lavender with lit faces and a few windows."""
    c = Canvas(W, H)
    rng = random.Random(21)
    base = 192
    x = 0
    while x < W:
        w = rng.randint(14, 34)
        h = rng.randint(30, 92)
        top = base - h
        broken = rng.random() < 0.5
        for xx in range(x, x + w):
            t = top
            if broken:
                # A broken top: the roof falls away in steps on one side.
                t = top + max(0, round((xx - x - w * 0.4) * 0.9)) if rng.random() < 2 else top
            for y in range(t, H):
                lit = xx >= x + w - 3
                c.set(xx % W, y, "sky2" if lit else "sky1")
        # Windows: a sparse grid of dark slots.
        for wy in range(top + 6, base - 4, 6):
            for wx in range(x + 3, x + w - 4, 5):
                if rng.random() < 0.55 and c.get(wx % W, wy - 1) is not None:
                    c.set(wx % W, wy, "sky0")
                    c.set(wx % W, wy + 1, "sky0")
        if rng.random() < 0.3:
            ax = x + w // 2
            for y in range(top - rng.randint(6, 14), top):
                c.set(ax % W, y, "sky1")
        x += w + rng.randint(0, 6)
    # Haze at the foot of the city.
    for xx in range(W):
        for y in range(base - 6, H):
            if c.get(xx, y) is not None and y > base - 6 + (xx % 3 == 0) + 2 * ((xx // 7) % 2):
                c.set(xx, y, "sky2")
    return c


def girder_line(c, x0, y0, x1, y1, col):
    n = max(abs(x1 - x0), abs(y1 - y0)) or 1
    for k in range(n + 1):
        c.set(round(x0 + (x1 - x0) * k / n) % W, round(y0 + (y1 - y0) * k / n), col)


def mid_ruins():
    """Mid: the industrial ruin, grey-blue steel and concrete with teal growth: a cooling
    tower, a broken truss bridge, chimneys, and cranes."""
    c = Canvas(W, H)
    rng = random.Random(33)
    ground = [round(186 - wave(x, [(4, 2, 0.3), (2, 5, 2.0)])) for x in range(W)]
    body, lit, dark = "steel3", "steel4", "steel2"
    # The cooling tower: a waisted shell, lit on the right.
    tx, top, bottom = 92, 96, 196
    for y in range(top, bottom):
        t = (y - top) / (bottom - top)
        half = 16 + 9 * (t - 0.42) ** 2 * 4.2
        for x in range(round(tx - half), round(tx + half) + 1):
            dx = (x - tx) / half
            col = lit if dx > 0.45 else dark if dx < -0.55 else body
            if y < top + 2:
                col = dark
            c.set(x % W, y, col)
        if y > top + 4 and y % 9 == 0:  # the shell's rings of stained concrete
            for x in range(round(tx - half) + 1, round(tx + half)):
                if c.get(x % W, y) == body:
                    c.set(x % W, y, dark)
    # A broken bite out of the tower's rim.
    for y in range(top, top + 14):
        for x in range(tx + 2, tx + 20):
            if (x - tx - 2) * 0.9 + (top + 14 - y) * 1.3 > 14 and (x - tx) < 18:
                c.set(x % W, y, None)
    # Chimneys.
    for cx, h, w in ((150, 92, 6), (162, 70, 5), (318, 104, 7)):
        for y in range(ground[cx] - h, H):
            for x in range(cx, cx + w):
                c.set(x % W, y, lit if x == cx + w - 1 else dark if x == cx else body)
            if (y - ground[cx] + h) % 12 == 3:
                for x in range(cx, cx + w):
                    c.set(x % W, y, dark)
    # The broken bridge: a truss from the right that stops in mid-air.
    by = 132
    for x in range(196, 300):
        c.set(x, by, lit)
        c.set(x, by + 1, body)
        c.set(x, by + 12, body)
        c.set(x, by + 13, dark)
    for k in range(196, 296, 12):
        girder_line(c, k, by + 1, k + 6, by + 12, body)
        girder_line(c, k + 6, by + 12, k + 12, by + 1, dark)
        girder_line(c, k, by, k, by + 13, body)
    for px in (230, 276):  # its piers
        for y in range(by + 14, H):
            for x in range(px, px + 7):
                c.set(x, y, lit if x == px + 6 else dark if x == px else body)
    # The broken end: bent girders hanging.
    girder_line(c, 196, by + 12, 188, by + 24, body)
    girder_line(c, 196, by, 186, by + 6, body)
    # A crane: a mast and a jib, its hook line down.
    mx = 352
    for y in range(80, H):
        c.set(mx, y, dark)
        c.set(mx + 3, y, lit)
        if y % 6 == 0:
            girder_line(c, mx, y, mx + 3, y + 3, body)
    for x in range(mx - 40, mx + 14):
        c.set(x % W, 80, lit)
        c.set(x % W, 84, body)
        if x % 6 == 0:
            girder_line(c, x, 80, x + 3, 84, body)
    for y in range(85, 120):
        c.set((mx - 34) % W, y, dark)
    # The ground of rubble, and teal growth over everything: mounds and creepers.
    for x in range(W):
        for y in range(ground[x], H):
            c.set(x, y, "teal3" if y < ground[x] + 2 else "teal4" if (x + y) % 2 and y < ground[x] + 4 else "teal3")
    circles = []
    for k in range(30):
        x = rng.randrange(W)
        circles.append((x, ground[x] - rng.uniform(0, 4), rng.uniform(4, 10)))
    for (x, y, r) in ((80, 101, 5), (90, 99, 4), (240, 131, 4), (262, 131, 3)):
        circles.append((x, y, r))
    blobs_shade(c, circles, ("teal3", "teal4", "teal5", "teal5"), scallop=0.15)
    # Creepers hanging from the bridge and the tower.
    for x0, y0, ln in ((210, 146, 18), (222, 146, 9), (252, 146, 24), (268, 146, 12), (84, 108, 26), (98, 108, 14), (290, 146, 16)):
        for k in range(ln):
            c.set((x0 + round(1.5 * math.sin(k * 0.4))) % W, y0 + k, "teal3" if k % 4 else "teal4")
    return c


def near_jungle():
    """Near: the jungle at the edge of the ruin, darker and with more contrast: a ridge of
    broad leaves, trunks rising out of it, and a canopy that frames the top."""
    c = Canvas(W, H)
    rng = random.Random(44)
    ridge = [round(178 - wave(x, [(6, 1, 0.8), (4, 3, 2.2), (2, 7, 0.1)])) for x in range(W)]
    tones = ("teal1", "teal2", "teal3", "teal5")
    # Trunks, thin and tall, leaning a little, lit on the right.
    for tx, w in ((40, 11), (196, 8), (300, 13)):
        lean = rng.uniform(-0.08, 0.08)
        for y in range(0, H):
            x0 = tx + round(lean * (H - y))
            ww = w + max(0, (y - 150) // 6)  # the trunk flares into its roots
            x0 -= max(0, (y - 150) // 12)
            for x in range(x0, x0 + ww):
                col = "teal2"
                if x >= x0 + ww - 3:
                    col = "teal3"
                if x == x0 + ww - 2 and (y // 3) % 3:
                    col = "teal5" if y > 30 else "teal3"
                if x <= x0 + 1:
                    col = "teal1"
                # Bark: short dark grooves along the trunk, staggered.
                if (x - x0) in (3, 6) and (y + x * 7) % 11 < 4:
                    col = "teal1"
                c.set(x % W, y, col)
    # The canopy along the top: big lumps, lit on the sun's side.
    circles = []
    x = 0
    while x < W:
        r = rng.uniform(7, 15)
        circles.append((x, rng.uniform(-6, 8) + (6 if r < 10 else 0), r))
        x += rng.uniform(6, 14)
    blobs_shade(c, circles, tones, scallop=0.12)
    # Vines from the canopy.
    for k in range(7):
        x0, ln = rng.randrange(W), rng.randint(16, 46)
        for j in range(ln):
            xx = (x0 + round(2 * math.sin(j * 0.25 + k))) % W
            c.set(xx, 14 + j, "teal1")
            if j % 6 == 3:  # a leaf on the vine
                c.set((xx + 1) % W, 14 + j, "teal3")
                c.set((xx + 2) % W, 13 + j, "teal3")
    # The ridge: broad-leaf bushes on a dark slope.
    for x in range(W):
        for y in range(ridge[x], H):
            c.set(x, y, "teal1")
    circles = []
    for k in range(110):
        x = rng.randrange(W)
        circles.append((x, ridge[x] + rng.uniform(-3, 10), rng.uniform(4, 10)))
    blobs_shade(c, sorted(circles, key=lambda q: q[1]), tones, scallop=0.12)
    return c


def foreground():
    """In front of the play: big leaves hanging into the top corners and a fringe of ferns
    along the bottom, flat dark teal silhouettes with one rim of light, kept to margins the
    player cannot reach. It loops."""
    c = Canvas(W, H)
    rng = random.Random(55)

    def frond(x0, y0, ang, ln, reach, bend):
        """A palm frond: a rib that arcs down from where it hangs, leaflets along both sides,
        longest in the middle, swept toward the tip."""
        pts = []
        for j in range(ln):
            t = j / ln
            a = ang + bend * t
            if pts:
                px, py = pts[-1]
            else:
                px, py = x0, y0
            pts.append((px + math.cos(a), py + math.sin(a)))
        for j, (px, py) in enumerate(pts):
            c.set(round(px) % W, round(py), "teal0")
            c.set(round(px) % W, round(py) + 1, "teal0")
            t = j / ln
            if j % 2 == 0 and 0.08 < t < 0.97:
                a = ang + bend * t
                l = reach * math.sin(math.pi * min(1.0, t * 1.15)) + 2
                for side in (-1, 1):
                    la = a + side * 1.05
                    for q in range(int(l)):
                        # Leaflets droop a little and sweep toward the tip.
                        qx = px + math.cos(la) * q + math.cos(a) * q * 0.45
                        qy = py + math.sin(la) * q + math.sin(a) * q * 0.45 + q * q * 0.03
                        c.set(round(qx) % W, round(qy), "teal0")
                        if q < l * 0.5:
                            c.set(round(qx) % W, round(qy) + 1, "teal0")

    for (x, y, a, ln, reach, bend) in ((-4, -2, 0.35, 70, 9, 0.9), (-2, 10, 0.05, 50, 7, 1.1), (6, -4, 0.9, 44, 7, 0.7),
                                       (W + 4, -2, math.pi - 0.4, 64, 9, -0.9), (W + 2, 6, math.pi - 0.05, 44, 7, -1.1)):
        frond(x, y, a, ln, reach, bend)
    # Ferns along the bottom: fronds that arc out from clumps.
    x = 0
    while x < W:
        n = rng.randint(3, 6)
        for k in range(n):
            ang = math.pi * (1.0 + (k + 0.5) / n)  # from left to right, up
            ln = rng.randint(10, 22)
            for j in range(ln):
                t = j / ln
                px = x + math.cos(ang) * j * 0.9
                py = H - 1 + math.sin(ang) * j * 0.7 + t * t * 6
                c.set(round(px) % W, round(py), "teal0")
                if t < 0.7:
                    c.set(round(px) % W, round(py) + 1, "teal0")
                if j % 3 == 1 and t < 0.85:  # leaflets
                    for q in (1, 2):
                        c.set(round(px - math.sin(ang) * q) % W, round(py + math.cos(ang) * q) + 1, "teal0")
        x += rng.randint(18, 40)
    for x in range(W):
        for y in range(H - 3, H):
            c.set(x, y, "teal0")
    # One rim of light on the edges that face the sun (up and right).
    out = c.copy()
    for y in range(H):
        for x in range(W):
            if c.px[y][x] == "teal0" and c.get((x + 1) % W, y) is None and c.get(x, y - 1) is None and y > 0:
                out.px[y][x] = "teal1"
    return out


# --- Props and the enemy -----------------------------------------------------


def cog_frames():
    """The collectible: a brass cog that spins on its axis (eight frames over half a turn,
    since it looks the same from behind), with a glint on the sun's side."""
    frames = []
    for k in range(8):
        th = math.pi * k / 8
        sx = math.cos(th)
        c = Canvas(16, 16)
        cx, cy = 8.0, 8.0
        thick = 1.6 * abs(math.sin(th))  # the cog's edge shows as it turns
        for y in range(16):
            for x in range(16):
                px, py = x + 0.5 - cx, y + 0.5 - cy
                face = None
                if abs(sx) > 0.12:
                    u = px / abs(sx) if abs(sx) > 0 else 99
                    ang = math.atan2(py, u)
                    rad = math.hypot(u, py)
                    tooth = (math.cos(ang * 8) > 0.25)
                    outer = 6.6 if tooth else 5.2
                    if 2.0 < rad <= outer:
                        face = "gold1"
                        if rad > outer - 1.1 or (not tooth and rad > 4.4):
                            face = "gold0"
                        if px * 0.7 - py * 0.7 > 2.2 and rad < 4.6:
                            face = "gold2"
                        if rad <= 3.0:
                            face = "gold0"
                # The edge: a band beside the face, darker, on the side turning away.
                if face is None and thick > 0.4:
                    off = px + (thick if sx > 0 else -thick)
                    if abs(sx) > 0.12:
                        u = off / abs(sx)
                        rad = math.hypot(u, py)
                        ang = math.atan2(py, u)
                        outer = 6.6 if math.cos(ang * 8) > 0.25 else 5.2
                        if 2.0 < rad <= outer and math.hypot(px / abs(sx), py) > 2.0:
                            face = "fire3"
                    elif abs(px) <= 1.2 and abs(py) <= 6.6 and not (abs(py) > 5.2 and int(py + 8) % 2):
                        face = "fire3" if px < 0.2 else "gold0"
                if face:
                    c.set(x, y, face)
        frames.append(selout(c))
    return frames


def spring_frames():
    """A spring pad: a steel base, a red coil, and a plate. At rest, pressed, and thrown up."""
    out = []
    for coil_h, plate_up in ((7, 0), (3, 0), (12, 0)):
        c = Canvas(16, 24)
        base = 22
        for x in range(1, 15):
            c.set(x, base, "steel1")
            c.set(x, base - 1, "steel3" if x < 12 else "steel4")
        top = base - 2 - coil_h
        # The coil: a front wire every other row, lit, and the back wire's ends between.
        for j, y in enumerate(range(base - 2, top, -1)):
            if j % 2 == 0:
                for x in range(4, 12):
                    c.set(x, y, "fire3" if x > 6 else "fire2")
            else:
                c.set(4, y, "fire1")
                c.set(11, y, "fire1")
        for x in range(2, 14):
            c.set(x, top, "steel5" if x > 9 else "steel4")
            c.set(x, top - 1, "steel6" if x > 9 else "steel5")
        for x in range(3, 13):
            c.set(x, top - 2, "fire3" if x > 8 else "fire2")  # the pad's warning stripe
        out.append(selout(c))
    return out


def beacon_frames():
    """The checkpoint: a radio beacon on a pole. Off, its lamp is dull steel; on, it glows
    gold and blinks (two frames)."""
    out = []
    for state in ("off", "on-a", "on-b"):
        c = Canvas(16, 32)
        for y in range(10, 31):
            c.set(7, y, "steel1")
            c.set(8, y, "steel3")
            c.set(9, y, "steel4")
        for x in range(4, 13):
            c.set(x, 30, "steel2" if x < 9 else "steel3")
            c.set(x, 29, "steel3" if x < 10 else "steel4")
        # The antenna and the lamp's cage.
        for y in range(1, 5):
            c.set(8, y, "steel3")
        lamp_on = state != "off"
        for y in range(5, 11):
            for x in range(5, 12):
                d = math.hypot(x + 0.5 - 8.5, y + 0.5 - 8)
                if d <= 3.4:
                    if lamp_on:
                        col = "gold2" if (x > 8 and y < 8) else "gold1" if d < 2.6 else "gold0"
                    else:
                        col = "steel5" if (x > 8 and y < 8) else "steel3" if d < 2.6 else "steel2"
                    c.set(x, y, col)
        for y in (6, 9):
            for x in range(5, 12):
                if c.get(x, y):
                    c.set(x, y, "steel1")  # the cage bars
        c.set(9, 7, "steel6")
        # A pennant in the hazard's gold would lie; the beacon carries a small blue tag instead.
        for y in range(13, 17):
            for x in range(10, 10 + (17 - y)):
                c.set(x, y, "blue2" if y < 15 else "blue1")
        if state == "on-b":
            for (x, y) in ((3, 8), (14, 8), (8, 0), (4, 4), (13, 4)):
                c.set(x, y, "gold2")
        out.append(selout(c))
    return out


def enemy_frames():
    """A scrap beetle: a dented violet shell on six steel legs, one big eye. Four idle frames:
    the shell breathes on its legs and the eye glances."""
    out = []
    for k in range(4):
        c = Canvas(32, 24)
        bob = (0, 1, 1, 0)[k]
        cx, cy, rx, ry = 15.5, 15 + bob, 11.5, 9.0
        # Legs first, under the shell: three a side, bent at the knee.
        for i, lx in enumerate((7, 13, 21)):
            kx = lx + (-2 if i < 1 else 2 if i > 1 else 0) + ((k + i) % 2)
            girder = [(lx, 15 + bob), (kx, 18), (kx + (1 if i else -1), 22)]
            for (x0, y0), (x1, y1) in zip(girder, girder[1:]):
                n = max(abs(x1 - x0), abs(y1 - y0)) or 1
                for t in range(n + 1):
                    c.set(round(x0 + (x1 - x0) * t / n), round(y0 + (y1 - y0) * t / n), "steel2")
        for y in range(24):
            for x in range(32):
                px, py = x + 0.5 - cx, y + 0.5 - cy
                if py > 1.5:
                    continue
                if (px / rx) ** 2 + (py / ry) ** 2 > 1:
                    continue
                col = "violet2"
                if (px - 3) ** 2 / (rx * 0.7) ** 2 + (py + 3) ** 2 / (ry * 0.6) ** 2 < 1:
                    col = "violet3"
                if (px - 5) ** 2 + (py + 6) ** 2 < 3.2:
                    col = "violet4"
                if (px / rx) ** 2 + (py / ry) ** 2 > 0.72 and px < 0:
                    col = "violet1"
                if py > 0.5:
                    col = "violet1"  # the shell's rim, in its own shade
                # Plate seams.
                if abs(px + 3 - py * 0.3) < 0.5 and py < -1:
                    col = "violet1"
                c.set(x, y, col)
        # The eye on the front, low: a red-pink lens with a white glint.
        ex, ey = 24, 12 + bob
        for y in range(ey - 1, ey + 2):
            for x in range(ex - 1, ex + 3):
                if not ((x in (ex - 1, ex + 2)) and y in (ey - 1, ey + 1)):
                    c.set(x, y, "fire3")
        c.set(ex - 1, ey, "fire2")
        c.set(ex, ey + 1, "fire2")
        gx = ex + (1 if k != 2 else 0)
        c.set(gx, ey - 1, "steel6")
        c.set(gx, ey, "fire4")
        out.append(selout(c))
    return out


def strip(frames, gap=0):
    w = sum(f.w for f in frames) + gap * (len(frames) - 1)
    h = max(f.h for f in frames)
    c = Canvas(w, h)
    x = 0
    for f in frames:
        c.blit(f, x, h - f.h)
        x += f.w + gap
    return c


def frames_json(name, frames, ms, loop, about):
    """The strip's frames in the hash format, like the player's."""
    data = {"frames": {}, "animations": {name: []}, "meta": {"size": {}, "about": about, "loop": loop}}
    x = 0
    for i, f in enumerate(frames):
        key = f"{name} {i}"
        data["frames"][key] = {"frame": {"x": x, "y": 0, "w": f.w, "h": f.h}, "duration": ms, "anchor": {"x": 0.5, "y": 1}}
        data["animations"][name].append(key)
        x += f.w
    data["meta"]["size"] = {"w": x, "h": max(f.h for f in frames)}
    data["meta"]["image"] = f"{name}.png"
    return data


# --- The mockup room ---------------------------------------------------------
# 24 x 14 tiles; the screen shows 13.5 rows, so the last row is half off screen.

LEVEL = [
    "###..................###",
    "##...................###",
    "#.....................##",
    "#.....................##",
    "#.....................##",
    "#.....................##",
    "#.....................##",
    "##.........-----......##",
    "###.........|.|.......##",
    "####........|.|...######",
    "#####.......|.|...######",
    "######......|.|^^^######",
    "########################",
    "########################",
]


def solid_at(level, x, y):
    if y < 0 or y >= len(level) or x < 0 or x >= len(level[0]):
        return True  # the room's border counts as rock, so no outline runs along the screen's edge
    return level[y][x] == "#"


def compose_terrain(level):
    cache = {}
    c = Canvas(len(level[0]) * TILE, len(level) * TILE)
    for y, row in enumerate(level):
        for x, k in enumerate(row):
            if k != "#":
                continue
            mask = 0
            for bit, (dx, dy) in DIRS.items():
                if solid_at(level, x + dx, y + dy):
                    mask |= bit
            mask = canonical(mask)
            variant = 0
            if mask == 255:
                h = (x * 73856093 ^ y * 19349663) % 7
                variant = (0, 0, 0, 0, 1, 2, 3)[h]
            if (mask, variant) not in cache:
                cache[(mask, variant)] = terrain_tile(mask, variant)
            c.blit(cache[(mask, variant)], x * TILE, y * TILE)
    return c


PARALLAX = [("bg-0-sky.png", 0.0), ("bg-1-far.png", 0.15), ("bg-2-mid.png", 0.35), ("bg-3-near.png", 0.6)]
FG_PARALLAX = 1.3


def layers_at(camera, imgs):
    out = Image.new("RGBA", (W, H))
    for img, factor in imgs:
        off = round(camera * factor) % W
        for k in (0, 1):
            out.alpha_composite(img, (-off + k * W, 0))
    return out


def fx_frame(name, i):
    """One frame of an effect, read back from the sheet `ritmo-tools fx render` wrote."""
    path = os.path.join(ART, "fx", f"{name}.json")
    if not os.path.exists(path):
        return None, None
    with open(path) as f:
        data = json.load(f)
    fr = data["frames"][f"{name} {i}"]
    img = Image.open(os.path.join(ART, "fx", f"{name}.png")).convert("RGBA")
    box = fr["frame"]
    anchor = fr.get("anchor", {"x": 0.5, "y": 0.5})
    return img.crop((box["x"], box["y"], box["x"] + box["w"], box["y"] + box["h"])), \
        (round(anchor["x"] * box["w"]) if anchor["x"] <= 1 else anchor["x"], round(anchor["y"] * box["h"]) if anchor["y"] <= 1 else anchor["y"])


def room_layer(props):
    room = compose_terrain(LEVEL)
    tp = props
    for y, row in enumerate(LEVEL):
        for x, k in enumerate(row):
            if k == "^":
                room.blit(tp["spikes-up"], x * TILE, y * TILE)
            if k == "-":
                left = row[x - 1] != "-"
                right = x + 1 < len(row) and row[x + 1] != "-"
                room.blit(tp["platform-left" if left else "platform-right" if right else "platform-mid"], x * TILE, y * TILE)
            if k == "|":
                room.blit(tp["platform-post"], x * TILE, y * TILE)
    for name, cells in {
        "deco-fern": [(3, 8), (6, 11), (20, 8)],
        "deco-flowers": [(4, 9), (8, 11)],
        "deco-rubble": [(9, 11), (21, 8)],
        "deco-vine": [(2, 1), (21, 2)],
        "deco-pipe": [(18, 8)],
    }.items():
        for cx, cy in cells:
            assert LEVEL[cy][cx] == ".", (name, cx, cy)
            assert LEVEL[cy - 1 if name == "deco-vine" else cy + 1][cx] == "#", (name, cx, cy)
            room.blit(tp[name], cx * TILE, cy * TILE)
    return room


def mockup(anims, extra):
    imgs = [(Image.open(os.path.join(ART, "backdrop", n)).convert("RGBA"), f) for n, f in PARALLAX]
    fg = Image.open(os.path.join(ART, "foreground", "fg-jungle.png")).convert("RGBA")
    scene = layers_at(0, imgs)
    _, _, tprops = tileset()
    scene.alpha_composite(room_layer(tprops).image())
    # Props: the beacon on the left mound, a spring in the pit, cogs over the catwalk, the beetle on the ledge.
    scene.alpha_composite(extra["beacon"][1].image(), (2 * TILE, 9 * TILE - 32))
    scene.alpha_composite(extra["spring"][0].image(), (10 * TILE, 12 * TILE - 24))
    for k, (cx, cy) in enumerate(((180, 84), (200, 78), (220, 84))):
        scene.alpha_composite(extra["cog"][(0, 7, 1)[k]].image(), (cx, cy))
    scene.alpha_composite(extra["enemy"][0].image(), (19 * TILE + 4, 9 * TILE - 24))
    # The player mid-run on the pit floor, dust at the back foot; and a second capture of
    # her mid-jump off the catwalk would crowd the room, so one is enough.
    run = anims["run"][0]
    px, py = 6 * TILE - 2, 12 * TILE - FRAME
    dust, anchor = fx_frame("dust", 2)
    if dust is not None:
        scene.alpha_composite(dust, (px + 18 - anchor[0], py + 47 - anchor[1]))
    scene.alpha_composite(run[3].image(), (px, py))
    scene.alpha_composite(fg)
    return scene


def player_gif(anims, path, scale):
    """Every animation playing side by side on its own clock, on a strip of ground (or a wall)."""
    ground = terrain_tile(canonical(E | Wb | S | SE | SW))
    wall = terrain_tile(canonical(N | S | E | NE | SE))
    order = ["idle", "run", "jump", "fall", "dash", "wall-slide", "land"]
    cw, ch = 56, 72
    step, total = 10, 2240
    frames = []
    for t in range(0, total, step):
        c = Canvas(cw * len(order), ch, "sky2")
        for i, name in enumerate(order):
            fs, ms, loop = anims[name]
            hold = 400 if not loop else 0  # one-shots hold their last frame, then play again
            span = len(fs) * ms + hold
            k = (t // ms) % len(fs) if loop else min(len(fs) - 1, (t % span) // ms)
            x0 = i * cw
            if name == "wall-slide":
                for y in range(0, ch, TILE):
                    c.blit(wall, x0 + 4 + WALL, y)
            elif name not in ("jump", "fall", "dash"):
                for x in range(0, cw, TILE):
                    c.blit(ground, x0 + x, 56)
            y = 56 - FRAME if name not in ("jump", "fall", "dash", "wall-slide") else 8
            c.blit(fs[k], x0 + 4, y)
        frames.append(c.image())
    save_gif(frames, [step] * len(frames), path, scale)


def parallax_gif(path, scale):
    imgs = [(Image.open(os.path.join(ART, "backdrop", n)).convert("RGBA"), f) for n, f in PARALLAX]
    fg = Image.open(os.path.join(ART, "foreground", "fg-jungle.png")).convert("RGBA")
    frames = []
    for i in range(96):
        cam = round(W * (1 - math.cos(math.pi * 2 * i / 96)) / 2)
        img = layers_at(cam, imgs)
        off = round(cam * FG_PARALLAX) % W
        for k in (0, 1):
            img.alpha_composite(fg, (-off + k * W, 0))
        frames.append(img)
    save_gif(frames, [40] * len(frames), path, scale)


def comparisons(anims):
    """Set one's player beside this one at the same zoom, and the two mockups side by side,
    so the change of scale is plain."""
    one = os.path.join(SET_ONE, "art")
    if not os.path.exists(os.path.join(one, "player", "player.png")):
        return
    p1 = Image.open(os.path.join(one, "player", "player.png")).convert("RGBA")
    zoom = 6
    bg = rgb("sky2") + (255,)
    # Players: set one's idle, run, jump, and dash frames, then this set's.
    one_frames = [p1.crop((0, 0, 16, 16)), p1.crop((0, 16, 16, 32)), p1.crop((32, 16, 48, 32)), p1.crop((0, 32, 16, 48)), p1.crop((0, 64, 16, 80))]
    two_frames = [anims["idle"][0][0].image(), anims["run"][0][1].image(), anims["run"][0][5].image(), anims["jump"][0][0].image(), anims["dash"][0][1].image()]
    pad = 4
    img = Image.new("RGBA", (pad + len(two_frames) * (FRAME + pad), pad + 16 + pad + FRAME + pad), bg)
    for k, f in enumerate(one_frames):
        img.alpha_composite(f, (pad + k * (FRAME + pad) + (FRAME - 16) // 2, pad))
    for k, f in enumerate(two_frames):
        img.alpha_composite(f, (pad + k * (FRAME + pad), pad + 16 + pad))
    os.makedirs(os.path.join(PREVIEWS, "compare"), exist_ok=True)
    img.resize((img.width * zoom, img.height * zoom), Image.NEAREST).save(os.path.join(PREVIEWS, "compare", "players@6x.png"), optimize=True)
    # Mockups: each at its own native size, both at 3x, the same pixel size on screen.
    m1 = Image.open(os.path.join(one, "mockup", "mockup.png")).convert("RGBA")
    m2 = Image.open(os.path.join(ART, "mockup", "mockup.png")).convert("RGBA")
    both = Image.new("RGBA", (m1.width + 8 + m2.width, max(m1.height, m2.height)), (20, 16, 19, 255))
    both.alpha_composite(m1, (0, (both.height - m1.height) // 2))
    both.alpha_composite(m2, (m1.width + 8, 0))
    both.resize((both.width * 3, both.height * 3), Image.NEAREST).save(os.path.join(PREVIEWS, "compare", "mockups@3x.png"), optimize=True)


def main():
    os.makedirs(ART, exist_ok=True)
    os.makedirs(PREVIEWS, exist_ok=True)
    with open(os.path.join(HERE, "palette.hex"), "w") as f:
        f.write("".join(v.lstrip("#") + "\n" for v in PALETTE.values()))
    with open(os.path.join(HERE, "pixel.config.json"), "w") as f:
        json.dump({"palette": "palette.hex", "maxColors": 32}, f, indent=2)
        f.write("\n")
    layers = {"bg-0-sky.png": sky(), "bg-1-far.png": far_city(), "bg-2-mid.png": mid_ruins(), "bg-3-near.png": near_jungle()}
    for name, layer in layers.items():
        save(layer, "backdrop/" + name, scale=3)
    stacked = Canvas(W, H)
    for layer in layers.values():
        stacked.blit(layer, 0, 0)
    save(stacked, "backdrop/backdrop-stacked.png", scale=3)
    save(foreground(), "foreground/fg-jungle.png", scale=3)
    atlas, data, _ = tileset()
    save(atlas, "tiles/tileset.png", scale=6)
    with open(os.path.join(ART, "tiles", "tileset.json"), "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    anims = player_animations()
    psheet, pdata = player_sheet(anims)
    save(psheet, "player/player.png", scale=4)
    with open(os.path.join(ART, "player", "player.json"), "w") as f:
        json.dump(pdata, f, indent=1)
        f.write("\n")
    spent, _ = player_sheet(player_animations(charged=False))
    save(spent, "player/player-spent.png", scale=0)
    save(anims["idle"][0][0], "player/player-idle.png", scale=0)
    extra = {"cog": cog_frames(), "spring": spring_frames(), "beacon": beacon_frames(), "enemy": enemy_frames()}
    about = {
        "cog": ("The collectible: a brass cog, spinning. Loops.", 80, True),
        "spring": ("Spring pad: 0 at rest, 1 pressed, 2 thrown. Frames are picked by the game.", 0, False),
        "beacon": ("Checkpoint beacon: 0 off; 1 and 2 on, blinking.", 300, True),
        "enemy": ("Scrap beetle, idle. Loops.", 180, True),
    }
    props_row = []
    for name, frames in extra.items():
        text, ms, loop = about[name]
        save(strip(frames), f"props/{name}.png", scale=0)
        with open(os.path.join(ART, "props", f"{name}.json"), "w") as f:
            json.dump(frames_json(name, frames, ms, loop, text), f, indent=1)
            f.write("\n")
        props_row.append(strip(frames, 3))
    shown = Canvas(max(r.w for r in props_row) + 8, sum(r.h + 4 for r in props_row) + 4)
    y = 4
    for r in props_row:
        shown.blit(r, 4, y)
        y += r.h + 4
    save(shown, "props/props.png", scale=6, art=False)
    save(mockup(anims, extra), "mockup/mockup.png", scale=4)
    for name in ("dash", "dust", "collect"):
        p = os.path.join(ART, "fx", f"{name}.png")
        if os.path.exists(p):
            save(Image.open(p).convert("RGBA"), f"fx/{name}.png", scale=4, art=False)
    player_gif(anims, os.path.join(PREVIEWS, "player", "player-animations@3x.gif"), 3)
    comparisons(anims)
    # Not committed (large): written for a person to watch.
    parallax_gif(os.path.join(PREVIEWS, "parallax", "parallax@2x.gif"), 2)


def debug_sheet(rows, path, scale=6):
    cols = max(len(r) for r in rows)
    c = Canvas(cols * FRAME, len(rows) * FRAME, "sky2")
    for j, r in enumerate(rows):
        for i, f in enumerate(r):
            c.blit(f, i * FRAME, j * FRAME)
            for x in range(FRAME):
                if c.get(i * FRAME + x, j * FRAME + 47) is None or c.get(i * FRAME + x, j * FRAME + 47) == "sky2":
                    c.set(i * FRAME + x, j * FRAME + 47, "sky1")
    c.image().resize((c.w * scale, c.h * scale), Image.NEAREST).save(path)


if __name__ == "__main__" and len(sys.argv) == 1:
    main()

if __name__ == "__main__" and "props" in sys.argv:
    rows = [cog_frames(), spring_frames(), beacon_frames(), enemy_frames()]
    c = Canvas(160, 110, "sky2")
    y = 2
    for r in rows:
        st = strip(r, 4)
        c.blit(st, 2, y)
        y += st.h + 4
    c.image().resize((c.w * 6, c.h * 6), Image.NEAREST).save("/tmp/props.png")

if __name__ == "__main__" and "bg" in sys.argv:
    layers = [sky(), far_city(), mid_ruins(), near_jungle(), foreground()]
    out = Canvas(W, H)
    for l in layers:
        out.blit(l, 0, 0)
    out.image().resize((W * 3, H * 3), Image.NEAREST).save("/tmp/bg.png")
    for k, l in enumerate(layers):
        l.image().resize((W * 2, H * 2), Image.NEAREST).save(f"/tmp/bg{k}.png")

if __name__ == "__main__" and "tiles" in sys.argv:
    atlas, data, props = tileset()
    sh = Canvas(atlas.w, atlas.h, "sky2")
    sh.blit(atlas, 0, 0)
    sh.image().resize((sh.w * 5, sh.h * 5), Image.NEAREST).save("/tmp/tiles.png")

if __name__ == "__main__" and "debug" in sys.argv:
    j, f = air_poses()
    rows = [[draw_pose(p) for p in idle_poses()], [draw_pose(p) for p in run_poses()],
            [draw_pose(p) for p in j + f + land_poses()], [draw_pose(p) for p in dash_poses() + slide_poses()]]
    debug_sheet(rows, "/tmp/pl.png")
