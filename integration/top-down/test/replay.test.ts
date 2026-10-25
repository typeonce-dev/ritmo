import { Clock, HostClock } from "@typeonce/ritmo"
import { Gamepad, Keyboard, Pointer } from "@typeonce/ritmo-browser"
import { Replay, Verify } from "@typeonce/ritmo-devtools"
import { describe, expect, it } from "vitest"

import { CollectedAtMostTotal, PlayerInsideWorld } from "../invariants.ts"
import { CollectedCount, ControlsInput, Game } from "../schema.ts"
import { createTopDownSimulation, makeReplaySimulation } from "../simulation.ts"
import { inputBindings, mouseBindings, padBindings } from "../types.ts"

const Collected = Game.Inspector("Test/Collected", { resources: { count: Game.System.readResource(CollectedCount) } }, ({ resources }) =>
  resources.count.get())

/** Plays the scripted devices live, recording the update schedule, and saves the replay. */
const recordLive = () => {
  const simulation = createTopDownSimulation({
    // Walks with the keyboard, then picks up with the gamepad: lastUsed changes in the recording.
    keyboard: Keyboard.scripted(inputBindings, [{ frame: 0, press: ["move.left"] }, { frame: 85, release: ["move.left"] }]),
    mouse: Pointer.scripted(mouseBindings, []),
    gamepad: Gamepad.scripted(padBindings, [{ frame: 88, press: ["south"], release: ["south"] }]),
    hostClock: HostClock.test()
  })
  if (!simulation.ok) throw new Error(simulation.error.message)
  const { runtime, setup, update } = simulation.value
  expect(runtime.tick(setup).ok).toBe(true)
  const recorder = Replay.recorder(runtime, {
    schedule: update, name: "update", keep: 10, step: Clock.hz(60), sink: Replay.memorySink(), hostClock: HostClock.test()
  })
  for (let frame = 0; frame < 140; frame++) expect(runtime.tick(update).ok).toBe(true)
  const file = recorder.save("walked and collected")
  recorder.stop()
  return { runtime, file }
}

describe("top-down replays", () => {
  it("records the merged controls and replays them to the same world without devices", () => {
    const { runtime, file } = recordLive()
    expect(runtime.inspect(Collected)).toBe(1)
    // The merged snapshot is what the recorder saved for the one input service.
    expect(Object.keys(file.ticks[0]?.services ?? {})).toEqual([ControlsInput.name])

    // Through JSON, as a saved file is opened.
    const parsed = Replay.parse(JSON.parse(JSON.stringify(file)))
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error))
    const opened = Replay.session(makeReplaySimulation, parsed.value, { invariants: [PlayerInsideWorld, CollectedAtMostTotal] })
    if (!opened.ok) throw new Error(JSON.stringify(opened.error))
    const played = opened.value.play()
    expect(played.data.run.stop).toEqual({ reason: "completed" })
    expect(played.data.diverged).toEqual([])
    // The replayed world is the live one: the player where it walked, the pickup collected.
    const replayed = opened.value.snapshot()
    const live = runtime.snapshot()
    if (!replayed.ok || !live.ok) throw new Error("snapshot")
    expect(replayed.value).toEqual(live.value)
    expect(replayed.value.resources[CollectedCount.name]).toBe(1)
  })

  it("replays deterministically: twice the same here, and the same as the recording", async () => {
    const { file } = recordLive()
    expect(await Verify.acrossEngines(makeReplaySimulation, file)).toMatchObject({ ok: true, value: { data: { engines: ["node"] } } })
  })
})
