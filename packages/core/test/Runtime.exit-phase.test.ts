import { describe, expect, it } from "vitest"
import { Decode, Descriptor, Result, Schema } from "@typeonce/ritmo"

const Name = Descriptor.ConstructedComponent(Decode.string)("ExitPhase/Name")
const Saved = Descriptor.Resource<number>()("ExitPhase/Saved")
const Left = Descriptor.Event<string>()("ExitPhase/Left")
const Game = Schema.bind(Schema.fragment({ components: { Name }, resources: { Saved }, events: { Left } }))
const Flow = Game.StateMachine("ExitPhase/Flow", ["Playing", "Menu"] as const)
const Music = Game.StateMachine("ExitPhase/Music", ["Loud", "Quiet"] as const)

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
  machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Playing"), Game.Runtime.machine(Music, "Loud"))
}).success

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
      nextMachines.music.set("Quiet")
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
        return Result.fail("socket busy")
      }
      return Result.succeed(undefined)
    })
    const transitions = Game.Schedule.transitions(
      Game.Schedule.onExit(Flow, "Playing", [SaveScore, ReadLeft]),
      Game.Schedule.onTransition(Flow, ["Playing", "Menu"], [CloseSockets])
    )
    const ToMenu = Game.System("ExitPhase/ToMenu", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
      nextMachines.flow.set("Menu")
    })
    const runtime = makeRuntime()

    const failed = runtime.tick(Game.Schedule(ToMenu, Game.Schedule.applyStateTransitions(transitions), Game.Schedule.applyDeferred()))
    expect(failed).toEqual({ _tag: "Failure", failure: { _tag: "SystemFailure", system: "ExitPhase/CloseSockets", error: "socket busy" } })
    expect(runtime.inspect(State)).toEqual({ flow: "Playing", music: "Loud", saved: 0, names: 0 })
    expect(seen).toEqual([["score saved"]])

    // The retry: the queued transition runs the phase once more, from the same state.
    const retried = runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(transitions), Game.Schedule.applyDeferred()))
    expect(retried._tag).toBe("Success")
    expect(runtime.inspect(State)).toEqual({ flow: "Menu", music: "Loud", saved: 1, names: 1 })
    // The rolled-back event was retracted: the reader sees the new one, once.
    expect(seen).toEqual([["score saved"], ["score saved"]])
    // The next state queued in the phase was kept by the successful attempt only.
    runtime.tick(Game.Schedule(Game.Schedule.applyStateTransitions(transitions)))
    expect(runtime.inspect(State)).toEqual({ flow: "Menu", music: "Quiet", saved: 1, names: 1 })
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
