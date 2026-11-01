"""Draws the platformer asset set from code: every asset from one palette.

Run from this folder: `python3 make.py` (Pillow). It writes the 1x art under
`art/`, nearest-neighbour previews under `previews/`, and the composed mockup.
Everything is a function of fixed seeds, so a run makes the same bytes.
"""

import json
import math
import os
import random

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.join(HERE, "art")
PREVIEWS = os.path.join(HERE, "previews")

# The palette: 26 colors of Endesga 32, by name, in ramps that shift hue.
PALETTE = {
    # Night ramp: the sky and every backdrop plane, dark to the haze.
    "ink": "#181425",
    "night": "#262b44",
    "dusk": "#3a4466",
    "slate": "#5a6988",
    "mist": "#8b9bb4",
    "haze": "#c0cbdc",
    "white": "#ffffff",
    # Earth ramp: the ground the player stands on, warm against the cold sky.
    "plum": "#3e2731",
    "umber": "#733e39",
    "clay": "#b86f50",
    "sand": "#e4a672",
    # Moss ramp: grass on the ground and leaves.
    "pine": "#193c3e",
    "moss": "#265c42",
    "leaf": "#3e8948",
    "lime": "#63c74d",
    # Coat ramp: the player's alone.
    "wine": "#a22633",
    "red": "#e43b44",
    "rose": "#f6757a",
    "skin": "#e8b796",
    "tan": "#c28569",
    # Glow ramp: what the player can take (the dash scarf, the fruit).
    "rust": "#be4a2f",
    "orange": "#f77622",
    "gold": "#feae34",
    "yellow": "#fee761",
    # Spent dash, the spring's coil.
    "blue": "#0099db",
    "cyan": "#2ce8f5",
    # The flag of a checkpoint and the sky's glow.
    "violet": "#68386c",
    "magenta": "#b55088",
}


def rgb(name):
    h = PALETTE[name].lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


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

    def image(self):
        img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        data = []
        for row in self.px:
            for c in row:
                data.append((0, 0, 0, 0) if c is None else rgb(c) + (255,))
        img.putdata(data)
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


def outline(c, color="ink"):
    """Adds a one-pixel outline around the shape, on its four sides only (round corners)."""
    out = c.copy()
    for y in range(c.h):
        for x in range(c.w):
            if c.px[y][x] is None and any(c.get(x + dx, y + dy) not in (None,) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                out.px[y][x] = color
    return out


def save(c, rel, scale=4, bg="dusk", art=True):
    """Writes the 1x art and an enlarged preview; previews of sprites sit on the sky's dusk."""
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


def load_sprite(path):
    """Reads a sprite source (the `ritmo-tools pixel` text format: palette, then pixels)."""
    keys, rows, section = {}, [], None
    with open(path) as f:
        for line in f:
            line = line.rstrip("\n")
            if line.startswith("#") or not line.strip():
                continue
            if line.strip() in ("palette", "pixels"):
                section = line.strip()
                continue
            if section == "palette":
                k, v = line.split()[:2]
                keys[k] = None if v == "transparent" else v.lower()
            else:
                rows.append(line)
    by_hex = {v.lower(): k for k, v in PALETTE.items()}
    c = Canvas(len(rows[0]), len(rows))
    for y, row in enumerate(rows):
        for x, k in enumerate(row):
            h = keys[k]
            if h is not None:
                assert h in by_hex, f"{path}: {h} is not in the palette"
                c.px[y][x] = by_hex[h]
    return c


def props():
    return {name: load_sprite(os.path.join(HERE, "props", f"{name}.sprite.txt"))
            for name in ("fruit", "spring", "spring-up", "checkpoint")}


# --- The game's grid ---------------------------------------------------------

W, H = 320, 180  # the screen in art pixels
TILE = 8


# --- Backdrop planes ---------------------------------------------------------
# Each plane loops over the screen's width: every wave has a whole number of
# cycles across W, so the right edge meets the left.


def wave(x, terms):
    return sum(a * math.sin(2 * math.pi * (k * x / W) + p) for a, k, p in terms)


def peaks(x, ps):
    """A ridge of pointed peaks: each (center, height, half width), wrapped."""
    best = 0
    for cx, ht, hw in ps:
        d = min(abs(x - cx), W - abs(x - cx))
        if d < hw:
            # A peak with slightly convex flanks.
            best = max(best, ht * (1 - d / hw) ** 1.15)
    return best


def sky():
    """The far sky: the night ramp from dark at the top to the haze at the horizon, stars, a moon."""
    c = Canvas(W, H)
    bands = [(0, "ink"), (34, "night"), (70, "dusk"), (112, "slate"), (136, "mist")]

    def edge_off(x):
        return round(wave(x, [(2.0, 2, 0.3), (1.0, 3, 1.7)]))

    for x in range(W):
        off = edge_off(x)
        for y in range(H):
            col = "ink"
            for edge, name in bands:
                if y >= edge + (off if edge else 0):
                    col = name
            c.px[y][x] = col
    # Each band edge is a two-row checker, so the step reads as a soft gradient.
    for i in range(1, len(bands)):
        edge, name = bands[i]
        above = bands[i - 1][1]
        for x in range(W):
            y = edge + edge_off(x)
            if x % 2 == 0:
                c.set(x, y - 1, name)
            else:
                c.set(x, y, above)
    # Stars: few, in the dark bands only; a few brighter ones are crosses.
    rng = random.Random(7)
    for _ in range(60):
        x, y = rng.randrange(W), rng.randrange(0, 64)
        if c.px[y][x] in ("ink", "night") and all(c.get(x + dx, y + dy) in ("ink", "night") for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
            c.px[y][x] = "dusk" if rng.random() < 0.6 else "slate"
    for x, y in ((40, 14), (131, 24), (212, 9), (290, 30), (166, 46)):
        c.set(x, y, "haze")
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            c.set(x + dx, y + dy, "dusk")
    # The moon, upper left: the one light every asset is shaded from.
    mx, my, r = 62, 30, 9
    for y in range(my - r, my + r + 1):
        for x in range(mx - r, mx + r + 1):
            if math.hypot(x - mx, y - my) <= r + 0.3:
                lit = math.hypot(x - mx + 3, y - my + 3) <= r + 0.5
                c.set(x, y, "haze" if lit else "mist")
    for x, y in ((59, 26), (60, 26), (59, 27), (64, 33), (65, 33), (63, 24)):
        c.set(x, y, "mist")
    return c


def ridge_plane(base, terms, ps, body, lit, snow=None, snow_shade=None, snow_line=None):
    """A mountain plane of faceted peaks: each peak's face toward the moon (left) is lit,
    split from its shaded face by a spine that wanders down from the summit."""
    c = Canvas(W, H)
    top = []
    owner = []
    for x in range(W):
        h0 = wave(x, terms)
        best, who = 0, None
        for i, (cx, ht, hw) in enumerate(ps):
            d = min(abs(x - cx), W - abs(x - cx))
            if d < hw:
                v = ht * (1 - d / hw) ** 1.15
                if v > best:
                    best, who = v, i
        top.append(round(base - h0 - best))
        owner.append(who)
    for x in range(W):
        for y in range(max(0, top[x]), H):
            c.px[y][x] = body
            i = owner[x]
            if i is None:
                continue
            cx, ht, hw = ps[i]
            summit = base - ht
            down = y - summit
            # The spine drifts right as it falls, with a few kinks.
            spine = cx + down * 0.35 + 2.5 * math.sin(down * 0.21 + i)
            dx = x - cx
            if dx > W / 2:
                dx -= W
            if dx < -W / 2:
                dx += W
            if cx + dx < spine and down < ht * 0.8:
                c.px[y][x] = lit
            if snow is not None:
                line = snow_line + round(3 * math.sin(x * 0.45 + i * 2)) + (x % 5 == 0)
                if y < line:
                    c.px[y][x] = snow if c.px[y][x] == lit else snow_shade
    return c


def far_mountains():
    ps = [(18, 58, 44), (96, 82, 54), (168, 50, 38), (240, 92, 60), (300, 46, 34)]
    return ridge_plane(150, [(3, 3, 0.4), (1.5, 7, 2.1)], ps, "slate", "mist", snow="haze", snow_shade="mist", snow_line=84)


def mid_mountains():
    ps = [(52, 50, 50), (136, 36, 40), (204, 58, 54), (276, 44, 44)]
    return ridge_plane(152, [(4, 2, 1.1), (2, 6, 0.2), (1, 11, 2.6)], ps, "dusk", "slate")


def near_forest():
    """The near backdrop: a hill of pines, darker and with more contrast than the planes behind."""
    c = Canvas(W, H)
    hill = [round(150 - wave(x, [(5, 1, 0.5), (3, 3, 2.0), (1.5, 8, 0.9)])) for x in range(W)]
    for x in range(W):
        for y in range(hill[x], H):
            c.px[y][x] = "night"
    rng = random.Random(3)
    x = 0
    trees = []
    while x < W:
        trees.append((x, rng.randint(18, 34)))
        x += rng.randint(9, 17)
    for tx, th in trees:
        base = hill[tx % W] + 2
        top = base - th
        for row in range(th):
            y = top + row
            # Tiers: the half width grows down each tier and steps back at the next.
            tier = 6
            k = row % tier
            half = (row // tier) * 1 + k * 0.7 + 1
            half = min(half, 9)
            for dx in range(-int(half), int(half) + 1):
                xx = (tx + dx) % W
                lit_side = dx < 0 and k <= 2 and abs(dx) >= int(half) - 1 and row > 2
                if 0 <= y < H:
                    c.px[y][xx] = "dusk" if lit_side else "night"
        # The trunk in shadow.
        for y in range(base - 2, base + 1):
            c.set(tx % W, y, "night")
    return c



# --- Tiles -------------------------------------------------------------------
# Terrain is one 8x8 autotile drawn per pixel from its eight neighbours: grass
# where open sky is above, a lit clay rim on the left (the moon's side), a
# shaded rim on the right and below, an ink outline on every open side, and the
# outer corners cut round.

N, NE, E, SE, S, SW, Wb, NW = 1, 2, 4, 8, 16, 32, 64, 128
DIRS = {N: (0, -1), NE: (1, -1), E: (1, 0), SE: (1, 1), S: (0, 1), SW: (-1, 1), Wb: (-1, 0), NW: (-1, -1)}

# The base texture under the rims: strata of short plum dashes on umber, in
# four variants that each loop on all four sides. Variant 0 is the quiet one.
STRATA = [
    ["........", "........", "........", "........", "........", "........", "........", "........"],
    ["........", "...ppp..", "........", "........", "........", "........", "........", "........"],
    ["........", "........", "........", "..pp....", ".pppp...", "........", "........", "........"],
    ["........", "........", "........", "........", "........", "........", "pp....pp", "........"],
]
GRASS_DRIP = [0, 1, 0, 0, 2, 1, 0, 1]  # how far grass hangs below the top, per column


def canonical(mask):
    """Corners only count when both sides beside them are solid (the 47-tile blob set)."""
    for corner, a, b in ((NE, N, E), (SE, S, E), (SW, S, Wb), (NW, N, Wb)):
        if not (mask & a and mask & b):
            mask &= ~corner
    return mask


BLOB = sorted({canonical(m) for m in range(256)})


def terrain_tile(mask, variant=0):
    solid = [[False] * 24 for _ in range(24)]
    for y in range(8, 16):
        for x in range(8, 16):
            solid[y][x] = True
    for bit, (dx, dy) in DIRS.items():
        if mask & bit:
            for y in range(8 + dy * 8, 16 + dy * 8):
                for x in range(8 + dx * 8, 16 + dx * 8):
                    solid[y][x] = True

    def empty(x, y):
        return not (0 <= x < 24 and 0 <= y < 24) or not solid[y][x]

    def run(x, y, dx, dy):
        k = 1
        while k < 6 and not empty(x + dx * k, y + dy * k):
            k += 1
        return k  # 1: the next pixel that way is open

    def depth(x, y):
        """How far the nearest open pixel is, counting diagonals (1: touching)."""
        for d in range(1, 9):
            for j in range(-d, d + 1):
                for i in range(-d, d + 1):
                    if max(abs(i), abs(j)) == d and empty(x + i, y + j):
                        return d
        return 9

    c = Canvas(8, 8)
    tex = STRATA[variant]
    for ty in range(8):
        for tx in range(8):
            x, y = tx + 8, ty + 8
            up, down, left, right = run(x, y, 0, -1), run(x, y, 0, 1), run(x, y, -1, 0), run(x, y, 1, 0)
            # Outer corners: cut the pixel where two open sides meet.
            if (up == 1 or down == 1) and (left == 1 or right == 1):
                continue
            d = depth(x, y)
            # Deep rock is dark, so the edges the player touches carry the contrast.
            if d >= 5:
                col = "umber" if tex[ty][tx] in "pc" else "plum"
            else:
                col = "umber"
            # Rims, read from the nearest open side: lit toward the moon, shaded away from it.
            if left == 2 or (up == 2 and left <= 3):
                col = "clay"
            if right == 2 or down == 2:
                col = "plum"
            if up <= 3 + GRASS_DRIP[tx]:
                col = {1: "lime", 2: "leaf", 3: "leaf"}.get(up, "moss")
                if up == 1 and (tx + ty) % 4 == 3:
                    col = "leaf"
            elif left == 1 or right == 1 or down == 1 or d == 1:
                col = "ink"
            c.px[ty][tx] = col
    return c


def platform_tiles():
    """A one-way plank: left end, middle, right end, and a post that holds it up."""
    keys = {"i": "ink", "s": "sand", "c": "clay", "u": "umber", "p": "plum"}
    left = from_rows(["........", ".iiiiiii", "issssccs", "icuuuuuu", "ipiipiii", ".i......", "........", "........"], keys)
    mid = from_rows(["........", "iiiiiiii", "sscssssc", "uuuuuuuu", "iipiiiip", "........", "........", "........"], keys)
    right = left.flipped()
    # The ends' shade side: the right end's rim is shaded, not lit.
    # The post is support, behind the play: thin and dark, so it never reads as a wall.
    post = from_rows(["...iui..", "...upi..", "...upi..", "...upi..", "...ppi..", "...upi..", "...upi..", "...upi.."], keys)
    return {"platform-left": left, "platform-mid": mid, "platform-right": right, "platform-post": post}


def spike_tiles():
    """Spikes: pale steel, lit on the moon's side, on an ink base; one drawing turned four ways."""
    keys = {"w": "white", "h": "haze", "m": "mist", "s": "slate", "i": "ink"}
    up = from_rows([
        "........",
        ".w...w..",
        ".w...w..",
        "hwm.hwm.",
        "hwm.hwm.",
        "hwmmhwmm",
        "hwmmhwmm",
        "iiiiiiii",
    ], keys)

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


def deco_tiles():
    """Decoration, drawn on its own layer over the terrain: never collides, never looks like it does."""
    keys = {"l": "lime", "f": "leaf", "m": "moss", "p": "pine", "h": "haze", "w": "white", "g": "gold",
            "i": "ink", "u": "umber", "c": "clay", "s": "sand", "v": "violet", "a": "magenta"}
    tuft = from_rows([
        "........",
        "........",
        "........",
        "...l....",
        ".l.f..l.",
        ".fl.lf.f",
        "f.ff.fff",
        "fmffmfmf",
    ], keys)
    flowers = from_rows([
        "........",
        "........",
        ".h......",
        "hwh..a..",
        ".h..ava.",
        ".f...a..",
        ".f.l.f..",
        "ff.ffmf.",
    ], keys)
    rock = from_rows([
        "........",
        "........",
        "........",
        "..iiii..",
        ".icssui.",
        "icccuupi",
        "icuuuppi",
        "iiiiiiii",
    ], keys)
    vine = from_rows([
        "mfmmffmm",
        ".f..f.m.",
        ".f..l.f.",
        ".l..f.f.",
        ".f....l.",
        ".m....f.",
        "......m.",
        "......f.",
    ], keys)
    return {"deco-tuft": tuft, "deco-flowers": flowers, "deco-rock": rock, "deco-vine": vine}


def sheet(tiles, columns, gap=0):
    rows = (len(tiles) + columns - 1) // columns
    c = Canvas(columns * (TILE + gap) - gap, rows * (TILE + gap) - gap)
    for i, t in enumerate(tiles):
        c.blit(t, (i % columns) * (TILE + gap), (i // columns) * (TILE + gap))
    return c


def tileset():
    """The atlas: the 47 terrain tiles, three more fills, then props on the last row."""
    terrain = [terrain_tile(m) for m in BLOB] + [terrain_tile(255, v) for v in (1, 2, 3)]
    props = {}
    props.update(platform_tiles())
    props.update(spike_tiles())
    props.update(deco_tiles())
    cols = 10
    names = [f"terrain-{m}" for m in BLOB] + ["terrain-255-v1", "terrain-255-v2", "terrain-255-v3"]
    tiles = terrain[:]
    # Props start on a new row.
    while len(tiles) % cols:
        tiles.append(Canvas(8, 8))
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
    return atlas, data, tiles, names, props




# --- The player --------------------------------------------------------------
# A small climber in a red hooded coat with a scarf. Frames are 16x16 with the
# feet on the bottom row; each frame is drawn as fill (head and body parts) and
# the ink outline is added around the whole shape, so every frame has the same
# outline weight. The red ramp belongs to the player alone; the scarf is the
# dash: gold while a dash is ready, blue once it is spent.

PKEYS = {"r": "red", "d": "wine", "l": "rose", "s": "skin", "t": "tan", "e": "ink",
         "y": "yellow", "g": "gold", "p": "violet", "b": "plum", "k": "ink"}

HEAD = [
    "..llrr..",
    ".lrrrrr.",
    "lrrrssss",
    "rrrseses",
    "drrsssst",
]
HEAD_BLINK = [
    "..llrr..",
    ".lrrrrr.",
    "lrrrssss",
    "rrrststs",
    "drrsssst",
]


def frame(body, head_at=(4, 4), head=HEAD, extra=()):
    """One frame: body rows from row 9 (or the row given) down, then the head over them."""
    c = Canvas(16, 16)
    start, rows = body
    for j, row in enumerate(rows):
        assert len(row) == 16, row
        for i, k in enumerate(row):
            if k != ".":
                c.px[start + j][i] = PKEYS[k]
    hx, hy = head_at
    c.blit(from_rows(head, PKEYS), hx, hy)
    for x, y, k in extra:
        c.px[y][x] = PKEYS[k]
    # The fill keeps a pixel clear of the frame's edge, so the outline is never cut off.
    for y in range(16):
        for x in range(16):
            if c.px[y][x] is not None:
                assert 0 < x < 15 and 0 < y < 15, ("fill touches the frame edge", x, y)
    return outline(c)


def player_animations():
    idle_body = [
        ".....gyyyyy.....",
        "....g.lrrrrs....",
        "....g.lrrrrd....",
        ".....lrrrrrdd...",
        "......pp..pp....",
        "......bb..bb....",
    ]
    idle_body_b = [
        ".....gyyyyy.....",
        ".....glrrrrs....",
        "....g.lrrrrd....",
        ".....lrrrrrdd...",
        "......pp..pp....",
        "......bb..bb....",
    ]
    # Breathing: the head and coat sink a pixel, the legs stay.
    idle_dip = [
        ".....gyyyyy.....",
        "....g.lrrrrs....",
        "....glrrrrrdd...",
        "......pp..pp....",
        "......bb..bb....",
    ]
    idle = [
        frame((9, idle_body)),
        frame((9, idle_body_b)),
        frame((10, idle_dip), head_at=(4, 5)),
        frame((10, idle_dip), head_at=(4, 5), head=HEAD_BLINK),
    ]

    # Running: the body leans a pixel forward; a stride, a bent step, and a
    # passing pose, twice, with the scarf streaming behind.
    run_stride = [
        "..ggyyyyyy......",
        ".g...lrrrrrs....",
        ".....lrrrrrd....",
        "......lrrrrdd...",
        ".....pp...pp....",
        "....bb.....bb...",
    ]
    run_bent = [
        "...gggyyyyyy....",
        "..g...lrrrrrs...",
        "......lrrrrrdd..",
        ".......pp.pp....",
        "......bb..bb....",
    ]
    run_pass = [
        ".g.ggyyyyyy.....",
        "..g..lrrrrrd....",
        ".....slrrrrd....",
        "......lrrrrdd...",
        "........ppb.....",
        ".......bb.......",
    ]
    run = [
        frame((9, run_stride), head_at=(5, 4)),
        frame((10, run_bent), head_at=(6, 5)),
        frame((8, run_pass), head_at=(5, 3)),
        frame((9, run_stride), head_at=(5, 4)),
        frame((10, run_bent), head_at=(6, 5)),
        frame((8, run_pass), head_at=(5, 3)),
    ]

    # In the air: rising, the legs tuck and the scarf hangs below; falling, the
    # legs reach down and the scarf lifts.
    rise = [
        "....gyyyyyys....",
        "...g.lrrrrrr....",
        "...g.lrrrrrd....",
        "..g..lrrrrdd....",
        ".....pp.pp......",
        ".....bb..bb.....",
    ]
    fall_a = [
        ".gg..gyyyyy.s...",
        "...gg.lrrrrr....",
        "......lrrrrd....",
        ".....lrrrrrdd...",
        ".....pp...pp....",
        ".....bb....bb...",
    ]
    fall_b = [
        "..gg.gyyyyy.s...",
        ".g..g.lrrrrr....",
        "......lrrrrd....",
        ".....lrrrrrdd...",
        ".....pp...pp....",
        ".....bb....bb...",
    ]
    jump = [
        frame((8, rise), head_at=(4, 3)),
        frame((8, rise), head_at=(4, 3), extra=[(2, 12, "g")]),
    ]
    fall = [
        frame((9, fall_a), head_at=(4, 4)),
        frame((9, fall_b), head_at=(4, 4)),
    ]

    # Dashing: stretched flat along the dash, the head out front, the legs and the
    # scarf straight behind.
    dash_a = [
        ".ggyyyy.........",
        "....yglrrr......",
        ".bpp.lrrrrd.....",
        "......dddd......",
    ]
    dash_b = [
        "..gyyyy.........",
        ".g..yglrrr......",
        ".bpp.lrrrrd.....",
        "......dddd......",
    ]
    dash = [
        frame((7, dash_a), head_at=(7, 4)),
        frame((7, dash_b), head_at=(7, 4)),
    ]

    # Sliding down a wall on the right: a hand up on the wall, a knee against
    # it, the scarf lifted by the slide.
    slide_a = [
        "..g..gyyyyy.....",
        "...g.lrrrrr.....",
        ".....lrrrrrs....",
        ".....lrrrrdd....",
        "......pp.ppb....",
        "......bb........",
    ]
    slide_b = [
        ".g...gyyyyy.....",
        "..gg.lrrrrr.....",
        ".....lrrrrrs....",
        ".....lrrrrdd....",
        "......pp.ppb....",
        "......bb........",
    ]
    wall_hand = [(12, 6, "s"), (12, 7, "r")]
    slide = [
        frame((9, slide_a), head_at=(4, 4), extra=wall_hand),
        frame((9, slide_b), head_at=(4, 4), extra=wall_hand),
    ]

    # Landing: one squashed frame, wider as it flattens.
    land_body = [
        "....ggyyyyyy....",
        "...g.lrrrrrrs...",
        "....lrrrrrrrdd..",
        ".....pp....pp...",
        ".....bb....bb...",
    ]
    land = [frame((10, land_body), head_at=(4, 6))]

    return {
        "idle": (idle, 220, True),
        "run": (run, 70, True),
        "jump": (jump, 90, True),
        "fall": (fall, 90, True),
        "dash": (dash, 60, True),
        "wall-slide": (slide, 120, True),
        "land": (land, 80, False),
    }


SPENT = {"yellow": "cyan", "gold": "blue"}


def recolor(c, swap):
    out = c.copy()
    out.px = [[swap.get(k, k) for k in row] for row in c.px]
    return out


def player_sheet(anims, swap=None):
    """Every animation on one row of its own; JSON in the hash format Pixi, Phaser, and Aseprite read."""
    cols = max(len(f) for f, _, _ in anims.values())
    c = Canvas(cols * 16, len(anims) * 16)
    frames, tags, by_name = {}, [], {}
    n = 0
    for row, (name, (fs, ms, loop)) in enumerate(anims.items()):
        names = []
        for i, f in enumerate(fs):
            c.blit(recolor(f, swap) if swap else f, i * 16, row * 16)
            key = f"{name} {i}"
            frames[key] = {"frame": {"x": i * 16, "y": row * 16, "w": 16, "h": 16}, "duration": ms,
                           "anchor": {"x": 0.5, "y": 1}}
            names.append(key)
        tags.append({"name": name, "from": n, "to": n + len(fs) - 1, "direction": "forward"})
        by_name[name] = {"frames": names, "msPerFrame": ms, "loop": loop}
        n += len(fs)
    data = {"frames": frames, "animations": {k: v["frames"] for k, v in by_name.items()},
            "timing": by_name,
            "meta": {"size": {"w": c.w, "h": c.h}, "frameSize": {"w": 16, "h": 16}, "scale": "1",
                     "about": "Feet on the bottom row; the anchor is the middle of the feet. Hitbox 8x12 from x 4..11, y 4..15. Faces right; flip for left.",
                     "frameTags": tags}}
    return c, data


# --- The mockup room ---------------------------------------------------------

LEVEL = [
    "#######...........................######",
    "#####.............................######",
    "####...............................#####",
    "###................................#####",
    "##..................................####",
    "##..................................####",
    "#...................................####",
    "#...................................####",
    "#..................................#####",
    "#..................................#####",
    "#..................................#####",
    "##.................................#####",
    "##........------...................#####",
    "###........|..|....................#####",
    "###........|..|...................######",
    "####.......|..|...................######",
    "####.......|..|........^^^^.......######",
    "#####......|..|.....###########...######",
    "##########.|..|.....###########...######",
    "##########.|..|.....###########...######",
    "##########.|..|^^^^^###########...######",
    "########################################",
    "########################################",
]


def solid_at(level, x, y):
    if y < 0 or y >= len(level) or x < 0 or x >= len(level[0]):
        return True  # the room's border counts as rock, so no outline runs along the screen's edge
    return level[y][x] == "#"


def compose_terrain(level, tiles_by_mask):
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
                variant = (0, 0, 0, 0, 1, 2, 3)[h]  # a detail on about half the fill tiles
            c.blit(tiles_by_mask[(mask, variant)], x * TILE, y * TILE)
    return c


def foreground():
    """In front of the play: grass at the bottom edge and pine boughs hanging from the top,
    flat ink silhouettes with no detail, kept to the margins the player cannot reach."""
    c = Canvas(W, H)
    rng = random.Random(11)
    # Grass: clumps of blades leaning a little, loop-safe (blades wrap at the edges).
    x = 0
    while x < W:
        clump = rng.randint(4, 8)
        tall = rng.randint(6, 12)
        for b in range(clump):
            bx = x + b * 2 + rng.randint(0, 1)
            h = max(4, tall - abs(b - clump // 2) * 3 + rng.randint(-1, 1))
            lean = rng.choice((-1, 1)) * rng.randint(0, 3)
            for k in range(h):
                xx = (bx + round(lean * (k / h) ** 2)) % W
                c.set(xx, H - 1 - k, "ink")
                if k < h // 2:
                    c.set((xx + 1) % W, H - 1 - k, "ink")
        x += clump * 2 + rng.randint(0, 8)
    for xx in range(W):
        for y in range(H - 4, H):
            c.set(xx, y, "ink")

    def bough(x0, x1, y0, y1):
        n = x1 - x0
        for i in range(n + 1):
            bx = (x0 + i) % W
            by = round(y0 + (y1 - y0) * i / n)
            c.set(bx, by, "ink")
            if i < n // 2:
                c.set(bx, by - 1, "ink")  # thicker toward the trunk
            # A sprig hangs every few pixels: a short stepped wedge of needles.
            if i % 7 == 3:
                length = 6 + (i * 7) % 5
                for k in range(length):
                    half = max(0, (length - k) // 3)
                    for dx in range(-half, half + 1):
                        c.set((bx + dx) % W, by + 1 + k, "ink")
        for y in range(0, min(y0, y1)):
            c.set(x0 % W, y, "ink")
            c.set((x0 + 1) % W, y, "ink")

    bough(0, 60, 0, 9)
    bough(14, 40, 3, 13)
    bough(268, 330, 2, 7)
    return c


def fx_frame(name, i):
    """One frame of an effect, read back from the sheet `ritmo-tools fx render` wrote."""
    with open(os.path.join(ART, "fx", f"{name}.json")) as f:
        data = json.load(f)
    fr = data["frames"][f"{name} {i}"]["frame"]
    img = Image.open(os.path.join(ART, "fx", f"{name}.png")).convert("RGBA")
    return img.crop((fr["x"], fr["y"], fr["x"] + fr["w"], fr["y"] + fr["h"]))


def room_layer():
    """The play layer of the mockup room: terrain by autotile, then props and decoration."""
    tiles_by_mask = {(m, 0): terrain_tile(m) for m in BLOB}
    for v in (1, 2, 3):
        tiles_by_mask[(255, v)] = terrain_tile(255, v)
    room = compose_terrain(LEVEL, tiles_by_mask)
    _, _, _, _, tp = tileset()
    for y, row in enumerate(LEVEL):
        for x, k in enumerate(row):
            if k == "^":
                room.blit(tp["spikes-up"], x * 8, y * 8)
            if k == "-":
                left = row[x - 1] != "-"
                right = x + 1 < len(row) and row[x + 1] != "-"
                room.blit(tp["platform-left" if left else "platform-right" if right else "platform-mid"], x * 8, y * 8)
            if k == "|":
                room.blit(tp["platform-post"], x * 8, y * 8)
    for name, cells in {
        "deco-tuft": [(5, 17), (9, 17), (2, 12), (29, 16), (10, 20)],
        "deco-flowers": [(8, 17), (30, 16), (4, 16)],
        "deco-rock": [(21, 16), (33, 20)],
        "deco-vine": [(5, 1), (3, 3), (34, 2), (35, 4)],
    }.items():
        for cx, cy in cells:
            # Decoration sits in an open cell, on the ground (or under a ceiling, for vines).
            assert LEVEL[cy][cx] == ".", (name, cx, cy)
            assert LEVEL[cy - 1 if name == "deco-vine" else cy + 1][cx] == "#", (name, cx, cy)
            room.blit(tp[name], cx * 8, cy * 8)
    p = props()
    room.blit(p["checkpoint"], 7 * 8, 18 * 8 - 16)
    room.blit(p["spring"], 32 * 8, 21 * 8 - 8)
    room.blit(p["fruit"], 19 * 8 + 1, 8 * 8)
    return room


def layers_at(camera, layers, fg):
    """The whole screen for a camera x: each plane offset by its own parallax, rounded alone."""
    out = Image.new("RGBA", (W, H))
    for (img, factor) in layers:
        off = round(camera * factor) % W
        for k in (0, 1):
            out.alpha_composite(img, (-off + k * W, 0))
    return out


PARALLAX = [("bg-0-sky.png", 0.0), ("bg-1-far.png", 0.1), ("bg-2-mid.png", 0.25), ("bg-3-near.png", 0.5)]


def mockup(anims):
    imgs = [(Image.open(os.path.join(ART, "backdrop", n)).convert("RGBA"), f) for n, f in PARALLAX]
    fg = Image.open(os.path.join(ART, "foreground", "fg-grass-boughs.png")).convert("RGBA")
    scene = layers_at(0, imgs, fg)
    scene.alpha_composite(room_layer().image())
    # The player mid-dash over the pit, the scarf already spent: the burst where the dash
    # began, and two afterimages between (an engine effect: the frame's silhouette, tinted).
    px, py = 150, 82
    scene.alpha_composite(fx_frame("dash", 2), (px - 26 - 14, py + 9 - 14))
    dash = recolor(anims["dash"][0][0], SPENT)
    for k, tint in ((2, "dusk"), (1, "slate")):
        ghost = dash.copy()
        ghost.px = [[None if c is None else tint for c in row] for row in dash.px]
        scene.alpha_composite(ghost.image(), (px - 9 * k, py))
    scene.alpha_composite(dash.image(), (px, py))
    scene.alpha_composite(fg)
    return scene


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


def player_gif(anims, path, scale):
    """Every animation playing side by side on its own clock: idle, run, jump, fall, dash, wall slide, land."""
    tile_top = terrain_tile(canonical(E | Wb | S | SE | SW))
    wall = terrain_tile(canonical(N | S | E | NE | SE))
    order = ["idle", "run", "jump", "fall", "dash", "wall-slide", "land"]
    cw, ch = 24, 32
    step, total = 10, 1760
    frames = []
    for t in range(0, total, step):
        c = Canvas(cw * len(order), ch, "dusk")
        for i, name in enumerate(order):
            fs, ms, loop = anims[name]
            k = (t // ms) % len(fs) if loop else min(len(fs) - 1, t // ms)
            x0 = i * cw
            if name == "wall-slide":
                for y in range(0, ch, 8):
                    c.blit(wall, x0 + 18, y)
            elif name not in ("jump", "fall", "dash"):
                for x in range(0, cw, 8):
                    c.blit(tile_top, x0 + x, 24)
            y = 8 if name not in ("jump", "fall", "dash", "wall-slide") else 6
            c.blit(fs[k], x0 + 4, y)
        frames.append(c.image())
    save_gif(frames, [step] * len(frames), path, scale)


def parallax_gif(path, scale):
    """The planes scrolling under a camera that pans one screen to the right and back."""
    imgs = [(Image.open(os.path.join(ART, "backdrop", n)).convert("RGBA"), f) for n, f in PARALLAX]
    fg = Image.open(os.path.join(ART, "foreground", "fg-grass-boughs.png")).convert("RGBA")
    frames = []
    for i in range(96):
        cam = round(W * (1 - math.cos(math.pi * 2 * i / 96)) / 2)
        img = layers_at(cam, imgs, fg)
        off = round(cam * 1.25) % W
        for k in (0, 1):
            img.alpha_composite(fg, (-off + k * W, 0))
        frames.append(img)
    save_gif(frames, [40] * len(frames), path, scale)


def preview_strip(layers, scale=4):
    """The planes stacked once, at the screen's size: what the backdrop looks like still."""
    out = Canvas(W, H)
    for layer in layers:
        out.blit(layer, 0, 0)
    return out


def main():
    os.makedirs(ART, exist_ok=True)
    os.makedirs(PREVIEWS, exist_ok=True)
    # The palette as a file, and the project's rules for `ritmo-tools pixel` (lint, render, fx).
    with open(os.path.join(HERE, "palette.hex"), "w") as f:
        f.write("".join(v.lstrip("#") + "\n" for v in PALETTE.values()))
    with open(os.path.join(HERE, "pixel.config.json"), "w") as f:
        json.dump({"palette": "palette.hex", "maxColors": 16}, f, indent=2)
        f.write("\n")
    layers = {
        "bg-0-sky.png": sky(),
        "bg-1-far.png": far_mountains(),
        "bg-2-mid.png": mid_mountains(),
        "bg-3-near.png": near_forest(),
    }
    save(foreground(), "foreground/fg-grass-boughs.png")
    for name, layer in layers.items():
        save(layer, "backdrop/" + name)
    save(preview_strip(list(layers.values())), "backdrop/backdrop-stacked.png")
    atlas, data, *_ = tileset()
    save(atlas, "tiles/tileset.png", scale=8)
    with open(os.path.join(ART, "tiles/tileset.json"), "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    anims = player_animations()
    psheet, pdata = player_sheet(anims)
    save(psheet, "player/player.png", scale=8)
    pdata["meta"]["image"] = "player.png"
    with open(os.path.join(ART, "player/player.json"), "w") as f:
        json.dump(pdata, f, indent=1)
        f.write("\n")
    save(anims["idle"][0][0], "player/player-idle.png", scale=8)
    spent, _ = player_sheet(anims, SPENT)
    save(spent, "player/player-spent.png", scale=8)
    # The effects are drawn by `ritmo-tools fx render` (see the spec); the mockup reads its sheets.
    save(mockup(anims), "mockup/mockup.png")
    player_gif(anims, os.path.join(PREVIEWS, "player/player-animations@4x.gif"), 4)
    # Previews of what other tools drew: the props (`pixel render`) and the effects (`fx render`).
    p = props()
    row = Canvas(sum(c.w for c in p.values()) + 4 * (len(p) + 1), 20)
    x = 4
    for c in p.values():
        row.blit(c, x, 18 - c.h)
        x += c.w + 4
    save(row, "props/props.png", scale=8, art=False)
    for name in ("dash", "dust", "collect"):
        save(Image.open(os.path.join(ART, "fx", f"{name}.png")).convert("RGBA"), f"fx/{name}.png", scale=4, art=False)
    # Not committed (about 0.6 MB): written for a person to watch.
    parallax_gif(os.path.join(PREVIEWS, "parallax/parallax@2x.gif"), 2)


if __name__ == "__main__":
    main()
