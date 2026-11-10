import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import * as Codecs from "../test/codecs.ts"
import type { SpawnedId } from "@typeonce/ritmo/Command"
import type { EntityId } from "@typeonce/ritmo/Entity"
import type { OptionalSlot, Query } from "@typeonce/ritmo/Query"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ x: number; y: number }>()("Cells/Position")
const Tags = Descriptor.Component<{ readonly names: Array<string> }>()("Cells/Tags")
const Health = Descriptor.Component<number>()("Cells/Health")
const Safe = Descriptor.ConstructedComponent(Codecs.safeVector)("Cells/Safe")
const Label = Descriptor.ConstructedComponent(Codecs.string)("Cells/Label")
const Frozen = Descriptor.Tag("Cells/Frozen")

const Root = Schema.defineRoot("Cells")
const Game = Schema.bind(Schema.fragment({ components: { Position, Tags, Health, Safe, Label, Frozen } }), Root)
const OtherRoot = Schema.defineRoot("Cells/Other")
const Other = Schema.bind(Schema.fragment({ components: { Health } }), OtherRoot)

describe("query slots", () => {
  it("read slots return deeply readonly values and cannot write", () => {
    Game.System("Cells/Read", {
      queries: { items: Game.Query({ selection: { position: Game.Query.read(Position), tags: Game.Query.read(Tags) } }) }
    }, ({ queries }) => {
      const { data } = queries.items
      for (const entity of queries.items.each()) {
        expect(data.position.get(entity)).type.toBe<{ readonly x: number; readonly y: number }>()
        expect(data.tags.get(entity)).type.toBe<{ readonly names: ReadonlyArray<string> }>()
        expect(data.position).type.not.toHaveProperty("set")
        // @ts-expect-error Cannot assign to 'x' because it is a read-only property
        data.position.get(entity).x = 1
        // @ts-expect-error Property 'push' does not exist on type 'readonly string[]'
        data.tags.get(entity).names.push("a")
      }
    })
  })

  it("write slots take the component's value; constructed ones also validate raw input", () => {
    Game.System("Cells/Write", {
      queries: {
        items: Game.Query({ selection: { health: Game.Query.write(Health), safe: Game.Query.write(Safe), label: Game.Query.write(Label) } })
      }
    }, ({ queries }) => {
      const { data } = queries.items
      for (const entity of queries.items.each()) {
        expect(data.health.set).type.toBeCallableWith(entity, 3)
        expect(data.health.set).type.not.toBeCallableWith(entity, "3")
        expect(data.health.update).type.toBeCallableWith(entity, (health: number) => health + 1)
        expect(data.health).type.not.toHaveProperty("setRaw")
        expect(data.safe.setRaw(entity, { x: 1, y: 2 })).type.toBe<Result.Result<void, Descriptor.SchemaIssues>>()
        // A plain object is not a validated (branded) vector: go through setRaw.
        expect(data.safe.set).type.not.toBeCallableWith(entity, { x: 1, y: 2 })
        expect(data.label.setRaw).type.toBeCallableWith(entity, "name")
        expect(data.label.setRaw).type.not.toBeCallableWith(entity, 1)
      }
    })
  })

  it("optional slots read a value or undefined, which must be narrowed", () => {
    Game.System("Cells/Optional", {
      queries: { items: Game.Query({ selection: { health: Game.Query.optional(Health) } }) }
    }, ({ queries }) => {
      const { data } = queries.items
      for (const entity of queries.items.each()) {
        expect(data.health).type.toBe<OptionalSlot<number>>()
        expect(data.health.get(entity)).type.toBe<number | undefined>()
        // @ts-expect-error Object is possibly 'undefined'
        data.health.get(entity).toFixed()
        expect(data.health).type.not.toHaveProperty("set")
      }
    })
  })

  it("relation slots read ids; optional ones read undefined while the entity lacks the relation", () => {
    const { relation: ChildOf } = Descriptor.Hierarchy("Cells/ChildOf", "Cells/Children")
    const Linked = Schema.bind(Schema.fragment({ components: { Health }, relations: { ChildOf } }), Root)
    Linked.System("Cells/OptionalRelation", {
      queries: {
        items: Linked.Query({ selection: { parent: Linked.Query.optionalRelation(ChildOf), children: Linked.Query.optionalRelated(ChildOf) } }),
        parented: Linked.Query({ selection: { parent: Linked.Query.readRelation(ChildOf), health: Linked.Query.read(Health) } })
      }
    }, ({ queries }) => {
      const { data } = queries.items
      for (const entity of queries.items.each()) {
        expect(data.parent).type.toBe<OptionalSlot<EntityId<typeof Linked.schema, typeof Root>>>()
        expect(data.children).type.toBe<OptionalSlot<ReadonlyArray<EntityId<typeof Linked.schema, typeof Root>>>>()
        expect(data.parent.get(entity)).type.toBe<EntityId<typeof Linked.schema, typeof Root> | undefined>()
        // A required relation slot needs an entity whose query proves the relation.
        expect(queries.parented.data.parent.get).type.not.toBeCallableWith(entity)
      }
      for (const entity of queries.parented.each()) {
        expect(queries.parented.data.parent.get(entity)).type.toBe<EntityId<typeof Linked.schema, typeof Root>>()
      }
    })
  })

  it("filters add no slots, and slots must be declared", () => {
    Game.System("Cells/Filters", {
      queries: {
        items: Game.Query({ selection: { health: Game.Query.read(Health) }, with: [Frozen], without: [Position] })
      }
    }, ({ queries }) => {
      const { data } = queries.items
      for (const entity of queries.items.each()) {
        expect(data).type.not.toHaveProperty("frozen")
        expect(data).type.not.toHaveProperty("position")
        expect(entity.id).type.toBe<EntityId<typeof Game.schema, typeof Root>>()
      }
      expect(queries.items.single()).type.toBe<Result.Result<(typeof queries.items.each extends () => ReadonlyArray<infer M> ? M : never), Query.SingleError>>()
    })
  })

  it("queries only accept descriptors of their schema", () => {
    // @ts-expect-error Type '"Cells/Frozen"' is not assignable to type '"Cells/Health"'
    Other.Query.read(Frozen)
  })
})

describe("commands", () => {
  it("spawn returns a typed id and insert checks each entry against its descriptor", () => {
    Game.System("Cells/Commands", {
      commands: Game.System.commands(
        Game.System.spawns(Health),
        Game.System.inserts(Health, Position),
        Game.System.removes(Health),
        Game.System.despawns(Health)
      )
    }, ({ commands }) => {
      const id = commands.spawn(Game.Command.spawn([Health, 1]))
      expect(id).type.toBe<SpawnedId<typeof Game.schema, typeof Root, "Cells/Health">>()
      expect(id).type.toBeAssignableTo<EntityId<typeof Game.schema, typeof Root>>()
      expect(commands.insert).type.toBeCallableWith(id, [Health, 2], [Position, { x: 0, y: 0 }])
      expect(commands.insert).type.not.toBeCallableWith(id, [Health, "2"])
      expect(commands.insert).type.not.toBeCallableWith(id, [Position, 2])
      expect(commands.remove).type.toBeCallableWith(id, Health)
      expect(commands.despawn).type.not.toBeCallableWith(1)
    })
  })
})

describe("writes take what reads return", () => {
  it("writes a value read from another cell back without a copy", () => {
    const Bag = Descriptor.Component<{ items: Array<number> }>()("Cells/Bag")
    const Hit = Descriptor.Event<{ amount: number }>()("Cells/Hit")
    const Game = Schema.bind(Schema.fragment({ components: { Bag }, events: { Hit } }), Root)
    const Bags = Game.Query({ selection: { bag: Game.Query.write(Bag) } })
    Game.System("Cells/Copy", {
      queries: { bags: Bags },
      events: { read: Game.System.readEvent(Hit), write: Game.System.writeEvent(Hit) },
      commands: Game.System.commands(Game.System.spawns(Bag))
    }, ({ queries, events, commands }) => {
      const [first, second] = queries.bags.each()
      if (first === undefined || second === undefined) return
      const { data } = queries.bags
      const read = data.bag.get(first)
      expect(read).type.toBe<{ readonly items: ReadonlyArray<number> }>()
      data.bag.set(second, read)
      data.bag.update(second, (current) => current)
      commands.spawn(Game.Command.spawn([Bag, read]))
      commands.spawn(Game.Command.spawn([Bag, read]))
      for (const hit of events.read.all()) events.write.emit(hit)
      // @ts-expect-error Type 'string' is not assignable to type 'number'
      data.bag.set(second, { items: ["a"] })
    })
  })
})
