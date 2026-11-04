import { describe, expect, it } from "vitest"
import { Descriptor, Result, Schema } from "@typeonce/ritmo"
import * as Codecs from "./codecs.ts"

const Name = Descriptor.ConstructedComponent(Codecs.string)("ExitPhase/Name")
const Saved = Descriptor.Resource<number>()("ExitPhase/Saved")
const Left = Descriptor.Event<string>()("ExitPhase/Left")
const Game = Schema.bind(Schema.fragment({ components: { Name }, resources: { Saved }, events: { Left } }))
const Flow = Game.StateMachine("ExitPhase/Flow", { Playing: {}, Menu: {} })
const Music = Game.StateMachine("ExitPhase/Music", { Loud: {}, Quiet: {} })

const State = Game.Inspector("ExitPhase/State", {
  queries: { named: Game.Query({ selection: { name: Game.Query.read(Name) } }) },
  resources: { saved: Game.System.readResource(Saved) },
  machines: { flow: Game.System.machine(Flow), music: Game.System.machine(Music) }
}, ({ queries, resources, machines }) => ({
  flow: machines.flow.get(),
  music: machines.music.get(),
  saved: resources.saved.get(),
  names: queries.named.each().length
}))

const makeRuntime = () => Game.Runtime.make({
  services: Game.Runtime.services(),
  resources: { Saved: 0 },
  machines: Game.Runtime.machines(Game.Runtime.machine(Flow, { _tag: "Playing" }), Game.Runtime.machine(Music, { _tag: "Loud" }))
}).value

describe("the exit phase of a transition", () => {
  it("rolls back as one when a system in it fails, so the retry starts from the same state", () => {
    let failures = 1
    const seen: Array<ReadonlyArray<string>> = []
    const SaveScore = Game.System("ExitPhase/SaveScore", {
      resources: { saved: Game.System.writeResource(Saved) },
      events: { left: Game.System.writeEvent(Left) },
      nextMachines: { music: Game.System.nextState(Music) },
      commands: Game.System.commands(Game.System.spawns(Name))
    }, ({ resources, events, nextMachines, commands }) => {
      resources.saved.update((saved) => saved + 1)
      events.left.emit("score saved")
      nextMachines.music.set({ _tag: "Quiet" })
      commands.spawn(Game.Command.spawn([Name, "ghost"]))
    })
    const ReadLeft = Game.System("ExitPhase/ReadLeft", {
      events: { left: Game.System.readEvent(Left) }
    }, ({ events }) => {
      seen.push(events.left.all())
    })
    const CloseSockets = Game.System("ExitPhase/CloseSockets", {}, () => {
      if (failures > 0) {
        failures--
        return Result.failure("socket busy")
      }
      return Result.success(undefined)
    })
    const transitions = Game.Schedule.transitions(
      Game.Schedule.onExit(Flow, "Playing", [SaveScore, ReadLeft]),
      Game.Schedule.onTransition(Flow, ["Playing", "Menu"], [CloseSockets])
    )
    const ToMenu = Game.System("ExitPhase/ToMenu", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
      nextMachines.flow.set({ _tag: "Menu" })
    })
    const runtime = makeRuntime()

    const failed = runtime.tick(Game.Schedule(ToMenu, Game.Schedule.applyStateTransitions(transitions), Game.Schedule.applyDeferred()))
    expect(failed).toEqual({ ok: false, error: { kind: "SystemFailure", system: "ExitPhase/CloseSockets", error: "socket busy" } })
    expect(runtime.inspect(State)).toEqual({ flow: { _tag: "Playing" }, music: { _tag: "Loud" }, saved: 0, names: 0 })
    expect(seen).toEqual([["score saved"]])

    // The retry: the queued transition runs the phase once more, from the same state.
    const retried = runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(transitions), Game.Schedule.applyDeferred()))
    expect(retried.ok).toBe(true)
    expect(runtime.inspect(State)).toEqual({ flow: { _tag: "Menu" }, music: { _tag: "Loud" }, saved: 1, names: 1 })
    // The rolled-back event was retracted: the reader sees the new one, once.
    expect(seen).toEqual([["score saved"], ["score saved"]])
    // The next state queued in the phase was kept by the successful attempt only.
    runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(transitions)))
    expect(runtime.inspect(State)).toEqual({ flow: { _tag: "Menu" }, music: { _tag: "Quiet" }, saved: 1, names: 1 })
  })

  it("restores the change marks of writes it rolls back", () => {
    const seen: Array<ReadonlyArray<string>> = []
    const Spawn = Game.System("ExitPhase/Spawn", { commands: Game.System.commands(Game.System.spawns(Name)) }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Name, "before"]))
    })
    const Rename = Game.System("ExitPhase/Rename", {
      queries: { named: Game.Query({ selection: { name: Game.Query.write(Name) } }) }
    }, ({ queries }) => {
      const { data } = queries.named
      for (const entity of queries.named.each()) data.name.set(entity, "during")
    })
    const Fail = Game.System("ExitPhase/Fail", {}, () => Result.failure("busy"))
    const Watch = Game.System("ExitPhase/Watch", {
      queries: { renamed: Game.Query({ selection: { name: Game.Query.read(Name) }, filters: [Game.Query.changed(Name)] }) }
    }, ({ queries }) => {
      seen.push(queries.renamed.each().map((entity) => queries.renamed.data.name.get(entity)))
    })
    const transitions = Game.Schedule.transitions(
      Game.Schedule.onExit(Flow, "Playing", [Rename]),
      Game.Schedule.onTransition(Flow, ["Playing", "Menu"], [Fail])
    )
    const ToMenu = Game.System("ExitPhase/ToMenu", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
      nextMachines.flow.set({ _tag: "Menu" })
    })
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), Watch))

    const failed = runtime.tick(Game.Schedule(ToMenu, Game.Schedule.applyStateTransitions(transitions)))
    runtime.tick(Game.Schedule(Watch))

    expect(failed.ok).toBe(false)
    // The rename was undone with its change tick: the watcher sees no change.
    expect(seen).toEqual([["before"], []])
  })

  it("cannot contain applyDeferred()", () => {
    const Noop = Game.System("ExitPhase/Noop", {}, () => {})
    // A nested schedule hides the marker from the types; the build still rejects it.
    const nested = Game.Schedule(Noop, Game.Schedule.applyDeferred())
    expect(() => Game.Schedule.onExit(Flow, "Playing", [nested])).toThrow(
      "onExit and onTransition schedules cannot contain applyDeferred()"
    )
    expect(() => Game.Schedule.onTransition(Flow, ["Playing", "Menu"], [nested])).toThrow("cannot contain applyDeferred()")
    expect(() => Game.Schedule.onEnter(Flow, "Menu", [nested])).not.toThrow()
  })
})
