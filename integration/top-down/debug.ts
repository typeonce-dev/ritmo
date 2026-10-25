/**
 * A headless debug run of the top-down simulation, and a template for
 * debugging scripts.
 *
 *   node --import tsx integration/top-down/debug.ts
 *
 * It scripts keyboard input, runs the simulation with a devtools session,
 * checks an invariant after every frame, and prints what an agent or a
 * developer usually needs first: the run result, the report, the latest
 * changes to the player's position, and the world dump. Copy it and change
 * the timeline, the invariants, and the questions.
 */
import { HostClock } from "@typeonce/ritmo"
import { Gamepad, Keyboard, Pointer } from "@typeonce/ritmo-browser"
import { Session } from "@typeonce/ritmo-devtools"

import { PlayerInsideWorld } from "./invariants.ts"
import { Player, Position } from "./schema.ts"
import { createTopDownSimulation } from "./simulation.ts"
import { inputBindings, mouseBindings, padBindings } from "./types.ts"

// Frame 0 is the first update. Press and release are applied before that
// frame's input capture; a press and release in one frame is a tap.
const keyboard = Keyboard.scripted(inputBindings, [
  { frame: 0, press: ["move.up", "move.left"] },
  { frame: 40, release: ["move.up"] },
  { frame: 50, press: ["interact"], release: ["interact"] }
])

// A test clock keeps every timing at 0, so the output is the same on every run.
const hostClock = HostClock.test()
// No controller in this run; script one the same way, by button names.
const gamepad = Gamepad.scripted(padBindings, [])
const mouse = Pointer.scripted(mouseBindings, [])
const simulation = createTopDownSimulation({ keyboard, mouse, gamepad, hostClock })
if (!simulation.ok) throw new Error(simulation.error.message)
const { runtime, setup, update } = simulation.value

// Invariants live in invariants.ts, shared with the replay and fuzz tests.
const session = Session.make(runtime, { hostClock, schedules: { setup, update }, invariants: [PlayerInsideWorld] })

console.log(session.run("setup"))
console.log(session.run("update", { frames: 120 }))
console.log()
console.log(session.report())
console.log()
console.log(session.why(1, Position))
console.log()
console.log(session.dump({ with: [Player] }))
