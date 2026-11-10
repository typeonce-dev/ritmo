import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Codecs from "../test/codecs.ts"
import type * as Machine from "@typeonce/ritmo/Machine"
import type * as Result from "@typeonce/ritmo/Result"
import type * as SchemaTypes from "@typeonce/ritmo/Schema"
import { describe, expect, it } from "tstyche"

const Position = Descriptor.Component<{ x: number; y: number }>()("MachineMoves/Position")
const Game = Schema.bind(Schema.fragment({ components: { Position } }))
const OtherGame = Schema.bind(Schema.fragment({ resources: {} }))

const Round = Game.StateMachine("MachineMoves/Round", {
  Lobby: {},
  Countdown: Codecs.struct({ until: Codecs.integer }),
  Playing: Codecs.struct({ round: Codecs.integer }),
  Over: Codecs.struct({ winner: Codecs.integer })
}, {
  transitions: { Lobby: ["Countdown"], Countdown: ["Playing", "Lobby"], Playing: ["Over"], Over: ["Lobby", "Over"] }
})
const Free = Game.StateMachine("MachineMoves/Free", { A: {}, B: Codecs.struct({ n: Codecs.number }) })
const Phase = Game.StateMachine("MachineMoves/Phase", { Setup: {}, Battle: Codecs.struct({ wave: Codecs.integer }) }, {
  within: [Round, "Playing"],
  transitions: { Setup: ["Battle"], Battle: [] }
})
const OtherFlow = OtherGame.StateMachine("MachineMoves/OtherFlow", { Idle: {} })

type RoundState = "Lobby" | "Countdown" | "Playing" | "Over"

describe("Game.StateMachine transitions", () => {
  it("carries the graph in the machine's type; without one, every move", () => {
    expect(Round).type.toBe<SchemaTypes.Schema.BoundStateMachine<typeof Game.schema, "MachineMoves/Round", typeof Round.states, unknown, {
      readonly Lobby: readonly ["Countdown"]
      readonly Countdown: readonly ["Playing", "Lobby"]
      readonly Playing: readonly ["Over"]
      readonly Over: readonly ["Lobby", "Over"]
    }>>()
    expect(Round.transitions).type.toBe<{
      readonly Lobby: readonly ["Countdown"]
      readonly Countdown: readonly ["Playing", "Lobby"]
      readonly Playing: readonly ["Over"]
      readonly Over: readonly ["Lobby", "Over"]
    } | undefined>()
    expect(Free).type.toBe<SchemaTypes.Schema.BoundStateMachine<typeof Game.schema, "MachineMoves/Free", typeof Free.states>>()
    expect<Machine.StateMachine.Transitions<typeof Free>>().type.toBe<{ readonly A: ReadonlyArray<"A" | "B">; readonly B: ReadonlyArray<"A" | "B"> }>()
    expect(Phase).type.toBe<SchemaTypes.Schema.BoundStateMachine<
      typeof Game.schema,
      "MachineMoves/Phase",
      typeof Phase.states,
      typeof Round,
      { readonly Setup: readonly ["Battle"]; readonly Battle: readonly [] }
    >>()
  })

  it("still fits every machine bound, schedule, and condition", () => {
    expect<typeof Round>().type.toBeAssignableTo<Machine.StateMachine.Any>()
    expect<typeof Phase>().type.toBeAssignableTo<Machine.StateMachine.Any>()
    expect<typeof Round>().type.toBeAssignableTo<SchemaTypes.Schema.BoundStateMachine<typeof Game.schema>>()
    expect(Game.Schedule.onEnter(Round, "Playing", [])).type.toBeAssignableTo<Machine.StateMachine.AnyTransitionSchedule<typeof Game.schema, typeof Game.schema>>()
    expect(Game.Condition.inState(Round, "Over")).type.toBe<Machine.InStateCondition<typeof Round>>()
    Game.Runtime.machine(Round, { _tag: "Lobby" })
  })

  it("moves with transition({ from, to, data }): to's fields, checked against the graph", () => {
    Game.System("MachineMoves/Move", {
      nextMachines: { round: Game.System.nextState(Round), free: Game.System.nextState(Free) }
    }, ({ nextMachines }) => {
      expect(nextMachines.round.transition({ from: "Countdown", to: "Playing", data: { round: 1 } })).type.toBe<
        Result.Result<void, Machine.MachineStateMismatch<RoundState>>
      >()
      expect(nextMachines.round.transition({ from: "Over", to: "Lobby" })).type.not.toRaiseError()
      // A move the graph lists from a state to itself re-enters it.
      expect(nextMachines.round.transition({ from: "Over", to: "Over", data: { winner: 1 } })).type.not.toRaiseError()
      // Not an allowed move.
      // @ts-expect-error Type '"Lobby"' is not assignable to type '"Over"'.
      nextMachines.round.transition({ from: "Playing", to: "Lobby" })
      expect(nextMachines.round.transition).type.not.toBeCallableWith({ from: "Lobby", to: "Over", data: { winner: 0 } })
      // Unknown states.
      expect(nextMachines.round.transition).type.not.toBeCallableWith({ from: "Paused", to: "Lobby" })
      // @ts-expect-error Type '"Paused"' is not assignable to type '"Countdown"'.
      nextMachines.round.transition({ from: "Lobby", to: "Paused" })
      // The target's fields are required, exactly.
      // @ts-expect-error Property 'data' is missing in type
      nextMachines.round.transition({ from: "Countdown", to: "Playing" })
      // @ts-expect-error Property 'round' is missing in type '{}' but required in type
      nextMachines.round.transition({ from: "Countdown", to: "Playing", data: {} })
      // @ts-expect-error Object literal may only specify known properties, and 'until' does not exist in type
      nextMachines.round.transition({ from: "Countdown", to: "Playing", data: { round: 1, until: 3 } })
      // A state without fields takes no data.
      // @ts-expect-error Type '{ until: number; }' is not assignable to type 'never'.
      nextMachines.round.transition({ from: "Countdown", to: "Lobby", data: { until: 3 } })
      // Without a graph any pair of states is accepted, unknown states are not.
      expect(nextMachines.free.transition({ from: "A", to: "B", data: { n: 1 } })).type.toBe<
        Result.Result<void, Machine.MachineStateMismatch<"A" | "B">>
      >()
      expect(nextMachines.free.transition({ from: "B", to: "B", data: { n: 2 } })).type.not.toRaiseError()
      expect(nextMachines.free.transition({ from: "B", to: "A" })).type.not.toRaiseError()
      // @ts-expect-error Type '"C"' is not assignable to type '"A" | "B"'.
      nextMachines.free.transition({ from: "A", to: "C" })
    })
  })

  it("moves from a union of states only where every one of them allows the move", () => {
    Game.System("MachineMoves/FromAny", {
      machines: { round: Game.System.machine(Round) },
      nextMachines: { round: Game.System.nextState(Round) }
    }, ({ machines, nextMachines }) => {
      const round = machines.round.get()
      // Countdown and Over both list Lobby.
      if (round._tag === "Countdown" || round._tag === "Over") {
        expect(nextMachines.round.transition({ from: round._tag, to: "Lobby" })).type.toBe<
          Result.Result<void, Machine.MachineStateMismatch<RoundState>>
        >()
        // Only Countdown lists Playing.
        expect(nextMachines.round.transition).type.not.toBeCallableWith({ from: round._tag, to: "Playing", data: { round: 1 } })
      }
      // No state is a move from every state.
      expect(nextMachines.round.transition).type.not.toBeCallableWith({ from: round._tag, to: "Lobby" })
    })
  })

  it("has set and setIfChanged only on a machine declared without a graph", () => {
    expect<Machine.DeclaresTransitions<typeof Round>>().type.toBe<true>()
    expect<Machine.DeclaresTransitions<typeof Phase>>().type.toBe<true>()
    expect<Machine.DeclaresTransitions<typeof Free>>().type.toBe<false>()
    Game.System("MachineMoves/Unchecked", {
      nextMachines: { round: Game.System.nextState(Round), phase: Game.System.nextState(Phase), free: Game.System.nextState(Free) }
    }, ({ nextMachines }) => {
      // Without a graph, the unchecked writes stay.
      expect(nextMachines.free.set({ _tag: "B", n: 1 })).type.toBe<void>()
      expect(nextMachines.free.setIfChanged({ _tag: "A" })).type.toBe<void>()
      // With one, no write gets around it.
      // @ts-expect-error this machine declares `transitions`: move it with nextMachines.x.transition({ from, to, data }), which checks the graph and the current state
      nextMachines.round.set({ _tag: "Over", winner: 0 })
      // @ts-expect-error this machine declares `transitions`: move it with nextMachines.x.transition({ from, to, data }), which checks the graph and the current state
      nextMachines.round.setIfChanged({ _tag: "Lobby" })
      // @ts-expect-error this machine declares `transitions`: move it with nextMachines.x.transition({ from, to, data }), which checks the graph and the current state
      nextMachines.phase.set({ _tag: "Battle", wave: 1 })
      // Reading and cancelling what is queued stay.
      expect(nextMachines.round.getPending()).type.not.toRaiseError()
      expect(nextMachines.round.reset()).type.toBe<void>()
    })
  })

  it("fails a sub-state's move while its parent is elsewhere", () => {
    Game.System("MachineMoves/SubMove", { nextMachines: { phase: Game.System.nextState(Phase) } }, ({ nextMachines }) => {
      expect(nextMachines.phase.transition({ from: "Setup", to: "Battle", data: { wave: 1 } })).type.toBe<
        Result.Result<void, Machine.MachineStateMismatch<"Setup" | "Battle"> | Machine.SubStateInactive>
      >()
      // Battle has no way out.
      expect(nextMachines.phase.transition).type.not.toBeCallableWith({ from: "Battle", to: "Setup" })
    })
  })

  it("requires a graph listing exactly the states", () => {
    // Every state is listed.
    expect(Game.StateMachine("MachineMoves/Terminal", { A: {}, B: {} }, { transitions: { A: ["B"], B: [] } })).type.not.toRaiseError()
    // @ts-expect-error Property 'B' is missing in type '{ A: "B"[]; }' but required in type 'StateTransitions<{ readonly A: {}; readonly B: {}; }>'.
    Game.StateMachine("MachineMoves/Missing", { A: {}, B: {} }, { transitions: { A: ["B"] } })
    // Unknown target.
    // @ts-expect-error Type '"C"' is not assignable to type '"A" | "B"'.
    Game.StateMachine("MachineMoves/Target", { A: {}, B: {} }, { transitions: { A: ["C"], B: [] } })
    // Unknown key.
    // @ts-expect-error this key is not a state: `transitions` lists the moves of the declared states only
    Game.StateMachine("MachineMoves/Source", { A: {}, B: {} }, { transitions: { A: ["B"], B: [], C: ["A"] } })
    // The same rules next to `within`.
    expect(Game.StateMachine("MachineMoves/SubTerminal", { A: {}, B: {} }, { within: [Round, "Over"], transitions: { A: ["B"], B: [] } })).type.not.toRaiseError()
    // @ts-expect-error Property 'B' is missing in type '{ A: "B"[]; }' but required in type 'StateTransitions<{ readonly A: {}; readonly B: {}; }>'.
    Game.StateMachine("MachineMoves/SubMissing", { A: {}, B: {} }, { within: [Round, "Over"], transitions: { A: ["B"] } })
    // A parent from another game is still rejected, naming the fix.
    // @ts-expect-error MachineMoves/OtherFlow is a state machine of another game: use a machine defined with this game's Game.StateMachine(...)
    Game.StateMachine("MachineMoves/Foreign", { A: {}, B: {} }, { within: [OtherFlow, "Idle"], transitions: { A: ["B"], B: [] } })
  })
})
