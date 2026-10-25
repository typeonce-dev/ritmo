import { pickupLayout } from "./content.ts"
import { Facing, Game, Locomotion } from "./schema.ts"
import { Actions, idleDevices } from "./types.ts"
import type { FrameContextValue } from "./types.ts"

export const makeEmptyFocusedCollectable = () => ({
  current: null,
  label: null,
  distance: null
} as const)

export const initialResources = (frame: FrameContextValue) => ({
  DeltaTime: frame.deltaSeconds,
  InputState: Actions.idle(idleDevices),
  FocusedCollectable: makeEmptyFocusedCollectable(),
  CollectedCount: 0,
  TotalCollectables: pickupLayout.length
} as const)

export const initialMachines = () =>
  Game.Runtime.machines(
    Game.Runtime.machine(Facing, { _tag: "Down" }),
    Game.Runtime.machine(Locomotion, { _tag: "Idle" })
  )
