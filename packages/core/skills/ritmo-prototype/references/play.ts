/**
 * The prototype's play script, from the `ritmo-prototype` skill's
 * `references/play.ts`: copy it next to the simulation, then change the
 * variant, the timeline, and the readout to the question this iteration
 * asks.
 *
 *   node --import tsx play.ts          tier 0: one scripted run, printed
 *   node --import tsx play.ts fuzz     tier 1: the same, then the fuzzer
 *
 * It is written for a dash toy: the modules it imports are that toy's, and
 * a game keeps the shape and changes the names.
 *
 * The printed readout is the evidence: read it as a player would see the
 * run, and quote it in the reply. It asserts nothing; the invariants stop
 * the run at the first frame the mechanic is broken.
 */
import { HostClock } from "@typeonce/ritmo"
import { Keyboard } from "@typeonce/ritmo-browser"
import { Fuzz, Session } from "@typeonce/ritmo-devtools"
import * as ReplayNodeSink from "@typeonce/ritmo-devtools/ReplayNodeSink"

import { invariants } from "./invariants.ts"
import { DashCooldown, Game, keyboardBindings, Player, Position, Velocity } from "./schema.ts"
import { FuzzedControls, makeReplaySimulation, makeSimulation } from "./simulation.ts"
import { variants } from "./tuning.ts"

const tuning = variants.snappy

// What the player does. Frame 0 is the first update; a press and a release in one frame is a tap.
const keyboard = Keyboard.scripted(keyboardBindings, [
  { frame: 0, press: ["move.right"] },
  { frame: 20, press: ["dash"], release: ["dash"] },
  { frame: 30, press: ["dash"], release: ["dash"] },
  { frame: 60, release: ["move.right"] }
])

// What the player would see, as plain data.
const Readout = Game.Inspector("Prototype/Readout", {
  queries: { player: Game.Query({ selection: { position: Game.Query.read(Position), velocity: Game.Query.read(Velocity), cooldown: Game.Query.read(DashCooldown) }, with: [Player] }) }
}, ({ queries }) => queries.player.each().map(({ data }) => ({
  x: Math.round(data.position.get().x),
  speed: Math.round(Math.abs(data.velocity.get().x)),
  cooldown: data.cooldown.get()
})))

const hostClock = HostClock.test()
const { runtime, setup, update } = makeSimulation({ keyboard, tuning, hostClock })
const session = Session.make(runtime, { hostClock, schedules: { setup, update }, invariants })

console.log(session.run("setup"))
for (let frame = 10; frame <= 90; frame += 10) {
  const run = session.run("update", { frames: 10 })
  if (!run.data.ok) {
    console.log(run)
    process.exitCode = 1
    break
  }
  console.log(`frame ${frame}`, JSON.stringify(runtime.inspect(Readout)))
}

if (process.exitCode !== 1 && process.argv.includes("fuzz")) {
  const found = Fuzz.run(makeReplaySimulation(tuning), {
    schedule: "update", setup: "setup", inputs: [FuzzedControls], invariants, frames: 3000, runs: 3, seed: 1
  })
  if (found.ok) {
    console.log(found.value)
  } else if (found.error._tag === "Found") {
    // The shrunk replay is the bug report, and the regression test once the prototype graduates.
    ReplayNodeSink.make({ directory: ".replays" }).save(found.error.replay)
    console.log(found.error.violation, found.error.shrink)
    process.exitCode = 1
  } else {
    console.log(found.error)
    process.exitCode = 1
  }
}
