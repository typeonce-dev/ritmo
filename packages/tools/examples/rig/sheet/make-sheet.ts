/**
 * Paints `character.png`: a "character parts sheet" for Borri, a stocky
 * dwarf with a ginger braided beard, a steel helm, and a bearded axe, seen
 * from the side and facing right. It stands in for what an image generator
 * gives when asked for a character's parts drawn apart on a plain
 * background: each part whole (a thigh drawn up to the hip, though the
 * torso covers that end), the far-side limbs drawn the same as the near
 * ones, nothing labelled. `ritmo-tools rig parts` cuts it.
 *
 *   node --import tsx packages/tools/examples/rig/sheet/make-sheet.ts
 *
 * The look is painted rather than flat: every shape is a signed distance
 * field, shaded as a soft bulge lit from the upper left, with a cool rim
 * light from behind, a darker outline, and a little brush texture from a
 * hashed noise. Same code, same pixels: no randomness, no clock.
 */
import { writeFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import { encodePng } from "@typeonce/ritmo-tools/pixel/cli/png.ts"
import type { RgbaImage } from "@typeonce/ritmo-tools/pixel/core/grid.ts"

// ---------------------------------------------------------------------------
// Shapes: signed distance fields, negative inside, in pixels.

type Sdf = (x: number, y: number) => number
type P = readonly [number, number]

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

const circle =
  (cx: number, cy: number, r: number): Sdf =>
  (x, y) =>
    Math.hypot(x - cx, y - cy) - r

/** An ellipse turned `angle` degrees (an approximate distance, close enough to shade by). */
const ellipse = (cx: number, cy: number, rx: number, ry: number, angle = 0): Sdf => {
  const c = Math.cos((angle * Math.PI) / 180)
  const s = Math.sin((angle * Math.PI) / 180)
  return (x, y) => {
    const qx = (x - cx) * c + (y - cy) * s
    const qy = -(x - cx) * s + (y - cy) * c
    return (Math.hypot(qx / rx, qy / ry) - 1) * Math.min(rx, ry)
  }
}

/** A capsule from `a` to `b`, its radius tapering from `ra` to `rb`. */
const capsule =
  ([ax, ay]: P, [bx, by]: P, ra: number, rb = ra): Sdf =>
  (x, y) => {
    const ex = bx - ax
    const ey = by - ay
    const t = clamp(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey), 0, 1)
    return Math.hypot(x - ax - ex * t, y - ay - ey * t) - (ra + (rb - ra) * t)
  }

/** A polygon, its corners rounded by `round`. */
const poly =
  (points: ReadonlyArray<P>, round = 0): Sdf =>
  (x, y) => {
    let d = Infinity
    let sign = 1
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ix, iy] = points[i]!
      const [jx, jy] = points[j]!
      const ex = jx - ix
      const ey = jy - iy
      const wx = x - ix
      const wy = y - iy
      const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1)
      d = Math.min(d, Math.hypot(wx - ex * t, wy - ey * t))
      const up = y >= iy
      const down = y < jy
      const left = ex * wy > ey * wx
      if ((up && down && left) || (!up && !down && !left)) sign = -sign
    }
    return sign * d - round
  }

const union =
  (...shapes: ReadonlyArray<Sdf>): Sdf =>
  (x, y) =>
    Math.min(...shapes.map((shape) => shape(x, y)))

/** Shapes melted together where they meet, over `k` pixels: a beard's jaw into its point. */
const blend =
  (k: number, ...shapes: ReadonlyArray<Sdf>): Sdf =>
  (x, y) =>
    shapes.slice(1).reduce((a, shape) => {
      const b = shape(x, y)
      const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1)
      return b + (a - b) * h - k * h * (1 - h)
    }, shapes[0]!(x, y))

/** `shape` with `cut` taken out of it. */
const minus =
  (shape: Sdf, cut: Sdf): Sdf =>
  (x, y) =>
    Math.max(shape(x, y), -cut(x, y))

/** Where both shapes are. */
const both =
  (a: Sdf, b: Sdf): Sdf =>
  (x, y) =>
    Math.max(a(x, y), b(x, y))

/** The half of the plane above `y` (screen y grows down). */
const above =
  (y0: number): Sdf =>
  (_x, y) =>
    y - y0

// ---------------------------------------------------------------------------
// Paint: how each shape is shaded.

type Rgb = readonly [number, number, number]

const hex = (color: string): Rgb => [parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255]
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k]

interface Layer {
  readonly shape: Sdf
  readonly color: Rgb
  /** How far in from the edge the bulge reaches full height: thick parts shade softly, thin ones sharply. */
  readonly depth?: number
  /** Brush texture strength: cloth and fur more, skin less. */
  readonly grain?: number
  /** The texture's stretch: wood grain runs along x, fur and hair along y. */
  readonly stretch?: readonly [number, number]
  /** A tight white highlight, for steel and brass. */
  readonly shine?: boolean
  /** Outline width; 0 for no outline (an eye's glint). */
  readonly line?: number
  /** No bulge: an eye, a seam. */
  readonly flat?: boolean
}

/** The key light, from the upper left and toward the viewer, and the rim light, from behind on the upper right. */
const LIGHT = (() => {
  const v = [-0.5, -0.65, 0.58]
  const n = Math.hypot(v[0]!, v[1]!, v[2]!)
  return [v[0]! / n, v[1]! / n, v[2]! / n] as const
})()
const RIM: P = [0.83, -0.55]
const RIM_COLOR = hex("#cfe2ff")
const SHADOW_TINT = hex("#3b2f5c")
const WARM_TINT = hex("#fff0d0")
const OUTLINE = hex("#24182a")

/** A hash of a lattice point to [0, 1): integer arithmetic only, so every machine paints the same. */
const hash = (ix: number, iy: number): number => {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise in [0, 1). */
const noise = (x: number, y: number): number => {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const top = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * sx
  const bottom = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * sx
  return top + (bottom - top) * sy
}

/** Eight directions around a point, for softening a distance field. */
const AROUND: ReadonlyArray<P> = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]]

/**
 * A shape's distance averaged over a small disk: the sharp ridges a
 * polygon's field has inside (where the nearest edge changes) melt into a
 * round hump, so a torso shades as cloth over a body, not a cut gem.
 */
const soft = (shape: Sdf, r: number, x: number, y: number): number => {
  let sum = shape(x, y)
  for (const [dx, dy] of AROUND) sum += shape(x + dx * r, y + dy * r)
  return sum / (AROUND.length + 1)
}

/** A layer's color at a point inside it, `d` its distance (negative), `fall` how far down its part the point is (0 to 1). */
const shade = (layer: Layer, x: number, y: number, d: number, fall: number): Rgb => {
  const base = layer.color
  const depth = layer.depth ?? 10
  const r = Math.min(8, depth * 0.5)
  // The outward direction of the softened field: which way the surface turns.
  const e = 0.7
  const gx = soft(layer.shape, r, x + e, y) - soft(layer.shape, r, x - e, y)
  const gy = soft(layer.shape, r, x, y + e) - soft(layer.shape, r, x, y - e)
  const g = Math.hypot(gx, gy) || 1
  const ox = gx / g
  const oy = gy / g
  // A rounded bulge: facing the viewer `depth` in from the edge, turning away toward it.
  const h = layer.flat === true ? 1 : clamp(-Math.min(d, soft(layer.shape, r, x, y)) / depth, 0, 1)
  const tilt = 1 - h
  const nx = ox * tilt
  const ny = oy * tilt
  const nz = Math.sqrt(Math.max(0, 1 - tilt * tilt))
  const lit = clamp(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2], 0, 1)
  // Shadows go cool and dark, lights warm: a painter's ramp, not a black multiply.
  const shadow = mix(scale(base, 0.42), SHADOW_TINT, 0.22)
  const light = mix(base, WARM_TINT, 0.1)
  let c = mix(shadow, light, lit * lit * (3 - 2 * lit))
  // The light also falls off down the part, as from a lamp above.
  c = scale(c, 1.08 - 0.16 * fall)
  if (layer.shine === true) {
    // Half-way between the light and the viewer.
    const hz = LIGHT[2] + 1
    const hn = Math.hypot(LIGHT[0], LIGHT[1], hz)
    const spec = clamp((nx * LIGHT[0] + ny * LIGHT[1] + nz * hz) / hn, 0, 1)
    const s2 = spec * spec
    const s8 = s2 * s2 * s2 * s2
    c = mix(c, [1, 1, 1], 0.75 * s8 * s8)
  }
  // The rim: the edge turned toward the light behind.
  const rim = (1 - nz) * (1 - nz) * clamp(ox * RIM[0] + oy * RIM[1], 0, 1)
  c = mix(c, RIM_COLOR, 0.55 * rim)
  // Brush texture: a fine grain over broader strokes.
  const grain = layer.grain ?? 0.06
  if (grain > 0) {
    const [sx, sy] = layer.stretch ?? [1, 1]
    const n = 0.6 * noise((x * 0.45) / sx, (y * 0.45) / sy) + 0.4 * noise((x * 1.3) / sx, (y * 1.3) / sy)
    c = scale(c, 1 + (n - 0.5) * 2 * grain)
  }
  // The outline: the edge darkens into a deep, slightly purple line.
  const line = layer.line ?? 1.8
  if (line > 0) {
    const t = clamp((d + line) / 1.2, 0, 1)
    c = mix(c, mix(scale(base, 0.3), OUTLINE, 0.6), t)
  }
  return c
}

// ---------------------------------------------------------------------------
// Borri's colors.

const SKIN = hex("#e2a27c")
const BEARD = hex("#c8572b")
const BEARD_LIGHT = hex("#e07a3c")
const STEEL = hex("#9aa4b4")
const STEEL_DARK = hex("#6c7586")
const BRASS = hex("#d6a443")
const TUNIC = hex("#4d6f3d")
const TUNIC_DARK = hex("#3b5530")
const LEATHER = hex("#7a4a2a")
const LEATHER_DARK = hex("#4f3020")
const FUR = hex("#9a7a58")
const TROUSERS = hex("#6b5d52")
const WOOD = hex("#94633a")
const EYE = hex("#2a1c1c")
const WHITE = hex("#fffaf0")

// ---------------------------------------------------------------------------
// The parts, each in its own box (pixels from its top left), limbs hanging
// down with the joint toward the body at the top, as the sheet shows them.

interface Part {
  readonly size: P
  readonly layers: ReadonlyArray<Layer>
}

/** In profile, facing right: a steel helm with a brass rim, a big nose, bushy brows, and a braided beard. */
const head: Part = {
  size: [100, 112],
  layers: [
    { shape: capsule([44, 74], [44, 92], 11), color: SKIN, depth: 11, grain: 0.03 },
    { shape: ellipse(30, 56, 20, 26, 10), color: BEARD, depth: 10, grain: 0.18, stretch: [0.4, 2] },
    { shape: ellipse(52, 52, 30, 32), color: SKIN, depth: 26, grain: 0.03 },
    { shape: ellipse(38, 56, 6.5, 10), color: SKIN, depth: 4, grain: 0.03 },
    { shape: ellipse(83, 59, 10, 12, -15), color: SKIN, depth: 8, grain: 0.03 },
    { shape: blend(8, ellipse(60, 70, 22, 13, 15), ellipse(72, 84, 15, 14), capsule([72, 88], [68, 100], 9, 4)), color: BEARD, depth: 16, grain: 0.22, stretch: [0.3, 2.4] },
    ...[[60, 74, 58, 88], [68, 78, 66, 94], [76, 80, 72, 96]].map(([ax, ay, bx, by]): Layer => ({ shape: capsule([ax!, ay!], [bx!, by!], 1.2, 0.6), color: scale(BEARD, 0.55), flat: true, grain: 0, line: 0 })),
    { shape: blend(3, ellipse(76, 70, 9, 4.2, 28), ellipse(69, 68, 6, 3.6, -10)), color: BEARD_LIGHT, depth: 5, grain: 0.15, stretch: [0.5, 2] },
    { shape: capsule([68, 98], [67, 108], 4.5, 3.5), color: BEARD, depth: 4, grain: 0.18, stretch: [0.4, 2] },
    { shape: capsule([67.5, 103], [67, 106], 4.2), color: BRASS, depth: 3, shine: true, grain: 0 },
    { shape: ellipse(69, 50, 3, 3.8), color: EYE, flat: true, grain: 0, line: 0.8 },
    { shape: circle(70, 48.8, 1.1), color: WHITE, flat: true, grain: 0, line: 0 },
    { shape: capsule([59, 42], [77, 43], 3.6, 2.6), color: BEARD_LIGHT, depth: 3, grain: 0.15, stretch: [2, 0.5] },
    { shape: both(ellipse(50, 38, 35, 33), above(40)), color: STEEL, depth: 30, shine: true, grain: 0.05, stretch: [3, 0.6] },
    { shape: capsule([50, 7], [50, 38], 3.2), color: STEEL_DARK, depth: 3, shine: true, grain: 0.04 },
    { shape: capsule([16, 40], [85, 40], 5), color: BRASS, depth: 4, shine: true, grain: 0.04 },
    ...[24, 40, 58, 74].map((x): Layer => ({ shape: circle(x, 40, 1.8), color: hex("#f3d68a"), depth: 2, shine: true, grain: 0, line: 0.8 }))
  ]
}

/** A barrel chest in a green tunic, a fur collar, a belt with a brass buckle, and the tunic's skirt down to the hips. */
const torso: Part = {
  size: [96, 120],
  layers: [
    // Mail under the tunic, showing below the belt: a fine, even ring texture.
    { shape: blend(6, poly([[26, 88], [78, 88], [84, 108], [20, 108]], 2), ellipse(52, 108, 32, 6)), color: STEEL_DARK, depth: 14, shine: true, grain: 0.35, stretch: [0.25, 0.25] },
    { shape: blend(10, poly([[20, 16], [70, 16], [84, 40], [82, 92], [22, 92], [14, 40]], 8), ellipse(58, 62, 28, 30)), color: TUNIC, depth: 34, grain: 0.09, stretch: [0.6, 1.6] },
    { shape: capsule([40, 30], [44, 76], 0.8), color: TUNIC_DARK, flat: true, grain: 0, line: 0 },
    { shape: capsule([28, 22], [74, 84], 4), color: LEATHER, depth: 3, grain: 0.1 },
    { shape: poly([[20, 82], [84, 80], [84, 94], [20, 96]], 2), color: LEATHER, depth: 5, grain: 0.1 },
    { shape: poly([[68, 79], [82, 78], [82, 96], [68, 97]], 2), color: BRASS, depth: 4, shine: true, grain: 0.03 },
    { shape: union(...[18, 30, 42, 54, 66, 78].map((x, i) => circle(x, 14 + (i % 2) * 2, 9))), color: FUR, depth: 9, grain: 0.3, stretch: [0.5, 1.2] }
  ]
}

/** A green sleeve under a steel shoulder plate. */
const upperArm: Part = {
  size: [44, 66],
  layers: [
    { shape: capsule([22, 16], [22, 56], 13, 10), color: TUNIC, depth: 13, grain: 0.09, stretch: [0.6, 1.6] },
    { shape: both(ellipse(22, 20, 19, 16), above(28)), color: STEEL, depth: 9, shine: true, grain: 0.05, stretch: [3, 0.6] },
    { shape: capsule([5, 27], [39, 27], 2.4), color: BRASS, depth: 2, shine: true, grain: 0 }
  ]
}

/** A bare forearm in a studded leather bracer. */
const forearm: Part = {
  size: [36, 60],
  layers: [
    { shape: capsule([18, 10], [18, 50], 10, 8), color: SKIN, depth: 8, grain: 0.04 },
    { shape: capsule([18, 26], [18, 48], 11.5, 9.5), color: LEATHER, depth: 7, grain: 0.12 },
    ...[30, 37, 44].map((y): Layer => ({ shape: circle(23, y, 1.7), color: BRASS, depth: 2, shine: true, grain: 0, line: 0.8 }))
  ]
}

/** A fist, the thumb over the knuckles. */
const hand: Part = {
  size: [34, 32],
  layers: [
    { shape: ellipse(14, 16, 11, 13), color: SKIN, depth: 11, grain: 0.04 },
    ...[7, 12.5, 18, 23.5].map((y): Layer => ({ shape: capsule([18, y], [26, y + 0.5], 3.2), color: SKIN, depth: 3.2, grain: 0.04, line: 1.2 })),
    { shape: capsule([7, 9], [21, 13], 3.6, 3), color: SKIN, depth: 3.6, grain: 0.04, line: 1.2 }
  ]
}

/** A thick thigh in grey-brown trousers. */
const thigh: Part = {
  size: [46, 74],
  layers: [{ shape: capsule([23, 20], [23, 58], 17, 13), color: TROUSERS, depth: 17, grain: 0.1, stretch: [0.6, 1.6] }]
}

/** A shin in trousers going into a boot with a folded cuff. */
const shin: Part = {
  size: [42, 70],
  layers: [
    { shape: capsule([21, 15], [21, 40], 13, 11), color: TROUSERS, depth: 13, grain: 0.1, stretch: [0.6, 1.6] },
    { shape: capsule([21, 40], [21, 56], 13, 12), color: LEATHER, depth: 13, grain: 0.1 },
    { shape: capsule([8, 37], [34, 37], 4.5), color: LEATHER_DARK, depth: 4, grain: 0.12 }
  ]
}

/** A heavy boot, the ankle at the top left, the toe pointing right. */
const foot: Part = {
  size: [62, 34],
  layers: [
    { shape: blend(6, capsule([16, 12], [16, 18], 11), ellipse(32, 22, 25, 7.5), circle(49, 21, 7.5)), color: LEATHER, depth: 11, grain: 0.1 },
    { shape: capsule([7, 28.5], [54, 28.5], 2.8), color: LEATHER_DARK, depth: 2, grain: 0.08 }
  ]
}

/** A bearded axe lying down: a wooden haft wrapped in leather, a brass pommel, and a steel head with a back spike. */
const axe: Part = {
  size: [196, 74],
  layers: [
    { shape: capsule([10, 42], [176, 42], 4.8, 4.2), color: WOOD, depth: 4, grain: 0.16, stretch: [4, 0.4] },
    ...[22, 32, 42].map((x): Layer => ({ shape: capsule([x, 36.5], [x + 4, 47.5], 2.4), color: LEATHER, depth: 2, grain: 0.1, line: 1.2 })),
    { shape: circle(8, 42, 6.5), color: BRASS, depth: 5, shine: true, grain: 0.03 },
    { shape: poly([[154, 36], [140, 42], [154, 48]], 1.5), color: STEEL_DARK, depth: 4, shine: true, grain: 0.04 },
    { shape: minus(poly([[156, 30], [178, 8], [190, 12], [193, 40], [188, 64], [176, 68], [156, 52]], 2), ellipse(168, 70, 9, 12)), color: STEEL, depth: 9, shine: true, grain: 0.05, stretch: [0.6, 3] },
    { shape: poly([[150, 30], [168, 30], [168, 54], [150, 54]], 3), color: STEEL_DARK, depth: 5, shine: true, grain: 0.04 },
    { shape: circle(159, 42, 2), color: BRASS, depth: 2, shine: true, grain: 0, line: 0.8 }
  ]
}

// ---------------------------------------------------------------------------
// The sheet: the parts apart on a plain, light background, in rows.

const BACKGROUND = hex("#efe9dd")
/** Sheet pixels per unit of the parts' own coordinates: about 300 pixels from the helm to the soles, assembled. */
const SCALE = 1.15
const MARGIN = 40
const GAP = 36

/** The sheet's rows, top to bottom, each left to right: far-side limbs are the near ones drawn again. */
const rows: ReadonlyArray<ReadonlyArray<Part>> = [
  [head, torso, axe],
  [upperArm, upperArm, forearm, forearm, hand, hand],
  [thigh, thigh, shin, shin, foot, foot]
]

const boxOf = (part: Part): P => [Math.ceil(part.size[0] * SCALE), Math.ceil(part.size[1] * SCALE)]

/** Each part's top left on the sheet, rows centred on their tallest part, and the sheet's size. */
const layout = (() => {
  const placed: Array<readonly [Part, number, number]> = []
  let top = MARGIN
  let width = 0
  for (const row of rows) {
    const tallest = Math.max(...row.map((part) => boxOf(part)[1]))
    let left = MARGIN
    for (const part of row) {
      const [w, h] = boxOf(part)
      placed.push([part, left, top + Math.floor((tallest - h) / 2)])
      left += w + GAP
    }
    width = Math.max(width, left - GAP + MARGIN)
    top += tallest + GAP
  }
  return { placed, width, height: top - GAP + MARGIN }
})()

/** Paints a part's layers, in order, over the sheet's pixels. */
const paint = (sheet: Float64Array, part: Part, left: number, top: number): void => {
  const [w, h] = boxOf(part)
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      // The pixel's middle in the part's own coordinates.
      const x = (px + 0.5) / SCALE
      const y = (py + 0.5) / SCALE
      const i = ((top + py) * layout.width + left + px) * 4
      for (const layer of part.layers) {
        const d = layer.shape(x, y)
        // Anti-aliased: a pixel half in the shape is half covered.
        const a = clamp(0.5 - d * SCALE, 0, 1)
        if (a === 0) continue
        const c = shade(layer, x, y, Math.min(d, 0), y / part.size[1])
        for (let k = 0; k < 3; k++) sheet[i + k] = sheet[i + k]! * (1 - a) + c[k]! * a
      }
    }
}

/** The sheet's pixels: every part painted on the background. */
export const paintSheet = (): RgbaImage => {
  const { width, height } = layout
  const sheet = new Float64Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    sheet[i * 4] = BACKGROUND[0]
    sheet[i * 4 + 1] = BACKGROUND[1]
    sheet[i * 4 + 2] = BACKGROUND[2]
    sheet[i * 4 + 3] = 1
  }
  for (const [part, left, top] of layout.placed) paint(sheet, part, left, top)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i++) data[i] = Math.round(clamp(sheet[i]!, 0, 1) * 255)
  return { width, height, data }
}

/** Where the script writes the sheet: next to itself. */
export const sheetFile = fileURLToPath(new URL("./character.png", import.meta.url))

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(sheetFile, encodePng(paintSheet()))
  console.log(`wrote ${sheetFile}`)
}
