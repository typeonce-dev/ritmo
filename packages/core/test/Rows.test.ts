import { describe, expect, it } from "vitest"
import type { QueryRowOf } from "@typeonce/ritmo/Query"
import { Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"

const Health = Descriptor.Component<number>()("Rows/Health")
const Position = Descriptor.Component<{ readonly x: number; readonly y: number }>()("Rows/Position")
const Mixed = Descriptor.Component<number | { readonly n: number }>()("Rows/Mixed")
const Game = Schema.bind(Schema.fragment({ components: { Health, Position, Mixed } }))

const make = () => {
  const made = Game.Runtime.make({ services: Game.Runtime.services() })
  if (!made.ok) throw new Error("runtime")
  return made.value
}
const Healths = Game.Query({ selection: { health: Game.Query.write(Health) } })
const Positions = Game.Query({ selection: { position: Game.Query.write(Position) } })
const seed = Game.Schedule(
  Game.System("Rows/Seed", { commands: Game.System.commands(Game.System.spawns(Health, Position, Mixed)) }, ({ commands }) => {
    for (let i = 0; i < 600; i++) commands.spawn(Game.Command.spawn([Health, i], [Position, { x: i, y: 0 }], [Mixed, i]))
  }),
  Game.Schedule.applyDeferred()
)
type KeptRow = QueryRowOf<typeof Game.schema, typeof Healths>

const healthsOf = (runtime: { tick: ReturnType<typeof make>["tick"] }) => {
  const seen: Array<number> = []
  const read = Game.System("Rows/Read", { queries: { all: Game.Query({ selection: { health: Game.Query.read(Health) } }) } }, ({ queries }) => {
    for (const { data } of queries.all.each()) seen.push(data.health.get())
  })
  expect(runtime.tick(Game.Schedule(read)).ok).toBe(true)
  return seen
}

describe("rows and columns", () => {
  it("reads and writes numbers and objects, across pages, and cells see the writes", () => {
    const runtime = make()
    runtime.tick(seed)
    const positions: Array<number> = []
    expect(runtime.tick(Game.Schedule(Game.System("Rows/Write", { queries: { h: Healths, p: Positions } }, ({ queries }) => {
      const { health } = queries.h.columns()
      const { position } = queries.p.columns()
      for (const row of queries.h.rows()) health.set(row, health.get(row) + 1)
      for (const row of queries.p.rows()) position.update(row, (p) => ({ x: p.x + 1, y: p.y }))
      positions.push(position.get(queries.p.rows()[300]!).x)
    }))).ok).toBe(true)
    expect(healthsOf(runtime)).toEqual(Array.from({ length: 600 }, (_, i) => i + 1))
    expect(positions).toEqual([301])
  })

  it("a failing system's writes are rolled back: numbers, objects, and a slot that changed kind", () => {
    const runtime = make()
    runtime.tick(seed)
    const failing = Game.System("Rows/Fail", {
      queries: { h: Healths, p: Positions, m: Game.Query({ selection: { mixed: Game.Query.write(Mixed) } }) }
    }, ({ queries }) => {
      const { health } = queries.h.columns()
      const { position } = queries.p.columns()
      const { mixed } = queries.m.columns()
      for (const row of queries.h.rows()) health.set(row, -1)
      for (const row of queries.p.rows()) position.set(row, { x: -1, y: -1 })
      for (const row of queries.m.rows()) mixed.set(row, { n: 1 })
      return Result.failure("Nope" as const)
    })
    expect(runtime.tick(Game.Schedule(failing)).ok).toBe(false)
    expect(healthsOf(runtime)).toEqual(Array.from({ length: 600 }, (_, i) => i))
    const seen: Array<unknown> = []
    runtime.tick(Game.Schedule(Game.System("Rows/Check", {
      queries: { p: Game.Query({ selection: { position: Game.Query.read(Position), mixed: Game.Query.read(Mixed) } }) }
    }, ({ queries }) => {
      const { position, mixed } = queries.p.columns()
      const row = queries.p.rows()[7]!
      seen.push(position.get(row), mixed.get(row))
    })))
    expect(seen).toEqual([{ x: 7, y: 0 }, 7])
  })

  it("a slot changes kind through a column, and NaN is a value", () => {
    const runtime = make()
    runtime.tick(seed)
    const seen: Array<unknown> = []
    runtime.tick(Game.Schedule(Game.System("Rows/Kinds", {
      queries: { m: Game.Query({ selection: { mixed: Game.Query.write(Mixed) } }), h: Healths }
    }, ({ queries }) => {
      const { mixed } = queries.m.columns()
      const { health } = queries.h.columns()
      const row = queries.m.rows()[3]!
      const other = queries.h.rows()[3]!
      mixed.set(row, { n: 5 })
      seen.push(mixed.get(row))
      mixed.set(row, 9)
      seen.push(mixed.get(row))
      health.set(other, Number.NaN)
      seen.push(health.get(other))
    })))
    expect(seen).toEqual([{ n: 5 }, 9, Number.NaN])
    expect(healthsOf(runtime)[3]).toBeNaN()
  })

  it("an equal write, and A to B to A, are not changes; a real write is, once, for the next reader", () => {
    const runtime = make()
    runtime.tick(seed)
    const counts: Array<number> = []
    const Reader = Game.System("Rows/Changed", {
      queries: { changed: Game.Query({ selection: { health: Game.Query.read(Health) }, filters: [Game.Query.changed(Health)] }) }
    }, ({ queries }) => { counts.push(queries.changed.rows().length) })
    runtime.tick(Game.Schedule(Reader))
    counts.length = 0
    const Same = Game.System("Rows/Same", { queries: { h: Healths } }, ({ queries }) => {
      const { health } = queries.h.columns()
      for (const row of queries.h.rows()) health.set(row, health.get(row))
    })
    const AndBack = Game.System("Rows/AndBack", { queries: { h: Healths } }, ({ queries }) => {
      const { health } = queries.h.columns()
      for (const row of queries.h.rows()) {
        const value = health.get(row)
        health.set(row, value + 1)
        health.set(row, value)
      }
    })
    const Two = Game.System("Rows/Two", { queries: { h: Healths } }, ({ queries }) => {
      const { health } = queries.h.columns()
      const rows = queries.h.rows()
      health.set(rows[0]!, 1000)
      health.set(rows[300]!, 1000)
    })
    runtime.tick(Game.Schedule(Same, Reader))
    runtime.tick(Game.Schedule(AndBack, Reader))
    runtime.tick(Game.Schedule(Two, Reader))
    runtime.tick(Game.Schedule(Reader))
    expect(counts).toEqual([0, 0, 2, 0])
  })

  it("a column kept past its run throws, naming the fix; a new hand-out makes it valid again", () => {
    const runtime = make()
    runtime.tick(seed)
    let kept: { get(row: KeptRow): number } | undefined
    let row: KeptRow | undefined
    runtime.tick(Game.Schedule(Game.System("Rows/Keep", { queries: { h: Healths } }, ({ queries }) => {
      kept = queries.h.columns().health
      row = queries.h.rows()[0]!
    })))
    expect(() => kept!.get(row!)).toThrow(/Rows\/Health was used after the run/)
    expect(() => runtime.tick(Game.Schedule(Game.System("Rows/Late", { queries: { p: Positions } }, () => { kept!.get(row!) })))).toThrow(/read the query's columns again/)
  })

  it("a kept row never reads another entity: it follows its entity, and throws once the component or entity is gone", () => {
    const runtime = make()
    runtime.tick(seed)
    let row: KeptRow | undefined
    let id: number | undefined
    runtime.tick(Game.Schedule(Game.System("Rows/Keep", { queries: { h: Healths } }, ({ queries }) => {
      row = queries.h.rows()[5]!
      id = row.id
    })))
    const read = (outcome: Array<unknown>) => Game.System("Rows/ReadKept", { queries: { h: Healths } }, ({ queries }) => {
      const { health } = queries.h.columns()
      try { outcome.push(health.get(row!)) } catch (error) { outcome.push((error as Error).message) }
    })
    const first: Array<unknown> = []
    runtime.tick(Game.Schedule(read(first)))
    expect(first).toEqual([5])
    const despawning = runtime.tick(Game.Schedule(
      Game.System("Rows/Despawn", {
        queries: { h: Healths },
        commands: Game.System.commands(Game.System.despawns(Health))
      }, ({ queries, commands }) => {
        const target = queries.h.rows().find((candidate) => candidate.id === id)
        commands.despawn(target!)
      }),
      Game.Schedule.applyDeferred(),
      Game.System("Rows/Respawn", { commands: Game.System.commands(Game.System.spawns(Health)) }, ({ commands }) => { commands.spawn(Game.Command.spawn([Health, 99])) }),
      Game.Schedule.applyDeferred()
    ))
    expect(despawning.ok).toBe(true)
    expect(healthsOf(runtime)).not.toContain(5)
    const second: Array<unknown> = []
    runtime.tick(Game.Schedule(read(second)))
    expect(String(second[0])).toMatch(/despawned/)
  })

  it("rows go to commands; structural changes apply at applyDeferred and new rows appear", () => {
    const runtime = make()
    runtime.tick(seed)
    const counts: Array<number> = []
    runtime.tick(Game.Schedule(
      Game.System("Rows/Remove", {
        queries: { h: Game.Query({ selection: { health: Game.Query.read(Health) } }) },
        commands: Game.System.commands(Game.System.despawns(Health))
      }, ({ queries, commands }) => {
        const rows = queries.h.rows()
        counts.push(rows.length)
        for (let i = 0; i < 100; i++) commands.despawn(rows[i]!)
        counts.push(queries.h.rows().length)
      }),
      Game.Schedule.applyDeferred(),
      Game.System("Rows/Count", { queries: { h: Game.Query({ selection: { health: Game.Query.read(Health) } }) } }, ({ queries }) => {
        counts.push(queries.h.rows().length, queries.h.each().length)
      })
    ))
    expect(counts).toEqual([600, 600, 500, 500])
  })

  it("a checkpoint rewinds writes made through columns, and columns read the restored values", () => {
    const made = Game.Runtime.make({ services: Game.Runtime.services(), checkpoints: 4 })
    if (!made.ok) throw new Error("runtime")
    const runtime = made.value
    runtime.tick(seed)
    const write = Game.System("Rows/Write", { queries: { h: Healths, p: Positions } }, ({ queries }) => {
      const { health } = queries.h.columns()
      const { position } = queries.p.columns()
      for (const row of queries.h.rows()) health.set(row, 0)
      for (const row of queries.p.rows()) position.set(row, { x: -1, y: -1 })
    })
    const simulate = Game.Schedule(write)
    const taken = runtime.checkpoint(simulate)
    expect(runtime.tick(simulate).ok).toBe(true)
    expect(healthsOf(runtime)[100]).toBe(0)
    expect(runtime.rewind(taken).ok).toBe(true)
    const seen: Array<unknown> = []
    const read = Game.System("Rows/Restored", {
      queries: { h: Game.Query({ selection: { health: Game.Query.read(Health), position: Game.Query.read(Position) } }) }
    }, ({ queries }) => {
      const { health, position } = queries.h.columns()
      const rows = queries.h.rows()
      seen.push(rows.length, health.get(rows[100]!), position.get(rows[599]!))
    })
    expect(runtime.tick(Game.Schedule(read)).ok).toBe(true)
    expect(seen).toEqual([600, 100, { x: 599, y: 0 }])
  })

  it("a query empty at its first hand-out reads and writes numbers once it has rows", () => {
    const runtime = make()
    const values: Array<number> = []
    const Bump = Game.System("Rows/Bump", { queries: { h: Healths } }, ({ queries }) => {
      const { health } = queries.h.columns()
      for (const row of queries.h.rows()) { health.set(row, health.get(row) + 1); values.push(health.get(row)) }
    })
    runtime.tick(Game.Schedule(Bump))
    runtime.tick(seed)
    runtime.tick(Game.Schedule(Bump))
    expect(values.slice(0, 2)).toEqual([1, 2])
    expect(values).toHaveLength(600)
  })

  it("a debug runtime freezes what a column writes", () => {
    const made = Game.Runtime.make({ services: Game.Runtime.services(), debug: { hostClock: HostClock.test() } })
    if (!made.ok) throw new Error("runtime")
    const runtime = made.value
    runtime.tick(seed)
    const value = { x: 1, y: 2 }
    runtime.tick(Game.Schedule(Game.System("Rows/Freeze", { queries: { p: Positions } }, ({ queries }) => {
      const { position } = queries.p.columns()
      position.set(queries.p.rows()[0]!, value)
    })))
    expect(Object.isFrozen(value)).toBe(true)
  })
})
