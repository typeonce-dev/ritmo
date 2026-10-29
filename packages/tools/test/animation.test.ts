import { describe, expect, it } from "vitest"

import { detectFrames, isAnimationSheet, runSheet } from "@typeonce/ritmo-tools/pixel/core/animation.ts"
import type { Rgb } from "@typeonce/ritmo-tools/pixel/core/color.ts"
import { demoImage } from "@typeonce/ritmo-tools/pixel/core/demo.ts"
import { TRANSPARENT, type PixelArt } from "@typeonce/ritmo-tools/pixel/core/fix.ts"
import { toGif } from "@typeonce/ritmo-tools/pixel/core/gif.ts"
import { presets } from "@typeonce/ritmo-tools/pixel/core/palette.ts"
import { decodeRecipe, defaultRecipe, encodeRecipe, type Recipe } from "@typeonce/ritmo-tools/pixel/core/recipe.ts"
import {
  clearSheet,
  defaultSheet,
  findFrames,
  frameOf,
  groupFrames,
  insertFrame,
  joinAnimation,
  layOut,
  looksAnimated,
  playOrder,
  removeFrame,
  removeGridLines,
  renameAnimation,
  sheetBackground,
  splitAnimation,
  withFrames,
  type Sheet
} from "@typeonce/ritmo-tools/pixel/core/sheet.ts"
import { atlasOf, spritesheetJson } from "@typeonce/ritmo-tools/pixel/core/spritesheet.ts"
import { crc32, toZip } from "@typeonce/ritmo-tools/pixel/core/zip.ts"
import { fakeSheet, makeSprite, place } from "./synthetic.ts"

const sweetie = presets.find((palette) => palette.name === "Sweetie 16")!.colors
// Warm colors with a dark purple outline: none as dark as the background.
const fire: ReadonlyArray<Rgb> = [sweetie[2]!, sweetie[3]!, sweetie[4]!, sweetie[1]!]

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

  it("splits blocks side by side whose rows do not line up, keeps a thrown bomb in its frame, and keeps a last faint frame, still an animation", () => {
    // Already cleared: opaque art on transparency. Left, walking: 4 frames in each of two rows.
    // Right, throwing: 4 frames, each a body and a bomb 3 pixels from it, in one row that spans
    // the gap between the left block's rows. Below, an explosion ending in a wisp of 3x3 pixels.
    const width = 600
    const height = 140
    const data = new Uint8ClampedArray(width * height * 4)
    const fill = (x: number, y: number, w: number, h: number): void => {
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) data.set([200, 60, 40, 255], (j * width + i) * 4)
    }
    const walking = [10, 60, 110, 160]
    for (const x of walking) {
      fill(x, 10, 30, 30)
      fill(x, 52, 30, 30)
    }
    const throwing = [224, 289, 354, 419]
    for (const x of throwing) {
      fill(x, 20, 30, 42)
      fill(x + 33, 50, 8, 8)
    }
    for (const x of walking) fill(x, 95, 30, 30)
    fill(210, 108, 3, 3)

    const boxes = findFrames({ width, height, data })
    const holding = (x: number, y: number, w: number, h: number) =>
      boxes.filter((box) => box.x <= x && box.y <= y && box.x + box.width >= x + w && box.y + box.height >= y + h)
    expect(boxes).toHaveLength(17)
    for (const x of walking) {
      expect(holding(x, 10, 30, 30)).toHaveLength(1)
      expect(holding(x, 52, 30, 30)).toHaveLength(1)
      expect(holding(x, 95, 30, 30)).toHaveLength(1)
    }
    // Each throw is one frame with its bomb.
    for (const x of throwing) expect(holding(x, 20, 41, 42)).toHaveLength(1)
    expect(holding(210, 108, 3, 3)).toHaveLength(1)
    // The faint last frame does not make the sheet a picture.
    expect(looksAnimated({ width, height, data }, boxes)).toBe(true)
    // Walking's two rows, throwing's row, and the explosion: four animations, the wisp in the explosion.
    expect(groupFrames(boxes).map((animation) => animation.frames.length)).toEqual([4, 4, 4, 5])
  })

  it("paints out a grid whose lines are as dark as the art's outline, and keeps the outline", () => {
    // A navy fill with black lines every 10 pixels, and a black-outlined red square across two lines.
    const width = 60
    const height = 60
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const inside = x >= 15 && x < 45 && y >= 15 && y < 45
        const edge = inside && (x < 17 || x >= 43 || y < 17 || y >= 43)
        const color = edge ? [0, 4, 14] : inside ? [200, 40, 30] : x % 10 === 0 || y % 10 === 0 ? [0, 5, 15] : [28, 36, 53]
        data.set([...color, 255], i)
      }
    }
    const image = { width, height, data }
    const colors = sheetBackground(image)
    expect(colors).toHaveLength(2)
    const unlined = removeGridLines(image, colors, 0.05)
    expect(unlined.colors).toHaveLength(1)
    const { mask } = clearSheet(unlined.image, unlined.colors, 0.05)
    // The background is clear, lines included; the outline and the inside are not.
    expect(mask[5 * width + 5]).toBe(1)
    expect(mask[10 * width + 5]).toBe(1)
    expect(mask[30 * width + 10]).toBe(1)
    expect(mask[30 * width + 15]).toBe(0)
    expect(mask[15 * width + 30]).toBe(0)
    expect(mask[30 * width + 30]).toBe(0)
  })

  it("does not take a single picture for a sheet", () => {
    const image = demoImage()
    expect(looksAnimated(image, findFrames(image))).toBe(false)
  })

  it("reads every frame on one cell size, one palette, and one canvas, with the feet on one row", () => {
    const sheet: Sheet = { ...withFrames(defaultSheet, detectFrames(image, sheetRecipe)), anchor: "feet" }
    const outcome = runSheet(image, sheetRecipe, sheet)
    expect(outcome.cell.width).toBeGreaterThan(5.5)
    expect(outcome.cell.width).toBeLessThan(6.5)
    // One row of frames: one animation.
    expect(outcome.clips).toHaveLength(1)
    const clip = outcome.clips[0]!
    expect(clip.placed).toHaveLength(5)
    const palette = clip.placed[0]!.art.palette
    for (const frame of clip.placed) {
      expect(frame.art.palette).toBe(palette)
      expect(frame.art.width).toBe(clip.width)
      expect(frame.art.height).toBe(clip.height)
      // Feet anchoring: the bob is gone, every frame's lowest pixel is on one row.
      expect(Math.max(...opaqueRows(frame.art))).toBe(Math.max(...opaqueRows(clip.placed[0]!.art)))
    }
    // About the sprite's own size (12 by 14 with the bob, plus padding).
    expect(clip.width).toBeGreaterThanOrEqual(10)
    expect(clip.width).toBeLessThanOrEqual(15)
  })

  it("keeps each frame's height as drawn on the ground anchor, so the bob stays", () => {
    // Frames on one pixel grid, as a generator draws them: their heights are whole pixels apart.
    // The cell size is given: on a sprite this small, finding it is off by a percent, and that alone moves rows.
    const { image: onGrid } = fakeSheet(frames, 6, 5, false)
    const recipe: Recipe = { ...sheetRecipe, grid: { kind: "cells", spec: { cellWidth: 6, cellHeight: 6, offsetX: 0, offsetY: 0 } } }
    const sheet: Sheet = withFrames(defaultSheet, detectFrames(onGrid, recipe))
    const placed = runSheet(onGrid, recipe, sheet).clips[0]!.placed
    const lowest = placed.map((frame) => Math.max(...opaqueRows(frame.art)))
    // The sprite is one pixel lower on odd frames.
    expect(lowest.map((row) => row - lowest[0]!)).toEqual([0, 1, 0, 1, 0])
    // Sideways, the bodies still line up.
    const left = placed.map((frame) => Math.min(...frame.art.indices.map((index, p) => (index === TRANSPARENT ? Infinity : p % frame.art.width))))
    expect(new Set(left).size).toBe(1)
  })

  it("leaves out an excluded frame and keeps the rest", () => {
    const found = detectFrames(image, sheetRecipe)
    const sheet: Sheet = withFrames(defaultSheet, found.map((frame, i) => (i === 2 ? { ...frame, include: false } : frame)))
    const outcome = runSheet(image, sheetRecipe, sheet)
    expect(outcome.clips[0]!.placed.map((frame) => frame.index)).toEqual([0, 1, 3, 4])
  })
})

describe("animations on a sheet", () => {
  const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

  it("makes one animation per row, splits a row across two blocks where they meet, and keeps a row of another count whole", () => {
    const boxes = [
      // Across both blocks: 4 walking frames over the left block, 4 throws over the right one.
      ...[0, 20, 40, 60].map((x) => box(x, 0, 20, 20)),
      ...[100, 130, 160, 190].map((x) => box(x, 0, 30, 20)),
      // The left block's next two rows, beside one taller row of the right block.
      ...[0, 20, 40, 60].map((x) => box(x, 20, 20, 20)),
      ...[100, 130, 160, 190].map((x) => box(x, 20, 30, 40)),
      ...[0, 20, 40, 60].map((x) => box(x, 40, 20, 20)),
      // An explosion under both, with a box edge right where the blocks meet: 6 frames, not 4 and 4.
      ...[0, 30, 60, 90, 120, 150].map((x) => box(x, 60, 30, 20))
    ]
    const animations = groupFrames(boxes)
    expect(animations.map((animation) => animation.frames)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [8, 9, 10, 11],
      [12, 13, 14, 15],
      [16, 17, 18, 19],
      [20, 21, 22, 23, 24, 25]
    ])
    expect(animations.map((animation) => animation.name)).toEqual(["animation-1", "animation-2", "animation-3", "animation-4", "animation-5", "animation-6"])
  })

  it("keeps every frame in one animation as frames and animations change", () => {
    let sheet = withFrames(defaultSheet, [0, 20, 40, 60].map((x) => frameOf(box(x, 0, 20, 20))))
    expect(sheet.animations.map((animation) => animation.frames)).toEqual([[0, 1, 2, 3]])
    sheet = splitAnimation(sheet, 0, 2)
    expect(sheet.animations.map((animation) => [animation.name, animation.frames])).toEqual([
      ["animation-1", [0, 1]],
      ["animation-1-2", [2, 3]]
    ])
    // A frame added after frame 1 joins its animation, and the later frames move up one.
    sheet = insertFrame(sheet, 2, frameOf(box(80, 0, 20, 20)))
    expect(sheet.animations.map((animation) => animation.frames)).toEqual([
      [0, 1, 2],
      [3, 4]
    ])
    // Removing every frame of an animation removes the animation.
    sheet = removeFrame(removeFrame(sheet, 3), 3)
    expect(sheet.animations.map((animation) => animation.frames)).toEqual([[0, 1, 2]])
    sheet = splitAnimation(sheet, 0, 1)
    sheet = renameAnimation(sheet, 1, "walk left")
    expect(sheet.animations[1]!.name).toBe("walk-left")
    // A taken name gets a number; one a game cannot look up is refused.
    expect(renameAnimation(sheet, 0, "walk-left").animations[0]!.name).toBe("walk-left-2")
    expect(renameAnimation(sheet, 0, "walk/left").animations[0]!.name).toBe("animation-1")
    sheet = joinAnimation(sheet, 0)
    expect(sheet.animations.map((animation) => [animation.name, animation.frames])).toEqual([["animation-1", [0, 1, 2]]])
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

  it("lays each animation out from a new row and names its frames", () => {
    const fire = { name: "fire", frames: [0, 1, 2, 3, 4].map(() => dot(1, 1)), anchor: { x: 1, y: 3 }, fps: 10, loop: "pingpong" as const }
    // A second animation of another size: it starts its own row, under the first.
    const big = (): PixelArt => ({ width: 6, height: 2, palette: fire.frames[0]!.palette, indices: new Int32Array(12).fill(0) })
    const smoke = { name: "smoke", frames: [big(), big()], anchor: { x: 3, y: 1 }, fps: 5, loop: "forward" as const }
    const layout = { columns: 2, spacing: 1 }
    const atlas = atlasOf([fire, smoke], layout)
    // Fire: 3 rows of 4 high with 1 between (14), then 1, then smoke: 1 row of 2 (17).
    expect(atlas.art.width).toBe(13)
    expect(atlas.art.height).toBe(17)
    const json = JSON.parse(spritesheetJson({ image: "fx.png", clips: [fire, smoke], atlas, scale: 2 }))
    expect(json.frames["fire 3"].frame).toEqual({ x: 10, y: 10, w: 8, h: 8 })
    expect(json.frames["fire 0"].duration).toBe(100)
    expect(json.frames["fire 0"].anchor).toEqual({ x: 0.375, y: 1 })
    expect(json.frames["smoke 1"].frame).toEqual({ x: 14, y: 30, w: 12, h: 4 })
    expect(json.frames["smoke 0"].duration).toBe(200)
    expect(json.animations).toEqual({ fire: ["fire 0", "fire 1", "fire 2", "fire 3", "fire 4"], smoke: ["smoke 0", "smoke 1"] })
    expect(json.meta.size).toEqual({ w: 26, h: 34 })
    expect(json.meta.frameTags).toEqual([
      { name: "fire", from: 0, to: 4, direction: "pingpong" },
      { name: "smoke", from: 5, to: 6, direction: "forward" }
    ])
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
  it("round-trips its frames, animations, anchor, and margin", () => {
    const recipe: Recipe = {
      ...defaultRecipe,
      removeBackground: true,
      sheet: {
        frames: [frameOf({ x: 1, y: 2, width: 30, height: 40 }), { box: { x: 40, y: 2, width: 30, height: 40 }, include: false, nudge: { x: 1, y: -2 } }, frameOf({ x: 80, y: 2, width: 30, height: 40 })],
        animations: [
          { name: "walk", frames: [1, 0], include: true, fps: 12, loop: "pingpong" },
          { name: "idle", frames: [2], include: false, fps: 4, loop: "forward" }
        ],
        anchor: "center",
        padding: 2
      }
    }
    expect(decodeRecipe(encodeRecipe(recipe))).toEqual({ ok: true, value: recipe })
    expect(decodeRecipe(encodeRecipe(defaultRecipe))).toEqual({ ok: true, value: defaultRecipe })
  })

  it("reports bad frames, and animations that miss a frame or share one", () => {
    const decoded = decodeRecipe('{"sheet": {"frames": [{"box": {"x": 0, "y": 0, "width": 0, "height": 4}}], "fps": 0}}')
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) {
      expect(decoded.error).toContain("sheet.frames[0]")
      expect(decoded.error).toContain("sheet.fps")
    }
    const box = '{"box": {"x": 0, "y": 0, "width": 4, "height": 4}}'
    const shared = decodeRecipe(`{"sheet": {"frames": [${box}, ${box}, ${box}], "animations": [{"name": "a", "frames": [0, 1]}, {"name": "b", "frames": [1]}]}}`)
    expect(shared.ok === false && shared.error).toContain("frame 1 is in more than one animation")
    expect(shared.ok === false && shared.error).toContain("every frame must be in an animation (1 are not)")
    const named = decodeRecipe(`{"sheet": {"frames": [${box}], "animations": [{"name": "walk left", "frames": [0]}]}}`)
    expect(named.ok === false && named.error).toContain("needs a name")
  })

  it("reads a recipe from before animations as one animation of every frame, at its speed", () => {
    const box = '{"box": {"x": 0, "y": 0, "width": 4, "height": 4}}'
    const decoded = decodeRecipe(`{"sheet": {"frames": [${box}, ${box}], "fps": 12, "loop": "pingpong"}}`)
    expect(decoded.ok && decoded.value.sheet?.animations).toEqual([{ name: "animation-1", frames: [0, 1], include: true, fps: 12, loop: "pingpong" }])
  })
})
