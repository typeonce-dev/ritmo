/**
 * Known sprites for the tests, made into fake "AI pixel art" by
 * `src/core/demo.ts`'s `upscale`. The tests check that the tool gets the
 * sprite back.
 */
import type { Rgb } from "../src/core/color.ts"
import { random } from "../src/core/demo.ts"
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
