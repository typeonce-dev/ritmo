import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { TRANSPARENT } from "@typeonce/ritmo-tools/pixel/core/fix.ts"
import { decodePlan, drawParts, partColors, partsOverlay, type PartsPlan } from "@typeonce/ritmo-tools/pixel/core/parts.ts"

/** A bicycle-like plan, 200×100 reference pixels: two wheels (tier 1), a frame (tier 1), a seat (tier 2), a bell (tier 3). */
const bike = {
  subject: "a two-wheeler, side view",
  parts: [
    { id: "rear-wheel", tier: 1, material: "rubber", color: "#202020", shape: { kind: "ring", cx: 40, cy: 60, rx: 38, ry: 38, thick: 8 } },
    { id: "front-wheel", tier: 1, material: "rubber", color: "#202020", shape: { kind: "ring", cx: 160, cy: 60, rx: 38, ry: 38, thick: 8 } },
    { id: "frame", tier: 1, material: "paint", color: "#c03030", shape: { kind: "path", points: [[40, 60], [100, 30], [160, 60]], width: 6 } },
    { id: "seat", tier: 2, material: "leather", color: "#302018", shape: { kind: "poly", points: [[80, 20], [110, 20], [108, 28], [82, 28]] } },
    { id: "bell", tier: 3, material: "chrome", color: "#c0c0c8", shape: { kind: "ellipse", cx: 150, cy: 24, rx: 3, ry: 3 } }
  ]
}

const decoded = (value: unknown): PartsPlan => {
  const result = decodePlan(JSON.stringify(value))
  if (!result.ok) throw new Error(result.error)
  return result.value
}

describe("a parts plan", () => {
  it("decodes a plan, with the light from the top left by default", () => {
    const plan = decoded(bike)
    expect(plan.light).toBe("top-left")
    expect(plan.parts.map((part) => part.id)).toEqual(["rear-wheel", "front-wheel", "frame", "seat", "bell"])
  })

  it("names every problem: a missing subject, a bad shape, a reused id, an attach to a part that is not a tier-1 round", () => {
    const result = decodePlan(
      JSON.stringify({
        parts: [
          { id: "a", tier: 2, material: "paint", shape: { kind: "ellipse", cx: 0, cy: 0, rx: 4, ry: 4 } },
          { id: "a", tier: 1, material: "paint", shape: { kind: "square" } },
          { id: "b", tier: 1, material: "paint", attach: "a", shape: { kind: "ring", cx: 0, cy: 0, rx: 4, ry: 4, thick: 9 } }
        ]
      })
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('"subject"')
    expect(result.error).toContain("the id is used twice")
    expect(result.error).toContain("a shape is")
    expect(result.error).toContain('"attach" names an earlier tier-1 ring or ellipse')
    expect(result.error).toContain("a ring's \"thick\"")
  })
})

describe("each part's color", () => {
  it("is its own color, or the median of the reference where it shows", () => {
    const plan = decoded({ subject: "two boxes", parts: [
      { id: "back", tier: 1, material: "matte", shape: { kind: "poly", points: [[0, 0], [10, 0], [10, 10], [0, 10]] } },
      { id: "front", tier: 1, material: "matte", color: "#00ff00", shape: { kind: "poly", points: [[5, 0], [10, 0], [10, 10], [5, 10]] } }
    ] })
    const data = new Uint8ClampedArray(10 * 10 * 4)
    for (let i = 0; i < 100; i++) data.set(i % 10 < 5 ? [200, 0, 0, 255] : [0, 0, 200, 255], i * 4)
    const colors = partColors(plan, { width: 10, height: 10, data })
    expect(colors).toEqual({ ok: true, value: [{ r: 200, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }] })
  })

  it("needs every part's color when there is no reference", () => {
    const plan = decoded({ subject: "a dot", parts: [{ id: "dot", tier: 1, material: "matte", shape: { kind: "ellipse", cx: 5, cy: 5, rx: 5, ry: 5 } }] })
    expect(partColors(plan, undefined)).toMatchObject({ ok: false })
  })
})

describe("drawing a plan", () => {
  const plan = decoded(bike)
  const colors = partColors(plan, undefined)
  if (!colors.ok) throw new Error(colors.error)

  it("keeps the parts each size can hold: tier 1 always, tier 2 from 32 pixels, tier 3 from 64", () => {
    expect(drawParts(plan, colors.value, 16).dropped).toEqual(["seat", "bell"])
    expect(drawParts(plan, colors.value, 32).dropped).toEqual(["bell"])
    expect(drawParts(plan, colors.value, 128).dropped).toEqual([])
  })

  it("sizes the longest side, and keeps the subject's proportions", () => {
    const { art } = drawParts(plan, colors.value, 64)
    expect(art.width).toBe(64)
    // The subject spans 196×78 reference pixels (the wheels' outer edges, the seat's top).
    expect(art.height).toBe(Math.round((78 / 196) * 62) + 2)
  })

  it("enlarges a wheel that would not read, and keeps its hole open (no outline inside it)", () => {
    const { art, grown } = drawParts(plan, colors.value, 16)
    expect(grown).toEqual(["rear-wheel", "front-wheel"])
    // The rear wheel's middle, at 16 pixels: see-through.
    const scale = 14 / 196
    const cx = Math.floor((40 - 2) * scale + 1)
    const cy = Math.floor((60 - 20) * scale + 1)
    expect(art.indices[cy * art.width + cx]).toBe(TRANSPARENT)
  })

  it("draws only the project's palette when it has one", () => {
    const palette = [{ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, { r: 200, g: 40, b: 40 }]
    const { art } = drawParts(plan, colors.value, 64, { palette })
    for (const color of art.palette) expect(palette).toContainEqual(color)
  })

  it("outlines each shape over the reference in its tier's color", () => {
    const reference = { width: 200, height: 100, data: new Uint8ClampedArray(200 * 100 * 4).fill(255) }
    const overlay = partsOverlay(plan, reference)
    const at = (x: number, y: number) => Array.from(overlay.data.slice((y * 200 + x) * 4, (y * 200 + x) * 4 + 3))
    expect(at(40, 22)).toEqual([0, 255, 102])
    expect(at(40, 10)).toEqual([140, 140, 140])
  })
})

describe("pixel parts from the command line", () => {
  const bin = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))

  it("writes each size's PNG and sprite source, and reports what each kept", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "pixel-parts-"))
    writeFileSync(join(dir, "bike.json"), JSON.stringify(bike))
    const run = spawnSync(process.execPath, [bin, "pixel", "parts", "bike.json", "--sizes", "16,64"], { cwd: dir, encoding: "utf8" })
    expect(run.status).toBe(0)
    const out: unknown = JSON.parse(run.stdout)
    expect(out).toMatchObject({ subject: "a two-wheeler, side view", drawn: [{ size: 16, dropped: ["seat", "bell"] }, { size: 64, dropped: [] }] })
    for (const file of ["bike.parts.16.png", "bike.parts.16.txt", "bike.parts.64.png"]) expect(existsSync(join(dir, file))).toBe(true)
  })

  it("fails on a plan with problems, naming them", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "pixel-parts-"))
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ subject: "x", parts: [{ id: "a", tier: 4, material: "paint", shape: { kind: "ellipse", cx: 1, cy: 1, rx: 1, ry: 1 } }] }))
    const run = spawnSync(process.execPath, [bin, "pixel", "parts", "bad.json"], { cwd: dir, encoding: "utf8" })
    expect(run.status).toBe(2)
    expect(run.stdout + run.stderr).toContain('"tier" is 1')
  })
})
