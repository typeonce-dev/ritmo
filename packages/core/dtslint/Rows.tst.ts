import { Descriptor, Schema } from "@typeonce/ritmo"
import type { ReadColumn, RowProving, WriteColumn } from "@typeonce/ritmo/Query"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ x: number; y: number }>()("Rows/Position")
const Velocity = Descriptor.Component<{ x: number; y: number }>()("Rows/Velocity")
const Health = Descriptor.Component<number>()("Rows/Health")
const Game = Schema.bind(Schema.fragment({ components: { Position, Velocity, Health } }))

const Movers = Game.Query({ selection: { position: Game.Query.write(Position), velocity: Game.Query.read(Velocity) } })
const Healths = Game.Query({ selection: { health: Game.Query.read(Health) } })

describe("rows and columns", () => {
  it("columns give what was declared: a read slot cannot write", () => {
    Game.System("Rows/Declared", { queries: { movers: Movers } }, ({ queries }) => {
      const { position, velocity } = queries.movers.columns()
      expect(position).type.toBe<WriteColumn<typeof Position>>()
      expect(velocity).type.toBe<ReadColumn<typeof Velocity>>()
      expect(velocity).type.not.toHaveProperty("set")
      expect(velocity).type.not.toHaveProperty("update")
      for (const row of queries.movers.rows()) {
        expect(position.get(row)).type.toBe<{ readonly x: number; readonly y: number }>()
        // @ts-expect-error Property 'set' does not exist on type 'ReadColumn
        velocity.set(row, { x: 0, y: 0 })
        // @ts-expect-error Cannot assign to 'x' because it is a read-only property
        position.get(row).x = 1
      }
    })
  })

  it("a write takes the component's value", () => {
    Game.System("Rows/Value", { queries: { movers: Movers } }, ({ queries }) => {
      const { position } = queries.movers.columns()
      for (const row of queries.movers.rows()) {
        position.set(row, { x: 1, y: 2 })
        // @ts-expect-error Property 'y' is missing
        position.set(row, { x: 1 })
        // @ts-expect-error Type 'string' is not assignable to type 'number'
        position.set(row, { x: "1", y: 2 })
      }
    })
  })

  it("a row only reaches components its query proves", () => {
    Game.System("Rows/Proof", { queries: { movers: Movers, healths: Healths } }, ({ queries }) => {
      const { position } = queries.movers.columns()
      const { health } = queries.healths.columns()
      for (const row of queries.healths.rows()) {
        expect(health.get(row)).type.toBe<number>()
        expect(position.get).type.not.toBeCallableWith(row)
      }
      for (const row of queries.movers.rows()) {
        expect(position.get).type.toBeCallableWith(row)
        expect(health.get).type.not.toBeCallableWith(row)
      }
    })
  })

  it("only a row is a row: an id or a hand-written object is not", () => {
    Game.System("Rows/OnlyRows", { queries: { movers: Movers } }, ({ queries }) => {
      const { position } = queries.movers.columns()
      for (const row of queries.movers.rows()) {
        expect(position.get).type.toBeCallableWith(row)
        expect(position.get).type.not.toBeCallableWith(row.id)
        expect(position.get).type.not.toBeCallableWith({ kind: "EntityRef", id: row.id })
      }
    })
  })

  it("rows carry what the query proves to commands", () => {
    Game.System("Rows/Commands", {
      queries: { movers: Movers },
      commands: Game.System.commands(Game.System.despawns(Position), Game.System.removes(Velocity))
    }, ({ queries, commands }) => {
      for (const row of queries.movers.rows()) {
        commands.despawn(row)
        commands.remove(row, Velocity)
      }
    })
    Game.System("Rows/CommandsWrong", {
      queries: { healths: Healths },
      commands: Game.System.commands(Game.System.despawns(Position))
    }, ({ queries, commands }) => {
      for (const row of queries.healths.rows()) {
        // @ts-expect-error __fixCommands__
        commands.despawn(row)
      }
    })
  })

  it("the row type names the proof", () => {
    Game.System("Rows/Type", { queries: { healths: Healths } }, ({ queries }) => {
      for (const row of queries.healths.rows()) {
        expect(row).type.toBeAssignableTo<RowProving<typeof Health>>()
        expect(row).type.not.toBeAssignableTo<RowProving<typeof Position>>()
      }
    })
  })
})
