/**
 * Fake "AI pixel art", for the demo button and the tests: a sprite upscaled
 * by a factor that need not be whole (optionally drifting across the
 * picture), blurred, and sprinkled with noise.
 */
import { parseHex, type Rgb } from "./color.ts"
import { TRANSPARENT, type PixelArt } from "./fix.ts"
import type { RgbaImage } from "./grid.ts"

/** A small seeded generator (an LCG), so the same seed draws the same picture. */
export const random = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
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

const mushroom = [
  "................",
  ".....KKKKKK.....",
  "...KKRRRRWWKK...",
  "..KRRRRRWWWWRK..",
  ".KRWWRRRRWWRRRK.",
  ".KWWWWRRRRRRRRK.",
  "KRWWWWRRRRRWWRRK",
  "KRRWWRRRRRWWWWRK",
  "KDRRRRRRRRWWWWDK",
  "KDDRRRRRRRRWWDDK",
  ".KKDDDDDDDDDDKK.",
  "...KKSSSSSSKK...",
  "....KSKSSKSK....",
  "....KSSSSSSsK...",
  "....KsSSSSssK...",
  ".....KKKKKKK...."
]

const mushroomColors: Record<string, string> = {
  ".": "#333c57",
  K: "#1a1c2c",
  R: "#b13e53",
  D: "#5d275d",
  W: "#f4f4f4",
  S: "#ffcd75",
  s: "#ef7d57"
}

/** The demo's sprite: a mushroom drawn in Sweetie 16's colors. */
export const demoSprite = (): PixelArt => {
  const keys = Object.keys(mushroomColors)
  const palette: Array<Rgb> = keys.map((key) => parseHex(mushroomColors[key]!)!)
  const indices = Int32Array.from(mushroom.join("").split(""), (key) => keys.indexOf(key))
  return { width: 16, height: 16, palette, indices }
}

/**
 * The demo picture: the mushroom as an image generator might draw it, at
 * about 23x, a little uneven, blurred, noisy, and with every color slightly
 * off its palette.
 */
export const demoImage = (): RgbaImage => {
  const sprite = demoSprite()
  const next = random(42)
  const off = (value: number): number => Math.min(255, Math.max(0, value + Math.round((next() * 2 - 1) * 8)))
  const shifted = { ...sprite, palette: sprite.palette.map((color) => ({ r: off(color.r), g: off(color.g), b: off(color.b) })) }
  return upscale(shifted, { scale: 23.3, offset: 6, drift: 0.04, blur: 2, noise: 7, seed: 3 })
}

