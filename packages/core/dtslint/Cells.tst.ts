import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import * as Codecs from "../test/codecs.ts"
import type { SpawnedId } from "@typeonce/ritmo/Command"
import type { EntityId } from "@typeonce/ritmo/Entity"
import type { Query, ReadCell } from "@typeonce/ritmo/Query"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ x: number; y: number }>()("Cells/Position")
const Tags = Descriptor.Component<{ readonly names: Array<string> }>()("Cells/Tags")
const Health = Descriptor.Component<number>()("Cells/Health")
const Safe = Descriptor.ConstructedComponent(Codecs.safeVector)("Cells/Safe")
const Label = Descriptor.ConstructedComponent(Codecs.string)("Cells/Label")
const Frozen = Descriptor.Tag("Cells/Frozen")

const Game = Schema.bind(Schema.fragment({ components: { Position, Tags, Health, Safe, Label, Frozen } }))
const Other = Schema.bind(Schema.fragment({ components: { Health } }))

describe("query cells", () => {
  it("read cells return deeply readonly values and cannot write", () => {
    Game.System("Cells/Read", {
      queries: { items: Game.Query({ selection: { position: Game.Query.read(Position), tags: Game.Query.read(Tags) } }) }
    }, ({ queries }) => {
      for (const { data } of queries.items.each()) {
        expect(data.position.get()).type.toBe<{ readonly x: number; readonly y: number }>()
        expect(data.tags.get()).type.toBe<{ readonly names: ReadonlyArray<string> }>()
        expect(data.position).type.not.toHaveProperty("set")
        // @ts-expect-error Cannot assign to 'x' because it is a read-only property
        data.position.get().x = 1
        // @ts-expect-error Property 'push' does not exist on type 'readonly string[]'
        data.tags.get().names.push("a")
      }
    })
  })

  it("write cells take the component's value; constructed ones also validate raw input", () => {
    Game.System("Cells/Write", {
      queries: {
        items: Game.Query({ selection: { health: Game.Query.write(Health), safe: Game.Query.write(Safe), label: Game.Query.write(Label) } })
      }
    }, ({ queries }) => {
      for (const { data } of queries.items.each()) {
        expect(data.health.set).type.toBeCallableWith(3)
        expect(data.health.set).type.not.toBeCallableWith("3")
        expect(data.health.update).type.toBeCallableWith((health: number) => health + 1)
        expect(data.health).type.not.toHaveProperty("setRaw")
        expect(data.safe.setRaw({ x: 1, y: 2 })).type.toBe<Result.Result<void, Descriptor.SchemaIssues>>()
        // A plain object is not a validated (branded) vector: go through setRaw.
        expect(data.safe.set).type.not.toBeCallableWith({ x: 1, y: 2 })
        expect(data.label.setRaw).type.toBeCallableWith("name")
        expect(data.label.setRaw).type.not.toBeCallableWith(1)
      }
    })
  })

  it("optional slots are a read cell or undefined, and must be narrowed before reading", () => {
    Game.System("Cells/Optional", {
      queries: { items: Game.Query({ selection: { health: Game.Query.optional(Health) } }) }
    }, ({ queries }) => {
      for (const { data } of queries.items.each()) {
        expect(data.health).type.toBe<ReadCell<number> | undefined>()
        // @ts-expect-error 'data.health' is possibly 'undefined'
        data.health.get()
        expect(data.health?.get()).type.toBe<number | undefined>()
        if (data.health !== undefined) expect(data.health.get()).type.toBe<number>()
        if (data.health !== undefined) {
          expect(data.health).type.not.toHaveProperty("present")
          expect(data.health).type.not.toHaveProperty("value")
        }
      }
    })
  })

  it("optional relation slots are a read cell or undefined, and must be narrowed before reading", () => {
    const { relation: ChildOf } = Descriptor.Hierarchy("Cells/ChildOf", "Cells/Children")
    const Linked = Schema.bind(Schema.fragment({ components: { Health }, relations: { ChildOf } }))
    Linked.System("Cells/OptionalRelation", {
      queries: { items: Linked.Query({ selection: { parent: Linked.Query.optionalRelation(ChildOf), children: Linked.Query.optionalRelated(ChildOf) } }) }
    }, ({ queries }) => {
      for (const { data } of queries.items.each()) {
        expect(data.parent).type.toBe<ReadCell<EntityId<typeof Linked.schema, typeof Linked.schema>> | undefined>()
        expect(data.children).type.toBe<ReadCell<ReadonlyArray<EntityId<typeof Linked.schema, typeof Linked.schema>>> | undefined>()
        // @ts-expect-error 'data.parent' is possibly 'undefined'
        data.parent.get()
        // @ts-expect-error 'data.children' is possibly 'undefined'
        data.children.get()
        expect(data.parent?.get()).type.toBe<EntityId<typeof Linked.schema, typeof Linked.schema> | undefined>()
      }
    })
  })

  it("filters add no slots, and slots must be declared", () => {
    Game.System("Cells/Filters", {
      queries: {
        items: Game.Query({ selection: { health: Game.Query.read(Health) }, with: [Frozen], without: [Position] })
      }
    }, ({ queries }) => {
      for (const { data, entity } of queries.items.each()) {
        expect(data).type.not.toHaveProperty("frozen")
        expect(data).type.not.toHaveProperty("position")
        expect(entity.id).type.toBe<EntityId<typeof Game.schema, typeof Game.schema>>()
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
      expect(id).type.toBe<SpawnedId<typeof Game.schema, typeof Game.schema, "Cells/Health">>()
      expect(id).type.toBeAssignableTo<EntityId<typeof Game.schema, typeof Game.schema>>()
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
    const Game = Schema.bind(Schema.fragment({ components: { Bag }, events: { Hit } }))
    const Bags = Game.Query({ selection: { bag: Game.Query.write(Bag) } })
    Game.System("Cells/Copy", {
      queries: { bags: Bags },
      events: { read: Game.System.readEvent(Hit), write: Game.System.writeEvent(Hit) },
      commands: Game.System.commands(Game.System.spawns(Bag))
    }, ({ queries, events, commands }) => {
      const [first, second] = queries.bags.each()
      if (first === undefined || second === undefined) return
      const read = first.data.bag.get()
      expect(read).type.toBe<{ readonly items: ReadonlyArray<number> }>()
      second.data.bag.set(read)
      second.data.bag.update((current) => current)
      commands.spawn(Game.Command.spawn([Bag, read]))
      commands.spawn(Game.Command.spawn(Game.Command.entry(Bag, read)))
      for (const hit of events.read.all()) events.write.emit(hit)
      // @ts-expect-error Type 'string' is not assignable to type 'number'
      second.data.bag.set({ items: ["a"] })
    })
  })
})
