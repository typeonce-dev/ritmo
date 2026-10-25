/**
 * Records `match.json`: ten seconds of the netcode shooter with both seats
 * moving and firing on a fixed script, so shots fly, hit, score, and end a
 * round. Rerun it when the game changes (the replay test fails until then):
 *
 *   node --import tsx integration/netcode/replay/record.ts
 */
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { HostClock } from "@typeonce/ritmo"
import { Replay } from "@typeonce/ritmo-devtools"

import { setup, simulate, step, type PlayerInput } from "../game.ts"
import { makeDebugRuntime } from "./target.ts"

/** Where the match is saved, beside this script. */
export const matchPath = fileURLToPath(new URL("./match.json", import.meta.url))

/** Ticks recorded: ten seconds at 60 Hz. */
export const ticks = 600

const axis = (tick: number, period: number): -1 | 0 | 1 => {
  const phase = Math.floor(tick / period) % 4
  return phase === 0 ? 1 : phase === 2 ? -1 : 0
}

/** Seat 0 walks up and down and fires often; seat 1 drifts and fires less. */
const script = (tick: number): readonly [PlayerInput, PlayerInput] => [
  { dx: 0, dy: axis(tick, 15), fire: tick % 5 === 0 },
  { dx: axis(tick, 40), dy: axis(tick + 7, 11), fire: tick % 13 === 0 }
]

/** Plays the scripted match and returns its replay: deterministic, so the same on every run. */
export const record = (): Replay.ReplayFile => {
  let current: ReadonlyArray<PlayerInput> = script(0)
  const hostClock = HostClock.test()
  const runtime = makeDebugRuntime({ snapshot: () => current }, hostClock)
  if (!runtime.tick(setup).ok) throw new Error("setup failed")
  const sink = Replay.memorySink()
  const recorder = Replay.recorder(runtime, { schedule: simulate, name: "simulate", keep: ticks * step.dt, step, every: 1, sink, hostClock })
  for (let tick = 0; tick < ticks; tick++) {
    current = script(tick)
    if (!runtime.tick(simulate).ok) throw new Error(`tick ${tick} failed`)
  }
  recorder.stop()
  return recorder.save(`scripted netcode match, ${ticks} ticks: checked across engines by ritmo-devtools verify`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(matchPath, `${JSON.stringify(record(), null, 1)}\n`)
  console.log(`wrote ${matchPath}`)
}
