/**
 * Edits by hand on the fixed picture, applied in order after everything
 * else: erasing (making transparent), restoring, or painting a color, on one
 * pixel or one area of one color at a time.
 *
 * A painted color is stored as a color, not a palette index, and snaps to the
 * nearest color of the picture's palette: a palette that loses it still
 * paints its nearest neighbour.
 */
import { makeMatcher, toHex, type Metric, type Rgb } from "./color.ts"
import type { PixelArt } from "./fix.ts"

/** An edit by hand at pixel (x, y) of the fixed picture, on that pixel or (`area`) its whole connected area of one color. */
export type Edit =
  | { readonly x: number; readonly y: number; readonly area: boolean; readonly tool: "erase" | "restore" }
  | { readonly x: number; readonly y: number; readonly area: boolean; readonly tool: "paint"; readonly color: Rgb }

export interface Edited {
  readonly art: PixelArt
  /** Which pixels are erased (1): the mask given, with the edits applied. */
  readonly mask: Uint8Array
  /** The pixels painted (row by row) and not erased since. */
  readonly painted: ReadonlyArray<number>
}

/** The 4-connected pixels holding the same palette index as (x, y). */
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
 * Applies `edits` in order to `art` and its erased pixels (`mask`, 1 for
 * erased). Erase and restore set the mask; paint sets the color, snapped to
 * the nearest palette color by `metric`, and shows the pixel again.
 */
export const applyEdits = (art: PixelArt, mask: Uint8Array, edits: ReadonlyArray<Edit>, metric: Metric): Edited => {
  const indices = new Int32Array(art.indices)
  const out = new Uint8Array(mask)
  const painted = new Set<number>()
  const current: PixelArt = { ...art, indices }
  const exact = new Map(art.palette.map((color, index) => [toHex(color), index]))
  const matcher = makeMatcher(art.palette, metric)
  for (const edit of edits) {
    if (edit.x < 0 || edit.y < 0 || edit.x >= art.width || edit.y >= art.height) continue
    const cells = edit.area ? region(current, edit.x, edit.y) : [edit.y * art.width + edit.x]
    if (edit.tool === "paint") {
      if (art.palette.length === 0) continue
      const index = exact.get(toHex(edit.color)) ?? matcher.nearest(edit.color)
      for (const i of cells) {
        indices[i] = index
        out[i] = 0
        painted.add(i)
      }
    } else {
      const value = edit.tool === "erase" ? 1 : 0
      for (const i of cells) {
        out[i] = value
        if (value === 1) painted.delete(i)
      }
    }
  }
  return { art: current, mask: out, painted: [...painted].sort((x, y) => x - y) }
}
