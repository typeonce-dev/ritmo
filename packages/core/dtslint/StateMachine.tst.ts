import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Codecs from "../test/codecs.ts"
import type * as Machine from "@typeonce/ritmo/Machine"
import type * as Result from "@typeonce/ritmo/Result"
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
const Root = Schema.defineRoot("StateMachine")
const Game = Schema.bind(schema, Root)

const otherSchema = Schema.fragment({
  resources: {
    Counter
  }
})
const OtherRoot = Schema.defineRoot("StateMachine/Other")
const OtherGame = Schema.bind(otherSchema, OtherRoot)

const AppState = Game.StateMachine("AppState", { Menu: {}, Playing: {}, Paused: {} })
const RoundState = Game.StateMachine("RoundState", { Warmup: {}, Live: {}, SuddenDeath: {} })
const OtherState = OtherGame.StateMachine("OtherState", { Idle: {}, Running: {} })
const Mode = Game.StateMachine("StateMachine/Mode", {
  Exploring: {},
  Talking: Codecs.struct({ speaker: Codecs.string, pages: Codecs.array(Codecs.string), page: Codecs.integer })
})

type AppValue = { readonly _tag: "Menu" } | { readonly _tag: "Playing" } | { readonly _tag: "Paused" }
type Talking = { readonly _tag: "Talking"; readonly speaker: string; readonly pages: ReadonlyArray<string>; readonly page: number }
type ModeValue = { readonly _tag: "Exploring" } | Talking

const ReaderSystem = Game.System(
  "StateMachine/Reader",
  {
    machines: {
      app: System.machine(AppState)
    }
  },
  ({ machines }) =>
    {
      expect(machines.app.get()).type.toBe<AppValue>()
      expect(machines.app.is("Playing")).type.toBe<boolean>()
      // @ts-expect-error Argument of type '"GameOver"' is not assignable to parameter of type
      machines.app.is("GameOver")
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
      nextMachines.app.set({ _tag: "Playing" })
      nextMachines.app.setIfChanged({ _tag: "Paused" })
      expect(nextMachines.app.getPending()).type.toBe<AppValue | undefined>()
    }
)

const TransitionSystem = Game.System(
  "StateMachine/TransitionReader",
  {
    transitions: {
      app: System.readTransition(AppState)
    }
  },
  ({ transitions }) =>
    {
      expect(transitions.app.get()?.from).type.toBe<"Menu" | "Playing" | "Paused" | undefined>()
      expect(transitions.app.get()?.to).type.toBe<"Menu" | "Playing" | "Paused" | undefined>()
      // @ts-expect-error is possibly 'undefined'
      transitions.app.get().to
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
          expect(machines.app.get()).type.toBe<AppValue>()
          expect(machines.round.get()).type.toBe<{ readonly _tag: "Warmup" } | { readonly _tag: "Live" } | { readonly _tag: "SuddenDeath" }>()
          nextMachines.round.set({ _tag: "Live" })
          // @ts-expect-error Type '"Paused"' is not assignable to type '"Warmup" | "Live" | "SuddenDeath"'
          nextMachines.round.set({ _tag: "Paused" })
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
          // @ts-expect-error Type '"GameOver"' is not assignable to type '"Menu" | "Playing" | "Paused"'
          nextMachines.app.set({ _tag: "GameOver" })
        }
    )
  })

  it("rejects cross-schema machine references", () => {
    Game.System(
      "StateMachine/CrossSchemaSystem",
      {
        machines: {
          // @ts-expect-error Type 'RootToken<"StateMachine/Other">' is not assignable to type 'RootToken<"StateMachine">'
          other: System.machine(OtherState)
        }
      },
      () => {}
    )

    Game.System(
      "StateMachine/CrossSchemaTransitionEvents",
      {
        transitionEvents: {
          // @ts-expect-error Type 'RootToken<"StateMachine/Other">' is not assignable to type 'RootToken<"StateMachine">'
          other: Game.System.readTransitionEvent(OtherState)
        }
      },
      () => {}
    )

    // @ts-expect-error Type 'RootToken<"StateMachine/Other">' is not assignable to type 'RootToken<"StateMachine">'
    Game.Schedule.onEnter(OtherState, "Idle", [ReaderSystem])

    const OtherBundle = OtherGame.Schedule.transitions(
      OtherGame.Schedule.onEnter(OtherState, "Idle", [])
    )

    Game.Schedule(
      ReaderSystem,
      // @ts-expect-error Type 'RootToken<"StateMachine/Other">' is not assignable to type 'RootToken<"StateMachine">'
      Game.Schedule.applyStateTransitions(OtherBundle)
    )
  })

  it("rejects runtimes that omit required machine initialization", () => {
    const runtime = Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0
      }
    }).value

    expect(runtime.machineValues).type.toBe<{}>()
  })

  it("accepts runtimes that initialize the required machine", () => {
    const runtime = Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0
      },
      machines: Runtime.machines(
        Runtime.machine(AppState, { _tag: "Menu" }),
        Runtime.machine(RoundState, { _tag: "Warmup" })
      )
    }).value

    expect(MachineSchedule).type.toBeAssignableTo<SchemaTypes.Schema.BoundSchedule<typeof schema, typeof Root>>()
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
        Runtime.machine(AppState, { _tag: "Menu" }),
        Runtime.machine(RoundState, { _tag: "Warmup" })
      )
    }).value

    expect(Game.Schedule(IncrementWithOrCondition)).type.toBeAssignableTo<SchemaTypes.Schema.BoundSchedule<typeof schema, typeof Root>>()
  })

  it("rejects invalid multi-machine runtime initialization values", () => {
    Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0
      },
      machines: Runtime.machines(
        Runtime.machine(AppState, { _tag: "Menu" }),
        Runtime.machine(
          RoundState,
          // @ts-expect-error Type '"Playing"' is not assignable to type '"Warmup" | "Live" | "SuddenDeath"'
          { _tag: "Playing" }
        )
      )
    }).value
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
            app: System.readTransition(AppState)
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

    expect(bundle).type.toBeAssignableTo<SchemaTypes.Schema.BoundTransitionBundle<typeof schema, typeof Root>>()
  })

  it("keeps transition event unions exact across bundled transition schedules", () => {
    const bundle = Game.Schedule.transitions(
      Game.Schedule.onEnter(AppState, "Playing", [TransitionSystem]),
      Game.Schedule.onExit(AppState, "Paused", [TransitionSystem])
    )

    expect(bundle).type.toBeAssignableTo<SchemaTypes.Schema.BoundTransitionBundle<typeof schema, typeof Root>>()
  })

  it("rejects nested transition-application markers in transition schedules", () => {
    Game.Schedule.onEnter(AppState, "Playing", [
      TransitionSystem,
      // @ts-expect-error Type 'ApplyStateTransitionsStep<undefined, RootToken<"StateMachine">>' is not assignable to type 'BoundTransitionEntry<
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
      machines: Runtime.machines(Runtime.machine(RoundState, { _tag: "Warmup" }))
    }).value
    withMachine.tick(Game.Schedule(Game.Schedule.applyStateTransitions(bundle)))
    const withoutMachine = Game.Runtime.make({
      services: Runtime.services(),
      resources: { Counter: 0 },
      machines: Runtime.machines(Runtime.machine(AppState, { _tag: "Menu" }))
    }).value
    // @ts-expect-error the runtime is missing machine RoundState
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
      machines: Runtime.machines(Runtime.machine(AppState, { _tag: "Menu" }))
    }).value
    withMachine.tick(gated)

    const withoutMachine = Game.Runtime.make({ services: Runtime.services(), resources: { Counter: 0 } }).value
    // @ts-expect-error the runtime is missing machine AppState
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
        // @ts-expect-error Type 'RootToken<"StateMachine/Other">' is not assignable to type 'RootToken<"StateMachine">'
        OtherGame.Condition.inState(OtherState, "Idle")
      ],
      Increment
    )

    // A group needs at least one condition.
    // @ts-expect-error Argument of type '[]' is not assignable to parameter of type 'readonly [Condition<RootToken<"StateMachine">>, ...Condition<RootToken<"StateMachine">>[]]'
    Game.Schedule.when([], Increment)

    expect(gated).type.toBeAssignableTo<SchemaTypes.Schema.BoundSchedule<typeof schema, typeof Root>>()
  })
})

describe("per-state data", () => {
  it("is a tagged union of each state with its own fields", () => {
    expect<Machine.StateOf<typeof Mode>>().type.toBe<ModeValue>()
    expect<Machine.StateOf<typeof Mode, "Talking">>().type.toBe<Talking>()
    expect<Machine.StateOf<typeof AppState, "Menu">>().type.toBe<{ readonly _tag: "Menu" }>()
    expect<Machine.StateMachine.State<typeof Mode>>().type.toBe<"Exploring" | "Talking">()
    // @ts-expect-error Type '"Asleep"' does not satisfy the constraint 'State<
    type Asleep = Machine.StateOf<typeof Mode, "Asleep">
  })

  it("rejects a machine without states, and a field named _tag", () => {
    // @ts-expect-error a state machine needs at least one state
    Game.StateMachine("StateMachine/Empty", {})
    // @ts-expect-error `_tag` holds the state's name: give this field another name
    Game.StateMachine("StateMachine/Tagged", { Idle: Codecs.struct({ _tag: Codecs.string }) })
    // @ts-expect-error Type 'string' is not assignable to type 'object'.
    Game.StateMachine("StateMachine/Array", ["Menu"])
  })

  it("reads the committed value, narrowed on _tag", () => {
    Game.System("StateMachine/ReadMode", { machines: { mode: System.machine(Mode) } }, ({ machines }) => {
      const mode = machines.mode.get()
      expect(mode).type.toBe<{ readonly _tag: "Exploring" } | { readonly _tag: "Talking"; readonly speaker: string; readonly pages: ReadonlyArray<string>; readonly page: number }>()
      if (mode._tag === "Talking") expect(mode.speaker).type.toBe<string>()
      // @ts-expect-error Property 'speaker' does not exist on type '{ readonly _tag: "Exploring"; }'
      mode.speaker
      // @ts-expect-error Property 'update' does not exist on type 'MachineReadView
      machines.mode.update
    })
  })

  it("queues a move with all of the target's fields and only them", () => {
    Game.System("StateMachine/MoveMode", { nextMachines: { mode: System.nextState(Mode) } }, ({ nextMachines }) => {
      expect(nextMachines.mode.set({ _tag: "Talking", speaker: "Mira", pages: ["Hi"], page: 0 })).type.toBe<void>()
      nextMachines.mode.set({ _tag: "Exploring" })
      nextMachines.mode.setIfChanged({ _tag: "Talking", speaker: "Mira", pages: ["Hi"], page: 0 })
      // @ts-expect-error Property 'pages' is missing in type
      nextMachines.mode.set({ _tag: "Talking", speaker: "Mira", page: 0 })
      // @ts-expect-error Object literal may only specify known properties, and 'speaker' does not exist in type '{ readonly _tag: "Exploring"; }'
      nextMachines.mode.set({ _tag: "Exploring", speaker: "Mira" })
      // @ts-expect-error Type 'string' is not assignable to type 'number'
      nextMachines.mode.set({ _tag: "Talking", speaker: "Mira", pages: [], page: "0" })
    })
  })

  it("updates the current state's fields with a compare-and-set", () => {
    Game.System("StateMachine/UpdateMode", { machines: { mode: System.updateMachine(Mode) } }, ({ machines }) => {
      expect(machines.mode.get()._tag).type.toBe<"Exploring" | "Talking">()
      const updated = machines.mode.update({ state: "Talking", data: (talking) => ({ ...talking, page: talking.page + 1 }) })
      expect(updated).type.toBe<Result.Result<void, Machine.MachineStateMismatchError<"Exploring" | "Talking">>>()
      machines.mode.update({ state: "Talking", data: (talking) => {
        expect(talking).type.toBe<{ readonly _tag: "Talking"; readonly speaker: string; readonly pages: ReadonlyArray<string>; readonly page: number }>()
        return { speaker: talking.speaker, pages: talking.pages, page: 0 }
      } })
      // @ts-expect-error Talking has no field typo: write only this state's fields, or move with nextMachines.x.transition(...)
      machines.mode.update({ state: "Talking", data: (talking) => ({ ...talking, typo: 1 }) })
      // @ts-expect-error Property 'pages' is missing in type
      machines.mode.update({ state: "Talking", data: (talking) => ({ speaker: talking.speaker, page: 0 }) })
      // @ts-expect-error Type '"Exploring"' is not assignable to type '"Talking"'
      machines.mode.update({ state: "Talking", data: (talking) => ({ ...talking, _tag: "Exploring" as const }) })
      // @ts-expect-error Type '"Asleep"' is not assignable to type 'State<
      machines.mode.update({ state: "Asleep", data: (current) => current })
    })
  })

  it("keeps updates out of read-only access, and one slot per machine", () => {
    // @ts-expect-error Type '"update"' is not assignable to type '"read"'
    Game.Condition.check("StateMachine/CheckUpdate", { machines: { mode: System.updateMachine(Mode) } }, () => true)
    // @ts-expect-error Type '"update"' is not assignable to type '"read"'
    Game.Inspector("StateMachine/InspectUpdate", { machines: { mode: System.updateMachine(Mode) } }, () => 0)
    Game.System("StateMachine/TwoSlots", {
      // @ts-expect-error read repeats a machine another slot of this system declares: keep one slot (an update view reads too)
      machines: { read: System.machine(Mode), update: System.updateMachine(Mode) }
    }, () => {})
  })

  it("starts a runtime with a full value", () => {
    Game.Runtime.make({
      services: Runtime.services(),
      resources: { Counter: 0 },
      machines: Runtime.machines(Runtime.machine(Mode, { _tag: "Talking", speaker: "Mira", pages: [], page: 0 }))
    })
    // @ts-expect-error Property 'pages' is missing in type
    Runtime.machine(Mode, { _tag: "Talking", speaker: "Mira", page: 0 })
  })

  it("names states in transitions, conditions and schedules", () => {
    Game.System("StateMachine/ModeEvents", { transitionEvents: { mode: Game.System.readTransitionEvent(Mode) } }, ({ transitionEvents }) => {
      expect(transitionEvents.mode.all()).type.toBe<ReadonlyArray<{ readonly from: "Exploring" | "Talking"; readonly to: "Exploring" | "Talking" }>>()
    })
    Game.Condition.inState(Mode, "Talking")
    Game.Schedule.onEnter(Mode, "Talking", [])
    Game.Schedule.onTransition(Mode, ["Exploring", "Talking"], [])
  })
})
