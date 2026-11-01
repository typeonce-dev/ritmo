import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { decodePng } from "@typeonce/ritmo-tools/pixel/cli/png.ts"
import { cutParts } from "@typeonce/ritmo-tools/rig/core/parts.ts"
import { paintSheet, sheetFile } from "../examples/rig/sheet/make-sheet.ts"

describe("the example character parts sheet", () => {
  it("is what its script paints, pixel for pixel, so the picture cannot drift from the code", () => {
    const committed = decodePng(readFileSync(sheetFile))
    const painted = paintSheet()
    expect([committed.width, committed.height]).toEqual([painted.width, painted.height])
    // The pixels, not the PNG's bytes: zlib's output differs between Node versions and CPUs for the same pixels.
    expect(Buffer.compare(Buffer.from(committed.data), Buffer.from(painted.data))).toBe(0)
  })

  it("is a sheet `rig parts` cuts as it is: a plain background cleared, fifteen parts apart, no labels or specks", () => {
    const cut = cutParts(decodePng(readFileSync(sheetFile)))
    expect(cut.warnings).toEqual([])
    expect(cut.parts).toHaveLength(15)
    // Every part is whole on transparency: opaque inside, cleared around.
    for (const part of cut.parts) {
      const alpha = (x: number, y: number): number => part.image.data[(y * part.image.width + x) * 4 + 3]!
      expect(alpha(0, 0)).toBe(0)
      expect(alpha(Math.floor(part.image.width / 2), Math.floor(part.image.height / 2))).toBe(255)
    }
  })
})
