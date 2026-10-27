import { describe, expect, it } from "vitest"

import { cleanUp, type CleanupOptions } from "../src/core/cleanup.ts"
import { pack, type Rgb } from "../src/core/color.ts"
import type { CellSamples, PixelArt } from "../src/core/fix.ts"

const colors: Record<string, Rgb> = {
  C: { r: 252, g: 240, b: 232 },
  G: { r: 196, g: 196, b: 202 },
  B: { r: 90, g: 170, b: 250 },
  K: { r: 4, g: 4, b: 10 },
  S: { r: 246, g: 206, b: 176 }
}
const keys = Object.keys(colors)
const palette = keys.map((key) => colors[key]!)

/**
 * A fixed picture from rows of letters, and the pixels each cell was read
 * from: four of its own color, plus `doubt[i]` letters for cell i (votes
 * for another color, as a blurry or noisy cell has).
 */
const scene = (rows: ReadonlyArray<string>, doubt: Record<number, string> = {}) => {
  const letters = rows.join("")
  const art: PixelArt = {
    width: rows[0]!.length,
    height: rows.length,
    palette,
    indices: Int32Array.from(letters, (letter) => keys.indexOf(letter))
  }
  const samples: CellSamples = {
    width: art.width,
    height: art.height,
    cells: letters.split("").map((letter, i) => ({
      colors: [...letter.repeat(4), ...(doubt[i] ?? "")].map((key) => {
        const color = colors[key]!
        return pack(color.r, color.g, color.b)
      }),
      transparent: 0
    }))
  }
  return { art, samples }
}

const options = (size: number, strength: number, more: Partial<CleanupOptions> = {}): CleanupOptions => ({
  size,
  strength,
  metric: "oklab",
  protect: [],
  keep: [],
  ...more
})

const show = (art: PixelArt): Array<string> =>
  Array.from({ length: art.height }, (_, y) =>
    Array.from(art.indices.subarray(y * art.width, (y + 1) * art.width), (index) => keys[index]!).join("")
  )

describe("clean up", () => {
  it("merges a speck that nearly voted for its surroundings, keeps one drawn clearly", () => {
    // (1, 1) is a blue speck whose cell half voted cream; (3, 1) is a blue speck drawn clearly.
    const { art, samples } = scene(["CCCCC", "CBCBC", "CCCCC"], { 6: "CCC" })
    const cleaned = cleanUp(art, samples, options(1, 0.5))
    expect(show(cleaned.art)).toEqual(["CCCCC", "CCCBC", "CCCCC"])
    expect(cleaned.specks).toEqual([[6]])
    expect(show(cleanUp(art, samples, options(1, 1)).art)).toEqual(["CCCCC", "CCCCC", "CCCCC"])
  })

  it("merges a speck close in color even when it was drawn clearly", () => {
    const { art, samples } = scene(["CCC", "CGC", "CCC"])
    expect(show(cleanUp(art, samples, options(1, 0.5)).art)).toEqual(["CCC", "CCC", "CCC"])
    expect(show(cleanUp(art, samples, options(1, 0)).art)).toEqual(["CCC", "CGC", "CCC"])
  })

  it("keeps two-pixel eyes until told to merge everything, and never when their color is protected", () => {
    const { art, samples } = scene(["SSSSSS", "SKSSKS", "SKSSKS", "SSSSSS"])
    expect(cleanUp(art, samples, options(1, 1)).specks).toEqual([])
    expect(cleanUp(art, samples, options(2, 0.5)).specks).toEqual([])
    expect(cleanUp(art, samples, options(2, 1)).specks).toHaveLength(2)
    expect(cleanUp(art, samples, options(2, 1, { protect: [keys.indexOf("K")] })).specks).toEqual([])
  })

  it("never takes a one-pixel diagonal outline for a speck", () => {
    const { art, samples } = scene(["KCCC", "CKCC", "CCKC", "CCCK"])
    expect(cleanUp(art, samples, options(3, 1)).specks).toEqual([])
  })

  it("leaves a speck brought back by hand", () => {
    const { art, samples } = scene(["CCCCC", "CGCGC", "CCCCC"])
    const cleaned = cleanUp(art, samples, options(1, 1, { keep: [8] }))
    expect(show(cleaned.art)).toEqual(["CCCCC", "CCCGC", "CCCCC"])
  })

  it("does nothing when off", () => {
    const { art, samples } = scene(["CCC", "CGC", "CCC"])
    expect(cleanUp(art, samples, options(0, 1)).art).toBe(art)
  })
})
