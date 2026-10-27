/**
 * Making the fixed picture smaller: fewer, bigger pixels.
 *
 * Each new pixel covers a block of the old ones (any ratio, not only whole
 * ones) and takes the color covering most of the block. With "keep
 * outlines", a block's darkest color wins instead when it is clearly darker
 * than the majority and covers at least a one-pixel line through the block,
 * so thin outlines survive while a lone dark pixel does not.
 */
import { toOklab } from "./color.ts"
import { TRANSPARENT, type PixelArt } from "./fix.ts"

export type ReduceMode = "common" | "outlines"

export const reduceModes: ReadonlyArray<{ readonly id: ReduceMode; readonly label: string }> = [
  { id: "outlines", label: "Keep outlines" },
  { id: "common", label: "Most common color" }
]

/** How much darker (OKLab lightness) the darkest color must be than the majority to win as an outline. */
const OUTLINE_CONTRAST = 0.15

/** The picture at `width` × `height` (at most its own size). */
export const reduce = (art: PixelArt, width: number, height: number, mode: ReduceMode): PixelArt => {
  const outWidth = Math.max(1, Math.min(art.width, Math.round(width)))
  const outHeight = Math.max(1, Math.min(art.height, Math.round(height)))
  if (outWidth === art.width && outHeight === art.height) return art
  const fx = art.width / outWidth
  const fy = art.height / outHeight
  const lightness = art.palette.map((color) => toOklab(color).l)
  const indices = new Int32Array(outWidth * outHeight)
  const weights = new Map<number, number>()
  for (let oy = 0; oy < outHeight; oy++) {
    const top = oy * fy
    const bottom = top + fy
    for (let ox = 0; ox < outWidth; ox++) {
      const left = ox * fx
      const right = left + fx
      weights.clear()
      for (let y = Math.floor(top); y < Math.min(art.height, Math.ceil(bottom)); y++) {
        const h = Math.min(bottom, y + 1) - Math.max(top, y)
        for (let x = Math.floor(left); x < Math.min(art.width, Math.ceil(right)); x++) {
          const w = Math.min(right, x + 1) - Math.max(left, x)
          const index = art.indices[y * art.width + x]!
          weights.set(index, (weights.get(index) ?? 0) + w * h)
        }
      }
      let best = TRANSPARENT
      let bestWeight = -1
      for (const [index, weight] of weights) {
        if (weight > bestWeight) {
          best = index
          bestWeight = weight
        }
      }
      if (mode === "outlines") {
        let dark = TRANSPARENT
        for (const index of weights.keys()) {
          if (index !== TRANSPARENT && (dark === TRANSPARENT || lightness[index]! < lightness[dark]!)) dark = index
        }
        // A one-pixel line through the block covers 1 / (the block's longer side) of it.
        const line = (fx * fy) / Math.max(fx, fy) - 1e-9
        const darker = best === TRANSPARENT || lightness[dark]! < lightness[best]! - OUTLINE_CONTRAST
        if (dark !== TRANSPARENT && darker && weights.get(dark)! >= line) best = dark
      }
      indices[oy * outWidth + ox] = best
    }
  }
  return { width: outWidth, height: outHeight, palette: art.palette, indices }
}
