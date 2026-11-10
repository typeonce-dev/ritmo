import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"

const Position = Descriptor.Component<{ readonly x: number; readonly y: number }>()("Rows/Position")
const Health = Descriptor.Component<number>()("Rows/Health")
const Shield = Descriptor.Component<{ readonly charges: number }>()("Rows/Shield")
const Enemy = Descriptor.Tag("Rows/Enemy")
const Root = Schema.defineRoot("Rows")
const Game = Schema.bind(Schema.fragment({ components: { Position, Health, Shield, Enemy } }), Root)

const make = (debug = false) => {
  const made = Game.Runtime.make({ services: Game.Runtime.services(), ...(debug ? { debug: { hostClock: HostClock.test() } } : {}) })
  if (!made.ok) throw new Error("runtime")
  return made.value
}

// 300 entities spans several storage pages; every third has a shield, every other is an enemy.
const seed = Game.Schedule(
  Game.System("Rows/Seed", { commands: Game.System.commands(Game.System.spawns(Position, Health, Shield, Enemy)) }, ({ commands }) => {
    for (let i = 0; i < 300; i++) {
      const base = Game.Command.spawn([Position, { x: i, y: i * 10 }], [Health, i])
      const shielded = i % 3 === 0 ? Game.Command.extend(base, [Shield, { charges: i }]) : base
      commands.spawn(i % 2 === 0 ? Game.Command.extend(shielded, [Enemy, {}]) : shielded)
    }
  }),
  Game.Schedule.applyDeferred()
)

const Units = Game.Query({
  selection: { position: Game.Query.read(Position), health: Game.Query.read(Health), shield: Game.Query.optional(Shield) },
  with: [Enemy]
})
const UnitRows = Game.Inspector("Rows/Units", { queries: { units: Units } }, ({ queries }) => queries.units.rows())

describe("queries.x.rows()", () => {
  it("reads every entity of the query into plain values, in each() order", () => {
    const runtime = make()
    runtime.tick(seed)
    const rows = runtime.inspect(UnitRows)

    expect(rows).toHaveLength(150)
    expect(rows.slice(0, 4)).toEqual([
      { id: rows[0]!.id, values: { position: { x: 0, y: 0 }, health: 0, shield: { charges: 0 } } },
      { id: rows[1]!.id, values: { position: { x: 2, y: 20 }, health: 2, shield: undefined } },
      { id: rows[2]!.id, values: { position: { x: 4, y: 40 }, health: 4, shield: undefined } },
      { id: rows[3]!.id, values: { position: { x: 6, y: 60 }, health: 6, shield: { charges: 6 } } }
    ])
    expect(rows.map((row) => row.values.health)).toEqual(Array.from({ length: 150 }, (_, i) => i * 2))
    const ids = Game.Inspector("Rows/Ids", { queries: { units: Units } }, ({ queries }) => queries.units.each().map((entity) => entity.id))
    expect(rows.map((row) => row.id)).toEqual(runtime.inspect(ids))
  })

  it("keeps its values after the run, while the world moves on", () => {
    const runtime = make()
    runtime.tick(seed)
    const before = runtime.inspect(UnitRows)
    const Heal = Game.System("Rows/Heal", { queries: { units: Game.Query({ selection: { health: Game.Query.write(Health) } }) } }, ({ queries }) => {
      const { data } = queries.units
      for (const entity of queries.units.each()) data.health.update(entity, (health) => health + 1000)
    })
    runtime.tick(Game.Schedule(Heal))

    expect(before[1]!.values.health).toBe(2)
    expect(runtime.inspect(UnitRows)[1]!.values.health).toBe(1002)
  })

  it("follows the query's filters", () => {
    const runtime = make()
    runtime.tick(seed)
    const seen: Array<ReadonlyArray<number>> = []
    const Moved = Game.System("Rows/Moved", {
      queries: { moved: Game.Query({ selection: { position: Game.Query.read(Position) }, filters: [Game.Query.changed(Position)] }) }
    }, ({ queries }) => {
      seen.push(queries.moved.rows().map((row) => row.values.position.x))
    })
    const MoveTen = Game.System("Rows/MoveTen", { queries: { all: Game.Query({ selection: { position: Game.Query.write(Position) } }) } }, ({ queries }) => {
      const { data } = queries.all
      const entity = queries.all.each()[10]!
      data.position.update(entity, (position) => ({ x: position.x + 0.5, y: position.y }))
    })
    runtime.tick(Game.Schedule(Moved))
    runtime.tick(Game.Schedule(MoveTen, Moved))

    expect(seen[0]).toHaveLength(300)
    expect(seen[1]).toEqual([10.5])
  })

  it("an empty query has no rows", () => {
    expect(make().inspect(UnitRows)).toEqual([])
  })

  it("a row's id resolves the entity in a later run", () => {
    const runtime = make(true)
    runtime.tick(seed)
    const kept = runtime.inspect(UnitRows)[5]!
    const Resolve = Game.Inspector("Rows/Resolve", { queries: { units: Units } }, ({ queries }) => {
      const found = queries.units.get(kept.id)
      return found.ok ? queries.units.data.health.get(found.value) : undefined
    })

    expect(runtime.inspect(Resolve)).toBe(kept.values.health)
  })
})
