/**
 * Removing the background of the fixed picture.
 *
 * Runs on the fixed pixels, not the source: after snapping, a background is
 * a few flat colors (one, or the two of a fake "transparent" checkerboard an
 * image generator painted in), with no blur to fight. The colors that cover
 * most of the picture's border are the background; it is flooded inward from
 * the border through pixels close to one of them, and stops at the outline.
 * Edits by hand (`edits.ts`) go on top.
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
  /** Also removes a drop shadow under the subject (see `removeShadow`). */
  readonly shadow: boolean
}

export const defaultBackgroundOptions: BackgroundOptions = { tolerance: 0.08, enclosed: false, specks: true, shadow: false }

/** The largest group of pixels, alone in the background, that counts as a speck. */
export const SPECK_SIZE = 3

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
  if (options.shadow && targets.length > 0 && mask.includes(1)) removeShadow(art, mask, targets)
  if (options.specks && mask.includes(1)) removeSpecks(mask, width, height)
  return mask
}

/** A shadow's color is a background color darkened: about its hue, and this much darker (OKLab lightness). */
const SHADOW_HUE = 0.035
const SHADOW_DARKER = { min: 0.03, max: 0.4 }

/**
 * Masks a drop shadow: an area of the background's color darkened, lying
 * against the background (a shadow has no outline, unlike the subject's own
 * grey parts) in the bottom half of the subject, at least as wide as it is
 * tall.
 */
const removeShadow = (art: PixelArt, mask: Uint8Array, targets: ReadonlyArray<Lab>): void => {
  const { width, height, indices, palette } = art
  const shadowy = palette.map((color) => {
    const lab = toOklab(color)
    return targets.some((target) => {
      const darker = target.l - lab.l
      return Math.hypot(lab.a - target.a, lab.b - target.b) <= SHADOW_HUE && darker >= SHADOW_DARKER.min && darker <= SHADOW_DARKER.max
    })
  })
  let top = height
  let bottom = -1
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 1 || indices[i] === TRANSPARENT) continue
    const y = Math.floor(i / width)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  if (bottom < top) return
  const lowest = top + (bottom - top + 1) / 2
  const seen = new Uint8Array(mask.length)
  for (let start = 0; start < mask.length; start++) {
    if (seen[start] === 1 || mask[start] === 1 || shadowy[indices[start]!] !== true) continue
    const group = [start]
    seen[start] = 1
    let touches = false
    for (let k = 0; k < group.length; k++) {
      const i = group[k]!
      const x = i % width
      for (const n of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (n < 0 || n >= mask.length) continue
        if (mask[n] === 1) touches = true
        else if (seen[n] !== 1 && shadowy[indices[n]!] === true) {
          seen[n] = 1
          group.push(n)
        }
      }
    }
    const xs = group.map((i) => i % width)
    const ys = group.map((i) => Math.floor(i / width))
    const groupWidth = Math.max(...xs) - Math.min(...xs) + 1
    const groupHeight = Math.max(...ys) - Math.min(...ys) + 1
    if (touches && group.length >= 3 && Math.min(...ys) >= lowest && groupWidth >= groupHeight) for (const i of group) mask[i] = 1
  }
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

/** The picture with the masked pixels made transparent. */
export const clearMasked = (art: PixelArt, mask: Uint8Array): PixelArt => {
  const indices = new Int32Array(art.indices)
  for (let i = 0; i < indices.length; i++) if (mask[i] === 1) indices[i] = TRANSPARENT
  return { ...art, indices }
}
