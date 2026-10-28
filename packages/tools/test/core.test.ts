import { describe, expect, it } from "vitest"

import { ciede2000, fromOklab, makeMatcher, parseHex, toCielab, toHex, toOklab } from "@typeonce/ritmo-tools/pixel/core/color.ts"
import { demoImage, demoSprite } from "@typeonce/ritmo-tools/pixel/core/demo.ts"
import { toJson, toRects, toRgba, toSvg } from "@typeonce/ritmo-tools/pixel/core/export.ts"
import { cellColors, defaultSampleOptions, quantize, sampleCells, TRANSPARENT, type PixelArt } from "@typeonce/ritmo-tools/pixel/core/fix.ts"
import { detectGrid, edgeProfiles, refineCuts, refineGrid, uniformCuts, uniformGrid } from "@typeonce/ritmo-tools/pixel/core/grid.ts"
import { extractPalette, parsePalette, presets, toGpl, toHexFile } from "@typeonce/ritmo-tools/pixel/core/palette.ts"
import { boundaries, makeSprite, pad, upscale, type Upscale } from "./synthetic.ts"

const sweetie = presets.find((palette) => palette.name === "Sweetie 16")!.colors

const fix = (sprite: PixelArt, options: Upscale, refine = false) => {
  const image = upscale(sprite, options)
  const detection = detectGrid(image)!
  let grid = uniformGrid(image.width, image.height, detection.spec)
  if (refine) {
    const { columns, rows } = edgeProfiles(image)
    grid = { xs: refineCuts(columns, grid.xs, image.width), ys: refineCuts(rows, grid.ys, image.height) }
  }
  const samples = sampleCells(image, grid, { inset: 0.25, alphaThreshold: 128 })
  const art = quantize(samples, { palette: sprite.palette, metric: "oklab", dither: "none", ditherStrength: 0 })
  return { image, detection, grid, art }
}

const mismatches = (expected: PixelArt, actual: PixelArt): number => {
  if (expected.width !== actual.width || expected.height !== actual.height) return Number.POSITIVE_INFINITY
  let count = 0
  for (let i = 0; i < expected.indices.length; i++) if (expected.indices[i] !== actual.indices[i]) count++
  return count
}

describe("colors", () => {
  it("reads and writes hex", () => {
    expect(parseHex("#ff8000")).toEqual({ r: 255, g: 128, b: 0 })
    expect(parseHex("f80")).toEqual({ r: 255, g: 136, b: 0 })
    expect(parseHex("ff800080")).toEqual({ r: 255, g: 128, b: 0 })
    expect(parseHex("nope")).toBeUndefined()
    expect(toHex({ r: 1, g: 2, b: 255 })).toBe("#0102ff")
  })

  it("round-trips OKLab", () => {
    for (const color of sweetie) expect(fromOklab(toOklab(color))).toEqual(color)
  })

  it("matches the published CIEDE2000 test pairs (Sharma et al.)", () => {
    expect(ciede2000({ l: 50, a: 2.6772, b: -79.7751 }, { l: 50, a: 0, b: -82.7485 })).toBeCloseTo(2.0425, 4)
    expect(ciede2000({ l: 50, a: 2.5, b: 0 }, { l: 73, a: 25, b: -18 })).toBeCloseTo(27.1492, 4)
    expect(ciede2000({ l: 2.0776, a: 0.0795, b: -1.135 }, { l: 0.9033, a: -0.0636, b: -0.5514 })).toBeCloseTo(0.9082, 4)
    expect(toCielab({ r: 255, g: 255, b: 255 }).l).toBeCloseTo(100, 3)
  })

  it("finds the nearest palette color by either metric", () => {
    const palette = [
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
      { r: 200, g: 30, b: 30 }
    ]
    for (const metric of ["oklab", "ciede2000"] as const) {
      const matcher = makeMatcher(palette, metric)
      expect(matcher.nearest({ r: 20, g: 10, b: 10 })).toBe(0)
      expect(matcher.nearest({ r: 240, g: 230, b: 235 })).toBe(1)
      expect(matcher.nearest({ r: 180, g: 50, b: 40 })).toBe(2)
    }
  })
})

describe("grid", () => {
  it("keeps partial cells at the edges only when they are at least half a cell", () => {
    expect(uniformCuts(20, 4, 1)).toEqual([1, 5, 9, 13, 17, 20])
    expect(uniformCuts(18, 4, 1)).toEqual([1, 5, 9, 13, 17])
    expect(uniformCuts(20, 4, 3)).toEqual([0, 3, 7, 11, 15, 19])
    expect(uniformCuts(10, 2.5, 0)).toEqual([0, 2.5, 5, 7.5, 10])
  })

  const cases: Array<{ readonly name: string } & Upscale> = [
    { name: "whole 8x", scale: 8, offset: 0 },
    { name: "whole 5x, shifted", scale: 5, offset: 2 },
    { name: "7.6x, blurred and noisy", scale: 7.6, offset: 3, blur: 1, noise: 6 },
    { name: "12.3x, blurred twice", scale: 12.3, offset: 5, blur: 2, noise: 4 },
    { name: "3x, small", scale: 3, offset: 1 }
  ]
  for (const options of cases) {
    it(`finds the grid and gets the sprite back exactly: ${options.name}`, () => {
      const sprite = makeSprite(32, 24, sweetie, 11)
      const { detection, art } = fix(sprite, options)
      expect(detection.spec.cellWidth).toBeCloseTo(options.scale, 1)
      expect(detection.spec.cellHeight).toBeCloseTo(options.scale, 1)
      expect(detection.confidence).toBeGreaterThan(0.5)
      expect(mismatches(sprite, art)).toBe(0)
    })
  }

  it("follows cells that drift across the picture once refined", () => {
    const sprite = makeSprite(40, 40, sweetie, 5)
    const options: Upscale = { scale: 8, offset: 2, drift: 0.12, blur: 1, noise: 4 }
    const refined = fix(sprite, options, true)
    expect(mismatches(sprite, refined.art)).toBe(0)
    // Every refined cut lands within a pixel of where the sprite's cells really meet.
    const truth = boundaries(sprite.width, options)
    for (let i = 1; i < truth.length - 1; i++) expect(Math.abs(refined.grid.xs[i]! - truth[i]!)).toBeLessThanOrEqual(1)
  })

  it("finds the grid of a small sprite in a wide empty background", () => {
    const sprite = pad(makeSprite(16, 12, sweetie, 21), 14)
    const { detection, art } = fix(sprite, { scale: 9.5, offset: 0, blur: 1, noise: 3 })
    expect(detection.spec.cellWidth).toBeCloseTo(9.5, 1)
    expect(mismatches(sprite, art)).toBe(0)
  })

  it("finds a large grid in a large picture quickly", () => {
    const sprite = makeSprite(48, 48, sweetie, 8)
    const started = performance.now()
    const { detection, art } = fix(sprite, { scale: 21.3, offset: 4, blur: 2, noise: 5 })
    expect(performance.now() - started).toBeLessThan(5000)
    expect(detection.spec.cellWidth).toBeCloseTo(21.3, 1)
    expect(mismatches(sprite, art)).toBe(0)
  })

  it("keeps cells square when blur along one axis makes a multiple or a fraction of the cell look cleaner", () => {
    // Blurred again only up and down, as a resized screenshot can be.
    const image = upscale(demoSprite(), { scale: 9.4, offset: 3, blur: 1, noise: 6, seed: 1 })
    let data = image.data
    for (let pass = 0; pass < 6; pass++) {
      const out = new Uint8ClampedArray(data.length)
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          for (let c = 0; c < 4; c++) {
            let sum = 0
            let count = 0
            for (let ny = Math.max(0, y - 1); ny <= Math.min(image.height - 1, y + 1); ny++) {
              sum += data[(ny * image.width + x) * 4 + c]!
              count++
            }
            out[(y * image.width + x) * 4 + c] = Math.round(sum / count)
          }
        }
      }
      data = out
    }
    const detection = detectGrid({ ...image, data })!
    expect(detection.spec.cellWidth).toBeCloseTo(9.4, 1)
    expect(detection.spec.cellHeight).toBeCloseTo(9.4, 1)
  })

  it("finds cells a screenshot stretched a few percent on one axis, and keeps them near square", () => {
    // Every row moved to 96.5% of its height, smoothly: cells 31.5 wide and about 30.4 tall.
    const wide = upscale(demoSprite(), { scale: 31.5, offset: 3, blur: 1, noise: 6, seed: 1 })
    const squeeze = 0.965
    const height = Math.floor(wide.height * squeeze)
    const data = new Uint8ClampedArray(wide.width * height * 4)
    for (let y = 0; y < height; y++) {
      const from = Math.min(wide.height - 1, y / squeeze)
      const top = Math.floor(from)
      const bottom = Math.min(wide.height - 1, top + 1)
      const t = from - top
      for (let i = 0; i < wide.width * 4; i++) {
        data[y * wide.width * 4 + i] = Math.round(wide.data[top * wide.width * 4 + i]! * (1 - t) + wide.data[bottom * wide.width * 4 + i]! * t)
      }
    }
    const detection = detectGrid({ width: wide.width, height, data })!
    expect(detection.spec.cellWidth).toBeCloseTo(31.5, 0)
    expect(detection.spec.cellHeight).toBeCloseTo(31.5 * squeeze, 0)
  })

  it("does not invent a grid in a blank picture", () => {
    expect(detectGrid({ width: 40, height: 40, data: new Uint8ClampedArray(40 * 40 * 4) })).toBeUndefined()
  })
})

describe("fixing", () => {
  it("fixes the demo picture back into the mushroom, in Sweetie 16", () => {
    const image = demoImage()
    const detection = detectGrid(image)!
    expect(detection.confidence).toBeGreaterThan(0.5)
    const grid = refineGrid(image, uniformGrid(image.width, image.height, detection.spec))
    const art = quantize(sampleCells(image, grid, defaultSampleOptions), {
      palette: sweetie,
      metric: "oklab",
      dither: "none",
      ditherStrength: 0
    })
    const sprite = demoSprite()
    expect([art.width, art.height]).toEqual([16, 16])
    for (let i = 0; i < art.indices.length; i++) expect(art.palette[art.indices[i]!]).toEqual(sprite.palette[sprite.indices[i]!])
  })

  it("keeps transparency", () => {
    const sprite = makeSprite(20, 20, sweetie, 3, true)
    const { art } = fix(sprite, { scale: 6, offset: 0, blur: 1 })
    expect(mismatches(sprite, art)).toBe(0)
    expect(art.indices[0]).toBe(TRANSPARENT)
  })

  it("snaps colors outside the palette to the nearest palette color", () => {
    const sprite = makeSprite(16, 16, sweetie, 9)
    const image = upscale(sprite, { scale: 4, offset: 0, noise: 20, seed: 3 })
    const grid = uniformGrid(image.width, image.height, { cellWidth: 4, cellHeight: 4, offsetX: 0, offsetY: 0 })
    const art = quantize(sampleCells(image, grid, { inset: 0, alphaThreshold: 128 }), {
      palette: sweetie,
      metric: "ciede2000",
      dither: "none",
      ditherStrength: 0
    })
    expect(mismatches(sprite, art)).toBe(0)
  })

  it("keeps each cell's own color without a palette", () => {
    const sprite = makeSprite(10, 10, sweetie, 2)
    const image = upscale(sprite, { scale: 4, offset: 0 })
    const grid = uniformGrid(image.width, image.height, { cellWidth: 4, cellHeight: 4, offsetX: 0, offsetY: 0 })
    const art = quantize(sampleCells(image, grid, { inset: 0.25, alphaThreshold: 128 }), {
      palette: [],
      metric: "oklab",
      dither: "none",
      ditherStrength: 0
    })
    for (let i = 0; i < art.indices.length; i++) expect(art.palette[art.indices[i]!]).toEqual(sprite.palette[sprite.indices[i]!])
  })

  it("mixes two colors with ordered dithering for a shade between them", () => {
    const palette = [
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 }
    ]
    const gray = { width: 8, height: 8, cells: Array.from({ length: 64 }, () => ({ colors: [0x808080], transparent: 0 })) }
    const flat = quantize(gray, { palette, metric: "oklab", dither: "none", ditherStrength: 1 })
    const dithered = quantize(gray, { palette, metric: "oklab", dither: "ordered", ditherStrength: 1 })
    expect(new Set(flat.indices).size).toBe(1)
    expect(new Set(dithered.indices).size).toBe(2)
  })
})

describe("palettes", () => {
  it("ships presets with distinct colors", () => {
    const sizes = Object.fromEntries(presets.map((palette) => [palette.name, palette.colors.length]))
    expect(sizes).toMatchObject({ "Game Boy (4)": 4, "PICO-8 (16)": 16, "Endesga 32": 32, "AAP-64": 64 })
  })

  it("reads and writes .hex and .gpl files", () => {
    const palette = { name: "Test", colors: sweetie.slice(0, 3) }
    expect(parsePalette(toHexFile(palette)).colors).toEqual(palette.colors)
    const gpl = parsePalette(toGpl(palette))
    expect(gpl.name).toBe("Test")
    expect(gpl.colors).toEqual(palette.colors)
    expect(parsePalette('["#000", "#ffffff", "#000000"]').colors).toHaveLength(2)
  })

  it("extracts the colors a picture is made of, keeping locked ones", () => {
    const sprite = makeSprite(30, 30, sweetie.slice(0, 6), 4)
    const image = upscale(sprite, { scale: 4, offset: 0, noise: 3 })
    const grid = uniformGrid(image.width, image.height, { cellWidth: 4, cellHeight: 4, offsetX: 0, offsetY: 0 })
    const colors = cellColors(sampleCells(image, grid, { inset: 0.25, alphaThreshold: 128 }))
    const locked = [{ r: 255, g: 0, b: 255 }]
    const extracted = extractPalette(colors, 7, locked)
    expect(extracted).toHaveLength(7)
    expect(extracted[0]).toEqual(locked[0])
    // Each real color has an extracted color within a few steps of it.
    for (const color of sweetie.slice(0, 6)) {
      const nearest = Math.min(...extracted.map((other) => ciede2000(toCielab(color), toCielab(other))))
      expect(nearest).toBeLessThan(3)
    }
    expect(extractPalette(colors, 7, locked)).toEqual(extracted)
  })
})

describe("exports", () => {
  const art: PixelArt = {
    width: 3,
    height: 2,
    palette: [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 0, b: 255 }
    ],
    indices: Int32Array.from([0, 0, 1, 0, 0, TRANSPARENT])
  }

  it("scales pixels by whole factors", () => {
    const image = toRgba(art, 2)
    expect([image.width, image.height]).toEqual([6, 4])
    expect(Array.from(image.data.subarray(0, 4))).toEqual([255, 0, 0, 255])
    expect(Array.from(image.data.subarray((3 * 6 + 5) * 4, (3 * 6 + 6) * 4))).toEqual([0, 0, 0, 0])
  })

  it("merges same-colored areas into rectangles", () => {
    const rects = toRects(art)
    expect(rects.get(0)).toEqual([{ x: 0, y: 0, width: 2, height: 2 }])
    expect(rects.get(1)).toEqual([{ x: 2, y: 0, width: 1, height: 1 }])
  })

  it("writes a crisp, scalable SVG and a JSON map", () => {
    const svg = toSvg(art, 10)
    expect(svg).toContain('viewBox="0 0 3 2" width="30" height="20" shape-rendering="crispEdges"')
    expect(svg).toContain('<path fill="#ff0000" d="M0 0h2v2h-2z"/>')
    expect(JSON.parse(toJson(art))).toEqual({
      width: 3,
      height: 2,
      palette: ["#ff0000", "#0000ff"],
      pixels: [
        [0, 0, 1],
        [0, 0, -1]
      ]
    })
  })
})
