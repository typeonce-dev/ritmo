// The town's starting world, and the headless simulation the check drives.
import type { HostClock } from "@typeonce/ritmo"
import { Clock } from "@typeonce/ritmo"
import { Gamepad, Keyboard, Touch } from "@typeonce/ritmo-browser"
import * as Random from "@typeonce/ritmo/Random"

import { Game, leftKeys, makePlayers, Mode, padBindings, Players, PlayersInput, rightKeys, step, touchButtons } from "./schema.ts"
import type { HostValue } from "./schema.ts"
import { setupSchedule, updateSchedule } from "./schedules.ts"

/** Every resource's first value, with the device the first player plays on; the same for the browser and the check. */
export const initialResources = (host: HostValue) => ({
  Time: Clock.start(step),
  Rng: Random.seed(0x7017),
  Host: host,
  Input: Players.idle({ left: Keyboard.idle(leftKeys), right: Keyboard.idle(rightKeys), pads: Gamepad.idle(padBindings), touch: Touch.idle({ buttons: touchButtons, sticks: [] }) })
} as const)

export const initialMachines = () => Game.Runtime.machines(Game.Runtime.machine(Mode, { _tag: "Exploring" }))

/**
 * The town without a page: scripted devices, the debug handle on, and the
 * two schedules. `check.ts` drives it; the browser host builds the same
 * world with live devices and the render services.
 */
export const createTownSimulation = (devices: {
  /** Arrows: p1, in from the start. */
  readonly right: Keyboard.Actions<typeof rightKeys>
  /** WASD: a key joins as p2; idle when the check plays alone. */
  readonly left?: Keyboard.Actions<typeof leftKeys>
  readonly hostClock: HostClock.HostClock
}) => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(Game.Runtime.service(PlayersInput, makePlayers({
      left: devices.left ?? Keyboard.scripted(leftKeys, []),
      right: devices.right,
      pads: Gamepad.scriptedPads(padBindings, []),
      touch: Touch.scripted({ buttons: touchButtons, sticks: [] }, [])
    }))),
    resources: initialResources("right"),
    machines: initialMachines(),
    debug: { hostClock: devices.hostClock }
  })
  if (made.ok) made.value.debug.nameSchedules({ setup: setupSchedule, update: updateSchedule })
  return made
}
