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
})

describe("one camera", () => {
  it("puts a point where the project's numbers say", () => {
    // Landkeep's view: a point lands at x = u - v, y = (u + v) * 0.6 - z * 0.88.
    const using = setup({ camera: { yaw: 45, elevation: Math.asin(0.6) * (180 / Math.PI), scale: Math.SQRT2, heightScale: 0.88 / (Math.SQRT2 * 0.8) } })
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

describe("the command", () => {
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
