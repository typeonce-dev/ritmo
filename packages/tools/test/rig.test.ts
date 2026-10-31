import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { encodePng } from "@typeonce/ritmo-tools/pixel/cli/png.ts"
import { toGif } from "@typeonce/ritmo-tools/pixel/core/gif.ts"
import { decodeBank, decodeReview, encodeBank, encodeReview, openComments, resolveComments, reviewPath, reviewSummary, usedDraft, whereOf, type Bank, type Review } from "@typeonce/ritmo-tools/rig/core/bank.ts"
import { checkClip, JERK } from "@typeonce/ritmo-tools/rig/core/check.ts"
import { decodeClip, runClip, tuned, type Clip, type RigContext } from "@typeonce/ritmo-tools/rig/core/clip.ts"
import { artOf, framePictures, gifFramesOf, lookSheet, MAX_WIDTH } from "@typeonce/ritmo-tools/rig/core/export.ts"
import { encodeSidecar, sidecarClip, sidecarName, sidecarOf } from "@typeonce/ritmo-tools/rig/core/sidecar.ts"
import { keysAt, KeysError } from "@typeonce/ritmo-tools/rig/core/keys.ts"
import { add, solve } from "@typeonce/ritmo-tools/rig/core/pose.ts"
import { angleOf, apply, decodeRig, poseProblems, type Pose, type Rig } from "@typeonce/ritmo-tools/rig/core/rig.ts"

/**
 * A small figure facing right: hips 22 above the ground, a torso, a near
 * arm holding a stick (a prop), a far arm, and one leg whose ankle is 2
 * above the ground and whose foot's sole is on it in the setup pose.
 */
const spec = {
  size: [64, 64],
  anchor: [32, 60],
  line: 1,
  back: "torso",
  bones: {
    hips: { y: 22, rotation: 90, length: 4 },
    torso: { parent: "hips", length: 16 },
    arm: { parent: "torso", x: 14, rotation: 180, length: 8 },
    fore: { parent: "arm", x: 8, length: 8 },
    hand: { parent: "fore", x: 8, length: 2 },
    stick: { parent: "hand", x: 2, rotation: 90, length: 12 },
    armFar: { parent: "torso", x: 14, rotation: 180, length: 10 },
    thigh: { parent: "hips", rotation: 180, length: 10 },
    shin: { parent: "thigh", x: 10, length: 10 },
    foot: { parent: "shin", x: 10, rotation: 90, length: 4 }
  },
  parts: {
    armFar: { bone: "armFar", z: 0, far: true, fill: "#2b5784", shape: { kind: "capsule", r: 2 } },
    torso: { bone: "torso", z: 10, fill: "#3f7fb8", shape: { kind: "capsule", r: 4 } },
    thigh: { bone: "thigh", z: 11, fill: "#4b4f6e", shape: { kind: "capsule", r: 2.5 } },
    shin: { bone: "shin", z: 12, fill: "#4b4f6e", shape: { kind: "capsule", r: 2 } },
    foot: { bone: "foot", z: 13, fill: "#6e4b3a", shape: { kind: "capsule", a: { dy: -1 }, b: { along: 4, dy: -1 }, r: 1 } },
    arm: { bone: "arm", z: 20, fill: "#3f7fb8", shape: { kind: "capsule", r: 1.8 } },
    fore: { bone: "fore", z: 21, fill: "#f1c09a", shape: { kind: "capsule", r: 1.5 } },
    hand: { bone: "hand", z: 22, fill: "#f1c09a", shape: { kind: "ellipse", c: { along: 1 }, rx: 1.8 } },
    stick: { bone: "stick", z: 23, fill: "#dde6ee", shape: { kind: "capsule", r: 0.8 }, alt: { short: { kind: "capsule", b: { along: 4 }, r: 0.8 } } }
  },
  chains: {
    leg: { upper: "thigh", lower: "shin", end: "foot", bend: 1, foot: true },
    reach: { upper: "arm", lower: "fore", end: "hand", bend: -1 }
  },
  props: { stick: ["stick"] },
  stances: { stand: { bones: { torso: -5, arm: 20, fore: 40 } } },
  sockets: { tip: { bone: "stick", along: 12 }, shoulder: { bone: "torso", along: 14 } }
}

const decoded = decodeRig({ default: spec })
if (!decoded.ok) throw new Error(decoded.error)
const rig: Rig = decoded.value

const clip = (pose: (rig: RigContext, t: number, p: Readonly<Record<string, number>>) => unknown, overrides: Partial<Clip> = {}): Clip => ({
  label: "",
  frames: 8,
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
  pose,
  ...overrides
})

/** Sinks on the planted foot and bends the arm a little more each frame, so no joint is locked: a clip that passes. */
const alive = (_r: RigContext, t: number): Pose => ({ bones: { hips: { y: -2 - 3 * t }, arm: 20 + 20 * t, fore: 40 + 30 * t }, reach: { leg: { x: 2, y: 2 } } })

const codes = (target: Clip, options: Parameters<typeof checkClip>[2] = {}): Array<string> => checkClip(rig, target, options).issues.map((issue) => issue.code)

const example = fileURLToPath(new URL("../examples/rig/hero.rig.json", import.meta.url))
const cli = fileURLToPath(new URL("../bin/ritmo-tools.mjs", import.meta.url))

describe("rigs", () => {
  it("name every field that is wrong", () => {
    const wrong = decodeRig({
      default: {
        size: [4, 4],
        anchor: "feet",
        bones: { hips: { length: 0 }, torso: { parent: "chest", length: 4 } },
        parts: { torso: { bone: "torso", z: 0, fill: "blue", shape: { kind: "box" } } }
      }
    })
    expect(wrong.ok).toBe(false)
    if (wrong.ok) return
    for (const field of ["size", "anchor", "bones.hips needs a length", "bones.torso.parent: no bone named chest"]) expect(wrong.error).toContain(field)
    const parts = decodeRig({ default: { ...spec, parts: { torso: { bone: "torso", z: 0, fill: "blue", shape: { kind: "box" } }, ghost: { bone: "tail", z: 0, fill: "#ffffff", shape: { kind: "capsule", r: 1 } } }, props: { stick: ["blade"] } } })
    expect(parts.ok).toBe(false)
    if (parts.ok) return
    for (const field of ["parts.torso.fill", "parts.torso.shape.kind", "parts.ghost needs a bone", "props.stick: no part named blade"]) expect(parts.error).toContain(field)
  })

  it("check chains and stances against the bones", () => {
    const chains = decodeRig({ default: { ...spec, chains: { bad: { upper: "thigh", lower: "fore", end: "hand", bend: 1 } } } })
    expect(chains.ok === false && chains.error).toContain("chains.bad: fore must be a child of thigh")
    const stances = decodeRig({ default: { ...spec, stances: { stand: { bones: { tail: 4 } } } } })
    expect(stances.ok === false && stances.error).toContain("stances.stand: bones: no bone named tail")
  })

  it("place shapes on a bone in the setup pose, or in world coordinates", () => {
    // The foot bone starts at the ankle (0, 2) and points forward: its capsule is 1 below, from the ankle to 4 forward.
    const foot = rig.part.foot!.shape
    expect(foot.kind === "capsule" && [...foot.a, ...foot.b].map((v) => Math.round(v * 1000) / 1000 + 0)).toEqual([0, 1, 4, 1])
    // A capsule with no ends runs the length of its bone: the torso from the hips' start (0, 22) up 16.
    const torso = rig.part.torso!.shape
    expect(torso.kind === "capsule" && [torso.a[1], torso.b[1]]).toEqual([22, 38])
  })
})

describe("poses", () => {
  it("aim a bone at a world angle, whatever its parents do", () => {
    for (const turn of [-70, -10, 0, 35, 120]) {
      const world = solve(rig, { bones: { torso: turn, arm: turn / 2, fore: 15 }, aim: { stick: 245 } })
      expect(((angleOf(world.stick!) % 360) + 360) % 360).toBeCloseTo(245, 6)
    }
    // Half an aim is halfway from the bone's own angle.
    const own = angleOf(solve(rig, {}).stick!)
    expect(angleOf(solve(rig, { aim: { stick: { angle: own + 40, mix: 0.5 } } }).stick!)).toBeCloseTo(own + 20, 6)
  })

  it("aim a limb bone by bone: the thigh forward and the shin hanging", () => {
    const world = solve(rig, { aim: { thigh: -40, shin: -90 } })
    expect(angleOf(world.thigh!)).toBeCloseTo(-40, 6)
    expect(angleOf(world.shin!)).toBeCloseTo(-90, 6)
  })

  it("reach a world point with IK, and keep the end's setup angle unless the goal says one", () => {
    const world = solve(rig, { reach: { leg: { x: 4, y: 3 } } })
    expect([world.foot!.x, world.foot!.y].map((v) => Math.round(v * 1000) / 1000 + 0)).toEqual([4, 3])
    expect(angleOf(world.foot!)).toBeCloseTo(0, 6)
    expect(angleOf(solve(rig, { reach: { leg: { x: 4, y: 3, angle: -20 } } }).foot!)).toBeCloseTo(-20, 6)
  })

  it("reach a point on another bone, moved in world axes, with the end's angle from that bone", () => {
    const pose: Pose = { bones: { torso: -20 }, reach: { reach: { bone: "torso", along: 10, dx: 6, dy: -2, turn: 30 } } }
    const world = solve(rig, pose)
    const [x, y] = apply(world.torso!, [10, 0])
    expect(world.hand!.x).toBeCloseTo(x + 6, 6)
    expect(world.hand!.y).toBeCloseTo(y - 2, 6)
    expect(angleOf(world.hand!)).toBeCloseTo(angleOf(world.torso!) + 30, 6)
  })

  it("let an aim win over a reach, and a reach over turns", () => {
    const world = solve(rig, { bones: { arm: 80 }, reach: { reach: { bone: "torso", along: 10, dx: 6 } }, aim: { arm: -45 } })
    expect(angleOf(world.arm!)).toBeCloseTo(-45, 6)
    const off = solve(rig, { bones: { arm: 80 }, reach: { reach: { x: 0, y: 0, mix: 0 } } })
    expect(angleOf(off.arm!)).toBeCloseTo(angleOf(solve(rig, { bones: { arm: 80 } }).arm!), 6)
  })

  it("lay poses: turns and aims add up, goals and slots in the top layer win", () => {
    const base: Pose = { bones: { torso: 10 }, aim: { stick: 50 }, reach: { leg: { x: 1, y: 0 } }, slots: { stick: "short" } }
    expect(add(base, { bones: { torso: 5 }, aim: { stick: 3 }, reach: { leg: { x: 2, y: 0 } } })).toMatchObject({
      bones: { torso: { r: 15 } },
      aim: { stick: { angle: 53 } },
      reach: { leg: { x: 2, y: 0 } },
      slots: { stick: "short" }
    })
  })

  it("name what a pose gets wrong, and hide a prop only as one", () => {
    const problems = poseProblems(rig, { bones: { tail: 3, torso: "up" }, aim: { stick: { mix: 1 } }, reach: { leg: { bone: "foot", x: 1 } }, slots: { stick: null }, props: { sword: null } })
    for (const problem of ["no bone named tail", "bones.torso must be", "aim.stick must be", "reach.leg is on foot, which is solved after thigh: declare foot before thigh", "reach.leg is on a bone, so it takes along, across, dx, dy, not x and y", "stick belongs to the prop stick; hide the whole prop with props: { stick: null }", "no prop named sword"])
      expect(problems.join("\n")).toContain(problem)
    expect(poseProblems(rig, { props: { stick: null } })).toEqual([])
  })
})

describe("keys", () => {
  const chains = { leg: ["thigh", "shin", "foot"], reach: ["arm", "fore", "hand"] }
  const at = (list: unknown, frame: number) => keysAt(list, frame, 10, chains)

  it("give each channel its own timeline, smooth by default, at rest on its ends", () => {
    const list = [{ at: 0, bones: { torso: 0 } }, { at: 4, bones: { torso: 40, arm: 10 } }, { at: 8, bones: { torso: 0 } }]
    expect(at(list, 4).bones).toEqual({ torso: { r: 40 }, arm: { r: 10 } })
    expect(at(list, 2).bones?.torso).toEqual({ r: 20 })
    // The arm has one key: it starts from the setup pose on frame 0 and holds its key after it.
    expect([at(list, 0).bones?.arm, at(list, 8).bones?.arm]).toEqual([{ r: 0 }, { r: 10 }])
    expect(at([{ at: 0, curve: "linear", bones: { torso: 0 } }, { at: 10, bones: { torso: 10 } }], 3).bones?.torso).toEqual({ r: 3 })
    expect(at([{ at: 0, curve: "stepped", bones: { torso: 0 } }, { at: 10, bones: { torso: 10 } }], 9).bones?.torso).toEqual({ r: 0 })
    expect(at([{ at: 0, slots: { stick: "short" } }, { at: 5, slots: { stick: "default" } }], 4.9).slots).toEqual({ stick: "short" })
  })

  it("start every channel from the setup pose on frame 0, for a clip with no stance", () => {
    const later = [{ at: 5, slots: { stick: "short" }, props: { stick: null }, z: { arm: 9 }, bones: { torso: 40, hips: { sx: 2 } } }]
    const first = at(later, 0)
    expect([first.slots, first.props, first.z, first.bones]).toEqual([{}, {}, {}, { torso: { r: 0 }, hips: { sx: 1 } }])
    expect(at(later, 5).bones).toEqual({ torso: { r: 40 }, hips: { sx: 2 } })
    expect((at(later, 2.5).bones?.torso as { r: number }).r).toBeCloseTo(20, 6)
    // An aim or a reach mixes in from 0 on frame 0 to 1 on its first key.
    const aimed = [{ at: 6, aim: { stick: 200 } }]
    expect(at(aimed, 0).aim).toEqual({ stick: { angle: 200, mix: 0 } })
    expect(at(aimed, 6).aim).toEqual({ stick: { angle: 200, mix: 1 } })
    expect(at([{ at: 4, reach: { reach: { x: 1, y: 1 } } }], 0).reach).toEqual({ reach: { x: 1, y: 1, mix: 0 } })
  })

  it("start every channel from the clip's stance on frame 0, so the first key need not repeat it", () => {
    const stance: Pose = { bones: { torso: -6, arm: 20 }, aim: { stick: 50 }, reach: { leg: { x: 2, y: 2 } }, slots: { stick: "short" } }
    const list = [{ at: 4, bones: { torso: 30 }, aim: { stick: 120 }, reach: { leg: { x: 6, y: 2 } } }, { at: 8, slots: { stick: "default" } }]
    const first = keysAt(list, 0, 10, chains, stance)
    expect(first).toMatchObject({ bones: { torso: { r: -6 }, arm: { r: 20 } }, aim: { stick: { angle: 50 } }, reach: { leg: { x: 2, y: 2 } }, slots: { stick: "short" } })
    expect(keysAt(list, 4, 10, chains, stance)).toMatchObject({ bones: { torso: { r: 30 }, arm: { r: 20 } }, aim: { stick: { angle: 120 } }, reach: { leg: { x: 6 } } })
    expect(keysAt(list, 8, 10, chains, stance).slots).toEqual({ stick: "default" })
    // A goal in another form than the stance's mixes in as if the stance had none.
    const onBone = keysAt([{ at: 4, reach: { leg: { bone: "torso", along: 0, dy: -20 } } }], 0, 10, chains, stance)
    expect(onBone.reach).toEqual({ leg: { bone: "torso", along: 0, dy: -20, mix: 0 } })
  })

  it("ease into and out of a rest key", () => {
    const list = [{ at: 0, bones: { torso: 0 } }, { at: 5, rest: true, bones: { torso: 50 } }, { at: 10, bones: { torso: 100 } }]
    const step = (f: number) => (at(list, f).bones?.torso as { r: number }).r - (at(list, f - 0.1).bones?.torso as { r: number }).r
    expect(Math.abs(step(5))).toBeLessThan(0.1)
  })

  it("refuse two keys on one frame for one channel, naming the frame and the channel", () => {
    const twice = [{ at: 0, bones: { torso: 0 } }, { at: 12, bones: { torso: 4 } }, { at: 12, bones: { torso: 9, arm: 3 } }]
    expect(() => keysAt(twice, 0, 20, chains)).toThrow(KeysError)
    expect(() => keysAt(twice, 0, 20, chains)).toThrow("two keys on frame 12 set bones.torso")
    // The number and the { r } form are one channel.
    expect(() => at([{ at: 2, bones: { torso: 1 } }, { at: 2, bones: { torso: { r: 2 } } }], 0)).toThrow("two keys on frame 2 set bones.torso")
    // Other channels on one frame are fine.
    expect(() => at([{ at: 2, bones: { torso: 1 } }, { at: 2, bones: { arm: 2 } }], 0)).not.toThrow()
  })

  it("refuse keys past the clip", () => {
    expect(() => at([{ at: 11, bones: { torso: 1 } }], 0)).toThrow("outside the clip's frames (0 to 10)")
  })

  it("refuse turns an aim or a reach always wins over, from the keys or the stance", () => {
    expect(() => at([{ at: 0, aim: { stick: 50 } }, { at: 4, bones: { stick: 20 } }], 0)).toThrow("bones.stick is keyed, but aim.stick (mix 1 on every frame) wins over it")
    expect(() => keysAt([{ at: 4, bones: { stick: 20 } }], 0, 10, chains, { aim: { stick: 50 } })).toThrow("bones.stick is keyed, but aim.stick (mix 1 on every frame) wins over it")
    expect(() => keysAt([{ at: 4, bones: { arm: 20 } }], 0, 10, chains, { reach: { reach: { x: 1, y: 1 } } })).toThrow("bones.arm is keyed, but reach.reach (mix 1 on every frame) wins over it")
    // An aim mixed in later, or mixed out, leaves the turns showing.
    expect(() => at([{ at: 0, bones: { stick: 10 } }, { at: 6, aim: { stick: 200 } }], 0)).not.toThrow()
    expect(() => keysAt([{ at: 4, bones: { stick: 20 }, aim: { stick: { angle: 50, mix: 0 } } }], 0, 10, chains, { aim: { stick: 50 } })).not.toThrow()
  })

  it("name the clip when the runner reports a key mistake", () => {
    const twice = clip((r) => r.keys([{ at: 0, bones: { torso: 0 } }, { at: 3, bones: { torso: 4 } }, { at: 3, bones: { torso: 5 } }]))
    const checked = checkClip(rig, twice, { name: "attack (draft a)" })
    expect(checked.issues).toEqual([{ level: "error", code: "keys", message: "attack (draft a): two keys on frame 3 set bones.torso: merge them into one key" }])
  })
})

describe("clips", () => {
  it("name every field that is wrong", () => {
    const wrong = decodeClip({ default: { frames: 0, fps: 90, stance: "crouch", trail: "tail", phases: [{ name: "swing", from: 4, to: 2 }], contacts: { reach: [[0, 3]] }, params: { lean: { min: 5, max: 1, value: 2 } } } }, rig)
    expect(wrong.ok).toBe(false)
    if (wrong.ok) return
    for (const field of ["frames", "fps", "pose must be a function", "stance must name one of the rig's stances (stand)", "trail must name a bone", "phases[0]", "contacts.reach: no foot chain", "params.lean"]) expect(wrong.error).toContain(field)
  })

  it("lay a tune over the params, kept in range", () => {
    const withParams = clip(() => ({}), { params: { lean: { min: 0, max: 10, value: 5 }, fold: { min: 1, max: 2, value: 1 } } })
    expect(tuned(withParams, { lean: 40, ghost: 1 })).toEqual({ lean: 10, fold: 1 })
  })

  it("start rig.random() from the seed on every frame", () => {
    const seen: Array<number> = []
    const draws = clip((r) => {
      seen[Math.round(r.frame)] = r.random()
      return {}
    })
    runClip(rig, draws, { seed: 1 })
    expect(new Set(seen).size).toBe(1)
    const first = seen[0]
    runClip(rig, draws, { seed: 2 })
    expect(seen[0]).not.toBe(first)
  })

  it("report a pose that throws or names what the rig does not have, without throwing", () => {
    const run = runClip(rig, clip((r) => {
      if (r.frame === 2) throw new Error("boom")
      return { bones: { tail: 1 } }
    }))
    expect(run.errors.map((error) => error.message)).toEqual(["bones: no bone named tail (the rig has hips, torso, arm, fore, hand, stick, armFar, thigh, shin, foot) (frames 0-1, 3-7)", "pose threw: boom (frame 2)"])
  })

  it("hide a prop as one, and exempt its bones from the checks and the trail", () => {
    const run = runClip(rig, clip(() => ({ props: { stick: null } })))
    expect(run.frames[0]!.drawn.map((d) => d.part)).not.toContain("stick")
    expect(run.frames[0]!.shown.has("stick")).toBe(false)
    // A stick that jumps about would jerk, if it showed.
    const wild = clip((r) => ({ ...alive(r, r.frame / 7), props: { stick: null }, bones: { stick: r.frame % 2 === 0 ? 0 : 170, arm: 20 + (20 * r.frame) / 7, fore: 40 + (30 * r.frame) / 7 } }), { trail: "stick" })
    const checked = checkClip(rig, wild)
    expect(checked.issues.map((issue) => issue.where).flat()).not.toContain("stick")
    expect(checked.trail).toBeUndefined()
    // Swapped to a look its parts have.
    const short = runClip(rig, clip(() => ({ props: { stick: "short" } })))
    expect(short.frames[0]!.drawn.find((d) => d.part === "stick")?.geom).toMatchObject({ kind: "capsule" })
  })
})

describe("the checks", () => {
  it("pass a clip that bends its joints and stays on the ground", () => {
    expect(codes(clip(alive))).toEqual([])
  })

  it("catch randomness that is not the seed's", () => {
    expect(codes(clip(() => ({ bones: { torso: Math.random() * 20 } })))).toEqual(["random"])
  })

  it("catch parts cut off by the frame's edge", () => {
    expect(codes(clip((r, t) => ({ ...alive(r, t), bones: { ...alive(r, t).bones, hips: { x: 30 } } })))).toContain("off-canvas")
  })

  it("catch parts under the ground, but not the feet", () => {
    const low = clip((r, t) => ({ ...alive(r, t), bones: { ...alive(r, t).bones, torso: 180 } }))
    const checked = checkClip(rig, low)
    const under = checked.issues.filter((issue) => issue.code === "below-ground").flatMap((issue) => issue.where ?? [])
    expect(under).toContain("torso")
    expect(under).not.toContain("foot")
  })

  it("catch a planted foot that floats, sinks, or slides, against the clip's travel", () => {
    const at = (y: number) => clip((r, t) => ({ ...alive(r, t), reach: { leg: { x: 2, y } } }))
    expect(codes(at(5))).toContain("floating")
    expect(codes(at(-1))).toContain("sinking")
    const sliding = (travel: number) => clip((r, t) => ({ ...alive(r, t), reach: { leg: { x: 4 - r.frame * 2, y: 2 } } }), { travel })
    expect(codes(sliding(0))).toContain("slide")
    // Planted feet move back at the travel speed: 2 px a frame at 12 fps.
    expect(codes(sliding(24))).not.toContain("slide")
    // Not while it is lifted.
    expect(codes(clip((r, t) => ({ ...alive(r, t), reach: { leg: { x: 2, y: 5 } } }), { contacts: { leg: [] } }))).not.toContain("floating")
  })

  it("catch a goal out of reach, unless an aim overrules it", () => {
    const far = clip((r, t) => ({ ...alive(r, t), reach: { ...alive(r, t).reach, reach: { x: 40, y: 30 } } }))
    expect(codes(far)).toContain("unreachable")
    const aimed = clip((r, t) => ({ ...alive(r, t), reach: { ...alive(r, t).reach, reach: { x: 40, y: 30 } }, aim: { arm: -60 + 10 * t, fore: -30 } }))
    expect(codes(aimed)).not.toContain("unreachable")
  })

  it("catch a far-side part peeking out behind the back", () => {
    expect(codes(clip((r, t) => ({ ...alive(r, t), bones: { ...alive(r, t).bones, armFar: -70 } })))).toContain("peek")
    expect(codes(clip(alive))).not.toContain("peek")
  })

  it("catch a joint that never bends, and one that bends the wrong way", () => {
    const stiff = clip((r, t) => ({ ...alive(r, t), bones: { ...alive(r, t).bones, fore: 40 } }))
    expect(checkClip(rig, stiff).issues.find((issue) => issue.code === "locked")?.where).toEqual(["fore"])
    const wrong = clip((r, t) => ({ ...alive(r, t), bones: { ...alive(r, t).bones, fore: -10 - 20 * t } }))
    expect(codes(wrong)).toContain("hyperextended")
  })

  it("catch a sudden change of speed, unless it is fast or eases out of rest", () => {
    // The torso turns 3° a frame, then 30: a pop.
    const jumpy = clip((r, t) => ({ ...alive(r, t), bones: { ...alive(r, t).bones, torso: r.frame < 4 ? 3 * r.frame : 9 + 30 * (r.frame - 3) } }), { frames: 10 })
    const jerks = checkClip(rig, jumpy).issues.find((issue) => issue.code === "jerk")
    expect(jerks?.message).toContain(`limit ${JERK}`)
    expect(jerks?.frames).toContain(3)
    expect(codes(clip(jumpy.pose, { frames: 10, phases: [{ name: "snap", from: 2, to: 5, fast: true }] }))).not.toContain("jerk")
    // From a standstill to full speed: the first frames of a move may change speed sharply.
    const fromRest = clip((r, t) => ({ ...alive(r, t), bones: { ...alive(r, t).bones, torso: r.frame < 4 ? 0 : 30 * (r.frame - 3) } }), { frames: 10 })
    expect(codes(fromRest)).not.toContain("jerk")
  })

  it("catch a loop that stops or jumps back to its start", () => {
    const loop = { loop: true, frames: 8 }
    const turn = (deg: (f: number) => number) => clip((r) => ({ ...alive(r, 0.5 + 0.5 * Math.sin((2 * Math.PI * r.frame) / 8)), bones: { torso: deg(r.frame), arm: 20 + 20 * Math.sin((2 * Math.PI * r.frame) / 8), fore: 50 + 20 * Math.sin((2 * Math.PI * r.frame) / 8) } }), loop)
    expect(codes(turn((f) => 10 * f))).toContain("seam")
    expect(codes(turn((f) => 20 * Math.sin((2 * Math.PI * f) / 8)))).not.toContain("seam")
    expect(codes(clip(() => ({}), loop))).toContain("identical")
  })

  it("catch a frame with nothing drawn", () => {
    const parts = Object.fromEntries(rig.parts.filter((part) => part.prop === undefined).map((part) => [part.name, null]))
    expect(codes(clip((r, t) => ({ ...alive(r, t), ...(r.frame === 3 ? { slots: parts, props: { stick: null } } : {}) })))).toContain("gap")
  })

  it("catch a part that jumps in front of others", () => {
    const flip = checkClip(rig, clip((r, t) => ({ ...alive(r, t), z: { armFar: r.frame < 4 ? 0 : 50 } })))
    expect(flip.issues.find((issue) => issue.code === "draw-order")).toMatchObject({ frames: [3, 4], where: ["armFar"] })
  })

  it("hold a clip to its stance on its first frame, and its last when it plays once", () => {
    const stand = rig.stances.stand!
    // Keys start from the stance, so a clip that ends on it is on it at both ends without keying frame 0.
    const onStance = clip((r) => r.keys([{ at: 3, bones: { arm: 60, fore: 90 } }, { at: 7, ...stand }]), { stance: "stand" })
    expect(codes(onStance).filter((code) => code === "stance")).toEqual([])
    expect(checkClip(rig, onStance).run.frames[0]!.pose.bones).toMatchObject({ torso: { r: -5 }, arm: { r: 20 }, fore: { r: 40 } })
    const off = checkClip(rig, clip((r) => r.keys([{ at: 7, bones: { torso: 20, arm: 60, fore: 90 } }]), { stance: "stand" }))
    const stance = off.issues.find((issue) => issue.code === "stance")
    expect(stance?.frames).toEqual([7])
    expect(stance?.message).toContain("frame 7, the last, is off the stand stance")
    expect(stance?.message).toContain("end on `{ at: 7, ...rig.stances.stand }`")
    expect(stance?.where).toContain("torso")
    // A key on frame 0 that contradicts the stance.
    const contradicts = checkClip(rig, clip((r) => r.keys([{ at: 0, bones: { torso: 30 } }, { at: 7, ...stand }]), { stance: "stand" }))
    expect(contradicts.issues.find((issue) => issue.code === "stance")).toMatchObject({ frames: [0], message: expect.stringContaining("rig.keys starts from the stance there, so a key on frame 0") })
    // A part the stance shows and the frame hides.
    const hidden = checkClip(rig, clip((r) => r.keys([{ at: 0, ...stand, props: { stick: null } }, { at: 7, ...stand, props: { stick: "default" } }]), { stance: "stand" }))
    expect(hidden.issues.find((issue) => issue.code === "stance")?.message).toContain("hides stick, which the stance shows")
  })

  it("set accepted warnings apart, never errors", () => {
    const stiff = clip((r, t) => ({ ...alive(r, t), bones: { ...alive(r, t).bones, fore: 40 } }))
    const checked = checkClip(rig, stiff, { accept: { locked: "a held guard" } })
    expect(checked.issues.map((issue) => issue.code)).not.toContain("locked")
    expect(checked.accepted).toEqual([expect.objectContaining({ code: "locked", why: "a held guard" })])
    const random = checkClip(rig, clip(() => ({ bones: { torso: Math.random() } })), { accept: { random: "on purpose" } })
    expect(random.issues.map((issue) => issue.code)).toEqual(["random"])
  })

  it("report each joint's bend, the trail's spacing and arc, and the world places asked for", () => {
    const checked = checkClip(rig, clip(alive, { trail: "stick", phases: [{ name: "swing", from: 3, to: 5, fast: true }] }), { positions: ["hand"] })
    expect(checked.joints.reach!.bend).toHaveLength(8)
    expect(checked.joints.reach!.max.deg - checked.joints.reach!.min.deg).toBeGreaterThan(20)
    expect(checked.trail).toMatchObject({ bone: "stick", arc: { swingFrames: "2-5" } })
    expect(checked.trail!.spacing).toHaveLength(8)
    const hand = checked.positions.hand!
    const world = checked.run.frames[0]!.world.hand!
    expect(hand.start[0]).toEqual([Math.round(world.x * 10) / 10, Math.round(world.y * 10) / 10])
    expect(hand.tip).toHaveLength(8)
  })
})

describe("the sidecar", () => {
  const swing = clip(alive, { trail: "stick", phases: [{ name: "swing", from: 3, to: 5, fast: true }], stance: "stand" })
  const decodedSwing = decodeClip({ default: { frames: 8, fps: 12, trail: "stick", stance: "stand", phases: [{ name: "swing", from: 3, to: 5, fast: true }], pose: alive } }, rig)
  if (!decodedSwing.ok) throw new Error(decodedSwing.error)
  const entry = (target: Clip, scale = 1) => sidecarClip(rig, target, runClip(rig, target), { name: "swing", draft: "a", scale })

  it("default a clip's hit to its trail bone on its fast frames, or take the clip's", () => {
    expect(decodedSwing.value.hit).toEqual({ bone: "stick", from: 0, to: 12, radius: 0, frames: [[3, 5]] })
    const own = decodeClip({ default: { frames: 8, fps: 12, trail: "stick", hit: { from: 4, radius: 1.5, frames: [[1, 2]] }, pose: alive } }, rig)
    expect(own.ok && own.value.hit).toEqual({ bone: "stick", from: 4, to: 12, radius: 1.5, frames: [[1, 2]] })
    expect(own.ok && entry(own.value, 2).frames[1]!.hit!.radius).toBe(3)
    const none = decodeClip({ default: { frames: 8, fps: 12, trail: "stick", hit: false, pose: alive } }, rig)
    expect(none.ok && none.value.hit).toBeUndefined()
    const wrong = decodeClip({ default: { frames: 8, fps: 12, hit: { from: 3 }, sockets: { x: { bone: "tail" } }, pose: alive } }, rig)
    expect(wrong.ok === false && wrong.error).toContain("hit must be { bone, from, to, radius, frames }")
    expect(wrong.ok === false && wrong.error).toContain("sockets.x must be { bone, along, across }")
  })

  it("give the hit segment only on its frames, in pixels from the anchor with y down", () => {
    const baked = entry(decodedSwing.value)
    expect(baked.frames.map((frame) => frame.hit !== null)).toEqual([false, false, false, true, true, true, false, false])
    const fr = runClip(rig, decodedSwing.value).frames[4]!
    const [tx, ty] = apply(fr.world.stick!, [12, 0])
    const to = baked.frames[4]!.hit!.to
    expect(to[0]).toBeCloseTo(tx, 1)
    expect(to[1]).toBeCloseTo(-ty, 1)
    // Twice the scale, twice the pixels.
    const twice = entry(decodedSwing.value, 2).frames[4]!.hit!.to
    expect(twice[0]).toBeCloseTo(to[0] * 2, 1)
  })

  it("place the rig's and the clip's sockets, angles clockwise on screen, and leave out hidden ones", () => {
    const fr = runClip(rig, swing).frames[0]!
    const tip = entry(swing).frames[0]!.sockets.tip!
    const [x, y] = apply(fr.world.stick!, [12, 0])
    expect([tip.x, tip.y]).toEqual([Math.round(x * 100) / 100 + 0, Math.round(-y * 100) / 100 + 0])
    expect(tip.angle).toBeCloseTo(-angleOf(fr.world.stick!), 0)
    const hidden = clip((r, t) => ({ ...alive(r, t), props: { stick: null } }), { sockets: { hand: { bone: "hand", along: 1, across: 0 } } })
    expect(Object.keys(entry(hidden).frames[0]!.sockets).sort()).toEqual(["hand", "shoulder"])
  })

  it("name each frame as the atlas does, its feet on the ground, its drawn box, and the clip's timing and stance", () => {
    const baked = entry(clip(alive, { contacts: { leg: [[0, 3]] }, stance: "stand", phases: [{ name: "swing", from: 3, to: 5, fast: true }] }))
    expect(baked).toMatchObject({ draft: "a", image: "swing.png", atlas: "swing.json", fps: 12, loop: false, duration: 667, stance: { start: "stand", end: "stand" }, phases: [{ name: "swing", from: 3, to: 5, fast: true }] })
    expect(baked.frames.map((frame) => frame.name)).toEqual(Array.from({ length: 8 }, (_, f) => `swing ${f}`))
    expect(baked.frames.map((frame) => frame.contacts)).toEqual([["foot"], ["foot"], ["foot"], ["foot"], [], [], [], []])
    const box = baked.frames[0]!.bounds!
    // The feet stand on the anchor: the box ends at the ground (y 0, down) with the outline, rounded out to whole pixels, and reaches up past the head.
    expect([1, 2]).toContain(box.y + box.h)
    expect(box.y).toBeLessThan(-30)
    expect(entry(clip(alive, { loop: true, stance: "stand" })).stance).toEqual({ start: "stand", end: null })
  })

  it("write the same bytes from the same clips, a frame a line, and name the file after the bank", () => {
    const sidecar = sidecarOf(rig, "rig.mjs", 1, { swing: entry(decodedSwing.value) })
    const text = encodeSidecar(sidecar)
    expect(encodeSidecar(sidecarOf(rig, "rig.mjs", 1, { swing: entry(decodedSwing.value) }))).toBe(text)
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(sidecar)))
    expect(text.split("\n").filter((line) => line.includes('"name":"swing ')).length).toBe(8)
    expect([sidecarName("art/hero.rig.json"), sidecarName("game.json")]).toEqual(["hero.rig.clips.json", "game.clips.json"])
  })
})

describe("banks and reviews", () => {
  const bank: Bank = { rig: "hero.js", clips: { attack: { about: "A chop.", drafts: { a: { file: "a.js" }, b: { file: "b.js", seed: 3, tune: { lean: 20 }, accept: { jerk: "the snap is the look" } } }, use: "b" } } }

  it("round-trip through their JSON", () => {
    expect(decodeBank(encodeBank(bank))).toEqual({ ok: true, value: bank })
    const review: Review = {
      clips: {
        attack: {
          status: "changes",
          note: "more lead-up",
          comments: [
            { draft: "a", frame: 3, x: 40, y: 50, part: "blade", bone: "sword", phase: "swing", text: "digs into the floor" },
            { draft: "b", from: 5, to: 9, phases: ["anticipation"], text: "too slow" }
          ]
        }
      }
    }
    expect(decodeReview(encodeReview(review))).toEqual({ ok: true, value: review })
  })

  it("name every problem in a bank", () => {
    const decoded = decodeBank(JSON.stringify({ rig: "hero.js", clips: { attack: { drafts: { a: {}, b: { file: "b.js", seed: 1.5, accept: { jerk: "" } } }, use: "z" } } }))
    expect(decoded.ok).toBe(false)
    if (decoded.ok) return
    for (const where of ["drafts.a needs a file", "seed must be a whole number", "accept.jerk must say why", "use must name one of its drafts"]) expect(decoded.error).toContain(where)
    expect(decodeBank(JSON.stringify({ clips: {} })).ok).toBe(false)
  })

  it("say where a comment is, resolve comments by number, and list only the open ones", () => {
    const comments = [
      { draft: "a", frame: 22, x: 146, y: 195, part: "blade", bone: "sword", phase: "up", text: "digs in" },
      { draft: "b", from: 6, to: 9, phases: ["raise"], text: "slow" }
    ]
    expect(whereOf(comments[0]!)).toBe("draft a, frame 22 (up), pixel (146, 195), on blade, near bone sword")
    expect(whereOf(comments[1]!)).toBe("draft b, frames 6-9 (raise)")
    const review: Review = { clips: { attack: { status: "changes", note: "", comments } } }
    const resolved = resolveComments(review, "attack", [1], "raised the carry")
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(openComments(resolved.value, "attack")).toEqual([{ number: 2, ...comments[1]! }])
    expect(openComments(resolved.value, "attack", "a")).toEqual([])
    const summary = reviewSummary(bank, resolved.value)
    expect(summary.clips[0]).toMatchObject({ comments: [{ number: 2, where: "draft b, frames 6-9 (raise)" }], resolved: 1, use: "b", tune: { lean: 20 } })
    expect(resolveComments(review, "attack", [3], "").ok).toBe(false)
    expect(usedDraft({ drafts: { a: { file: "a.js" } } })).toBe("a")
    expect(reviewPath("hero.rig.json")).toBe("hero.rig.review.json")
  })
})

describe("pictures", () => {
  const run = runClip(rig, clip(alive, { frames: 40, trail: "stick" }))

  it("wrap a contact sheet's rows to stay under 2000 pixels, and show a few frames bigger", () => {
    const options = { scale: 1, frames: run.frames.map((fr) => fr.frame), bones: true, onion: false, comments: [], title: "test" }
    const sheet = lookSheet(rig, clip(alive, { frames: 40 }), run, options)
    expect(sheet.width).toBeLessThanOrEqual(MAX_WIDTH)
    const few = lookSheet(rig, clip(alive, { frames: 40 }), run, { ...options, scale: 4, frames: [3, 4, 5], bones: false })
    // Three cells of 64 × 4 with a gap of 4 around each, one row of art under the title.
    expect([few.width, few.height]).toEqual([3 * 256 + 4 * 4, 24 + 256 + 4 + 4])
    expect(framePictures(rig, clip(alive, { frames: 40 }), run, { ...options, frames: [0, 1] })).toHaveLength(2)
  })

  it("draw the same bytes from the same clip", () => {
    const again = runClip(rig, clip(alive, { frames: 40, trail: "stick" }))
    const png = (target: typeof run) => encodePng(artOf(rig, target, 2)[7]!)
    expect(png(again)).toEqual(png(run))
    const gif = (target: typeof run) => toGif(gifFramesOf(rig, artOf(rig, target, 1), 1), { scale: 1, delay: 83 })
    expect(gif(again)).toEqual(gif(run))
  })

  it("anti-alias the edges", () => {
    const art = artOf(rig, run, 1)[0]!
    const alphas = new Set<number>()
    for (let i = 3; i < art.data.length; i += 4) alphas.add(art.data[i]!)
    expect([...alphas].some((a) => a > 0 && a < 255)).toBe(true)
  })
})

describe("the CLI", () => {
  const run = (...args: Array<string>) => spawnSync(process.execPath, [cli, "rig", ...args], { encoding: "utf8" })

  it("checks the example bank clean, apart from its accepted warnings, a verdict per clip", () => {
    const result = run("check", example)
    expect(result.status).toBe(0)
    const report = JSON.parse(result.stdout) as { verdict: string; clips: Array<{ clip: string; verdict: string }>; drafts: Array<{ clip: string; draft: string; accepted?: Array<{ code: string }> }> }
    expect(report.verdict).toBe("clean")
    expect(report.clips.map((entry) => [entry.clip, entry.verdict])).toEqual(["idle", "walk", "attack", "block", "punch", "kick"].map((name) => [name, "clean"]))
    expect(report.drafts.find((d) => d.clip === "attack" && d.draft === "a")?.accepted?.map((a) => a.code)).toContain("draw-order")
  })

  it("bakes the same bytes twice: a sheet, its JSON with the rig's anchor, and a GIF", () => {
    const folder = mkdtempSync(join(tmpdir(), "rig-"))
    expect(run("bake", example, "punch", "-o", join(folder, "one")).status).toBe(0)
    expect(run("bake", example, "punch", "-o", join(folder, "two")).status).toBe(0)
    for (const file of ["punch.png", "punch.json", "punch.gif"]) expect(readFileSync(join(folder, "one", file))).toEqual(readFileSync(join(folder, "two", file)))
    const sheet = JSON.parse(readFileSync(join(folder, "one", "punch.json"), "utf8")) as { animations: Record<string, Array<string>>; frames: Record<string, { anchor: { x: number; y: number }; frame: { w: number; h: number } }>; meta: { loop: Record<string, boolean> } }
    expect(sheet.animations.punch).toHaveLength(15)
    expect(sheet.frames["punch 0"]!.frame).toMatchObject({ w: 264, h: 212 })
    expect(sheet.frames["punch 0"]!.anchor.x).toBeCloseTo(118 / 264, 4)
    expect(sheet.frames["punch 0"]!.anchor.y).toBeCloseTo(194 / 212, 4)
    expect(sheet.meta.loop).toEqual({ punch: false })
    // One sidecar for the bank, with every clip, though only the punch was baked.
    const report = JSON.parse(run("bake", example, "punch", "-o", join(folder, "three")).stdout) as { sidecar: { file: string; rewrote: Array<string>; kept: Array<string> }; clips: Array<{ clip: string; hit: { bone: string; frames: Array<number> } }> }
    expect(report.sidecar).toEqual({ file: join(folder, "three", "hero.rig.clips.json"), rewrote: ["idle", "walk", "attack", "block", "punch", "kick"], kept: [] })
    expect(report.clips).toMatchObject([{ clip: "punch", hit: { bone: "handNear", radius: 4, frames: [3, 4] } }])
    const sidecar = JSON.parse(readFileSync(report.sidecar.file, "utf8")) as { version: number; clips: Record<string, { atlas: string; frames: Array<{ name: string }> }> }
    expect(sidecar.version).toBe(1)
    expect(Object.keys(sidecar.clips)).toEqual(["idle", "walk", "attack", "block", "punch", "kick"])
    expect(sidecar.clips.punch!.frames.map((frame) => frame.name)).toEqual(Object.keys(sheet.frames))
    expect(readFileSync(join(folder, "one", "hero.rig.clips.json"))).toEqual(readFileSync(join(folder, "two", "hero.rig.clips.json")))
    // A later bake of one clip into the same folder rewrites its entry and keeps the others as they were: the file stays complete.
    const before = JSON.parse(readFileSync(report.sidecar.file, "utf8")) as { clips: Record<string, unknown> }
    const again = JSON.parse(run("bake", example, "kick", "-o", join(folder, "three")).stdout) as { sidecar: { rewrote: Array<string>; kept: Array<string> } }
    expect(again.sidecar).toMatchObject({ rewrote: ["kick"], kept: ["idle", "walk", "attack", "block", "punch"] })
    expect(JSON.parse(readFileSync(report.sidecar.file, "utf8"))).toEqual(before)
  })

  it("starts a bank, looks at it a few ways, and reads and resolves notes", () => {
    const folder = mkdtempSync(join(tmpdir(), "rig-"))
    const bank = join(folder, "game.rig.json")
    expect(run("init", bank).status).toBe(0)
    expect(run("init", bank).status).toBe(2)
    const checked = run("check", bank)
    expect(checked.status).toBe(0)
    expect(JSON.parse(checked.stdout)).toMatchObject({ verdict: "clean" })
    const look = run("look", bank, "idle", "--frames", "2-5", "--art", "--positions", "hand,head", "-o", join(folder, "look"))
    expect(look.status).toBe(0)
    const looked = JSON.parse(look.stdout) as { files: Array<string>; frames: string; joints: { a: { arm: { bend: Array<number> } } }; positions: { a: { hand: { tip: Array<unknown> } } } }
    expect(looked.frames).toBe("2-5")
    expect(looked.joints.a.arm.bend).toHaveLength(16)
    expect(looked.positions.a.hand.tip).toHaveLength(16)
    expect(existsSync(join(folder, "look", "idle.a.png"))).toBe(true)
    expect(run("look", bank, "idle", "--each", "--frames", "0-2", "-o", join(folder, "each")).status).toBe(0)
    expect(readdirSync(join(folder, "each")).sort()).toEqual(["idle.a.00.png", "idle.a.01.png", "idle.a.02.png"])
    expect(run("look", bank, "idle", "--frames", "9-40").status).toBe(2)
    expect(run("look", bank, "idle", "--positions", "tail").status).toBe(2)
    writeFileSync(reviewPath(bank), encodeReview({ clips: { idle: { status: "changes", note: "", comments: [{ draft: "a", frame: 2, x: 30, y: 40, part: "torso", text: "stiff" }] } } }))
    const ringed = JSON.parse(run("look", bank, "idle", "-o", join(folder, "look")).stdout) as { ringed: Array<{ number: number }> }
    expect(ringed.ringed).toMatchObject([{ number: 1, frame: 2 }])
    const notes = JSON.parse(run("notes", bank).stdout) as { changes: Array<{ comments: Array<{ where: string }> }> }
    expect(notes.changes[0]!.comments[0]!.where).toBe("draft a, frame 2, pixel (30, 40), on torso")
    expect(run("resolve", bank, "idle", "1", "--reply", "looser").status).toBe(0)
    expect(JSON.parse(run("look", bank, "idle", "-o", join(folder, "look")).stdout)).toMatchObject({ ringed: [] })
    expect(run("resolve", bank, "idle", "2").status).toBe(2)
  })

  it("exits 3 on a clip that does not load or keys the wrong motion, and on a broken rig", () => {
    const folder = mkdtempSync(join(tmpdir(), "rig-"))
    const bank = join(folder, "game.rig.json")
    expect(run("init", bank).status).toBe(0)
    writeFileSync(join(folder, "rig", "broken.mjs"), "export default {")
    writeFileSync(join(folder, "rig", "twice.mjs"), "export default { frames: 4, fps: 12, pose: (rig) => rig.keys([{ at: 1, bones: { torso: 1 } }, { at: 1, bones: { torso: 2 } }]) }")
    writeFileSync(bank, encodeBank({ rig: "rig/figure.mjs", clips: { idle: { drafts: { a: { file: "rig/idle.a.mjs" } } }, broken: { drafts: { a: { file: "rig/broken.mjs" } } }, twice: { drafts: { a: { file: "rig/twice.mjs" } } } } }))
    const result = run("check", bank)
    expect(result.status).toBe(3)
    const report = JSON.parse(result.stdout) as { clips: Array<{ clip: string; verdict: string }>; drafts: Array<{ issues: Array<{ code: string; message: string }> }> }
    expect(report.clips.map((entry) => [entry.clip, entry.verdict])).toEqual([["idle", "clean"], ["broken", "errors"], ["twice", "errors"]])
    expect(report.drafts[1]!.issues[0]!.message).toContain("does not load")
    expect(report.drafts[2]!.issues[0]).toEqual({ level: "error", code: "keys", message: "twice (draft a): two keys on frame 1 set bones.torso: merge them into one key" })
    mkdirSync(join(folder, "bad"))
    writeFileSync(join(folder, "bad", "rig.mjs"), "export default { size: [1, 1] }")
    writeFileSync(join(folder, "bad.rig.json"), encodeBank({ rig: "bad/rig.mjs", clips: { idle: { drafts: { a: { file: "rig/idle.a.mjs" } } } } }))
    const broken = run("check", join(folder, "bad.rig.json"))
    expect(broken.status).toBe(3)
    expect(broken.stdout).toContain("size must be [width, height]")
  })

  it("exits 2 on a clip the bank does not have, or a bank that is not one", () => {
    expect(run("check", example, "nothing").status).toBe(2)
    const folder = mkdtempSync(join(tmpdir(), "rig-"))
    writeFileSync(join(folder, "game.rig.json"), "{}")
    expect(run("check", join(folder, "game.rig.json")).status).toBe(2)
  })
}, 120_000)
