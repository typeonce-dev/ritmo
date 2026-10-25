/**
 * The prototype without a browser: `makeSimulation` over scripted (or live)
 * keyboard input, `makeReplaySimulation` over a replay's or the fuzzer's
 * input, both with one tuning variant.
 */
import { HostClock } from "@typeonce/ritmo"
import type { InputCapture } from "@typeonce/ritmo-browser"
import type { Keyboard } from "@typeonce/ritmo-browser"
import type { Replay } from "@typeonce/ritmo-devtools"
import { Fuzz } from "@typeonce/ritmo-devtools"

import { Actions, ControlsInput, Game, idleDevices, keyboardBindings, makeControls, Tuning } from "./schema.ts"
import { setup, update } from "./systems.ts"
import type { Tuning as TuningValue } from "./tuning.ts"

const makeRuntime = (controls: InputCapture.SourceOf<ReturnType<typeof makeControls>>, tuning: TuningValue, hostClock: HostClock.HostClock) => {
  const runtime = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(ControlsInput, controls), Game.Runtime.service(Tuning, tuning)),
    resources: { InputState: Actions.idle(idleDevices) },
    debug: { hostClock }
  }).value
  return { runtime, setup, update }
}

export const makeSimulation = (options: { readonly keyboard: Keyboard.Actions<typeof keyboardBindings>; readonly tuning: TuningValue; readonly hostClock: HostClock.HostClock }) =>
  makeRuntime(makeControls(options.keyboard), options.tuning, options.hostClock)

/** The same game for `Fuzz.run` and `Replay.session`, under the schedule names they use. */
export const makeReplaySimulation = (tuning: TuningValue) => (playback: Replay.Playback) => {
  const hostClock = HostClock.test()
  const { runtime } = makeRuntime(playback.source(ControlsInput), tuning, hostClock)
  return { runtime, schedules: { setup, update }, hostClock }
}

export const FuzzedControls = Fuzz.input(ControlsInput, {
  generate: (random) => Actions.random(random, idleDevices),
  neutral: Actions.idle(idleDevices)
})
