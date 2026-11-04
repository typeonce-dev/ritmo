/**
 * Checks pixel art against a project's rules: its size, its palette, how
 * many colors it uses, half-transparent pixels, stray pixels, colors too
 * close to tell apart, and for a tile, edges that do not meet. Each issue says what is wrong, where, and how
 * bad: errors break the rules, warnings are worth a look.
 */
import { pack, toHex, toOklab, type Rgb } from "./color.ts"
import { TRANSPARENT, type PixelArt } from "./fix.ts"

/** Which way a tile repeats: `x` side by side (a wall's run), `y` one over another, `both` to fill an area. */
export type TileAxis = "both" | "x" | "y"

export interface LintRules {
  /** The only colors allowed. */
  readonly palette?: ReadonlyArray<Rgb> | undefined
  /** The sizes allowed. */
  readonly sizes?: ReadonlyArray<{ readonly width: number; readonly height: number }> | undefined
  readonly maxColors?: number | undefined
  /** The picture's background must be transparent: a sprite, not a scene (judged by its corners and border). */
  readonly transparentBackground?: boolean | undefined
  /** The picture is a tile that repeats this way: its edges must meet. */
  readonly tile?: TileAxis | undefined
}

export type Severity = "error" | "warning"

export interface Issue {
  readonly rule:
    | "size"
    | "off-palette"
    | "too-many-colors"
    | "partial-alpha"
    | "opaque-background"
    | "stray-pixel"
    | "near-duplicate-colors"
    | "seam"
    // Animation sheets (see `reportOfSheet`).
    | "one-frame"
    | "empty-frame"
    | "frame-scale"
  readonly severity: Severity
  readonly message: string
  /** How many pixels the issue covers. */
  readonly count: number
  /** Some of the pixels, as [x, y]: the first 20. */
  readonly at: ReadonlyArray<readonly [number, number]>
}

/** Colors closer than this (OKLab) look the same: in pixel art they are noise or anti-aliasing. */
const NEAR_DUPLICATE = 0.03
const SHOWN = 20
/** The mean color change (OKLab) across a wrap below which no line shows. */
const SEAM_VISIBLE = 0.01
/** How many times stronger than the tile's other edges a wrap must be to read as a seam. */
const SEAM_STRENGTH = 1.5
/** What a transparent pixel beside an opaque one counts as, in OKLab. */
const SEAM_ALPHA = 0.5
/** The share of a wrap's positions another step must undo to be the same shape's other side (specks over a shape spoil some). */
const SEAM_SAME_SHAPE = 0.5

/**
 * The positions along a tile's wrap where it breaks, or undefined when it
 * loops. The wrap is the step from its last line (column or row) back to its
 * first, and it breaks when that step changes the color more than the lines
 * do on average and more than the two steps on either side of it (a mortar
 * line along the edge changes as much beside the wrap). A shape that touches
 * the edge is not a break either: another step inside the tile undoes the
 * wrap's, on the same positions, so the shape has its other side.
 *
 * Measured on known tiles, this flagged none of 52 that loop and 11 of 20 that
 * do not; what it misses is soft, and the eye finds it in `previewTile`.
 */
const seamAlong = (lines: number, along: number, cell: (line: number, at: number) => number, change: (a: number, b: number) => number): Array<number> | undefined => {
  if (lines < 5) return undefined
  const steps = Array.from({ length: lines }, (_, line) => {
    let sum = 0
    for (let at = 0; at < along; at++) sum += change(cell(line, at), cell((line + 1) % lines, at))
    return sum / along
  })
  const wrap = steps[lines - 1]!
  const inside = steps.slice(0, -1)
  const mean = inside.reduce((sum, step) => sum + step, 0) / inside.length
  const beside = Math.max(inside[0]!, inside[1]!, inside[lines - 2]!, inside[lines - 3]!)
  if (wrap <= SEAM_VISIBLE || wrap <= SEAM_STRENGTH * mean || wrap <= SEAM_STRENGTH * beside) return undefined
  const breaks = Array.from({ length: along }, (_, at) => at).filter((at) => cell(lines - 1, at) !== cell(0, at))
  const otherSide = inside.some((_, line) => breaks.filter((at) => cell(line, at) === cell(0, at) && cell(line + 1, at) === cell(lines - 1, at)).length >= SEAM_SAME_SHAPE * breaks.length)
  return otherSide ? undefined : breaks
}

/** `partial`: how many half-transparent pixels the picture had before it became pixel art (see `artOfImage`). */
export const lintArt = (art: PixelArt, rules: LintRules = {}, partial = 0): Array<Issue> => {
  const issues: Array<Issue> = []
  const { width, height, indices } = art
  const xy = (i: number): readonly [number, number] => [i % width, Math.floor(i / width)]

  if (rules.sizes !== undefined && rules.sizes.length > 0 && !rules.sizes.some((size) => size.width === width && size.height === height)) {
    issues.push({
      rule: "size",
      severity: "error",
      message: `${width}×${height} is not an allowed size (${rules.sizes.map((size) => `${size.width}×${size.height}`).join(", ")})`,
      count: width * height,
      at: []
    })
  }

  const counts = new Map<number, number>()
  for (const index of indices) if (index !== TRANSPARENT) counts.set(index, (counts.get(index) ?? 0) + 1)
  const used = [...counts.keys()]

  if (rules.palette !== undefined && rules.palette.length > 0) {
    const allowed = new Set(rules.palette.map((color) => pack(color.r, color.g, color.b)))
    const off = new Set(used.filter((index) => {
      const color = art.palette[index]!
      return !allowed.has(pack(color.r, color.g, color.b))
    }))
    if (off.size > 0) {
      const cells: Array<number> = []
      indices.forEach((index, i) => {
        if (off.has(index)) cells.push(i)
      })
      issues.push({
        rule: "off-palette",
        severity: "error",
        message: `${off.size} color${off.size === 1 ? "" : "s"} outside the palette (${[...off].slice(0, 8).map((index) => toHex(art.palette[index]!)).join(", ")}${off.size > 8 ? ", …" : ""}) on ${cells.length} pixels`,
        count: cells.length,
        at: cells.slice(0, SHOWN).map(xy)
      })
    }
  }

  if (rules.maxColors !== undefined && used.length > rules.maxColors) {
    issues.push({
      rule: "too-many-colors",
      severity: "error",
      message: `${used.length} colors, more than the ${rules.maxColors} allowed`,
      count: used.length,
      at: []
    })
  }

  if (partial > 0) {
    issues.push({
      rule: "partial-alpha",
      severity: "error",
      message: `${partial} half-transparent pixel${partial === 1 ? "" : "s"}: pixel art is fully opaque or fully transparent`,
      count: partial,
      at: []
    })
  }

  if (rules.transparentBackground === true && width > 0 && height > 0) {
    const border: Array<number> = []
    for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x)
    for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1)
    const opaque = border.filter((i) => indices[i] !== TRANSPARENT)
    // A sprite may touch its edges; a background left in fills the corners too.
    const corners = [0, width - 1, (height - 1) * width, height * width - 1].filter((i) => indices[i] !== TRANSPARENT).length
    if (corners >= 3 && opaque.length > border.length / 2) {
      issues.push({
        rule: "opaque-background",
        severity: "error",
        message: `${opaque.length} of ${border.length} border pixels are opaque: the background was not removed`,
        count: opaque.length,
        at: opaque.slice(0, SHOWN).map(xy)
      })
    }
  }

  // A stray pixel: none of its four neighbours shares its color, while five or more of its eight share another.
  const strays: Array<number> = []
  const at = (x: number, y: number): number | undefined => (x < 0 || y < 0 || x >= width || y >= height ? undefined : indices[y * width + x])
  const around = new Map<number, number>()
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const self = indices[y * width + x]!
      if (self === TRANSPARENT) continue
      if (at(x - 1, y) === self || at(x + 1, y) === self || at(x, y - 1) === self || at(x, y + 1) === self) continue
      around.clear()
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const value = dx === 0 && dy === 0 ? undefined : at(x + dx, y + dy)
          if (value !== undefined && value !== self) around.set(value, (around.get(value) ?? 0) + 1)
        }
      }
      if ([...around.values()].some((count) => count >= 5)) strays.push(y * width + x)
    }
  }
  if (strays.length > 0) {
    issues.push({
      rule: "stray-pixel",
      severity: "warning",
      message: `${strays.length} lone pixel${strays.length === 1 ? "" : "s"} surrounded by another color: noise, unless it is a deliberate highlight`,
      count: strays.length,
      at: strays.slice(0, SHOWN).map(xy)
    })
  }

  if (rules.tile !== undefined) {
    const palette = art.palette.map(toOklab)
    const change = (a: number, b: number): number => {
      if (a === b) return 0
      if (a === TRANSPARENT || b === TRANSPARENT) return SEAM_ALPHA
      const p = palette[a]!
      const q = palette[b]!
      return Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b)
    }
    const rows = rules.tile === "y" ? undefined : seamAlong(width, height, (x, y) => indices[y * width + x]!, change)
    if (rows !== undefined) {
      issues.push({
        rule: "seam",
        severity: "warning",
        message: `The left and right edges do not meet (${rows.length} of ${height} rows change there): repeated, the art breaks every ${width} pixels. Draw each edge to continue into the other, and judge the repeat with \`pixel preview --tile\``,
        count: rows.length,
        at: rows.slice(0, SHOWN).map((y) => [width - 1, y] as const)
      })
    }
    const columns = rules.tile === "x" ? undefined : seamAlong(height, width, (y, x) => indices[y * width + x]!, change)
    if (columns !== undefined) {
      issues.push({
        rule: "seam",
        severity: "warning",
        message: `The top and bottom edges do not meet (${columns.length} of ${width} columns change there): repeated, the art breaks every ${height} pixels. Draw each edge to continue into the other, and judge the repeat with \`pixel preview --tile\``,
        count: columns.length,
        at: columns.slice(0, SHOWN).map((x) => [x, height - 1] as const)
      })
    }
  }

  const labs = used.map((index) => ({ index, lab: toOklab(art.palette[index]!) }))
  const pairs: Array<string> = []
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      const a = labs[i]!
      const b = labs[j]!
      if (Math.hypot(a.lab.l - b.lab.l, a.lab.a - b.lab.a, a.lab.b - b.lab.b) < NEAR_DUPLICATE) {
        pairs.push(`${toHex(art.palette[a.index]!)}/${toHex(art.palette[b.index]!)}`)
      }
    }
  }
  if (pairs.length > 0) {
    issues.push({
      rule: "near-duplicate-colors",
      severity: "warning",
      message: `${pairs.length} pair${pairs.length === 1 ? "" : "s"} of colors too close to tell apart (${pairs.slice(0, 6).join(", ")}${pairs.length > 6 ? ", …" : ""}): merge them`,
      count: pairs.length,
      at: []
    })
  }
  return issues
}
