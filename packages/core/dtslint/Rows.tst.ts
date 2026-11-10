import { Descriptor, Schema } from "@typeonce/ritmo"
import type { EntityId } from "@typeonce/ritmo/Entity"
import type { QueryRow, QueryValues } from "@typeonce/ritmo/Query"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ x: number; y: number }>()("Rows/Position")
const Health = Descriptor.Component<number>()("Rows/Health")
const Shield = Descriptor.Component<{ charges: number }>()("Rows/Shield")
const Phase = Descriptor.EntityState("Rows/Phase", { idle: {}, busy: {} })
const Root = Schema.defineRoot("Rows")
const Game = Schema.bind(Schema.fragment({ components: { Position, Health, Shield, Phase } }), Root)

const Units = Game.Query({
  selection: {
    position: Game.Query.write(Position),
    health: Game.Query.read(Health),
    shield: Game.Query.optional(Shield),
    phase: Game.Query.read(Phase)
  }
})

describe("queries.x.rows()", () => {
  it("holds each entity's id and the values its slots read", () => {
    Game.System("Rows/Values", { queries: { units: Units } }, ({ queries }) => {
      const rows = queries.units.rows()
      expect(rows).type.toBe<ReadonlyArray<QueryRow<typeof Game.schema, typeof Units>>>()
      const row = rows[0]!
      expect(row.id).type.toBe<EntityId<typeof Game.schema, typeof Root>>()
      expect(row.values).type.toBe<QueryValues<typeof Units>>()
      expect(row.values.position).type.toBe<{ readonly x: number; readonly y: number }>()
      expect(row.values.health).type.toBe<number>()
      expect(row.values.shield).type.toBe<{ readonly charges: number } | undefined>()
      expect(row.values.phase).type.toBe<{ readonly _tag: "idle" } | { readonly _tag: "busy" }>()
    })
  })

  it("a value is what the slot's get returns", () => {
    Game.System("Rows/SameAsGet", { queries: { units: Units } }, ({ queries }) => {
      const { data } = queries.units
      for (const entity of queries.units.each()) {
        const values: QueryValues<typeof Units> = {
          position: data.position.get(entity),
          health: data.health.get(entity),
          shield: data.shield.get(entity),
          phase: data.phase.get(entity)
        }
        void values
      }
    })
  })

  it("values are read-only and only the selection's slots exist", () => {
    Game.System("Rows/ReadOnly", { queries: { units: Units } }, ({ queries }) => {
      const row = queries.units.rows()[0]!
      // @ts-expect-error Cannot assign to 'health' because it is a read-only property
      row.values.health = 1
      // @ts-expect-error Cannot assign to 'x' because it is a read-only property
      row.values.position.x = 1
      // @ts-expect-error Property 'velocity' does not exist
      void row.values.velocity
    })
  })

  it("a row carries the id, not the entity: data does not take it", () => {
    Game.System("Rows/NotAnEntity", { queries: { units: Units } }, ({ queries }) => {
      const row = queries.units.rows()[0]!
      expect(queries.units.data.health.get).type.not.toBeCallableWith(row.id)
      expect(queries.units.data.health.get).type.not.toBeCallableWith(row)
      expect(queries.units.get).type.toBeCallableWith(row.id)
    })
  })

  it("a query with filters has rows too", () => {
    const Moved = Game.Query({ selection: { position: Game.Query.read(Position) }, filters: [Game.Query.changed(Position)] })
    Game.System("Rows/Filtered", { queries: { moved: Moved } }, ({ queries }) => {
      expect(queries.moved.rows()[0]!.values.position).type.toBe<{ readonly x: number; readonly y: number }>()
    })
  })
})
