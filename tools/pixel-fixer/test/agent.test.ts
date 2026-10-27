import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { demoImage, demoSprite } from "../src/core/demo.ts"
import { toJson, toRgba } from "../src/core/export.ts"
import { TRANSPARENT } from "../src/core/fix.ts"
import { lintArt } from "../src/core/lint.ts"
import { presets } from "../src/core/palette.ts"
import { runRecipe } from "../src/core/pipeline.ts"
import { decodeRecipe, defaultRecipe, encodeRecipe, presetPalette, type Recipe } from "../src/core/recipe.ts"
import { checkImage, compareReports, reportOfArt } from "../src/core/report.ts"
import { artOfImage, formatSprite, parseJsonMap, parseSprite } from "../src/core/sprite.ts"
import { encodePng } from "../src/cli/png.ts"
import { makeSprite, upscale } from "./synthetic.ts"

const sweetie = presetPalette("sweetie-16")!

const coin = `# A coin
palette
. transparent
K #1a1c2c
Y #ffcd75

pixels
.KK.
KYYK
KYYK
.KK.
`

describe("recipes", () => {
  it("round-trips every setting", () => {
    const recipe: Recipe = {
      ...defaultRecipe,
      grid: { kind: "cells", spec: { cellWidth: 7.5, cellHeight: 8, offsetX: 1, offsetY: 2 } },
      moved: [["x:3", 24.5]],
      palette: { ...sweetie, locked: [0, 4] },
      cleanup: { size: 2, strength: 0.7 },
      cleanKeep: { size: "16x16", cells: [3, 9] },
      targetWidth: 12,
      removeBackground: true,
      edits: { size: "16x16", strokes: [[{ x: 1, y: 2, erase: true, area: false }]] }
    }
    const decoded = decodeRecipe(encodeRecipe(recipe))
    expect(decoded).toEqual({ ok: true, value: recipe })
  })

  it("fills what is missing with defaults, and takes a preset's name or hex colors as the palette", () => {
    const short = decodeRecipe('{"palette": "Sweetie 16", "grid": {"kind": "size", "width": 32}}')
    expect(short.ok && short.value.palette?.name).toBe("Sweetie 16")
    expect(short.ok && short.value.grid).toEqual({ kind: "size", width: 32 })
    expect(short.ok && short.value.cleanup).toEqual(defaultRecipe.cleanup)
    const hex = decodeRecipe('{"palette": ["#000", "#fff"]}')
    expect(hex.ok && hex.value.palette?.colors).toEqual([{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }])
  })

  it("reports every bad setting at once", () => {
    const decoded = decodeRecipe('{"palette": "nope", "metric": "rgb", "follow": 1}')
    expect(decoded.ok).toBe(false)
    if (!decoded.ok) {
      expect(decoded.error).toContain("nope")
      expect(decoded.error).toContain("metric")
      expect(decoded.error).toContain("follow")
    }
  })

  it("runs the same fix as the steps it replaces", () => {
    const outcome = runRecipe(demoImage(), { ...defaultRecipe, palette: sweetie })!
    const expected = demoSprite()
    expect(outcome.art.width).toBe(expected.width)
    const hex = (art: typeof expected, i: number): string => {
      const index = art.indices[i]!
      return index === TRANSPARENT ? "-" : JSON.stringify(art.palette[index])
    }
    for (let i = 0; i < expected.indices.length; i++) expect(hex(outcome.art, i)).toBe(hex(expected, i))
  })
})

describe("sprite sources", () => {
  it("parses the text format", () => {
    const parsed = parseSprite(coin)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.art.width).toBe(4)
    expect(parsed.art.height).toBe(4)
    expect(parsed.art.indices[0]).toBe(TRANSPARENT)
    expect(parsed.art.palette[parsed.art.indices[5]!]).toEqual({ r: 255, g: 205, b: 117 })
  })

  it("reports every problem with its line", () => {
    const parsed = parseSprite("palette\nK #000\nY #zzz\npixels\nKKK\nKQ\n")
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.problems.map((problem) => problem.line)).toEqual([3, 6])
  })

  it("writes what it reads, with letters that name the colors", () => {
    const art = demoSprite()
    const text = formatSprite(art)
    expect(text).toMatch(/^K #/m)
    expect(text).toMatch(/^W #/m)
    const parsed = parseSprite(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(toRgba(parsed.art).data).toEqual(toRgba(art).data)
  })

  it("reads the JSON map back", () => {
    const art = demoSprite()
    const parsed = parseJsonMap(toJson(art))
    expect(parsed.ok && toRgba(parsed.art).data).toEqual(toRgba(art).data)
  })
})

describe("lint", () => {
  const art = demoSprite()

  it("passes art that follows the rules", () => {
    const errors = lintArt(art, { palette: sweetie.colors, sizes: [{ width: 16, height: 16 }], maxColors: 16 }).filter((issue) => issue.severity === "error")
    expect(errors).toEqual([])
  })

  it("names each broken rule", () => {
    const pico = presets.find((preset) => preset.name.startsWith("PICO-8"))!.colors
    const rules = lintArt(art, { palette: pico, sizes: [{ width: 32, height: 32 }], maxColors: 4, transparentBackground: true }).map((issue) => issue.rule)
    expect(rules).toEqual(expect.arrayContaining(["size", "off-palette", "too-many-colors", "opaque-background"]))
  })

  it("counts half-transparent pixels", () => {
    const image = toRgba(art)
    image.data[3] = 100
    const { partial } = artOfImage(image)
    expect(lintArt(artOfImage(image).art, {}, partial).map((issue) => issue.rule)).toContain("partial-alpha")
  })

  it("lets a sprite touch its edges without calling it a background", () => {
    const parsed = parseSprite(coin)
    expect(parsed.ok && lintArt(parsed.art, { transparentBackground: true })).toEqual([])
  })
})

describe("check", () => {
  it("finds upscaled pixel art fixable, with the grid it found", () => {
    const { report } = checkImage(demoImage(), { ...defaultRecipe, palette: sweetie })
    expect(report.verdict).toBe("fixable")
    expect(report.kind).toBe("upscaled")
    expect(report.output).toMatchObject({ width: 16, height: 16 })
    expect(report.grid?.fit).toBeGreaterThan(0.95)
  })

  it("finds pixel art at its own size clean", () => {
    const { report } = checkImage(toRgba(demoSprite()), defaultRecipe)
    expect(report.verdict).toBe("clean")
    expect(report.kind).toBe("pixel-art")
  })

  it("asks for a person when the grid given does not fit", () => {
    const sprite = makeSprite(20, 20, sweetie.colors, 7)
    const image = upscale(sprite, { scale: 10, offset: 0, blur: 1, noise: 4, seed: 3 })
    const wrong = { ...defaultRecipe, grid: { kind: "cells", spec: { cellWidth: 7, cellHeight: 7, offsetX: 0, offsetY: 0 } } } as const
    const { report } = checkImage(image, wrong)
    expect(report.verdict).toBe("needs-person")
    const right = checkImage(image, { ...defaultRecipe, grid: { kind: "cells", spec: { cellWidth: 10, cellHeight: 10, offsetX: 0, offsetY: 0 } } })
    expect(right.report.verdict).toBe("fixable")
  })

  it("prefers the cleaner of two versions", () => {
    const parsed = parseSprite(coin)
    if (!parsed.ok) throw new Error("coin")
    const clean = reportOfArt(parsed.art, { maxColors: 4 })
    const broken = reportOfArt(parsed.art, { maxColors: 1 })
    expect(compareReports(broken, clean).better).toBe("b")
    expect(compareReports(clean, clean).better).toBe("same")
  })
})

describe("pixelate", () => {
  it("cuts a picture into the pixels asked for", () => {
    const image = upscale(makeSprite(12, 8, sweetie.colors, 2), { scale: 9.5, offset: 0, blur: 3, noise: 10, seed: 1 })
    const outcome = runRecipe(image, { ...defaultRecipe, grid: { kind: "size", width: 24 }, palette: sweetie })!
    expect(outcome.art.width).toBe(24)
    expect(outcome.art.height).toBe(16)
  })
})

describe("the pixel CLI", () => {
  const bin = fileURLToPath(new URL("../bin/pixel.mjs", import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), "pixel-"))
  const run = (...args: Array<string>) => {
    const result = spawnSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" })
    return { code: result.status, json: result.stdout.trim().startsWith("{") ? JSON.parse(result.stdout) : undefined, stderr: result.stderr }
  }
  writeFileSync(join(dir, "demo.png"), encodePng(demoImage()))
  writeFileSync(join(dir, "coin.txt"), coin)

  it("checks, fixes, and renders, exiting with what to do next", { timeout: 60_000 }, () => {
    const checked = run("check", "demo.png", "-p", "sweetie-16")
    expect(checked.code).toBe(3)
    expect(checked.json.verdict).toBe("fixable")

    const fixed = run("fix", "demo.png", "-p", "sweetie-16", "--scale", "4")
    expect(fixed.code).toBe(0)
    expect(Object.keys(fixed.json.files)).toEqual(["png", "scaled", "svg", "map", "sprite", "recipe", "preview"])
    expect(run("check", "demo.fixed.png", "-p", "sweetie-16").json.verdict).toBe("clean")
    // The recipe the fix wrote fixes the picture the same way again.
    const again = run("fix", "demo.png", "--recipe", "demo.fixed.recipe.json", "-o", "again")
    expect(again.code).toBe(0)
    expect(readFileSync(join(dir, "again.sprite.txt"), "utf8")).toBe(readFileSync(join(dir, "demo.fixed.sprite.txt"), "utf8"))

    const rendered = run("render", "coin.txt", "--scale", "8")
    expect(rendered.code).toBe(0)
    expect(rendered.json.verdict).toBe("clean")
  })

  it("reads the project's rules from pixel.config.json", { timeout: 60_000 }, () => {
    expect(run("init", "-p", "sweetie-16").code).toBe(0)
    const linted = run("lint", "coin.txt")
    expect(linted.code).toBe(3)
    expect(linted.json.issues.map((issue: { rule: string }) => issue.rule)).toContain("size")
  })

  it("reports a broken source with every problem, and exits 2", { timeout: 60_000 }, () => {
    writeFileSync(join(dir, "bad.txt"), "palette\nK #000\npixels\nKQ\n")
    const result = run("render", "bad.txt")
    expect(result.code).toBe(2)
    expect(result.json.problems).toHaveLength(1)
    expect(run("check", "missing.png").code).toBe(2)
    expect(run("check", "--nope", "demo.png").code).toBe(2)
  })
})
