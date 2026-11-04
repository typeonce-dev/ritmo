import { describe, expect, it } from "vitest"
import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import type * as Entity from "@typeonce/ritmo/Entity"

const Position = Descriptor.Component<{ x: number }>()("Lifecycle/Position")
const Tag = Descriptor.Component<{}>()("Lifecycle/Tag")

const Game = Schema.bind(Schema.fragment({ components: { Position, Tag } }))

type Id = Entity.EntityId<typeof Game.schema, typeof Game.schema>

const makeRuntime = () => Game.Runtime.make({ services: Game.Runtime.services() }).value

const Added = Game.Query({ selection: { position: Game.Query.read(Position) }, filters: [Game.Query.added(Position)] })
const Changed = Game.Query({ selection: { position: Game.Query.read(Position) }, filters: [Game.Query.changed(Position)] })
const Positions = Game.Query({ selection: { position: Game.Query.write(Position) } })

/**
 * A system that records what its `added` and `changed` queries saw on each run.
 */
const observer = (name: string) => {
  const runs: Array<{ added: Array<number>; changed: Array<number> }> = []
  const system = Game.System(name, { queries: { added: Added, changed: Changed } }, ({ queries }) => {
    runs.push({
      added: queries.added.each().map((entity) => queries.added.data.position.get(entity).x),
      changed: queries.changed.each().map((entity) => queries.changed.data.position.get(entity).x)
    })
  })
  return { system, runs }
}

const spawner = (values: ReadonlyArray<number>, ids: Array<Id> = []) =>
  Game.System("Lifecycle/Spawn", {
    commands: Game.System.commands(Game.System.spawns(Position))
  }, ({ commands }) => {
    for (const x of values) {
      ids.push(commands.spawn(Game.Command.spawn([Position, { x }])))
    }
  })

describe("Runtime change detection", () => {
  it("shows each addition to each system exactly once, after the commands are applied", () => {
    const before = observer("Lifecycle/Before")
    const after = observer("Lifecycle/After")
    const runtime = makeRuntime()

    runtime.tick(Game.Schedule(before.system, spawner([1]), Game.Schedule.applyDeferred(), after.system))
    runtime.tick(Game.Schedule(before.system, after.system))

    // `before` ran ahead of the flush on the first tick, so it sees the addition on its next run.
    expect(before.runs.map((run) => run.added)).toEqual([[], [1]])
    expect(after.runs.map((run) => run.added)).toEqual([[1], []])
  })

  it("gives independent readers their own view of the same changes", () => {
    const first = observer("Lifecycle/First")
    const second = observer("Lifecycle/Second")
    const Move = Game.System("Lifecycle/Move", { queries: { positions: Positions } }, ({ queries }) => {
      const { data } = queries.positions
      for (const entity of queries.positions.each()) {
        data.position.update(entity, (position) => ({ x: position.x + 10 }))
      }
    })
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawner([1]), Game.Schedule.applyDeferred(), first.system))

    runtime.tick(Game.Schedule(Move, first.system))
    runtime.tick(Game.Schedule(second.system))
    runtime.tick(Game.Schedule(first.system, second.system))

    expect(first.runs.map((run) => run.changed)).toEqual([[1], [11], []])
    // `second` first runs after the move: everything that exists counts as added and changed.
    expect(second.runs.map((run) => run.changed)).toEqual([[11], []])
    expect(second.runs.map((run) => run.added)).toEqual([[11], []])
  })

  it("counts an insert over an existing component as changed, not added", () => {
    const ids: Array<Id> = []
    const reader = observer("Lifecycle/Reader")
    const Overwrite = Game.System("Lifecycle/Overwrite", {
      commands: Game.System.commands(Game.System.inserts(Position))
    }, ({ commands }) => {
      commands.insert(ids[0]!, [Position, { x: 9 }])
    })
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawner([1], ids), Game.Schedule.applyDeferred(), reader.system))
    runtime.tick(Game.Schedule(Overwrite, Game.Schedule.applyDeferred(), reader.system))

    expect(reader.runs[1]).toEqual({ added: [], changed: [9] })
  })

  it("does not report writes from a system whose run failed", () => {
    const reader = observer("Lifecycle/FailureReader")
    const Failing = Game.System("Lifecycle/Failing", { queries: { positions: Positions } }, ({ queries }) => {
      const { data } = queries.positions
      for (const entity of queries.positions.each()) {
        data.position.set(entity, { x: 100 })
      }
      return Result.failure("Rejected" as const)
    })
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawner([1]), Game.Schedule.applyDeferred(), reader.system))

    const result = runtime.tick(Game.Schedule(Failing))
    runtime.tick(Game.Schedule(reader.system))

    expect(result.ok).toBe(false)
    expect(reader.runs[1]).toEqual({ added: [], changed: [] })
  })

  it("does not show a system its own writes as changes, during that run or after it", () => {
    const seen: Array<Array<number>> = []
    const Mover = Game.System("Lifecycle/Mover", { queries: { positions: Positions, changed: Changed } }, ({ queries }) => {
      const { data } = queries.positions
      for (const entity of queries.positions.each()) {
        data.position.set(entity, { x: data.position.get(entity).x + 1 })
      }
      seen.push(queries.changed.each().map((entity) => queries.changed.data.position.get(entity).x))
    })
    const reader = observer("Lifecycle/MoverReader")
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawner([1]), Game.Schedule.applyDeferred(), Mover))
    runtime.tick(Game.Schedule(Mover, reader.system))

    // The first run sees the spawn, the second only its own write: neither counts it.
    expect(seen).toEqual([[2], []])
    expect(reader.runs[0]).toEqual({ added: [3], changed: [3] })
  })

  it("shows removed components and despawned entities to each reader once", () => {
    const ids: Array<Id> = []
    const seen: Array<{ removed: Array<number>; despawned: Array<number> }> = []
    const Reader = Game.System("Lifecycle/RemovalReader", {
      removed: { positions: Game.System.readRemoved(Position) },
      despawned: { entities: Game.System.readDespawned() }
    }, ({ removed, despawned }) => {
      seen.push({
        removed: removed.positions.all().map((id) => id),
        despawned: despawned.entities.all().map((id) => id)
      })
    })
    const Cleanup = Game.System("Lifecycle/Cleanup", {
      queries: { positions: Positions },
      commands: Game.System.commands(Game.System.removes(Position), Game.System.despawns(Position))
    }, ({ queries, commands }) => {
      const first = queries.positions.get(ids[0]!)
      if (first.ok) commands.remove(first.value, Position)
      const second = queries.positions.get(ids[1]!)
      if (second.ok) commands.despawn(second.value)
    })
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawner([1, 2], ids), Game.Schedule.applyDeferred(), Reader))

    runtime.tick(Game.Schedule(Cleanup, Reader))
    runtime.tick(Game.Schedule(Game.Schedule.applyDeferred(), Reader))
    runtime.tick(Game.Schedule(Reader))

    expect(seen).toEqual([
      { removed: [], despawned: [] },
      // The cleanup commands stay pending until the next applyDeferred().
      { removed: [], despawned: [] },
      { removed: [ids[0]!, ids[1]!], despawned: [ids[1]!] },
      { removed: [], despawned: [] }
    ])
  })

  it("holds removal records until every reading system has run, for schedules ticked at different rates", () => {
    const ids: Array<Id> = []
    const seen: Array<{ removed: Array<number>; despawned: Array<number> }> = []
    const Reader = Game.System("Lifecycle/SlowReader", {
      removed: { positions: Game.System.readRemoved(Position) },
      despawned: { entities: Game.System.readDespawned() }
    }, ({ removed, despawned }) => {
      seen.push({
        removed: removed.positions.all().map((id) => id),
        despawned: despawned.entities.all().map((id) => id)
      })
    })
    let next = 0
    const DespawnNext = Game.System("Lifecycle/DespawnNext", {
      queries: { positions: Positions },
      commands: Game.System.commands(Game.System.despawns(Position))
    }, ({ queries, commands }) => {
      const match = queries.positions.get(ids[next++]!)
      if (match.ok) commands.despawn(match.value)
    })
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawner([1, 2, 3, 4], ids), Game.Schedule.applyDeferred(), Reader))

    // A fixed update despawning once per tick, ticked four times per render.
    const fixed = Game.Schedule(DespawnNext, Game.Schedule.applyDeferred())
    for (let step = 0; step < 4; step++) runtime.tick(fixed)
    runtime.tick(Game.Schedule(Reader))
    runtime.tick(Game.Schedule(Reader))

    const all = ids.map((id) => id)
    expect(seen).toEqual([
      { removed: [], despawned: [] },
      { removed: all, despawned: all },
      { removed: [], despawned: [] }
    ])
  })

  it("keeps removal records while a reader is skipped by its run conditions", () => {
    const Flow = Game.StateMachine("Lifecycle/Flow", { On: {}, Off: {} })
    const ids: Array<Id> = []
    const seen: Array<Array<number>> = []
    const Reader = Game.System("Lifecycle/GatedReader", {
      despawned: { entities: Game.System.readDespawned() },
      when: [Game.Condition.inState(Flow, "On")]
    }, ({ despawned }) => {
      seen.push(despawned.entities.all().map((id) => id))
    })
    const Toggle = Game.System("Lifecycle/Toggle", { machines: { flow: Game.System.machine(Flow) }, nextMachines: { flow: Game.System.nextState(Flow) } }, ({ machines, nextMachines }) => {
      nextMachines.flow.set({ _tag: machines.flow.is("On") ? "Off" : "On" })
    })
    const Despawn = Game.System("Lifecycle/DespawnAll", {
      queries: { positions: Positions },
      commands: Game.System.commands(Game.System.despawns(Position))
    }, ({ queries, commands }) => {
      for (const id of ids) {
        const match = queries.positions.get(id)
        if (match.ok) commands.despawn(match.value)
      }
    })
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "On" }))
    }).value
    runtime.tick(Game.Schedule(spawner([1], ids), Game.Schedule.applyDeferred(), Reader))
    runtime.tick(Game.Schedule(Toggle, Game.Schedule.applyStateTransitions()))
    runtime.tick(Game.Schedule(Despawn, Game.Schedule.applyDeferred(), Reader))
    runtime.tick(Game.Schedule(Reader))
    runtime.tick(Game.Schedule(Reader))
    runtime.tick(Game.Schedule(Toggle, Game.Schedule.applyStateTransitions(), Reader))

    expect(seen).toEqual([[], [ids[0]!]])
  })

  it("reports lagged() on removed and despawned reads after their logs drop records at capacity", () => {
    const runtime = makeRuntime()
    const seen: Array<{ readonly removed: boolean; readonly despawned: boolean }> = []
    const Reader = Game.System("Lifecycle/LaggedReader", {
      removed: { tags: Game.System.readRemoved(Tag) },
      despawned: { entities: Game.System.readDespawned() }
    }, ({ removed, despawned }) => {
      seen.push({ removed: removed.tags.lagged(), despawned: despawned.entities.lagged() })
    })
    // Each entity keeps a Position after untagging, so the despawn can prove what it removes.
    const SpawnMany = Game.System("Lifecycle/SpawnMany", {
      commands: Game.System.commands(Game.System.spawns(Tag, Position))
    }, ({ commands }) => {
      for (let index = 0; index < 40_000; index++) commands.spawn(Game.Command.spawn([Tag, {}], [Position, { x: index }]))
    })
    const Untag = Game.System("Lifecycle/UntagAll", {
      queries: { tagged: Game.Query({ selection: { tag: Game.Query.read(Tag) } }) },
      commands: Game.System.commands(Game.System.removes(Tag))
    }, ({ queries, commands }) => {
      for (const entity of queries.tagged.each()) commands.remove(entity, Tag)
    })
    const DespawnAll = Game.System("Lifecycle/DespawnAll", {
      queries: { all: Game.Query({ selection: {}, with: [Position] }) },
      commands: Game.System.commands(Game.System.despawns(Position))
    }, ({ queries, commands }) => {
      for (const entity of queries.all.each()) commands.despawn(entity)
    })
    const read = Game.Schedule(Reader)
    const churn = Game.Schedule(
      SpawnMany, Game.Schedule.applyDeferred(),
      Untag, Game.Schedule.applyDeferred(),
      DespawnAll, Game.Schedule.applyDeferred()
    )
    runtime.tick(read)
    runtime.tick(churn)
    runtime.tick(churn)
    runtime.tick(read)
    runtime.tick(read)
    expect(seen).toEqual([
      { removed: false, despawned: false },
      { removed: true, despawned: true },
      { removed: false, despawned: false }
    ])
  })
})
