/**
 * Pictures for looking at a result: an agent that can see images opens
 * these to judge what no number can (does the sprite read well?).
 */
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import type { Grid, RgbaImage } from "./grid.ts"

const GAP = 8
const BACKDROP = [42, 45, 53] as const
const GRID_LINE = [0, 0, 0, 56] as const

/** A checkerboard square, light or dark, for transparent pixels. */
const checker = (x: number, y: number): number => (((x >> 3) + (y >> 3)) % 2 === 0 ? 240 : 200)

const blend = (data: Uint8ClampedArray, i: number, color: readonly [number, number, number, number]): void => {
  const a = color[3] / 255
  data[i] = data[i]! * (1 - a) + color[0] * a
  data[i + 1] = data[i + 1]! * (1 - a) + color[1] * a
  data[i + 2] = data[i + 2]! * (1 - a) + color[2] * a
}

/**
 * The pixel art enlarged by a whole `scale`, transparent pixels as a
 * checkerboard, with thin lines between pixels when they are 6 screen pixels
 * or more: every pixel can be counted.
 */
export const previewArt = (art: PixelArt, scale: number): RgbaImage => {
  const factor = Math.max(1, Math.floor(scale))
  const width = art.width * factor
  const height = art.height * factor
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const index = art.indices[Math.floor(y / factor) * art.width + Math.floor(x / factor)]!
      if (index === TRANSPARENT) {
        const shade = checker(x, y)
        data[i] = data[i + 1] = data[i + 2] = shade
      } else {
        const color = art.palette[index]!
        data[i] = color.r
        data[i + 1] = color.g
        data[i + 2] = color.b
      }
      data[i + 3] = 255
      if (factor >= 6 && (x % factor === 0 || y % factor === 0)) blend(data, i, GRID_LINE)
    }
  }
  return { width, height, data }
}

/** A whole scale that makes the art about `target` pixels on its longer side. */
export const fitScale = (art: PixelArt, target = 512): number => Math.max(1, Math.floor(target / Math.max(1, art.width, art.height)))

/**
 * The source and the fix side by side, at the same height (about `height`
 * pixels): the source on the left with its grid drawn over it, the fixed
 * pixel art on the right.
 */
export const previewFix = (source: RgbaImage, grid: Grid, art: PixelArt, height = 512): RgbaImage => {
  const scale = height / source.height
  const left = Math.max(1, Math.round(source.width * scale))
  const top = Math.max(1, Math.round(source.height * scale))
  const right = Math.max(1, Math.round((art.width / Math.max(1, art.height)) * top))
  const width = left + GAP + right
  const data = new Uint8ClampedArray(width * top * 4)
  for (let i = 0; i < width * top; i++) {
    data[i * 4] = BACKDROP[0]
    data[i * 4 + 1] = BACKDROP[1]
    data[i * 4 + 2] = BACKDROP[2]
    data[i * 4 + 3] = 255
  }
  // Source, nearest pixel, over a checkerboard.
  for (let y = 0; y < top; y++) {
    const sy = Math.min(source.height - 1, Math.floor(y / scale))
    for (let x = 0; x < left; x++) {
      const sx = Math.min(source.width - 1, Math.floor(x / scale))
      const s = (sy * source.width + sx) * 4
      const i = (y * width + x) * 4
      const alpha = source.data[s + 3]! / 255
      const shade = checker(x, y)
      data[i] = source.data[s]! * alpha + shade * (1 - alpha)
      data[i + 1] = source.data[s + 1]! * alpha + shade * (1 - alpha)
      data[i + 2] = source.data[s + 2]! * alpha + shade * (1 - alpha)
    }
  }
  // The grid over the source, when its cells are big enough to see.
  const spacing = ((grid.xs[grid.xs.length - 1]! - grid.xs[0]!) / Math.max(1, grid.xs.length - 1)) * scale
  if (spacing >= 4) {
    const pink = [255, 64, 160, 200] as const
    for (const cut of grid.xs) {
      const x = Math.min(left - 1, Math.round(cut * scale))
      for (let y = Math.round(grid.ys[0]! * scale); y < Math.min(top, Math.round(grid.ys[grid.ys.length - 1]! * scale)); y++) blend(data, (y * width + x) * 4, pink)
    }
    for (const cut of grid.ys) {
      const y = Math.min(top - 1, Math.round(cut * scale))
      for (let x = Math.round(grid.xs[0]! * scale); x < Math.min(left, Math.round(grid.xs[grid.xs.length - 1]! * scale)); x++) blend(data, (y * width + x) * 4, pink)
    }
  }
  // The fixed art, nearest pixel.
  const pixel = top / Math.max(1, art.height)
  for (let y = 0; y < top; y++) {
    const ay = Math.min(art.height - 1, Math.floor(y / pixel))
    for (let x = 0; x < right; x++) {
      const ax = Math.min(art.width - 1, Math.floor(x / pixel))
      const i = (y * width + left + GAP + x) * 4
      const index = art.indices[ay * art.width + ax]!
      if (index === TRANSPARENT) {
        const shade = checker(x, y)
        data[i] = data[i + 1] = data[i + 2] = shade
      } else {
        const color = art.palette[index]!
        data[i] = color.r
        data[i + 1] = color.g
        data[i + 2] = color.b
      }
    }
  }
  return { width, height: top, data }
}

/** The colors frame boxes are outlined in, in turn, so neighbouring boxes tell apart. */
const BOX_COLORS = [
  [0, 220, 255],
  [255, 200, 0]
] as const

/**
 * An animation sheet to look at: the source on top with each frame's box
 * outlined, and under it every fixed frame enlarged, side by side on one
 * canvas size, with a line through the anchor so a frame that jumps shows.
 */
export const previewSheet = (
  source: RgbaImage,
  boxes: ReadonlyArray<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly include: boolean }>,
  frames: ReadonlyArray<PixelArt>,
  anchorY: number | undefined,
  target = 1024
): RgbaImage => {
  const first = frames[0]
  const frameScale = first === undefined ? 1 : Math.max(1, Math.floor((target - GAP * (frames.length - 1)) / Math.max(1, frames.length * first.width)))
  const rowWidth = first === undefined ? 0 : frames.length * first.width * frameScale + GAP * (frames.length - 1)
  const rowHeight = first === undefined ? 0 : first.height * frameScale
  const width = Math.max(rowWidth, Math.min(target, source.width))
  const scale = width / source.width
  const top = Math.max(1, Math.round(source.height * scale))
  const height = top + (first === undefined ? 0 : GAP * 2 + rowHeight)
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = BACKDROP[0]
    data[i * 4 + 1] = BACKDROP[1]
    data[i * 4 + 2] = BACKDROP[2]
    data[i * 4 + 3] = 255
  }
  for (let y = 0; y < top; y++) {
    const sy = Math.min(source.height - 1, Math.floor(y / scale))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(source.width - 1, Math.floor(x / scale))
      const s = (sy * source.width + sx) * 4
      const i = (y * width + x) * 4
      const alpha = source.data[s + 3]! / 255
      const shade = checker(x, y)
      data[i] = source.data[s]! * alpha + shade * (1 - alpha)
      data[i + 1] = source.data[s + 1]! * alpha + shade * (1 - alpha)
      data[i + 2] = source.data[s + 2]! * alpha + shade * (1 - alpha)
    }
  }
  boxes.forEach((box, b) => {
    const [r, g, bl] = BOX_COLORS[b % BOX_COLORS.length]!
    const color = [r, g, bl, box.include ? 255 : 110] as const
    const x0 = Math.max(0, Math.round(box.x * scale))
    const y0 = Math.max(0, Math.round(box.y * scale))
    const x1 = Math.min(width - 1, Math.round((box.x + box.width) * scale) - 1)
    const y1 = Math.min(top - 1, Math.round((box.y + box.height) * scale) - 1)
    for (let t = 0; t < 2; t++) {
      for (let x = x0; x <= x1; x++) {
        blend(data, ((y0 + t) * width + x) * 4, color)
        blend(data, ((y1 - t) * width + x) * 4, color)
      }
      for (let y = y0; y <= y1; y++) {
        blend(data, (y * width + x0 + t) * 4, color)
        blend(data, (y * width + x1 - t) * 4, color)
      }
    }
  })
  frames.forEach((art, f) => {
    const picture = previewArt(art, frameScale)
    const left = f * (art.width * frameScale + GAP)
    for (let y = 0; y < picture.height; y++) {
      data.set(picture.data.subarray(y * picture.width * 4, (y + 1) * picture.width * 4), ((top + GAP + y) * width + left) * 4)
    }
  })
  if (anchorY !== undefined && first !== undefined) {
    const y = top + GAP + Math.min(rowHeight - 1, (anchorY + 1) * frameScale - 1)
    for (let x = 0; x < rowWidth; x++) blend(data, (y * width + x) * 4, [255, 64, 160, 200])
  }
  return { width, height, data }
}
