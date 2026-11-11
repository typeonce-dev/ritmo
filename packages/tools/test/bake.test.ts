import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { findAssets } from "@typeonce/ritmo-tools/pixel/cli/library.ts"
import { decodePng } from "@typeonce/ritmo-tools/pixel/cli/png.ts"
import { bake, defaultBakeSetup, parseBakeModel, parseBakeSetup, type BakeModel, type BakeResult, type BakeSetup } from "@typeonce/ritmo-tools/pixel/core/bake.ts"
import { toHex } from "@typeonce/ritmo-tools/pixel/core/color.ts"
import { TRANSPARENT, type PixelArt } from "@typeonce/ritmo-tools/pixel/core/fix.ts"
import { strayPixels } from "@typeonce/ritmo-tools/pixel/core/lint.ts"
import { readSpritesheet } from "@typeonce/ritmo-tools/pixel/core/spritesheet.ts"
import { parseSprite } from "@typeonce/ritmo-tools/pixel/core/sprite.ts"

const cli = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))
const run = (cwd: string, ...args: Array<string>) => spawnSync(process.execPath, [cli, "pixel", ...args], { cwd, encoding: "utf8" })

const DARK = "#111111"
const MID = "#777777"
const LIGHT = "#eeeeee"
const RAMP = [DARK, MID, LIGHT]

const setup = (over: Partial<BakeSetup> = {}): BakeSetup => ({ ...defaultBakeSetup, camera: { ...defaultBakeSetup.camera, scale: 2 }, outline: "#000000", materials: { ramp: RAMP }, ...over })

const model = (fields: Record<string, unknown>, using = setup()): BakeModel => {
  const parsed = parseBakeModel(JSON.stringify(fields), using)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems))
  return parsed.value
}

const problems = (fields: unknown, using = setup()): ReadonlyArray<string> => {
  const parsed = parseBakeModel(JSON.stringify(fields), using)
  return parsed.ok ? [] : parsed.problems.map((problem) => `${problem.path} ${problem.message}`)
}

const still = (result: BakeResult): PixelArt => result.clips[0]!.frames[0]!.art

const colorAt = (art: PixelArt, x: number, y: number): string | undefined => {
  const index = art.indices[y * art.width + x]!
  return index === TRANSPARENT ? undefined : toHex(art.palette[index]!)
}

const colors = (art: PixelArt): Set<string> => {
  const found = new Set<string>()
  for (const index of art.indices) if (index !== TRANSPARENT) found.add(toHex(art.palette[index]!))
  return found
}

const count = (art: PixelArt, color: string): number => {
  let total = 0
  for (let y = 0; y < art.height; y++) for (let x = 0; x < art.width; x++) if (colorAt(art, x, y) === color) total++
  return total
}

const box = { shape: "box", material: "ramp", from: [-5, -5, 0], to: [5, 5, 10] }

describe("reading a model", () => {
  it("names the fix for what agents reach for first", () => {
    const wrong = problems({ parts: [{ shape: "box", material: "ramp", at: [0, 0, 0], size: [1, 1, 1] }] })
    expect(wrong.join("\n")).toContain("give `from` and `to`")
    expect(problems({ parts: [{ ...box, color: "#fff" }] }).join("\n")).toContain("use `material`")
    expect(problems({ parts: [{ ...box, flat: 1 }] }).join("\n")).toContain("use `step`")
    expect(problems({ parts: [{ ...box, spin: {} }] }).join("\n")).toContain("use `animate`")
  })

  it("lists the materials there are when one is unknown", () => {
    const [wrong] = problems({ parts: [{ ...box, material: "stone" }] })
    expect(wrong).toContain('"stone" is not a color')
    expect(wrong).toContain("ramp")
  })

  it("takes a color by itself, one from the model, and one set on a group", () => {
    expect(problems({ parts: [{ ...box, material: "#abcdef" }] })).toEqual([])
    expect(problems({ materials: { wood: ["#111", "#222"] }, parts: [{ ...box, material: "wood" }] })).toEqual([])
    const { material: _, ...bare } = box
    expect(problems({ parts: [{ material: "ramp", parts: [bare] }] })).toEqual([])
    expect(problems({ parts: [bare] }).join("\n")).toContain("material")
  })

  it("gathers every problem, each at its place", () => {
    const wrong = problems({ headings: 0, parts: [{ shape: "cone" }, { ...box, step: -1 }], outline: "nope" })
    expect(wrong.some((line) => line.startsWith("$.headings"))).toBe(true)
    expect(wrong.some((line) => line.startsWith("$.parts[0]"))).toBe(true)
    expect(wrong.some((line) => line.startsWith("$.parts[1].step"))).toBe(true)
    expect(wrong.some((line) => line.startsWith("$.outline"))).toBe(true)
  })

  it("says so when a face cannot be one flat convex fan, and how to go on", () => {
    const dent = { shape: "face", material: "ramp", corners: [[0, 0, 0], [4, 0, 0], [4, 4, 0], [2, 1, 0], [0, 4, 0]] }
    expect(problems({ parts: [dent] }).join("\n")).toContain("not convex")
    const bent = { shape: "face", material: "ramp", corners: [[0, 0, 0], [4, 0, 0], [4, 4, 3], [0, 4, 0]] }
    expect(problems({ parts: [bent] }).join("\n")).toContain("not flat")
    const line = { shape: "face", material: "ramp", corners: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] }
    expect(problems({ parts: [line] }).join("\n")).toContain("no area")
  })

  it("says a flat box wants a face, and a motion wants a real animation", () => {
    expect(problems({ parts: [{ ...box, to: [5, 5, 0] }] }).join("\n")).toContain("use a `face`")
    expect(problems({ parts: [{ ...box, animate: { spin: { move: [1, 0, 0] } } }] }).join("\n")).toContain("is not an animation")
  })

  it("needs a one-color material for each letter a painted row uses", () => {
    expect(problems({ parts: [box], paint: [{ at: [0, 0], rows: ["Q"] }] }).join("\n")).toContain('uses "Q"')
    expect(problems({ materials: { Q: "#123456" }, parts: [box], paint: [{ at: [0, 0], rows: ["Q._"] }] })).toEqual([])
    expect(problems({ materials: { Q: ["#123456", "#654321"] }, parts: [box], paint: [{ at: [0, 0], rows: ["Q"] }] }).join("\n")).toContain('uses "Q"')
  })

  it("reads a broken file and the project's setup with the same care", () => {
    expect(parseBakeModel("{", setup()).ok).toBe(false)
    expect(parseBakeSetup(undefined)).toEqual({ ok: true, value: defaultBakeSetup })
    const sunk = parseBakeSetup({ light: { sun: [0, 0, -1] } })
    expect(sunk.ok === false && sunk.problems[0]!.message).toContain("above the ground")
    const flat = parseBakeSetup({ camera: { elevation: 0 } })
    expect(flat.ok).toBe(false)
    const unknown = parseBakeSetup({ camera: { zoom: 2 } })
    expect(unknown.ok === false && unknown.problems[0]!.message).toContain("is not a field")
  })

  it("reads the look a part chooses for itself, and names what is wrong with it", () => {
    expect(problems({ parts: [{ ...box, steps: { top: 2, left: 0, right: 1 }, line: true }] })).toEqual([])
    expect(problems({ parts: [{ ...box, line: "step" }, { ...box, line: "#123456" }, { ...box, line: false }] })).toEqual([])
    expect(problems({ parts: [{ ...box, steps: { front: 1 } }] }).join("\n")).toContain("$.parts[0].steps.front")
    expect(problems({ parts: [{ ...box, steps: { top: -1 } }] }).join("\n")).toContain("must be a ramp's step")
    expect(problems({ parts: [{ ...box, line: "thick" }] }).join("\n")).toContain('"step" (one step darker)')
    expect(problems({ parts: [{ ...box, outline: true }] }).join("\n")).toContain("use `line`")
  })

  it("reads a face's own rows, which need no material, and checks their letters", () => {
    const door = { shape: "face", corners: [[-2, 5, 0], [2, 5, 0], [2, 5, 6], [-2, 5, 6]] }
    expect(problems({ materials: { D: "#5d275d", Y: "#ffcd75" }, parts: [box, { ...door, rows: ["DD", "DY", "D."] }] })).toEqual([])
    expect(problems({ parts: [box, { ...door, rows: ["QQ"] }] }).join("\n")).toContain('uses "Q"')
    expect(problems({ materials: { D: "#5d275d" }, parts: [box, { ...door, rows: ["DD", "D"] }] }).join("\n")).toContain("as long as the first row")
    expect(problems({ parts: [box, door] }).join("\n")).toContain("material")
  })

  it("takes the camera in a game's own terms, and never mixed with the other", () => {
    const axes = parseBakeSetup({ camera: { across: [1, -1, 0], down: [0.6, 0.6, -0.88] } })
    expect(axes.ok && axes.value.camera.axes).toEqual({ across: [1, -1, 0], down: [0.6, 0.6, -0.88] })
    const mixed = parseBakeSetup({ camera: { across: [1, -1, 0], down: [0.6, 0.6, -0.88], yaw: 45 } })
    expect(mixed.ok === false && mixed.problems[0]!.message).toContain("use one or the other")
    const half = parseBakeSetup({ camera: { across: [1, -1, 0] } })
    expect(half.ok === false && half.problems[0]!.path).toBe("bake.camera.down")
    const flat = parseBakeSetup({ camera: { across: [1, 0, 0], down: [2, 0, 0] } })
    expect(flat.ok === false && flat.problems[0]!.message).toContain("along one line")
    const upside = parseBakeSetup({ camera: { across: [1, -1, 0], down: [0.5, 0.5, 1] } })
    expect(upside.ok === false && upside.problems[0]!.path).toBe("bake.camera.down")
  })
})

describe("one camera", () => {
  it("puts a point where the project's numbers say", () => {
    // Landkeep's view: a point lands at x = u - v, y = (u + v) * 0.6 - z * 0.88.
    const using = setup({ camera: { yaw: 45, elevation: Math.asin(0.6) * (180 / Math.PI), scale: Math.SQRT2, heightScale: 0.88 / (Math.SQRT2 * 0.8), axes: undefined } })
    const result = bake(model({ outline: false, parts: [{ shape: "box", material: "#ffffff", from: [0, 0, 10], to: [10, 10, 20] }] }, using), using)
    const art = still(result)
    const xs: Array<number> = []
    const ys: Array<number> = []
    for (let y = 0; y < art.height; y++) {
      for (let x = 0; x < art.width; x++) {
        if (art.indices[y * art.width + x] === TRANSPARENT) continue
        xs.push(x - result.anchor.x)
        ys.push(y - result.anchor.y)
      }
    }
    const within = (value: number, wanted: number) => expect(Math.abs(value - wanted)).toBeLessThanOrEqual(1)
    within(Math.min(...xs), -10)
    within(Math.max(...xs) + 1, 10)
    // The top face's far corner (0, 0, 20) and the near corner of its foot (10, 10, 10), each to the pixel a corner rounds to.
    within(Math.min(...ys), -20 * 0.88)
    within(Math.max(...ys) + 1, 12 - 10 * 0.88)
  })

  it("keeps every frame the same size, on one anchor, as it turns", () => {
    const result = bake(model({ headings: 8, parts: [{ ...box, to: [12, 3, 4] }] }), setup())
    expect(result.clips.map((clip) => clip.name)).toEqual(Array.from({ length: 8 }, (_, i) => `heading-${i}`))
    for (const clip of result.clips) {
      expect(clip.frames[0]!.art.width).toBe(result.width)
      expect(clip.frames[0]!.art.height).toBe(result.height)
    }
    expect(Number.isInteger(result.anchor.x)).toBe(true)
  })

  it("draws a game's own axes as the turned camera that matches them", () => {
    const s = 2
    const e = Math.PI / 6
    const turned = setup()
    const axes = setup({ camera: { ...defaultBakeSetup.camera, axes: { across: [s * Math.SQRT1_2, -s * Math.SQRT1_2, 0], down: [s * Math.SQRT1_2 * Math.sin(e), s * Math.SQRT1_2 * Math.sin(e), -s * Math.cos(e)] } } })
    const fields = { headings: 2, parts: [box, { shape: "cylinder", material: "ramp", from: [-3, -3, 10], to: [3, 3, 16], taper: 0.1 }] }
    const a = bake(model(fields, turned), turned)
    const b = bake(model(fields, axes), axes)
    expect([b.width, b.height, b.anchor]).toEqual([a.width, a.height, a.anchor])
    a.clips.forEach((clip, i) => expect(Array.from(b.clips[i]!.frames[0]!.art.indices)).toEqual(Array.from(clip.frames[0]!.art.indices)))
  })

  it("draws the same pixels every time", () => {
    const fields = { headings: 4, parts: [box, { shape: "cylinder", material: "ramp", from: [-3, -3, 10], to: [3, 3, 16], taper: 0.1 }] }
    const once = bake(model(fields), setup())
    const again = bake(model(fields), setup())
    once.clips.forEach((clip, i) => expect(Array.from(clip.frames[0]!.art.indices)).toEqual(Array.from(again.clips[i]!.frames[0]!.art.indices)))
  })
})

describe("one light", () => {
  it("shades a block's top lightest, its side to the sun next, and its other side darkest", () => {
    const using = setup({ light: { ...defaultBakeSetup.light, sun: [0.7, 0.05, 0.7] } })
    const result = bake(model({ outline: false, parts: [box] }, using), using)
    const art = still(result)
    const { x, y } = result.anchor
    expect(colorAt(art, x, y - Math.round(10 * Math.cos(Math.PI / 6) * 2))).toBe(LIGHT)
    // At a yaw of 45, +x faces down-right and +y down-left, on either side of the near corner.
    expect(colorAt(art, x + 5, y + 2)).toBe(MID)
    expect(colorAt(art, x - 5, y + 2)).toBe(DARK)
  })

  it("moves the light by moving one number, and swaps which side is dark", () => {
    const right = setup({ light: { ...defaultBakeSetup.light, sun: [0.7, 0.05, 0.7] } })
    const left = setup({ light: { ...defaultBakeSetup.light, sun: [-0.7, 0.05, 0.7] } })
    const a = bake(model({ outline: false, parts: [box] }, right), right)
    const b = bake(model({ outline: false, parts: [box] }, left), left)
    expect(colorAt(still(a), a.anchor.x + 5, a.anchor.y + 2)).toBe(MID)
    expect(colorAt(still(b), b.anchor.x + 5, b.anchor.y + 2)).toBe(DARK)
    expect(colorAt(still(b), b.anchor.x - 5, b.anchor.y + 2)).toBe(MID)
  })

  it("stays put as a model turns, so a quarter turn shades its other side", () => {
    const using = setup({ light: { ...defaultBakeSetup.light, sun: [0.7, 0.05, 0.7] } })
    const fields = { outline: false, headings: 4, parts: [{ ...box, from: [-5, -5, 0], to: [5, 5, 10] }, { shape: "box", material: "#ff0000", from: [5, -2, 0], to: [6, 2, 8] }] }
    const result = bake(model(fields, using), using)
    expect(count(result.clips[0]!.frames[0]!.art, "#ff0000")).toBeGreaterThan(0)
    // Facing +x at first (right on screen), and after three quarters of a clockwise turn away from the viewer.
    expect(count(result.clips[2]!.frames[0]!.art, "#ff0000")).toBe(0)
  })

  it("shades a ramp of any length, and a single color never", () => {
    for (const ramp of [["#000001", "#000002"], ["#000001", "#000002", "#000003", "#000004", "#000005"]]) {
      const art = still(bake(model({ outline: false, materials: { m: ramp }, parts: [{ ...box, material: "m" }] }), setup()))
      expect(colors(art).size).toBeGreaterThan(1)
      for (const color of colors(art)) expect(ramp).toContain(color)
    }
    expect(colors(still(bake(model({ outline: false, parts: [{ ...box, material: "#123456" }] }), setup())))).toEqual(new Set(["#123456"]))
  })

  it("holds a part to one step when told, and darkens what a part shades when asked", () => {
    expect(colors(still(bake(model({ outline: false, parts: [{ ...box, step: 1 }] }), setup())))).toEqual(new Set([MID]))
    const { material: _, ...bare } = box
    expect(colors(still(bake(model({ outline: false, parts: [{ material: "ramp", step: 1, parts: [bare] }] }), setup())))).toEqual(new Set([MID]))
    expect(colors(still(bake(model({ outline: false, parts: [{ material: "ramp", step: 1, parts: [{ ...bare, step: 2 }] }] }), setup())))).toEqual(new Set([LIGHT]))
    const ramp = { materials: { ground: ["#101010", "#505050", "#a0a0a0"] }, outline: false, parts: [{ shape: "box", material: "ground", from: [-20, -20, 0], to: [20, 20, 1] }, { shape: "box", material: "ramp", from: [-3, -3, 1], to: [3, 3, 25] }] }
    const flat = setup()
    const lively = setup({ light: { ...defaultBakeSetup.light, castShadows: true } })
    expect(count(still(bake(model(ramp, lively), lively)), "#505050")).toBeGreaterThan(count(still(bake(model(ramp, flat), flat)), "#505050"))
  })
})

describe("the look a part chooses", () => {
  const without = { outline: false }

  it("takes a step for each way its surfaces face, whatever the light", () => {
    const chosen = { ...box, steps: { top: 2, left: 0, right: 1 } }
    const right = setup({ light: { ...defaultBakeSetup.light, sun: [0.7, 0.05, 0.7] } })
    const left = setup({ light: { ...defaultBakeSetup.light, sun: [-0.7, 0.05, 0.7] } })
    const a = bake(model({ ...without, parts: [chosen] }, right), right)
    const b = bake(model({ ...without, parts: [chosen] }, left), left)
    expect(Array.from(still(a).indices)).toEqual(Array.from(still(b).indices))
    const { x, y } = a.anchor
    expect(colorAt(still(a), x, y - Math.round(10 * Math.cos(Math.PI / 6) * 2))).toBe(LIGHT)
    expect(colorAt(still(a), x + 5, y + 2)).toBe(MID)
    expect(colorAt(still(a), x - 5, y + 2)).toBe(DARK)
    // One facing chosen, the others from the light.
    const lit = bake(model({ ...without, parts: [{ ...box, steps: { left: 2 } }] }, right), right)
    expect(colorAt(still(lit), lit.anchor.x - 5, lit.anchor.y + 2)).toBe(LIGHT)
    expect(colorAt(still(lit), lit.anchor.x + 5, lit.anchor.y + 2)).toBe(MID)
  })

  it("draws a line where a part meets what is behind it, on what is behind", () => {
    const base = { shape: "box", material: "#00aa00", from: [-6, -6, 0], to: [6, 6, 6] }
    const lid = { shape: "box", material: "#aa0000", from: [-7, -7, 6], to: [7, 7, 9] }
    const plain = still(bake(model({ parts: [base, lid] }), setup()))
    const lined = still(bake(model({ parts: [base, { ...lid, line: true }] }), setup()))
    // The outline's color, on the base just under the lid; the lid keeps every pixel.
    const drawn = count(lined, "#000000") - count(plain, "#000000")
    expect(drawn).toBeGreaterThan(0)
    expect(count(lined, "#aa0000")).toBe(count(plain, "#aa0000"))
    expect(count(plain, "#00aa00") - count(lined, "#00aa00")).toBe(drawn)
    const colored = still(bake(model({ parts: [base, { ...lid, line: "#0000aa" }] }), setup()))
    expect(count(colored, "#0000aa")).toBe(drawn)
    // "step": the base goes a step darker under the lid instead.
    const ramped = still(bake(model({ parts: [{ ...base, material: "ramp", steps: { left: 2, right: 2 } }, { ...lid, line: "step" }] }), setup()))
    expect(count(ramped, MID)).toBe(drawn)
    // With no outline, a line takes the darkest color there is.
    const bare = still(bake(model({ outline: false, materials: { deep: "#010101" }, parts: [base, { ...lid, line: true }, { shape: "box", material: "deep", from: [20, 20, 0], to: [21, 21, 1], detail: true }] }), setup()))
    expect(count(bare, "#010101")).toBeGreaterThan(drawn)
  })

  it("lays a face's rows over it from its top left, so a door turns with its wall", () => {
    const door = { shape: "face", corners: [[-4, 5, 0], [4, 5, 0], [4, 5, 8], [-4, 5, 8]], rows: ["AB", "CC"] }
    const fields = { ...without, headings: 4, materials: { A: "#aa0000", B: "#00aa00", C: "#0000aa" }, parts: [box, door] }
    const result = bake(model(fields), setup())
    const art = result.clips[0]!.frames[0]!.art
    const where = (color: string) => {
      const points: Array<[number, number]> = []
      for (let y = 0; y < art.height; y++) for (let x = 0; x < art.width; x++) if (colorAt(art, x, y) === color) points.push([x, y])
      return { x: points.reduce((sum, p) => sum + p[0], 0) / points.length, y: points.reduce((sum, p) => sum + p[1], 0) / points.length, n: points.length }
    }
    const a = where("#aa0000")
    const b = where("#00aa00")
    const c = where("#0000aa")
    expect(a.n).toBeGreaterThan(0)
    expect(a.x).toBeLessThan(b.x)
    expect(c.y).toBeGreaterThan(a.y)
    expect(colors(art).has(MID) || colors(art).has(DARK)).toBe(true)
    // Turned half way, the wall faces away and its door with it.
    expect(colors(result.clips[2]!.frames[0]!.art).has("#aa0000")).toBe(false)
  })

  it("shows what is behind a face where its rows say .", () => {
    const window = { shape: "face", corners: [[-4, 5, 2], [4, 5, 2], [4, 5, 8], [-4, 5, 8]], rows: ["A.A"] }
    const art = still(bake(model({ ...without, materials: { A: "#aa0000" }, parts: [{ ...box, steps: { left: 0, right: 0, top: 0 } }, window] }), setup()))
    const middle = still(bake(model({ ...without, materials: { A: "#aa0000" }, parts: [{ ...box, steps: { left: 0, right: 0, top: 0 } }, { ...window, rows: ["AAA"] }] }), setup()))
    expect(count(art, "#aa0000")).toBeLessThan(count(middle, "#aa0000"))
    expect(count(art, DARK)).toBeGreaterThan(count(middle, DARK))
  })

  it("maps what every pixel shows: its part, its face, which way it faces, and where on it", () => {
    const door = { name: "door", shape: "face", material: "#aa0000", corners: [[-4, 5, 0], [4, 5, 0], [4, 5, 8], [-4, 5, 8]] }
    const result = bake(model({ parts: [{ ...box, name: "walls" }, door] }), setup())
    const frame = result.clips[0]!.frames[0]!
    const { map, art } = frame
    expect(result.partsShown.map((part) => part.name)).toEqual(["walls", "door"])
    expect(result.partsShown[0]!.material).toBe("ramp")
    const facings = new Set<number>()
    for (let i = 0; i < art.width * art.height; i++) {
      if (map.part[i]! < 0) continue
      // Mapped pixels are drawn, and what the outline adds is not mapped.
      expect(art.indices[i]).not.toBe(TRANSPARENT)
      expect(colorAt(art, i % art.width, Math.floor(i / art.width))).not.toBe("#000000")
      facings.add(map.facing[i]!)
      expect(map.u[i]!).toBeGreaterThanOrEqual(0)
      expect(map.u[i]!).toBeLessThanOrEqual(1)
      if (map.part[i] === 1) {
        expect(colorAt(art, i % art.width, Math.floor(i / art.width))).toBe("#aa0000")
        expect(map.facing[i]).toBe(2)
      }
    }
    expect(facings).toEqual(new Set([1, 2, 3]))
    // Nearer is more: the box's near corner is in front of its far one.
    const { x, y } = result.anchor
    expect(map.depth[(y + 2) * art.width + x]!).toBeGreaterThan(map.depth[(y - 20) * art.width + x]!)
  })
})

describe("what a model can say", () => {
  const without = { outline: false }

  it("makes a roof, a cone, a ball, and a free mesh", () => {
    expect(colors(still(bake(model({ ...without, parts: [{ ...box, top: [1, 0] }] }), setup()))).size).toBeGreaterThan(0)
    expect(colors(still(bake(model({ ...without, parts: [{ shape: "cylinder", material: "ramp", from: [-5, -5, 0], to: [5, 5, 12], taper: 0 }] }), setup()))).size).toBeGreaterThan(1)
    expect(colors(still(bake(model({ ...without, parts: [{ shape: "sphere", material: "ramp", from: [-5, -5, 0], to: [5, 5, 10] }] }), setup()))).size).toBeGreaterThan(1)
    const star = {
      shape: "mesh",
      material: "ramp",
      points: [[0, 0, 12], [-6, -6, 0], [6, -6, 0], [6, 6, 0], [-6, 6, 0]],
      faces: [[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]]
    }
    expect(still(bake(model({ ...without, parts: [star] }), setup())).indices.some((index) => index !== TRANSPARENT)).toBe(true)
    const beyond = { ...star, faces: [[0, 1, 9]] }
    expect(problems({ parts: [beyond] }).join("\n")).toContain("positions in `points`")
  })

  it("repeats a part, turning it and taking materials in turn, which makes stripes", () => {
    const stripe = {
      shape: "face",
      corners: [[-10, 12, 0], [-8, 12, 0], [-8, 12, 12], [-10, 12, 12]],
      repeat: { count: 10, move: [2, 0, 0], materials: ["#aa0000", "#00aa00"] }
    }
    const art = still(bake(model({ ...without, parts: [stripe] }), setup()))
    expect(count(art, "#aa0000")).toBeGreaterThan(0)
    expect(count(art, "#00aa00")).toBeGreaterThan(0)
    const turned = { shape: "box", material: "#ffffff", from: [8, -1, 0], to: [12, 1, 2], repeat: { count: 4, rotate: { axis: "z", degrees: 90 } } }
    const once = { ...turned, repeat: { count: 1 } }
    expect(count(still(bake(model({ ...without, parts: [turned] }), setup())), "#ffffff")).toBeGreaterThan(count(still(bake(model({ ...without, parts: [once] }), setup())), "#ffffff") * 2)
  })

  it("moves and turns a group as one thing, inside another", () => {
    const bare = { shape: "box", from: [-2, -2, 0], to: [2, 2, 4] }
    const moved = bake(model({ ...without, frame: { width: 60, up: 30, below: 30 }, parts: [{ material: "#ffffff", move: [10, 0, 0], parts: [{ move: [10, 0, 0], parts: [bare] }] }] }), setup())
    const direct = bake(model({ ...without, frame: { width: 60, up: 30, below: 30 }, parts: [{ ...bare, material: "#ffffff", move: [20, 0, 0] }] }), setup())
    expect(Array.from(still(moved).indices)).toEqual(Array.from(still(direct).indices))
    const spun = bake(model({ ...without, frame: { width: 60, up: 30, below: 30 }, parts: [{ material: "#ffffff", rotate: { axis: "z", degrees: 90 }, parts: [{ ...bare, move: [20, 0, 0] }] }] }), setup())
    const placed = bake(model({ ...without, frame: { width: 60, up: 30, below: 30 }, parts: [{ ...bare, material: "#ffffff", move: [0, 20, 0] }] }), setup())
    expect(Array.from(still(spun).indices)).toEqual(Array.from(still(placed).indices))
  })

  it("shows a face lying exactly on a wall", () => {
    const door = { shape: "face", material: "#ff0000", corners: [[5, -2, 0], [5, 2, 0], [5, 2, 6], [5, -2, 6]] }
    expect(count(still(bake(model({ ...without, parts: [box, door] }), setup())), "#ff0000")).toBeGreaterThan(0)
    expect(count(still(bake(model({ ...without, parts: [door, box] }), setup())), "#ff0000")).toBeGreaterThan(0)
  })

  it("lets a small part survive the shrinking when it is marked detail", () => {
    const thin = { shape: "box", material: "#ff0000", from: [-0.1, -0.1, 0], to: [0.1, 0.1, 18] }
    expect(count(still(bake(model({ ...without, parts: [thin] }), setup())), "#ff0000")).toBe(0)
    expect(count(still(bake(model({ ...without, parts: [{ ...thin, from: [-0.2, -0.2, 0], to: [0.2, 0.2, 18], detail: true }] }), setup())), "#ff0000")).toBeGreaterThan(0)
    expect(count(still(bake(model({ ...without, parts: [{ detail: true, parts: [{ ...thin, from: [-0.2, -0.2, 0], to: [0.2, 0.2, 18] }] }] }), setup())), "#ff0000")).toBeGreaterThan(0)
  })

  it("moves parts through an animation, a whole turn or there and back", () => {
    const blade = { shape: "box", material: "#ffffff", from: [-1, -8, 10], to: [1, 8, 12], animate: { spin: { rotate: { axis: "z", degrees: 180 } } } }
    const result = bake(model({ ...without, animations: { spin: { frames: 4, fps: 12 } }, parts: [blade] }), setup())
    expect(result.clips.map((clip) => [clip.name, clip.frames.length, clip.fps])).toEqual([["spin", 4, 12]])
    expect(Array.from(result.clips[0]!.frames[0]!.art.indices)).not.toEqual(Array.from(result.clips[0]!.frames[1]!.art.indices))
    const bob = { ...blade, animate: { bob: { move: [0, 0, 6], wave: true } } }
    const waved = bake(model({ ...without, animations: { bob: { frames: 4 } }, parts: [bob] }), setup()).clips[0]!.frames
    // Up at a quarter, back at a half, down at three quarters.
    expect(Array.from(waved[0]!.art.indices)).toEqual(Array.from(waved[2]!.art.indices))
    expect(Array.from(waved[1]!.art.indices)).not.toEqual(Array.from(waved[3]!.art.indices))
  })

  it("names each animation for its heading when there are both", () => {
    const result = bake(model({ headings: 2, animations: { spin: { frames: 2 } }, parts: [box] }), setup())
    expect(result.clips.map((clip) => clip.name)).toEqual(["spin-heading-0", "spin-heading-1"])
  })
})

describe("hand-placed pixels", () => {
  const Y = "#ffff00"
  const paint = (extra: Record<string, unknown>) => ({ materials: { Y }, parts: [box], ...extra })

  it("draws them over the model, and the outline goes around them", () => {
    const result = bake(model(paint({ paint: [{ at: [-1, -40], rows: ["YY", "YY"] }] })), setup())
    const art = still(result)
    expect(count(art, Y)).toBe(4)
    expect(colorAt(art, result.anchor.x - 2, result.anchor.y - 40)).toBe("#000000")
  })

  it("grows an automatic frame to hold them", () => {
    const short = bake(model(paint({})), setup())
    const tall = bake(model(paint({ paint: [{ at: [0, -60], rows: ["Y"] }] })), setup())
    expect(tall.anchor.y).toBeGreaterThan(short.anchor.y)
    expect(tall.anchor.y).toBeGreaterThanOrEqual(60)
  })

  it("clears with _ and leaves with .", () => {
    const whole = still(bake(model(paint({ outline: false })), setup()))
    const result = bake(model(paint({ outline: false, paint: [{ at: [-1, 0], rows: ["_._"] }] })), setup())
    const art = still(result)
    const opaque = (a: PixelArt) => Array.from(a.indices).filter((index) => index !== TRANSPARENT).length
    expect(opaque(whole) - opaque(art)).toBe(2)
    expect(colorAt(art, result.anchor.x, result.anchor.y)).not.toBeUndefined()
  })

  it("can go only on some headings and frames, as a flame's flicker does", () => {
    const fields = paint({ headings: 2, animations: { burn: { frames: 2 } }, paint: [{ at: [0, -30], rows: ["Y"], animation: "burn", frames: [1], headings: [0] }] })
    const clips = bake(model(fields), setup()).clips
    expect(count(clips[0]!.frames[0]!.art, Y)).toBe(0)
    expect(count(clips[0]!.frames[1]!.art, Y)).toBe(1)
    expect(count(clips[1]!.frames[1]!.art, Y)).toBe(0)
  })

  it("goes over the outline with `after`", () => {
    const result = bake(model(paint({ paint: [{ at: [-30, 0], rows: ["Y"], after: true }], frame: { width: 80, up: 40, below: 20 } })), setup())
    expect(colorAt(still(result), result.anchor.x - 29, result.anchor.y)).toBeUndefined()
    expect(colorAt(still(result), result.anchor.x - 30, result.anchor.y)).toBe(Y)
  })
})

describe("one outline", () => {
  it("never breaks at a sharp tip, and leaves no lone pixel there", () => {
    const using = setup({ camera: { ...defaultBakeSetup.camera, axes: { across: [1, -1, 0], down: [0.6, 0.6, -0.88] } } })
    const house = {
      parts: [
        { shape: "box", material: "ramp", from: [-7, -5, 0], to: [7, 5, 10] },
        { shape: "box", material: "ramp", from: [-8.5, -6.5, 10], to: [8.5, 6.5, 18], top: [1, 0] }
      ]
    }
    const art = still(bake(model(house, using), using))
    expect(strayPixels(art.indices, art.width, art.height)).toEqual([])
    // Every pixel of the shape has the outline, never the empty, beside it.
    for (let y = 0; y < art.height; y++) {
      for (let x = 0; x < art.width; x++) {
        const color = colorAt(art, x, y)
        if (color === undefined || color === "#000000") continue
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) expect(colorAt(art, x + dx, y + dy)).toBeDefined()
      }
    }
  })
})

describe("clean pixels", () => {
  const busy = {
    headings: 8,
    parts: [
      { shape: "box", material: "ramp", from: [-6, -6, 0], to: [6, 6, 8] },
      { shape: "cylinder", material: "ramp", from: [-2, -2, 8], to: [2, 2, 20], taper: 0.5, sides: 6 },
      { shape: "box", material: "#ff0000", from: [-0.5, 2, 8], to: [0.5, 3, 24] }
    ]
  }

  it("leaves none of the lint's lone pixels by default", () => {
    for (const clip of bake(model(busy), setup()).clips) {
      const { art } = clip.frames[0]!
      expect(strayPixels(art.indices, art.width, art.height)).toEqual([])
    }
  })

  it("keeps them when a model asks, and always keeps what was placed on purpose", () => {
    const Y = "#ffff00"
    const lone = { materials: { Y }, outline: false, parts: [{ ...box, material: "#123456" }], paint: [{ at: [0, -8], rows: ["Y"] }] }
    const result = bake(model(lone), setup())
    expect(colorAt(still(result), result.anchor.x, result.anchor.y - 8)).toBe(Y)
    const speck = { outline: false, parts: [{ ...box, material: "#123456" }, { shape: "box", material: "#ff0000", detail: true, from: [-0.4, -0.4, 10], to: [0.4, 0.4, 10.5] }] }
    expect(count(still(bake(model(speck), setup())), "#ff0000")).toBeGreaterThan(0)
    expect(model({ cleanup: false, parts: [box] }).cleanup).toBe(false)
  })

  it("writes directions that match the art's shape, and a shadow of its own", () => {
    const result = bake(model({ shadow: true, normals: true, parts: [box] }), setup())
    const frame = result.clips[0]!.frames[0]!
    for (let i = 0; i < frame.art.indices.length; i++) {
      const alpha = frame.normal.data[i * 4 + 3]!
      expect(alpha).toBe(frame.art.indices[i] === TRANSPARENT ? 0 : 255)
      if (alpha === 0) continue
      const [x, y, z] = [frame.normal.data[i * 4]! / 127.5 - 1, frame.normal.data[i * 4 + 1]! / 127.5 - 1, frame.normal.data[i * 4 + 2]! / 127.5 - 1]
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 1)
      expect(z).toBeGreaterThan(0)
    }
    expect(frame.shadow.indices.some((index) => index !== TRANSPARENT)).toBe(true)
  })
})

// Each case runs the CLI as its own process, a few seconds each on CI.
describe("the command", { timeout: 60_000 }, () => {
  const folder = (config: unknown = { bake: { camera: { scale: 2 }, outline: "#000000", materials: { ramp: RAMP } } }): string => {
    const dir = mkdtempSync(join(tmpdir(), "ritmo-bake-"))
    writeFileSync(join(dir, "pixel.config.json"), JSON.stringify(config))
    return dir
  }
  const write = (dir: string, name: string, fields: unknown): void => writeFileSync(join(dir, name), JSON.stringify(fields))

  it("writes a still as a PNG and a sprite source that agree, and reports clean", () => {
    const dir = folder()
    write(dir, "shed.bake.json", { parts: [box] })
    const result = run(dir, "bake", "shed.bake.json")
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout) as { verdict: string; files: Record<string, unknown>; frame: { width: number } }
    expect(report.verdict).toBe("clean")
    expect(Object.keys(report.files).sort()).toEqual(["png", "preview", "sprite"])
    const png = decodePng(new Uint8Array(readFileSync(join(dir, "shed.png"))))
    const sprite = parseSprite(readFileSync(join(dir, "shed.sprite.txt"), "utf8"))
    expect(sprite.ok && [sprite.art.width, sprite.art.height]).toEqual([png.width, png.height])
    expect(report.frame.width).toBe(png.width)
    expect(run(dir, "lint", "shed.png").status).toBe(0)
  })

  it("writes a sheet the sheet tools read, its anchor on the model's origin", () => {
    const dir = folder()
    write(dir, "cart.bake.json", { headings: 4, animations: { roll: { frames: 2, fps: 6 } }, normals: true, shadow: true, parts: [{ ...box, animate: { roll: { move: [0, 0, 1], wave: true } } }] })
    const result = run(dir, "bake", "cart.bake.json")
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout) as { animations: ReadonlyArray<string>; frame: { width: number; height: number; anchor: { x: number; y: number } } }
    expect(report.animations).toEqual(["roll-heading-0", "roll-heading-1", "roll-heading-2", "roll-heading-3"])
    const picture = decodePng(new Uint8Array(readFileSync(join(dir, "cart.png"))))
    const json = JSON.parse(readFileSync(join(dir, "cart.json"), "utf8")) as { frames: Record<string, { anchor: { x: number; y: number }; duration: number }> }
    const sheet = readSpritesheet(json, picture)
    expect(sheet?.ok).toBe(true)
    const first = json.frames["roll-heading-0 0"]!
    expect(first.duration).toBe(167)
    expect(first.anchor.x).toBeCloseTo(report.frame.anchor.x / report.frame.width, 3)
    expect(first.anchor.y).toBeCloseTo(report.frame.anchor.y / report.frame.height, 3)
    const normal = decodePng(new Uint8Array(readFileSync(join(dir, "cart.normal.png"))))
    expect([normal.width, normal.height]).toEqual([picture.width, picture.height])
    expect(existsSync(join(dir, "cart.shadow.png"))).toBe(true)
    expect(existsSync(join(dir, "cart.roll-heading-0.gif"))).toBe(true)
    // Its normal map lines up with it, by the same checks as any other.
    const issues = (JSON.parse(run(dir, "lint", "cart.normal.png").stdout) as { issues: ReadonlyArray<{ rule: string; severity: string }> }).issues
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([])
    expect(issues.map((issue) => issue.rule)).not.toContain("normal-flicker")
  })

  it("removes what an earlier bake wrote that this one does not, and nothing else", () => {
    const dir = folder()
    const moving = { animations: { roll: { frames: 2 } }, normals: true, shadow: true, parts: [{ ...box, animate: { roll: { move: [0, 0, 1] } } }] }
    write(dir, "cart.bake.json", moving)
    expect(run(dir, "bake", "cart.bake.json").status).toBe(0)
    writeFileSync(join(dir, "cart.big.roll.gif"), "another model's")
    write(dir, "cart.bake.json", { parts: [box] })
    const still = JSON.parse(run(dir, "bake", "cart.bake.json").stdout) as { files: { removed: ReadonlyArray<string> } }
    expect(still.files.removed.map((file) => file.split(/[\\/]/).pop()).sort()).toEqual(["cart.json", "cart.normal.png", "cart.roll.gif", "cart.roll.onion.png", "cart.shadow.png"])
    expect(existsSync(join(dir, "cart.big.roll.gif"))).toBe(true)
    // Back to a sheet: the still's text goes, and a map `pixel normals` made stays.
    write(dir, "cart.bake.json", { headings: 2, parts: [box] })
    writeFileSync(join(dir, "cart.normal.png"), readFileSync(join(dir, "cart.png")))
    write(dir, "cart.normals.json", {})
    const sheet = JSON.parse(run(dir, "bake", "cart.bake.json").stdout) as { files: { removed: ReadonlyArray<string> } }
    expect(sheet.files.removed.map((file) => file.split(/[\\/]/).pop())).toEqual(["cart.sprite.txt"])
    expect(existsSync(join(dir, "cart.normal.png"))).toBe(true)
  })

  it("does not call a turn an animation that flickers", () => {
    const dir = folder()
    write(dir, "cart.bake.json", { headings: 8, normals: true, parts: [box] })
    expect(run(dir, "bake", "cart.bake.json").status).toBe(0)
    const issues = (JSON.parse(run(dir, "lint", "cart.png").stdout) as { issues: ReadonlyArray<{ rule: string }> }).issues
    expect(issues.map((issue) => issue.rule)).not.toContain("normal-flicker")
  })

  it("exits 2 with every problem, for a broken model or a misnamed one", () => {
    const dir = folder()
    write(dir, "bad.bake.json", { parts: [{ shape: "box", material: "nope", from: [0, 0, 0], to: [1, 1, 1] }] })
    const broken = run(dir, "bake", "bad.bake.json")
    expect(broken.status).toBe(2)
    expect(broken.stdout).toContain("$.parts[0].material")
    write(dir, "plain.json", { parts: [box] })
    const misnamed = run(dir, "bake", "plain.json")
    expect(misnamed.status).toBe(2)
    expect(misnamed.stderr).toContain("<name>.bake.json")
    const badConfig = folder({ bake: { camera: { zoom: 2 } } })
    write(badConfig, "a.bake.json", { parts: [{ ...box, material: "#fff" }] })
    const unread = run(badConfig, "bake", "a.bake.json")
    expect(unread.status).toBe(2)
    expect(unread.stdout).toContain("bake.camera.zoom")
  })

  it("exits 3 when the frame cuts the art or the project's palette is broken, and says a hidden part quietly", () => {
    const dir = folder()
    write(dir, "cut.bake.json", { frame: { width: 8, up: 4, below: 4 }, parts: [box] })
    const cut = run(dir, "bake", "cut.bake.json")
    expect(cut.status).toBe(3)
    expect(cut.stdout).toContain("bake-cut")
    write(dir, "hid.bake.json", { parts: [box, { name: "inside", shape: "box", material: "ramp", from: [-1, -1, 1], to: [1, 1, 2] }] })
    const hidden = run(dir, "bake", "hid.bake.json")
    expect(hidden.status).toBe(0)
    expect(hidden.stdout).toContain("inside ($.parts[1]) shows no pixel")
    const strict = folder({ palette: ["#000000", "#ffffff"], bake: { camera: { scale: 2 }, materials: { ramp: RAMP } } })
    write(strict, "off.bake.json", { parts: [box] })
    const off = run(strict, "bake", "off.bake.json")
    expect(off.status).toBe(3)
    expect(off.stdout).toContain("off-palette")
  })

  it("takes the darkest of the project's palette for the outline when none is set", () => {
    const dir = folder({ palette: ["#020202", "#ffffff"], bake: { camera: { scale: 2 }, materials: { w: "#ffffff" } } })
    write(dir, "a.bake.json", { parts: [{ ...box, material: "w" }] })
    expect(run(dir, "bake", "a.bake.json").status).toBe(0)
    const sprite = parseSprite(readFileSync(join(dir, "a.sprite.txt"), "utf8"))
    expect(sprite.ok && sprite.art.palette.map(toHex).sort()).toEqual(["#020202", "#ffffff"])
  })

  it("writes the map of a still or a sheet over its PNG, and removes it when no longer asked", () => {
    const dir = folder()
    write(dir, "cart.bake.json", { map: true, headings: 2, parts: [{ ...box, name: "body" }] })
    const result = run(dir, "bake", "cart.bake.json")
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout) as { files: Record<string, unknown> }
    expect(report.files.map).toBeDefined()
    const png = decodePng(new Uint8Array(readFileSync(join(dir, "cart.png"))))
    const map = JSON.parse(readFileSync(join(dir, "cart.map.json"), "utf8")) as { image: string; width: number; height: number; parts: ReadonlyArray<{ name: string }>; facing: ReadonlyArray<string>; part: ReadonlyArray<number> }
    expect([map.image, map.width, map.height]).toEqual(["cart.png", png.width, png.height])
    expect(map.parts.map((part) => part.name)).toEqual(["body"])
    expect(map.facing).toHaveLength(png.height)
    expect(map.part).toHaveLength(png.width * png.height)
    // Both headings are mapped, each where it sits in the sheet.
    const half = png.width / 2
    expect(map.facing.some((row) => /[TLR]/.test(row.slice(0, half)))).toBe(true)
    expect(map.facing.some((row) => /[TLR]/.test(row.slice(half)))).toBe(true)
    for (let i = 0; i < map.part.length; i++) if (map.part[i]! >= 0) expect(png.data[i * 4 + 3]).toBe(255)
    write(dir, "cart.bake.json", { parts: [box] })
    const again = JSON.parse(run(dir, "bake", "cart.bake.json").stdout) as { files: { removed: ReadonlyArray<string> } }
    expect(again.files.removed.map((file) => file.split(/[\\/]/).pop())).toContain("cart.map.json")
  })

  it("writes where --out says", () => {
    const dir = folder()
    write(dir, "a.bake.json", { parts: [box] })
    expect(run(dir, "bake", "a.bake.json", "--out", "art/shed").status).toBe(0)
    expect(existsSync(join(dir, "art", "shed.png"))).toBe(true)
  })

  it("shows the review the art, and names the model as its source", async () => {
    const dir = folder()
    write(dir, "cart.bake.json", { shadow: true, normals: true, parts: [box] })
    expect(run(dir, "bake", "cart.bake.json").status).toBe(0)
    const assets = await findAssets([dir])
    expect(assets.map((asset) => asset.file.split("/").pop())).toEqual(["cart.png"])
    expect(assets[0]!.source?.endsWith("cart.bake.json")).toBe(true)
  })
})
