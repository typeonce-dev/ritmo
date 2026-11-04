import { Descriptor, Schema } from "@typeonce/ritmo"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ x: number; y: number }>()("Identity/Position")
const Label = Descriptor.Component<string>()("Identity/Position")
const Health = Descriptor.Component<number>()("Identity/Health")
const Score = Descriptor.Resource<number>()("Identity/Position")

describe("descriptor identity", () => {
  it("rejects two descriptors of one kind with the same name in a fragment", () => {
    // @ts-expect-error __schemaConflicts__: "components name \"Identity/Position\""
    Schema.fragment({ components: { Position, Label } })
  })

  it("rejects the same descriptor name across bound fragments", () => {
    // @ts-expect-error __schemaConflicts__: "components name \"Identity/Position\""
    Schema.bind(Schema.fragment({ components: { Position } }), Schema.fragment({ components: { Label } }))
    // @ts-expect-error __schemaConflicts__: "components name \"Identity/Position\""
    Schema.bind(Schema.fragment({ components: { Position } }), Schema.fragment({ components: { Other: Position } }), Schema.defineRoot("Identity"))
  })

  it("rejects the same registry key across bound fragments", () => {
    // @ts-expect-error __schemaConflicts__: "components key \"Position\""
    Schema.bind(Schema.fragment({ components: { Position } }), Schema.fragment({ components: { Position: Health } }))
  })

  it("allows the same name across different descriptor kinds", () => {
    const Game = Schema.bind(Schema.fragment({ components: { Position }, resources: { Score } }))
    expect(Game.schema.resources.Score).type.toBe<typeof Score>()
  })

  it("rejects a look-alike descriptor whose value type differs from the registered one", () => {
    const Game = Schema.bind(Schema.fragment({ components: { Health } }))
    const Narrowed = Descriptor.Component<1>()("Identity/Health")
    const Widened = Descriptor.Component<number | string>()("Identity/Health")
    // @ts-expect-error Type 'number' is not assignable to type '1'.
    Game.Query.read(Narrowed)
    // @ts-expect-error Type 'string' is not assignable to type 'number'.
    Game.Query.read(Widened)
    expect(Game.Query.read(Health).descriptor).type.toBe<typeof Health>()
  })

  it("allows distinct systems that share a display name", () => {
    const Game = Schema.bind(Schema.fragment({ components: { Health } }))
    const First = Game.System("Identity/Same", {}, () => {})
    const Second = Game.System("Identity/Same", {}, () => {})
    expect(Game.Schedule(First, Second).kind).type.toBe<"schedule">()
  })
})

describe("Game.Entity.id", () => {
  const Root = Schema.defineRoot("Identity/Handles")
  const Game = Schema.bind(Schema.fragment({ components: { Health } }), Root)
  const OtherRoot = Schema.defineRoot("Identity/Other")
  const Other = Schema.bind(Schema.fragment({ components: { Health } }), OtherRoot)

  it("returns the entity id a handle names, with or without an intent", () => {
    const Healths = Game.Query({ selection: { health: Game.Query.read(Health) } })
    Game.System("Identity/Ids", { queries: { healths: Healths } }, ({ queries }) => {
      for (const entity of queries.healths.each()) {
        expect(Game.Entity.id(Game.Entity.handle(entity))).type.toBe<typeof entity.id>()
        expect(Game.Entity.id(Game.Entity.handle(entity, Health))).type.toBe<typeof entity.id>()
        // @ts-expect-error is not assignable to parameter of type
        Other.Entity.id(Game.Entity.handle(entity))
      }
    })
  })
})
