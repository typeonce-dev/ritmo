import { Fuzz, Invariant, Replay } from "@typeonce/ritmo-devtools"
import { describe, expect, it } from "vitest"

import { FuzzedControls } from "../fuzz.ts"
import { CollectedAtMostTotal, PlayerInsideWorld } from "../invariants.ts"
import { PlayerPositionQuery } from "../queries.ts"
import { ControlsInput, Game } from "../schema.ts"
import { makeReplaySimulation } from "../simulation.ts"
import type { InputStateValue } from "../types.ts"

/** A planted rule the game does not keep: the player never walks left of where it starts. */
const NeverLeftOfStart = Invariant.fromInspector(Game.Inspector("never left of start", { queries: { player: PlayerPositionQuery } }, ({ queries }) => {
  const [player] = queries.player.each()
  const position = player?.data.position.get()
  return position === undefined || position.x >= 640 ? undefined : `player at x ${position.x}`
}))

const controlsOf = (file: Replay.ReplayFile): ReadonlyArray<InputStateValue> =>
  file.ticks.flatMap((record) => (record.services?.[ControlsInput.name] ?? []) as ReadonlyArray<InputStateValue>)

describe("top-down fuzzing", () => {
  it("drives the real game through its merged controls, and no invariant breaks", () => {
    const passed = Fuzz.run(makeReplaySimulation, {
      schedule: "update", setup: "setup", inputs: [FuzzedControls], invariants: [PlayerInsideWorld, CollectedAtMostTotal], frames: 300, runs: 3, seed: 1
    })
    expect(passed).toMatchObject({ ok: true, value: { data: { runs: 3, frames: 300, seed: 1 } } })
  })

  it("finds a broken rule, shrinks it to one step, and the replay reproduces it", () => {
    const found = Fuzz.run(makeReplaySimulation, { schedule: "update", setup: "setup", inputs: [FuzzedControls], invariants: [NeverLeftOfStart], frames: 120, seed: 3 })
    if (found.ok || found.error._tag !== "Found") throw new Error(JSON.stringify(found))
    expect(found.error.violation).toMatchObject({ _tag: "InvariantViolated", invariant: "never left of start" })
    expect(found.error.reproduces).toBe(true)
    // One frame walking left is enough; everything else shrank to the idle input.
    expect(found.error.frame).toBe(1)
    const [input] = controlsOf(found.error.replay)
    expect(input?.vectors.move.x).toBeLessThan(0)
    expect(input?.actions.interact).toEqual({ held: false, pressed: false, released: false })

    const opened = Replay.session(makeReplaySimulation, found.error.replay, { invariants: [NeverLeftOfStart] })
    if (!opened.ok) throw new Error(JSON.stringify(opened.error))
    expect(opened.value.play().data.run.stop).toMatchObject({ reason: "invariant", invariant: "never left of start" })
  })

  it("generates input the devices could report: vectors within length 1, button states a merge reports", () => {
    const found = Fuzz.run(makeReplaySimulation, { schedule: "update", setup: "setup", inputs: [FuzzedControls], invariants: [NeverLeftOfStart], frames: 120, seed: 3, shrinkAttempts: 0 })
    if (found.ok || found.error._tag !== "Found") throw new Error(JSON.stringify(found))
    const inputs = controlsOf(found.error.replay)
    expect(inputs.length).toBeGreaterThan(0)
    for (const input of inputs) {
      const { x, y } = input.vectors.move
      expect(Math.sqrt(x * x + y * y)).toBeLessThanOrEqual(1 + 1e-9)
      const { held, released } = input.actions.interact
      expect(held && released).toBe(false)
    }
  })
})
