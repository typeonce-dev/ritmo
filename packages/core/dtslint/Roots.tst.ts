import { Descriptor, Entity, Schema } from "@typeonce/ritmo"
import type * as SchemaTypes from "@typeonce/ritmo/Schema"
import { describe, expect, it } from "tstyche"

// A game is its root: `Schema.bind` takes one last, and values of games with
// different roots do not mix, even when one schema contains the other.

const Position = Descriptor.Component<{ x: number; y: number }>()("Roots/Position")
const Velocity = Descriptor.Component<{ x: number; y: number }>()("Roots/Velocity")
const Moving = Schema.fragment({ components: { Position, Velocity } })
const Placed = Schema.fragment({ components: { Position } })

describe("Schema.bind", () => {
  it("brands the game with the root passed last", () => {
    const Root = Schema.defineRoot("Roots/Game")
    expect(Root).type.toBe<Schema.RootToken<"Roots/Game">>()
    expect(Schema.bind(Moving, Root)).type.toBe<SchemaTypes.Schema.Game<typeof Moving, Schema.RootToken<"Roots/Game">>>()
    expect(Schema.bind(Placed, Schema.fragment({ components: { Velocity } }), Root).schema.components)
      .type.toBe<{ readonly Position: typeof Position } & { readonly Velocity: typeof Velocity }>()
  })

  it("does not compile without a root, and names the fix", () => {
    // @ts-expect-error Schema.bind takes the game's root last: const Root = Schema.defineRoot('Game'), then Schema.bind(...fragments, Root)
    Schema.bind(Moving)
    // @ts-expect-error Schema.bind takes the game's root last
    Schema.bind(Placed, Schema.fragment({ components: { Velocity } }))
    // @ts-expect-error Schema.bind takes the game's root last
    Schema.bind(Placed, Schema.fragment({ components: { Velocity } }), Placed)
  })
})

describe("games with different roots", () => {
  const RootA = Schema.defineRoot("Roots/A")
  const RootB = Schema.defineRoot("Roots/B")
  // B's schema is part of A's: without roots, the two would be one type.
  const GameA = Schema.bind(Moving, RootA)
  const GameB = Schema.bind(Placed, RootB)
  const SystemOfA = GameA.System("Roots/MoveA", {
    queries: { moving: GameA.Query({ selection: { position: GameA.Query.read(Position), velocity: GameA.Query.read(Velocity) } }) }
  }, () => {})
  const runtimeB = GameB.Runtime.make({ services: GameB.Runtime.services(), resources: {} }).value

  it("do not share schedules, systems, or runtimes", () => {
    runtimeB.tick(GameB.Schedule(GameB.System("Roots/B", {}, () => {})))
    // @ts-expect-error Type 'RootToken<"Roots/A">' is not assignable to type 'RootToken<"Roots/B">'
    runtimeB.tick(GameA.Schedule(SystemOfA))
    // @ts-expect-error Type 'RootToken<"Roots/A">' is not assignable to type 'RootToken<"Roots/B">'
    GameB.Schedule(SystemOfA)
  })

  it("do not share queries, entity ids, handles, or conditions", () => {
    const PlacedA = GameA.Query({ selection: { position: GameA.Query.read(Position) } })
    const FlowA = GameA.StateMachine("Roots/FlowA", { Menu: {}, Playing: {} })
    // @ts-expect-error Type 'RootToken<"Roots/A">' is not assignable to type 'RootToken<"Roots/B">'
    GameB.System("Roots/QueryOfA", { queries: { placed: PlacedA } }, () => {})
    // @ts-expect-error Type 'RootToken<"Roots/A">' is not assignable to type 'RootToken<"Roots/B">'
    GameB.System("Roots/WhenOfA", { when: [GameA.Condition.inState(FlowA, "Menu")] }, () => {})
    GameA.System("Roots/Ids", { queries: { placed: PlacedA } }, ({ queries }) => {
      for (const entity of queries.placed.each()) {
        GameB.System("Roots/IdOfA", { queries: { placed: GameB.Query({ selection: { position: GameB.Query.read(Position) } }) } }, ({ queries }) => {
          expect(queries.placed.get).type.not.toBeCallableWith(entity.id)
          // @ts-expect-error Type 'RootToken<"Roots/A">' is not assignable to type 'RootToken<"Roots/B">'
          queries.placed.get(entity.id)
        })
        const handle = GameA.Entity.handle(entity)
        expect(handle).type.toBe<Entity.Handle<typeof RootA>>()
        expect(GameA.Entity.id).type.toBeCallableWith(handle)
        // @ts-expect-error Type 'RootToken<"Roots/A">' is not assignable to type 'RootToken<"Roots/B">'
        GameB.Entity.id(handle)
      }
    })
  })

  it("name the root of a stored handle, not the schema", () => {
    expect(Entity.isHandle(RootA)).type.toBe<(raw: unknown) => raw is Entity.Handle<typeof RootA>>()
    expect(Entity.isHandle).type.not.toBeCallableWith(GameA.schema)
  })
})

describe("roots with the same name", () => {
  it("are one type: a root's name must be unique in the program", () => {
    // Why `defineRoot` asks for one root per game, under a name no other game uses.
    const First = Schema.defineRoot("Roots/Same")
    const Second = Schema.defineRoot("Roots/Same")
    expect(Second).type.toBe<typeof First>()
    expect(Schema.defineRoot("Roots/Other")).type.not.toBe<typeof First>()
  })
})
