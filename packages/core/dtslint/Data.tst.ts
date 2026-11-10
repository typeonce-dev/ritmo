import { Descriptor, Schema } from "@typeonce/ritmo"
import type { EntityRef } from "@typeonce/ritmo/Entity"
import type { EntityProving, QueryData, QueryEntity, ReadSlot, WriteSlot } from "@typeonce/ritmo/Query"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ x: number; y: number }>()("Data/Position")
const Velocity = Descriptor.Component<{ x: number; y: number }>()("Data/Velocity")
const Health = Descriptor.Component<number>()("Data/Health")
const Root = Schema.defineRoot("Data")
const Game = Schema.bind(Schema.fragment({ components: { Position, Velocity, Health } }), Root)

const Movers = Game.Query({ selection: { position: Game.Query.write(Position), velocity: Game.Query.read(Velocity) } })
const Healths = Game.Query({ selection: { health: Game.Query.read(Health) } })

describe("a query's data and entities", () => {
  it("data gives what was declared: a read slot cannot write", () => {
    Game.System("Data/Declared", { queries: { movers: Movers } }, ({ queries }) => {
      const { data } = queries.movers
      expect(data).type.toBe<QueryData<typeof Movers>>()
      expect(data.position).type.toBe<WriteSlot<{ x: number; y: number }, typeof Position>>()
      expect(data.velocity).type.toBe<ReadSlot<{ x: number; y: number }, typeof Velocity>>()
      expect(data.velocity).type.not.toHaveProperty("set")
      expect(data.velocity).type.not.toHaveProperty("update")
      for (const entity of queries.movers.each()) {
        expect(data.position.get(entity)).type.toBe<{ readonly x: number; readonly y: number }>()
        // @ts-expect-error Property 'set' does not exist on type 'ReadSlot
        data.velocity.set(entity, { x: 0, y: 0 })
        // @ts-expect-error Cannot assign to 'x' because it is a read-only property
        data.position.get(entity).x = 1
      }
    })
  })

  it("a write takes the component's value", () => {
    Game.System("Data/Value", { queries: { movers: Movers } }, ({ queries }) => {
      const { data } = queries.movers
      for (const entity of queries.movers.each()) {
        data.position.set(entity, { x: 1, y: 2 })
        // @ts-expect-error Property 'y' is missing
        data.position.set(entity, { x: 1 })
        // @ts-expect-error Type 'string' is not assignable to type 'number'
        data.position.set(entity, { x: "1", y: 2 })
      }
    })
  })

  it("only slots a query selected exist", () => {
    Game.System("Data/Selected", { queries: { healths: Healths } }, ({ queries }) => {
      expect(queries.healths.data).type.not.toHaveProperty("position")
      // @ts-expect-error Property 'position' does not exist
      void queries.healths.data.position
    })
  })

  it("an entity only reaches components its query proves", () => {
    Game.System("Data/Proof", { queries: { movers: Movers, healths: Healths } }, ({ queries }) => {
      const movers = queries.movers.data
      const healths = queries.healths.data
      for (const entity of queries.healths.each()) {
        expect(healths.health.get(entity)).type.toBe<number>()
        expect(movers.position.get).type.not.toBeCallableWith(entity)
      }
      for (const entity of queries.movers.each()) {
        expect(movers.position.get).type.toBeCallableWith(entity)
        expect(healths.health.get).type.not.toBeCallableWith(entity)
      }
    })
  })

  it("an entity from another query works when that query proves the component too", () => {
    const AlsoPositions = Game.Query({ selection: { position: Game.Query.read(Position) } })
    Game.System("Data/Shared", { queries: { movers: Movers, also: AlsoPositions } }, ({ queries }) => {
      const { data } = queries.movers
      for (const entity of queries.also.each()) {
        expect(data.position.get).type.toBeCallableWith(entity)
      }
    })
  })

  it("only an entity from a query is one: an id or a hand-written object is not", () => {
    Game.System("Data/OnlyEntities", { queries: { movers: Movers } }, ({ queries }) => {
      const { data } = queries.movers
      for (const entity of queries.movers.each()) {
        expect(data.position.get).type.toBeCallableWith(entity)
        expect(data.position.get).type.not.toBeCallableWith(entity.id)
        expect(data.position.get).type.not.toBeCallableWith({ kind: "EntityRef", id: entity.id })
      }
    })
  })

  it("entities carry what the query proves to commands", () => {
    Game.System("Data/Commands", {
      queries: { movers: Movers },
      commands: Game.System.commands(Game.System.despawns(Position), Game.System.removes(Velocity))
    }, ({ queries, commands }) => {
      for (const entity of queries.movers.each()) {
        commands.despawn(entity)
        commands.remove(entity, Velocity)
      }
    })
    Game.System("Data/CommandsWrong", {
      queries: { healths: Healths },
      commands: Game.System.commands(Game.System.despawns(Position))
    }, ({ queries, commands }) => {
      for (const entity of queries.healths.each()) {
        // @ts-expect-error __fixCommands__
        commands.despawn(entity)
      }
    })
  })

  it("the entity type names the proof, and a helper types with it", () => {
    Game.System("Data/Type", { queries: { healths: Healths } }, ({ queries }) => {
      expect(queries.healths.each()).type.toBe<ReadonlyArray<QueryEntity<typeof Game.schema, typeof Healths>>>()
      for (const entity of queries.healths.each()) {
        expect(entity).type.toBeAssignableTo<EntityProving<typeof Health>>()
        expect(entity).type.not.toBeAssignableTo<EntityProving<typeof Position>>()
        expect(entity).type.toBeAssignableTo<EntityRef<typeof Game.schema, typeof Root, typeof Health>>()
      }
    })
  })
})
