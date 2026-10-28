import { describe, expect, it } from "vitest"

import { demoImage } from "@typeonce/ritmo-tools/pixel/core/demo.ts"
import { isPng, PROJECT_KEYWORD, readProjectRecipe, withoutProjectRecipe, withProjectRecipe } from "@typeonce/ritmo-tools/pixel/core/project.ts"
import { decodeRecipe, defaultRecipe, encodeRecipe, presetPalette, type Recipe } from "@typeonce/ritmo-tools/pixel/core/recipe.ts"
import { decodePng, encodePng } from "@typeonce/ritmo-tools/pixel/cli/png.ts"

const picture = encodePng(demoImage())
const recipe: Recipe = {
  ...defaultRecipe,
  grid: { kind: "cells", spec: { cellWidth: 7.5, cellHeight: 7.5, offsetX: 1, offsetY: 2 } },
  // Not Latin-1: the chunk is UTF-8.
  palette: { ...presetPalette("sweetie-16")!, name: "Café ☕" },
  edits: { size: "16x16", strokes: [[{ x: 1, y: 2, tool: "erase", area: false }]] }
}

describe("project PNGs", () => {
  it("stores the recipe inside the picture and reads it back", () => {
    const project = withProjectRecipe(picture, encodeRecipe(recipe))
    expect(isPng(project)).toBe(true)
    expect(decodeRecipe(readProjectRecipe(project)!)).toEqual({ ok: true, value: recipe })
  })

  it("keeps the pixels as they are", () => {
    const project = withProjectRecipe(picture, encodeRecipe(recipe))
    expect(decodePng(project)).toEqual(decodePng(picture))
  })

  it("finds no recipe in a plain picture or in a file that is not a PNG", () => {
    expect(readProjectRecipe(picture)).toBeUndefined()
    expect(readProjectRecipe(new TextEncoder().encode('{"palette": "pico-8"}'))).toBeUndefined()
  })

  it("replaces the recipe it held, and gives back the exact picture without it", () => {
    const first = withProjectRecipe(picture, encodeRecipe(recipe))
    const second = withProjectRecipe(first, encodeRecipe(defaultRecipe))
    expect(readProjectRecipe(second)).toBe(encodeRecipe(defaultRecipe))
    expect(Buffer.from(second).toString("latin1").split(PROJECT_KEYWORD)).toHaveLength(2)
    expect(withoutProjectRecipe(second)).toEqual(new Uint8Array(picture))
  })

  it("is findable by its keyword in the raw bytes", () => {
    const project = withProjectRecipe(picture, encodeRecipe(recipe))
    expect(Buffer.from(project).includes(Buffer.from(`iTXt${PROJECT_KEYWORD}`))).toBe(true)
  })

  it("throws on bytes that are not a PNG", () => {
    expect(() => withProjectRecipe(new Uint8Array([1, 2, 3]), "{}")).toThrow("not a PNG")
  })
})
