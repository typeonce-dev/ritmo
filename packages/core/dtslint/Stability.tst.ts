import { Descriptor, EntityScope, Result, Schema } from "@typeonce/ritmo"
import type * as Query from "@typeonce/ritmo/Query"
import type * as System from "@typeonce/ritmo/System"
import { describe, expect, it } from "tstyche"

const Value = Descriptor.Resource<number>()("StabilityTypes/Value")
const Position = Descriptor.Component<{ x: number }>()("StabilityTypes/Position")
const Game = Schema.bind(Schema.fragment({ components: { Position }, resources: { Value } }))
const OtherGame = Schema.bind(Schema.fragment({ resources: { Value } }), Schema.defineRoot("Other"))

const Failing = Game.System(
  "StabilityTypes/Failing",
  { resources: { value: Game.System.writeResource(Value) } },
  ({ resources }) => {
    resources.value.set(1)
    return Result.failure("Rejected" as const)
  }
)

const schedule = Game.Schedule(Failing)
const runtime = Game.Runtime.make({
  services: Game.Runtime.services(),
  resources: { Value: 0 }
}).value

describe("stability types", () => {
  it("carries exact system failures through schedules and runtimes", () => {
    expect(runtime.tick(schedule)).type.toBe<
      Result.Result<void, System.SystemFailure<"StabilityTypes/Failing", "Rejected">>
    >()
  })

  it("infers the failure union from early Result.failure returns in an otherwise plain system", () => {
    const Spend = Game.System(
      "StabilityTypes/Spend",
      { resources: { value: Game.System.writeResource(Value) } },
      ({ resources }) => {
        const value = resources.value.get()
        if (value < 0) {
          return Result.failure("Negative" as const)
        }
        if (value === 0) {
          return Result.failure("Empty" as const)
        }
        resources.value.set(value - 1)
      }
    )
    expect(runtime.tick(Game.Schedule(Spend))).type.toBe<
      Result.Result<void, System.SystemFailure<"StabilityTypes/Spend", "Negative" | "Empty">>
    >()
  })

  it("infers the failure from a returned Result, such as a lookup result", () => {
    const Single = Game.System(
      "StabilityTypes/Single",
      { queries: { positions: Game.Query({ selection: { position: Game.Query.read(Position) } }) } },
      ({ queries }) => {
        const position = queries.positions.single()
        if (!position.ok) return position
      }
    )
    expect(runtime.tick(Game.Schedule(Single))).type.toBe<
      Result.Result<void, System.SystemFailure<"StabilityTypes/Single", Query.Query.SingleError>>
    >()
  })

  it("treats a system that returns only successes as infallible", () => {
    const Succeeds = Game.System("StabilityTypes/Succeeds", {}, () => Result.success(1))
    expect(runtime.tick(Game.Schedule(Succeeds))).type.toBe<Result.Result<void, never>>()
  })

  it("rejects return values that are neither nothing nor a Result", () => {
    // @ts-expect-error Type 'number' is not assignable to type
    Game.System("StabilityTypes/ReturnsNumber", {}, () => 1)
    // @ts-expect-error Type 'string' is not assignable to type
    Game.System("StabilityTypes/ReturnsError", {}, () => "Failed")
  })

  it("treats a system that returns nothing as infallible", () => {
    const Plain = Game.System(
      "StabilityTypes/Plain",
      { resources: { value: Game.System.writeResource(Value) } },
      ({ resources }) => {
        resources.value.set(2)
      }
    )
    expect(runtime.tick(Game.Schedule(Plain))).type.toBe<Result.Result<void, never>>()
  })

  it("brands entity scopes to one bound game root", () => {
    const scope = Game.EntityScope("Level")
    expect(scope).type.toBe<EntityScope.EntityScope<"Level", typeof Game.schema>>()

    const otherScope = OtherGame.EntityScope("Level")
    const system = OtherGame.System("Other/Spawn", {
      commands: OtherGame.System.commands(OtherGame.System.despawnsScope(otherScope))
    }, ({ commands }) => {
      commands.despawnScope(otherScope)
    })
    // @ts-expect-error is not assignable to parameter of type 'EntityScope<string, RootToken<"Other">>'
    OtherGame.System.despawnsScope(scope)
    expect(system).type.toBeAssignableTo<Schema.Schema.BoundSystem<typeof OtherGame.schema, Schema.RootToken<"Other">>>()
  })

  it("keeps inspectors read-only and returns their exact projection", () => {
    const inspector = Game.Inspector(
      "StabilityTypes/ValueInspector",
      {
        queries: {
          positions: Game.Query({
            selection: { position: Game.Query.read(Position) }
          })
        },
        resources: { value: Game.System.readResource(Value) }
      },
      ({ queries, resources }) => {
        const first = queries.positions.each()[0]
        if (first) {
          // @ts-expect-error Cannot assign to 'x' because it is a read-only property.
          queries.positions.data.position.get(first).x = 1
        }
        return { value: resources.value.get() }
      }
    )

    expect(runtime.inspect(inspector)).type.toBe<{ value: number }>()

    Game.Inspector(
      "StabilityTypes/InvalidInspector",
      {
        queries: {
          // @ts-expect-error Type 'QuerySpec<{ readonly position: WriteAccess<Descriptor<"component", "StabilityTypes/Position", { x
          invalid: Game.Query({
            selection: { position: Game.Query.write(Position) }
          })
        }
      },
      () => undefined
    )
  })

  it("keeps inspectors from draining a service", () => {
    interface Queue extends System.Consumes<"take"> {
      take(): ReadonlyArray<string>
      size(): number
    }
    const Messages = Descriptor.Service<Queue>()("StabilityTypes/Messages")
    const Bound = Schema.bind(Schema.fragment({}))
    const peek = Bound.Inspector(
      "StabilityTypes/PeekInspector",
      { services: { queue: Bound.System.service(Messages) } },
      ({ services }) => services.queue.size()
    )
    expect(peek.name).type.toBe<"StabilityTypes/PeekInspector">()
    Bound.Inspector(
      "StabilityTypes/DrainInspector",
      {
        services: {
          // @ts-expect-error an inspector must not drain a service
          queue: Bound.System.consumeService(Messages)
        }
      },
      () => undefined
    )
  })

  it("carries failures through state-transition bundles", () => {
    const Mode = Game.StateMachine("StabilityTypes/Mode", { Menu: {}, Playing: {} })
    const start = Game.System(
      "StabilityTypes/Start",
      { nextMachines: { mode: Game.System.nextState(Mode) } },
      ({ nextMachines }) => { nextMachines.mode.set({ _tag: "Playing" }) }
    )
    const load = Game.System(
      "StabilityTypes/LoadLevel",
      {},
      () => Result.failure("LoadFailed" as const)
    )
    const transitions = Game.Schedule.transitions(
      Game.Schedule.onEnter(Mode, "Playing", [load])
    )
    const transitionSchedule = Game.Schedule(
      start,
      Game.Schedule.applyStateTransitions(transitions)
    )
    const transitionRuntime = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: { Value: 0 },
      machines: Game.Runtime.machines(Game.Runtime.machine(Mode, { _tag: "Menu" }))
    }).value

    expect(transitionRuntime.tick(transitionSchedule)).type.toBe<
      Result.Result<void, System.SystemFailure<"StabilityTypes/LoadLevel", "LoadFailed">>
    >()
  })
})
