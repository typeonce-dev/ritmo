import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { approvalOf, changedSince } from "@typeonce/ritmo-tools/fx/core/approval.ts"
import { decodeBank, decodeReview, encodeBank, encodeReview, resolveComments, reviewPath, reviewSummary, standInSpot, unkept, usedDraft, type Bank } from "@typeonce/ritmo-tools/fx/core/bank.ts"
import { checkEffect, OTHER_SEEDS, paletteIssues } from "@typeonce/ritmo-tools/fx/core/check.ts"
import { doubles, faintOn, flicker, holes, jaggies } from "@typeonce/ritmo-tools/fx/core/craft.ts"
import { decodeEffect, rampsFor, runEffect, tuned, type Effect, type Fx } from "@typeonce/ritmo-tools/fx/core/effect.ts"
import { compareSheet, contactSheet, momentsOf, placeStandIn, viewOf } from "@typeonce/ritmo-tools/fx/core/export.ts"

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
    expect(one((fx) => fx.oval(5, 5, 0, 3, "white")).frames[0]!.every((v) => v === 0)).toBe(true)
  })

  it("draw ovals, flat on the floor or round, with even steps, no doubles, and no pinholes when thick", () => {
    for (let rx = 2; rx <= 32; rx += 2)
      for (const squash of [0.14, 0.3, 0.6]) {
        const ry = Math.max(1, rx * squash)
        const ring = one((fx) => fx.ovalRing(35, 35, rx, ry, "white"))
        const oval = one((fx) => fx.oval(35, 35, rx, ry, "white"))
        const thick = one((fx) => fx.ovalRing(35, 35, rx, ry, "white", 2))
        expect([rx, squash, jaggies(ring).length, doubles(ring).length, jaggies(oval).length, holes(thick).length]).toEqual([rx, squash, 0, 0, 0, 0])
      }
  })

  it("draw a sparkle as a cross with tipped arms", () => {
    const run = runEffect(effect((fx) => fx.sparkle(4, 4, 2, "white", "red")), palette)
    const at = (x: number, y: number) => run.frames[0]![y * 8 + x]
    expect([at(4, 4), at(5, 4), at(6, 4), at(4, 2), at(5, 5)]).toEqual([1, 1, 2, 2, 0])
  })

  it("draw a streak from its head back along its motion, along a ramp", () => {
    const run = runEffect(effect((fx) => fx.streak(6, 2, 4, 0, ["white", "red"])), palette)
    const row = Array.from(run.frames[0]!.slice(16, 24))
    // Head at x 6, tail at x 2: white for the first half, red for the rest.
    expect(row).toEqual([0, 0, 2, 2, 2, 1, 1, 0])
  })
})

describe("ramps", () => {
  const ramps = { hot: ["white", "red"], cold: ["red", "white"] }

  it("draw the bank's ramps by name, and list the ones a draft used", () => {
    const run = runEffect(effect((fx) => fx.px(0, 0, fx.ramp("hot", 0))), palette, { ramps })
    expect(run.frames[0]![0]).toBe(1)
    expect(run.ramps).toEqual(["hot"])
  })

  it("recolor a ramp with another's colors", () => {
    const run = runEffect(effect((fx) => fx.px(0, 0, fx.ramp("hot", 0))), palette, { ramps: rampsFor(ramps, { hot: "cold" }) })
    expect(run.frames[0]![0]).toBe(2)
  })

  it("report a ramp the bank does not have, once", () => {
    const run = runEffect(effect((fx) => fx.px(0, 0, fx.ramp("lava", 0))), palette, { ramps })
    expect(run.errors).toEqual(['no ramp named "lava" in the bank\'s ramps (hot, cold)'])
  })
})

describe("the craft rules", () => {
  const frame = (rows: ReadonlyArray<string>) => {
    const width = rows[0]!.length
    return { width, height: rows.length, frames: [Uint8Array.from(rows.join(""), (c) => (c === "#" ? 1 : 0))], fps: 12, loop: false, anchor: { x: 0, y: 0 }, clipped: [0], errors: [], ramps: [] }
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

  it("warn when another seed draws past the edge that the draft's own keeps inside", () => {
    // One pixel inside or past the right edge, by the seed's first number.
    const lucky = effect((fx) => fx.px(fx.random() < 0.5 ? 2 : 9, 2, "white"))
    const clips = (seed: number) => runEffect(lucky, palette, { seed }).clipped.some((count) => count > 0)
    let seen = 0
    for (let seed = 1; seed <= 20; seed++) {
      if (clips(seed)) continue
      const warned = checkEffect(lucky, palette, { seed }).issues.some((issue) => issue.code === "clipped-seed")
      expect([seed, warned]).toEqual([seed, OTHER_SEEDS.some((other) => other !== seed && clips(other))])
      if (warned) seen++
    }
    expect(seen).toBeGreaterThan(0)
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
    const full: Bank = {
      palette,
      ramps: { hot: ["white", "red"], cold: ["red", "white"] },
      standIn: { file: "hero.png", anchor: [6, 22] },
      effects: { hit: { standIn: [0, 11], drafts: { a: { file: "a.js", recolor: { hot: "cold" } } } }, torch: { standIn: false, drafts: { a: { file: "t.js" } } } }
    }
    expect(decodeBank(encodeBank(full))).toEqual({ ok: true, value: full })
    const review = { effects: { hit: { status: "changes" as const, note: "faster", comments: [{ draft: "b", frame: 3, x: 4, y: 5, text: "breaks here" }] } } }
    expect(decodeReview(encodeReview(review))).toEqual({ ok: true, value: review })
  })

  it("name every problem in a bank", () => {
    const decoded = decodeBank(JSON.stringify({ palette: { white: "white" }, backdrops: { cave: "dark" }, effects: { hit: { drafts: { a: {}, b: { file: "b.js", accept: { jaggies: "" } } }, use: "z" } } }))
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    for (const where of ["palette.white", "backdrops.cave", "drafts.a needs a file", "accept.jaggies must say why", "use must name one of its drafts"]) expect(decoded.error).toContain(where)
    const more = decodeBank(
      JSON.stringify({ palette, ramps: { hot: ["white", "blue"], one: ["white"] }, standIn: { file: "hero.png" }, effects: { hit: { standIn: "feet", drafts: { a: { file: "a.js", recolor: { hot: "lava" } } } } } })
    )
    expect(more.ok).toBe(false)
    if (more.ok) return
    for (const where of ["ramps.hot names blue", "ramps.one must be a list of at least two", "standIn must be", "effects.hit.standIn must be [dx, dy]", "recolor.hot must map"]) expect(more.error).toContain(where)
  })

  it("stand the stand-in on the effect's anchor, moved by the effect's offset, or nowhere", () => {
    const withStandIn: Bank = { ...bank, standIn: { file: "hero.png", anchor: [6, 22] } }
    const anchor = { x: 10, y: 12 }
    expect(standInSpot(withStandIn, { drafts: {} }, anchor)).toEqual([10, 12])
    expect(standInSpot(withStandIn, { standIn: [0, 11], drafts: {} }, anchor)).toEqual([10, 23])
    expect(standInSpot(withStandIn, { standIn: false, drafts: {} }, anchor)).toBeUndefined()
    expect(standInSpot(bank, { drafts: {} }, anchor)).toBeUndefined()
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

describe("what the person approved", () => {
  const moving = (reach: number, frames = 4, fps = 12) => runEffect(effect((fx) => fx.disc(fx.cx, fx.cy, fx.frame === 2 ? reach : 2, "white"), { frames, fps }), palette)
  const approved = approvalOf("a", moving(3), palette)

  it("is unchanged when the same draft draws the same frames", () => {
    expect(changedSince(approved, "a", moving(3), palette)).toBeUndefined()
  })

  it("names the frames that look different", () => {
    expect(changedSince(approved, "a", moving(1), palette)).toBe("frame 2 looks different")
  })

  it("sees a palette color change, with the pixels in the same places", () => {
    const repainted = { ...palette, white: "#eeeeee" }
    expect(changedSince(approved, "a", moving(3), repainted)).toBe("frames 0-3 look different")
  })

  it("tells a drawn black pixel from an empty one", () => {
    const black = { white: "#000000", red: "#e43b44" }
    const empty = runEffect(effect(() => {}), black)
    expect(changedSince(approvalOf("a", empty, black), "a", moving(3), black)).toBe("frames 0-3 look different")
  })

  it("sees a different draft, a different length, and a different speed", () => {
    expect(changedSince(approved, "b", moving(3), palette)).toBe("the game gets draft b, the person approved draft a")
    expect(changedSince(approved, "a", moving(3, 6), palette)).toBe("6 frames, 4 when approved")
    expect(changedSince(approved, "a", moving(3, 4, 24), palette)).toBe("24 fps, 12 when approved")
  })

  it("sees a moved anchor, a loop that no longer loops, and a new canvas size: what the game gets beside the frames", () => {
    const at = (anchor: { x: number; y: number }, overrides: Partial<Effect> = {}) => runEffect(effect((fx) => fx.disc(4, 4, 2, "white"), { anchor, ...overrides }), palette)
    const seen = approvalOf("a", at({ x: 4, y: 4 }), palette)
    expect(seen).toMatchObject({ loop: false, size: [8, 8], anchor: [4, 4] })
    expect(changedSince(seen, "a", at({ x: 0, y: 0 }), palette)).toBe("its anchor moved from 4,4 to 0,0")
    expect(changedSince(seen, "a", at({ x: 4, y: 4 }, { loop: true }), palette)).toBe("it loops, it played once when approved")
    expect(changedSince(approvalOf("a", at({ x: 4, y: 4 }, { loop: true }), palette), "a", at({ x: 4, y: 4 }), palette)).toBe("it plays once, it looped when approved")
    expect(changedSince(seen, "a", at({ x: 4, y: 4 }, { width: 10 }), palette)).toBe("its canvas is 10×8, 8×8 when approved")
  })

  it("from before approvals kept the anchor and the loop: compares what it kept, and is unrecorded rather than approved", () => {
    const old = { draft: "a", fps: approved.fps, frames: approved.frames }
    const moved = runEffect(effect((fx) => fx.disc(fx.cx, fx.cy, fx.frame === 2 ? 3 : 2, "white"), { anchor: { x: 0, y: 0 }, loop: true }), palette)
    // Not a change for what it did not keep...
    expect(changedSince(old, "a", moved, palette)).toBeUndefined()
    expect(unkept(old)).toEqual(["its anchor", "whether it loops"])
    const bank: Bank = { palette, effects: { hit: { drafts: { a: { file: "a.js" } } } } }
    const said = { effects: { hit: { status: "approved" as const, note: "", comments: [], approved: old } } }
    // ...nor fully approved: the person is asked to look again, as for an approval with no record at all.
    const summary = reviewSummary(bank, said)
    expect(summary.effects[0]).toMatchObject({ unrecorded: true, next: "Approved, with no record of its anchor or whether it loops: ask the person to look again; only they approve it." })
    expect(summary.summary).toContain("0 approved, 1 approved with no record of what was seen")
    // A change in what it kept is said as a change, not as unrecorded.
    const stale = reviewSummary(bank, said, { hit: "frame 2 looks different" })
    expect(stale.effects[0]!.changedSinceApproved).toBe("frame 2 looks different")
    expect(stale.effects[0]!.unrecorded).toBeUndefined()
    // A full approval is neither.
    expect(reviewSummary(bank, { effects: { hit: { ...said.effects.hit, approved } } }).effects[0]!.unrecorded).toBeUndefined()
    expect(decodeReview(encodeReview(said))).toEqual({ ok: true, value: said })
  })

  it("round-trips through the review, and a review from before hashes still reads", () => {
    const review = { effects: { hit: { status: "approved" as const, note: "", comments: [], approved } } }
    expect(decodeReview(encodeReview(review))).toEqual({ ok: true, value: review })
    expect(decodeReview(JSON.stringify({ version: 1, effects: { hit: { status: "approved" } } }))).toEqual({ ok: true, value: { effects: { hit: { status: "approved", note: "", comments: [] } } } })
    const broken = decodeReview(JSON.stringify({ version: 1, effects: { hit: { status: "approved", approved: { draft: "a", fps: 12, frames: [1] } } } }))
    expect(broken.ok === false && broken.error).toContain("hit.approved")
    const badAnchor = decodeReview(JSON.stringify({ version: 1, effects: { hit: { status: "approved", approved: { ...approved, anchor: [1.5, 2] } } } }))
    expect(badAnchor.ok === false && badAnchor.error).toContain('"anchor": [x, y]')
  })

  it("shows in the agent's summary only while the effect is approved", () => {
    const bank: Bank = { palette, effects: { hit: { drafts: { a: { file: "a.js" } } } } }
    const said = (status: "approved" | "changes") => ({ effects: { hit: { status, note: "", comments: [], approved } } })
    const stale = reviewSummary(bank, said("approved"), { hit: "frame 2 looks different" })
    expect(stale.effects[0]!.changedSinceApproved).toBe("frame 2 looks different")
    expect(stale.summary).toContain("1 changed since")
    expect(reviewSummary(bank, said("changes"), { hit: "frame 2 looks different" }).effects[0]!.changedSinceApproved).toBeUndefined()
  })
})

describe("contact sheets", () => {
  it("lay every frame out enlarged, in rows", () => {
    const sheet = contactSheet(runEffect(shrinking, palette), palette, { scale: 2, columns: 3, backdrop: "dark" })
    // 3 frames of 16 px across with a gap of 2 around each; 2 rows.
    expect(sheet.width).toBe(3 * 16 + 4 * 2)
    expect(sheet.height).toBe(2 * 16 + 3 * 2)
  })

  it("grow each frame to hold the stand-in, and draw it behind the effect", () => {
    // A 4 × 10 red sprite, its feet on the canvas's bottom-left pixel: it sticks out 2 above the 8 × 8 canvas.
    const image = { width: 4, height: 10, data: new Uint8ClampedArray(4 * 10 * 4).map((_, i) => [228, 59, 68, 255][i % 4]!) }
    const standIn = placeStandIn(image, [0, 9], [0, 7])
    const run = runEffect(effect((fx) => fx.px(1, 7, "white"), { frames: 1 }), palette)
    expect(viewOf(run, standIn)).toEqual({ left: 0, top: -2, width: 8, height: 10 })
    const sheet = contactSheet(run, palette, { scale: 1, columns: 1, backdrop: "dark", standIn })
    expect(sheet.height).toBe(10 + 2 * 2)
    const rgb = (x: number, y: number) => Array.from(sheet.data.slice((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 3))
    // Frame 0 starts 2 in; the effect's (0, 7) is the view's (0, 9): the sprite there, the effect's white beside it.
    expect(rgb(2, 2 + 9)).toEqual([228, 59, 68])
    expect(rgb(3, 2 + 9)).toEqual([255, 255, 255])
  })

  it("compare drafts in rows, the same moments in each column", () => {
    expect(momentsOf(10, 4)).toEqual([0, 3, 6, 9])
    const rows = [{ run: runEffect(shrinking, palette) }, { run: runEffect(effect(shrinking.draw, { frames: 8, width: 12 }), palette) }]
    const sheet = compareSheet(rows, palette, { scale: 2, columns: 4, backdrop: "dark" })
    // Cells as big as the widest draft (12 × 8 at 2×); 4 columns; 2 rows with a wider gap between them.
    expect(sheet.width).toBe(4 * 24 + 5 * 2)
    expect(sheet.height).toBe(2 * 16 + 6 + 2 * 2)
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
    const compare = run("look", bank, "spark", "--compare", "-o", join(folder, "look"))
    expect(JSON.parse(compare.stdout)).toMatchObject({ rows: ["a"] })
    expect(existsSync(join(folder, "look", "spark.compare.png"))).toBe(true)
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
    const notes = JSON.parse(run("notes", bank).stdout) as { summary: string; ramps: Record<string, Array<string>> }
    expect(notes.summary).toContain("not reviewed yet")
    // The palette and ramps as they are now: the person can change them on the page.
    expect(notes.ramps).toEqual({ fire: ["white", "yellow", "orange", "red"] })
  })

  it("renders a long effect in rows of 8, with each frame's rectangle in its JSON", () => {
    const folder = mkdtempSync(join(tmpdir(), "fx-"))
    const bank = join(folder, "game.fx.json")
    writeFileSync(join(folder, "long.js"), `export default { size: [10, 6], frames: 20, fps: 20, loop: true, draw(fx) { fx.px(fx.frame % 10, 3, "white") } }`)
    writeFileSync(bank, encodeBank({ palette, effects: { long: { drafts: { a: { file: "long.js" } } } } }))
    expect(run("render", bank, "--scale", "2", "-o", join(folder, "out")).status).toBe(0)
    const sheet = JSON.parse(readFileSync(join(folder, "out", "long.json"), "utf8")) as {
      animations: Record<string, Array<string>>
      frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>
      meta: { size: { w: number; h: number } }
    }
    expect(sheet.meta.size).toEqual({ w: 160, h: 36 })
    expect(sheet.animations.long).toHaveLength(20)
    expect(sheet.frames["long 7"]!.frame).toEqual({ x: 140, y: 0, w: 20, h: 12 })
    expect(sheet.frames["long 8"]!.frame).toEqual({ x: 0, y: 12, w: 20, h: 12 })
    expect(sheet.frames["long 19"]!.frame).toEqual({ x: 60, y: 24, w: 20, h: 12 })
  })

  it("says when an approved effect no longer matches what the person saw, in notes and render", () => {
    const folder = mkdtempSync(join(tmpdir(), "fx-"))
    const bank = join(folder, "game.fx.json")
    const draw = (color: string) => `export default { size: [8, 8], frames: 3, fps: 12, draw(fx) { if (fx.frame < 2) fx.disc(fx.cx, fx.cy, 2, fx.frame === 1 ? "${color}" : "white") } }`
    writeFileSync(join(folder, "hit.js"), draw("white"))
    writeFileSync(bank, encodeBank({ palette, effects: { hit: { drafts: { a: { file: "hit.js" } } } } }))
    const seen = runEffect(effect((fx) => { if (fx.frame < 2) fx.disc(fx.cx, fx.cy, 2, "white") }, { frames: 3 }), palette)
    writeFileSync(reviewPath(bank), encodeReview({ effects: { hit: { status: "approved", note: "", comments: [], approved: approvalOf("a", seen, palette) } } }))
    const clean = JSON.parse(run("notes", bank).stdout) as { effects: Array<{ changedSinceApproved?: string }> }
    expect(clean.effects[0]!.changedSinceApproved).toBeUndefined()
    writeFileSync(join(folder, "hit.js"), draw("red"))
    const stale = JSON.parse(run("notes", bank).stdout) as { summary: string; effects: Array<{ changedSinceApproved?: string }> }
    expect(stale.effects[0]!.changedSinceApproved).toBe("frame 1 looks different")
    expect(stale.summary).toContain("ask the person to look again")
    const render = JSON.parse(run("render", bank, "-o", join(folder, "out")).stdout) as { effects: Array<{ changedSinceApproved?: string }> }
    expect(render.effects[0]!.changedSinceApproved).toBe("frame 1 looks different")
    writeFileSync(join(folder, "hit.js"), "not a module")
    const broken = JSON.parse(run("notes", bank).stdout) as { effects: Array<{ changedSinceApproved?: string }> }
    expect(broken.effects[0]!.changedSinceApproved).toContain("no longer loads")
  })

  it("says an approved effect changed when only its anchor moved, as render hands the game the new one", async () => {
    const folder = mkdtempSync(join(tmpdir(), "fx-"))
    const bank = join(folder, "game.fx.json")
    expect(run("init", bank).status).toBe(0)
    const module = join(folder, "fx", "spark.a.js")
    // What the person saw: the starter as it draws, approved as the page and the CLI store it.
    const loaded = decodeEffect(await import(`data:text/javascript;base64,${Buffer.from(readFileSync(module, "utf8")).toString("base64")}`))
    if (!loaded.ok) throw new Error(loaded.error)
    const colors = (JSON.parse(readFileSync(bank, "utf8")) as { palette: Record<string, string> }).palette
    const seen = runEffect(loaded.value, colors, { ramps: { fire: ["white", "yellow", "orange", "red"] } })
    writeFileSync(reviewPath(bank), encodeReview({ effects: { spark: { status: "approved", note: "", comments: [], approved: approvalOf("a", seen, colors) } } }))
    expect(JSON.parse(run("notes", bank).stdout)).toMatchObject({ effects: [{ name: "spark", status: "approved" }], summary: expect.stringContaining("1 approved,") })
    writeFileSync(module, readFileSync(module, "utf8").replace("anchor: [12, 12]", "anchor: [0, 0]"))
    const notes = JSON.parse(run("notes", bank).stdout) as { effects: Array<{ changedSinceApproved?: string }> }
    expect(notes.effects[0]!.changedSinceApproved).toBe("its anchor moved from 12,12 to 0,0")
    const rendered = run("render", bank, "-o", join(folder, "out"))
    expect(JSON.parse(rendered.stdout)).toMatchObject({ effects: [{ anchor: [0, 0], changedSinceApproved: "its anchor moved from 12,12 to 0,0" }] })
  })

  it("exits 3 in look and render, as in check, for a draft that does not load or does not draw cleanly", () => {
    const folder = mkdtempSync(join(tmpdir(), "fx-"))
    const bank = join(folder, "game.fx.json")
    writeFileSync(bank, encodeBank({ palette, effects: { hit: { drafts: { a: { file: "hit.js" } } } } }))
    const drafts = {
      throws: `export default { size: [8, 8], frames: 2, fps: 12, draw(fx) { throw new Error("boom") } }`,
      color: `export default { size: [8, 8], frames: 2, fps: 12, draw(fx) { fx.px(1, 1, "pink") } }`,
      ramp: `export default { size: [8, 8], frames: 2, fps: 12, draw(fx) { fx.px(1, 1, fx.ramp("ice", fx.t)) } }`,
      loads: "export default {",
      module: "export default { size: [8, 8] }"
    }
    for (const [what, source] of Object.entries(drafts)) {
      writeFileSync(join(folder, "hit.js"), source)
      expect([what, run("check", bank).status]).toEqual([what, 3])
      for (const command of [["look", bank, "hit", "-o", join(folder, "look")], ["render", bank, "-o", join(folder, "out")]]) {
        const result = run(...command)
        expect([what, command[0], result.status]).toEqual([what, command[0], 3])
        expect(JSON.parse(result.stdout)).toMatchObject({ effect: "hit", draft: "a", next: expect.stringContaining("fx check") })
        if (what === "ramp") expect(result.stderr).toContain('no ramp named "ice"')
      }
    }
    expect(existsSync(join(folder, "out"))).toBe(false)
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
