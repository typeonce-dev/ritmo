import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { findAssets, libraryOf, readAsset } from "@typeonce/ritmo-tools/pixel/cli/library.ts"
import { decodePng, encodePng } from "@typeonce/ritmo-tools/pixel/cli/png.ts"
import { api } from "@typeonce/ritmo-tools/pixel/cli/serve.ts"
import type { RgbaImage } from "@typeonce/ritmo-tools/pixel/core/grid.ts"
import {
  decodeNormals,
  encodeNormals,
  flickerOf,
  lightFrame,
  makeNormals,
  normalIssues,
  vectorOfFacing,
  type Light,
  type NormalFrame,
  type NormalPreset
} from "@typeonce/ritmo-tools/pixel/core/normals.ts"
import { previewLit } from "@typeonce/ritmo-tools/pixel/core/preview.ts"
import { approvalOf, changedSince, decodeReview, encodeReview, hashFrame, reviewSummary, type Frame } from "@typeonce/ritmo-tools/pixel/core/review.ts"

const cli = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))
const run = (cwd: string, ...args: Array<string>) => spawnSync(process.execPath, [cli, "pixel", ...args], { cwd, encoding: "utf8" })

type Rgb = readonly [number, number, number]

const picture = (width: number, height: number, color: (x: number, y: number) => Rgb | undefined): RgbaImage => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = color(x, y)
      if (c !== undefined) data.set([...c, 255], (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

const still = (image: RgbaImage): ReadonlyArray<NormalFrame> => [{ index: 0, x: 0, y: 0, w: image.width, h: image.height }]
const make = (image: RgbaImage, preset: NormalPreset = "object") => makeNormals(image, still(image), { preset, corrections: [] })

/** The way a pixel of a map faces. */
const vectorAt = (map: RgbaImage, x: number, y: number): readonly [number, number, number] => {
  const i = (y * map.width + x) * 4
  return [map.data[i]! / 127.5 - 1, map.data[i + 1]! / 127.5 - 1, map.data[i + 2]! / 127.5 - 1]
}

const degreesBetween = (a: readonly [number, number, number], b: readonly [number, number, number]): number => {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  return (Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...a) * Math.hypot(...b))))) * 180) / Math.PI
}

/** A ball lit from the top left and painted in bands, as pixel art shades one, with an outline. `truth` is the way each of its pixels really faces. */
const ball = (radius: number): { readonly image: RgbaImage; readonly truth: (x: number, y: number) => readonly [number, number, number] } => {
  const size = radius * 2 + 3
  const center = (size - 1) / 2
  const truth = (x: number, y: number): readonly [number, number, number] => {
    const nx = (x - center) / radius
    const ny = (center - y) / radius
    return [nx, ny, Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))]
  }
  const ramp: ReadonlyArray<Rgb> = [[60, 40, 90], [110, 70, 130], [170, 110, 170], [220, 170, 210]]
  const image = picture(size, size, (x, y) => {
    const distance = Math.hypot(x - center, y - center)
    if (distance > radius + 1) return undefined
    if (distance > radius) return [20, 16, 30]
    const [nx, ny, nz] = truth(x, y)
    const shade = Math.max(0, nx * -0.5 + ny * 0.5 + nz * 0.7)
    return ramp[Math.min(3, Math.floor(shade * 4))]!
  })
  return { image, truth }
}

/** A cube as an isometric picture draws it: a bright top, a mid left, a dark right. */
const cube = (): RgbaImage => {
  const size = 41
  const middle = 20
  return picture(size, size, (x, y) => {
    const dx = Math.abs(x - middle)
    if (dx > 20) return undefined
    // The top is a diamond, 10 tall each way from its middle; the sides hang under it.
    if (y >= dx / 2 && y <= 20 - dx / 2) return [235, 230, 210]
    if (y < dx / 2 || y > 40 - dx / 2) return undefined
    return x < middle ? [140, 130, 110] : [70, 60, 60]
  })
}

/** Four frames on one row: a head that stays still, over a bright body with a dark band of shading sweeping across it, which tips the way the body seems to slope. */
const walking = (): { readonly image: RgbaImage; readonly frames: ReadonlyArray<NormalFrame & { readonly hash: string }> } => {
  const width = 16
  const height = 24
  const sweep = [2, 6, 10, 6]
  const image = picture(width * sweep.length, height, (px, y) => {
    const frame = Math.floor(px / width)
    const x = px - frame * width
    if (y < 7) return Math.hypot(x - 7.5, y - 3.5) < 3.5 ? [230, 190, 150] : undefined
    if (x < 1 || x > 14 || y > 22) return undefined
    return x >= sweep[frame]! && x < sweep[frame]! + 3 ? [50, 60, 110] : [150, 180, 240]
  })
  const frames = sweep.map((_, index) => ({ animation: "walk", index, x: index * width, y: 0, w: width, h: height, hash: hashFrame(image, index * width, 0, width, height) }))
  return { image, frames }
}

describe("a normal map's directions", () => {
  it("names directions as the picture shows them: up is green, right is red", () => {
    expect(vectorOfFacing("front")).toEqual([0, 0, 1])
    const up = vectorOfFacing("up")
    expect(up[0]).toBeCloseTo(0)
    expect(up[1]).toBeGreaterThan(0.5)
    const right = vectorOfFacing("right")
    expect(right[0]).toBeGreaterThan(0.5)
    expect(right[1]).toBeCloseTo(0)
    const corner = vectorOfFacing("down-left", 30)
    expect(corner[0]).toBeLessThan(0)
    expect(corner[1]).toBeLessThan(0)
    expect(Math.hypot(...corner)).toBeCloseTo(1)
  })

  it("is nearer a ball's true shape than a flat map, and its top faces up and its left faces left", () => {
    const { image, truth } = ball(20)
    const map = make(image).image
    let made = 0
    let flat = 0
    let count = 0
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        if (image.data[(y * image.width + x) * 4 + 3] === 0) continue
        const want = truth(x, y)
        if (want[2] === 0) continue
        made += degreesBetween(vectorAt(map, x, y), want)
        flat += degreesBetween([0, 0, 1], want)
        count++
      }
    }
    // Measured: 27 degrees off on average, where a flat map is 45 off.
    expect(made / count).toBeLessThan(30)
    expect(flat / count).toBeGreaterThan(44)
    expect(vectorAt(map, 21, 5)[1]).toBeGreaterThan(0.2)
    expect(vectorAt(map, 5, 21)[0]).toBeLessThan(-0.2)
    expect(vectorAt(map, 21, 37)[1]).toBeLessThan(-0.2)
    expect(vectorAt(map, 37, 21)[0]).toBeGreaterThan(0.2)
  })

  it("reads a cube's three faces as three directions", () => {
    const image = cube()
    const map = make(image, "architecture").image
    const top = vectorAt(map, 20, 10)
    const left = vectorAt(map, 10, 24)
    const right = vectorAt(map, 30, 24)
    expect(degreesBetween(top, left)).toBeGreaterThan(20)
    expect(degreesBetween(top, right)).toBeGreaterThan(20)
    expect(degreesBetween(left, right)).toBeGreaterThan(20)
    // The bright top against the darker faces below: it faces up the picture.
    expect(top[1]).toBeGreaterThan(left[1])
    expect(top[1]).toBeGreaterThan(right[1])
  })

  it("makes the same map every time, drawn exactly where the art is", () => {
    const { image } = ball(8)
    const a = make(image).image
    expect(Buffer.from(a.data)).toEqual(Buffer.from(make(image).image.data))
    for (let i = 3; i < a.data.length; i += 4) expect(a.data[i]).toBe(image.data[i])
    // A transparent pixel faces the viewer: a game sampling near an edge gets no stray direction.
    expect([...a.data.subarray(0, 3)]).toEqual([128, 128, 255])
  })

  it("is flat for art with nothing to read, without failing", () => {
    const image = picture(4, 4, () => [100, 100, 100])
    const made = make(image, "terrain")
    expect(made.corrections).toEqual([])
    expect(make(picture(3, 3, () => undefined)).front).toBe(0)
  })
})

describe("flicker across an animation", () => {
  it("keeps a surface's direction through the frames, where making each frame alone does not", () => {
    const { image, frames } = walking()
    const shared = makeNormals(image, frames, { preset: "character", corrections: [] }).image
    // The same frames each made alone, as a tool that takes one picture at a time would.
    const alone: RgbaImage = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data.length) }
    for (const frame of frames) {
      const part = makeNormals(image, [{ index: 0, x: frame.x, y: frame.y, w: frame.w, h: frame.h }], { preset: "character", corrections: [] }).image
      for (let y = 0; y < frame.h; y++) {
        for (let x = 0; x < frame.w; x++) {
          const i = ((frame.y + y) * image.width + frame.x + x) * 4
          for (let c = 0; c < 4; c++) alone.data[i + c] = part.data[i + c]!
        }
      }
    }
    const [together] = flickerOf(image, shared, frames)
    const [apart] = flickerOf(image, alone, frames)
    // Measured: none together, 15% apart.
    expect(together!.pixels).toBeGreaterThan(0)
    expect(apart!.share).toBeGreaterThan(together!.share)
    expect(together!.share).toBeLessThan(0.05)
  })

  it("has nothing to say about a still, and points at the frame that jumps most", () => {
    const { image, frames } = walking()
    expect(flickerOf(image, make(image).image, still(image))).toEqual([])
    // A map that turns the whole of frame 1 another way.
    const map = makeNormals(image, frames, { preset: "character", corrections: [] }).image
    const turned = new Uint8ClampedArray(map.data)
    const frame = frames[1]!
    for (let y = 0; y < frame.h; y++) {
      for (let x = 0; x < frame.w; x++) {
        const i = ((frame.y + y) * image.width + frame.x + x) * 4
        turned.set([230, 128, 185], i)
      }
    }
    const [flicker] = flickerOf(image, { ...map, data: turned }, frames)
    expect(flicker!.share).toBeGreaterThan(0.2)
    expect([0, 1]).toContain(flicker!.worst?.index)
    expect(flicker!.worst!.at.length).toBeGreaterThan(0)
  })
})

describe("corrections", () => {
  it("turns the whole surface pointed at, in every frame it carries on through", () => {
    const { image, frames } = walking()
    // Dragged inside the head's lit half, on frame 2 only.
    const made = makeNormals(image, frames, { preset: "character", corrections: [{ animation: "walk", frame: 2, x: 6, y: 2, width: 2, height: 1, facing: "right" }] })
    expect(made.corrections[0]).toMatchObject({ frames: 4, problem: undefined })
    const want = vectorOfFacing("right")
    for (const frame of frames) expect(degreesBetween(vectorAt(made.image, frame.x + 7, 2), want)).toBeLessThan(2)
    const [flicker] = flickerOf(image, made.image, frames)
    expect(flicker!.share).toBeLessThan(0.05)
  })

  it("leaves the surfaces it does not point at", () => {
    const { image, frames } = walking()
    const before = makeNormals(image, frames, { preset: "character", corrections: [] }).image
    const after = makeNormals(image, frames, { preset: "character", corrections: [{ animation: "walk", frame: 0, x: 6, y: 2, facing: "right" }] }).image
    // The shirt, under the head.
    expect(vectorAt(after, 9, 14)).toEqual(vectorAt(before, 9, 14))
  })

  it("says what it could not do", () => {
    const { image, frames } = walking()
    const made = makeNormals(image, frames, {
      preset: "character",
      corrections: [
        { animation: "run", frame: 0, x: 0, y: 0, facing: "up" },
        { animation: "walk", frame: 9, x: 0, y: 0, facing: "up" },
        { animation: "walk", frame: 0, x: 0, y: 0, facing: "up" }
      ]
    })
    expect(made.corrections.map((result) => result.problem)).toEqual(['there is no animation "run"', "frame 9 is not in walk", "nothing is drawn in its area"])
  })

  it("keeps a tilt, and front has none", () => {
    const { image } = ball(8)
    const tilted = makeNormals(image, still(image), { preset: "object", corrections: [{ frame: 0, x: 0, y: 0, width: image.width, height: image.height, facing: "up", tilt: 20 }] }).image
    expect(degreesBetween(vectorAt(tilted, 9, 9), [0, 1, 0])).toBeCloseTo(70, -1)
    const front = makeNormals(image, still(image), { preset: "object", corrections: [{ frame: 0, x: 0, y: 0, width: image.width, height: image.height, facing: "front", tilt: 20 }] }).image
    expect(degreesBetween(vectorAt(front, 9, 9), [0, 0, 1])).toBeLessThan(2)
  })
})

describe("the normals file", () => {
  it("round-trips, with the convention written for whoever writes the shader", () => {
    const text = encodeNormals({ preset: "terrain", strength: 80, corrections: [{ animation: "walk", frame: 1, x: 2, y: 3, width: 4, height: 5, facing: "up-left", tilt: 30 }], frames: ["a", "b"] })
    expect(JSON.parse(text)).toMatchObject({ version: 1, convention: expect.stringContaining("green up") })
    expect(decodeNormals(text)).toEqual({ ok: true, value: { preset: "terrain", strength: 80, corrections: [{ animation: "walk", frame: 1, x: 2, y: 3, width: 4, height: 5, facing: "up-left", tilt: 30 }], frames: ["a", "b"] } })
  })

  it("says every problem at once", () => {
    const decoded = decodeNormals(JSON.stringify({ preset: "cat", strength: -1, corrections: [{ frame: 0, x: 0, y: 0, facing: "sideways" }, { frame: -1 }, { frame: 0, x: 0, y: 0, facing: "up", width: 0 }, { frame: 0, x: 0, y: 0, facing: "up", tilt: 90 }], frames: [1] }))
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    for (const part of ["preset must be", "strength is", "corrections[0].facing", "corrections[1] must be", "corrections[2].width", "corrections[3].tilt", "frames must be"]) expect(decoded.error).toContain(part)
    expect(decodeNormals("nope")).toMatchObject({ ok: false, error: expect.stringContaining("not JSON") })
  })
})

describe("what the lint says about a map", () => {
  // The same ball twice, so nothing flickers until a test makes it.
  const one = ball(8).image
  const image = picture(one.width * 2, one.height, (x, y) => {
    const i = (y * one.width + (x % one.width)) * 4
    return one.data[i + 3] === 0 ? undefined : [one.data[i]!, one.data[i + 1]!, one.data[i + 2]!]
  })
  const frames = [0, 1].map((index) => ({ animation: "spin", index, x: index * one.width, y: 0, w: one.width, h: one.height, hash: hashFrame(image, index * one.width, 0, one.width, one.height) }))
  const map = makeNormals(image, frames, { preset: "object", corrections: [] }).image
  const hashes = frames.map((frame) => frame.hash)
  const rules = (issues: ReadonlyArray<{ readonly rule: string }>) => issues.map((issue) => issue.rule)

  it("is quiet about a map that matches", () => {
    expect(normalIssues(image, map, frames, hashes)).toEqual([])
  })

  it("says when the map is another size, stale, drawn elsewhere, or not directions", () => {
    expect(rules(normalIssues(image, { width: 1, height: 1, data: new Uint8ClampedArray(4) }, frames, hashes))).toEqual(["normal-size"])
    expect(rules(normalIssues(image, map, frames, ["other", ...hashes.slice(1)]))).toEqual(["normal-stale"])
    // A map with no file beside it was painted by hand: nothing to go stale against.
    expect(normalIssues(image, map, frames, undefined)).toEqual([])
    const holed = new Uint8ClampedArray(map.data)
    const drawnAt = holed.findIndex((value, i) => i % 4 === 3 && value > 0)
    holed[drawnAt] = 0
    expect(rules(normalIssues(image, { ...map, data: holed }, frames, hashes))).toContain("normal-alpha")
    const black = new Uint8ClampedArray(map.data)
    black.set([0, 0, 0], drawnAt - 3)
    expect(rules(normalIssues(image, { ...map, data: black }, frames, hashes))).toContain("normal-invalid")
  })

  it("warns of flicker on the frame it is worst, and of a map that adds nothing", () => {
    const boiling = new Uint8ClampedArray(map.data)
    for (const frame of frames.filter((_, i) => i % 2 === 1)) {
      for (let y = 0; y < frame.h; y++) {
        for (let x = 0; x < frame.w; x++) boiling.set([230, 128, 185], ((frame.y + y) * image.width + frame.x + x) * 4)
      }
    }
    const [flicker] = normalIssues(image, { ...map, data: boiling }, frames, hashes).filter((issue) => issue.rule === "normal-flicker")
    expect(flicker).toMatchObject({ severity: "warning", message: expect.stringContaining("spin:") })
    expect(flicker!.frame).toBeDefined()
    expect(flicker!.at.length).toBeLessThanOrEqual(20)
    const flat = new Uint8ClampedArray(map.data)
    for (let i = 0; i < flat.length; i += 4) flat.set([128, 128, 255], i)
    expect(rules(normalIssues(image, { ...map, data: flat }, frames, hashes))).toContain("normal-flat")
  })
})

describe("under a light", () => {
  const { image } = ball(10)
  const map = make(image).image
  const light = (x: number, y: number, more: Partial<Light> = {}): Light => ({ x, y, height: 8, reach: 60, color: [255, 255, 255], ambient: 0.1, brightness: 1.2, steps: 0, ...more })
  const lit = (l: Light): Uint8ClampedArray => {
    const into = new Uint8ClampedArray(image.data.length)
    lightFrame(into, image.data, map.data, image.width, { x: 0, y: 0, w: image.width, h: image.height }, l)
    return into
  }
  const red = (data: Uint8ClampedArray, x: number, y: number): number => data[(y * image.width + x) * 4]!

  it("lights the side that faces it, and leaves transparent pixels alone", () => {
    const left = lit(light(-5, 11))
    const right = lit(light(27, 11))
    expect(red(left, 5, 11)).toBeGreaterThan(red(right, 5, 11))
    expect(red(right, 17, 11)).toBeGreaterThan(red(left, 17, 11))
    expect(left[3]).toBe(0)
  })

  it("comes in even steps when asked", () => {
    const smooth = new Set<number>()
    const stepped = new Set<number>()
    const a = lit(light(-5, 5))
    const b = lit(light(-5, 5, { steps: 2 }))
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] === 0) continue
      smooth.add(a[i]!)
      stepped.add(b[i]!)
    }
    expect(stepped.size).toBeLessThan(smooth.size)
  })

  it("draws a picture to judge it by: six views of a still, and rows for each animation", () => {
    const six = previewLit(image, map, still(image))
    expect(six.width).toBeGreaterThan(image.width * 3)
    const { image: sheet, frames } = walking()
    const rows = previewLit(sheet, makeNormals(sheet, frames, { preset: "character", corrections: [] }).image, frames)
    expect(rows.width).toBeGreaterThan(rows.height / 2)
  })
})

describe("reviewing with a map", () => {
  const frames: ReadonlyArray<Frame> = [{ name: "", index: 0, x: 0, y: 0, w: 4, h: 4, hash: "art" }]

  it("keeps a comment's direction, and refuses one that is not a direction", () => {
    const text = encodeReview({ assets: { "a.png": { status: "changes", note: "", comments: [{ frame: 0, x: 1, y: 2, text: "Should face up", facing: "up" }] } } })
    expect(text).toContain('"facing": "up"')
    const decoded = decodeReview(text)
    expect(decoded.ok && decoded.value.assets["a.png"]?.comments[0]?.facing).toBe("up")
    expect(decodeReview(JSON.stringify({ assets: { "a.png": { comments: [{ frame: 0, x: 0, y: 0, text: "", facing: "sideways" }] } } }))).toMatchObject({ ok: false, error: expect.stringContaining("facing must be") })
  })

  it("tells the agent what to do with a direction, and only then", () => {
    const said = (facing: "up" | undefined) => reviewSummary({ status: "changes", note: "", comments: [{ frame: 0, x: 0, y: 0, text: "t", ...(facing === undefined ? {} : { facing }) }] }, frames).next
    expect(said("up")).toContain("`corrections`")
    expect(said(undefined)).not.toContain("`corrections`")
  })

  it("keeps the map in what was approved, and says how it changed", () => {
    const approved = approvalOf(frames, "map")
    expect(approved.normal).toBe("map")
    const round = decodeReview(encodeReview({ assets: { "a.png": { status: "approved", note: "", comments: [], approved } } }))
    expect(round.ok && round.value.assets["a.png"]?.approved?.normal).toBe("map")
    expect(changedSince(approved, frames, "map")).toBeUndefined()
    expect(changedSince(approved, frames, "other")).toBe("its normal map changed")
    expect(changedSince(approved, frames)).toBe("its normal map is gone")
    expect(changedSince(approvalOf(frames), frames, "map")).toContain("has a normal map now")
    expect(changedSince(approvalOf(frames), frames)).toBeUndefined()
  })
})

describe("the command and the library", () => {
  /** A game folder with a still and a sheet, and a Pixi-format JSON for the sheet. */
  const game = (): string => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), "pixel-normals-")))
    mkdirSync(join(folder, "art"))
    writeFileSync(join(folder, "package.json"), "{}")
    writeFileSync(join(folder, "art/ball.png"), encodePng(ball(8).image))
    const { image, frames } = walking()
    writeFileSync(join(folder, "art/hero.png"), encodePng(image))
    writeFileSync(
      join(folder, "art/hero.json"),
      JSON.stringify({
        frames: Object.fromEntries(frames.map((frame) => [`walk ${frame.index}`, { frame: { x: frame.x, y: frame.y, w: frame.w, h: frame.h }, duration: 100 }])),
        animations: { walk: frames.map((frame) => `walk ${frame.index}`) },
        meta: { image: "hero.png", size: { w: image.width, h: image.height }, scale: "1" }
      })
    )
    return folder
  }
  const json = (result: { readonly stdout: string }): Record<string, unknown> => JSON.parse(result.stdout)

  it("writes a map, its file, and a picture beside a still, and reads back as clean", { timeout: 60_000 }, () => {
    const folder = game()
    const made = run(folder, "normals", "art/ball.png")
    expect(made.status).toBe(0)
    expect(json(made)).toMatchObject({ verdict: "clean", preset: "object", convention: expect.stringContaining("green up"), files: { normal: expect.stringContaining("ball.normal.png"), data: expect.stringContaining("ball.normals.json"), lit: expect.stringContaining("ball.lit.png") } })
    expect(decodePng(readFileSync(join(folder, "art/ball.normal.png"))).width).toBe(ball(8).image.width)
    expect(run(folder, "lint", "art/ball.normal.png").status).toBe(0)
  })

  it("measures a sheet by its animations, and defaults to the character preset", { timeout: 60_000 }, () => {
    const folder = game()
    const made = run(folder, "normals", "art/hero.png")
    expect(made.status).toBe(0)
    expect(json(made)).toMatchObject({ preset: "character", flicker: [{ animation: "walk" }] })
  })

  it("keeps corrections and settings when run again, and exits 3 on one that does nothing", { timeout: 90_000 }, () => {
    const folder = game()
    run(folder, "normals", "art/ball.png", "--preset", "terrain", "--strength", "150")
    const file = join(folder, "art/ball.normals.json")
    const written: { readonly corrections: ReadonlyArray<unknown> } = JSON.parse(readFileSync(file, "utf8"))
    expect(written).toMatchObject({ preset: "terrain", strength: 150 })
    writeFileSync(file, JSON.stringify({ ...written, corrections: [{ frame: 0, x: 8, y: 8, facing: "up" }] }))
    const again = run(folder, "normals", "art/ball.png")
    expect(again.status).toBe(0)
    expect(json(again)).toMatchObject({ preset: "terrain", strength: 150, issues: [], corrections: [{ facing: "up", frames: 1 }] })
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ corrections: [{ frame: 0, x: 8, y: 8, facing: "up" }] })
    writeFileSync(file, JSON.stringify({ preset: "object", corrections: [{ frame: 0, x: 0, y: 0, facing: "up" }] }))
    const nothing = run(folder, "normals", "art/ball.png")
    expect(nothing.status).toBe(3)
    expect(json(nothing)).toMatchObject({ issues: [{ rule: "normal-correction" }] })
  })

  it("will not replace a map painted by hand unless told to", { timeout: 60_000 }, () => {
    const folder = game()
    const painted = make(ball(8).image).image
    writeFileSync(join(folder, "art/ball.normal.png"), encodePng(painted))
    const refused = run(folder, "normals", "art/ball.png")
    expect(refused.status).toBe(2)
    expect(refused.stderr + refused.stdout).toContain("--force")
    expect(run(folder, "normals", "art/ball.png", "--force").status).toBe(0)
  })

  it("names the fix for what it cannot read", { timeout: 90_000 }, () => {
    const folder = game()
    const fail = (...args: Array<string>) => {
      const result = run(folder, "normals", ...args)
      return { status: result.status, said: result.stderr + result.stdout }
    }
    expect(fail("art")).toMatchObject({ status: 2, said: expect.stringContaining("is a folder") })
    expect(fail("gone.png")).toMatchObject({ status: 2, said: expect.stringContaining("cannot read") })
    writeFileSync(join(folder, "photo.jpg"), "x")
    expect(fail("photo.jpg")).toMatchObject({ status: 2, said: expect.stringContaining("pixel fix") })
    run(folder, "normals", "art/ball.png")
    expect(fail("art/ball.normal.png")).toMatchObject({ status: 2, said: expect.stringContaining("name the art") })
    // Fake pixels, each 8 real ones.
    const small = ball(8).image
    const big = picture(small.width * 8, small.height * 8, (x, y) => {
      const i = (Math.floor(y / 8) * small.width + Math.floor(x / 8)) * 4
      return small.data[i + 3] === 0 ? undefined : [small.data[i]!, small.data[i + 1]!, small.data[i + 2]!]
    })
    writeFileSync(join(folder, "big.png"), encodePng(big))
    expect(fail("big.png")).toMatchObject({ status: 3, said: expect.stringContaining("pixel fix") })
  })

  it("lints a map that has gone stale against the art, and a map with no art", { timeout: 90_000 }, () => {
    const folder = game()
    run(folder, "normals", "art/ball.png")
    expect(run(folder, "lint", "art/ball.png").status).toBe(0)
    const redrawn = ball(8).image
    redrawn.data.set([9, 200, 9], (9 * redrawn.width + 9) * 4)
    writeFileSync(join(folder, "art/ball.png"), encodePng(redrawn))
    const stale = run(folder, "lint", "art/ball.png")
    expect(stale.status).toBe(3)
    expect(json(stale)).toMatchObject({ issues: expect.arrayContaining([expect.objectContaining({ rule: "normal-stale", message: expect.stringContaining("pixel normals") })]) })
    expect(run(folder, "lint", "art/ball.normal.png").status).toBe(3)
    writeFileSync(join(folder, "lost.normal.png"), encodePng(picture(1, 1, () => [128, 128, 255])))
    const lost = run(folder, "lint", "lost.normal.png")
    expect(lost.status).toBe(2)
    expect(lost.stderr + lost.stdout).toContain("no art beside it")
  })

  it("shows a map as part of its asset, and follows it when it changes", { timeout: 60_000 }, async () => {
    const folder = game()
    run(folder, "normals", "art/ball.png")
    const assets = await findAssets([join(folder, "art")])
    expect(assets.map((asset) => asset.id.split("/").at(-1))).toEqual(["ball.png", "hero.png"])
    const ballAsset = assets[0]!
    const [ballEntry, heroEntry] = await libraryOf(assets)
    expect(ballEntry?.normal).toEqual(expect.any(String))
    expect(heroEntry?.normal).toBeUndefined()
    const map = join(folder, "art/ball.normal.png")
    const flat = picture(ball(8).image.width, ball(8).image.height, () => [128, 128, 255])
    const alpha = ball(8).image.data
    for (let i = 3; i < alpha.length; i += 4) flat.data[i] = alpha[i]!
    writeFileSync(map, encodePng(flat))
    utimesSync(map, new Date(), new Date(Date.now() + 5000))
    const got = await readAsset(ballAsset)
    expect(got.ok && got.normal?.hash).not.toBe(ballEntry?.normal)
    expect(got.ok && got.lint.ok && got.lint.issues.map((issue) => issue.rule)).toContain("normal-flat")
  })

  it("serves the map beside the picture, and says when there is none", { timeout: 60_000 }, async () => {
    const folder = game()
    run(folder, "normals", "art/ball.png")
    const handler = api([join(folder, "art")])
    const server = createServer((request, response) => void handler(request, response))
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
    const { port } = server.address() as AddressInfo
    try {
      const assets = await findAssets([join(folder, "art")])
      const ask = (id: string) => fetch(`http://127.0.0.1:${port}/normal?id=${encodeURIComponent(id)}`)
      const found = await ask(assets[0]!.id)
      expect(found.status).toBe(200)
      expect(found.headers.get("content-type")).toBe("image/png")
      expect(decodePng(new Uint8Array(await found.arrayBuffer())).width).toBe(ball(8).image.width)
      expect((await ask(assets[1]!.id)).status).toBe(404)
      const detail: unknown = await (await fetch(`http://127.0.0.1:${port}/asset?id=${encodeURIComponent(assets[0]!.id)}`)).json()
      expect(detail).toMatchObject({ normal: expect.stringContaining("ball.normal.png"), normalData: expect.stringContaining("ball.normals.json") })
    } finally {
      server.close()
    }
    expect(existsSync(join(folder, "art/ball.normals.json"))).toBe(true)
  })
})
