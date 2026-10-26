/**
 * Fake "AI pixel art" for the tests: a known sprite, upscaled by a factor
 * that need not be whole (optionally drifting across the picture), blurred,
 * and sprinkled with noise. The tests check that the tool gets the sprite back.
 */
import type { Rgb } from "../src/core/color.ts"
import { TRANSPARENT, type PixelArt } from "../src/core/fix.ts"
import type { RgbaImage } from "../src/core/grid.ts"

export const random = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** A sprite in random blobs of the given colors, with a transparent border when asked. */
export const makeSprite = (
  width: number,
  height: number,
  palette: ReadonlyArray<Rgb>,
  seed: number,
  transparentBorder = false
): PixelArt => {
  const next = random(seed)
  const indices = new Int32Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Mostly copies a neighbour, so the sprite has areas, like real art, and some edges vanish.
      const roll = next()
      const left = x > 0 ? indices[y * width + x - 1]! : undefined
      const up = y > 0 ? indices[(y - 1) * width + x]! : undefined
      let value = Math.floor(next() * palette.length)
      if (roll < 0.35 && left !== undefined && left !== TRANSPARENT) value = left
      else if (roll < 0.55 && up !== undefined && up !== TRANSPARENT) value = up
      indices[y * width + x] = value
    }
  }
  if (transparentBorder) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) indices[y * width + x] = TRANSPARENT
      }
    }
  }
  return { width, height, palette, indices }
}

export interface Upscale {
  /** Source pixels per sprite pixel. */
  readonly scale: number
  /** Where the first full cell starts, in source pixels; the pixels before it belong to the first cell. */
  readonly offset: number
  /** How much the cell size grows from the first cell to the last (0.1 = the last is 10% bigger). */
  readonly drift?: number
  /** 3x3 box blur passes. */
  readonly blur?: number
  /** Noise amplitude per channel. */
  readonly noise?: number
  readonly seed?: number
}

/** The boundaries of each sprite pixel along one axis, in source pixels. */
export const boundaries = (count: number, upscale: Upscale): Array<number> => {
  const drift = upscale.drift ?? 0
  const cuts = [upscale.offset]
  for (let k = 0; k < count; k++) {
    cuts.push(cuts[k]! + upscale.scale * (1 + (drift * k) / Math.max(1, count - 1)))
  }
  return cuts
}

export const upscale = (sprite: PixelArt, options: Upscale): RgbaImage => {
  const xs = boundaries(sprite.width, options)
  const ys = boundaries(sprite.height, options)
  // The picture ends where the last cell does; before `offset`, the first cell is cut off.
  const width = Math.round(xs[xs.length - 1]!)
  const height = Math.round(ys[ys.length - 1]!)
  const cellOf = (cuts: ReadonlyArray<number>, position: number): number => {
    let i = 0
    while (i < cuts.length - 2 && position >= cuts[i + 1]!) i++
    return i
  }
  let data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    const sy = cellOf(ys, y + 0.5)
    for (let x = 0; x < width; x++) {
      const sx = cellOf(xs, x + 0.5)
      const index = sprite.indices[sy * sprite.width + sx]!
      const i = (y * width + x) * 4
      if (index === TRANSPARENT) continue
      const color = sprite.palette[index]!
      data[i] = color.r
      data[i + 1] = color.g
      data[i + 2] = color.b
      data[i + 3] = 255
    }
  }
  for (let pass = 0; pass < (options.blur ?? 0); pass++) {
    const blurred = new Uint8ClampedArray(data.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 4; c++) {
          let sum = 0
          let count = 0
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
              sum += data[(ny * width + nx) * 4 + c]!
              count++
            }
          }
          blurred[(y * width + x) * 4 + c] = Math.round(sum / count)
        }
      }
    }
    data = blurred
  }
  const noise = options.noise ?? 0
  if (noise > 0) {
    const next = random(options.seed ?? 7)
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) data[i + c] = data[i + c]! + Math.round((next() * 2 - 1) * noise)
    }
  }
  return { width, height, data }
}

/** The sprite in the middle of a transparent area `margin` pixels wider on every side. */
export const pad = (sprite: PixelArt, margin: number): PixelArt => {
  const width = sprite.width + 2 * margin
  const height = sprite.height + 2 * margin
  const indices = new Int32Array(width * height).fill(TRANSPARENT)
  for (let y = 0; y < sprite.height; y++) {
    for (let x = 0; x < sprite.width; x++) {
      indices[(y + margin) * width + x + margin] = sprite.indices[y * sprite.width + x]!
    }
  }
  return { ...sprite, width, height, indices }
}
