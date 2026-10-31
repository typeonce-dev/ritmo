import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

import { decodeClips, type Clips } from "../clips.ts"
import { makeBrawl } from "../simulation.ts"

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url))
const tools = dirname(createRequire(import.meta.url).resolve("@typeonce/ritmo-tools/package.json"))

const decoded = decodeClips(JSON.parse(readFileSync(join(fixtures, "hero.rig.clips.json"), "utf8")))
if (!decoded.ok) throw new Error(decoded.error.map((issue) => issue.message).join("; "))
const clips: Clips = decoded.value
const attack = clips.clips.attack!
/** The swing: the attack's fast phase, as the sidecar names it. */
const swing = attack.phases.find((phase) => phase.fast)!

/** Plays the attack with the target at `target`, through the whole clip and a little after. */
const brawl = (target: { readonly x: number; readonly y: number }) => {
  const game = makeBrawl({ clips, attacker: { x: 100, y: 300 }, target })
  expect(game.play("attack").ok).toBe(true)
  const seen: Array<ReturnType<typeof game.read>> = []
  for (let i = 0; i < 90; i++) {
    expect(game.step().ok).toBe(true)
    seen.push(game.read())
  }
  return seen
}

describe("a brawl driven by a baked clip", () => {
  it("lands the swing's hit once, on the last frame of the swing (the strike), from the sidecar's phases", () => {
    // Arm's length in front of the attacker, at chest height: only the strike's blade reaches it.
    const seen = brawl({ x: 205, y: 230 })
    const hits = seen[seen.length - 1]!.hits
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ clip: "attack", frame: swing.to })
    // The sidecar has a hit segment on that frame, and the frame came from the clock: 24 fps on a 60 Hz step.
    expect(attack.frames[swing.to]!.hit).not.toBeNull()
    expect(hits[0]!.step).toBe(1 + Math.ceil((swing.to * 60) / attack.fps))
    // The clip plays to its end and stops.
    expect(seen[seen.length - 1]!.animation.clip).toBeNull()
  })

  it("lands no hit when the target is out of reach", () => {
    const seen = brawl({ x: 400, y: 230 })
    expect(seen[seen.length - 1]!.hits).toEqual([])
  })

  it("hits only on the frames the sidecar gives a segment for", () => {
    const framed = attack.frames.flatMap((frame, f) => (frame.hit === null ? [] : [f]))
    expect(framed).toEqual(Array.from({ length: swing.to - swing.from + 1 }, (_, i) => swing.from + i))
  })

  it("rejects a sidecar that is not one, naming the field", () => {
    const broken = decodeClips({ version: 1, scale: 1, clips: { attack: { fps: 24, loop: false, phases: [], frames: [{ name: "attack 0", hit: { from: [0], to: [1, 1] } }] } } })
    expect(broken.ok === false && broken.error[0]!.message).toBe("clips.attack.frames[0].hit.from: expected a point [x, y]")
    expect(decodeClips({ version: 2, scale: 1, clips: {} }).ok).toBe(false)
  })

  it("plays the clips as the example bank bakes them today: the fixtures match a fresh bake byte for byte", () => {
    const out = mkdtempSync(join(tmpdir(), "brawler-"))
    const baked = spawnSync(process.execPath, [join(tools, "bin", "ritmo-tools.mjs"), "rig", "bake", join(tools, "examples", "rig", "hero.rig.json"), "attack", "-o", out], { encoding: "utf8" })
    expect(baked.status).toBe(0)
    for (const file of ["hero.rig.clips.json", "attack.json"]) expect(readFileSync(join(out, file), "utf8")).toBe(readFileSync(join(fixtures, file), "utf8"))
  }, 60_000)
})
