import { describe, expect, it } from "vitest"

import { backgroundColors, clearMasked, findBackground } from "../src/core/background.ts"
import { applyEdits } from "../src/core/edits.ts"
import { pack, toHex, type Rgb } from "../src/core/color.ts"
import { quantize, sampleCells, TRANSPARENT, type CellSamples, type PixelArt } from "../src/core/fix.ts"
import { defaultLostThreshold, lostColors } from "../src/core/lost.ts"
import { detectGrid, uniformGrid } from "../src/core/grid.ts"
import { runRecipe } from "../src/core/pipeline.ts"
import { defaultRecipe } from "../src/core/recipe.ts"
import { proposePalette } from "../src/core/palette.ts"
import { reduce } from "../src/core/reduce.ts"
import { upscale } from "./synthetic.ts"

const colors: Record<string, Rgb> = {
  W: { r: 255, g: 255, b: 255 },
  P: { r: 246, g: 214, b: 236 },
  K: { r: 10, g: 8, b: 20 },
  B: { r: 120, g: 150, b: 230 },
  S: { r: 240, g: 200, b: 170 }
}
const keys = Object.keys(colors)
const palette = keys.map((key) => colors[key]!)

/** A picture from rows of letters (see `colors`); "." is transparent. */
const art = (...rows: ReadonlyArray<string>): PixelArt => ({
  width: rows[0]!.length,
  height: rows.length,
  palette,
  indices: Int32Array.from(rows.join(""), (letter) => (letter === "." ? TRANSPARENT : keys.indexOf(letter)))
})

const letters = (picture: PixelArt): Array<string> =>
  Array.from({ length: picture.height }, (_, y) =>
    Array.from(picture.indices.subarray(y * picture.width, (y + 1) * picture.width), (index) =>
      index === TRANSPARENT ? "." : keys[palette.indexOf(picture.palette[index]!)]!
    ).join("")
  )

// A fake checkerboard behind a black outline, with a white highlight and a white gap inside it.
const scene = art(
  "WWPPWWPPWW",
  "WWPKKKKPWW",
  "PPKBBWBKPP",
  "PPKBKKBKPP",
  "WWKBKWKKWW",
  "WWKBKKBKWW",
  "PPKSSSSKPP",
  "PPPKKKKPPP"
)

describe("background", () => {
  it("finds both colors of a fake checkerboard on the border", () => {
    expect(backgroundColors(scene).map((index) => keys[index]).sort()).toEqual(["P", "W"])
  })

  it("floods in from the border and stops at the outline", () => {
    const mask = findBackground(scene, backgroundColors(scene), { tolerance: 0.02, enclosed: false, specks: false })
    expect(letters(clearMasked(scene, mask))).toEqual([
      "..........",
      "...KKKK...",
      "..KBBWBK..",
      "..KBKKBK..",
      "..KBKWKK..",
      "..KBKKBK..",
      "..KSSSSK..",
      "...KKKK..."
    ])
  })

  it("removes enclosed background-colored areas only when asked", () => {
    const mask = findBackground(scene, backgroundColors(scene), { tolerance: 0.02, enclosed: true, specks: false })
    const cleared = letters(clearMasked(scene, mask))
    expect(cleared[2]).toBe("..KBB.BK..")
    expect(cleared[4]).toBe("..KBK.KK..")
  })

  it("erases and restores by hand, a pixel or a whole area, in order", () => {
    const mask = findBackground(scene, backgroundColors(scene), { tolerance: 0.02, enclosed: false, specks: false })
    const edited = letters(
      clearMasked(
        scene,
        applyEdits(scene, mask, [
          { x: 5, y: 4, tool: "erase", area: false },
          { x: 3, y: 2, tool: "erase", area: true },
          { x: 0, y: 0, tool: "restore", area: true },
          { x: 9, y: 7, tool: "restore", area: false }
        ], "oklab").mask
      )
    )
    expect(edited[0]).toBe("WW........")
    expect(edited[1]).toBe("WW.KKKK...")
    expect(edited[2]).toBe("..K..WBK..")
    expect(edited[4]).toBe("..K.K.KK..")
    expect(edited[7]).toBe("...KKKK..P")
  })

  it("paints one pixel or a whole area with the nearest palette color, in order with erasing", () => {
    const mask = findBackground(scene, backgroundColors(scene), { tolerance: 0.02, enclosed: false, specks: false })
    const edited = applyEdits(scene, mask, [
      // A near-black off the palette snaps to K.
      { x: 5, y: 2, tool: "paint", color: { r: 20, g: 18, b: 30 }, area: false },
      { x: 3, y: 6, tool: "paint", color: colors.B!, area: true },
      // Painting shows an erased pixel again; erasing it after takes it away.
      { x: 0, y: 3, tool: "paint", color: colors.S!, area: false },
      { x: 0, y: 4, tool: "paint", color: colors.S!, area: false },
      { x: 0, y: 4, tool: "erase", area: false }
    ], "oklab")
    const cleared = letters(clearMasked(edited.art, edited.mask))
    expect(cleared[2]).toBe("..KBBKBK..")
    expect(cleared[3]).toBe("S.KBKKBK..")
    expect(cleared[4]).toBe("..KBKWKK..")
    expect(cleared[6]).toBe("..KBBBBK..")
    expect(edited.painted).toEqual([25, 30, 63, 64, 65, 66])
  })

  it("removes specks left alone in the background, and only when asked", () => {
    const specked = art("WWWWWWWW", "WPWWKKWW", "WWWKBBKW", "WWWKBBKW", "WWWWKKWW", "WWWWWWWW")
    const colors = backgroundColors(specked)
    const kept = letters(clearMasked(specked, findBackground(specked, colors, { tolerance: 0.02, enclosed: false, specks: false })))
    expect(kept[1]).toBe(".P..KK..")
    const cleaned = letters(clearMasked(specked, findBackground(specked, colors, { tolerance: 0.02, enclosed: false, specks: true })))
    expect(cleaned).toEqual(["........", "....KK..", "...KBBK.", "...KBBK.", "....KK..", "........"])
  })

  it("treats pixels that are already transparent as background", () => {
    const picture = art("....", ".KK.", ".KK.", "....")
    expect(backgroundColors(picture)).toEqual([])
    const mask = findBackground(picture, [], { tolerance: 0.08, enclosed: false, specks: false })
    expect(Array.from(mask)).toEqual([1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 1])
  })

  it("removes a fake checkerboard from a blurry upscaled picture", () => {
    const image = upscale(scene, { scale: 9.4, offset: 3, blur: 1, noise: 3, seed: 2 })
    const detection = detectGrid(image)!
    const grid = uniformGrid(image.width, image.height, detection.spec)
    const fixed = quantize(sampleCells(image, grid, { inset: 0.25, alphaThreshold: 128 }), {
      palette: [],
      metric: "oklab",
      dither: "none",
      ditherStrength: 0
    })
    expect(fixed.width).toBe(scene.width)
    const mask = findBackground(fixed, backgroundColors(fixed), { tolerance: 0.08, enclosed: false, specks: false })
    const expected = findBackground(scene, backgroundColors(scene), { tolerance: 0.02, enclosed: false, specks: false })
    expect(Array.from(mask)).toEqual(Array.from(expected))
  })

  it("keeps the outline when the palette has no color for the background", () => {
    // A grey background whose nearest palette color is the dark outline: found in the palette's colors, the outline would go with it.
    const grey = { r: 60, g: 70, b: 68 }
    const outline = { r: 18, g: 43, b: 52 }
    const ice = { r: 162, g: 221, b: 249 }
    const rows = ["GGGGGGGG", "GGGTTGGG", "GGTIITGG", "GTIIIITG", "GGTIITGG", "GGGTTGGG", "GGGGGGGG"]
    const own = [grey, outline, ice]
    const sprite: PixelArt = {
      width: 8,
      height: 7,
      palette: own,
      indices: Int32Array.from(rows.join(""), (letter) => "GTI".indexOf(letter))
    }
    const image = upscale(sprite, { scale: 9.4, offset: 3, blur: 1, noise: 3, seed: 2 })
    const fixed = runRecipe(image, { ...defaultRecipe, palette: { name: "Dark", colors: [outline, ice], locked: [] }, removeBackground: true })!
    const kept = Array.from(fixed.art.indices, (index) => (index === TRANSPARENT ? "." : "TI"[index]!)).join("")
    expect(kept).toBe(rows.join("").replaceAll("G", "."))
  })
})

describe("reduce", () => {
  it("halves a picture by the most common color of each block", () => {
    const picture = art("BBSS", "BWSS", "KKWW", "KKWP")
    expect(letters(reduce(picture, 2, 2, "common"))).toEqual(["BS", "KW"])
  })

  it("keeps a one-pixel outline that the most common color would drop", () => {
    const picture = art("KKKKKK", "WWWWWW", "WWWWWW", "WWWWWW", "WWWWWW", "WWWWWW")
    expect(letters(reduce(picture, 3, 2, "common"))).toEqual(["WWW", "WWW"])
    expect(letters(reduce(picture, 3, 2, "outlines"))).toEqual(["KKK", "WWW"])
  })

  it("does not grow a lone dark pixel into a block", () => {
    const picture = art("WWWW", "WKWW", "WWWW", "WWWW")
    expect(letters(reduce(picture, 2, 2, "outlines"))).toEqual(["WW", "WW"])
  })

  it("merges blocks of any ratio, transparent ones included", () => {
    const picture = art("..KKKK", "..KBBK", "..KKKK")
    const reduced = reduce(picture, 4, 2, "common")
    expect(reduced.width).toBe(4)
    expect(reduced.height).toBe(2)
    expect(letters(reduced)[0]![0]).toBe(".")
    expect(reduce(picture, 6, 3, "common")).toBe(picture)
  })
})

describe("palette proposals", () => {
  const cells = (counts: ReadonlyArray<readonly [Rgb, number]>): Array<Rgb> => counts.flatMap(([color, n]) => Array<Rgb>(n).fill(color))
  const nearWhite = { r: 250, g: 250, b: 250 }
  const accent = { r: 230, g: 20, b: 40 }
  const sample = cells([
    [colors.W!, 400],
    [nearWhite, 300],
    [colors.B!, 200],
    [colors.K!, 95],
    [accent, 5]
  ])

  it("dominant: the most used colors, near-duplicates merged, with their shares", () => {
    const proposals = proposePalette(sample, 3, "dominant")
    expect(proposals.map((proposal) => toHex(proposal.color))).toEqual([toHex(colors.W!), toHex(colors.B!), toHex(colors.K!)])
    expect(proposals[0]!.share).toBeCloseTo(0.7, 5)
  })

  it("distinct: keeps a small accent the dominant colors would drop", () => {
    const hexes = proposePalette(sample, 3, "distinct").map((proposal) => toHex(proposal.color))
    expect(hexes).toContain(toHex(accent))
    expect(proposePalette(sample, 3, "dominant").map((proposal) => toHex(proposal.color))).not.toContain(toHex(accent))
  })

  it("never proposes near-duplicates, even when asked for more colors than the picture has", () => {
    for (const method of ["dominant", "balanced", "distinct"] as const) {
      expect(proposePalette(sample, 10, method)).toHaveLength(4)
    }
  })

  it("balanced: k-means colors whose shares add up to the whole picture", () => {
    const proposals = proposePalette(sample, 4, "balanced")
    expect(proposals).toHaveLength(4)
    expect(proposals.reduce((sum, proposal) => sum + proposal.share, 0)).toBeCloseTo(1, 5)
    for (let i = 1; i < proposals.length; i++) expect(proposals[i]!.share).toBeLessThanOrEqual(proposals[i - 1]!.share)
  })
})

describe("lost colors", () => {
  const white = { r: 240, g: 244, b: 250 }
  const black = { r: 6, g: 6, b: 20 }
  const blue = { r: 120, g: 144, b: 200 }
  const skin = { r: 240, g: 220, b: 204 }
  const deepBlue = { r: 50, g: 70, b: 170 }
  const grey = { r: 140, g: 140, b: 140 }
  // One cell per letter, each read as a few slightly noisy pixels of its color.
  const own: Record<string, Rgb> = { W: white, K: black, B: blue, S: skin, D: deepBlue, G: grey }
  const rows = ["WWWWWW", "WBBDDW", "WBDDBW", "WKKGGW", "WKSSGW", "WWWWWW"]
  const samples: CellSamples = {
    width: 6,
    height: 6,
    cells: rows.join("").split("").map((letter, i) => {
      const color = own[letter]!
      const jitter = (i % 3) - 1
      return { colors: [0, jitter, -jitter].map((d) => pack(color.r + d, color.g + d, color.b + d)), transparent: 0 }
    })
  }
  const snap = (palette: ReadonlyArray<Rgb>): PixelArt => quantize(samples, { palette, metric: "oklab", dither: "none", ditherStrength: 0 })

  it("lists the colors a palette has no match for, most cells first, with what they became", () => {
    const art = snap([white, black, blue, skin])
    const found = lostColors(samples, art, defaultLostThreshold)
    expect(found.map((entry) => entry.cells.length)).toEqual([4, 3])
    expect(toHex(found[0]!.became)).toBe(toHex(blue))
    expect(found[0]!.cells).toEqual([9, 10, 14, 15])
    expect(found[1]!.cells).toEqual([21, 22, 28])
  })

  it("forgets a lost color once the palette has it", () => {
    const art = snap([white, black, blue, skin, deepBlue, grey])
    expect(lostColors(samples, art, defaultLostThreshold)).toEqual([])
  })

  it("leaves out skipped cells and colors lost in too few cells", () => {
    const art = snap([white, black, blue, skin])
    const skip = new Uint8Array(36)
    for (const i of [9, 10, 14]) skip[i] = 1
    expect(lostColors(samples, art, defaultLostThreshold, skip).map((entry) => entry.cells.length)).toEqual([3])
    expect(lostColors(samples, art, defaultLostThreshold, undefined, 4).map((entry) => entry.cells.length)).toEqual([4])
  })
})
