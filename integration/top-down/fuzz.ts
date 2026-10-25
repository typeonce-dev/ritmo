/**
 * The top-down game's controls, fuzzed: the same input descriptor the page
 * and the replays read, given a value drawn from the run's seeded generator
 * every frame. Buttons take the states a merge reports and the move vector
 * stays within length 1, as the real devices do.
 *
 * ```ts
 * const found = Fuzz.run(makeReplaySimulation, { schedule: "update", setup: "setup", inputs: [FuzzedControls], invariants: [PlayerInsideWorld], frames: 300, seed: 1 })
 * ```
 */
import { Fuzz } from "@typeonce/ritmo-devtools"

import { ControlsInput } from "./schema.ts"
import { Actions, idleDevices } from "./types.ts"

export const FuzzedControls = Fuzz.input(ControlsInput, {
  generate: (random) => Actions.random(random, idleDevices),
  neutral: Actions.idle(idleDevices)
})
