import { HostClock } from "@typeonce/ritmo"
import { Gamepad, Keyboard, Pointer } from "@typeonce/ritmo-browser"
import { Session } from "@typeonce/ritmo-devtools"
import { describe, expect, it } from "vitest"

import { createTopDownSimulation } from "../simulation.ts"
import { PlayerPositionQuery } from "../queries.ts"
import { CollectedCount, Game, InputState } from "../schema.ts"
import { inputBindings, mouseBindings, padBindings } from "../types.ts"

const start = (timeline: Keyboard.Timeline<typeof inputBindings>, pad: Gamepad.Timeline = [], clicks: Pointer.Timeline = []) => {
  const simulation = createTopDownSimulation({
    keyboard: Keyboard.scripted(inputBindings, timeline),
    mouse: Pointer.scripted(mouseBindings, clicks),
    gamepad: Gamepad.scripted(padBindings, pad),
    hostClock: HostClock.test()
  })
  if (!simulation.ok) throw new Error(simulation.error.message)
  const { runtime, setup, update } = simulation.value
  expect(runtime.tick(setup).ok).toBe(true)
  return { runtime, update }
}

const PlayerPosition = Game.Inspector("Test/PlayerPosition", { queries: { player: PlayerPositionQuery } }, ({ queries }) =>
  queries.player.each().map((entity) => queries.player.data.position.get(entity)))

const LastUsed = Game.Inspector("Test/LastUsed", { resources: { input: Game.System.readResource(InputState) } }, ({ resources }) =>
  resources.input.get().lastUsed)

const Collected = Game.Inspector("Test/Collected", { resources: { count: Game.System.readResource(CollectedCount) } }, ({ resources }) =>
  resources.count.get())

describe("top-down simulation", () => {
  it("runs headless and moves the player with scripted input", () => {
    const { runtime, update } = start([{ frame: 0, press: ["move.right"] }, { frame: 30, release: ["move.right"] }])
    for (let frame = 0; frame < 60; frame++) expect(runtime.tick(update).ok).toBe(true)
    const [position] = runtime.inspect(PlayerPosition)
    expect(position?.x).toBeCloseTo(640 + 280 * 30 / 60)
    expect(position?.y).toBe(260)
    expect(runtime.debug.dump().machines).toEqual({
      "TopDown/Facing": { current: { _tag: "Right" }, previous: { _tag: "Down" } },
      "TopDown/Locomotion": { current: { _tag: "Idle" }, previous: { _tag: "Walking" } }
    })
  })

  it("walks diagonally at the same speed as straight", () => {
    const { runtime, update } = start([{ frame: 0, press: ["move.right", "move.down"] }, { frame: 30, release: ["move.right", "move.down"] }])
    for (let frame = 0; frame < 60; frame++) expect(runtime.tick(update).ok).toBe(true)
    const [position] = runtime.inspect(PlayerPosition)
    // Each axis moves 1/√2 of the straight distance (down ends at a wall, so x tells it).
    expect((position?.x ?? 0) - 640).toBeCloseTo(280 * 30 / 60 * Math.SQRT1_2)
  })

  it("moves the player with the left stick, at its analog length", () => {
    const { runtime, update } = start([], [{ frame: 0, left: { x: 0.5, y: 0 } }, { frame: 30, left: { x: 0, y: 0 } }])
    for (let frame = 0; frame < 60; frame++) expect(runtime.tick(update).ok).toBe(true)
    const [position] = runtime.inspect(PlayerPosition)
    expect(position?.x).toBeCloseTo(640 + 0.5 * 280 * 30 / 60)
    expect(position?.y).toBe(260)
  })

  it("moves the player with the d-pad like the arrow keys", () => {
    const { runtime, update } = start([], [{ frame: 0, press: ["dpadRight"] }, { frame: 30, release: ["dpadRight"] }])
    for (let frame = 0; frame < 60; frame++) expect(runtime.tick(update).ok).toBe(true)
    const [position] = runtime.inspect(PlayerPosition)
    expect(position?.x).toBeCloseTo(640 + 280 * 30 / 60)
  })

  it("collects a pickup with the south button", () => {
    const { runtime, update } = start([], [
      { frame: 0, press: ["dpadLeft"] },
      { frame: 85, release: ["dpadLeft"] },
      { frame: 88, press: ["south"], release: ["south"] }
    ])
    for (let frame = 0; frame < 120; frame++) expect(runtime.tick(update).ok).toBe(true)
    expect(runtime.inspect(Collected)).toBe(1)
  })

  it("collects a pickup with a click while walking, keyboard and mouse as one device", () => {
    const { runtime, update } = start(
      [{ frame: 0, press: ["move.left"] }, { frame: 85, release: ["move.left"] }],
      [],
      [{ frame: 40, move: { x: 100, y: 100 } }, { frame: 88, press: ["primary"], release: ["primary"] }]
    )
    const lastUsed = new Set<string | null>()
    for (let frame = 0; frame < 120; frame++) {
      expect(runtime.tick(update).ok).toBe(true)
      lastUsed.add(runtime.inspect(LastUsed))
    }
    expect(runtime.inspect(Collected)).toBe(1)
    expect([...lastUsed]).toEqual(["desktop"])
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
      { frame: 0, press: ["move.left"] },
      { frame: 85, release: ["move.left"] },
      { frame: 88, press: ["interact"], release: ["interact"] }
    ])
    const hostClock = HostClock.test()
    const simulation = createTopDownSimulation({ keyboard, mouse: Pointer.scripted(mouseBindings, []), gamepad: Gamepad.scripted(padBindings, []), hostClock })
    if (!simulation.ok) throw new Error(simulation.error.message)
    const { runtime, setup, update } = simulation.value
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
