/**
 * Cleaning up specks: small groups of one color that an image generator's
 * noise left in the fixed picture.
 *
 * A speck is a group of at most `size` same-colored pixels, counted with
 * diagonal neighbours (so a one-pixel diagonal outline is one long group,
 * never a speck). It takes the color it touches most, but only when there is
 * doubt it is real: its own cells voted nearly as much for that color, or
 * the two colors are close anyway. A confidently drawn detail far from its
 * surroundings (an eye, a highlight) stays. `strength` sets how much doubt is
 * enough; protected colors and kept specks are never touched.
 */
import { makeMatcher, toOklab, unpack, type Lab, type Metric } from "./color.ts"
import { TRANSPARENT, type CellSamples, type PixelArt } from "./fix.ts"

export interface CleanupOptions {
  /** The largest speck, in pixels: 0 turns cleaning off. */
  readonly size: number
  /** 0 to 1: how sure the speck must be to stay. 0 only merges coin flips; 1 merges every speck. */
  readonly strength: number
  readonly metric: Metric
  /** Palette indices never cleaned away (the locked colors). */
  readonly protect: ReadonlyArray<number>
  /** Cells (row by row) whose speck stays as it is: specks brought back by hand. */
  readonly keep: ReadonlyArray<number>
}

export interface Cleaned {
  readonly art: PixelArt
  /** The specks merged, each as its cells (row by row). */
  readonly specks: ReadonlyArray<ReadonlyArray<number>>
}

/** Two colors this far apart (OKLab) or more are not alike at all; closer ones are alike in proportion. */
const ALIKE_RANGE = 0.3

const distance = (x: Lab, y: Lab): number => Math.hypot(x.l - y.l, x.a - y.a, x.b - y.b)

/** Merges the doubtful specks of `art`, snapped from `samples` (one pixel per cell). */
export const cleanUp = (art: PixelArt, samples: CellSamples, options: CleanupOptions): Cleaned => {
  const { width, height, indices, palette } = art
  if (options.size < 1 || palette.length < 2) return { art, specks: [] }
  const protect = new Set(options.protect)
  const keep = new Set(options.keep)
  const labs = palette.map(toOklab)
  const matcher = makeMatcher(palette, options.metric)
  const out = new Int32Array(indices)
  const seen = new Uint8Array(indices.length)
  const specks: Array<Array<number>> = []

  const neighbours = (i: number, visit: (n: number) => void): void => {
    const x = i % width
    const y = (i - x) / width
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        const ny = y + dy
        if ((dx !== 0 || dy !== 0) && nx >= 0 && ny >= 0 && nx < width && ny < height) visit(ny * width + nx)
      }
    }
  }

  for (let start = 0; start < indices.length; start++) {
    const own = indices[start]!
    if (seen[start] === 1 || own === TRANSPARENT) continue
    const group = [start]
    seen[start] = 1
    for (let k = 0; k < group.length; k++) {
      neighbours(group[k]!, (n) => {
        if (seen[n] === 1 || indices[n] !== own) return
        seen[n] = 1
        group.push(n)
      })
    }
    if (group.length > options.size || protect.has(own) || group.some((i) => keep.has(i))) continue

    // The color the speck touches most.
    const touching = new Map<number, number>()
    for (const i of group) {
      neighbours(i, (n) => {
        const value = indices[n]!
        if (value !== own && value !== TRANSPARENT) touching.set(value, (touching.get(value) ?? 0) + 1)
      })
    }
    let into = TRANSPARENT
    let most = 0
    for (const [value, count] of touching) {
      if (count > most) {
        into = value
        most = count
      }
    }
    if (into === TRANSPARENT) continue

    // Doubt: how much the speck's own cells voted for that color, against their own.
    let votes = 0
    for (const i of group) {
      let forOwn = 0
      let forInto = 0
      for (const color of samples.cells[i]?.colors ?? []) {
        const nearest = matcher.nearest(unpack(color))
        if (nearest === own) forOwn++
        else if (nearest === into) forInto++
      }
      votes += Math.min(1, forInto / Math.max(1, forOwn))
    }
    const alike = Math.max(0, 1 - distance(labs[own]!, labs[into]!) / ALIKE_RANGE)
    const doubt = Math.max(votes / group.length, alike)
    if (doubt < 1 - options.strength) continue
    for (const i of group) out[i] = into
    specks.push(group)
  }
  return { art: { ...art, indices: out }, specks }
}
