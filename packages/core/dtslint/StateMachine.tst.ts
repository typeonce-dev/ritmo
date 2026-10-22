import { Descriptor, Schema } from "@typeonce/ritmo"
import type * as Machine from "@typeonce/ritmo/Machine"
import * as Runtime from "@typeonce/ritmo/Runtime"
import type * as SchemaTypes from "@typeonce/ritmo/Schema"
import * as System from "@typeonce/ritmo/System"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ x: number; y: number }>()("StateMachine/Position")
const Counter = Descriptor.Resource<number>()("StateMachine/Counter")

const schema = Schema.fragment({
  components: {
    Position
  },
  resources: {
    Counter
  }
})
const Game = Schema.bind(schema)

const otherSchema = Schema.fragment({
  resources: {
    Counter
  }
})
const OtherGame = Schema.bind(otherSchema)

const AppState = Game.StateMachine("AppState", ["Menu", "Playing", "Paused"] as const)
const RoundState = Game.StateMachine("RoundState", ["Warmup", "Live", "SuddenDeath"] as const)
const OtherState = OtherGame.StateMachine("OtherState", ["Idle", "Running"] as const)

const ReaderSystem = Game.System(
  "StateMachine/Reader",
  {
    machines: {
      app: System.machine(AppState)
    }
  },
  ({ machines }) =>
    {
      expect(machines.app.get()).type.toBe<"Menu" | "Playing" | "Paused">()
    }
)

const WriterSystem = Game.System(
  "StateMachine/Writer",
  {
    nextMachines: {
      app: System.nextState(AppState)
    }
  },
  ({ nextMachines }) =>
    {
      nextMachines.app.set("Playing")
      nextMachines.app.setIfChanged("Paused")
      expect(nextMachines.app.getPending()).type.toBe<"Menu" | "Playing" | "Paused" | undefined>()
    }
)

const TransitionSystem = Game.System(
  "StateMachine/TransitionReader",
  {
    transitions: {
      app: System.transition(AppState)
    }
  },
  ({ transitions }) =>
    {
      expect(transitions.app.get().from).type.toBe<"Menu" | "Playing" | "Paused">()
      expect(transitions.app.get().to).type.toBe<"Menu" | "Playing" | "Paused">()
    }
)

const TransitionEventSystem = Game.System(
  "StateMachine/TransitionEventReader",
  {
    transitionEvents: {
      app: Game.System.readTransitionEvent(AppState)
    }
  },
  ({ transitionEvents }) =>
    {
      const events = transitionEvents.app.all()
      expect(events).type.toBe<ReadonlyArray<{ readonly from: "Menu" | "Playing" | "Paused"; readonly to: "Menu" | "Playing" | "Paused" }>>()
    }
)

const PlayingOnlySystem = Game.System(
  "StateMachine/PlayingOnly",
  {
    when: [Game.Condition.inState(AppState, "Playing")]
  },
  () => {}
)


const MachineSchedule = Game.Schedule(ReaderSystem, WriterSystem)

const EnterPlaying = Game.Schedule.onEnter(AppState, "Playing", [TransitionSystem])

const TransitionBundle = Game.Schedule.transitions(EnterPlaying)

describe("StateMachine", () => {
  it("keeps the machine value union exact across readers and writers", () => {
    AppState
    RoundState
    MachineSchedule
    EnterPlaying
    TransitionBundle
    TransitionEventSystem
  })

  it("supports multiple machines with exact unions in one system", () => {
    Game.System(
      "StateMachine/MultiMachineReader",
      {
        machines: {
          app: System.machine(AppState),
          round: System.machine(RoundState)
        },
        nextMachines: {
          round: System.nextState(RoundState)
        }
      },
      ({ machines, nextMachines }) =>
        {
          expect(machines.app.get()).type.toBe<"Menu" | "Playing" | "Paused">()
          expect(machines.round.get()).type.toBe<"Warmup" | "Live" | "SuddenDeath">()
          nextMachines.round.set("Live")
          // @ts-expect-error Argument of type '"Paused"' is not assignable to parameter of type
          nextMachines.round.set("Paused")
        }
    )
  })

  it("rejects invalid machine values in conditions and queued writes", () => {
    Game.Condition.inState(
      AppState,
      // @ts-expect-error Argument of type '"GameOver"' is not assignable to parameter of type
      "GameOver"
    )

    Game.System(
      "StateMachine/InvalidWriter",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          // @ts-expect-error Argument of type '"GameOver"' is not assignable to parameter of type
          nextMachines.app.set("GameOver")
        }
    )
  })

  it("rejects cross-schema machine references", () => {
    Game.System(
      "StateMachine/CrossSchemaSystem",
      {
        machines: {
          // @ts-expect-error Property 'Position' is missing in type '{}' but required in type '{ readonly Position
          other: System.machine(OtherState)
        }
      },
      () => {}
    )

    Game.System(
      "StateMachine/CrossSchemaTransitionEvents",
      {
        transitionEvents: {
          // @ts-expect-error Property 'Position' is missing in type '{}' but required in type '{ readonly Position
          other: Game.System.readTransitionEvent(OtherState)
        }
      },
      () => {}
    )

    // @ts-expect-error Property 'Position' is missing in type '{}' but required in type '{ readonly Position
    Game.Schedule.onEnter(OtherState, "Idle", [ReaderSystem])

    const OtherBundle = OtherGame.Schedule.transitions(
      OtherGame.Schedule.onEnter(OtherState, "Idle", [])
    )

    Game.Schedule(
      ReaderSystem,
      // @ts-expect-error Property 'Position' is missing in type '{}' but required in type '{ readonly Position
      Game.Schedule.applyStateTransitions(OtherBundle)
    )
  })

  it("rejects runtimes that omit required machine initialization", () => {
    const runtime = Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0
      }
    }).success

    expect(runtime.machineValues).type.toBe<{}>()
  })

  it("accepts runtimes that initialize the required machine", () => {
    const runtime = Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0
      },
      machines: Runtime.machines(
        Runtime.machine(AppState, "Menu"),
        Runtime.machine(RoundState, "Warmup")
      )
    }).success

    expect(MachineSchedule).type.toBeAssignableTo<SchemaTypes.Schema.BoundSchedule<typeof schema, typeof schema>>()
  })

  it("accepts direct inline schedule execution for disjunctive machine conditions", () => {
    const IncrementWithOrCondition = Game.System(
      "StateMachine/InlineRunSchedule",
      {
        when: [
          Game.Condition.or(
            Game.Condition.inState(AppState, "Menu"),
            Game.Condition.inState(RoundState, "Live")
          )
        ],
        resources: {
          counter: System.writeResource(Counter)
        }
      },
      () => {}
    )

    const runtime = Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0
      },
      machines: Runtime.machines(
        Runtime.machine(AppState, "Menu"),
        Runtime.machine(RoundState, "Warmup")
      )
    }).success

    expect(Game.Schedule(IncrementWithOrCondition)).type.toBeAssignableTo<SchemaTypes.Schema.BoundSchedule<typeof schema, typeof schema>>()
  })

  it("rejects invalid multi-machine runtime initialization values", () => {
    Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0
      },
      machines: Runtime.machines(
        Runtime.machine(AppState, "Menu"),
        Runtime.machine(
          RoundState,
          // @ts-expect-error Argument of type '"Playing"' is not assignable to parameter of type
          "Playing"
        )
      )
    }).success
  })

  it("does not expose transition context on normal schedules", () => {
    Game.System(
      "StateMachine/NoTransitionContext",
      {},
      ({ transitions }) =>
        {
          // @ts-expect-error Property 'app' does not exist on type 'TransitionContext<SystemSpec<SchemaDefinition<{ readonly Position
          transitions.app
        }
    )
  })

  it("keeps transition schedules tied to the machine union", () => {
    Game.Schedule.onTransition(
      AppState,
      ["Menu", "Playing"] as const,
      [TransitionSystem]
    )

    Game.Schedule.onExit(
      AppState,
      // @ts-expect-error Argument of type '"GameOver"' is not assignable to parameter of type
      "GameOver",
      [TransitionSystem]
    )
  })

  it("includes transition bundle requirements in the parent schedule", () => {
    const Logger = Descriptor.Service<{ readonly log: (message: string) => void }>()("StateMachine/Logger")

    const TransitionWithService = Game.Schedule.onEnter(AppState, "Playing", [
      Game.System(
        "StateMachine/TransitionServiceRequirement",
        {
          transitions: {
            app: System.transition(AppState)
          },
          services: {
            logger: System.service(Logger)
          }
        },
        ({ services }) =>
          {
            services.logger.log("ok")
          }
      )
    ])

    const bundle = Game.Schedule.transitions(TransitionWithService)

    expect(bundle).type.toBeAssignableTo<SchemaTypes.Schema.BoundTransitionBundle<typeof schema, typeof schema>>()
  })

  it("keeps transition event unions exact across bundled transition schedules", () => {
    const bundle = Game.Schedule.transitions(
      Game.Schedule.onEnter(AppState, "Playing", [TransitionSystem]),
      Game.Schedule.onExit(AppState, "Paused", [TransitionSystem])
    )

    expect(bundle).type.toBeAssignableTo<SchemaTypes.Schema.BoundTransitionBundle<typeof schema, typeof schema>>()
  })

  it("rejects nested transition-application markers in transition schedules", () => {
    Game.Schedule.onEnter(AppState, "Playing", [
      TransitionSystem,
      // @ts-expect-error Type 'ApplyStateTransitionsStep<undefined, SchemaDefinition<{ readonly Position: Descriptor<"component"
      Game.Schedule.applyStateTransitions()
    ])
  })

  it("rejects applyDeferred() in an exit phase, and allows it on enter", () => {
    // @ts-expect-error onExit and onTransition schedules cannot contain applyDeferred()
    Game.Schedule.onExit(AppState, "Paused", [TransitionSystem, Game.Schedule.applyDeferred()])
    // @ts-expect-error onExit and onTransition schedules cannot contain applyDeferred()
    Game.Schedule.onTransition(AppState, ["Menu", "Playing"], [TransitionSystem, Game.Schedule.applyDeferred()])
    Game.Schedule.onEnter(AppState, "Playing", [TransitionSystem, Game.Schedule.applyDeferred()])
  })

  it("requires the machine of every transition schedule in an applied bundle", () => {
    const bundle = Game.Schedule.transitions(Game.Schedule.onEnter(RoundState, "Live", []))
    const withMachine = Game.Runtime.make({
      services: Runtime.services(),
      resources: { Counter: 0 },
      machines: Runtime.machines(Runtime.machine(RoundState, "Warmup"))
    }).success
    withMachine.tick(Game.Schedule(Game.Schedule.applyStateTransitions(bundle)))
    const withoutMachine = Game.Runtime.make({
      services: Runtime.services(),
      resources: { Counter: 0 },
      machines: Runtime.machines(Runtime.machine(AppState, "Menu"))
    }).success
    // @ts-expect-error __runtimeRequirementError__: "Missing machine"; readonly __requirement__: "RoundState"
    withoutMachine.tick(Game.Schedule(Game.Schedule.applyStateTransitions(bundle)))
  })

  it("gates a group of systems with Schedule.when, requiring the machines its conditions read", () => {
    const Increment = Game.System("StateMachine/WhenIncrement", { resources: { counter: System.writeResource(Counter) } }, ({ resources }) => {
      resources.counter.update((value) => value + 1)
    })
    const gated = Game.Schedule.when([Game.Condition.inState(AppState, "Playing")], Increment, Game.Schedule.applyDeferred())

    const withMachine = Game.Runtime.make({
      services: Runtime.services(),
      resources: { Counter: 0 },
      machines: Runtime.machines(Runtime.machine(AppState, "Menu"))
    }).success
    withMachine.tick(gated)

    const withoutMachine = Game.Runtime.make({ services: Runtime.services(), resources: { Counter: 0 } }).success
    // @ts-expect-error __runtimeRequirementError__: "Missing machine"; readonly __requirement__: "AppState"
    withoutMachine.tick(gated)

    // A machine of another game is rejected where the condition is built, naming the fix.
    // @ts-expect-error OtherState is a state machine of another game: use a machine defined with this game's Game.StateMachine(...)
    Game.Condition.inState(OtherState, "Idle")
    // @ts-expect-error OtherState is a state machine of another game: use a machine defined with this game's Game.StateMachine(...)
    Game.Condition.stateChanged(OtherState)
    expect(Game.Condition.inState(AppState, "Menu")).type.toBe<Machine.InStateCondition<typeof AppState>>()
    expect(Game.Condition.stateChanged(AppState)).type.toBe<Machine.StateChangedCondition<typeof AppState>>()

    // Conditions from another game do not fit.
    Game.Schedule.when(
      [
        // @ts-expect-error Property 'Position' is missing in type '{}' but required in type '{ readonly Position
        OtherGame.Condition.inState(OtherState, "Idle")
      ],
      Increment
    )

    // A group needs at least one condition.
    // @ts-expect-error Argument of type '[]' is not assignable to parameter of type 'readonly [Condition<SchemaDefinition<{ readonly
    Game.Schedule.when([], Increment)

    expect(gated).type.toBeAssignableTo<SchemaTypes.Schema.BoundSchedule<typeof schema, typeof schema>>()
  })
})
