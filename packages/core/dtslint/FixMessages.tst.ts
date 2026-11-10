import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import type { SystemAccessSpec } from "@typeonce/ritmo/System"
import { describe, expect, it } from "tstyche"

// Realistic mistakes whose compiler message names the cause and the fix.
// Each failing call sits next to the call that fixes it.

const Position = Descriptor.Component<{ x: number; y: number }>()("Fix/Position")
const Health = Descriptor.Component<number>()("Fix/Health")
const Score = Descriptor.Resource<number>()("Fix/Score")
const ChildOf = Descriptor.Hierarchy("Fix/ChildOf", "Fix/Children")
const Targets = Descriptor.Relation("Fix/Targets", "Fix/TargetedBy")

const Game = Schema.bind(Schema.fragment({
  components: { Position, Health },
  resources: { Score },
  relations: { ChildOf: ChildOf.relation, Targets: Targets.relation }
}))

describe("system bodies", () => {
  it("return nothing or Result.failure, and are synchronous", () => {
    const spawns = Game.System.commands(Game.System.spawns(Position))
    Game.System("Fix/Spawn", { commands: spawns }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Position, { x: 1, y: 1 }]))
    })
    // @ts-expect-error a system returns nothing or Result.failure(...), and runs synchronously: wrap an expression body in braces
    Game.System("Fix/SpawnExpression", { commands: spawns }, ({ commands }) => commands.spawn(Game.Command.spawn([Position, { x: 1, y: 1 }])))
    // @ts-expect-error wrap an expression body in braces, and drop async
    Game.System("Fix/ReadExpression", { resources: { score: Game.System.readResource(Score) } }, ({ resources }) => resources.score.get())
    // @ts-expect-error a system returns nothing or Result.failure(...), and runs synchronously
    Game.System("Fix/Async", {}, async () => {})
    const Spend = Game.System("Fix/Spend", { resources: { score: Game.System.readResource(Score) } }, ({ resources }) =>
      resources.score.get() < 10 ? Result.failure("Poor" as const) : undefined)
    // The failure type is still inferred from the body.
    expect(Spend.run).type.toBeAssignableTo<(context: never) => Result.Result<unknown, "Poor"> | void>()
    expect(Spend.run).type.not.toBeAssignableTo<(context: never) => Result.Result<unknown, "Other"> | void>()
  })
})

describe("relation pairs", () => {
  it("register and declare the pair's relation, not the pair", () => {
    expect(Schema.fragment({ relations: { ChildOf: ChildOf.relation } }).relations.ChildOf).type.toBe<typeof ChildOf.relation>()
    // @ts-expect-error ChildOf is the pair Descriptor.Hierarchy(...) returns: register its relation, ChildOf.relation
    Schema.fragment({ relations: { ChildOf } })
    // @ts-expect-error Targets is the pair Descriptor.Relation(...) returns: register its relation, Targets.relation
    Schema.fragment({ relations: { Targets } })
    expect(Game.System.relates).type.toBeCallableWith(Targets.relation, ChildOf.relation)
    // @ts-expect-error Fix/Targets is passed as the pair Descriptor.Hierarchy/Relation(...) returns: pass the relation itself, the pair's .relation
    Game.System.relates(Targets)
  })
})

describe("spec keys", () => {
  it("name the access categories a system spec has", () => {
    // @ts-expect-error querys is not a system spec key: use queries, resources
    Game.System("Fix/Typo", { querys: {}, resources: { score: Game.System.readResource(Score) } }, () => {})
    Game.System("Fix/Spelled", { queries: {}, resources: { score: Game.System.readResource(Score) } }, () => {})
  })

  it("list every category of SystemAccessSpec", () => {
    // The message of an unknown key lists these: a new category updates it in `System.ts`.
    expect<keyof SystemAccessSpec>().type.toBe<
      | "queries" | "resources" | "events" | "services" | "machines" | "nextMachines" | "transitionEvents" | "removed"
      | "despawned" | "relationFailures" | "droppedRelations" | "commands" | "when" | "pauseWhen" | "transitions" | "local"
    >()
  })
})

describe("inspectors", () => {
  it("only read", () => {
    Game.Inspector("Fix/Positions", { queries: { all: Game.Query({ selection: { position: Game.Query.read(Position) } }) } }, () => 1)
    // @ts-expect-error an inspector only reads: select with Game.Query.read (or optional) instead of Game.Query.write
    Game.Inspector("Fix/Writes", { queries: { all: Game.Query({ selection: { position: Game.Query.write(Position) } }) } }, () => 1)
  })
})

describe("query slots", () => {
  it("name the component the entity's query does not prove", () => {
    const Positions = Game.Query({ selection: { position: Game.Query.read(Position) } })
    const Healths = Game.Query({ selection: { health: Game.Query.read(Health) } })
    Game.System("Fix/OtherQuery", { queries: { positions: Positions, healths: Healths } }, ({ queries }) => {
      for (const entity of queries.healths.each()) {
        queries.healths.data.health.get(entity)
        // @ts-expect-error Property '"proves component Fix/Position"' is missing
        queries.positions.data.position.get(entity)
      }
    })
  })
})

describe("schema fragments", () => {
  it("take records keyed by name", () => {
    expect(Schema.fragment({ components: { Position } }).components.Position).type.toBe<typeof Position>()
    // @ts-expect-error components takes a record keyed by name, not an array: components: { Position, Health }
    Schema.fragment({ components: [Position] })
    // @ts-expect-error resources takes a record keyed by name, not an array: resources: { Score }
    Schema.fragment({ resources: [Score] })
  })
})

describe("value descriptors", () => {
  it("take the name in the second call", () => {
    expect(Descriptor.Component<number>()("Fix/Name").name).type.toBe<"Fix/Name">()
    // @ts-expect-error the name goes in the second call: Descriptor.Component<Value>()(name)
    Descriptor.Component<number>("Fix/Name")
    // @ts-expect-error the name goes in the second call: Descriptor.Resource<Value>()(name)
    Descriptor.Resource<number>("Fix/Name")
    // @ts-expect-error the name goes in the second call: Descriptor.Event<Value>()(name)
    Descriptor.Event<number>("Fix/Name")
    // @ts-expect-error the name goes in the second call: Descriptor.Service<Value>()(name)
    Descriptor.Service<number>("Fix/Name")
    // @ts-expect-error the name goes in the second call: Descriptor.TransientComponent<Value>()(name)
    Descriptor.TransientComponent<number>("Fix/Name")
    // @ts-expect-error the name goes in the second call: Descriptor.TransientResource<Value>()(name)
    Descriptor.TransientResource<number>("Fix/Name")
  })
})
