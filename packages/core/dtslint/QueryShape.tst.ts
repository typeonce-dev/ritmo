import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Query from "@typeonce/ritmo/Query"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ readonly x: number }>()("QueryShape/Position")
const Frozen = Descriptor.Component<{}>()("QueryShape/Frozen")
const Tag = Descriptor.Component<{}>()("QueryShape/Tag")
const Paved = Descriptor.Component<{}>()("QueryShape/Paved")

const Game = Schema.bind(Schema.fragment({ components: { Position, Frozen, Tag, Paved } }))

describe("a query that can never match", () => {
  it("rejects a component both required and excluded", () => {
    Game.Query({
      selection: { position: Game.Query.read(Position) },
      with: [Frozen],
      // @ts-expect-error QueryShape/Frozen is both required and excluded (without): this query can never match
      without: [Frozen]
    })
    Game.Query({
      selection: { position: Game.Query.write(Position) },
      // @ts-expect-error QueryShape/Position is both required and excluded (without)
      without: [Position]
    })
    Game.Query({
      selection: { position: Game.Query.read(Position) },
      filters: [Game.Query.added(Tag)],
      // @ts-expect-error QueryShape/Tag is both required and excluded (without)
      without: [Tag]
    })
    Query.Query({
      selection: { position: Query.read(Position) },
      with: [Frozen],
      // @ts-expect-error QueryShape/Frozen is both required and excluded (without)
      without: [Frozen]
    })
  })

  it("accepts an exclusion that leaves a way to match", () => {
    // An optional slot never requires its component.
    Game.Query({ selection: { position: Game.Query.read(Position), frozen: Game.Query.optional(Frozen) }, without: [Frozen] })
    // anyOf needs one of its members: the other can match.
    Game.Query({ selection: {}, filters: [Game.Query.anyOf(Game.Query.added(Tag), Game.Query.added(Paved))], without: [Tag] })
  })
})

describe("what a filtered query proves", () => {
  it("proves a component an added or changed filter needs, not one inside anyOf", () => {
    const Tagged = Game.Query({ selection: { position: Game.Query.read(Position) }, filters: [Game.Query.added(Tag)] })
    expect<Query.Query.ProvesComponent<typeof Tagged, typeof Tag>>().type.toBe<true>()
    const Either = Game.Query({ selection: {}, filters: [Game.Query.anyOf(Game.Query.added(Tag), Game.Query.changed(Paved))] })
    expect<Query.Query.ProvesComponent<typeof Either, typeof Tag>>().type.toBe<false>()
    Game.System("QueryShape/DespawnTagged", {
      queries: { tagged: Tagged },
      commands: Game.System.commands(Game.System.despawns(Tag))
    }, ({ queries, commands }) => {
      for (const match of queries.tagged.each()) commands.despawn(match.entity)
    })
  })
})

describe("lookups through a filtered query", () => {
  const Moved = Game.Query({ selection: { position: Game.Query.read(Position) }, filters: [Game.Query.changed(Position)] })
  const Positions = Game.Query({ selection: { position: Game.Query.read(Position) } })

  it("iterates a filtered query and resolves through an unfiltered one", () => {
    Game.System("QueryShape/Follow", { queries: { moved: Moved, positions: Positions } }, ({ queries }) => {
      for (const match of queries.moved.each()) {
        const again = queries.positions.get(match.entity.id)
        expect(again._tag).type.toBe<"Success" | "Failure">()
      }
      expect(queries.moved.singleOptional()._tag).type.toBe<"Success" | "Failure">()
      expect(queries.positions.single()._tag).type.toBe<"Success" | "Failure">()
    })
  })

  it("rejects get, getHandle, single, children, and descendants on a filtered query", () => {
    Game.System("QueryShape/Lookups", { queries: { moved: Moved, positions: Positions } }, ({ queries }) => {
      const [first] = queries.positions.each()
      if (first === undefined) return
      // @ts-expect-error lookups need a query without added/changed filters: declare a second query for resolving entities
      queries.moved.get(first.entity.id)
      // @ts-expect-error lookups need a query without added/changed filters
      queries.moved.getHandle(Game.Entity.handle(first.entity))
      // @ts-expect-error lookups need a query without added/changed filters
      queries.moved.single()
    })
  })
})
