import { describe, expect, it } from "vitest"

import { Descriptor, Result, Schema } from "@typeonce/ritmo"

describe("Runtime stabilization APIs", () => {
  it("rolls back ECS writes and commands from an expected system failure", () => {
    const Position = Descriptor.Component<{ x: number }>()("Stability/Position")
    const Count = Descriptor.Resource<number>()("Stability/Count")
    const Signal = Descriptor.Event<number>()("Stability/Signal")
    const Game = Schema.bind(Schema.fragment({
      components: { Position },
      resources: { Count },
      events: { Signal }
    }))
    const Mode = Game.StateMachine("Stability/Mode", ["Ready", "Broken"] as const)
    const Positions = Game.Query({
      selection: {
        position: Game.Query.write(Position)
      }
    })

    const spawn = Game.System("Stability/Spawn", {
      commands: Game.System.commands(Game.System.spawns(Position))
    }, ({ commands }) =>
      {
        commands.spawn(Game.Command.spawn([Position, { x: 1 }]))
      }
    )
    const fail = Game.System(
      "Stability/Fail",
      {
        queries: { positions: Positions },
        resources: { count: Game.System.writeResource(Count) },
        events: { signal: Game.System.writeEvent(Signal) },
        nextMachines: { mode: Game.System.nextState(Mode) },
        commands: Game.System.commands(Game.System.spawns(Position))
      },
      ({ queries, resources, events, nextMachines, commands }) => {
        const position = queries.positions.single()
        if (position._tag === "Success") {
          position.success.data.position.set({ x: 99 })
        }
        resources.count.set(99)
        events.signal.emit(99)
        nextMachines.mode.set("Broken")
        commands.spawn(Game.Command.spawn([Position, { x: 99 }]))
        return Result.fail("Rejected" as const)
      }
    )

    let observedPosition = -1
    let observedCount = -1
    let observedSignals: ReadonlyArray<number> = []
    let observedMode: "Ready" | "Broken" = "Broken"
    const observe = Game.System(
      "Stability/Observe",
      {
        queries: {
          positions: Game.Query({
            selection: { position: Game.Query.read(Position) }
          })
        },
        resources: { count: Game.System.readResource(Count) },
        events: { signal: Game.System.readEvent(Signal) },
        machines: { mode: Game.System.machine(Mode) }
      },
      ({ queries, resources, events, machines }) => {
        const position = queries.positions.single()
        observedPosition = position._tag === "Success" ? position.success.data.position.get().x : -1
        observedCount = resources.count.get()
        observedSignals = events.signal.all()
        observedMode = machines.mode.get()
      }
    )

    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: { Count: 1 },
      machines: Game.Runtime.machines(Game.Runtime.machine(Mode, "Ready"))
    }).success

    expect(runtime.tick(Game.Schedule(spawn, Game.Schedule.applyDeferred()))).toEqual({ _tag: "Success", success: undefined })
    expect(runtime.tick(Game.Schedule(fail))).toEqual({
      _tag: "Failure",
      failure: {
        _tag: "SystemFailure",
        system: "Stability/Fail",
        error: "Rejected"
      }
    })
    expect(runtime.tick(Game.Schedule(observe))).toEqual({ _tag: "Success", success: undefined })
    expect(observedPosition).toBe(1)
    expect(observedCount).toBe(1)
    expect(observedSignals).toEqual([])
    expect(observedMode).toBe("Ready")
  })

  it("despawns one entity scope without affecting persistent entities", () => {
    const Actor = Descriptor.Component<{ name: string }>()("Scopes/Actor")
    const Game = Schema.bind(Schema.fragment({ components: { Actor } }))
    const Level = Game.EntityScope("Scopes/Level")
    const Actors = Game.Query({
      selection: { actor: Game.Query.read(Actor) }
    })

    const spawn = Game.System("Scopes/Spawn", {
      commands: Game.System.commands(Game.System.spawns(Actor))
    }, ({ commands }) => {
      commands.spawnIn(Level, Game.Command.spawn([Actor, { name: "level" }]))
      commands.spawn(Game.Command.spawn([Actor, { name: "persistent" }]))
    })
    const clear = Game.System("Scopes/Clear", {
      commands: Game.System.commands(Game.System.despawnsScope(Level))
    }, ({ commands }) => {
      commands.despawnScope(Level)
    })
    let names: ReadonlyArray<string> = []
    const observe = Game.System(
      "Scopes/Observe",
      { queries: { actors: Actors } },
      ({ queries }) => {
        names = queries.actors.each().map(({ data }) => data.actor.get().name)
      }
    )

    const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).success
    runtime.tick(Game.Schedule(spawn, Game.Schedule.applyDeferred(), clear, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(observe))

    expect(names).toEqual(["persistent"])
  })

  it("evaluates reusable read-only inspectors without advancing the world", () => {
    const Position = Descriptor.Component<{ x: number }>()("Inspector/Position")
    const Score = Descriptor.Resource<number>()("Inspector/Score")
    const Game = Schema.bind(Schema.fragment({
      components: { Position },
      resources: { Score }
    }))

    const spawn = Game.System("Inspector/Spawn", {
      commands: Game.System.commands(Game.System.spawns(Position))
    }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Position, { x: 4 }]))
    })
    const snapshot = Game.Inspector(
      "Inspector/Snapshot",
      {
        queries: {
          positions: Game.Query({
            selection: { position: Game.Query.read(Position) }
          })
        },
        resources: { score: Game.System.readResource(Score) }
      },
      ({ queries, resources }) => ({
        positions: queries.positions.each().map(({ data }) => data.position.get().x),
        score: resources.score.get()
      })
    )

    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: { Score: 7 }
    }).success
    runtime.tick(Game.Schedule(spawn, Game.Schedule.applyDeferred()))

    expect(runtime.inspect(snapshot)).toEqual({ positions: [4], score: 7 })
    expect(runtime.inspect(snapshot)).toEqual({ positions: [4], score: 7 })
  })

  it("propagates an expected failure from a state-transition schedule", () => {
    const Game = Schema.bind(Schema.fragment({}))
    const Mode = Game.StateMachine("TransitionFailure/Mode", ["Menu", "Playing"] as const)
    const start = Game.System(
      "TransitionFailure/Start",
      { nextMachines: { mode: Game.System.nextState(Mode) } },
      ({ nextMachines }) => { nextMachines.mode.set("Playing") }
    )
    const load = Game.System(
      "TransitionFailure/Load",
      {},
      () => Result.fail("LoadFailed" as const)
    )
    const transitions = Game.Schedule.transitions(
      Game.Schedule.onEnter(Mode, "Playing", [load])
    )
    const schedule = Game.Schedule(
      start,
      Game.Schedule.applyStateTransitions(transitions)
    )

    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      machines: Game.Runtime.machines(Game.Runtime.machine(Mode, "Menu"))
    }).success

    expect(runtime.tick(schedule)).toEqual({
      _tag: "Failure",
      failure: {
        _tag: "SystemFailure",
        system: "TransitionFailure/Load",
        error: "LoadFailed"
      }
    })
  })
})
