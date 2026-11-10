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
const Root = Schema.defineRoot("RewindReaders")
const Game = Schema.bind(Schema.fragment({
  components: { Pos, Tint },
  resources: { Tick, Seen, Score, Go },
  events: { Ping }
}), Root)
const Flow = Game.StateMachine("RewindReaders/Flow", { Menu: {}, Playing: {} })
const SeenNow = Game.Inspector("RewindReaders/SeenNow", { resources: { seen: Game.System.readResource(Seen) } }, ({ resources }) => resources.seen.get())

// The reader of each test first runs on tick 4, when the flow enters
// `Playing`: after the checkpoint, which every test takes before tick 1.
const startsPlaying = (tick: number) => tick === 4

const makeRuntime = () => {
  const made = Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: { Tick: 0, Seen: [], Score: 0, Go: 0 },
    machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "Menu" }))
  })
  if (!made.ok) throw new Error("fixture")
  return made.value
}
type GameRuntime = ReturnType<typeof makeRuntime>

describe("rewind to a checkpoint taken before a reader's first run", () => {
  /** A runtime, how to tick its simulation, and how to take a checkpoint of it. */
  interface Simulation {
    readonly runtime: GameRuntime
    readonly step: () => void
    readonly checkpoint: () => ReturnType<GameRuntime["checkpoint"]>
  }

  /** Four ticks straight, against four ticks rewound and run again: what the reader wrote in each. */
  const replay = (build: () => Simulation) => {
    const straight = build()
    for (let tick = 0; tick < 4; tick++) straight.step()
    const rolled = build()
    const checkpoint = rolled.checkpoint()
    for (let tick = 0; tick < 4; tick++) rolled.step()
    expectOk(rolled.runtime.rewind(checkpoint))
    for (let tick = 0; tick < 4; tick++) rolled.step()
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
      const simulate = Game.Schedule(Advance, Game.Schedule.applyStateTransitions(transitions))
      const runtime = makeRuntime()
      return { runtime, step: () => expectOk(runtime.tick(simulate)), checkpoint: () => runtime.checkpoint(simulate) }
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
      const simulate = Game.Schedule(Advance, Game.Schedule.applyDeferred(), Game.Schedule.applyStateTransitions(transitions))
      const runtime = makeRuntime()
      return { runtime, step: () => expectOk(runtime.tick(simulate)), checkpoint: () => runtime.checkpoint(simulate) }
    }
    const { expected, actual } = replay(build)
    expect(expected).toEqual(["removed  | despawned "])
    expect(actual).toEqual(expected)
  })
})

describe("readers outside the rewound schedule", () => {
  const SetGo = (value: number) => Game.Schedule(Game.System(`RewindReaders/SetGo${value}`, {
    resources: { go: Game.System.writeResource(Go) }
  }, ({ resources }) => resources.go.set(value)))

  it("see a resource the rewind put back as changed", () => {
    const AddScore = Game.System("RewindReaders/AddScore", {
      resources: { score: Game.System.writeResource(Score), go: Game.System.readResource(Go) }
    }, ({ resources }) => {
      if (resources.go.get() > 0) resources.score.set(resources.score.get() + resources.go.get())
    })
    const simulate = Game.Schedule(AddScore)
    let shown = -1
    const Hud = Game.System("RewindReaders/Hud", { resources: { score: Game.System.changedResource(Score) } }, ({ resources }) => {
      if (resources.score.changed()) shown = resources.score.get()
    })
    const render = Game.Schedule(Hud)
    const runtime = makeRuntime()
    expectOk(runtime.tick(simulate))
    expectOk(runtime.tick(render))
    expect(shown).toBe(0)
    const checkpoint = runtime.checkpoint(simulate)
    // The predicted input adds 5, and the HUD draws it.
    expectOk(runtime.tick(SetGo(5)))
    expectOk(runtime.tick(simulate))
    expectOk(runtime.tick(render))
    expect(shown).toBe(5)
    // The real input adds nothing: the score is 0 again, and the HUD must say so.
    expectOk(runtime.rewind(checkpoint))
    expectOk(runtime.tick(SetGo(0)))
    expectOk(runtime.tick(simulate))
    expectOk(runtime.tick(render))
    expect(shown).toBe(0)
  })

  // Spawns one entity with `Pos` while `Go` is set, and gives it `Tint` too when `Go` is 2.
  const Spawn = Game.System("RewindReaders/Spawn", {
    resources: { go: Game.System.readResource(Go) },
    commands: Game.System.commands(Game.System.spawns(Pos, Tint))
  }, ({ resources, commands }) => {
    const go = resources.go.get()
    if (go === 1) commands.spawn(Game.Command.spawn([Pos, 1]))
    if (go === 2) commands.spawn(Game.Command.spawn([Pos, 2], [Tint, 2]))
  })
  const spawnOnce = Game.Schedule(Spawn, Game.Schedule.applyDeferred())

  /** Draws with `draw`, spawns with `Go` at `first`, rewinds, and spawns again with `Go` at `second`. */
  const respawn = (runtime: GameRuntime, first: number, second: number, draw: () => void) => {
    draw()
    const checkpoint = runtime.checkpoint(spawnOnce)
    expectOk(runtime.tick(SetGo(first)))
    expectOk(runtime.tick(spawnOnce))
    draw()
    expectOk(runtime.rewind(checkpoint))
    expectOk(runtime.tick(SetGo(second)))
    expectOk(runtime.tick(spawnOnce))
    draw()
  }

  it("do not see an entity the rewind took away and the re-run brought back as added twice", () => {
    const log: Array<string> = []
    const Draw = Game.System("RewindReaders/Draw", {
      queries: {
        added: Game.Query({ selection: { pos: Game.Query.read(Pos) }, filters: [Game.Query.added(Pos)] }),
        changed: Game.Query({ selection: { pos: Game.Query.read(Pos) }, filters: [Game.Query.changed(Pos)] })
      },
      despawned: { all: Game.System.readDespawned() },
      removed: { pos: Game.System.readRemoved(Pos) }
    }, ({ queries, despawned, removed }) => {
      const changed = queries.changed.each().map((entity) => `${entity.id}=${queries.changed.data.pos.get(entity)}`)
      log.push(`added ${queries.added.each().map((entity) => entity.id).join()} | changed ${changed.join()} | despawned ${despawned.all.all().join()} | removed ${removed.pos.all().join()}`)
    })
    const runtime = makeRuntime()
    const render = Game.Schedule(Draw)
    respawn(runtime, 1, 1, () => expectOk(runtime.tick(render)))
    expect(log).toEqual([
      "added  | changed  | despawned  | removed ",
      "added 1 | changed 1=1 | despawned  | removed ",
      "added  | changed 1=1 | despawned  | removed "
    ])
  })

  it("see a component they never saw on a re-spawned entity as added", () => {
    const log: Array<string> = []
    const Draw = Game.System("RewindReaders/DrawTint", {
      queries: {
        pos: Game.Query({ selection: { pos: Game.Query.read(Pos) }, filters: [Game.Query.added(Pos)] }),
        tint: Game.Query({ selection: { tint: Game.Query.read(Tint) }, filters: [Game.Query.added(Tint)] })
      }
    }, ({ queries }) => {
      log.push(`pos ${queries.pos.each().map((entity) => entity.id).join()} | tint ${queries.tint.each().map((entity) => entity.id).join()}`)
    })
    const runtime = makeRuntime()
    const render = Game.Schedule(Draw)
    respawn(runtime, 1, 2, () => expectOk(runtime.tick(render)))
    expect(log).toEqual(["pos  | tint ", "pos 1 | tint ", "pos  | tint 1"])
  })
})
