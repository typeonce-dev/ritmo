/**
 * Known sprites for the tests, made into fake "AI pixel art" by
 * `src/core/demo.ts`'s `upscale`. The tests check that the tool gets the
 * sprite back.
 */
import type { Rgb } from "../src/core/color.ts"
import type { RgbaImage } from "../src/core/grid.ts"
import { random, upscale } from "../src/core/demo.ts"
import { TRANSPARENT, type PixelArt } from "../src/core/fix.ts"

export { boundaries, random, upscale, type Upscale } from "../src/core/demo.ts"

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

/** A sprite moved by whole pixels inside a transparent picture of the given size. */
export const place = (sprite: PixelArt, width: number, height: number, x: number, y: number): PixelArt => {
  const indices = new Int32Array(width * height).fill(TRANSPARENT)
  for (let sy = 0; sy < sprite.height; sy++) {
    for (let sx = 0; sx < sprite.width; sx++) {
      const index = sprite.indices[sy * sprite.width + sx]!
      if (index !== TRANSPARENT && sx + x >= 0 && sy + y >= 0 && sx + x < width && sy + y < height) indices[(sy + y) * width + sx + x] = index
    }
  }
  return { ...sprite, width, height, indices }
}

export interface FakeSheet {
  readonly image: RgbaImage
  /** Where each frame's art was drawn, in source pixels. */
  readonly frames: ReadonlyArray<{ readonly x: number; readonly y: number; readonly width: number; readonly height: number }>
}

/**
 * An animation sheet as image generators make them: a dark background with
 * a grid painted over it, a box around each frame, the frames upscaled and
 * blurred (each at its own offset), and a light label under each box.
 */
export const fakeSheet = (frames: ReadonlyArray<PixelArt>, scale: number, seed = 5): FakeSheet => {
  const next = random(seed)
  const first = frames[0]!
  const frameWidth = Math.ceil(first.width * scale) + 8
  const frameHeight = Math.ceil(first.height * scale) + 8
  const gap = Math.round(frameWidth * 0.3)
  const top = Math.round(frameHeight * 0.4)
  const width = gap + frames.length * (frameWidth + gap)
  const height = top + frameHeight + Math.round(frameHeight * 0.6)
  const data = new Uint8ClampedArray(width * height * 4)
  const paint = (x: number, y: number, r: number, g: number, b: number): void => {
    const i = (y * width + x) * 4
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x % 40 < 2 || y % 40 < 2) paint(x, y, 4, 6, 16)
      else paint(x, y, 29, 36, 52)
    }
  }
  const placed: Array<FakeSheet["frames"][number]> = []
  frames.forEach((art, f) => {
    const left = gap + f * (frameWidth + gap)
    // The box around the frame, in the grid's dark color.
    for (let x = left; x < left + frameWidth; x++) {
      paint(x, top, 4, 6, 16)
      paint(x, top + frameHeight - 1, 4, 6, 16)
    }
    for (let y = top; y < top + frameHeight; y++) {
      paint(left, y, 4, 6, 16)
      paint(left + frameWidth - 1, y, 4, 6, 16)
    }
    const picture = upscale(art, { scale, offset: Math.round(next() * scale * 0.8), blur: 1, noise: 4, seed: seed + f })
    const x0 = left + 4
    const y0 = top + 4
    for (let y = 0; y < picture.height && y0 + y < height; y++) {
      for (let x = 0; x < picture.width && x0 + x < width; x++) {
        const s = (y * picture.width + x) * 4
        const alpha = picture.data[s + 3]! / 255
        if (alpha === 0) continue
        const i = ((y0 + y) * width + x0 + x) * 4
        for (let c = 0; c < 3; c++) data[i + c] = Math.round(picture.data[s + c]! * alpha + data[i + c]! * (1 - alpha))
      }
    }
    placed.push({ x: x0, y: y0, width: picture.width, height: picture.height })
    // A label under the box: a light bar, like text.
    for (let y = top + frameHeight + 10; y < top + frameHeight + 16; y++) {
      for (let x = left + Math.round(frameWidth * 0.3); x < left + Math.round(frameWidth * 0.7); x++) if ((x >> 2) % 2 === 0) paint(x, y, 220, 220, 225)
    }
  })
  return { image: { width, height, data }, frames: placed }
}
