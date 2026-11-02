import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { specks, framesOfArt } from "@typeonce/ritmo-tools/pixel/core/craft.ts"
import { TRANSPARENT, type PixelArt } from "@typeonce/ritmo-tools/pixel/core/fix.ts"
import { acceptIssues, craftIssues, lintArt, motionIssues } from "@typeonce/ritmo-tools/pixel/core/lint.ts"
import { lookPicture } from "@typeonce/ritmo-tools/pixel/core/look.ts"
import { reportOfSpritesheet } from "@typeonce/ritmo-tools/pixel/core/report.ts"
import { atlasOf, clipsOfSpritesheet, spritesheetJson, type AtlasClip } from "@typeonce/ritmo-tools/pixel/core/spritesheet.ts"

const palette = [
  { r: 20, g: 20, b: 30 },
  { r: 240, g: 200, b: 80 },
  { r: 200, g: 60, b: 40 }
]

/** Pixel art from rows: "." is transparent, "K" the dark color, "Y" yellow, "R" red. */
const art = (rows: ReadonlyArray<string>): PixelArt => {
  const width = rows[0]!.length
  const keys = "KYR"
  return { width, height: rows.length, palette, indices: Int32Array.from(rows.join(""), (c) => (c === "." ? TRANSPARENT : keys.indexOf(c))) }
}

const rules = (issues: ReadonlyArray<{ readonly rule: string }>): Array<string> => issues.map((issue) => issue.rule)

describe("the craft on sprites", () => {
  it("finds jaggies along a sprite's outline", () => {
    const jagged = art([
      "..............",
      "...........KKK",
      "........KKKYYY",
      ".......KYYYYYY",
      "....KKKYYYYYYY",
      "...KYYYYYYYYYY",
      "KKKYYYYYYYYYYY",
      "KYYYYYYYYYYYYY"
    ])
    expect(rules(lintArt(jagged))).toContain("jaggies")
  })

  it("finds the corner pixels that thicken an outline, and leaves a box's corners alone", () => {
    const thick = art([
      "KK.......",
      ".K.......",
      "..KK.....",
      "...K.....",
      "....KK...",
      ".....K...",
      "......K.."
    ])
    expect(rules(lintArt(thick))).toContain("doubles")
    const box = art(["KKKKKK", "KYYYYK", "KYYYYK", "KYYYYK", "KKKKKK"])
    expect(rules(lintArt(box))).not.toContain("doubles")
  })

  it("finds pinholes inside the shape", () => {
    const holed = art(["KKKKKKK", "KY.Y.YK", "KYYYYYK", "KY.YYYK", "KKKKKKK"])
    const issue = lintArt(holed).find((entry) => entry.rule === "holes")
    expect(issue?.at).toEqual([[2, 1], [4, 1], [2, 3]])
  })

  it("gives each spot its frame in an animation", () => {
    const frame = art(["KKKKKKK", "KY.Y.YK", "KYYYYYK", "KY.YYYK", "KKKKKKK"])
    const issue = craftIssues([frame, frame], undefined, "idle").find((entry) => entry.rule === "holes")
    expect(issue).toMatchObject({ animation: "idle" })
    expect(issue?.at[0]).toEqual([2, 1, 1])
  })

  it("tells a lone pixel that blinks from a limb that moves", () => {
    const still = Uint8Array.from({ length: 25 }, () => 1)
    const blink = still.slice()
    blink[12] = 2
    expect(specks({ width: 5, height: 5, loop: true, frames: [still, blink, still] }).spots).toEqual([{ frame: 1, x: 2, y: 2 }])
    const limb = still.slice()
    limb.fill(2, 10, 15)
    expect(specks({ width: 5, height: 5, loop: true, frames: [still, limb, still] }).spots).toEqual([])
  })

  it("passes art drawn with care", () => {
    const clean = art(["..KKKK..", ".KYYYYK.", "KYYYYYYK", "KYYRRYYK", "KYYYYYYK", ".KYYYYK.", "..KKKK.."])
    expect(lintArt(clean)).toEqual([])
    expect(framesOfArt([clean], false).frames[0]![0]).toBe(0)
  })
})

describe("an animation's motion", () => {
  /** A 2-pixel foot at `foot` under a body across the top of a 13×5 canvas. */
  const step = (foot: number): PixelArt => {
    const rows = Array.from({ length: 5 }, (_, y) => [...(y < 3 ? ".YYYYYYYYYYYY" : ".............")])
    for (const y of [3, 4]) {
      rows[y]![foot] = "K"
      rows[y]![foot + 1] = "K"
    }
    return art(rows.map((row) => row.join("")))
  }

  it("reads how far the planted foot moves, and the speed that keeps it planted", () => {
    // The foot comes down at 10 and is carried back a pixel a frame; at the loop the other foot lands.
    const frames = [step(10), step(9), step(8), step(7), step(6)]
    const { motion, issues } = motionIssues(frames, "forward", 10, "walk")
    expect(motion.ground).toEqual({ pixelsPerFrame: -1, pixelsPerSecond: 10 })
    expect(rules(issues)).not.toContain("skate")
  })

  it("warns when the foot on the ground slides unevenly", () => {
    const frames = [step(10), step(9), step(6), step(5)]
    expect(rules(motionIssues(frames, "forward", 8, "walk").issues)).toContain("skate")
  })

  it("warns when the body changes size, and when a loop jumps back to its start", () => {
    const small = art(["....", ".YY.", ".YY.", "...."])
    const big = art(["YYYY", "YYYY", "YYYY", "YYYY"])
    expect(rules(motionIssues([small, small, big, small], "forward", 8, "pulse").issues)).toContain("area")
    const a = art(["YY..", "YY..", "....", "...."])
    const c = art(["....", "....", "..YY", "..YY"])
    expect(rules(motionIssues([a, a, a, a, c], "forward", 8, "slide").issues)).toContain("seam")
  })
})

describe("accepted warnings", () => {
  it("sets apart warnings with a reason, never errors", () => {
    const issues = lintArt(art(["KKKKKKK", "KY.Y.YK", "KYYYYYK", "KY.YYYK", "KKKKKKK"]), { maxColors: 1 })
    const split = acceptIssues(issues, { holes: "the shield's rivets", "too-many-colors": "no" })
    expect(rules(split.accepted)).toEqual(["holes"])
    expect(split.accepted[0]!.why).toBe("the shield's rivets")
    expect(rules(split.issues)).toEqual(["too-many-colors"])
  })
})

describe("a sprite sheet written, read back", () => {
  it("cuts its animations from the JSON and judges them", () => {
    const frame = art(["..KK..", ".KYYK.", ".KYYK.", "..KK.."])
    const clips: Array<AtlasClip> = [{ name: "idle", frames: [frame, frame], anchor: { x: 3, y: 3 }, fps: 6, loop: "pingpong" }]
    const atlas = atlasOf(clips, { columns: 8, spacing: 1 })
    const raw: unknown = JSON.parse(spritesheetJson({ image: "idle.png", clips, atlas, scale: 1 }))
    const cut = (rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number }): PixelArt => {
      const indices = new Int32Array(rect.w * rect.h)
      for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) indices[y * rect.w + x] = atlas.art.indices[(rect.y + y) * atlas.art.width + rect.x + x]!
      return { width: rect.w, height: rect.h, palette: atlas.art.palette, indices }
    }
    const read = clipsOfSpritesheet(raw, cut)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.clips.map((clip) => [clip.name, clip.frames.length, clip.fps, clip.loop, clip.anchor])).toEqual([["idle", 2, 6, "pingpong", { x: 3, y: 3 }]])
    const report = reportOfSpritesheet(read.clips, {}, atlas.art)
    expect(report.verdict).toBe("clean")
    expect(report.animation?.animations[0]?.motion?.area).toEqual([12, 12])
  })
})

describe("the look picture", () => {
  it("draws the pieces at display size and up close, with the marks in magenta", () => {
    const sprite = art(["KK", "KK"])
    const picture = lookPicture([{ frames: [sprite], marks: [[0, 0]] }], { scale: 2, backdrop: { kind: "color", rgb: 0x336633 } })
    expect(picture.width).toBeGreaterThan(0)
    const has = (rgb: number): boolean => {
      for (let i = 0; i < picture.data.length; i += 4) if (((picture.data[i]! << 16) | (picture.data[i + 1]! << 8) | picture.data[i + 2]!) === rgb) return true
      return false
    }
    expect(has(0xff2bd6)).toBe(true)
    expect(has(0x336633)).toBe(true)
    expect(has(0x14141e)).toBe(true)
  })
})

describe("pixel look and lint from the command line", () => {
  const bin = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))

  it("writes the look picture and reads the config's scale, backdrops, stand-in, and accepted warnings", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "pixel-look-"))
    writeFileSync(join(dir, "hero.txt"), "palette\n. transparent\nK #14141e\nY #f0c850\n\npixels\n.KK.\nKYYK\nKYYK\n.KK.\n")
    writeFileSync(join(dir, "shield.txt"), "palette\n. transparent\nK #14141e\nY #f0c850\n\npixels\nKKKKKKK\nKY.Y.YK\nKYYYYYK\nKY.YYYK\nKKKKKKK\n")
    writeFileSync(
      join(dir, "pixel.config.json"),
      JSON.stringify({ scale: 2, backdrops: { grass: "#336633" }, standIn: "hero.txt", accept: { "shield.txt": { holes: "the rivets" } } })
    )
    const look = spawnSync(process.execPath, [bin, "pixel", "look", "shield.txt"], { cwd: dir, encoding: "utf8" })
    expect(look.status).toBe(0)
    const out: unknown = JSON.parse(look.stdout)
    expect(out).toMatchObject({ scale: 2, backdrop: "grass", judged: [{ file: "shield.txt", accepted: ["holes: the rivets"] }] })
    expect(existsSync(join(dir, "shield.look.png"))).toBe(true)
    const lint = spawnSync(process.execPath, [bin, "pixel", "lint", "shield.txt"], { cwd: dir, encoding: "utf8" })
    expect(JSON.parse(lint.stdout)).toMatchObject({ verdict: "clean", issues: [], accepted: [{ rule: "holes", why: "the rivets" }] })
  })
})
