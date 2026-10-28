import { describe, expect, it } from "vitest"

import { detectFrames, isAnimationSheet, runSheet } from "../src/core/animation.ts"
import type { Rgb } from "../src/core/color.ts"
import { demoImage } from "../src/core/demo.ts"
import { TRANSPARENT, type PixelArt } from "../src/core/fix.ts"
import { toGif } from "../src/core/gif.ts"
import { presets } from "../src/core/palette.ts"
import { decodeRecipe, defaultRecipe, encodeRecipe, type Recipe } from "../src/core/recipe.ts"
import { layOut, looksAnimated, playOrder, findFrames, frameOf, type Sheet } from "../src/core/sheet.ts"
import { sheetArt, spritesheetJson } from "../src/core/spritesheet.ts"
import { crc32, toZip } from "../src/core/zip.ts"
import { fakeSheet, makeSprite, place } from "./synthetic.ts"

const sweetie = presets.find((palette) => palette.name === "Sweetie 16")!.colors
const fire: ReadonlyArray<Rgb> = [sweetie[2]!, sweetie[3]!, sweetie[4]!, sweetie[0]!]

/** A small sprite that bobs up and down: the frames of a loop, each on its own transparent canvas. */
const bobbing = (count: number): Array<PixelArt> => {
  const sprite = makeSprite(10, 12, fire, 3, true)
  return Array.from({ length: count }, (_, f) => place(sprite, 12, 16, 1, 2 + (f % 2)))
}

const sheetRecipe: Recipe = { ...defaultRecipe, removeBackground: true }

/** The opaque pixels' rows, from the top, in a fixed frame. */
const opaqueRows = (art: PixelArt): Array<number> => {
  const rows: Array<number> = []
  art.indices.forEach((index, p) => {
    if (index !== TRANSPARENT) rows.push(Math.floor(p / art.width))
  })
  return rows
}

describe("finding frames on a sheet", () => {
  const frames = bobbing(5)
  const { image, frames: drawn } = fakeSheet(frames, 6)

  it("finds one box per frame, around each frame's art, and drops the labels", () => {
    const found = detectFrames(image, sheetRecipe)
    expect(found).toHaveLength(5)
    found.forEach((frame, i) => {
      const art = drawn[i]!
      // The box holds the art (the blur may spill a pixel or two).
      expect(frame.box.x).toBeLessThanOrEqual(art.x + 6)
      expect(frame.box.x + frame.box.width).toBeGreaterThanOrEqual(art.x + art.width - 6)
      expect(frame.box.y + frame.box.height).toBeLessThan(image.height - 10)
    })
    expect(isAnimationSheet(image, sheetRecipe, found)).toBe(true)
  })

  it("does not take a single picture for a sheet", () => {
    const image = demoImage()
    expect(looksAnimated(image, findFrames(image))).toBe(false)
  })

  it("reads every frame on one cell size, one palette, and one canvas, with the feet on one row", () => {
    const sheet: Sheet = { frames: detectFrames(image, sheetRecipe), anchor: "feet", fps: 8, loop: "forward", padding: 1 }
    const outcome = runSheet(image, sheetRecipe, sheet)
    expect(outcome.cell.width).toBeGreaterThan(5.5)
    expect(outcome.cell.width).toBeLessThan(6.5)
    expect(outcome.placed).toHaveLength(5)
    const palette = outcome.placed[0]!.art.palette
    for (const frame of outcome.placed) {
      expect(frame.art.palette).toBe(palette)
      expect(frame.art.width).toBe(outcome.width)
      expect(frame.art.height).toBe(outcome.height)
      // Feet anchoring: the bob is gone, every frame's lowest pixel is on one row.
      expect(Math.max(...opaqueRows(frame.art))).toBe(Math.max(...opaqueRows(outcome.placed[0]!.art)))
    }
    // About the sprite's own size (12 by 14 with the bob, plus padding).
    expect(outcome.width).toBeGreaterThanOrEqual(10)
    expect(outcome.width).toBeLessThanOrEqual(15)
  })

  it("leaves out an excluded frame and keeps the rest", () => {
    const found = detectFrames(image, sheetRecipe)
    const sheet: Sheet = { frames: found.map((frame, i) => (i === 2 ? { ...frame, include: false } : frame)), anchor: "feet", fps: 8, loop: "forward", padding: 1 }
    const outcome = runSheet(image, sheetRecipe, sheet)
    expect(outcome.placed.map((frame) => frame.index)).toEqual([0, 1, 3, 4])
  })
})

describe("laying frames out", () => {
  const dot = (x: number, y: number): PixelArt => {
    const indices = new Int32Array(4 * 4).fill(TRANSPARENT)
    indices[y * 4 + x] = 0
    return { width: 4, height: 4, palette: [{ r: 255, g: 0, b: 0 }], indices }
  }

  it("puts every frame's anchor on one spot, on the smallest canvas", () => {
    const laid = layOut([dot(0, 0), dot(3, 3)], [{ x: 0, y: 0 }, { x: -3, y: -3 }], 0)
    expect(laid.width).toBe(1)
    expect(laid.height).toBe(1)
    expect(laid.frames.map((frame) => frame.art.indices[0])).toEqual([0, 0])
  })

  it("plays there and back without repeating the ends", () => {
    expect(playOrder(4, "forward")).toEqual([0, 1, 2, 3])
    expect(playOrder(4, "pingpong")).toEqual([0, 1, 2, 3, 2, 1])
  })

  it("lays a sheet out in rows and says where each frame is", () => {
    const frames = [0, 1, 2, 3, 4].map(() => dot(1, 1))
    const art = sheetArt(frames, { columns: 2, spacing: 1 })
    expect(art.width).toBe(9)
    expect(art.height).toBe(14)
    const json = JSON.parse(
      spritesheetJson({ name: "fire", image: "fire.png", frameWidth: 4, frameHeight: 4, count: 5, layout: { columns: 2, spacing: 1 }, scale: 2, fps: 10, loop: "pingpong", anchor: { x: 1, y: 3 } })
    )
    expect(json.frames["fire 3"].frame).toEqual({ x: 10, y: 10, w: 8, h: 8 })
    expect(json.frames["fire 0"].duration).toBe(100)
    expect(json.frames["fire 0"].anchor).toEqual({ x: 0.375, y: 1 })
    expect(json.animations.fire).toHaveLength(5)
    expect(json.meta.size).toEqual({ w: 18, h: 28 })
    expect(json.meta.frameTags).toEqual([{ name: "fire", from: 0, to: 4, direction: "pingpong" }])
  })
})

/** Decodes a GIF's frames back to palette indices (enough of the format to check the writer). */
const readGif = (bytes: Uint8Array): { width: number; height: number; delays: Array<number>; frames: Array<Uint8Array> } => {
  const width = bytes[6]! | (bytes[7]! << 8)
  const height = bytes[8]! | (bytes[9]! << 8)
  let at = 13 + 3 * (1 << ((bytes[10]! & 7) + 1))
  const delays: Array<number> = []
  const frames: Array<Uint8Array> = []
  while (bytes[at] !== 0x3b) {
    if (bytes[at] === 0x21) {
      if (bytes[at + 1] === 0xf9) delays.push(bytes[at + 4]! | (bytes[at + 5]! << 8))
      at += 2
      while (bytes[at] !== 0) at += bytes[at]! + 1
      at++
      continue
    }
    // An image: descriptor, then LZW data in sub-blocks.
    at += 10
    const minCodeSize = bytes[at++]!
    const data: Array<number> = []
    while (bytes[at] !== 0) {
      data.push(...bytes.subarray(at + 1, at + 1 + bytes[at]!))
      at += bytes[at]! + 1
    }
    at++
    const clear = 1 << minCodeSize
    let size = minCodeSize + 1
    let table: Array<Array<number>> = []
    const reset = (): void => {
      table = Array.from({ length: clear + 2 }, (_, i) => [i])
      size = minCodeSize + 1
    }
    reset()
    const out: Array<number> = []
    let previous: Array<number> | undefined
    let bit = 0
    for (;;) {
      let code = 0
      for (let b = 0; b < size; b++, bit++) code |= ((data[bit >> 3]! >> (bit & 7)) & 1) << b
      if (code === clear) {
        reset()
        previous = undefined
        continue
      }
      if (code === clear + 1) break
      const entry = table[code] ?? [...previous!, previous![0]!]
      out.push(...entry)
      if (previous !== undefined && table.length < 4096) table.push([...previous, entry[0]!])
      if (table.length === 1 << size && size < 12) size++
      previous = entry
    }
    frames.push(Uint8Array.from(out))
  }
  return { width, height, delays, frames }
}

describe("GIF", () => {
  it("writes frames that read back pixel for pixel, with the delay and transparency", () => {
    const frames = bobbing(3).map((art) => ({ ...art, palette: fire }))
    const gif = readGif(toGif(frames, { scale: 2, delay: 125 }))
    expect(gif.width).toBe(24)
    expect(gif.height).toBe(32)
    expect(gif.delays).toEqual([13, 13, 13])
    gif.frames.forEach((pixels, f) => {
      const art = frames[f]!
      expect(pixels).toHaveLength(24 * 32)
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 24; x++) {
          const index = art.indices[Math.floor(y / 2) * 12 + Math.floor(x / 2)]!
          expect(pixels[y * 24 + x]).toBe(index === TRANSPARENT ? fire.length : index)
        }
      }
    })
  })

  it("survives a picture big enough to fill the LZW table", () => {
    const sprite = makeSprite(64, 64, sweetie, 9)
    const gif = readGif(toGif([sprite], { scale: 3, delay: 100 }))
    expect(gif.frames[0]![1000]).toBe(sprite.indices[Math.floor(1000 / 192 / 3) * 64 + Math.floor((1000 % 192) / 3)])
    expect(gif.frames[0]).toHaveLength(192 * 192)
  })
})

describe("ZIP", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926)
  })

  it("stores each file with its name and a central directory", () => {
    const zip = toZip([
      { name: "a.png", bytes: Uint8Array.from([1, 2, 3]) },
      { name: "b/c.png", bytes: Uint8Array.from([4]) }
    ])
    const view = new DataView(zip.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    const end = zip.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    expect(new TextDecoder().decode(zip.subarray(30, 35))).toBe("a.png")
    expect(Array.from(zip.subarray(35, 38))).toEqual([1, 2, 3])
  })
})

describe("an animation recipe", () => {
  it("round-trips its frames, anchor, frame rate, and loop", () => {
    const recipe: Recipe = {
      ...defaultRecipe,
      removeBackground: true,
      sheet: {
        frames: [frameOf({ x: 1, y: 2, width: 30, height: 40 }), { box: { x: 40, y: 2, width: 30, height: 40 }, include: false, nudge: { x: 1, y: -2 } }],
        anchor: "center",
        fps: 12,
        loop: "pingpong",
        padding: 2
      }
    }
    expect(decodeRecipe(encodeRecipe(recipe))).toEqual({ ok: true, value: recipe })
    expect(decodeRecipe(encodeRecipe(defaultRecipe))).toEqual({ ok: true, value: defaultRecipe })
  })

  it("reports bad frames", () => {
    const decoded = decodeRecipe('{"sheet": {"frames": [{"box": {"x": 0, "y": 0, "width": 0, "height": 4}}], "fps": 0}}')
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) {
      expect(decoded.error).toContain("sheet.frames[0]")
      expect(decoded.error).toContain("sheet.fps")
    }
  })
})
