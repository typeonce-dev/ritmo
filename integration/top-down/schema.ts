import { Descriptor, Entity, Schema } from "@typeonce/ritmo"
import type { InputCapture } from "@typeonce/ritmo-browser"

import { finite, guard, integer, nonNegative, nullable, string, struct } from "./codecs.ts"
import type { ControlsValue, FrameContextValue } from "./types.ts"

export const Root = Schema.defineRoot("TopDown")

const vector = struct({ x: finite, y: finite })

export const Position = Descriptor.ConstructedComponent(vector)("TopDown/Position")
export const Velocity = Descriptor.ConstructedComponent(vector)("TopDown/Velocity")
export const Collider = Descriptor.ConstructedComponent(struct({ width: nonNegative, height: nonNegative }))("TopDown/Collider")
// Every saved component and resource is constructed from a schema, so the
// world can be saved and a replay can start from it.
export const Player = Descriptor.ConstructedComponent(struct({}))("TopDown/Player")
export const Wall = Descriptor.ConstructedComponent(struct({}))("TopDown/Wall")
export const Collectable = Descriptor.ConstructedComponent(struct({ label: string, radius: finite }))("TopDown/Collectable")

export type FocusedCollectableValue = {
  readonly current: Entity.Handle<typeof Root, typeof Collectable> | null
  readonly label: string | null
  readonly distance: number | null
}

export const DeltaTime = Descriptor.ConstructedResource(finite)("TopDown/DeltaTime")
export const FocusedCollectable = Descriptor.ConstructedResource(struct({
  current: nullable(guard("a collectable handle", Entity.isHandle(Root, Collectable))),
  label: nullable(string),
  distance: nullable(finite)
}))("TopDown/FocusedCollectable")
export const CollectedCount = Descriptor.ConstructedResource(integer)("TopDown/CollectedCount")
export const TotalCollectables = Descriptor.ConstructedResource(integer)("TopDown/TotalCollectables")

/**
 * The keyboard, mouse, and gamepad merged into one input source, declared
 * as its snapshot() only: the page provides the live merge, tests a merge
 * of scripted devices, a replay its recorded input, and the fuzzer its
 * generated input.
 */
export const ControlsInput = Descriptor.Service<InputCapture.SourceOf<ControlsValue>>()("TopDown/Controls")
// Captured from the controls at the start of each update; never saved. Its type is exactly what the source produces.
export const InputState = Descriptor.TransientResource<InputCapture.SnapshotOf<typeof ControlsInput>>()("TopDown/InputState")
export const FrameContext = Descriptor.Service<FrameContextValue>()("TopDown/FrameContext")

export const Game = Schema.bind(
  Schema.fragment({
    components: {
      Position,
      Velocity,
      Collider,
      Player,
      Wall,
      Collectable
    },
    // What each kind of entity always has: spawning a player without a
    // collider does not compile, and Game.System.spawns(Player) allows them.
    requires: [
      Schema.requires(Player, Position, Velocity, Collider),
      Schema.requires(Wall, Position, Collider),
      Schema.requires(Collectable, Position, Collider)
    ],
    resources: {
      DeltaTime,
      InputState,
      FocusedCollectable,
      CollectedCount,
      TotalCollectables
    }
  }),
  Root
)

export const schema = Game.schema

export const Facing = Game.StateMachine("TopDown/Facing", { Down: {}, Left: {}, Right: {}, Up: {} }
)

export const Locomotion = Game.StateMachine("TopDown/Locomotion", { Idle: {}, Walking: {} }
)
