import { describe, expect, it } from "vitest"

import type { Rgb } from "@typeonce/ritmo-tools/pixel/core/color.ts"
import { quantize, sampleCells, TRANSPARENT, type PixelArt } from "@typeonce/ritmo-tools/pixel/core/fix.ts"
import { refineGrid, uniformGrid, type RgbaImage } from "@typeonce/ritmo-tools/pixel/core/grid.ts"
import { hasOutlines, outlineMask, thinOutlines } from "@typeonce/ritmo-tools/pixel/core/outline.ts"
import { presets } from "@typeonce/ritmo-tools/pixel/core/palette.ts"
import { runRecipe } from "@typeonce/ritmo-tools/pixel/core/pipeline.ts"
import { decodeRecipe, defaultRecipe, type Recipe } from "@typeonce/ritmo-tools/pixel/core/recipe.ts"
import { reduce, smoothStairs } from "@typeonce/ritmo-tools/pixel/core/reduce.ts"
import { makeSprite, upscale, warped } from "./synthetic.ts"

const W: Rgb = { r: 250, g: 246, b: 236 }
const K: Rgb = { r: 12, g: 10, b: 24 }
const B: Rgb = { r: 90, g: 120, b: 220 }
const palette = [W, K, B]
const keys = "WKB"

/** A picture from rows of letters (W, K, B); "." is transparent. */
const art = (...rows: ReadonlyArray<string>): PixelArt => ({
  width: rows[0]!.length,
  height: rows.length,
  palette,
  indices: Int32Array.from(rows.join(""), (letter) => (letter === "." ? TRANSPARENT : keys.indexOf(letter)))
})

const letters = (picture: PixelArt): Array<string> =>
  Array.from({ length: picture.height }, (_, y) =>
    Array.from(picture.indices.subarray(y * picture.width, (y + 1) * picture.width), (index) => (index === TRANSPARENT ? "." : keys[index]!)).join("")
  )

/** A light 120 × 120 picture (12 × 12 cells of 10 px) with a dark vertical stroke from `from` to `to`, rows 10 to 110. */
const stroked = (from: number, to: number): RgbaImage => {
  const data = new Uint8ClampedArray(120 * 120 * 4)
  for (let y = 0; y < 120; y++) {
    for (let x = 0; x < 120; x++) {
      const color = x >= from && x < to && y >= 10 && y < 110 ? K : W
      data.set([color.r, color.g, color.b, 255], (y * 120 + x) * 4)
    }
  }
  return { width: 120, height: 120, data }
}

const cells = { cellWidth: 10, cellHeight: 10, offsetX: 0, offsetY: 0 }
const fixWith = (image: RgbaImage, recipe: Partial<Recipe> = {}) =>
  runRecipe(image, { ...defaultRecipe, grid: { kind: "cells", spec: cells }, palette: { name: "Test", colors: palette, locked: [] }, ...recipe })!

/** The columns holding outline pixels, in row 5 of the fixed picture. */
const darkColumns = (picture: PixelArt): Array<number> =>
  Array.from({ length: picture.width }, (_, x) => x).filter((x) => picture.indices[5 * picture.width + x] === 1)

describe("outlines", () => {
  it("judges a picture's dark strokes one cell wide, and finds none in a picture without", () => {
    expect(hasOutlines(outlineMask(stroked(44, 56)), 10)).toBe(true)
    expect(hasOutlines(outlineMask(stroked(30, 90)), 10)).toBe(false)
    expect(hasOutlines(outlineMask(stroked(0, 0)), 10)).toBe(false)
  })

  it("gives a stroke split by a grid line back to one pixel", () => {
    // 12 px wide across cells 4 and 5: the middle of both reads as dark.
    const image = stroked(44, 56)
    expect(darkColumns(fixWith(image, { outlines: "off" }).art)).toEqual([4, 5])
    const fixed = fixWith(image, { outlines: "auto" })
    expect(fixed.outlines).toBe(true)
    expect(darkColumns(fixed.art)).toHaveLength(1)
    // The whole stroke, top to bottom, stays one unbroken column.
    const column = darkColumns(fixed.art)[0]!
    for (let y = 1; y < 11; y++) expect(fixed.art.indices[y * 12 + column]).toBe(1)
  })

  it("keeps a stroke really two pixels thick", () => {
    expect(darkColumns(fixWith(stroked(40, 60), { outlines: "on" }).art)).toEqual([4, 5])
  })

  it("leaves a staircase outline whole", () => {
    const stairs = art("WWWWWW", "KKWWWW", "WKKWWW", "WWKKWW", "WWWKKW", "WWWWKK")
    const image = upscale(stairs, { scale: 10, offset: 0, blur: 1 })
    const grid = uniformGrid(image.width, image.height, cells)
    const fixed = quantize(sampleCells(image, grid, { inset: 0.25, alphaThreshold: 128 }), { palette, metric: "oklab", dither: "none", ditherStrength: 0 })
    expect(letters(thinOutlines(fixed, grid, outlineMask(image)))).toEqual(letters(stairs))
  })
})

describe("bent grids", () => {
  const sweetie = presets.find((entry) => entry.name === "Sweetie 16")!.colors.slice(0, 6)

  it("follows a warped grid that straight lines cannot", () => {
    for (const seed of [1, 2, 3]) {
      const sprite = makeSprite(24, 24, sweetie, seed)
      const image = warped(sprite, 10, 0, 0.45, 12)
      const run = (follow: Recipe["follow"]) =>
        runRecipe(image, { ...defaultRecipe, follow, outlines: "off", grid: { kind: "cells", spec: cells }, palette: { name: "Sweetie", colors: sprite.palette, locked: [] } })!.art
      const wrong = (fixed: PixelArt): number => fixed.indices.filter((index, i) => index !== sprite.indices[i]).length
      expect(wrong(run("off"))).toBeGreaterThan(0)
      expect(wrong(run("bend"))).toBe(0)
    }
  })

  it("puts each bent line within a pixel or so of where the cells meet", () => {
    const sprite = makeSprite(24, 24, sweetie, 4)
    const image = warped(sprite, 10, 0, 0.3, 12)
    const grid = refineGrid(image, uniformGrid(image.width, image.height, cells), { bend: true })
    let total = 0
    let count = 0
    for (let i = 1; i < grid.xs.length - 1; i++) {
      for (let j = 0; j < grid.ys.length - 1; j++) {
        const y = (grid.ys[j]! + grid.ys[j + 1]!) / 2
        total += Math.abs(grid.bend!.xs[i]![j]! - (i * 10 + 3 * Math.sin((2 * Math.PI * y) / 120)))
        count++
      }
    }
    expect(total / count).toBeLessThan(1)
    // Straight, each line sits where its bends average out.
    expect(Math.abs(grid.xs[12]! - 120)).toBeLessThan(1)
  })
})

describe("shrinking with outlines", () => {
  /** Groups of outline pixels touching (diagonals count). */
  const strokes = (picture: PixelArt): number => {
    const seen = new Uint8Array(picture.indices.length)
    let groups = 0
    picture.indices.forEach((index, start) => {
      if (index !== 1 || seen[start] === 1) return
      groups++
      const stack = [start]
      seen[start] = 1
      while (stack.length > 0) {
        const i = stack.pop()!
        const x = i % picture.width
        const y = (i - x) / picture.width
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            const n = ny * picture.width + nx
            if (nx >= 0 && ny >= 0 && nx < picture.width && ny < picture.height && picture.indices[n] === 1 && seen[n] === 0) {
              seen[n] = 1
              stack.push(n)
            }
          }
        }
      }
    })
    return groups
  }

  it("keeps a one-pixel ring whole, where the most covering outline color loses its sides", () => {
    const ring = art(
      "................",
      "....KKKKKKKK....",
      "..KKKBBBBBBKKK..",
      "..KBBBBBBBBBBK..",
      ".KKBBBBBBBBBBKK.",
      ".KBBBBBBBBBBBBK.",
      ".KBBBBBBBBBBBBK.",
      ".KBBBBBBBBBBBBK.",
      ".KBBBBBBBBBBBBK.",
      ".KBBBBBBBBBBBBK.",
      ".KBBBBBBBBBBBBK.",
      ".KKBBBBBBBBBBKK.",
      "..KBBBBBBBBBBK..",
      "..KKKBBBBBBKKK..",
      "....KKKKKKKK....",
      "................"
    )
    const reduced = reduce(ring, 11, 11, "outlines")
    expect(letters(reduced)).toEqual([
      "...........",
      "..KKKKKKK..",
      ".KBBBBBBBK.",
      ".KBBBBBBBK.",
      ".KBBBBBBBK.",
      ".KBBBBBBBK.",
      ".KBBBBBBBK.",
      ".KBBBBBBBK.",
      ".KBBBBBBBK.",
      "..KKKKKKK..",
      "..........."
    ])
    expect(strokes(reduced)).toBe(1)
  })

  it("turns a one-pixel step in a stroke into a diagonal", () => {
    const picture = art("WKWWW", "WKKKK", "WWWWW")
    const indices = new Int32Array(picture.indices)
    smoothStairs(indices, picture.width, picture.height, (index) => index === 1)
    expect(letters({ ...picture, indices })).toEqual(["WKWWW", "WWKKK", "WWWWW"])
  })

  it("keeps a real corner", () => {
    const picture = art("KWWW", "KWWW", "KKKK")
    const indices = new Int32Array(picture.indices)
    smoothStairs(indices, picture.width, picture.height, (index) => index === 1)
    expect(letters({ ...picture, indices })).toEqual(letters(picture))
  })
})

describe("recipe", () => {
  it("reads how lines follow and the outline handling", () => {
    const decoded = decodeRecipe('{"follow": "bend", "outlines": "off"}')
    expect(decoded.ok && [decoded.value.follow, decoded.value.outlines]).toEqual(["bend", "off"])
    const defaults = decodeRecipe("{}")
    expect(defaults.ok && [defaults.value.follow, defaults.value.outlines]).toEqual(["off", "auto"])
    const wrong = decodeRecipe('{"follow": true, "outlines": "maybe"}')
    expect(wrong.ok).toBe(false)
    if (!wrong.ok) {
      expect(wrong.error).toContain("follow must be one of off, straight, bend")
      expect(wrong.error).toContain("outlines must be one of auto, on, off")
    }
  })
})
