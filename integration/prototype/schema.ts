/**
 * A dash toy: the prototype the `ritmo-prototype` skill's play script runs
 * against. One player walks with the move vector and dashes on a tap; no
 * goal yet, as the skill's first iteration has none.
 */
import { Clock, Descriptor, Schema } from "@typeonce/ritmo"
import { Controls, InputCapture, Keyboard } from "@typeonce/ritmo-browser"
import { z } from "zod"

import type { Tuning as TuningValue } from "./tuning.ts"

export const ARENA = { width: 800, height: 450 } as const
export const STEP = Clock.hz(60)

export const Actions = Controls.actions({ buttons: ["dash"], vectors: ["move"] })
export const keyboardBindings = {
  move: Keyboard.vector({ up: ["ArrowUp", "w"], down: ["ArrowDown", "s"], left: ["ArrowLeft", "a"], right: ["ArrowRight", "d"] }),
  dash: [" "]
} as const
/** The one input source, built the same way in the browser and in the play script. */
export const makeControls = (keyboard: Keyboard.Actions<typeof keyboardBindings>) => Actions.merge({ keyboard })
export const idleDevices = { keyboard: Keyboard.idle(keyboardBindings) }

export const Root = Schema.defineRoot("Prototype")

const vector = z.object({ x: z.number(), y: z.number() })
// Constructed from a schema, so the world after setup can be saved and the fuzzer can replay from it.
export const Position = Descriptor.ConstructedComponent(vector)("Prototype/Position")
export const Velocity = Descriptor.ConstructedComponent(vector)("Prototype/Velocity")
export const DashCooldown = Descriptor.ConstructedComponent(z.int().nonnegative())("Prototype/DashCooldown")
export const Player = Descriptor.Tag("Prototype/Player")

export const ControlsInput = Descriptor.Service<InputCapture.SourceOf<ReturnType<typeof makeControls>>>()("Prototype/Controls")
export const InputState = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof ControlsInput>>()("Prototype/InputState")
export const Tuning = Descriptor.Service<TuningValue>()("Prototype/Tuning")

export const Game = Schema.bind(
  Schema.fragment({
    components: { Position, Velocity, DashCooldown, Player },
    requires: [Schema.requires(Player, Position, Velocity, DashCooldown)],
    resources: { InputState }
  }),
  Root
)
