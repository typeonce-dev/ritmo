// A replay target for the Verify tests and the `verify` CLI test: one mover whose x grows by its input's dx.
// With VERIFY_NONDETERMINISTIC=1 every build moves one further than the one before, so two runs differ.
import { Clock, Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import type * as Schedule from "@typeonce/ritmo/Schedule"
import { Replay } from "@typeonce/ritmo-devtools"

import * as Codecs from "../../../core/test/codecs.ts"

const Position = Descriptor.ConstructedComponent(Codecs.struct({ x: Codecs.number }))("VerifyFixture/Position")
export const Input = Descriptor.Service<Schedule.Source<{ readonly dx: number }>>()("VerifyFixture/Input")
const Game = Schema.bind(Schema.fragment({ components: { Position } }))

let builds = 0

/** The game, moving each tick by the input's dx plus `extra()`. */
export const makeGame = (input: Schedule.Source<{ readonly dx: number }>, extra: () => number = () => 0) => {
  const hostClock = HostClock.test()
  const made = Game.Runtime.make({ services: Game.Runtime.services(Game.Runtime.service(Input, input)), debug: { hostClock } })
  if (!made.ok) throw new Error("fixture")
  const Move = Game.System("VerifyFixture/Move", {
    queries: { movers: Game.Query({ selection: { position: Game.Query.write(Position) } }) },
    services: { input: Game.System.service(Input) }
  }, ({ queries, services }) => {
    const dx = services.input.snapshot().dx + extra()
    for (const { data } of queries.movers.each()) data.position.setRaw({ x: data.position.get().x + dx })
  })
  return { runtime: made.value, schedules: { update: Game.Schedule(Move) }, hostClock }
}

const Spawn = Game.System("VerifyFixture/Spawn", { commands: Game.System.commands(Game.System.spawns(Position)) }, ({ commands }) => {
  const draft = Game.Command.spawn(Game.Command.entryRaw(Position, { x: 0 }))
  if (draft.ok) commands.spawn(draft.value)
})

export const replayTarget = (playback: Replay.Playback) => {
  const shift = typeof process !== "undefined" && process.env["VERIFY_NONDETERMINISTIC"] === "1" ? builds++ : 0
  return makeGame(playback.source(Input), () => shift)
}

/** Records a replay of `dxs.length` ticks, one dx per tick. */
export const record = (dxs: ReadonlyArray<number>): Replay.ReplayFile => {
  let index = 0
  const game = makeGame({ snapshot: () => ({ dx: dxs[index++] ?? 0 }) })
  game.runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
  const recorder = Replay.recorder(game.runtime, {
    schedule: game.schedules.update, name: "update", keep: dxs.length, step: Clock.hz(1), every: 2,
    sink: Replay.memorySink(), hostClock: game.hostClock
  })
  for (let tick = 0; tick < dxs.length; tick++) game.runtime.tick(game.schedules.update)
  return recorder.save("verify fixture")
}
