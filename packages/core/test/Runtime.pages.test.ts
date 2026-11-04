import { describe, expect, it } from "vitest"
import type { QueryEntity } from "@typeonce/ritmo/Query"
import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import type * as Entity from "@typeonce/ritmo/Entity"

const Health = Descriptor.Component<number>()("Pages/Health")
const Position = Descriptor.Component<{ readonly x: number }>()("Pages/Position")
const Game = Schema.bind(Schema.fragment({ components: { Health, Position } }))

type Id = Entity.EntityId<typeof Game.schema, typeof Game.schema>

const makeRuntime = () => Game.Runtime.make({ services: Game.Runtime.services() }).value

const Healths = Game.Query({ selection: { health: Game.Query.write(Health) } })
const Changed = Game.Query({ selection: { health: Game.Query.read(Health) }, filters: [Game.Query.changed(Health)] })

const spawner = (count: number, ids: Array<Id> = []) =>
  Game.System("Pages/Spawn", { commands: Game.System.commands(Game.System.spawns(Health)) }, ({ commands }) => {
    for (let index = 0; index < count; index++) ids.push(commands.spawn(Game.Command.spawn([Health, index])))
  })

const AllHealth = Game.Inspector("Pages/AllHealth", {
  queries: { all: Game.Query({ selection: { health: Game.Query.read(Health) } }) }
}, ({ queries }) => queries.all.each().map((entity) => queries.all.data.health.get(entity)))

/** What a `changed(Health)` reader sees on each run. */
const watcher = () => {
  const runs: Array<Array<number>> = []
  const system = Game.System("Pages/Watch", { queries: { changed: Changed } }, ({ queries }) => {
    runs.push(queries.changed.each().map((entity) => queries.changed.data.health.get(entity)))
  })
  return { system, runs }
}

describe("component storage in pages", () => {
  it("rolls back a failed system's writes across every page it touched", () => {
    const runtime = makeRuntime()
    // 600 entities span three pages.
    runtime.tick(Game.Schedule(spawner(600), Game.Schedule.applyDeferred()))
    const Fail = Game.System("Pages/Fail", { queries: { all: Healths } }, ({ queries }) => {
      const { data } = queries.all
      for (const entity of queries.all.each()) data.health.set(entity, -1)
      return Result.failure("Rejected" as const)
    })
    const failed = runtime.tick(Game.Schedule(Fail))
    expect(failed.ok).toBe(false)
    expect(runtime.inspect(AllHealth)).toEqual(Array.from({ length: 600 }, (_, index) => index))
  })

  it("rolls back a failed system's object writes across every page it touched", () => {
    const runtime = makeRuntime()
    const Spawn = Game.System("Pages/SpawnPositions", { commands: Game.System.commands(Game.System.spawns(Position)) }, ({ commands }) => {
      for (let index = 0; index < 600; index++) commands.spawn(Game.Command.spawn([Position, { x: index }]))
    })
    const Positions = Game.Query({ selection: { position: Game.Query.write(Position) } })
    const Fail = Game.System("Pages/FailPositions", { queries: { all: Positions } }, ({ queries }) => {
      const { data } = queries.all
      for (const entity of queries.all.each()) data.position.set(entity, { x: -1 })
      return Result.failure("Rejected" as const)
    })
    const Xs = Game.Inspector("Pages/Xs", {
      queries: { all: Game.Query({ selection: { position: Game.Query.read(Position) } }) }
    }, ({ queries }) => queries.all.each().map((entity) => queries.all.data.position.get(entity).x))
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
    expect(runtime.tick(Game.Schedule(Fail)).ok).toBe(false)
    expect(runtime.inspect(Xs)).toEqual(Array.from({ length: 600 }, (_, index) => index))
  })

  it("counts a write as a change only when the value differs", () => {
    const runtime = makeRuntime()
    const watch = watcher()
    runtime.tick(Game.Schedule(spawner(3), Game.Schedule.applyDeferred(), watch.system))
    // Writes 0 → 0 (equal), 1 → 10, 2 → NaN; then NaN → NaN, which is equal too.
    const Write = Game.System("Pages/Write", { queries: { all: Healths } }, ({ queries }) => {
      const { data } = queries.all
      for (const entity of queries.all.each()) {
        const health = data.health.get(entity)
        data.health.set(entity, health === 1 ? 10 : health === 2 || Number.isNaN(health) ? Number.NaN : health)
      }
    })
    runtime.tick(Game.Schedule(Write, watch.system))
    runtime.tick(Game.Schedule(Write, watch.system))
    expect(watch.runs).toEqual([[0, 1, 2], [10, Number.NaN], []])
  })

  it("counts an object value as changed only when a different object is written", () => {
    const runtime = makeRuntime()
    const seen: Array<number> = []
    const Spawn = Game.System("Pages/SpawnPosition", { commands: Game.System.commands(Game.System.spawns(Position)) }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Position, { x: 1 }]))
    })
    const Rewrite = Game.System("Pages/Rewrite", {
      queries: { positions: Game.Query({ selection: { position: Game.Query.write(Position) } }) }
    }, ({ queries }) => {
      // Writing back the value read is not a change; an equal new object is.
      const { data } = queries.positions
      for (const entity of queries.positions.each()) data.position.set(entity, data.position.get(entity))
    })
    const Move = Game.System("Pages/Move", {
      queries: { positions: Game.Query({ selection: { position: Game.Query.write(Position) } }) }
    }, ({ queries }) => {
      const { data } = queries.positions
      for (const entity of queries.positions.each()) data.position.set(entity, { x: data.position.get(entity).x })
    })
    const Watch = Game.System("Pages/WatchPosition", {
      queries: { changed: Game.Query({ selection: { position: Game.Query.read(Position) }, filters: [Game.Query.changed(Position)] }) }
    }, ({ queries }) => {
      seen.push(queries.changed.each().length)
    })
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), Watch))
    runtime.tick(Game.Schedule(Rewrite, Watch))
    runtime.tick(Game.Schedule(Move, Watch))
    expect(seen).toEqual([1, 0, 1])
  })

  it("serves entities spawned into a page that emptied out", () => {
    const runtime = makeRuntime()
    const ids: Array<Id> = []
    const Clear = Game.System("Pages/Clear", {
      queries: { all: Healths },
      commands: Game.System.commands(Game.System.despawns(Health))
    }, ({ queries, commands }) => {
      for (const entity of queries.all.each()) commands.despawn(entity)
    })
    runtime.tick(Game.Schedule(spawner(3, ids), Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(Clear, Game.Schedule.applyDeferred()))
    // The next ids land on the same page, which let go of its storage.
    runtime.tick(Game.Schedule(spawner(2, ids), Game.Schedule.applyDeferred()))
    const Double = Game.System("Pages/Double", { queries: { all: Healths } }, ({ queries }) => {
      const { data } = queries.all
      for (const entity of queries.all.each()) data.health.set(entity, data.health.get(entity) * 2 + 1)
    })
    runtime.tick(Game.Schedule(Double))
    expect(ids[3]! >> 8).toBe(ids[0]! >> 8)
    expect(runtime.inspect(AllHealth)).toEqual([1, 3])
  })
})

describe("data and entities from an earlier run", () => {
  it("a kept slot throws when used in a later run, naming the fix", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawner(1), Game.Schedule.applyDeferred()))
    const outcomes: Array<string> = []
    const Other = Game.Query({ selection: { position: Game.Query.read(Position) } })
    let kept: { readonly get: (entity: never) => number } | undefined
    const Aim = Game.System("Pages/Aim", {
      queries: { all: Healths, other: Other },
      local: () => ({ runs: 0 })
    }, ({ queries, local }) => {
      local.runs += 1
      const entity = queries.all.each()[0]!
      if (local.runs === 1) kept = queries.all.data.health as never
      try {
        outcomes.push(String(kept!.get(entity as never)))
      } catch (error) {
        outcomes.push((error as Error).message)
      }
    })
    runtime.tick(Game.Schedule(Aim))
    runtime.tick(Game.Schedule(Aim))
    expect(outcomes).toEqual([
      "0",
      "The data of Pages/Health was used after the run that handed it out: read queries.x.data again in each run"
    ])
  })

  it("a kept entity follows its entity in later runs", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawner(1), Game.Schedule.applyDeferred()))
    const values: Array<number> = []
    let kept: QueryEntity<typeof Game.schema, typeof Healths> | undefined
    const Follow = Game.System("Pages/KeptEntity", { queries: { all: Healths } }, ({ queries }) => {
      const { data } = queries.all
      kept ??= queries.all.each()[0]!
      values.push(data.health.get(kept))
      data.health.set(kept, data.health.get(kept) + 1)
    })
    runtime.tick(Game.Schedule(Follow))
    runtime.tick(Game.Schedule(Follow))
    expect(values).toEqual([0, 1])
  })

  it("slots an inspector returned throw after it, and the entity it returned stays one", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(spawner(1), Game.Schedule.applyDeferred()))
    const Leak = Game.Inspector("Pages/Leak", {
      queries: { all: Game.Query({ selection: { health: Game.Query.read(Health) } }) }
    }, ({ queries }) => ({ entity: queries.all.each()[0]!, data: queries.all.data }))
    const leaked = runtime.inspect(Leak)
    expect(leaked.entity.id).toBeTypeOf("number")
    expect(() => leaked.data.health.get(leaked.entity)).toThrow("The data of Pages/Health was used after the run")
  })

  it("is still valid when the same system resolves it again", () => {
    const runtime = makeRuntime()
    const ids: Array<Id> = []
    runtime.tick(Game.Schedule(spawner(1, ids), Game.Schedule.applyDeferred()))
    const values: Array<number> = []
    const Follow = Game.System("Pages/Follow", {
      queries: { all: Healths },
      local: () => ({ target: undefined as Id | undefined })
    }, ({ queries, local }) => {
      local.target ??= ids[0]
      const found = queries.all.get(local.target!)
      if (found.ok) {
        values.push(queries.all.data.health.get(found.value))
        queries.all.data.health.set(found.value, queries.all.data.health.get(found.value) + 1)
      }
    })
    runtime.tick(Game.Schedule(Follow))
    runtime.tick(Game.Schedule(Follow))
    expect(values).toEqual([0, 1])
  })
})

describe("runtime.inspect", () => {
  it("throws while a schedule is running", () => {
    const runtime = makeRuntime()
    let message = ""
    const Nested = Game.System("Pages/Nested", {}, () => {
      try {
        runtime.inspect(AllHealth)
      } catch (error) {
        message = (error as Error).message
      }
    })
    runtime.tick(Game.Schedule(Nested))
    expect(message).toBe("runtime.inspect(Pages/AllHealth) was called while a schedule is running: read the world from a system, or inspect between ticks")
  })
})
