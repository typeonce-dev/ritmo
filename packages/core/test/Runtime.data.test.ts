import { describe, expect, it } from "vitest"
import type { QueryEntity } from "@typeonce/ritmo/Query"
import { Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"

const Health = Descriptor.Component<number>()("Data/Health")
const Position = Descriptor.Component<{ readonly x: number; readonly y: number }>()("Data/Position")
const Mixed = Descriptor.Component<number | { readonly n: number }>()("Data/Mixed")
const Root = Schema.defineRoot("Data")
const Game = Schema.bind(Schema.fragment({ components: { Health, Position, Mixed } }), Root)

const make = () => {
  const made = Game.Runtime.make({ services: Game.Runtime.services() })
  if (!made.ok) throw new Error("runtime")
  return made.value
}
const Healths = Game.Query({ selection: { health: Game.Query.write(Health) } })
const Positions = Game.Query({ selection: { position: Game.Query.write(Position) } })
const Mixes = Game.Query({ selection: { mixed: Game.Query.write(Mixed) } })
// 600 entities spans several storage pages.
const seed = Game.Schedule(
  Game.System("Data/Seed", { commands: Game.System.commands(Game.System.spawns(Health, Position, Mixed)) }, ({ commands }) => {
    for (let i = 0; i < 600; i++) commands.spawn(Game.Command.spawn([Health, i], [Position, { x: i, y: 0 }], [Mixed, i]))
  }),
  Game.Schedule.applyDeferred()
)
const Everyone = Game.Inspector("Data/Everyone", {
  queries: { all: Game.Query({ selection: { health: Game.Query.read(Health) } }) }
}, ({ queries }) => queries.all.each().map((entity) => queries.all.data.health.get(entity)))
const seeded = Array.from({ length: 600 }, (_, i) => i)

describe("a query's data and entities", () => {
  it("reads and writes numbers and objects across pages", () => {
    const runtime = make()
    runtime.tick(seed)
    const positions: Array<number> = []
    expect(runtime.tick(Game.Schedule(Game.System("Data/Write", { queries: { h: Healths, p: Positions } }, ({ queries }) => {
      const healths = queries.h.data
      const places = queries.p.data
      for (const entity of queries.h.each()) healths.health.set(entity, healths.health.get(entity) + 1)
      for (const entity of queries.p.each()) places.position.update(entity, (p) => ({ x: p.x + 1, y: p.y }))
      positions.push(places.position.get(queries.p.each()[300]!).x)
    }))).ok).toBe(true)
    expect(runtime.inspect(Everyone)).toEqual(seeded.map((i) => i + 1))
    expect(positions).toEqual([301])
  })

  it("rolls back a failing system's writes: numbers, objects, and a slot that changed kind", () => {
    const runtime = make()
    runtime.tick(seed)
    const Failing = Game.System("Data/Fail", { queries: { h: Healths, p: Positions, m: Mixes } }, ({ queries }) => {
      for (const entity of queries.h.each()) queries.h.data.health.set(entity, -1)
      for (const entity of queries.p.each()) queries.p.data.position.set(entity, { x: -1, y: -1 })
      for (const entity of queries.m.each()) queries.m.data.mixed.set(entity, { n: 1 })
      return Result.failure("Nope" as const)
    })
    expect(runtime.tick(Game.Schedule(Failing)).ok).toBe(false)
    expect(runtime.inspect(Everyone)).toEqual(seeded)
    const Check = Game.Inspector("Data/Check", {
      queries: { p: Game.Query({ selection: { position: Game.Query.read(Position), mixed: Game.Query.read(Mixed) } }) }
    }, ({ queries }) => {
      const entity = queries.p.each()[7]!
      return [queries.p.data.position.get(entity), queries.p.data.mixed.get(entity)]
    })
    expect(runtime.inspect(Check)).toEqual([{ x: 7, y: 0 }, 7])
  })

  it("lets a value change kind, and keeps NaN as a value", () => {
    const runtime = make()
    runtime.tick(seed)
    const seen: Array<unknown> = []
    runtime.tick(Game.Schedule(Game.System("Data/Kinds", { queries: { m: Mixes, h: Healths } }, ({ queries }) => {
      const { mixed } = queries.m.data
      const { health } = queries.h.data
      const entity = queries.m.each()[3]!
      const other = queries.h.each()[3]!
      mixed.set(entity, { n: 5 })
      seen.push(mixed.get(entity))
      mixed.set(entity, 9)
      seen.push(mixed.get(entity))
      health.set(other, Number.NaN)
      seen.push(health.get(other))
    })))
    expect(seen).toEqual([{ n: 5 }, 9, Number.NaN])
    expect(runtime.inspect(Everyone)[3]).toBeNaN()
  })

  it("counts a real write as a change once; an equal write, and A to B to A, are not changes", () => {
    const runtime = make()
    runtime.tick(seed)
    const counts: Array<number> = []
    const Reader = Game.System("Data/Changed", {
      queries: { changed: Game.Query({ selection: { health: Game.Query.read(Health) }, filters: [Game.Query.changed(Health)] }) }
    }, ({ queries }) => { counts.push(queries.changed.each().length) })
    runtime.tick(Game.Schedule(Reader))
    counts.length = 0
    const Same = Game.System("Data/Same", { queries: { h: Healths } }, ({ queries }) => {
      const { data } = queries.h
      for (const entity of queries.h.each()) data.health.set(entity, data.health.get(entity))
    })
    const AndBack = Game.System("Data/AndBack", { queries: { h: Healths } }, ({ queries }) => {
      const { data } = queries.h
      for (const entity of queries.h.each()) {
        const value = data.health.get(entity)
        data.health.set(entity, value + 1)
        data.health.set(entity, value)
      }
    })
    const Two = Game.System("Data/Two", { queries: { h: Healths } }, ({ queries }) => {
      const { data } = queries.h
      const entities = queries.h.each()
      data.health.set(entities[0]!, 1000)
      data.health.set(entities[300]!, 1000)
    })
    runtime.tick(Game.Schedule(Same, Reader))
    runtime.tick(Game.Schedule(AndBack, Reader))
    runtime.tick(Game.Schedule(Two, Reader))
    runtime.tick(Game.Schedule(Reader))
    expect(counts).toEqual([0, 0, 2, 0])
  })

  it("throws for a slot kept past its run, naming the fix, inside another run too", () => {
    const runtime = make()
    runtime.tick(seed)
    let kept: (() => number) | undefined
    runtime.tick(Game.Schedule(Game.System("Data/Keep", { queries: { h: Healths } }, ({ queries }) => {
      const { health } = queries.h.data
      const entity = queries.h.each()[0]!
      kept = () => health.get(entity)
    })))
    expect(() => kept!()).toThrow(/The data of Data\/Health was used after the run/)
    expect(() => runtime.tick(Game.Schedule(Game.System("Data/Late", { queries: { p: Positions } }, () => {
      kept!()
    })))).toThrow(/read queries\.x\.data again/)
  })

  it("never reads another entity through a kept entity: it follows its own, and throws once it is gone", () => {
    const runtime = make()
    runtime.tick(seed)
    let kept: QueryEntity<typeof Game.schema, typeof Healths> | undefined
    runtime.tick(Game.Schedule(Game.System("Data/Keep", { queries: { h: Healths } }, ({ queries }) => {
      kept = queries.h.each()[5]!
    })))
    const read = (outcome: Array<unknown>) => Game.System("Data/ReadKept", { queries: { h: Healths } }, ({ queries }) => {
      try { outcome.push(queries.h.data.health.get(kept!)) } catch (error) { outcome.push((error as Error).message) }
    })
    const first: Array<unknown> = []
    runtime.tick(Game.Schedule(read(first)))
    expect(first).toEqual([5])
    expect(runtime.tick(Game.Schedule(
      Game.System("Data/Despawn", {
        queries: { h: Healths },
        commands: Game.System.commands(Game.System.despawns(Health))
      }, ({ commands }) => { commands.despawn(kept!) }),
      Game.Schedule.applyDeferred(),
      Game.System("Data/Respawn", { commands: Game.System.commands(Game.System.spawns(Health)) }, ({ commands }) => {
        commands.spawn(Game.Command.spawn([Health, 99]))
      }),
      Game.Schedule.applyDeferred()
    )).ok).toBe(true)
    expect(runtime.inspect(Everyone)).not.toContain(5)
    const second: Array<unknown> = []
    runtime.tick(Game.Schedule(read(second)))
    expect(String(second[0])).toMatch(/Data\/Health was used for an entity that was despawned/)
  })

  it("sends entities to commands, and structural changes apply at applyDeferred", () => {
    const runtime = make()
    runtime.tick(seed)
    const counts: Array<number> = []
    const Reads = Game.Query({ selection: { health: Game.Query.read(Health) } })
    runtime.tick(Game.Schedule(
      Game.System("Data/Remove", {
        queries: { h: Reads },
        commands: Game.System.commands(Game.System.despawns(Health))
      }, ({ queries, commands }) => {
        const entities = queries.h.each()
        counts.push(entities.length)
        for (let i = 0; i < 100; i++) commands.despawn(entities[i]!)
        counts.push(queries.h.each().length)
      }),
      Game.Schedule.applyDeferred(),
      Game.System("Data/Count", { queries: { h: Reads } }, ({ queries }) => { counts.push(queries.h.each().length) })
    ))
    expect(counts).toEqual([600, 600, 500])
  })

  it("rewinds writes with a checkpoint, and slots read the restored values", () => {
    const made = Game.Runtime.make({ services: Game.Runtime.services(), checkpoints: 4 })
    if (!made.ok) throw new Error("runtime")
    const runtime = made.value
    runtime.tick(seed)
    const simulate = Game.Schedule(Game.System("Data/Write", { queries: { h: Healths, p: Positions } }, ({ queries }) => {
      for (const entity of queries.h.each()) queries.h.data.health.set(entity, 0)
      for (const entity of queries.p.each()) queries.p.data.position.set(entity, { x: -1, y: -1 })
    }))
    const taken = runtime.checkpoint(simulate)
    expect(runtime.tick(simulate).ok).toBe(true)
    expect(runtime.inspect(Everyone)[100]).toBe(0)
    expect(runtime.rewind(taken).ok).toBe(true)
    const Restored = Game.Inspector("Data/Restored", {
      queries: { h: Game.Query({ selection: { health: Game.Query.read(Health), position: Game.Query.read(Position) } }) }
    }, ({ queries }) => {
      const { data } = queries.h
      const entities = queries.h.each()
      return [entities.length, data.health.get(entities[100]!), data.position.get(entities[599]!)]
    })
    expect(runtime.inspect(Restored)).toEqual([600, 100, { x: 599, y: 0 }])
  })

  it("writes the entity it is given after reading one on another page, in every accessor class", () => {
    const runtime = make()
    runtime.tick(seed)
    expect(runtime.tick(Game.Schedule(Game.System("Data/Chase", { queries: { h: Healths, p: Positions } }, ({ queries }) => {
      const healths = queries.h.data.health
      const places = queries.p.data.position
      const he = queries.h.each()
      const pe = queries.p.each()
      // Entities 0 to 9 take from entities 300 to 309: another page, read between writes.
      for (let i = 0; i < 10; i++) healths.set(he[i]!, healths.get(he[i + 300]!) + 10_000)
      for (let i = 0; i < 10; i++) places.set(pe[i]!, { x: places.get(pe[i + 300]!).x + 10_000, y: 0 })
    }))).ok).toBe(true)
    const expected = seeded.map((i) => i < 10 ? i + 10_300 : i)
    expect(runtime.inspect(Everyone)).toEqual(expected)
    const Places = Game.Inspector("Data/Places", {
      queries: { p: Game.Query({ selection: { position: Game.Query.read(Position) } }) }
    }, ({ queries }) => queries.p.each().map((entity) => queries.p.data.position.get(entity).x))
    expect(runtime.inspect(Places)).toEqual(expected)
  })

  it("rolls back and reports as changed only the entity written after reading across pages", () => {
    const runtime = make()
    runtime.tick(seed)
    const Failing = Game.System("Data/ChaseFail", { queries: { h: Healths } }, ({ queries }) => {
      const { health } = queries.h.data
      const entities = queries.h.each()
      for (let i = 0; i < 10; i++) health.set(entities[i]!, health.get(entities[i + 300]!) + 1)
      return Result.failure("Nope" as const)
    })
    expect(runtime.tick(Game.Schedule(Failing)).ok).toBe(false)
    expect(runtime.inspect(Everyone)).toEqual(seeded)
    const counts: Array<ReadonlyArray<number>> = []
    const Reader = Game.System("Data/ChaseChanged", {
      queries: { changed: Game.Query({ selection: { health: Game.Query.read(Health) }, filters: [Game.Query.changed(Health)] }) }
    }, ({ queries }) => { counts.push(queries.changed.each().map((entity) => queries.changed.data.health.get(entity))) })
    runtime.tick(Game.Schedule(Reader))
    counts.length = 0
    const Chase = Game.System("Data/ChaseOk", { queries: { h: Healths } }, ({ queries }) => {
      const { health } = queries.h.data
      const entities = queries.h.each()
      health.set(entities[0]!, health.get(entities[300]!) + 10_000)
    })
    runtime.tick(Game.Schedule(Chase, Reader))
    expect(counts).toEqual([[10_300]])
  })

  it("keeps a slot kept from an empty run under the stale-run check", () => {
    const runtime = make()
    let kept: (() => void) | undefined
    const Keep = Game.System("Data/KeepEmpty", { queries: { p: Positions } }, ({ queries }) => {
      const { position } = queries.p.data
      kept ??= () => {
        for (const entity of queries.p.each()) position.set(entity, { x: -1, y: -1 })
      }
    })
    runtime.tick(Game.Schedule(Keep))
    runtime.tick(seed)
    // Handed out again in this run: the kept slot is valid, and enters a page.
    expect(runtime.tick(Game.Schedule(Keep, Game.System("Data/UseKept", { queries: { p: Positions } }, ({ queries }) => {
      void queries.p.data
      kept!()
    }))).ok).toBe(true)
    // Not handed out in this run: it must fail, not write through the page it remembers.
    expect(() => runtime.tick(Game.Schedule(Game.System("Data/Late", { queries: { h: Healths } }, () => {
      kept!()
    })))).toThrow(/read queries\.x\.data again/)
  })

  it("restores a page with no numbers before a phase that failed", () => {
    const Flow = Game.StateMachine("Data/Flow", { Playing: {}, Menu: {} })
    const made = Game.Runtime.make({ services: Game.Runtime.services(), machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "Playing" })) })
    if (!made.ok) throw new Error("runtime")
    const runtime = made.value
    // The first entity holds a number, so the query picks number accessors; page 1 holds only objects.
    runtime.tick(Game.Schedule(
      Game.System("Data/SpawnMixed", { commands: Game.System.commands(Game.System.spawns(Mixed)) }, ({ commands }) => {
        commands.spawn(Game.Command.spawn([Mixed, 5]))
        for (let i = 0; i < 300; i++) commands.spawn(Game.Command.spawn([Mixed, { n: i }]))
      }),
      Game.Schedule.applyDeferred()
    ))
    const Reads = Game.Query({ selection: { mixed: Game.Query.read(Mixed) } })
    const Optional = Game.Query({ selection: { mixed: Game.Query.optional(Mixed) } })
    const Read = Game.Inspector("Data/ReadLast", { queries: { r: Reads, o: Optional } }, ({ queries }) => [
      queries.r.data.mixed.get(queries.r.each().at(-1)!),
      queries.o.data.mixed.get(queries.o.each().at(-1)!)
    ])
    const WriteObject = Game.System("Data/PhaseA", { queries: { m: Mixes } }, ({ queries }) => {
      queries.m.data.mixed.set(queries.m.each().at(-1)!, { n: -1 })
    })
    const WriteNumber = Game.System("Data/PhaseB", { queries: { m: Mixes } }, ({ queries }) => {
      queries.m.data.mixed.set(queries.m.each().at(-1)!, 99)
    })
    const Fail = Game.System("Data/PhaseC", {}, () => Result.failure("Nope" as const))
    const transitions = Game.Schedule.transitions(Game.Schedule.onExit(Flow, "Playing", [WriteObject, WriteNumber, Fail]))
    const ToMenu = Game.System("Data/ToMenu", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
      nextMachines.flow.set({ _tag: "Menu" })
    })
    expect(runtime.tick(Game.Schedule(ToMenu, Game.Schedule.applyStateTransitions(transitions))).ok).toBe(false)
    expect(runtime.inspect(Read)).toEqual([{ n: 299 }, { n: 299 }])
  })

  it("reads and writes numbers once a query that was empty at its first use has entities", () => {
    const runtime = make()
    const values: Array<number> = []
    const Bump = Game.System("Data/Bump", { queries: { h: Healths } }, ({ queries }) => {
      const { data } = queries.h
      for (const entity of queries.h.each()) {
        data.health.set(entity, data.health.get(entity) + 1)
        values.push(data.health.get(entity))
      }
    })
    runtime.tick(Game.Schedule(Bump))
    runtime.tick(seed)
    runtime.tick(Game.Schedule(Bump))
    expect(values.slice(0, 2)).toEqual([1, 2])
    expect(values).toHaveLength(600)
  })

  it("freezes what a slot writes on a debug runtime", () => {
    const made = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.test() } })
    if (!made.ok) throw new Error("runtime")
    const runtime = made.value
    runtime.tick(seed)
    const value = { x: 1, y: 2 }
    runtime.tick(Game.Schedule(Game.System("Data/Freeze", { queries: { p: Positions } }, ({ queries }) => {
      queries.p.data.position.set(queries.p.each()[0]!, value)
    })))
    expect(Object.isFrozen(value)).toBe(true)
  })

  it("throws for an entity from another runtime whose page this one does not have", () => {
    const other = make()
    other.tick(seed)
    let foreign: QueryEntity<typeof Game.schema, typeof Healths> | undefined
    other.tick(Game.Schedule(Game.System("Data/Foreign", { queries: { h: Healths } }, ({ queries }) => {
      foreign = queries.h.each()[599]!
    })))
    const runtime = make()
    runtime.tick(Game.Schedule(
      Game.System("Data/One", { commands: Game.System.commands(Game.System.spawns(Health)) }, ({ commands }) => {
        commands.spawn(Game.Command.spawn([Health, 1]))
      }),
      Game.Schedule.applyDeferred()
    ))
    expect(() => runtime.tick(Game.Schedule(Game.System("Data/UseForeign", { queries: { h: Healths } }, ({ queries }) => {
      queries.h.data.health.get(foreign!)
    })))).toThrow(/of a runtime it does not belong to/)
  })
})
