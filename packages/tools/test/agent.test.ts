import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { demoImage, demoSprite } from "@typeonce/ritmo-tools/pixel/core/demo.ts"
import { toJson, toRgba } from "@typeonce/ritmo-tools/pixel/core/export.ts"
import { TRANSPARENT } from "@typeonce/ritmo-tools/pixel/core/fix.ts"
import { lintArt, type TileAxis } from "@typeonce/ritmo-tools/pixel/core/lint.ts"
import { readProjectRecipe } from "@typeonce/ritmo-tools/pixel/core/project.ts"
import { presets } from "@typeonce/ritmo-tools/pixel/core/palette.ts"
import { runRecipe } from "@typeonce/ritmo-tools/pixel/core/pipeline.ts"
import { decodeRecipe, defaultRecipe, encodeRecipe, presetPalette, type Recipe } from "@typeonce/ritmo-tools/pixel/core/recipe.ts"
import { checkImage, compareReports, isNative, reportOfArt } from "@typeonce/ritmo-tools/pixel/core/report.ts"
import { artOfImage, formatSprite, parseJsonMap, parseSprite } from "@typeonce/ritmo-tools/pixel/core/sprite.ts"
import { decodePicture as decodePng, encodePng } from "@typeonce/ritmo-tools/pixel/cli/png.ts"
import { fakeSheet, makeSprite, place, upscale } from "./synthetic.ts"

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
      edits: { size: "16x16", strokes: [[{ x: 1, y: 2, tool: "erase", area: false }], [{ x: 4, y: 5, tool: "paint", color: { r: 18, g: 52, b: 86 }, area: true }]] }
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

describe("tile seams", () => {
  const palette = [{ r: 34, g: 32, b: 52 }, { r: 143, g: 86, b: 59 }, { r: 223, g: 113, b: 38 }, { r: 217, g: 160, b: 102 }, { r: 106, g: 190, b: 48 }]
  const tile = (size: number, color: (x: number, y: number) => number) => {
    const indices = new Int32Array(size * size)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) indices[y * size + x] = color(x, y)
    return { width: size, height: size, palette, indices }
  }
  const seams = (art: ReturnType<typeof tile>, axis: TileAxis = "both") => lintArt(art, { tile: axis }).filter((issue) => issue.rule === "seam")
  const bricks = (x: number, y: number) => (y % 4 === 0 || (x + (Math.floor(y / 4) % 2 === 1 ? 4 : 0)) % 8 === 0 ? 0 : 1)

  it("is only looked for on a tile", () => {
    expect(lintArt(tile(16, (x) => Math.floor(x / 4)), {}).some((issue) => issue.rule === "seam")).toBe(false)
  })

  it("passes tiles that loop, a line along the edge included", () => {
    expect(seams(tile(16, () => 1))).toEqual([])
    expect(seams(tile(16, bricks))).toEqual([])
    expect(seams(tile(16, (x) => (x === 0 ? 0 : 1)))).toEqual([])
    expect(seams(tile(16, (x) => (x < 2 ? 0 : 1)))).toEqual([])
    expect(seams(tile(16, (x, y) => ((x + y) % 8 < 4 ? 1 : 3)))).toEqual([])
  })

  it("passes shapes that touch the edge: their other side is inside", () => {
    expect(seams(tile(16, (x) => (x >= 10 ? 0 : 1)))).toEqual([])
    expect(seams(tile(16, (x, y) => (y >= 3 && y < 8 && x < 8 ? 3 : 1)))).toEqual([])
    // Specks over a stripe spoil some rows of the match, not the stripe.
    expect(seams(tile(16, (x, y) => ((x * 7 + y * 13) % 11 === 0 ? 4 : x > 10 ? 1 : 3)), "x")).toEqual([])
  })

  it("finds edges that do not meet, and says where", () => {
    const ramp = seams(tile(16, (x) => Math.floor(x / 4)))
    expect(ramp).toHaveLength(1)
    expect(ramp[0]!.severity).toBe("warning")
    expect(ramp[0]!.message).toContain("left and right edges")
    expect(ramp[0]!.count).toBe(16)
    expect(ramp[0]!.at[0]).toEqual([15, 0])
    const down = seams(tile(16, (_, y) => Math.floor(y / 4)))
    expect(down[0]!.message).toContain("top and bottom edges")
    expect(down[0]!.at[3]).toEqual([3, 15])
    // Bricks whose right half sits two rows lower: only the rows its lines cross change at the wrap.
    const broken = seams(tile(16, (x, y) => bricks(x, x < 8 ? y : (y + 2) % 16)), "x")
    expect(broken).toHaveLength(1)
    expect(broken[0]!.count).toBeLessThan(16)
  })

  it("only looks the way the tile repeats", () => {
    const across = tile(16, (x) => Math.floor(x / 4))
    expect(seams(across, "x")).toHaveLength(1)
    expect(seams(across, "y")).toEqual([])
    const down = tile(16, (_, y) => Math.floor(y / 4))
    expect(seams(down, "y")).toHaveLength(1)
    expect(seams(down, "x")).toEqual([])
  })

  it("counts art that stops at an edge", () => {
    const art = tile(16, () => 1)
    const gap = { ...art, indices: art.indices.map((_, i) => (i % 16 >= 12 ? TRANSPARENT : 1)) }
    expect(lintArt(gap, { tile: "x" }).some((issue) => issue.rule === "seam")).toBe(false)
    // A slope cut off by the edge: drawn to the right edge at each height, gone at the left.
    const slope = { ...art, indices: art.indices.map((_, i) => (i % 16 >= 15 - (Math.floor(i / 16) >> 1) ? 1 : TRANSPARENT)) }
    expect(lintArt(slope, { tile: "x" }).some((issue) => issue.rule === "seam")).toBe(true)
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

  it("takes a small sprite with an AI's noisy colors as pixel art at its own size, though a grid shows in it", () => {
    // 24x24 with every pixel a few levels off its color, as an image generator saves it.
    const sprite = toRgba(makeSprite(24, 24, presetPalette("pico-8")!.colors.slice(0, 6), 7, true))
    const data = new Uint8ClampedArray(sprite.data)
    for (let i = 0; i < data.length; i++) if (i % 4 !== 3 && data[i - (i % 4) + 3]! > 0) data[i] = data[i]! + ((i * 7919) % 7) - 3
    const image = { ...sprite, data }
    expect(isNative(image, runRecipe(image, defaultRecipe))).toBe(true)
    expect(checkImage(image, defaultRecipe).report.output).toMatchObject({ width: 24, height: 24 })
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
  const bin = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))
  const dir = mkdtempSync(join(tmpdir(), "pixel-"))
  const run = (...args: Array<string>) => {
    const result = spawnSync(process.execPath, [bin, "pixel", ...args], { cwd: dir, encoding: "utf8" })
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

  it("writes a project PNG that runs its stored recipe, and lets --recipe win over it", { timeout: 60_000 }, () => {
    const fixed = run("fix", "demo.png", "-p", "sweetie-16", "--project")
    expect(fixed.code).toBe(0)
    expect(fixed.json.files.project).toBe("demo.project.png")
    expect(readProjectRecipe(readFileSync(join(dir, "demo.project.png")))).toBe(readFileSync(join(dir, "demo.fixed.recipe.json"), "utf8"))
    // No palette flag: the stored recipe brings it.
    const again = run("fix", "demo.project.png", "-o", "from-project")
    expect(again.code).toBe(0)
    expect(again.json.storedRecipe).toBe(true)
    expect(readFileSync(join(dir, "from-project.sprite.txt"), "utf8")).toBe(readFileSync(join(dir, "demo.fixed.sprite.txt"), "utf8"))
    const given = run("check", "demo.project.png", "--recipe", "demo.fixed.recipe.json")
    expect(given.json.storedRecipe).toBeUndefined()
  })

  it("fixes a sheet of two rows as two animations, and writes only the ones asked for", { timeout: 60_000 }, () => {
    // Two rows of five frames, as two fake sheets one over the other: two animations.
    const fire = [sweetie.colors[2]!, sweetie.colors[3]!, sweetie.colors[4]!, sweetie.colors[1]!]
    const row = (seed: number) => fakeSheet(Array.from({ length: 5 }, (_, f) => place(makeSprite(10, 12, fire, seed, true), 12, 16, 1, 2 + (f % 2))), 6, seed).image
    const top = row(3)
    const bottom = row(4)
    const data = new Uint8ClampedArray(top.data.length + bottom.data.length)
    data.set(top.data)
    data.set(bottom.data, top.data.length)
    writeFileSync(join(dir, "two.png"), encodePng({ width: top.width, height: top.height + bottom.height, data }))

    const found = run("sheet", "two.png", "--colors", "6")
    expect(found.json.animation.animations.map((animation: { name: string; frames: Array<number> }) => [animation.name, animation.frames])).toEqual([
      ["animation-1", [1, 2, 3, 4, 5]],
      ["animation-2", [6, 7, 8, 9, 10]]
    ])
    expect(found.json.files.gifs).toHaveLength(2)

    const only = run("sheet", "two.png", "--colors", "6", "--animations", "walk=1-5;idle=6-10", "--only", "idle", "-o", "idle")
    const json = JSON.parse(readFileSync(join(dir, "idle.json"), "utf8"))
    expect(Object.keys(json.animations)).toEqual(["idle"])
    expect(only.json.files.gifs).toEqual(["idle.idle.gif"])
    // The animation left out stays in the recipe, to put back later.
    const recipe = decodeRecipe(readFileSync(join(dir, "idle.recipe.json"), "utf8"))
    expect(recipe.ok && recipe.value.sheet?.animations.map((animation) => [animation.name, animation.include])).toEqual([
      ["walk", false],
      ["idle", true]
    ])

    const missing = run("sheet", "two.png", "--animations", "1-4;6-10")
    expect(missing.code).toBe(2)
    expect(missing.stderr + JSON.stringify(missing.json ?? {})).toContain("frames 5 are in no animation")
  })

  it("holds frames, and reports and writes how long each one shows", { timeout: 60_000 }, () => {
    const sheet = fakeSheet(Array.from({ length: 4 }, (_, f) => place(makeSprite(10, 12, sweetie.colors.slice(2, 6), 3, true), 12, 16, 1, 2 + (f % 2))), 6)
    writeFileSync(join(dir, "held.png"), encodePng(sheet.image))
    const held = run("sheet", "held.png", "--colors", "6", "--fps", "10", "--animations", "swing=1,2x3,3-4")
    expect(held.code).toBe(0)
    expect(held.json.animation.animations[0].durations).toEqual([100, 300, 100, 100])
    const json = JSON.parse(readFileSync(join(dir, "held.sheet.json"), "utf8"))
    expect(json.frames["swing 1"].duration).toBe(300)
    expect(json.meta.fps).toBeUndefined()
    expect(held.json.files.onions).toEqual(["held.sheet.swing.onion.png"])
    const recipe = decodeRecipe(readFileSync(join(dir, "held.sheet.recipe.json"), "utf8"))
    expect(recipe.ok && recipe.value.sheet?.frames.map((frame) => frame.beats)).toEqual([1, 3, 1, 1])
    // The recipe keeps the holds; new animations say their own.
    const again = run("sheet", "held.png", "--recipe", "held.sheet.recipe.json", "--fps", "20")
    expect(again.json.animation.animations[0].durations).toEqual([50, 150, 50, 50])
    const reset = run("sheet", "held.png", "--recipe", "held.sheet.recipe.json", "--animations", "swing=1-4", "--fps", "10")
    expect(reset.json.animation.animations[0].durations).toEqual([100, 100, 100, 100])

    for (const [bad, says] of [["swing=1,2x0,3-4", "holds for no beats"], ["swing=1,2x1.5,3-4", "whole beats"]] as const) {
      const failed = run("sheet", "held.png", "--animations", bad)
      expect(failed.code).toBe(2)
      expect(failed.stderr + JSON.stringify(failed.json ?? {})).toContain(says)
    }
  })

  it("checks a tile's edges and shows it repeated", { timeout: 60_000 }, () => {
    writeFileSync(
      join(dir, "ramp.txt"),
      `palette\nK #1a1c2c\nO #ef7d57\nY #ffcd75\n\npixels\n${Array.from({ length: 16 }, () => "KKKKKOOOOOOYYYYY").join("\n")}\n`
    )
    expect(run("lint", "ramp.txt").json.issues.map((issue: { rule: string }) => issue.rule)).not.toContain("seam")
    const linted = run("lint", "ramp.txt", "--tile", "x")
    expect(linted.json.issues.map((issue: { rule: string }) => issue.rule)).toContain("seam")
    expect(run("lint", "ramp.txt", "--tile", "y").json.issues.map((issue: { rule: string }) => issue.rule)).not.toContain("seam")
    const shown = run("preview", "ramp.txt", "--tile", "x", "-o", "ramp-tiled")
    expect(shown.code).toBe(0)
    const picture = decodePng(readFileSync(join(dir, shown.json.preview)))
    expect(picture.width / picture.height).toBe(3)
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
