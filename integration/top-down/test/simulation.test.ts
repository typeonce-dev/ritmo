import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Session } from "@typeonce/ritmo-devtools"
import { describe, expect, it } from "vitest"

import { createTopDownSimulation } from "../simulation.ts"
import { PlayerPositionQuery } from "../queries.ts"
import { CollectedCount, Game } from "../schema.ts"
import { inputBindings } from "../types.ts"

const start = (timeline: Keyboard.Timeline<typeof inputBindings>) => {
  const simulation = createTopDownSimulation({ keyboard: Keyboard.scripted(inputBindings, timeline), hostClock: HostClock.test() })
  if (simulation._tag === "Failure") throw new Error(simulation.failure.message)
  const { runtime, setup, update } = simulation.success
  expect(runtime.tick(setup)._tag).toBe("Success")
  return { runtime, update }
}

const PlayerPosition = Game.Inspector("Test/PlayerPosition", { queries: { player: PlayerPositionQuery } }, ({ queries }) =>
  queries.player.each().map((match) => match.data.position.get()))

describe("top-down simulation", () => {
  it("runs headless and moves the player with scripted input", () => {
    const { runtime, update } = start([{ frame: 0, press: ["right"] }, { frame: 30, release: ["right"] }])
    for (let frame = 0; frame < 60; frame++) expect(runtime.tick(update)._tag).toBe("Success")
    const [position] = runtime.inspect(PlayerPosition)
    expect(position?.x).toBeCloseTo(640 + 280 * 30 / 60)
    expect(position?.y).toBe(260)
    expect(runtime.debug.dump().machines).toEqual({
      "TopDown/Facing": { current: "Right", previous: "Down" },
      "TopDown/Locomotion": { current: "Idle", previous: "Walking" }
    })
  })

  it("describes the simulation schedules without lint warnings", () => {
    const { runtime } = start([])
    const description = runtime.debug.describe()
    expect(description.schedules.map((schedule) => schedule.name)).toEqual(["setup", "update"])
    expect(description.lints.filter((lint) => lint.severity === "warning")).toEqual([])
  })
})

describe("top-down debug session", () => {
  it("walks to the first pickup and collects it", () => {
    const keyboard = Keyboard.scripted(inputBindings, [
      { frame: 0, press: ["left"] },
      { frame: 85, release: ["left"] },
      { frame: 88, press: ["interact"], release: ["interact"] }
    ])
    const hostClock = HostClock.test()
    const simulation = createTopDownSimulation({ keyboard, hostClock })
    if (simulation._tag === "Failure") throw new Error(simulation.failure.message)
    const { runtime, setup, update } = simulation.success
    const session = Session.make(runtime, { hostClock, schedules: { setup, update } })
    session.run("setup")

    const run = session.run("update", { frames: 120 })
    expect(run.data.ok).toBe(true)

    const collected = session.journal({ system: "TopDown/CollectFocusedCollectable" })
    expect(collected.data.map((line) => line.text)).toEqual([
      "resource TopDown/CollectedCount 0 -> 1",
      "resource TopDown/FocusedCollectable {current:12,label:\"Map Fragment\",distance:20.276} -> {current:null,label:null,distance:null}",
      "queued despawn",
      "applyDeferred: despawn e12"
    ])
    expect(session.journal({ resource: CollectedCount }).data).toHaveLength(1)
    expect(session.report().data.warnings).toEqual([])
  })
})
