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
import { Keyboard } from "@typeonce/ritmo-browser"
import { Invariant, Session } from "@typeonce/ritmo-devtools"

import { WORLD_HEIGHT, WORLD_WIDTH } from "./constants.ts"
import { PlayerPositionQuery } from "./queries.ts"
import { Game, Player, Position } from "./schema.ts"
import { createTopDownSimulation } from "./simulation.ts"
import { inputBindings } from "./types.ts"

// Frame 0 is the first update. Press and release are applied before that
// frame's input capture; a press and release in one frame is a tap.
const keyboard = Keyboard.scripted(inputBindings, [
  { frame: 0, press: ["up", "left"] },
  { frame: 40, release: ["up"] },
  { frame: 50, press: ["interact"], release: ["interact"] }
])

// A test clock keeps every timing at 0, so the output is the same on every run.
const hostClock = HostClock.test()
const simulation = createTopDownSimulation({ keyboard, hostClock })
if (simulation._tag === "Failure") throw new Error(simulation.failure.message)
const { runtime, setup, update } = simulation.success

// An invariant is an inspector that returns a violation message, or
// `undefined` while it holds. It declares its reads like a system, so
// `Session.make` rejects one that reads what the runtime does not provide.
const PlayerInsideWorld = Invariant.fromInspector(Game.Inspector("player inside world", { queries: { player: PlayerPositionQuery } }, ({ queries }) => {
  for (const match of queries.player.each()) {
    const position = match.data.position.get()
    if (position.x < 0 || position.x > WORLD_WIDTH || position.y < 0 || position.y > WORLD_HEIGHT) {
      return `player at (${position.x}, ${position.y})`
    }
  }
  return undefined
}))

const session = Session.make(runtime, { hostClock, schedules: { setup, update }, invariants: [PlayerInsideWorld] })

console.log(session.run("setup"))
console.log(session.run("update", { frames: 120 }))
console.log()
console.log(session.report())
console.log()
console.log(session.why(1, Position))
console.log()
console.log(session.dump({ with: [Player] }))
