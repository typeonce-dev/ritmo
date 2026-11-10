import { describe, expect, it } from "vitest"
import { Debug, Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"
import { worldOf } from "./saved.ts"

const Log = Descriptor.TransientResource<ReadonlyArray<string>>()("MachineData/Log")
const Root = Schema.defineRoot("MachineData")
const Game = Schema.bind(Schema.fragment({ resources: { Log } }), Root)

const Mode = Game.StateMachine("MachineData/Mode", {
  Exploring: {},
  Talking: Codecs.struct({ speaker: Codecs.string, page: Codecs.integer, typed: Codecs.integer })
})
const Session = Game.StateMachine("MachineData/Session", { Menu: {}, Playing: {} })
const Turn = Game.StateMachine("MachineData/Turn", { Mine: Codecs.struct({ moves: Codecs.integer }) }, { within: [Session, "Playing"] })

const makeRuntime = (debug = false) => Game.Runtime.make({
  services: Game.Runtime.services(),
  resources: { Log: [] },
  machines: Game.Runtime.machines(
    Game.Runtime.machine(Mode, { _tag: "Exploring" }),
    Game.Runtime.machine(Session, { _tag: "Menu" }),
    Game.Runtime.machine(Turn, { _tag: "Mine", moves: 3 })
  ),
  ...(debug ? { debug: { hostClock: HostClock.test() } } : {})
}).value

const ReadMode = Game.Inspector("MachineData/ReadMode", { machines: { mode: Game.System.machine(Mode) } }, ({ machines }) => machines.mode.get())
const ReadLog = Game.Inspector("MachineData/ReadLog", { resources: { log: Game.System.readResource(Log) } }, ({ resources }) => resources.log.get())

const logs = (name: string, line: () => string) =>
  Game.System(`MachineData/${name}`, { resources: { log: Game.System.writeResource(Log) } }, ({ resources }) => {
    resources.log.update((log) => [...log, line()])
  })

const StartTalk = Game.System("MachineData/StartTalk", { nextMachines: { mode: Game.System.nextState(Mode) } }, ({ nextMachines }) => {
  nextMachines.mode.set({ _tag: "Talking", speaker: "Mira", page: 0, typed: 0 })
})
const typeAs = (name: string) => Game.System(`MachineData/${name}`, { machines: { mode: Game.System.updateMachine(Mode) } }, ({ machines }) => {
  machines.mode.update({ state: "Talking", data: (talking) => ({ ...talking, typed: talking.typed + 1 }) })
})
const Type = typeAs("Type")
const describeAs = (name: string) => Game.System(`MachineData/${name}`, {
  machines: { mode: Game.System.machine(Mode) },
  resources: { log: Game.System.writeResource(Log) }
}, ({ machines, resources }) => {
  const mode = machines.mode.get()
  resources.log.update((log) => [...log, mode._tag === "Talking" ? `${mode.speaker}:${mode.page}:${mode.typed}` : mode._tag])
})
const Describe = describeAs("Describe")

describe("per-state machine data", () => {
  it("commits the state and its data together at the marker", () => {
    const runtime = makeRuntime()
    const enter = Game.Schedule.transitions(Game.Schedule.onEnter(Mode, "Talking", [describeAs("OnEnter")]))
    runtime.tick(Game.Schedule(StartTalk, Describe, Game.Schedule.applyStateTransitions(enter), describeAs("After")))

    expect(runtime.inspect(ReadLog)).toEqual(["Exploring", "Mira:0:0", "Mira:0:0"])
    expect(runtime.inspect(ReadMode)).toEqual({ _tag: "Talking", speaker: "Mira", page: 0, typed: 0 })
  })

  it("carries nothing over: a move takes the target's value as given", () => {
    const runtime = makeRuntime()
    const Back = Game.System("MachineData/Back", { nextMachines: { mode: Game.System.nextState(Mode) } }, ({ nextMachines }) => {
      nextMachines.mode.set({ _tag: "Exploring" })
    })
    runtime.tick(Game.Schedule(StartTalk, Game.Schedule.applyStateTransitions(), Type, Back, Game.Schedule.applyStateTransitions()))
    expect(runtime.inspect(ReadMode)).toEqual({ _tag: "Exploring" })
  })

  it("shows an update to later systems at once, while a queued move waits for the marker", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(StartTalk, Game.Schedule.applyStateTransitions()))
    const Leave = Game.System("MachineData/Leave", { nextMachines: { mode: Game.System.nextState(Mode) } }, ({ nextMachines }) => {
      nextMachines.mode.set({ _tag: "Exploring" })
    })
    runtime.tick(Game.Schedule(
      Type, Describe, Leave, describeAs("AfterLeave"), typeAs("TypeAgain"), describeAs("AfterTyping"),
      Game.Schedule.applyStateTransitions(), describeAs("AfterCommit")
    ))

    expect(runtime.inspect(ReadLog)).toEqual(["Mira:0:1", "Mira:0:1", "Mira:0:2", "Exploring"])
  })

  it("fails an update in another state without writing, and fires no transition", () => {
    const runtime = makeRuntime()
    const results: Array<unknown> = []
    const TryType = Game.System("MachineData/TryType", { machines: { mode: Game.System.updateMachine(Mode) } }, ({ machines }) => {
      results.push(machines.mode.update({ state: "Talking", data: (talking) => ({ ...talking, typed: 9 }) }))
    })
    runtime.tick(Game.Schedule(TryType))
    expect(results).toEqual([{ ok: false, error: { _tag: "MachineStateMismatch", machine: "MachineData/Mode", expected: "Talking", actual: "Exploring" } }])
    expect(runtime.inspect(ReadMode)).toEqual({ _tag: "Exploring" })

    runtime.tick(Game.Schedule(StartTalk, Game.Schedule.applyStateTransitions()))
    const lifecycle = Game.Schedule.transitions(
      Game.Schedule.onEnter(Mode, "Talking", [logs("Enter", () => "enter")]),
      Game.Schedule.onExit(Mode, "Talking", [logs("Exit", () => "exit")])
    )
    const Changed = Game.Schedule.when([Game.Condition.stateChanged(Mode)], logs("Changed", () => "changed"))
    const Events = Game.System("MachineData/Events", {
      transitionEvents: { mode: Game.System.readTransitionEvent(Mode) },
      resources: { log: Game.System.writeResource(Log) }
    }, ({ transitionEvents, resources }) => {
      for (const event of transitionEvents.mode.all()) resources.log.update((log) => [...log, `${event.from}->${event.to}`])
    })
    runtime.tick(Game.Schedule(Events))
    runtime.tick(Game.Schedule(Type, Game.Schedule.applyStateTransitions(lifecycle), Changed, Events))
    expect(runtime.inspect(ReadLog)).toEqual(["Exploring->Talking"])
    expect(runtime.inspect(ReadMode)).toEqual({ _tag: "Talking", speaker: "Mira", page: 0, typed: 1 })
  })

  it("fails an update of a sub-state without a value", () => {
    const runtime = makeRuntime()
    const results: Array<unknown> = []
    const move = (name: string) => Game.System(`MachineData/${name}`, { machines: { turn: Game.System.updateMachine(Turn) } }, ({ machines }) => {
      results.push(machines.turn.update({ state: "Mine", data: (mine) => ({ moves: mine.moves - 1 }) }))
    })
    const Play = Game.System("MachineData/Play", { nextMachines: { session: Game.System.nextState(Session) } }, ({ nextMachines }) => {
      nextMachines.session.set({ _tag: "Playing" })
    })
    const ReadTurn = Game.Inspector("MachineData/ReadTurn", { machines: { turn: Game.System.machine(Turn) } }, ({ machines }) => machines.turn.get())
    runtime.tick(Game.Schedule(move("MoveInMenu"), Play, Game.Schedule.applyStateTransitions(), move("MovePlaying")))
    expect(results).toEqual([
      { ok: false, error: { _tag: "SubStateInactive", machine: "MachineData/Turn", parent: "MachineData/Session", requires: "Playing" } },
      { ok: true, value: undefined }
    ])
    expect(runtime.inspect(ReadTurn)).toEqual({ _tag: "Mine", moves: 2 })
  })

  it("rolls an update back with the system that failed", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(StartTalk, Game.Schedule.applyStateTransitions()))
    const TypeThenFail = Game.System("MachineData/TypeThenFail", { machines: { mode: Game.System.updateMachine(Mode) } }, ({ machines }) => {
      machines.mode.update({ state: "Talking", data: (talking) => ({ ...talking, typed: 5 }) })
      return Result.failure("interrupted")
    })
    expect(runtime.tryTick(Game.Schedule(Type, TypeThenFail)).ok).toBe(false)
    expect(runtime.inspect(ReadMode)).toEqual({ _tag: "Talking", speaker: "Mira", page: 0, typed: 1 })
  })

  it("rolls an update back with a failed exit phase, keeping the move queued", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(StartTalk, Game.Schedule.applyStateTransitions()))
    let fail = true
    const ExitFails = Game.System("MachineData/ExitFails", { machines: { mode: Game.System.updateMachine(Mode) } }, ({ machines }) => {
      machines.mode.update({ state: "Talking", data: (talking) => ({ ...talking, page: 7 }) })
      return fail ? Result.failure("busy") : Result.success(undefined)
    })
    const ExitPage = Game.System("MachineData/ExitPage", { machines: { mode: Game.System.updateMachine(Mode) } }, ({ machines }) => {
      machines.mode.update({ state: "Talking", data: (talking) => ({ ...talking, page: 1 }) })
    })
    const exit = Game.Schedule.transitions(Game.Schedule.onExit(Mode, "Talking", [ExitPage, ExitFails]))
    const Leave = Game.System("MachineData/LeaveTalk", { nextMachines: { mode: Game.System.nextState(Mode) } }, ({ nextMachines }) => {
      nextMachines.mode.set({ _tag: "Exploring" })
    })
    expect(runtime.tryTick(Game.Schedule(Leave, Game.Schedule.applyStateTransitions(exit))).ok).toBe(false)
    expect(runtime.inspect(ReadMode)).toEqual({ _tag: "Talking", speaker: "Mira", page: 0, typed: 0 })
    fail = false
    runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(exit)))
    expect(runtime.inspect(ReadMode)).toEqual({ _tag: "Exploring" })
  })

  it("skips setIfChanged only for an equal value; other fields of the same state re-enter", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(StartTalk, Game.Schedule.applyStateTransitions()))
    const enter = Game.Schedule.transitions(Game.Schedule.onEnter(Mode, "Talking", [logs("Entered", () => "entered")]))
    const SetTalk = (page: number) => Game.System(`MachineData/SetTalk${page}`, { nextMachines: { mode: Game.System.nextState(Mode) } }, ({ nextMachines }) => {
      nextMachines.mode.setIfChanged({ _tag: "Talking", speaker: "Mira", page, typed: 0 })
    })
    runtime.tick(Game.Schedule(SetTalk(0), Game.Schedule.applyStateTransitions(enter)))
    expect(runtime.inspect(ReadLog)).toEqual([])
    runtime.tick(Game.Schedule(SetTalk(1), Game.Schedule.applyStateTransitions(enter)))
    expect(runtime.inspect(ReadLog)).toEqual(["entered"])
    expect(runtime.inspect(ReadMode)).toEqual({ _tag: "Talking", speaker: "Mira", page: 1, typed: 0 })
  })

  it("shares one frozen value for each state without fields", () => {
    const runtime = makeRuntime()
    const first = runtime.inspect(ReadMode)
    const Back = Game.System("MachineData/BackAgain", { nextMachines: { mode: Game.System.nextState(Mode) } }, ({ nextMachines }) => {
      nextMachines.mode.set({ _tag: "Exploring" })
    })
    runtime.tick(Game.Schedule(StartTalk, Game.Schedule.applyStateTransitions(), Back, Game.Schedule.applyStateTransitions()))
    expect(runtime.inspect(ReadMode)).toBe(first)
    expect(Object.isFrozen(first)).toBe(true)
  })

  it("saves the state with its fields and restores it, rejecting bad data by path", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(StartTalk, Game.Schedule.applyStateTransitions(), Type))
    const saved = worldOf(runtime.snapshot())
    expect(saved.machines["MachineData/Mode"]).toEqual({ _tag: "Talking", speaker: "Mira", page: 0, typed: 1 })

    const restored = makeRuntime()
    expect(restored.restore(JSON.parse(JSON.stringify(saved)) as unknown)).toEqual({ ok: true, value: undefined })
    expect(restored.inspect(ReadMode)).toEqual({ _tag: "Talking", speaker: "Mira", page: 0, typed: 1 })

    const reject = (value: unknown) => {
      const result = restored.restore({ ...saved, machines: { ...saved.machines, "MachineData/Mode": value } })
      return result.ok ? undefined : result.error
    }
    expect(reject("Talking")).toMatchObject({ _tag: "InvalidMachineState", name: "MachineData/Mode", error: { _tag: "SchemaIssues", issues: [{ path: [] }] } })
    expect(reject({ _tag: "Asleep" })).toMatchObject({ _tag: "InvalidMachineState", error: { _tag: "SchemaIssues", issues: [{ path: ["_tag"] }] } })
    expect(reject({ _tag: "Talking", speaker: "Mira", page: 0.5, typed: 0 })).toMatchObject({ _tag: "InvalidMachineState", error: { _tag: "SchemaIssues", issues: [{ path: ["page"] }] } })
    expect(reject({ _tag: "Talking", speaker: "Mira", page: 0 })).toMatchObject({ _tag: "InvalidMachineState", error: { _tag: "SchemaIssues", issues: [{ path: ["typed"] }] } })
    expect(restored.inspect(ReadMode)).toEqual({ _tag: "Talking", speaker: "Mira", page: 0, typed: 1 })
  })

  it("traces an update as a machine write", () => {
    const runtime = makeRuntime(true)
    runtime.tick(Game.Schedule(StartTalk, Game.Schedule.applyStateTransitions()))
    runtime.debug.nameSchedules({ update: Game.Schedule(Type) })
    const events: Array<Debug.TraceEvent> = []
    const stop = runtime.debug.observe((event) => events.push(event))
    runtime.tick(Game.Schedule(Type))
    stop()
    const system = events.find((event): event is Debug.SystemEvent => event.type === "system")!
    expect(system.machines).toEqual([{
      machine: "MachineData/Mode",
      before: { _tag: "Talking", speaker: "Mira", page: 0, typed: 0 },
      after: { _tag: "Talking", speaker: "Mira", page: 0, typed: 1 }
    }])
    expect(runtime.debug.describe().systems.find((described) => described.name === "MachineData/Type")?.machines.updates).toEqual(["MachineData/Mode"])
  })
})
