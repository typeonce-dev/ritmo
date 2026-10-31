import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { encodePng } from "@typeonce/ritmo-tools/pixel/cli/png.ts"
import type { RgbaImage } from "@typeonce/ritmo-tools/pixel/core/grid.ts"
import { readingOrder, type FrameBox } from "@typeonce/ritmo-tools/pixel/core/sheet.ts"
import { runClip, type Clip } from "@typeonce/ritmo-tools/rig/core/clip.ts"
import { artOf } from "@typeonce/ritmo-tools/rig/core/export.ts"
import { cutParts, decodeParts } from "@typeonce/ritmo-tools/rig/core/parts.ts"
import { boundsOf } from "@typeonce/ritmo-tools/rig/core/pose.ts"
import { renderArt } from "@typeonce/ritmo-tools/rig/core/raster.ts"
import { decodeRig, imageFiles, type Rig } from "@typeonce/ritmo-tools/rig/core/rig.ts"

const cli = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))
const run = (...args: Array<string>) => spawnSync(process.execPath, [cli, "rig", ...args], { encoding: "utf8" })

/** A picture filled with one color. */
const canvas = (width: number, height: number, rgba: readonly [number, number, number, number]): RgbaImage => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4)
  return { width, height, data }
}

/** A capsule from a to b, radius r, drawn anti-aliased (4 × 4 samples a pixel) over what is there. */
const capsule = (image: RgbaImage, a: readonly [number, number], b: readonly [number, number], r: number, rgb: readonly [number, number, number]): void => {
  const [ax, ay] = a
  const [bx, by] = b
  for (let y = Math.floor(Math.min(ay, by) - r - 1); y <= Math.ceil(Math.max(ay, by) + r + 1); y++)
    for (let x = Math.floor(Math.min(ax, bx) - r - 1); x <= Math.ceil(Math.max(ax, bx) + r + 1); x++) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue
      let inside = 0
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4
          const py = y + (sy + 0.5) / 4
          const ex = bx - ax
          const ey = by - ay
          const t = ex === 0 && ey === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey)))
          if (Math.hypot(px - (ax + ex * t), py - (ay + ey * t)) <= r) inside++
        }
      if (inside === 0) continue
      const k = inside / 16
      const i = (y * image.width + x) * 4
      for (let c = 0; c < 3; c++) image.data[i + c] = Math.round(image.data[i + c]! * (1 - k) + rgb[c]! * k)
      image.data[i + 3] = 255
    }
}

const SKIN = [241, 192, 154] as const
const TUNIC = [63, 127, 184] as const
const BOOT = [110, 75, 58] as const

/**
 * A side-view character's parts drawn apart, as an image generator lays a
 * parts sheet out: the torso in the middle, the head above it, the arms
 * out to each side, the legs below, every limb with its joint end toward
 * the torso. Each part's box is known.
 */
const humanoidSheet = () => {
  const sheet = canvas(440, 460, [232, 228, 216, 255])
  const parts: Array<{ readonly name: string; readonly a: readonly [number, number]; readonly b: readonly [number, number]; readonly r: number; readonly rgb: readonly [number, number, number] }> = [
    { name: "torso", a: [220, 150], b: [220, 230], r: 24, rgb: TUNIC },
    { name: "head", a: [220, 70], b: [220, 92], r: 18, rgb: SKIN },
    { name: "upperArmNear", a: [262, 160], b: [312, 160], r: 9, rgb: TUNIC },
    { name: "forearmNear", a: [336, 160], b: [380, 160], r: 8, rgb: SKIN },
    { name: "handNear", a: [404, 158], b: [410, 162], r: 8, rgb: SKIN },
    { name: "upperArmFar", a: [178, 160], b: [128, 160], r: 9, rgb: TUNIC },
    { name: "forearmFar", a: [104, 160], b: [60, 160], r: 8, rgb: SKIN },
    { name: "handFar", a: [36, 158], b: [30, 162], r: 8, rgb: SKIN },
    { name: "thighNear", a: [245, 272], b: [245, 322], r: 11, rgb: TUNIC },
    { name: "shinNear", a: [245, 348], b: [245, 395], r: 9, rgb: BOOT },
    { name: "footNear", a: [236, 428], b: [272, 428], r: 6, rgb: BOOT },
    { name: "thighFar", a: [195, 272], b: [195, 322], r: 11, rgb: TUNIC },
    { name: "shinFar", a: [195, 348], b: [195, 395], r: 9, rgb: BOOT },
    { name: "footFar", a: [204, 428], b: [168, 428], r: 6, rgb: BOOT }
  ]
  for (const part of parts) capsule(sheet, part.a, part.b, part.r, part.rgb)
  const boxes = parts.map((part): FrameBox & { name: string } => {
    const x = Math.floor(Math.min(part.a[0], part.b[0]) - part.r)
    const y = Math.floor(Math.min(part.a[1], part.b[1]) - part.r)
    return { name: part.name, x, y, width: Math.ceil(Math.max(part.a[0], part.b[0]) + part.r) - x, height: Math.ceil(Math.max(part.a[1], part.b[1]) + part.r) - y }
  })
  // The names in the pixel fixer's reading order of the known boxes.
  const order = readingOrder(boxes).map((box) => (box as FrameBox & { name: string }).name)
  return { sheet, parts, boxes, order }
}

describe("image parts", () => {
  /** A 20 × 6 bar, red, its last two columns blue, on a bone pointing forward from (0, 10). */
  const bar = (() => {
    const image = canvas(20, 6, [228, 59, 68, 255])
    for (let y = 0; y < 6; y++) for (const x of [18, 19]) image.data.set([0, 99, 219, 255], (y * 20 + x) * 4)
    return image
  })()
  const module = (part: Record<string, unknown> = {}) => ({
    default: { size: [64, 64], anchor: [32, 40], bones: { root: { y: 10, length: 20 } }, parts: { bar: { bone: "root", z: 0, shape: { kind: "image", file: "bar.png", pivot: [0, 3] }, ...part } } }
  })
  const decoded = decodeRig(module(), new Map([["bar.png", bar]]))
  if (!decoded.ok) throw new Error(decoded.error)
  const rig: Rig = decoded.value
  const aimed = (angle: number): Clip => ({
    label: "",
    frames: 1,
    fps: 12,
    loop: false,
    stance: undefined,
    params: {},
    travel: 0,
    phases: [],
    contacts: {},
    trail: undefined,
    sockets: {},
    hit: undefined,
    pose: () => ({ aim: { root: angle } })
  })
  const pixel = (image: RgbaImage, x: number, y: number) => Array.from(image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4))

  it("list the pictures a rig module names, and name one that does not read", () => {
    expect(imageFiles(module())).toEqual(["bar.png"])
    const missing = decodeRig(module())
    expect(missing.ok === false && missing.error).toContain("parts.bar.shape.file: cannot read bar.png")
    const wrong = decodeRig(module({ shape: { kind: "image", file: "bar.png" } }), new Map([["bar.png", bar]]))
    expect(wrong.ok === false && wrong.error).toContain("pivot must be [x, y]")
  })

  it("turn with their bone, their pivot on its point, bounds and pixels where the angle puts them", () => {
    const frame = (angle: number) => runClip(rig, aimed(angle)).frames[0]!
    const box = (angle: number) => {
      const b = boundsOf(frame(angle).drawn[0]!.geom)
      return [b.minX, b.minY, b.maxX, b.maxY].map((v) => Math.round(v * 1000) / 1000 + 0)
    }
    // Forward: from the pivot at the bone's start (0, 10) out to x 20, 3 each side.
    expect(box(0)).toEqual([0, 7, 20, 13])
    // Up: the bar stands on the pivot.
    expect(box(90)).toEqual([-3, 10, 3, 30])
    expect(box(180)).toEqual([-20, 7, 0, 13])
    // The pictures (the anchor is the frame's pixel (32, 40), y down): red along the bar, blue at its far end.
    const forward = renderArt(rig, frame(0), 1)
    // Blue where the bar's end is (its last pixel blends with what is past it).
    const blue = (rgba: Array<number>) => rgba[2]! > 180 && rgba[0]! < 40 && rgba[3]! > 200
    expect(pixel(forward, 32 + 10, 40 - 10)).toEqual([228, 59, 68, 255])
    expect(blue(pixel(forward, 32 + 19, 40 - 10))).toBe(true)
    expect(pixel(forward, 32 + 25, 40 - 10)[3]).toBe(0)
    const up = renderArt(rig, frame(90), 1)
    expect(pixel(up, 32, 40 - 20)[0]).toBeGreaterThan(200)
    expect(blue(pixel(up, 32, 40 - 29))).toBe(true)
    const back = renderArt(rig, frame(180), 1)
    expect(blue(pixel(back, 32 - 20, 40 - 10))).toBe(true)
    expect(pixel(back, 32 - 10, 40 - 10)[0]).toBeGreaterThan(200)
    // Turned between pixels, its edges are anti-aliased.
    const slanted = renderArt(rig, frame(30), 1)
    const alphas = new Set<number>()
    for (let i = 3; i < slanted.data.length; i += 4) alphas.add(slanted.data[i]!)
    expect([...alphas].some((a) => a > 0 && a < 255)).toBe(true)
  })

  it("draw through the part's tint, and hide and swap with props and slots as shapes do", () => {
    const tinted = decodeRig(module({ tint: "#808080" }), new Map([["bar.png", bar]]))
    if (!tinted.ok) throw new Error(tinted.error)
    const image = renderArt(tinted.value, runClip(tinted.value, aimed(0)).frames[0]!, 1)
    expect(pixel(image, 32 + 10, 40 - 10)).toEqual([114, 30, 34, 255])
    const withProp = decodeRig({ default: { ...module().default, props: { stick: ["bar"] } } }, new Map([["bar.png", bar]]))
    if (!withProp.ok) throw new Error(withProp.error)
    const hidden = runClip(withProp.value, { ...aimed(0), pose: () => ({ props: { stick: null } }) })
    expect(hidden.frames[0]!.drawn).toEqual([])
  })

  it("draw the same bytes from the same pose", () => {
    const once = artOf(rig, runClip(rig, aimed(37)), 2)
    const again = artOf(rig, runClip(rig, aimed(37)), 2)
    expect(encodePng(once[0]!)).toEqual(encodePng(again[0]!))
  })
})

describe("cutting a parts sheet", () => {
  it("cut each part in reading order, named, with the box it came from and a pivot at its joint end", () => {
    const { sheet, boxes, order } = humanoidSheet()
    const cut = cutParts(sheet, order)
    expect(cut.warnings).toEqual([])
    expect(cut.parts.map((part) => part.name)).toEqual(order)
    for (const part of cut.parts) {
      const known = boxes.find((box) => box.name === part.name)!
      // The anti-aliased edge may be a pixel short of the drawn radius.
      for (const key of ["x", "y", "width", "height"] as const) expect(Math.abs(part.box[key] - known[key])).toBeLessThanOrEqual(2)
      // One pixel of margin around the drawn pixels, which keep their soft edge.
      expect([part.image.width, part.image.height]).toEqual([part.box.width + 2, part.box.height + 2])
    }
    const pivot = (name: string) => {
      const part = cut.parts.find((p) => p.name === name)!
      return [part.pivot[0] + Math.max(0, part.box.x - 1), part.pivot[1] + Math.max(0, part.box.y - 1)]
    }
    const near = (got: Array<number>, want: readonly [number, number]) => expect(Math.hypot(got[0]! - want[0], got[1]! - want[1])).toBeLessThan(4)
    // Limbs pivot on the end toward the torso, half their width in: the centres of the shoulder, the elbow, the hip, the knee.
    near(pivot("upperArmNear"), [262, 160])
    near(pivot("forearmNear"), [336, 160])
    near(pivot("upperArmFar"), [178, 160])
    near(pivot("thighNear"), [245, 272])
    near(pivot("shinFar"), [195, 348])
    // The torso holds the sheet's centre of mass: it pivots on its lower end, the hips.
    near(pivot("torso"), [220, 230])
    // The head pivots on its lower end, a quarter of its length in: the neck.
    near(pivot("head"), [220, 95.5])
    // The long axis runs from the pivot's end to the far end.
    const arm = cut.parts.find((p) => p.name === "upperArmNear")!
    expect(arm.axis.to[0]).toBeGreaterThan(arm.axis.from[0])
    expect(arm.axis.length).toBeGreaterThan(60)
    expect(arm.axis.width).toBeGreaterThan(15)
  })

  it("leave out boxes that look like labels or specks, saying so, and name the rest part-<n>", () => {
    const { sheet } = humanoidSheet()
    // A word under the sheet's corner: five glyphs a pixel apart, short and wide; and a speck.
    for (let g = 0; g < 5; g++) for (let y = 440; y < 446; y++) for (let x = 10 + g * 8; x < 17 + g * 8; x++) sheet.data.set([20, 20, 20, 255], (y * sheet.width + x) * 4)
    for (let y = 20; y < 22; y++) for (let x = 400; x < 402; x++) sheet.data.set([20, 20, 20, 255], (y * sheet.width + x) * 4)
    const cut = cutParts(sheet, ["torso"])
    expect(cut.parts).toHaveLength(14)
    expect(cut.parts.slice(1).every((part, i) => part.name === `part-${i + 2}`)).toBe(true)
    expect(cut.warnings.join("\n")).toContain("looks like a label")
    expect(cut.warnings.join("\n")).toContain("is tiny")
    expect(cut.warnings.join("\n")).toContain("1 names for 14 parts")
  })
})

describe("from a parts sheet to a rig", () => {
  it("cuts the sheet, scaffolds a humanoid that checks clean apart from its accepted defaults, bakes the same bytes twice, and compares drafts", () => {
    const folder = mkdtempSync(join(tmpdir(), "rig-parts-"))
    const { sheet, order } = humanoidSheet()
    writeFileSync(join(folder, "hero-parts.png"), encodePng(sheet))
    const cut = run("parts", join(folder, "hero-parts.png"), "--names", order.join(","))
    expect(cut.status).toBe(0)
    const report = JSON.parse(cut.stdout) as { parts: Array<{ name: string; size: [number, number]; pivot: [number, number] }>; warnings: Array<string> }
    expect(report.parts.map((part) => part.name)).toEqual(order)
    expect(report.warnings).toEqual([])
    expect(readdirSync(join(folder, "parts")).sort()).toEqual([...order.map((name) => `${name}.png`), "parts.json"].sort())
    const listing = decodeParts(readFileSync(join(folder, "parts", "parts.json"), "utf8"))
    expect(listing.ok && listing.value.parts.map((part) => part.name)).toEqual(order)
    expect(run("parts", join(folder, "hero-parts.png"), "--names", "head,not a name").status).toBe(2)

    const bank = join(folder, "hero.rig.json")
    const init = run("init", bank, "--from", join(folder, "parts", "parts.json"))
    expect(init.status).toBe(0)
    expect(JSON.parse(init.stdout)).toMatchObject({ rig: join(folder, "rig", "character.mjs"), parts: order })
    expect(readFileSync(join(folder, "rig", "character.mjs"), "utf8")).toContain('"file": "../parts/torso.png"')
    const checked = run("check", bank)
    expect(checked.status).toBe(0)
    const verdict = JSON.parse(checked.stdout) as { verdict: string; drafts: Array<{ issues: Array<{ code: string }>; accepted?: Array<{ code: string }> }> }
    expect(verdict.drafts[0]!.issues).toEqual([])
    expect(verdict.verdict).toBe("clean")

    expect(run("bake", bank, "-o", join(folder, "one")).status).toBe(0)
    expect(run("bake", bank, "-o", join(folder, "two")).status).toBe(0)
    for (const file of ["idle.png", "idle.gif", "idle.json", "hero.rig.clips.json"]) expect(readFileSync(join(folder, "one", file))).toEqual(readFileSync(join(folder, "two", file)))

    // A missing part gets a plain shape, so the rig still bakes.
    const fewer = decodeParts(readFileSync(join(folder, "parts", "parts.json"), "utf8"))
    if (!fewer.ok) throw new Error(fewer.error)
    writeFileSync(join(folder, "parts", "fewer.json"), JSON.stringify({ ...fewer.value, parts: fewer.value.parts.filter((part) => part.name !== "handFar") }))
    const partial = run("init", join(folder, "partial.rig.json"), "--from", join(folder, "parts", "fewer.json"), "--force")
    expect(JSON.parse(partial.stdout)).toMatchObject({ fallbacks: ["handFar"] })
    expect(run("bake", join(folder, "partial.rig.json"), "-o", join(folder, "partial")).status).toBe(0)

    // Two drafts of one clip, side by side.
    writeFileSync(bank, JSON.stringify({ version: 1, rig: "rig/character.mjs", clips: { idle: { drafts: { a: { file: "rig/idle.a.mjs" }, b: { file: "rig/idle.a.mjs", tune: { breath: 0 } } } } } }))
    const compared = run("look", bank, "idle", "--compare", "--columns", "4", "-o", join(folder, "look"))
    expect(compared.status).toBe(0)
    expect(JSON.parse(compared.stdout)).toMatchObject({ rows: ["a", "b"], files: [join(folder, "look", "idle.compare.png")] })
    expect(existsSync(join(folder, "look", "idle.compare.png"))).toBe(true)
  }, 120_000)
})
