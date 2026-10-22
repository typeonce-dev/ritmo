/**
 * The top-down game without a browser: the simulation schedules on a
 * runtime that needs only a keyboard and a frame context, with the debug
 * handle attached.
 *
 * Tests, benchmarks, and coding agents drive it directly:
 *
 * ```ts
 * const keyboard = Keyboard.scripted(inputBindings, [{ frame: 0, press: ["right"] }])
 * const simulation = createTopDownSimulation({ keyboard, hostClock: HostClock.test() })
 * if (simulation._tag === "Success") {
 *   simulation.success.runtime.tick(simulation.success.setup)
 *   simulation.success.runtime.tick(simulation.success.update)
 * }
 * ```
 */
import type { HostClock } from "@typeonce/ritmo"
import * as Result from "@typeonce/ritmo/Result"

import { FIXED_STEP_SECONDS } from "./constants.ts"
import { initialMachines, initialResources } from "./runtime.ts"
import { FrameContext, Game, KeyboardInput } from "./schema.ts"
import { setupWorldSchedule, simulationSchedule } from "./schedules.ts"
import type { FrameContextValue, KeyboardInput as KeyboardInputValue } from "./types.ts"

export interface TopDownSimulationOptions {
  readonly keyboard: KeyboardInputValue
  /** Times the debug traces; `HostClock.test()` keeps every timing at 0. Pass the same clock to `Session.make`. */
  readonly hostClock: HostClock.HostClock
  /** Defaults to one fixed step at 60 Hz. */
  readonly frame?: FrameContextValue
}

export const defaultFrameContext: FrameContextValue = {
  deltaSeconds: FIXED_STEP_SECONDS
}

export const createTopDownSimulation = (options: TopDownSimulationOptions) => {
  const frame = options.frame ?? defaultFrameContext
  const made = Game.Runtime.make({
    services: Game.Runtime.services(
      Game.Runtime.service(KeyboardInput, options.keyboard),
      Game.Runtime.service(FrameContext, frame)
    ),
    resources: initialResources(frame),
    machines: initialMachines(),
    debug: { hostClock: options.hostClock }
  })
  return Result.match(made, {
    onSuccess: (runtime) => {
      runtime.debug.nameSchedules({ setup: setupWorldSchedule, update: simulationSchedule })
      return Result.succeed({ runtime, setup: setupWorldSchedule, update: simulationSchedule })
    },
    onFailure: () => Result.fail({ message: "Invalid top-down runtime resources." })
  })
}
