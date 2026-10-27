/**
 * Checks pixel art against a project's rules: its size, its palette, how
 * many colors it uses, half-transparent pixels, stray pixels, and colors
 * too close to tell apart. Each issue says what is wrong, where, and how
 * bad: errors break the rules, warnings are worth a look.
 */
import { pack, toHex, toOklab, type Rgb } from "./color.ts"
import { TRANSPARENT, type PixelArt } from "./fix.ts"

export interface LintRules {
  /** The only colors allowed. */
  readonly palette?: ReadonlyArray<Rgb> | undefined
  /** The sizes allowed. */
  readonly sizes?: ReadonlyArray<{ readonly width: number; readonly height: number }> | undefined
  readonly maxColors?: number | undefined
  /** The picture's border must be transparent: a sprite, not a scene. */
  readonly transparentBackground?: boolean | undefined
}

export type Severity = "error" | "warning"

export interface Issue {
  readonly rule: "size" | "off-palette" | "too-many-colors" | "partial-alpha" | "opaque-background" | "stray-pixel" | "near-duplicate-colors"
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
    if (opaque.length > border.length / 2) {
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
