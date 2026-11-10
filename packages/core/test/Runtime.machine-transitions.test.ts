import { describe, expect, it } from "vitest"
import { HostClock, Schema } from "@typeonce/ritmo"
import type * as Machine from "@typeonce/ritmo/Machine"
import type { NextMachineWriteView } from "@typeonce/ritmo/System"
import * as Codecs from "./codecs.ts"

const Game = Schema.bind(Schema.fragment({ resources: {} }))
// Declared before Round, so a marker applies its move first.
const Lights = Game.StateMachine("MachineMoves/Lights", { Off: {}, On: {} })
const Round = Game.StateMachine("MachineMoves/Round", {
  Lobby: {},
  Countdown: Codecs.struct({ until: Codecs.integer }),
  Playing: Codecs.struct({ round: Codecs.integer }),
  Over: Codecs.struct({ winner: Codecs.integer })
}, {
  transitions: { Lobby: ["Countdown"], Countdown: ["Playing", "Lobby"], Playing: ["Over", "Playing"], Over: ["Lobby"] }
})
const Phase = Game.StateMachine("MachineMoves/Phase", { Setup: {}, Battle: Codecs.struct({ wave: Codecs.integer }) }, {
  within: [Round, "Playing"],
  transitions: { Setup: ["Battle"], Battle: ["Setup"] }
})
const Free = Game.StateMachine("MachineMoves/Free", { A: {}, B: Codecs.struct({ n: Codecs.number }) })

type RoundValue = Machine.StateOf<typeof Round>

const makeRuntime = (round: RoundValue, options: { readonly debug?: boolean } = {}) => Game.Runtime.make({
  services: Game.Runtime.services(),
  machines: Game.Runtime.machines(
    Game.Runtime.machine(Lights, { _tag: "Off" }),
    Game.Runtime.machine(Round, round),
    Game.Runtime.machine(Phase, { _tag: "Setup" }),
    Game.Runtime.machine(Free, { _tag: "A" })
  ),
  ...(options.debug === true ? { debug: { hostClock: HostClock.test() } } : {})
}).value

const log: Array<string> = []
const results: Array<unknown> = []
const note = (label: string) => Game.System(`MachineMoves/${label}`, {}, () => { log.push(label) })

const onRound = (label: string, move: (round: NextMachineWriteView<typeof Round>) => unknown) =>
  Game.System(`MachineMoves/${label}`, { nextMachines: { round: Game.System.nextState(Round) } }, ({ nextMachines }) => {
    results.push(move(nextMachines.round))
  })
const onPhase = (label: string, move: (phase: NextMachineWriteView<typeof Phase>) => unknown) =>
  Game.System(`MachineMoves/${label}`, { nextMachines: { phase: Game.System.nextState(Phase) } }, ({ nextMachines }) => {
    results.push(move(nextMachines.phase))
  })

const reader = (label: string) => Game.System(`MachineMoves/${label}`, {
  machines: { round: Game.System.machine(Round), phase: Game.System.machine(Phase), free: Game.System.machine(Free) }
}, ({ machines }) => {
  log.push(`round=${JSON.stringify(machines.round.get())} phase=${JSON.stringify(machines.phase.get())} free=${JSON.stringify(machines.free.get())}`)
})
const Read = reader("Read")
const ReadBefore = reader("ReadBefore")

const transitions = Game.Schedule.transitions(
  Game.Schedule.onExit(Round, "Countdown", [note("exit Countdown")]),
  Game.Schedule.onEnter(Round, "Playing", [note("enter Playing")]),
  Game.Schedule.onExit(Round, "Playing", [note("exit Playing")]),
  Game.Schedule.onEnter(Phase, "Setup", [note("enter Setup")]),
  Game.Schedule.onEnter(Phase, "Battle", [note("enter Battle")])
)
const commit = Game.Schedule.applyStateTransitions(transitions)

const reset = () => {
  log.length = 0
  results.length = 0
}

const ok = { ok: true, value: undefined }

describe("nextMachines.x.transition", () => {
  it("queues a legal move from the committed state, committed with its schedules at the marker", () => {
    reset()
    const runtime = makeRuntime({ _tag: "Countdown", until: 3 })
    const Start = onRound("Start", (round) => {
      const result = round.transition({ from: "Countdown", to: "Playing", data: { round: 1 } })
      log.push(`pending=${JSON.stringify(round.getPending())}`)
      return result
    })
    expect(runtime.tick(Game.Schedule(Start, ReadBefore, commit, Read)).ok).toBe(true)
    expect(results).toEqual([ok])
    expect(log).toEqual([
      "pending={\"_tag\":\"Playing\",\"round\":1}",
      // Queued, not committed: later systems still see Countdown.
      "round={\"_tag\":\"Countdown\",\"until\":3} phase=undefined free={\"_tag\":\"A\"}",
      "exit Countdown",
      "enter Playing",
      "enter Setup",
      "round={\"_tag\":\"Playing\",\"round\":1} phase={\"_tag\":\"Setup\"} free={\"_tag\":\"A\"}"
    ])
  })

  it("returns MachineStateMismatch and queues nothing when the committed state is not from", () => {
    reset()
    const runtime = makeRuntime({ _tag: "Lobby" })
    // The check reads the committed state, not a value queued before it.
    const QueueCountdown = onRound("QueueCountdown", (round) => round.transition({ from: "Lobby", to: "Countdown", data: { until: 3 } }))
    const Start = onRound("StartTooEarly", (round) => {
      const result = round.transition({ from: "Countdown", to: "Playing", data: { round: 1 } })
      log.push(`pending=${JSON.stringify(round.getPending())}`)
      return result
    })
    expect(runtime.tick(Game.Schedule(QueueCountdown, Start, commit, Read)).ok).toBe(true)
    expect(results).toEqual([
      ok,
      { ok: false, error: { _tag: "MachineStateMismatch", machine: "MachineMoves/Round", expected: "Countdown", actual: "Lobby" } }
    ])
    expect(log).toEqual([
      "pending={\"_tag\":\"Countdown\",\"until\":3}",
      "round={\"_tag\":\"Countdown\",\"until\":3} phase=undefined free={\"_tag\":\"A\"}"
    ])

    // Alone, a mismatch queues nothing: the marker commits no change.
    reset()
    const StartAgain = onRound("StartFromLobby", (round) => round.transition({ from: "Over", to: "Lobby" }))
    runtime.tick(Game.Schedule(StartAgain, commit, Read))
    expect(results).toEqual([
      { ok: false, error: { _tag: "MachineStateMismatch", machine: "MachineMoves/Round", expected: "Over", actual: "Countdown" } }
    ])
    expect(log).toEqual(["round={\"_tag\":\"Countdown\",\"until\":3} phase=undefined free={\"_tag\":\"A\"}"])
  })

  it("returns SubStateInactive for a sub-state whose parent is in another state", () => {
    reset()
    const runtime = makeRuntime({ _tag: "Lobby" })
    const Fight = onPhase("FightInLobby", (phase) => phase.transition({ from: "Setup", to: "Battle", data: { wave: 1 } }))
    runtime.tick(Game.Schedule(Fight, commit, Read))
    expect(results).toEqual([
      { ok: false, error: { _tag: "SubStateInactive", machine: "MachineMoves/Phase", parent: "MachineMoves/Round", requires: "Playing" } }
    ])
    expect(log).toEqual(["round={\"_tag\":\"Lobby\"} phase=undefined free={\"_tag\":\"A\"}"])
  })

  it("moves a sub-state declared with within and transitions together", () => {
    reset()
    const runtime = makeRuntime({ _tag: "Playing", round: 1 })
    const Fight = onPhase("Fight", (phase) => phase.transition({ from: "Setup", to: "Battle", data: { wave: 1 } }))
    runtime.tick(Game.Schedule(Fight, commit, Read))
    expect(results).toEqual([ok])
    expect(log).toEqual([
      "enter Battle",
      "round={\"_tag\":\"Playing\",\"round\":1} phase={\"_tag\":\"Battle\",\"wave\":1} free={\"_tag\":\"A\"}"
    ])
  })

  it("re-enters the state on a move from a state to itself", () => {
    reset()
    const runtime = makeRuntime({ _tag: "Playing", round: 1 })
    runtime.tick(Game.Schedule(onPhase("FightFirst", (phase) => phase.transition({ from: "Setup", to: "Battle", data: { wave: 1 } })), commit))
    reset()
    const NextRound = onRound("NextRound", (round) => round.transition({ from: "Playing", to: "Playing", data: { round: 2 } }))
    runtime.tick(Game.Schedule(NextRound, commit, Read))
    expect(results).toEqual([ok])
    // Exit and enter run again, and the sub-state restarts at its entry value.
    expect(log).toEqual([
      "exit Playing",
      "enter Playing",
      "enter Setup",
      "round={\"_tag\":\"Playing\",\"round\":2} phase={\"_tag\":\"Setup\"} free={\"_tag\":\"A\"}"
    ])
  })

  it("accepts any pair of states on a machine without a graph", () => {
    reset()
    const runtime = makeRuntime({ _tag: "Lobby" })
    const Flip = Game.System("MachineMoves/Flip", {
      machines: { free: Game.System.machine(Free) },
      nextMachines: { free: Game.System.nextState(Free) }
    }, ({ machines, nextMachines }) => {
      const free = machines.free.get()
      results.push(free._tag === "A"
        ? nextMachines.free.transition({ from: "A", to: "B", data: { n: 1 } })
        : free.n < 2
        ? nextMachines.free.transition({ from: "B", to: "B", data: { n: free.n + 1 } })
        : nextMachines.free.transition({ from: "B", to: "A" }))
    })
    for (let tick = 0; tick < 3; tick++) runtime.tick(Game.Schedule(Flip, commit, Read))
    expect(results).toEqual([ok, ok, ok])
    expect(log).toEqual([
      "round={\"_tag\":\"Lobby\"} phase=undefined free={\"_tag\":\"B\",\"n\":1}",
      "round={\"_tag\":\"Lobby\"} phase=undefined free={\"_tag\":\"B\",\"n\":2}",
      "round={\"_tag\":\"Lobby\"} phase=undefined free={\"_tag\":\"A\"}"
    ])
  })

  it("commits a move made from a transition schedule at the following marker", () => {
    reset()
    const runtime = makeRuntime({ _tag: "Lobby" })
    const Begin = onRound("Begin", (round) => round.transition({ from: "Lobby", to: "Countdown", data: { until: 3 } }))
    // On entering Countdown the committed state is already Countdown.
    const Go = onRound("Go", (round) => round.transition({ from: "Countdown", to: "Playing", data: { round: 1 } }))
    const chained = Game.Schedule.applyStateTransitions(Game.Schedule.transitions(
      Game.Schedule.onEnter(Round, "Countdown", [note("enter Countdown"), Go]),
      Game.Schedule.onEnter(Round, "Playing", [note("enter Playing")])
    ))
    runtime.tick(Game.Schedule(Begin, chained, Read))
    expect(results).toEqual([ok, ok])
    expect(log).toEqual([
      "enter Countdown",
      "round={\"_tag\":\"Countdown\",\"until\":3} phase=undefined free={\"_tag\":\"A\"}"
    ])
    reset()
    runtime.tick(Game.Schedule(chained, Read))
    expect(log).toEqual([
      "enter Playing",
      "round={\"_tag\":\"Playing\",\"round\":1} phase={\"_tag\":\"Setup\"} free={\"_tag\":\"A\"}"
    ])
  })

  it("moves from whatever state the machine is in when every one of them allows the move", () => {
    reset()
    const runtime = makeRuntime({ _tag: "Playing", round: 1 })
    // Countdown and Over both list Lobby, so a `from` that is either compiles.
    const Leave = Game.System("MachineMoves/Leave", {
      machines: { round: Game.System.machine(Round) },
      nextMachines: { round: Game.System.nextState(Round) }
    }, ({ machines, nextMachines }) => {
      const round = machines.round.get()
      if (round._tag === "Countdown" || round._tag === "Over") results.push(nextMachines.round.transition({ from: round._tag, to: "Lobby" }))
      else if (round._tag === "Playing") results.push(nextMachines.round.transition({ from: "Playing", to: "Over", data: { winner: 0 } }))
    })
    runtime.tick(Game.Schedule(Leave, commit))
    runtime.tick(Game.Schedule(Leave, commit, Read))
    expect(results).toEqual([ok, ok])
    expect(log.at(-1)).toBe("round={\"_tag\":\"Lobby\"} phase=undefined free={\"_tag\":\"A\"}")
  })

  it("replaces an earlier queued value like set, and debug runtimes lint it the same way", () => {
    reset()
    const runtime = makeRuntime({ _tag: "Countdown", until: 3 }, { debug: true })
    const Cancel = onRound("Cancel", (round) => round.transition({ from: "Countdown", to: "Lobby" }))
    const Start = onRound("StartAnyway", (round) => round.transition({ from: "Countdown", to: "Playing", data: { round: 1 } }))
    runtime.tick(Game.Schedule(Cancel, Start, commit, Read))
    expect(results).toEqual([ok, ok])
    expect(log.at(-1)).toBe("round={\"_tag\":\"Playing\",\"round\":1} phase={\"_tag\":\"Setup\"} free={\"_tag\":\"A\"}")
    expect(runtime.debug.describe().lints.filter((lint) => lint.code === "next-state-replaced").map((lint) => lint.message)).toEqual([
      "MachineMoves/StartAnyway queued MachineMoves/Round=Playing {\"round\":1}, replacing Lobby queued by MachineMoves/Cancel before the same applyStateTransitions(): the last value wins"
    ])
  })

  it("drops a move queued from a transition schedule once the machine has left from", () => {
    reset()
    const runtime = makeRuntime({ _tag: "Countdown", until: 3 }, { debug: true })
    const outcomes: Array<string> = []
    runtime.debug.observe((event) => {
      if (event.type === "transition" && event.machine === "MachineMoves/Round") outcomes.push(`${event.from}->${event.to} ${event.outcome}`)
    })
    const Start = onRound("StartRound", (round) => round.transition({ from: "Countdown", to: "Playing", data: { round: 1 } }))
    // While Countdown exits it is still the committed state, so the check
    // passes; by the following marker the round is Playing, which has no
    // move to Lobby.
    const Abort = onRound("AbortOnExit", (round) => round.transition({ from: "Countdown", to: "Lobby" }))
    const leaving = Game.Schedule.applyStateTransitions(Game.Schedule.transitions(
      Game.Schedule.onExit(Round, "Countdown", [Abort])
    ))
    runtime.tick(Game.Schedule(Start, leaving))
    expect(results).toEqual([ok, ok])
    runtime.tick(Game.Schedule(leaving, Read))
    expect(log).toEqual(["round={\"_tag\":\"Playing\",\"round\":1} phase={\"_tag\":\"Setup\"} free={\"_tag\":\"A\"}"])
    expect(outcomes).toEqual(["Countdown->Playing applied", "Playing->Lobby stale"])
  })

  it("drops a move queued from another machine's schedule before this machine's own move commits", () => {
    reset()
    const runtime = makeRuntime({ _tag: "Countdown", until: 3 })
    const Both = Game.System("MachineMoves/Both", {
      nextMachines: { lights: Game.System.nextState(Lights), round: Game.System.nextState(Round) }
    }, ({ nextMachines }) => {
      nextMachines.lights.set({ _tag: "On" })
      results.push(nextMachines.round.transition({ from: "Countdown", to: "Playing", data: { round: 1 } }))
    })
    // Lights enters On before the round's move commits at the same marker.
    const Abort = onRound("AbortOnLights", (round) => round.transition({ from: "Countdown", to: "Lobby" }))
    const lit = Game.Schedule.applyStateTransitions(Game.Schedule.transitions(
      Game.Schedule.onEnter(Lights, "On", [Abort])
    ))
    runtime.tick(Game.Schedule(Both, lit))
    expect(results).toEqual([ok, ok])
    runtime.tick(Game.Schedule(lit, Read))
    expect(log).toEqual(["round={\"_tag\":\"Playing\",\"round\":1} phase={\"_tag\":\"Setup\"} free={\"_tag\":\"A\"}"])
  })
})
