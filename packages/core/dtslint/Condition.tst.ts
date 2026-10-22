import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"
import { describe, expect, it } from "tstyche"

const Freeze = Descriptor.Resource<{ readonly remaining: number }>()("CheckTypes/Freeze")
const Enemy = Descriptor.Tag("CheckTypes/Enemy")
const Health = Descriptor.Component<number>()("CheckTypes/Health")
const Ping = Descriptor.Event<number>()("CheckTypes/Ping")
const Clock = Descriptor.Service<{ readonly now: () => number }>()("CheckTypes/Clock")

const Game = Schema.bind(Schema.fragment({ components: { Enemy, Health }, resources: { Freeze }, events: { Ping } }))
const Flow = Game.StateMachine("CheckTypes/Flow", ["Playing", "Over"] as const)

const OtherFreeze = Descriptor.Resource<number>()("CheckTypes/OtherFreeze")
const Other = Schema.bind(Schema.fragment({ resources: { OtherFreeze } }))
const OtherFlow = Other.StateMachine("CheckTypes/OtherFlow", ["A", "B"] as const)

const Noop = Game.System("CheckTypes/Noop", {}, () => {})

describe("Game.Condition.check", () => {
  it("types the predicate context from the declared reads, read-only", () => {
    Game.Condition.check("typed", {
      resources: { freeze: Game.System.readResource(Freeze) },
      machines: { flow: Game.System.machine(Flow) },
      queries: { enemies: Game.Query({ selection: { health: Game.Query.read(Health) }, with: [Enemy] }) }
    }, (context) => {
      expect(context.resources.freeze.get().remaining).type.toBe<number>()
      expect(context.machines.flow.get()).type.toBe<"Playing" | "Over">()
      expect(context.queries.enemies.each()[0]?.data.health.get()).type.toBe<number | undefined>()
      // @ts-expect-error Property 'set' does not exist on type 'ResourceReadView<{ readonly remaining: number; }>'.
      context.resources.freeze.set({ remaining: 0 })
      // @ts-expect-error Property 'events' does not exist on type 'CheckContext<SystemSpec<SchemaDefinition<{ readonly Enemy
      context.events
      // @ts-expect-error Property 'services' does not exist on type 'CheckContext<SystemSpec<SchemaDefinition<{ readonly Enemy
      context.services
      // @ts-expect-error Property 'commands' does not exist on type 'CheckContext<SystemSpec<SchemaDefinition<{ readonly Enemy
      context.commands
      return true
    })
  })

  it("rejects reads that consume or advance a cursor, services, and unknown categories", () => {
    // @ts-expect-error Object literal may only specify known properties, and 'events' does not exist in type
    Game.Condition.check("events", { events: { ping: Game.System.readEvent(Ping) } }, () => true)
    // @ts-expect-error Object literal may only specify known properties, and 'services' does not exist in type
    Game.Condition.check("services", { services: { clock: Game.System.service(Clock) } }, () => true)
    // @ts-expect-error Object literal may only specify known properties, and 'removed' does not exist in type
    Game.Condition.check("removed", { removed: { enemy: Game.System.readRemoved(Enemy) } }, () => true)
    // @ts-expect-error Object literal may only specify known properties, and 'despawned' does not exist in type
    Game.Condition.check("despawned", { despawned: { entities: Game.System.readDespawned() } }, () => true)
    // @ts-expect-error Object literal may only specify known properties, and 'transitionEvents' does not exist in type
    Game.Condition.check("transitions", { transitionEvents: { flow: Game.System.readTransitionEvent(Flow) } }, () => true)
    // @ts-expect-error a check cannot write resources: use Game.System.readResource
    Game.Condition.check("writes", { resources: { freeze: Game.System.writeResource(Freeze) } }, () => true)
    // @ts-expect-error Object literal may only specify known properties, and 'commands' does not exist in type
    Game.Condition.check("unknown", { commands: {} }, () => true)
  })

  it("rejects queries that write or filter on changes", () => {
    Game.Condition.check("writeQuery", {
      // @ts-expect-error Type 'QuerySpec<{ readonly health: WriteAccess<Descriptor<"component", "CheckTypes/Health", number>>; }, []
      queries: { enemies: Game.Query({ selection: { health: Game.Query.write(Health) } }) }
    }, () => true)
    Game.Condition.check("changedQuery", {
      // @ts-expect-error Type 'QuerySpec<{ readonly health: ReadAccess<Descriptor<"component", "CheckTypes/Health", number>>; }, []
      queries: { enemies: Game.Query({ selection: { health: Game.Query.read(Health) }, filters: [Game.Query.changed(Health)] }) }
    }, () => true)
    Game.Condition.check("addedQuery", {
      // @ts-expect-error Type 'QuerySpec<{ readonly health: ReadAccess<Descriptor<"component", "CheckTypes/Health", number>>; }, []
      queries: { enemies: Game.Query({ selection: { health: Game.Query.read(Health) }, filters: [Game.Query.added(Health)] }) }
    }, () => true)
  })

  it("rejects descriptors of another game and non-boolean predicates", () => {
    // @ts-expect-error Type '"CheckTypes/OtherFreeze"' is not assignable to type '"CheckTypes/Freeze"'.
    Game.Condition.check("foreignResource", { resources: { freeze: Other.System.readResource(OtherFreeze) } }, () => true)
    // @ts-expect-error Type '{}' is missing the following properties from type '{ readonly Enemy: DecodableDescriptor<"component"
    Game.Condition.check("foreignMachine", { machines: { flow: Other.System.machine(OtherFlow) } }, () => true)
    Game.Condition.check("notBoolean", { resources: { freeze: Game.System.readResource(Freeze) } },
      // @ts-expect-error Type 'number' is not assignable to type 'boolean'.
      ({ resources }) => resources.freeze.get().remaining)
  })

  it("makes what it reads a requirement, through not/and/or, system `when`, and Schedule.when", () => {
    const frozen = Game.Condition.check("frozen", { resources: { freeze: Game.System.readResource(Freeze) } }, ({ resources }) => resources.freeze.get().remaining > 0)
    const gatedSystem = Game.System("CheckTypes/Gated", { when: [Game.Condition.not(frozen)] }, () => {})
    const group = Game.Schedule.when([Game.Condition.and(frozen, Game.Condition.inState(Flow, "Playing"))], Noop)

    const withoutFreeze = Game.Runtime.make({ services: Runtime.services(), machines: Runtime.machines(Runtime.machine(Flow, "Playing")) }).success
    // @ts-expect-error __runtimeRequirementError__: "Missing resource"; readonly __requirement__: "CheckTypes/Freeze"
    withoutFreeze.tick(Game.Schedule(gatedSystem))
    // @ts-expect-error __runtimeRequirementError__: "Missing resource"; readonly __requirement__: "CheckTypes/Freeze"
    withoutFreeze.tick(group)

    const ready = Game.Runtime.make({
      services: Runtime.services(),
      resources: { Freeze: { remaining: 0 } },
      machines: Runtime.machines(Runtime.machine(Flow, "Playing"))
    }).success
    expect(ready.tick(Game.Schedule(gatedSystem, group))._tag).type.toBe<"Success" | "Failure">()
  })
})
