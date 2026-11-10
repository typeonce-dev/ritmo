import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"

const expectOk = (result: { readonly ok: boolean; readonly error?: unknown }): void => {
  expect(result.ok ? undefined : result.error).toBeUndefined()
}

const Tick = Descriptor.Resource<number>()("RewindReaders/Tick")
const Seen = Descriptor.Resource<ReadonlyArray<string>>()("RewindReaders/Seen")
const Ping = Descriptor.Event<string>()("RewindReaders/Ping")
const Pos = Descriptor.ConstructedComponent(Codecs.number)("RewindReaders/Pos")
const Tint = Descriptor.ConstructedComponent(Codecs.number)("RewindReaders/Tint")
const Score = Descriptor.ConstructedResource(Codecs.number)("RewindReaders/Score")
const Go = Descriptor.TransientResource<number>()("RewindReaders/Go")
const Game = Schema.bind(Schema.fragment({
  components: { Pos, Tint },
  resources: { Tick, Seen, Score, Go },
  events: { Ping }
}))
const Flow = Game.StateMachine("RewindReaders/Flow", { Menu: {}, Playing: {} })
const SeenNow = Game.Inspector("RewindReaders/SeenNow", { resources: { seen: Game.System.readResource(Seen) } }, ({ resources }) => resources.seen.get())

// The reader of each test first runs on tick 4, when the flow enters
// `Playing`: after the checkpoint, which every test takes before tick 1.
const startsPlaying = (tick: number) => tick === 4

const makeRuntime = () => Game.Runtime.make({
  services: Game.Runtime.services(),
  resources: { Tick: 0, Seen: [], Score: 0, Go: 0 },
  machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "Menu" }))
}).value
type GameRuntime = ReturnType<typeof makeRuntime>

describe("rewind to a checkpoint taken before a reader's first run", () => {
  /** Four ticks straight, against four ticks rewound and run again: what the reader wrote in each. */
  const replay = (build: () => { readonly runtime: GameRuntime; readonly simulate: Parameters<GameRuntime["checkpoint"]>[0] }) => {
    const straight = build()
    for (let tick = 0; tick < 4; tick++) expectOk(straight.runtime.tick(straight.simulate))
    const rolled = build()
    const checkpoint = rolled.runtime.checkpoint(rolled.simulate)
    for (let tick = 0; tick < 4; tick++) expectOk(rolled.runtime.tick(rolled.simulate))
    expectOk(rolled.runtime.rewind(checkpoint))
    for (let tick = 0; tick < 4; tick++) expectOk(rolled.runtime.tick(rolled.simulate))
    return { expected: straight.runtime.inspect(SeenNow), actual: rolled.runtime.inspect(SeenNow) }
  }

  it("an event reader reads what a runtime that never rewound reads", () => {
    const build = () => {
      const Advance = Game.System("RewindReaders/Advance", {
        resources: { tick: Game.System.writeResource(Tick) },
        events: { ping: Game.System.writeEvent(Ping) },
        nextMachines: { flow: Game.System.nextState(Flow) }
      }, ({ resources, events, nextMachines }) => {
        const tick = resources.tick.get() + 1
        resources.tick.set(tick)
        if (tick === 1) events.ping.emit("published on tick 1")
        if (startsPlaying(tick)) nextMachines.flow.set({ _tag: "Playing" })
      })
      const OnPlaying = Game.System("RewindReaders/OnPlaying", {
        resources: { seen: Game.System.writeResource(Seen) },
        events: { ping: Game.System.readEvent(Ping) }
      }, ({ resources, events }) => {
        resources.seen.set([`read ${events.ping.all().length} event(s), lagged=${events.ping.lagged()}`])
      })
      const transitions = Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [OnPlaying]))
      return { runtime: makeRuntime(), simulate: Game.Schedule(Advance, Game.Schedule.applyStateTransitions(transitions)) }
    }
    const { expected, actual } = replay(build)
    expect(expected).toEqual(["read 0 event(s), lagged=false"])
    expect(actual).toEqual(expected)
  })

  it("a removed and despawned reader reads what a runtime that never rewound reads", () => {
    const build = () => {
      const Advance = Game.System("RewindReaders/AdvanceAndClear", {
        resources: { tick: Game.System.writeResource(Tick) },
        queries: {
          shown: Game.Query({ selection: { pos: Game.Query.read(Pos) } }),
          tinted: Game.Query({ selection: { tint: Game.Query.read(Tint) } })
        },
        commands: Game.System.commands(Game.System.spawns(Pos, Tint), Game.System.removes(Pos), Game.System.despawns(Tint)),
        nextMachines: { flow: Game.System.nextState(Flow) }
      }, ({ resources, queries, commands, nextMachines }) => {
        const tick = resources.tick.get() + 1
        resources.tick.set(tick)
        if (tick === 1) {
          commands.spawn(Game.Command.spawn([Pos, 1]))
          commands.spawn(Game.Command.spawn([Tint, 1]))
        }
        if (tick === 2) {
          for (const entity of queries.shown.each()) commands.remove(entity, Pos)
          for (const entity of queries.tinted.each()) commands.despawn(entity)
        }
        if (startsPlaying(tick)) nextMachines.flow.set({ _tag: "Playing" })
      })
      const OnPlaying = Game.System("RewindReaders/OnPlayingLifecycle", {
        resources: { seen: Game.System.writeResource(Seen) },
        removed: { pos: Game.System.readRemoved(Pos) },
        despawned: { all: Game.System.readDespawned() }
      }, ({ resources, removed, despawned }) => {
        resources.seen.set([`removed ${removed.pos.all().join()} | despawned ${despawned.all.all().join()}`])
      })
      const transitions = Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [OnPlaying]))
      return {
        runtime: makeRuntime(),
        simulate: Game.Schedule(Advance, Game.Schedule.applyDeferred(), Game.Schedule.applyStateTransitions(transitions))
      }
    }
    const { expected, actual } = replay(build)
    expect(expected).toEqual(["removed  | despawned "])
    expect(actual).toEqual(expected)
  })
})
