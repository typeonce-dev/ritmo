/**
 * Removing the background of the fixed picture.
 *
 * Runs on the fixed pixels, not the source: after snapping, a background is
 * a few flat colors (one, or the two of a fake "transparent" checkerboard an
 * image generator painted in), with no blur to fight. The colors that cover
 * most of the picture's border are the background; it is flooded inward from
 * the border through pixels close to one of them, and stops at the outline.
 * Edits by hand (`applyEdits`) go on top: erasing or restoring one pixel or
 * one area at a time.
 */
import { toOklab, type Lab } from "./color.ts"
import { TRANSPARENT, type PixelArt } from "./fix.ts"

export interface BackgroundOptions {
  /** How far (OKLab distance, 0 to about 0.3) a pixel's color may be from a background color and still be background. */
  readonly tolerance: number
  /** Also removes background-colored areas the flood cannot reach (gaps enclosed by the sprite, but also highlights of the same color). */
  readonly enclosed: boolean
  /** Also removes specks: groups of at most `SPECK_SIZE` pixels left alone in the background. */
  readonly specks: boolean
}

export const defaultBackgroundOptions: BackgroundOptions = { tolerance: 0.08, enclosed: false, specks: true }

/** The largest group of pixels, alone in the background, that counts as a speck. */
export const SPECK_SIZE = 3

/** An edit by hand on the fixed picture: erases (makes transparent) or restores the pixel at (x, y), or its whole area of one color. */
export interface Edit {
  readonly x: number
  readonly y: number
  readonly erase: boolean
  readonly area: boolean
}

const distance = (x: Lab, y: Lab): number => Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b)

/** Border colors closer than this (OKLab) count as one color, so noise does not split a flat background into many. */
const SAME_COLOR = 0.04
/** A border color is background too when it is at least this share as common as the most common one. */
const COMMON_ENOUGH = 0.4

/**
 * The palette indices that make up the border's background: its most common
 * color, and up to two more about as common (the two tones of a fake
 * checkerboard are). A sprite touching the border covers much less of it,
 * so its colors are left out. Near-identical colors count together, under
 * the most common of them.
 * Transparent border pixels are already background and are not counted.
 */
export const backgroundColors = (art: PixelArt): Array<number> => {
  const { width, height, indices } = art
  const counts = new Map<number, number>()
  const count = (x: number, y: number): void => {
    const index = indices[y * width + x]!
    if (index === TRANSPARENT) return
    counts.set(index, (counts.get(index) ?? 0) + 1)
  }
  for (let x = 0; x < width; x++) {
    count(x, 0)
    if (height > 1) count(x, height - 1)
  }
  for (let y = 1; y < height - 1; y++) {
    count(0, y)
    if (width > 1) count(width - 1, y)
  }
  const groups: Array<{ readonly index: number; readonly lab: Lab; n: number }> = []
  for (const [index, n] of [...counts].sort((x, y) => y[1] - x[1])) {
    const lab = toOklab(art.palette[index]!)
    const group = groups.find((other) => distance(other.lab, lab) <= SAME_COLOR)
    if (group === undefined) groups.push({ index, lab, n })
    else group.n += n
  }
  groups.sort((x, y) => y.n - x.n)
  const top = groups[0]
  if (top === undefined) return []
  return groups
    .slice(0, 3)
    .filter((group) => group.n >= COMMON_ENOUGH * top.n)
    .map((group) => group.index)
}

/** The 4-connected pixels holding the same palette index as (x, y), in the picture before any is erased. */
const region = (art: PixelArt, x: number, y: number): Array<number> => {
  const { width, height, indices } = art
  const start = y * width + x
  const value = indices[start]
  const seen = new Uint8Array(width * height)
  const stack = [start]
  const out: Array<number> = []
  seen[start] = 1
  while (stack.length > 0) {
    const i = stack.pop()!
    out.push(i)
    const px = i % width
    const neighbours = [px > 0 ? i - 1 : -1, px < width - 1 ? i + 1 : -1, i - width, i + width]
    for (const n of neighbours) {
      if (n < 0 || n >= indices.length || seen[n] === 1 || indices[n] !== value) continue
      seen[n] = 1
      stack.push(n)
    }
  }
  return out
}

/**
 * Which pixels are background (1) or not (0). `colors` are the background's
 * palette indices (from `backgroundColors`).
 */
export const findBackground = (art: PixelArt, colors: ReadonlyArray<number>, options: BackgroundOptions): Uint8Array => {
  const { width, height, indices, palette } = art
  const targets = colors.map((index) => toOklab(palette[index]!))
  const like = palette.map((color) => {
    const lab = toOklab(color)
    return targets.some((target) => distance(lab, target) <= options.tolerance)
  })
  const isLike = (i: number): boolean => {
    const index = indices[i]!
    return index === TRANSPARENT || like[index] === true
  }
  const mask = new Uint8Array(width * height)
  if (targets.length > 0 || indices.includes(TRANSPARENT)) {
    if (options.enclosed) {
      for (let i = 0; i < mask.length; i++) if (isLike(i)) mask[i] = 1
    } else {
      const stack: Array<number> = []
      const seed = (i: number): void => {
        if (mask[i] === 1 || !isLike(i)) return
        mask[i] = 1
        stack.push(i)
      }
      for (let x = 0; x < width; x++) {
        seed(x)
        seed((height - 1) * width + x)
      }
      for (let y = 0; y < height; y++) {
        seed(y * width)
        seed(y * width + width - 1)
      }
      while (stack.length > 0) {
        const i = stack.pop()!
        const x = i % width
        if (x > 0) seed(i - 1)
        if (x < width - 1) seed(i + 1)
        if (i >= width) seed(i - width)
        if (i + width < mask.length) seed(i + width)
      }
    }
  }
  if (options.specks && mask.includes(1)) removeSpecks(mask, width, height)
  return mask
}

/** Masks every 8-connected group of at most `SPECK_SIZE` unmasked pixels: everything around such a group is background. */
const removeSpecks = (mask: Uint8Array, width: number, height: number): void => {
  const seen = new Uint8Array(mask.length)
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 1 || seen[start] === 1) continue
    const group = [start]
    seen[start] = 1
    for (let k = 0; k < group.length; k++) {
      const i = group[k]!
      const x = i % width
      const y = (i - x) / width
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const n = ny * width + nx
          if (mask[n] === 1 || seen[n] === 1) continue
          seen[n] = 1
          group.push(n)
        }
      }
    }
    if (group.length <= SPECK_SIZE) for (const i of group) mask[i] = 1
  }
}

/** A copy of `mask` with the edits applied in order: each sets its pixel, or its area of one color, to erased or kept. */
export const applyEdits = (art: PixelArt, mask: Uint8Array, edits: ReadonlyArray<Edit>): Uint8Array => {
  const out = new Uint8Array(mask)
  for (const edit of edits) {
    if (edit.x < 0 || edit.y < 0 || edit.x >= art.width || edit.y >= art.height) continue
    const value = edit.erase ? 1 : 0
    if (edit.area) for (const i of region(art, edit.x, edit.y)) out[i] = value
    else out[edit.y * art.width + edit.x] = value
  }
  return out
}

/** The picture with the masked pixels made transparent. */
export const clearMasked = (art: PixelArt, mask: Uint8Array): PixelArt => {
  const indices = new Int32Array(art.indices)
  for (let i = 0; i < indices.length; i++) if (mask[i] === 1) indices[i] = TRANSPARENT
  return { ...art, indices }
}
