/**
 * The top-down game without a browser: the simulation schedules on a
 * runtime that needs only a keyboard, a mouse, a gamepad, and a frame context, with
 * the debug handle attached. `makeReplaySimulation` builds the same runtime
 * over a replay's (or the fuzzer's) input instead of devices.
 *
 * Tests, benchmarks, and coding agents drive it directly:
 *
 * ```ts
 * const keyboard = Keyboard.scripted(inputBindings, [{ frame: 0, press: ["move.right"] }])
 * const mouse = Pointer.scripted(mouseBindings, [])
 * const gamepad = Gamepad.scripted(padBindings, [])
 * const simulation = createTopDownSimulation({ keyboard, mouse, gamepad, hostClock: HostClock.test() })
 * if (simulation.ok) {
 *   simulation.value.runtime.tick(simulation.value.setup)
 *   simulation.value.runtime.tick(simulation.value.update)
 * }
 * ```
 */
import { HostClock } from "@typeonce/ritmo"
import * as Result from "@typeonce/ritmo/Result"
import type { InputCapture } from "@typeonce/ritmo-browser"
import type { Replay } from "@typeonce/ritmo-devtools"

import { FIXED_STEP_SECONDS } from "./constants.ts"
import { initialMachines, initialResources } from "./runtime.ts"
import { ControlsInput, FrameContext, Game } from "./schema.ts"
import { setupWorldSchedule, simulationSchedule } from "./schedules.ts"
import { makeControls } from "./types.ts"
import type { ControlsValue, FrameContextValue, GamepadInput as GamepadInputValue, KeyboardInput as KeyboardInputValue, MouseInput as MouseInputValue } from "./types.ts"

export interface TopDownSimulationOptions {
  readonly keyboard: KeyboardInputValue
  /** `Pointer.actions(canvas, window, mouseBindings)` in a browser, `Pointer.scripted(mouseBindings, timeline)` headless. */
  readonly mouse: MouseInputValue
  /** `Gamepad.actions(window, padBindings)` in a browser, `Gamepad.scripted(padBindings, timeline)` headless. */
  readonly gamepad: GamepadInputValue
  /** Times the debug traces; `HostClock.test()` keeps every timing at 0. Pass the same clock to `Session.make`. */
  readonly hostClock: HostClock.HostClock
  /** Defaults to one fixed step at 60 Hz. */
  readonly frame?: FrameContextValue
}

export const defaultFrameContext: FrameContextValue = {
  deltaSeconds: FIXED_STEP_SECONDS
}

/** The runtime over one input source: merged devices, live or scripted, or a replay's or the fuzzer's input. */
const makeRuntime = (controls: InputCapture.SourceOf<ControlsValue>, hostClock: HostClock.HostClock, frame: FrameContextValue) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(
      Game.Runtime.service(ControlsInput, controls),
      Game.Runtime.service(FrameContext, frame)
    ),
    resources: initialResources(frame),
    machines: initialMachines(),
    debug: { hostClock }
  })
  return Result.match(made, {
    onSuccess: (runtime) => {
      runtime.debug.nameSchedules({ setup: setupWorldSchedule, update: simulationSchedule })
      return Result.success({ runtime, setup: setupWorldSchedule, update: simulationSchedule })
    },
    onFailure: () => Result.failure({ message: "Invalid top-down runtime resources." })
  })
}

export const createTopDownSimulation = (options: TopDownSimulationOptions) =>
  makeRuntime(
    makeControls({ keyboard: options.keyboard, mouse: options.mouse, gamepad: options.gamepad }),
    options.hostClock,
    options.frame ?? defaultFrameContext
  )

/**
 * The same game over a replay's input, for `Replay.session` and `Fuzz.run`:
 * the recorded (or fuzzed) controls snapshots stand in for the devices, and
 * the setup and update schedules are named as the recorder and the fuzzer
 * name them.
 *
 * ```ts
 * const replay = Replay.session(makeReplaySimulation, file, { invariants: [PlayerInsideWorld] })
 * const found = Fuzz.run(makeReplaySimulation, { schedule: "update", setup: "setup", inputs: [FuzzedControls], frames: 300, seed: 1 })
 * ```
 */
export const makeReplaySimulation = (playback: Replay.Playback) => {
  const hostClock = HostClock.test()
  const made = makeRuntime(playback.source(ControlsInput), hostClock, defaultFrameContext)
  if (!made.ok) throw new Error(made.error.message)
  return { runtime: made.value.runtime, schedules: { setup: setupWorldSchedule, update: simulationSchedule }, hostClock }
}
