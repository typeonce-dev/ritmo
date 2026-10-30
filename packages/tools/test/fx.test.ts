import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { decodeBank, decodeReview, encodeBank, encodeReview, resolveComments, reviewPath, reviewSummary, usedDraft, type Bank } from "@typeonce/ritmo-tools/fx/core/bank.ts"
import { checkEffect, paletteIssues } from "@typeonce/ritmo-tools/fx/core/check.ts"
import { doubles, faintOn, flicker, holes, jaggies } from "@typeonce/ritmo-tools/fx/core/craft.ts"
import { decodeEffect, runEffect, tuned, type Effect, type Fx } from "@typeonce/ritmo-tools/fx/core/effect.ts"
import { contactSheet } from "@typeonce/ritmo-tools/fx/core/export.ts"

const palette = { white: "#ffffff", red: "#e43b44" }

const effect = (draw: (fx: Fx) => void, overrides: Partial<Effect> = {}): Effect => ({
  label: "",
  width: 8,
  height: 8,
  frames: 4,
  fps: 12,
  loop: false,
  anchor: { x: 4, y: 4 },
  params: {},
  draw,
  ...overrides
})

/** A one-shot that shows on frame 0 and is gone on its last frame. */
const shrinking = effect((fx) => fx.disc(fx.cx, fx.cy, 3 * (1 - fx.t), "white"))

const example = fileURLToPath(new URL("../examples/fx/effects.fx.json", import.meta.url))
const cli = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))

describe("drafts", () => {
  it("name every field that is wrong", () => {
    const decoded = decodeEffect({ default: { size: [0, 8], frames: 2.5, fps: 90, params: { speed: { min: 3, max: 1, value: 2 } } } })
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    for (const field of ["size", "frames", "fps", "draw", "params.speed"]) expect(decoded.error).toContain(field)
  })

  it("take an anchor inside the canvas, the middle by default", () => {
    const base = { size: [24, 16], frames: 2, fps: 12, draw: () => {} }
    expect(decodeEffect({ default: base })).toMatchObject({ ok: true, value: { anchor: { x: 12, y: 8 } } })
    expect(decodeEffect({ default: { ...base, anchor: [3, 15] } })).toMatchObject({ ok: true, value: { anchor: { x: 3, y: 15 } } })
    const outside = decodeEffect({ default: { ...base, anchor: [24, 0] } })
    expect(outside.ok === false && outside.error).toContain("anchor")
  })

  it("lay a tune over the params, kept in range", () => {
    const withParams = effect(() => {}, { params: { reach: { min: 2, max: 10, value: 5 }, rays: { min: 1, max: 8, value: 4 } } })
    expect(tuned(withParams, { reach: 40, ghost: 1 })).toEqual({ reach: 10, rays: 4 })
  })
})

describe("the runner", () => {
  it("repeats fx.random() in every frame, and changes it with the seed", () => {
    const seen: Array<Array<number>> = []
    const draws = effect((fx) => {
      seen[fx.frame] = [fx.random(), fx.random(), fx.random()]
    })
    runEffect(draws, palette, { seed: 1 })
    expect(seen[3]).toEqual(seen[0])
    const first = seen[0]
    runEffect(draws, palette, { seed: 2 })
    expect(seen[0]).not.toEqual(first)
  })

  it("does not cluster draws taken a few apart", () => {
    // Particles draw several numbers each: the first of each must spread like any other.
    const values: Array<number> = []
    runEffect(effect((fx) => { for (let i = 0; i < 4000; i++) values.push(fx.random()) }, { frames: 1 }), palette)
    const firsts = values.filter((_, i) => i % 2 === 0)
    const below = firsts.filter((v) => v < 0.5).length / firsts.length
    expect(below).toBeGreaterThan(0.45)
    expect(below).toBeLessThan(0.55)
  })

  it("reports colors the palette does not have, and draws that throw, without throwing", () => {
    const run = runEffect(effect((fx) => {
      fx.px(1, 1, "blue")
      if (fx.frame === 2) throw new Error("boom")
    }), palette)
    expect(run.errors.join("\n")).toContain('no color named "blue"')
    expect(run.errors.join("\n")).toContain("draw threw on frame 2: boom")
  })

  it("counts pixels drawn past the edge", () => {
    const run = runEffect(effect((fx) => fx.px(-1, 0, "white")), palette)
    expect(run.clipped).toEqual([1, 1, 1, 1])
  })
})

describe("the checks", () => {
  const codes = (target: Effect): Array<string> => checkEffect(target, palette).issues.map((issue) => issue.code)

  it("pass a one-shot that shows at once and ends empty", () => {
    expect(codes(shrinking)).toEqual([])
  })

  it("catch randomness that is not the seed's", () => {
    expect(codes(effect((fx) => fx.px(Math.random() * 8, 0, "white")))).toContain("random")
  })

  it("catch a blank effect", () => {
    expect(codes(effect(() => {}))).toEqual(["blank"])
  })

  it("catch a one-shot that starts late, does not end, or ends on several empty frames", () => {
    expect(codes(effect((fx) => fx.frame > 0 && fx.px(1, 1, "white")))).toEqual(expect.arrayContaining(["late", "no-end"]))
    expect(codes(effect((fx) => fx.frame === 0 && fx.px(1, 1, "white"), { frames: 6 }))).toContain("tail")
  })

  it("catch a loop that jumps back to its start", () => {
    // A bar that grows a column a frame, then is one column again.
    const growing = effect((fx) => fx.rect(0, 0, fx.frame + 1, 8, "white"), { loop: true, frames: 8 })
    expect(codes(growing)).toContain("seam")
    const wrapping = effect((fx) => fx.rect((fx.t * 8) % 8, 0, 2, 8, "white"), { loop: true, frames: 8 })
    expect(codes(wrapping)).not.toContain("seam")
  })

  it("catch lone-pixel noise", () => {
    const dots = effect((fx) => { for (let y = 0; y < 8; y += 3) for (let x = 0; x < 8; x += 3) fx.px(x, y, "white") }, { frames: 1 })
    expect(codes(dots)).toContain("noise")
  })

  it("measure the box and colors drawn", () => {
    const { measures } = checkEffect(effect((fx) => fx.rect(2, 3, 3, 2, fx.frame === 0 ? "white" : "red")), palette)
    expect(measures.bounds).toEqual({ x: 2, y: 3, w: 3, h: 2 })
    expect(measures.colors).toEqual(["white", "red"])
    expect(measures.duration).toBe(333)
  })
})

describe("shapes", () => {
  const one = (draw: (fx: Fx) => void) => runEffect(effect(draw, { width: 70, height: 70, frames: 1 }), palette)

  it("draw circles with even steps and no doubles at every radius", () => {
    for (let r = 1; r <= 30; r++) {
      const ring = one((fx) => fx.ring(35, 35, r, "white"))
      const disc = one((fx) => fx.disc(35, 35, r, "white"))
      expect([r, jaggies(ring).length, doubles(ring).length, jaggies(disc).length]).toEqual([r, 0, 0, 0])
    }
  })

  it("draw thick rings with no pinholes", () => {
    for (let r = 3; r <= 30; r++) for (const width of [2, 3]) expect([r, width, holes(one((fx) => fx.ring(35, 35, r, "white", width))).length]).toEqual([r, width, 0])
  })

  it("draw nothing at a radius of 0", () => {
    expect(one((fx) => fx.disc(5, 5, 0, "white")).frames[0]!.every((v) => v === 0)).toBe(true)
  })
})

describe("the craft rules", () => {
  const frame = (rows: ReadonlyArray<string>) => {
    const width = rows[0]!.length
    return { width, height: rows.length, frames: [Uint8Array.from(rows.join(""), (c) => (c === "#" ? 1 : 0))], fps: 12, loop: false, anchor: { x: 0, y: 0 }, clipped: [0], errors: [] }
  }

  it("find a jaggy (a short run between long ones) and pass a steady line", () => {
    const jagged = frame(["...........", "........###", ".....###...", "....#......", ".###.......", "#.........."])
    expect(jaggies(jagged).length).toBeGreaterThan(0)
    const steady = frame(["........##", "......##..", "....##....", "..##......", "##........"])
    expect(jaggies(steady)).toEqual([])
  })

  it("find the corner of an L in a line, not in a 3-pixel speck", () => {
    expect(doubles(frame(["##...", ".#...", "..#..", "...#."]))).toEqual([{ frame: 0, x: 1, y: 0 }])
    expect(doubles(frame(["##.", ".#.", "..."]))).toEqual([])
  })

  it("find pinholes", () => {
    expect(holes(frame(["###", "#.#", "###"]))).toEqual([{ frame: 0, x: 1, y: 1 }])
  })

  it("find a pixel that changes for one frame and back", () => {
    const blink = { ...frame(["#"]), frames: [Uint8Array.of(1), Uint8Array.of(0), Uint8Array.of(1)], clipped: [0, 0, 0] }
    expect(flicker(blink).spots).toEqual([{ frame: 1, x: 0, y: 0 }])
  })

  it("find colors that barely show on a background", () => {
    const pale = runEffect(effect((fx) => fx.rect(0, 0, 4, 4, "white")), palette)
    expect(faintOn(pale, palette, { snow: "#f4f4f4", cave: "#101018" }).map((entry) => entry.share)).toEqual([1, 0])
  })
})

describe("the project's rules and accepted warnings", () => {
  it("find bank colors outside the project palette", () => {
    const issues = paletteIssues(palette, { palette: [{ r: 255, g: 255, b: 255 }] })
    expect(issues.map((issue) => [issue.level, issue.code])).toEqual([["error", "off-palette"]])
    expect(issues[0]!.message).toContain("red")
  })

  it("hold a draft to maxColors", () => {
    const two = effect((fx) => {
      fx.px(0, 0, "white")
      fx.px(2, 2, "red")
    })
    expect(checkEffect(two, palette, {}, { rules: { maxColors: 1 } }).issues.map((issue) => issue.code)).toContain("too-many-colors")
  })

  it("set accepted warnings apart, never errors", () => {
    const late = effect((fx) => fx.frame > 0 && fx.frame < 3 && fx.disc(fx.cx, fx.cy, 2, "white"))
    const checked = checkEffect(late, palette, { accept: { late: "it waits for the swing", blank: "no" } })
    expect(checked.issues.map((issue) => issue.code)).not.toContain("late")
    expect(checked.accepted).toEqual([expect.objectContaining({ code: "late", why: "it waits for the swing" })])
    const blank = checkEffect(effect(() => {}), palette, { accept: { blank: "on purpose" } })
    expect(blank.issues.map((issue) => issue.code)).toEqual(["blank"])
  })
})

describe("banks and reviews", () => {
  const bank: Bank = {
    palette,
    backdrops: { cave: "#101018" },
    effects: { hit: { about: "A blow lands.", drafts: { a: { file: "a.js" }, b: { file: "b.js", seed: 3, tune: { reach: 8 }, accept: { jaggies: "the look" } } }, use: "b" } }
  }

  it("round-trip through their JSON", () => {
    expect(decodeBank(encodeBank(bank))).toEqual({ ok: true, value: bank })
    const review = { effects: { hit: { status: "changes" as const, note: "faster", comments: [{ draft: "b", frame: 3, x: 4, y: 5, text: "breaks here" }] } } }
    expect(decodeReview(encodeReview(review))).toEqual({ ok: true, value: review })
  })

  it("name every problem in a bank", () => {
    const decoded = decodeBank(JSON.stringify({ palette: { white: "white" }, backdrops: { cave: "dark" }, effects: { hit: { drafts: { a: {}, b: { file: "b.js", accept: { jaggies: "" } } }, use: "z" } } }))
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    for (const where of ["palette.white", "backdrops.cave", "drafts.a needs a file", "accept.jaggies must say why", "use must name one of its drafts"]) expect(decoded.error).toContain(where)
  })

  it("resolve comments by number with a reply, and list only the open ones", () => {
    const comments = [
      { draft: "a", frame: 1, x: 1, y: 1, text: "too bright" },
      { draft: "b", frame: 2, x: 2, y: 2, text: "faster" }
    ]
    const review = { effects: { hit: { status: "changes" as const, note: "", comments } } }
    const resolved = resolveComments(review, "hit", [1], "darker core")
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.value.effects.hit!.comments[0]).toMatchObject({ resolved: true, reply: "darker core" })
    expect(decodeReview(encodeReview(resolved.value))).toEqual({ ok: true, value: resolved.value })
    const summary = reviewSummary(bank, resolved.value)
    expect(summary.effects[0]).toMatchObject({ comments: [{ number: 2, text: "faster" }], resolved: 1 })
    expect(resolveComments(review, "hit", [3], "").ok).toBe(false)
  })

  it("give the agent the draft in use, its tune, and the person's words", () => {
    expect(usedDraft({ drafts: { a: { file: "a.js" } } })).toBe("a")
    const comments = [{ draft: "b", frame: 3, x: 4, y: 5, text: "breaks here" }]
    const summary = reviewSummary(bank, { effects: { hit: { status: "changes", note: "faster", comments } } })
    expect(summary.changes).toEqual([{ name: "hit", status: "changes", note: "faster", comments: [{ number: 1, ...comments[0]! }], use: "b", tune: { reach: 8 }, drafts: 2 }])
  })
})

describe("contact sheets", () => {
  it("lay every frame out enlarged, in rows", () => {
    const sheet = contactSheet(runEffect(shrinking, palette), palette, { scale: 2, columns: 3, backdrop: "dark" })
    // 3 frames of 16 px across with a gap of 2 around each; 2 rows.
    expect(sheet.width).toBe(3 * 16 + 4 * 2)
    expect(sheet.height).toBe(2 * 16 + 3 * 2)
  })
})

describe("the CLI", () => {
  const run = (...args: Array<string>) => spawnSync(process.execPath, [cli, "fx", ...args], { encoding: "utf8" })

  it("checks the example bank clean", () => {
    const result = run("check", example)
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "clean" })
  })

  it("starts a bank, looks at it, renders it, and reads notes", () => {
    const folder = mkdtempSync(join(tmpdir(), "fx-"))
    const bank = join(folder, "game.fx.json")
    expect(run("init", bank).status).toBe(0)
    expect(run("check", bank).status).toBe(0)
    const look = run("look", bank, "spark", "-o", join(folder, "look"))
    expect(look.status).toBe(0)
    expect(existsSync(join(folder, "look", "spark.a.png"))).toBe(true)
    expect(run("render", bank, "-o", join(folder, "out")).status).toBe(0)
    const sheet = JSON.parse(readFileSync(join(folder, "out", "spark.json"), "utf8")) as {
      animations: Record<string, Array<string>>
      frames: Record<string, { anchor: { x: number; y: number } }>
      meta: { loop: Record<string, boolean> }
    }
    expect(sheet.animations.spark).toHaveLength(8)
    // The starter's anchor, [12, 12] on 24 × 24, as the hash format writes it (the pixel's middle across, its foot down).
    expect(sheet.frames["spark 0"]!.anchor.x).toBeCloseTo(12.5 / 24, 4)
    expect(sheet.frames["spark 0"]!.anchor.y).toBeCloseTo(13 / 24, 4)
    expect(sheet.meta.loop).toEqual({ spark: false })
    expect(existsSync(join(folder, "out", "spark.gif"))).toBe(true)
    expect(run("notes", bank).stdout).toContain("not reviewed yet")
  })

  it("reads the project's pixel.config.json, and rings comments on the contact sheet", () => {
    const folder = mkdtempSync(join(tmpdir(), "fx-"))
    const bank = join(folder, "game.fx.json")
    expect(run("init", bank).status).toBe(0)
    writeFileSync(join(folder, "pixel.config.json"), JSON.stringify({ palette: ["#ffffff", "#fee761"] }))
    const checked = run("check", bank)
    expect(checked.status).toBe(3)
    expect(JSON.parse(checked.stdout)).toMatchObject({ config: join(folder, "pixel.config.json"), palette: [{ level: "error", code: "off-palette" }] })
    writeFileSync(reviewPath(bank), encodeReview({ effects: { spark: { status: "changes", note: "", comments: [{ draft: "a", frame: 2, x: 12, y: 12, text: "too bright" }] } } }))
    const look = run("look", bank, "spark", "-o", join(folder, "look"))
    expect(JSON.parse(look.stdout)).toMatchObject({ marks: "comments", ringed: [{ number: 1, draft: "a", frame: 2, x: 12, y: 12, text: "too bright" }] })
    expect(run("resolve", bank, "spark", "1", "--reply", "dimmer core").status).toBe(0)
    expect(JSON.parse(run("look", bank, "spark", "-o", join(folder, "look")).stdout)).toMatchObject({ ringed: [] })
    expect(run("notes", bank).stdout).toContain('"resolved": 1')
    expect(run("resolve", bank, "spark", "2").status).toBe(2)
  })

  it("exits 3 on a draft that does not load", () => {
    const folder = mkdtempSync(join(tmpdir(), "fx-"))
    const bank = join(folder, "game.fx.json")
    mkdirSync(join(folder, "fx"))
    writeFileSync(join(folder, "fx", "broken.js"), "export default {")
    writeFileSync(bank, encodeBank({ palette, effects: { broken: { drafts: { a: { file: "fx/broken.js" } } } } }))
    const result = run("check", bank)
    expect(result.status).toBe(3)
    expect(result.stdout).toContain("does not load")
  })

  it("exits 2 on an effect the bank does not have", () => {
    expect(run("check", example, "nothing").status).toBe(2)
  })
}, 60_000)
