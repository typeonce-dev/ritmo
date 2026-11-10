import { Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import type { RuntimeServices, ValidateScheduleArray } from "@typeonce/ritmo/Runtime"
import type { SystemAccessSpec } from "@typeonce/ritmo/System"
import { describe, expect, it } from "tstyche"

// Realistic mistakes whose compiler message names the cause and the fix.
// Each failing call sits next to the call that fixes it.

const Position = Descriptor.Component<{ x: number; y: number }>()("Fix/Position")
const Health = Descriptor.Component<number>()("Fix/Health")
const Score = Descriptor.Resource<number>()("Fix/Score")
const Lives = Descriptor.Resource<number>()("Fix/Lives")
const Audio = Descriptor.Service<{ readonly play: (sound: string) => void }>()("Fix/Audio")
const Log = Descriptor.Service<{ readonly log: (line: string) => void }>()("Fix/Log")
const ChildOf = Descriptor.Hierarchy("Fix/ChildOf", "Fix/Children")
const Targets = Descriptor.Relation("Fix/Targets", "Fix/TargetedBy")

const Root = Schema.defineRoot("Fix")
const Game = Schema.bind(Schema.fragment({
  components: { Position, Health },
  resources: { Score, Lives },
  relations: { ChildOf: ChildOf.relation, Targets: Targets.relation }
}), Root)
const Flow = Game.StateMachine("Fix/Flow", { Menu: {}, Playing: {} })

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

  it("name pauseWhile, which takes the conditions that pause, for pauseWhen", () => {
    const playing = Game.Condition.inState(Flow, "Playing")
    const Read = Game.System("Fix/Read", { resources: { score: Game.System.readResource(Score) } }, () => {})
    // @ts-expect-error pauseWhen is not a system spec key: use pauseWhile, which takes the conditions that pause the system, not the ones it runs under
    Game.System("Fix/PauseWhen", { resources: { score: Game.System.readResource(Score) }, pauseWhen: [playing] }, () => {})
    Game.System("Fix/PauseWhile", { resources: { score: Game.System.readResource(Score) }, pauseWhile: [Game.Condition.not(playing)] }, () => {})
    // @ts-expect-error Did you mean 'pauseWhile'?
    Game.Schedule.pauseWhen([playing], Read)
    Game.Schedule.pauseWhile([Game.Condition.not(playing)], Read)
  })

  it("list every category of SystemAccessSpec", () => {
    // The message of an unknown key lists these: a new category updates it in `System.ts`.
    expect<keyof SystemAccessSpec>().type.toBe<
      | "queries" | "resources" | "events" | "services" | "machines" | "nextMachines" | "transitionEvents" | "removed"
      | "despawned" | "relationFailures" | "droppedRelations" | "commands" | "when" | "pauseWhile" | "transitions" | "local"
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

describe("ids", () => {
  it("go where an id is wanted, not the entity", () => {
    const Positions = Game.Query({ selection: { position: Game.Query.read(Position) } })
    const relates = Game.System.commands(Game.System.relates(ChildOf.relation))
    Game.System("Fix/Ids", { queries: { positions: Positions }, commands: relates }, ({ queries, commands, lookup }) => {
      for (const entity of queries.positions.each()) {
        queries.positions.get(entity.id)
        // @ts-expect-error this takes an entity id, not an entity: pass entity.id
        queries.positions.get(entity)
        lookup.related(entity.id, ChildOf.relation)
        // @ts-expect-error this takes an entity id, not an entity: pass entity.id
        lookup.related(entity, ChildOf.relation)
        commands.relate(entity.id, ChildOf.relation, entity.id)
        // @ts-expect-error this takes an entity id, not an entity: pass entity.id
        commands.relate(entity, ChildOf.relation, entity.id)
      }
    })
  })
})

describe("transition schedules", () => {
  it("run from applyStateTransitions, not on their own", () => {
    const EnterPlaying = Game.Schedule.onEnter(Flow, "Playing", [])
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "Menu" })),
      debug: { hostClock: HostClock.test() }
    }).value
    runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(Game.Schedule.transitions(EnterPlaying))))
    // @ts-expect-error onEnter, onExit, and onTransition schedules run when their machine changes state: bundle them with Game.Schedule.transitions(...) and pass that to Game.Schedule.applyStateTransitions(...)
    runtime.tick(EnterPlaying)
    // @ts-expect-error bundle them with Game.Schedule.transitions(...) and pass that to Game.Schedule.applyStateTransitions(...)
    runtime.tryTick(EnterPlaying)
    // @ts-expect-error bundle them with Game.Schedule.transitions(...) and pass that to Game.Schedule.applyStateTransitions(...)
    runtime.checkpoint(EnterPlaying)
    // @ts-expect-error bundle them with Game.Schedule.transitions(...) and pass that to Game.Schedule.applyStateTransitions(...)
    runtime.debug.beginFrame(EnterPlaying)
    // @ts-expect-error bundle them with Game.Schedule.transitions(...) and pass that to Game.Schedule.applyStateTransitions(...)
    Game.Schedule(EnterPlaying)
  })
})

describe("runtime requirements", () => {
  it("name every missing one at tick, and where to provide it", () => {
    const Needs = Game.System("Fix/Needs", {
      resources: { score: Game.System.readResource(Score), lives: Game.System.readResource(Lives) },
      services: { audio: Game.System.service(Audio), log: Game.System.service(Log) },
      machines: { flow: Game.System.machine(Flow) }
    }, () => {})
    const update = Game.Schedule(Needs)
    const provided = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(Audio, { play: () => {} }), Game.Runtime.service(Log, { log: () => {} })),
      resources: { Score: 0, Lives: 3 },
      machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "Menu" }))
    }).value
    provided.tick(update)
    const bare = Game.Runtime.make({ services: Game.Runtime.services() }).value
    // The message is a property name, which the compiler prints whole: its end comes after all five.
    // @ts-expect-error machine Fix/Flow: add to Game.Runtime.make({ resources: { Key: value }, services: Game.Runtime.services(Game.Runtime.service(Descriptor, implementation)), machines: Game.Runtime.machines(Game.Runtime.machine(Machine, initial)) })
    bare.tick(update)
    type Message = keyof ValidateScheduleArray<readonly [typeof update], {}, {}, {}>
    expect<Message>().type.toBeAssignableTo<`the runtime is missing resource ${string}, resource ${string}, service ${string}, service ${string}, machine Fix/Flow: ${string}`>()
    expect<Message>().type.toBeAssignableTo<`${string}resource Fix/Score${string}`>()
    expect<Message>().type.toBeAssignableTo<`${string}resource Fix/Lives${string}`>()
    expect<Message>().type.toBeAssignableTo<`${string}service Fix/Audio${string}`>()
    expect<Message>().type.toBeAssignableTo<`${string}service Fix/Log${string}`>()
  })
})

describe("runtime provisions", () => {
  it("are built with Game.Runtime.services and Game.Runtime.machines", () => {
    Game.Runtime.make({ services: Game.Runtime.services() })
    // @ts-expect-error services are built with Game.Runtime.services(Game.Runtime.service(Descriptor, implementation)), or Game.Runtime.services() when there are none
    Game.Runtime.make({ services: {} })
    // @ts-expect-error services are built with Game.Runtime.services(Game.Runtime.service(Descriptor, implementation))
    Game.Runtime.make({ services: { "Fix/Audio": { play: () => {} } } })
    Game.Runtime.make({ services: Game.Runtime.services(), machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "Menu" })) })
    // @ts-expect-error machines are started with Game.Runtime.machines(Game.Runtime.machine(Machine, initial)), or left out when there are none
    Game.Runtime.make({ services: Game.Runtime.services(), machines: {} })
    // A helper that forwards its services still compiles.
    const makeRuntime = <const Services extends RuntimeServices>(services: Services) => Game.Runtime.make({ services })
    expect(makeRuntime(Game.Runtime.services(Game.Runtime.service(Audio, { play: () => {} }))).value.services).type.toBe<{ readonly "Fix/Audio": { readonly play: (sound: string) => void } }>()
  })
})
