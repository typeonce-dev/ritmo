import { describe, expect, it } from "vitest"
import { HostClock, Result, Schema } from "@typeonce/ritmo"
import type * as Debug from "@typeonce/ritmo/Debug"

const Root = Schema.defineRoot("TransitionRequests")
const Game = Schema.bind(Schema.fragment({ resources: {} }), Root)
// Declared first, so a marker applies Early before Flow, and Flow before the others.
const Early = Game.StateMachine("TransitionRequests/Early", { A: {}, B: {}, C: {} })
const Flow = Game.StateMachine("TransitionRequests/Flow", { Menu: {}, Playing: {} })
const Music = Game.StateMachine("TransitionRequests/Music", { Loud: {}, Quiet: {}, Off: {} })
const Gate = Game.StateMachine("TransitionRequests/Gate", { Closed: {}, Open: {}, Locked: {} }, {
  transitions: { Closed: ["Open", "Locked"], Open: ["Closed"], Locked: ["Closed"] }
})
const Stage = Game.StateMachine("TransitionRequests/Stage", { Intro: {}, Fight: {} }, { within: [Flow, "Playing"] })

const makeRuntime = (options: { readonly debug?: boolean } = {}) => Game.Runtime.make({
  services: Game.Runtime.services(),
  machines: Game.Runtime.machines(
    Game.Runtime.machine(Early, { _tag: "A" }),
    Game.Runtime.machine(Flow, { _tag: "Menu" }),
    Game.Runtime.machine(Music, { _tag: "Loud" }),
    Game.Runtime.machine(Gate, { _tag: "Closed" }),
    Game.Runtime.machine(Stage, { _tag: "Intro" })
  ),
  ...(options.debug === true ? { debug: { hostClock: HostClock.test() } } : {})
}).value

const log: Array<string> = []

const Queue = Game.System("TransitionRequests/Queue", {
  nextMachines: {
    early: Game.System.nextState(Early),
    flow: Game.System.nextState(Flow),
    music: Game.System.nextState(Music),
    gate: Game.System.nextState(Gate)
  }
}, ({ nextMachines }) => {
  nextMachines.early.set({ _tag: "B" })
  nextMachines.flow.set({ _tag: "Playing" })
  nextMachines.music.set({ _tag: "Quiet" })
  nextMachines.gate.transition({ from: "Closed", to: "Open" })
})

const Read = Game.System("TransitionRequests/Read", {
  machines: {
    early: Game.System.machine(Early),
    music: Game.System.machine(Music),
    gate: Game.System.machine(Gate)
  },
  transitionEvents: { music: Game.System.readTransitionEvent(Music) }
}, ({ machines, transitionEvents }) => {
  const moves = transitionEvents.music.all().map((move) => `${move.from}->${move.to}`).join(",")
  log.push(`early=${machines.early.get()._tag} music=${machines.music.get()._tag} [${moves}] gate=${machines.gate.get()._tag}`)
})

type TestRuntime = ReturnType<typeof makeRuntime>

// Ticks `first` (a marker that applies what `Queue` requested), then a marker that applies what is left.
const run = (first: (runtime: TestRuntime) => Result.Result<void, unknown>) => {
  log.length = 0
  const runtime = makeRuntime()
  const result = first(runtime)
  runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(), Read))
  return result
}

describe("A request queued after cancelPending() in a transition schedule", () => {
  it("replaces the cancelled request at this marker", () => {
    const Silence = Game.System("TransitionRequests/Silence", { nextMachines: { music: Game.System.nextState(Music) } }, ({ nextMachines }) => {
      nextMachines.music.cancelPending()
      nextMachines.music.set({ _tag: "Off" })
    })
    run((runtime) => runtime.tick(Game.Schedule(Queue, Game.Schedule.applyStateTransitions(Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [Silence]))), Read)))
    // Off commits at the marker that was to apply Quiet; Quiet never commits.
    expect(log).toEqual(["early=B music=Off [Loud->Off] gate=Open", "early=B music=Off [] gate=Open"])
  })

  it("is the first request after the cancel: a set over it still waits for the next marker", () => {
    const Silence = Game.System("TransitionRequests/SilenceThenLoud", { nextMachines: { music: Game.System.nextState(Music) } }, ({ nextMachines }) => {
      nextMachines.music.cancelPending()
      nextMachines.music.set({ _tag: "Off" })
      nextMachines.music.set({ _tag: "Loud" })
    })
    run((runtime) => runtime.tick(Game.Schedule(Queue, Game.Schedule.applyStateTransitions(Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [Silence]))), Read)))
    expect(log).toEqual(["early=B music=Off [Loud->Off] gate=Open", "early=B music=Loud [Off->Loud] gate=Open"])
  })

  it("keeps today's rule without a cancel: the queued request applies now, the new one at the next marker", () => {
    const Lower = Game.System("TransitionRequests/Lower", { nextMachines: { music: Game.System.nextState(Music) } }, ({ nextMachines }) => {
      nextMachines.music.set({ _tag: "Off" })
    })
    run((runtime) => runtime.tick(Game.Schedule(Queue, Game.Schedule.applyStateTransitions(Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [Lower]))), Read)))
    expect(log).toEqual(["early=B music=Quiet [Loud->Quiet] gate=Open", "early=B music=Off [Quiet->Off] gate=Open"])
  })

  it("replaces it for a transition on a machine with a graph", () => {
    const Lock = Game.System("TransitionRequests/Lock", { nextMachines: { gate: Game.System.nextState(Gate) } }, ({ nextMachines }) => {
      nextMachines.gate.cancelPending()
      const locked = nextMachines.gate.transition({ from: "Closed", to: "Locked" })
      if (!locked.ok) log.push(locked.error._tag)
    })
    run((runtime) => runtime.tick(Game.Schedule(Queue, Game.Schedule.applyStateTransitions(Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [Lock]))), Read)))
    expect(log).toEqual(["early=B music=Quiet [Loud->Quiet] gate=Locked", "early=B music=Quiet [] gate=Locked"])
  })

  it("waits for the next marker when the marker already applied the machine", () => {
    const Again = Game.System("TransitionRequests/Again", { nextMachines: { early: Game.System.nextState(Early) } }, ({ nextMachines }) => {
      nextMachines.early.cancelPending()
      nextMachines.early.set({ _tag: "C" })
    })
    run((runtime) => runtime.tick(Game.Schedule(Queue, Game.Schedule.applyStateTransitions(Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [Again]))), Read)))
    expect(log).toEqual(["early=B music=Quiet [Loud->Quiet] gate=Open", "early=C music=Quiet [] gate=Open"])
  })

  it("is undone with the system that made it when that system fails", () => {
    const Undone = Game.System("TransitionRequests/Undone", { nextMachines: { music: Game.System.nextState(Music) } }, ({ nextMachines }) => {
      nextMachines.music.cancelPending()
      nextMachines.music.set({ _tag: "Off" })
      return Result.failure("NoSpeakers" as const)
    })
    const first = run((runtime) => runtime.tick(Game.Schedule(Queue, Game.Schedule.applyStateTransitions(Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [Undone]))), Read)))
    expect(first.ok).toBe(false)
    // The marker stopped at the failing onEnter: Quiet, restored, applies at the next one.
    expect(log).toEqual(["early=B music=Quiet [Loud->Quiet] gate=Open"])
  })
})

describe("A failing onEnter schedule", () => {
  const ran: Array<string> = []
  const note = (label: string) => Game.System(`TransitionRequests/${label}`, {}, () => {
    ran.push(label)
  })
  const fail = (label: string) => Game.System(`TransitionRequests/${label}`, {}, () => {
    ran.push(label)
    return Result.failure(label)
  })
  const Start = Game.System("TransitionRequests/Start", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
    nextMachines.flow.set({ _tag: "Playing" })
  })

  it("lets the other enter schedules of the state and of its sub-states run, and the tick returns the first failure", () => {
    ran.length = 0
    const transitions = Game.Schedule.transitions(
      Game.Schedule.onEnter(Flow, "Playing", [fail("LoadLevel"), note("AfterLoad")]),
      Game.Schedule.onEnter(Flow, "Playing", [note("SpawnPlayer")]),
      Game.Schedule.onEnter(Flow, "Playing", [fail("StartMusic")]),
      Game.Schedule.onEnter(Stage, "Intro", [note("ShowIntro")])
    )
    const runtime = makeRuntime({ debug: true })
    const events: Array<Debug.TraceEvent> = []
    runtime.debug.observe((event) => events.push(event))
    const result = runtime.tick(Game.Schedule(Start, Game.Schedule.applyStateTransitions(transitions)))
    // A schedule stops at its failing system; the next schedules still run.
    expect(ran).toEqual(["LoadLevel", "SpawnPlayer", "StartMusic", "ShowIntro"])
    expect(result.ok ? undefined : result.error).toMatchObject({ error: "LoadLevel" })
    const outcomes = events.flatMap((event) => event.type === "transition" ? [`${event.machine} ${event.outcome}`] : [])
    expect(outcomes).toEqual(["TransitionRequests/Flow applied", "TransitionRequests/Stage applied", "TransitionRequests/Flow enterFailed"])

    // Nothing runs again: the state stays committed.
    ran.length = 0
    runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(transitions)))
    expect(ran).toEqual([])
  })

  it("lets a sub-state's later enter schedules run when one of them fails", () => {
    ran.length = 0
    const transitions = Game.Schedule.transitions(
      Game.Schedule.onEnter(Flow, "Playing", [note("SpawnPlayer")]),
      Game.Schedule.onEnter(Stage, "Intro", [fail("ShowIntro")]),
      Game.Schedule.onEnter(Stage, "Intro", [note("PlayCue")])
    )
    const result = makeRuntime().tick(Game.Schedule(Start, Game.Schedule.applyStateTransitions(transitions)))
    expect(ran).toEqual(["SpawnPlayer", "ShowIntro", "PlayCue"])
    expect(result.ok ? undefined : result.error).toMatchObject({ error: "ShowIntro" })
  })
})
