import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"
import * as System from "@typeonce/ritmo/System"
import { readResourceValue } from "./utils/fixtures.ts"

const Counter = Descriptor.Resource<number>()("StateMachineRuntime/Counter")
const Log = Descriptor.Resource<ReadonlyArray<string>>()("StateMachineRuntime/Log")

const Game = Schema.bind(Schema.fragment({
  resources: {
    Counter,
    Log
  }
}))
const schema = Game.schema
const AppState = Game.StateMachine("AppState", ["Menu", "Playing", "Paused"] as const)
const RoundState = Game.StateMachine("RoundState", ["Warmup", "Live", "SuddenDeath"] as const)

const makeRuntime = () =>
  Game.Runtime.make({
    services: Runtime.services(),
    resources: {
      Counter: 0,
      Log: []
    },
    machines: Runtime.machines(
      Runtime.machine(AppState, "Menu"),
      Runtime.machine(RoundState, "Warmup")
    )
  }).success

describe("Runtime state machine", () => {
  it("gates systems by the committed current state", () => {
    const increment = Game.System(
      "StateMachineRuntime/IncrementWhilePlaying",
      {
        when: [Game.Condition.inState(AppState, "Playing")],
        resources: {
          counter: System.writeResource(Counter)
        }
      },
      ({ resources }) =>
        {
          resources.counter.update((value) => value + 1)
        }
    )

    const runtime = Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0,
        Log: []
      },
      machines: Runtime.machines(
        Runtime.machine(AppState, "Menu"),
        Runtime.machine(RoundState, "Warmup")
      )
    }).success
    runtime.tick(Game.Schedule(increment))

    expect(readResourceValue(runtime, schema, Counter)).toBe(0)

    const queuePlaying = Game.System(
      "StateMachineRuntime/QueuePlaying",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
        }
    )

    const applyPlayingSchedule = Game.Schedule(queuePlaying, Game.Schedule.applyStateTransitions(), increment)

    runtime.tick(applyPlayingSchedule)

    expect(readResourceValue(runtime, schema, Counter)).toBe(1)
  })

  it("keeps queued transitions invisible until applyStateTransitions", () => {
    const queuePlaying = Game.System(
      "StateMachineRuntime/QueuePlayingForVisibility",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
        }
    )

    const before = Game.System(
      "StateMachineRuntime/BeforeTransition",
      {
        when: [Game.Condition.inState(AppState, "Menu")],
        machines: {
          app: System.machine(AppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ machines, resources }) =>
        {
          resources.log.update((entries) => [...entries, `before:${machines.app.get()}`])
        }
    )

    const after = Game.System(
      "StateMachineRuntime/AfterTransition",
      {
        when: [Game.Condition.inState(AppState, "Playing")],
        machines: {
          app: System.machine(AppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ machines, resources }) =>
        {
          resources.log.update((entries) => [...entries, `after:${machines.app.get()}`])
        }
    )

    const runtime = Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0,
        Log: []
      },
      machines: Runtime.machines(
        Runtime.machine(AppState, "Menu"),
        Runtime.machine(RoundState, "Warmup")
      )
    }).success
    const transitionVisibilitySchedule = Game.Schedule(queuePlaying, before, Game.Schedule.applyStateTransitions(), after)
    runtime.tick(transitionVisibilitySchedule)

    expect(readResourceValue(runtime, schema, Log)).toEqual(["before:Menu", "after:Playing"])
  })

  it("runs exit, transition, and enter schedules in order", () => {
    const queuePlaying = Game.System(
      "StateMachineRuntime/QueueTransitionOrder",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
        }
    )

    const exitSystem = Game.System(
      "StateMachineRuntime/OnExitMenu",
      {
        transitions: {
          app: System.transition(AppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitions, resources }) =>
        {
          const transition = transitions.app.get()
          resources.log.update((entries) => [...entries, `exit:${transition.from}->${transition.to}`])
        }
    )

    const transitionSystem = Game.System(
      "StateMachineRuntime/OnTransitionMenuToPlaying",
      {
        transitions: {
          app: System.transition(AppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitions, resources }) =>
        {
          const transition = transitions.app.get()
          resources.log.update((entries) => [...entries, `transition:${transition.from}->${transition.to}`])
        }
    )

    const enterSystem = Game.System(
      "StateMachineRuntime/OnEnterPlaying",
      {
        transitions: {
          app: System.transition(AppState)
        },
        machines: {
          app: System.machine(AppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitions, machines, resources }) =>
        {
          const transition = transitions.app.get()
          resources.log.update((entries) => [...entries, `enter:${transition.from}->${transition.to}:${machines.app.get()}`])
        }
    )

    const transitions = Game.Schedule.transitions(
      Game.Schedule.onExit(AppState, "Menu", [exitSystem]),
      Game.Schedule.onTransition(AppState, ["Menu", "Playing"] as const, [transitionSystem]),
      Game.Schedule.onEnter(AppState, "Playing", [enterSystem])
    )

    const runtime = Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0,
        Log: []
      },
      machines: Runtime.machines(
        Runtime.machine(AppState, "Menu"),
        Runtime.machine(RoundState, "Warmup")
      )
    }).success
    const bundledTransitionSchedule = Game.Schedule(queuePlaying, Game.Schedule.applyStateTransitions(transitions))
    runtime.tick(bundledTransitionSchedule)

    expect(readResourceValue(runtime, schema, Log)).toEqual([
      "exit:Menu->Playing",
      "transition:Menu->Playing",
      "enter:Menu->Playing:Playing"
    ])
  })

  it("supports stateChanged conditions after the transition marker", () => {
    const queuePlaying = Game.System(
      "StateMachineRuntime/QueueForChanged",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
        }
    )

    const observeChanged = Game.System(
      "StateMachineRuntime/ObserveChanged",
      {
        when: [Game.Condition.stateChanged(AppState)],
        resources: {
          counter: System.writeResource(Counter)
        }
      },
      ({ resources }) =>
        {
          resources.counter.update((value) => value + 1)
        }
    )

    const runtime = Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0,
        Log: []
      },
      machines: Runtime.machines(
        Runtime.machine(AppState, "Menu"),
        Runtime.machine(RoundState, "Warmup")
      )
    }).success
    const changedSchedule = Game.Schedule(queuePlaying, Game.Schedule.applyStateTransitions(), observeChanged)
    runtime.tick(changedSchedule)

    expect(readResourceValue(runtime, schema, Counter)).toBe(1)
  })

  it("gates systems directly with machine conditions", () => {
    const first = Game.System(
      "StateMachineRuntime/SetFirst",
      {
        when: [Game.Condition.inState(AppState, "Playing")],
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "first"])
        }
    )

    const second = Game.System(
      "StateMachineRuntime/SetSecond",
      {
        when: [Game.Condition.inState(AppState, "Playing")],
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "second"])
        }
    )

    const runtime = Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0,
        Log: []
      },
      machines: Runtime.machines(
        Runtime.machine(AppState, "Menu"),
        Runtime.machine(RoundState, "Warmup")
      )
    }).success
    runtime.tick(Game.Schedule(first, second))

    expect(readResourceValue(runtime, schema, Log)).toEqual([])
  })

  it("supports conditions composed across multiple machines", () => {
    const queueStates = Game.System(
      "StateMachineRuntime/QueueMultipleMachines",
      {
        nextMachines: {
          app: System.nextState(AppState),
          round: System.nextState(RoundState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
          nextMachines.round.set("Live")
        }
    )

    const gated = Game.System(
      "StateMachineRuntime/MultiMachineGated",
      {
        when: [
          Game.Condition.and(
            Game.Condition.inState(AppState, "Playing"),
            Game.Condition.inState(RoundState, "Live")
          )
        ],
        resources: {
          counter: System.writeResource(Counter)
        }
      },
      ({ resources }) =>
        {
          resources.counter.update((value) => value + 1)
        }
    )

    const runtime = Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0,
        Log: []
      },
      machines: Runtime.machines(
        Runtime.machine(AppState, "Menu"),
        Runtime.machine(RoundState, "Warmup")
      )
    }).success
    const gatedSchedule = Game.Schedule(queueStates, Game.Schedule.applyStateTransitions(), gated)
    runtime.tick(gatedSchedule)

    expect(readResourceValue(runtime, schema, Counter)).toBe(1)
  })

  it("supports disjunctive machine conditions at runtime", () => {
    const increment = Game.System(
      "StateMachineRuntime/OrCondition",
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
      ({ resources }) =>
        {
          resources.counter.update((value) => value + 1)
        }
    )

    const runtime = Game.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0,
        Log: []
      },
      machines: Runtime.machines(
        Runtime.machine(AppState, "Menu"),
        Runtime.machine(RoundState, "Warmup")
      )
    }).success
    const incrementSchedule = Game.Schedule(increment)
    runtime.tick(incrementSchedule)

    expect(readResourceValue(runtime, schema, Counter)).toBe(1)
  })

  it("applies multiple machine transitions in definition order", () => {
    const LocalGame = Schema.bind(schema)
    const LocalAppState = LocalGame.StateMachine("LocalAppState", ["Menu", "Playing", "Paused"] as const)
    const LocalRoundState = LocalGame.StateMachine("LocalRoundState", ["Warmup", "Live", "SuddenDeath"] as const)

    const queueStates = LocalGame.System(
      "StateMachineRuntime/QueueDefinitionOrder",
      {
        nextMachines: {
          round: System.nextState(LocalRoundState),
          app: System.nextState(LocalAppState)
        }
      },
      ({ nextMachines }) =>
        {
          // Intentionally queued in reverse declaration order.
          nextMachines.round.set("Live")
          nextMachines.app.set("Playing")
        }
    )

    const appEnter = LocalGame.System(
      "StateMachineRuntime/AppEnterPlaying",
      {
        transitions: {
          app: System.transition(LocalAppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitions, resources }) =>
        {
          const transition = transitions.app.get()
          resources.log.update((entries) => [...entries, `app:${transition.from}->${transition.to}`])
        }
    )

    const roundEnter = LocalGame.System(
      "StateMachineRuntime/RoundEnterLive",
      {
        transitions: {
          round: System.transition(LocalRoundState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitions, resources }) =>
        {
          const transition = transitions.round.get()
          resources.log.update((entries) => [...entries, `round:${transition.from}->${transition.to}`])
        }
    )

    const transitions = LocalGame.Schedule.transitions(
      LocalGame.Schedule.onEnter(LocalAppState, "Playing", [appEnter]),
      LocalGame.Schedule.onEnter(LocalRoundState, "Live", [roundEnter])
    )

    const runtime = LocalGame.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0,
        Log: []
      },
      machines: Runtime.machines(
        Runtime.machine(LocalAppState, "Menu"),
        Runtime.machine(LocalRoundState, "Warmup")
      )
    }).success
    const localTransitionSchedule = LocalGame.Schedule(queueStates, LocalGame.Schedule.applyStateTransitions(transitions))
    runtime.tick(localTransitionSchedule)

    expect(readResourceValue(runtime, schema, Log)).toEqual([
      "app:Menu->Playing",
      "round:Warmup->Live"
    ])
  })

  it("defers transitions queued during transition schedules to the next marker", () => {
    const LocalGame = Schema.bind(schema)
    const LocalAppState = LocalGame.StateMachine("LocalAppStateDeferred", ["Menu", "Playing", "Paused"] as const)
    const LocalRoundState = LocalGame.StateMachine("LocalRoundStateDeferred", ["Warmup", "Live", "SuddenDeath"] as const)

    const queueApp = LocalGame.System(
      "StateMachineRuntime/QueueAppOnly",
      {
        nextMachines: {
          app: System.nextState(LocalAppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
        }
    )

    const queueRoundDuringEnter = LocalGame.System(
      "StateMachineRuntime/QueueRoundDuringEnter",
      {
        transitions: {
          app: System.transition(LocalAppState)
        },
        nextMachines: {
          round: System.nextState(LocalRoundState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitions, nextMachines, resources }) =>
        {
          const transition = transitions.app.get()
          resources.log.update((entries) => [...entries, `enter-app:${transition.to}`])
          nextMachines.round.set("SuddenDeath")
        }
    )

    const observeRoundChange = LocalGame.System(
      "StateMachineRuntime/ObserveDeferredRoundChange",
      {
        when: [LocalGame.Condition.stateChanged(LocalRoundState)],
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ resources }) =>
        {
          resources.log.update((entries) => [...entries, "round-changed"])
        }
    )

    const observeRoundState = LocalGame.System(
      "StateMachineRuntime/ObserveRoundState",
      {
        machines: {
          round: System.machine(LocalRoundState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ machines, resources }) =>
        {
          resources.log.update((entries) => [...entries, `round:${machines.round.get()}`])
        }
    )

    const transitions = LocalGame.Schedule.transitions(
      LocalGame.Schedule.onEnter(LocalAppState, "Playing", [queueRoundDuringEnter])
    )

    const runtime = LocalGame.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0,
        Log: []
      },
      machines: Runtime.machines(
        Runtime.machine(LocalAppState, "Menu"),
        Runtime.machine(LocalRoundState, "Warmup")
      )
    }).success
    const localRoundSchedule = LocalGame.Schedule(queueApp, LocalGame.Schedule.applyStateTransitions(transitions), observeRoundChange, observeRoundState)
    runtime.tick(localRoundSchedule)

    expect(readResourceValue(runtime, schema, Log)).toEqual([
      "enter-app:Playing",
      "round:Warmup"
    ])

    const observeRoundSchedule = LocalGame.Schedule(LocalGame.Schedule.applyStateTransitions(), observeRoundChange, observeRoundState)
    runtime.tick(observeRoundSchedule)

    expect(readResourceValue(runtime, schema, Log)).toEqual([
      "enter-app:Playing",
      "round:Warmup",
      "round-changed",
      "round:SuddenDeath"
    ])
  })

  it("commits a request queued before the marker even when a transition schedule queues the same machine", () => {
    const LocalGame = Schema.bind(schema)
    const LocalAppState = LocalGame.StateMachine("LocalAppStateReplaced", ["Menu", "Playing", "Paused"] as const)
    const LocalRoundState = LocalGame.StateMachine("LocalRoundStateReplaced", ["Warmup", "Live", "SuddenDeath"] as const)

    const queueBoth = LocalGame.System("StateMachineRuntime/QueueBoth", {
      nextMachines: { app: System.nextState(LocalAppState), round: System.nextState(LocalRoundState) }
    }, ({ nextMachines }) => {
      nextMachines.app.set("Playing")
      nextMachines.round.set("Live")
    })
    const queueRoundDuringEnter = LocalGame.System("StateMachineRuntime/QueueRoundDuringEnterReplaced", {
      nextMachines: { round: System.nextState(LocalRoundState) }
    }, ({ nextMachines }) => {
      nextMachines.round.set("SuddenDeath")
    })
    const observe = LocalGame.System("StateMachineRuntime/ObserveReplacedRound", {
      machines: { round: System.machine(LocalRoundState) },
      transitionEvents: { round: System.readTransitionEvent(LocalRoundState) },
      resources: { log: System.writeResource(Log) }
    }, ({ machines, transitionEvents, resources }) => {
      resources.log.update((entries) => [...entries, `round:${machines.round.get()} ${JSON.stringify(transitionEvents.round.all())}`])
    })

    const transitions = LocalGame.Schedule.transitions(
      LocalGame.Schedule.onEnter(LocalAppState, "Playing", [queueRoundDuringEnter])
    )
    const runtime = LocalGame.Runtime.make({
      services: Runtime.services(),
      resources: { Counter: 0, Log: [] },
      machines: Runtime.machines(Runtime.machine(LocalAppState, "Menu"), Runtime.machine(LocalRoundState, "Warmup"))
    }).success

    // Live was queued before the marker: it commits there. SuddenDeath was
    // queued by a transition schedule during the marker: it waits for the next.
    runtime.tick(LocalGame.Schedule(queueBoth, LocalGame.Schedule.applyStateTransitions(transitions), observe))
    runtime.tick(LocalGame.Schedule(LocalGame.Schedule.applyStateTransitions(), observe))

    expect(readResourceValue(runtime, schema, Log)).toEqual([
      "round:Live [{\"from\":\"Warmup\",\"to\":\"Live\"}]",
      "round:SuddenDeath [{\"from\":\"Live\",\"to\":\"SuddenDeath\"}]"
    ])
  })

  it("reports a transition schedule's machine as a missing requirement in tryTick", () => {
    const LocalGame = Schema.bind(schema)
    const LocalAppState = LocalGame.StateMachine("LocalAppStateMissing", ["Menu", "Playing"] as const)
    const bundle = LocalGame.Schedule.transitions(LocalGame.Schedule.onEnter(LocalAppState, "Playing", []))
    const runtime = LocalGame.Runtime.make({ services: Runtime.services(), resources: { Counter: 0, Log: [] } }).success
    const erasedTryTick = runtime.tryTick as (schedule: unknown) => unknown
    expect(erasedTryTick(LocalGame.Schedule(LocalGame.Schedule.applyStateTransitions(bundle)))).toEqual({
      _tag: "Failure",
      failure: { _tag: "MissingRuntimeRequirements", requirements: [{ kind: "stateMachine", name: "LocalAppStateMissing" }] }
    })
  })

  it("does not run transition handlers unless the bundle is attached to the marker", () => {
    const queuePlaying = Game.System(
      "StateMachineRuntime/QueueWithoutBundle",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
        }
    )

    const onEnterPlaying = Game.System(
      "StateMachineRuntime/ExplicitBundleOnly",
      {
        transitions: {
          app: System.transition(AppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitions, resources }) =>
        {
          resources.log.update((entries) => [...entries, `entered:${transitions.app.get().to}`])
        }
    )

    const bundle = Game.Schedule.transitions(
      Game.Schedule.onEnter(AppState, "Playing", [onEnterPlaying])
    )

    const runtime = makeRuntime()
    const applyQueuedTransitionSchedule = Game.Schedule(queuePlaying, Game.Schedule.applyStateTransitions())
    runtime.tick(applyQueuedTransitionSchedule)

    expect(readResourceValue(runtime, schema, Log)).toEqual([])

    const applyBundledTransitionSchedule = Game.Schedule(queuePlaying, Game.Schedule.applyStateTransitions(bundle))
    runtime.tick(applyBundledTransitionSchedule)

    expect(readResourceValue(runtime, schema, Log)).toEqual(["entered:Playing"])
  })

  it("commits queued transitions even when no transition bundle is attached", () => {
    const queuePlaying = Game.System(
      "StateMachineRuntime/QueueWithoutHandlers",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
        }
    )

    const observe = Game.System(
      "StateMachineRuntime/ObserveCommittedWithoutBundle",
      {
        machines: {
          app: System.machine(AppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ machines, resources }) =>
        {
          resources.log.update((entries) => [...entries, machines.app.get()])
        }
    )

    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(queuePlaying, Game.Schedule.applyStateTransitions(), observe))

    expect(readResourceValue(runtime, schema, Log)).toEqual(["Playing"])
  })

  it("publishes each transition event once to every reader, without a marker", () => {
    const queuePlaying = Game.System(
      "StateMachineRuntime/QueuePlayingForTransitionEvents",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
        }
    )

    const readTransitionEvents = Game.System(
      "StateMachineRuntime/ReadTransitionEvents",
      {
        transitionEvents: {
          app: Game.System.readTransitionEvent(AppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitionEvents, resources }) =>
        {
          for (const event of transitionEvents.app.all()) {
            resources.log.update((entries) => [...entries, `event:${event.from}->${event.to}`])
          }
        }
    )

    const readTransitionEventsAfterUpdate = Game.System(
      "StateMachineRuntime/ReadTransitionEventsAfterUpdate",
      {
        transitionEvents: {
          app: System.readTransitionEvent(AppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitionEvents, resources }) =>
        {
          for (const event of transitionEvents.app.all()) {
            resources.log.update((entries) => [...entries, `event:${event.from}->${event.to}`])
          }
        }
    )

    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(
      queuePlaying,
      Game.Schedule.applyStateTransitions(),
      readTransitionEvents,
      readTransitionEventsAfterUpdate
    ))
    expect(readResourceValue(runtime, schema, Log)).toEqual(["event:Menu->Playing", "event:Menu->Playing"])

    // A later tick without transitions delivers nothing new.
    runtime.tick(Game.Schedule(readTransitionEvents, readTransitionEventsAfterUpdate))
    expect(readResourceValue(runtime, schema, Log)).toEqual(["event:Menu->Playing", "event:Menu->Playing"])
  })

  it("emits transition events in machine definition order", () => {
    const LocalGame = Schema.bind(schema)
    const LocalAppState = LocalGame.StateMachine("LocalAppStateEvents", ["Menu", "Playing", "Paused"] as const)
    const LocalRoundState = LocalGame.StateMachine("LocalRoundStateEvents", ["Warmup", "Live", "SuddenDeath"] as const)

    const queueStates = LocalGame.System(
      "StateMachineRuntime/QueueEventOrderStates",
      {
        nextMachines: {
          round: System.nextState(LocalRoundState),
          app: System.nextState(LocalAppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.round.set("Live")
          nextMachines.app.set("Playing")
        }
    )

    const readAppEvents = LocalGame.System(
      "StateMachineRuntime/ReadAppTransitionEvents",
      {
        transitionEvents: {
          app: LocalGame.System.readTransitionEvent(LocalAppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitionEvents, resources }) =>
        {
          for (const event of transitionEvents.app.all()) {
            resources.log.update((entries) => [...entries, `app:${event.from}->${event.to}`])
          }
        }
    )

    const readRoundEvents = LocalGame.System(
      "StateMachineRuntime/ReadRoundTransitionEvents",
      {
        transitionEvents: {
          round: LocalGame.System.readTransitionEvent(LocalRoundState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitionEvents, resources }) =>
        {
          for (const event of transitionEvents.round.all()) {
            resources.log.update((entries) => [...entries, `round:${event.from}->${event.to}`])
          }
        }
    )

    const runtime = LocalGame.Runtime.make({
      services: Runtime.services(),
      resources: {
        Counter: 0,
        Log: []
      },
      machines: Runtime.machines(
        Runtime.machine(LocalAppState, "Menu"),
        Runtime.machine(LocalRoundState, "Warmup")
      )
    }).success

    runtime.tick(LocalGame.Schedule(
      queueStates,
      LocalGame.Schedule.applyStateTransitions(),
      readAppEvents,
      readRoundEvents
    ))

    expect(readResourceValue(runtime, schema, Log)).toEqual([
      "app:Menu->Playing",
      "round:Warmup->Live"
    ])
  })

  it("supports flattened transition bundles", () => {
    const queuePlaying = Game.System(
      "StateMachineRuntime/QueuePlayingForFlattenedBundle",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
        }
    )

    const logEnterPlaying = Game.System(
      "StateMachineRuntime/FlattenedBundleEnterPlaying",
      {
        transitions: {
          app: System.transition(AppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitions, resources }) =>
        {
          resources.log.update((entries) => [...entries, `enter:${transitions.app.get().to}`])
        }
    )

    const nested = Game.Schedule.transitions(
      Game.Schedule.onEnter(AppState, "Playing", [logEnterPlaying])
    )

    const flattened = Game.Schedule.transitions(nested)

    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(queuePlaying, Game.Schedule.applyStateTransitions(flattened)))

    expect(readResourceValue(runtime, schema, Log)).toEqual(["enter:Playing"])
  })

  it("supports fragments inside transition schedules", () => {
    const queuePlaying = Game.System(
      "StateMachineRuntime/QueuePlayingForTransitionFragment",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
        }
    )

    const logEnterPlaying = Game.System(
      "StateMachineRuntime/TransitionFragmentEnterPlaying",
      {
        transitions: {
          app: System.transition(AppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitions, resources }) =>
        {
          resources.log.update((entries) => [...entries, `fragment:${transitions.app.get().to}`])
        }
    )

    const enterWork = Game.Schedule(logEnterPlaying)

    const transitions = Game.Schedule.transitions(
      Game.Schedule.onEnter(AppState, "Playing", [enterWork])
    )

    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(queuePlaying, Game.Schedule.applyStateTransitions(transitions)))

    expect(readResourceValue(runtime, schema, Log)).toEqual(["fragment:Playing"])
  })

  it("supports phases inside transition schedules", () => {
    const queuePlaying = Game.System(
      "StateMachineRuntime/QueuePlayingForTransitionPhase",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
        }
    )

    const logEnterPlaying = Game.System(
      "StateMachineRuntime/TransitionPhaseEnterPlaying",
      {
        transitions: {
          app: System.transition(AppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitions, resources }) =>
        {
          resources.log.update((entries) => [...entries, `phase:${transitions.app.get().to}`])
        }
    )

    const enterWork = Game.Schedule(logEnterPlaying)

    const transitions = Game.Schedule.transitions(
      Game.Schedule.onEnter(AppState, "Playing", [enterWork])
    )

    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(queuePlaying, Game.Schedule.applyStateTransitions(transitions)))

    expect(readResourceValue(runtime, schema, Log)).toEqual(["phase:Playing"])
  })

  it("throws when transition schedules contain nested applyStateTransitions markers at runtime", () => {
    const queuePlaying = Game.System(
      "StateMachineRuntime/QueueNestedInvalid",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
        }
    )

    const noop = Game.System(
      "StateMachineRuntime/NestedInvalidNoop",
      {},
      () => {}
    )

    const validEnter = Game.Schedule.onEnter(AppState, "Playing", [noop])
    const invalidEnter = {
      ...validEnter,
      steps: [...validEnter.steps, Game.Schedule.applyStateTransitions()]
    } as typeof validEnter

    const runtime = makeRuntime()
    expect(() =>
      runtime.tick(Game.Schedule(queuePlaying, Game.Schedule.applyStateTransitions(Game.Schedule.transitions(invalidEnter))))
    ).toThrow("Transition schedules cannot contain applyStateTransitions() steps")
  })

  it("throws when transition fragments contain nested applyStateTransitions markers at runtime", () => {
    const queuePlaying = Game.System(
      "StateMachineRuntime/QueuePlayingForInvalidFragment",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.set("Playing")
        }
    )

    const noop = Game.System(
      "StateMachineRuntime/InvalidFragmentNoop",
      {},
      () => {}
    )

    const invalidFragment = Game.Schedule(
        noop,
        Game.Schedule.applyStateTransitions()
      )

    const invalidEnter = Game.Schedule.onEnter(AppState, "Playing", [invalidFragment])

    const runtime = makeRuntime()
    const runInvalidSchedule = runtime.tick as (schedule: unknown) => void
    expect(() =>
      runInvalidSchedule(Game.Schedule(queuePlaying, Game.Schedule.applyStateTransitions(Game.Schedule.transitions(invalidEnter))))
    ).toThrow("Transition schedules cannot contain applyStateTransitions() steps")
  })

  it("rejects duplicate machine names on one bound game", () => {
    const LocalGame = Schema.bind(schema)
    LocalGame.StateMachine("DuplicateMachine", ["A", "B"] as const)

    expect(() =>
      LocalGame.StateMachine("DuplicateMachine", ["X", "Y"] as const)
    ).toThrow("Duplicate state machine name")
  })

  it("suppresses identity-transition events when setIfChanged keeps the same value", () => {
    const queueSame = Game.System(
      "StateMachineRuntime/QueueSameStateIfChanged",
      {
        nextMachines: {
          app: System.nextState(AppState)
        }
      },
      ({ nextMachines }) =>
        {
          nextMachines.app.setIfChanged("Menu")
        }
    )

    const readTransitionEvents = Game.System(
      "StateMachineRuntime/ReadIdentitySuppressedEvents",
      {
        transitionEvents: {
          app: Game.System.readTransitionEvent(AppState)
        },
        resources: {
          log: System.writeResource(Log)
        }
      },
      ({ transitionEvents, resources }) =>
        {
          for (const event of transitionEvents.app.all()) {
            resources.log.update((entries) => [...entries, `event:${event.from}->${event.to}`])
          }
        }
    )

    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(queueSame, Game.Schedule.applyStateTransitions(), readTransitionEvents))

    expect(readResourceValue(runtime, schema, Log)).toEqual([])
  })
})
