import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"
import { worldOf } from "./saved.ts"

const Root = Schema.defineRoot("QueuedTest")
const Hp = Descriptor.ConstructedComponent(Codecs.number)("Queued/Hp")
const Game = Schema.bind(Schema.fragment({ components: { Hp } }), Root)
const Flow = Game.StateMachine("Queued/Flow", { Menu: {}, Playing: Codecs.struct({ level: Codecs.integer }), Over: {} })
const Round = Game.StateMachine("Queued/Round", { Lobby: {}, Live: {}, Done: {} }, { transitions: { Lobby: ["Live"], Live: ["Done"], Done: ["Lobby"] } })
const Turn = Game.StateMachine("Queued/Turn", { Aim: {}, Fire: {} }, { within: [Flow, "Playing"] })

const SpawnAfterMarker = Game.System("Queued/SpawnAfterMarker", {
  commands: Game.System.commands(Game.System.spawns(Hp))
}, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Hp, 3]))
})
const Play = Game.System("Queued/Play", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
  nextMachines.flow.set({ _tag: "Playing", level: 2 })
})
const PlayIfChanged = Game.System("Queued/PlayIfChanged", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
  nextMachines.flow.setIfChanged({ _tag: "Playing", level: 1 })
})
const GoLive = Game.System("Queued/GoLive", { nextMachines: { round: Game.System.nextState(Round) } }, ({ nextMachines }) => {
  nextMachines.round.transition({ from: "Lobby", to: "Live" })
})
const Fire = Game.System("Queued/Fire", { nextMachines: { turn: Game.System.nextState(Turn) } }, ({ nextMachines }) => {
  nextMachines.turn.set({ _tag: "Fire" })
})
const Noop = Game.System("Queued/Noop", {}, () => {})
const Read = Game.Inspector("Queued/Read", {
  queries: { all: Game.Query({ selection: { hp: Game.Query.read(Hp) } }) },
  machines: { flow: Game.System.machine(Flow), round: Game.System.machine(Round) }
}, ({ queries, machines }) => ({
  entities: queries.all.each().map((entity) => entity.id),
  flow: machines.flow.get(),
  round: machines.round.get()._tag
}))

// A frame that applies what was queued at the start of the next one.
const apply = Game.Schedule(Game.Schedule.applyStateTransitions(), Noop)
type FlowState = { readonly _tag: "Menu" } | { readonly _tag: "Playing"; readonly level: number } | { readonly _tag: "Over" }
const make = (flow: FlowState = { _tag: "Menu" }) => Game.Runtime.make({
  services: Game.Runtime.services(),
  machines: Game.Runtime.machines(
    Game.Runtime.machine(Flow, flow),
    Game.Runtime.machine(Round, { _tag: "Lobby" }),
    Game.Runtime.machine(Turn, { _tag: "Aim" })
  )
}).value

/** The live runtime's save, through JSON, restored into a fresh runtime. */
const loaded = (live: ReturnType<typeof make>) => {
  const runtime = make()
  expect(runtime.restore(JSON.parse(JSON.stringify(worldOf(live.snapshot()))))).toEqual({ ok: true, value: undefined })
  return runtime
}

describe("snapshot and checksum with queued work", () => {
  it("a save keeps a queued next state, and the next marker applies it", () => {
    const live = make()
    live.tick(Game.Schedule(Play))
    expect(worldOf(live.snapshot()).nextStates).toEqual({ "Queued/Flow": { state: { _tag: "Playing", level: 2 }, ifChanged: false } })
    const restored = loaded(live)
    live.tick(apply)
    restored.tick(apply)
    expect(restored.inspect(Read)).toEqual(live.inspect(Read))
    expect(restored.inspect(Read).flow).toEqual({ _tag: "Playing", level: 2 })
  })

  it("a save keeps a queued transition with the state it moves from", () => {
    const live = make()
    live.tick(Game.Schedule(GoLive))
    expect(worldOf(live.snapshot()).nextStates).toEqual({ "Queued/Round": { state: { _tag: "Live" }, ifChanged: false, from: "Lobby" } })
    const restored = loaded(live)
    live.tick(apply)
    restored.tick(apply)
    expect(restored.inspect(Read).round).toBe("Live")
    expect(restored.checksum()).toEqual(live.checksum())
  })

  it("a save keeps a setIfChanged, which still skips an unchanged value", () => {
    const live = make({ _tag: "Playing", level: 1 })
    live.tick(Game.Schedule(PlayIfChanged))
    expect(worldOf(live.snapshot()).nextStates).toEqual({ "Queued/Flow": { state: { _tag: "Playing", level: 1 }, ifChanged: true } })
    const restored = loaded(live)
    const entered: Array<string> = []
    const Entered = Game.System("Queued/Entered", {}, () => { entered.push("entered") })
    const withEnter = Game.Schedule(Game.Schedule.applyStateTransitions(Game.Schedule.transitions(Game.Schedule.onEnter(Flow, "Playing", [Entered]))))
    live.tick(withEnter)
    restored.tick(withEnter)
    expect(entered).toEqual([])
    expect(restored.checksum()).toEqual(live.checksum())
    expect(worldOf(restored.snapshot()).nextStates).toEqual({})
  })

  it("the checksum differs with a queued next state and without", () => {
    const queued = make()
    const idle = make()
    queued.tick(Game.Schedule(Play))
    idle.tick(Game.Schedule(Noop))
    expect(queued.checksum()).not.toEqual(idle.checksum())
  })

  it("a save taken while a command is queued is a typed failure", () => {
    const live = make()
    live.tick(Game.Schedule(Game.Schedule.applyStateTransitions(), SpawnAfterMarker))
    expect(live.snapshot()).toEqual({ ok: false, error: { _tag: "QueuedCommands", count: 1 } })
    expect(live.checksum()).toEqual({ ok: false, error: { _tag: "QueuedCommands", count: 1 } })
    live.tick(Game.Schedule(Game.Schedule.applyDeferred()))
    expect(live.snapshot().ok).toBe(true)
  })

  it("a save without next states loads with nothing queued", () => {
    const live = make()
    const { nextStates: _, ...older } = worldOf(live.snapshot())
    const runtime = make()
    runtime.tick(Game.Schedule(Play))
    expect(runtime.restore(JSON.parse(JSON.stringify(older))).ok).toBe(true)
    runtime.tick(apply)
    expect(runtime.inspect(Read).flow).toEqual({ _tag: "Menu" })
  })

  it("a queued sub-state value is restored while its parent is in its state, and rejected otherwise", () => {
    const live = make({ _tag: "Playing", level: 1 })
    live.tick(Game.Schedule(Fire))
    const saved = JSON.parse(JSON.stringify(worldOf(live.snapshot())))
    expect(saved.nextStates).toEqual({ "Queued/Turn": { state: { _tag: "Fire" }, ifChanged: false } })
    expect(make().restore(saved).ok).toBe(true)

    // The same queued value in a save whose parent is in Menu: no sub-state value to replace.
    const inMenu = { ...saved, machines: { ...saved.machines, "Queued/Flow": { _tag: "Menu" } } }
    delete inMenu.machines["Queued/Turn"]
    const runtime = make()
    const before = runtime.checksum()
    expect(runtime.restore(inMenu)).toEqual({
      ok: false,
      error: { _tag: "InactiveSubState", name: "Queued/Turn", parent: "Queued/Flow", requires: "Playing" }
    })
    expect(runtime.checksum()).toEqual(before)
  })

  it("rejects a queued state that is not a state, and a move the graph does not allow", () => {
    const live = make()
    const saved = worldOf(live.snapshot())
    const tags = (nextStates: unknown) => {
      const result = make().restore({ ...saved, nextStates })
      return result.ok ? "ok" : result.error._tag
    }
    expect(tags({ "Queued/Flow": { state: { _tag: "Paused" }, ifChanged: false } })).toBe("InvalidNextState")
    expect(tags({ "Queued/Flow": { state: { _tag: "Playing" }, ifChanged: false } })).toBe("InvalidNextState")
    expect(tags({ "Queued/Flow": { state: { _tag: "Over" }, ifChanged: false, from: "Nowhere" } })).toBe("InvalidNextState")
    expect(tags({ "Queued/Round": { state: { _tag: "Done" }, ifChanged: false, from: "Lobby" } })).toBe("InvalidNextState")
    expect(tags({ "Queued/Round": { state: { _tag: "Live" }, ifChanged: false } })).toBe("InvalidNextState")
    expect(tags({ "Queued/Round": { state: { _tag: "Live" }, ifChanged: false, from: "Lobby" } })).toBe("ok")
    expect(tags({ "Queued/Other": { state: { _tag: "Menu" }, ifChanged: false } })).toBe("UnknownMachine")
    expect(tags({ "Queued/Flow": { state: { _tag: "Menu" } } })).toBe("InvalidSnapshot")
    expect(tags({ "Queued/Flow": { state: { _tag: "Over" }, ifChanged: true, from: "Menu" } })).toBe("InvalidSnapshot")
    expect(tags([])).toBe("InvalidSnapshot")
  })
})
