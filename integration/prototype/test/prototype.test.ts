import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Fuzz, Session } from "@typeonce/ritmo-devtools"
import { describe, expect, it } from "vitest"

import { invariants } from "../invariants.ts"
import { DashCooldown, Game, keyboardBindings, Player, Velocity } from "../schema.ts"
import { FuzzedControls, makeReplaySimulation, makeSimulation } from "../simulation.ts"
import { variants } from "../tuning.ts"

const Dash = Game.Inspector("Test/Dash", {
  queries: { player: Game.Query({ selection: { velocity: Game.Query.read(Velocity), cooldown: Game.Query.read(DashCooldown) }, with: [Player] }) }
}, ({ queries }) => queries.player.each().map(({ data }) => ({ vx: data.velocity.get().x, cooldown: data.cooldown.get() }))[0])

describe("prototype play script", () => {
  it("runs both tiers and prints the readout and the fuzz result", () => {
    const output = execFileSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../play.ts", import.meta.url)), "fuzz"], { encoding: "utf8" })
    expect(output).toContain("frame 30 [{")
    expect(output).toContain("3 runs of 3000 frames from seed 1: no invariant broke")
  })

  it("is the script the ritmo-prototype skill's references/play.ts gives games to copy", () => {
    const reference = readFileSync(new URL("../../../packages/core/skills/ritmo-prototype/references/play.ts", import.meta.url), "utf8")
    expect(reference).toBe(readFileSync(new URL("../play.ts", import.meta.url), "utf8"))
  })
})

// What graduation turns the play script's readout into: the same scripted input, asserted.
describe("dash", () => {
  const start = (timeline: Keyboard.Timeline<typeof keyboardBindings>) => {
    const hostClock = HostClock.test()
    const { runtime, setup, update } = makeSimulation({ keyboard: Keyboard.scripted(keyboardBindings, timeline), tuning: variants.snappy, hostClock })
    const session = Session.make(runtime, { hostClock, schedules: { setup, update }, invariants })
    expect(session.run("setup").data.ok).toBe(true)
    return { runtime, session }
  }

  it("bursts to the dash speed on a tap and refuses a second dash during the cooldown", () => {
    const { runtime, session } = start([
      { frame: 0, press: ["move.right"] },
      { frame: 20, press: ["dash"], release: ["dash"] },
      { frame: 25, press: ["dash"], release: ["dash"] }
    ])
    expect(session.run("update", { frames: 21 }).data.ok).toBe(true)
    expect(runtime.inspect(Dash)).toEqual({ vx: variants.snappy.dashSpeed, cooldown: variants.snappy.dashCooldownTicks })
    expect(session.run("update", { frames: 5 }).data.ok).toBe(true)
    expect(runtime.inspect(Dash)?.vx).toBeLessThan(variants.snappy.dashSpeed)
    expect(runtime.inspect(Dash)?.cooldown).toBe(variants.snappy.dashCooldownTicks - 5)
  })

  it("holds its invariants under fuzzed input in every variant", () => {
    for (const tuning of Object.values(variants)) {
      const found = Fuzz.run(makeReplaySimulation(tuning), { schedule: "update", setup: "setup", inputs: [FuzzedControls], invariants, frames: 1000, runs: 2, seed: 1 })
      expect(found.ok).toBe(true)
    }
  })
})
