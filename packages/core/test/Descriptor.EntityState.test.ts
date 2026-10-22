import { describe, expect, it } from "vitest"
import { Descriptor, Result, Schema } from "@typeonce/ritmo"

const Phase = Descriptor.EntityState("State/Phase", ["ready", "windup", "active"] as const, {
  transitions: { ready: ["windup"], windup: ["active", "ready"], active: ["ready"] }
})
const Mode = Descriptor.EntityState("State/Mode", [0, 1, 2] as const)

const Game = Schema.bind(Schema.fragment({ components: { Phase, Mode } }))

const Phases = Game.Query({ selection: { phase: Game.Query.write(Phase) } })
const ReadPhases = Game.Inspector("State/ReadPhases", {
  queries: { phases: Game.Query({ selection: { phase: Game.Query.read(Phase) } }) }
}, ({ queries }) => queries.phases.each().map((match) => match.data.phase.get()))

const makeRuntime = () => {
  const runtime = Game.Runtime.make({ services: Game.Runtime.services() }).success
  const Spawn = Game.System("State/Spawn", {
    commands: Game.System.commands(Game.System.spawns(Phase, Mode))
  }, ({ commands }) => {
    commands.spawn(Game.Command.spawn([Phase, "ready"], [Mode, 0]))
  })
  runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
  return runtime
}

describe("Descriptor.EntityState", () => {
  it("moves between states with a compare-and-set", () => {
    const runtime = makeRuntime()
    const results: Array<unknown> = []
    const Advance = Game.System("State/Advance", { queries: { phases: Phases } }, ({ queries }) => {
      for (const { data } of queries.phases.each()) {
        results.push(data.phase.transition("ready", "windup"))
        // Stale: the phase is no longer "ready", so nothing is written.
        results.push(data.phase.transition("ready", "windup"))
        results.push(data.phase.transition("windup", "active"))
      }
    })
    runtime.tick(Game.Schedule(Advance))
    expect(results).toEqual([
      { _tag: "Success", success: undefined },
      { _tag: "Failure", failure: { _tag: "EntityStateMismatch", component: "State/Phase", expected: "ready", actual: "windup" } },
      { _tag: "Success", success: undefined }
    ])
    expect(runtime.inspect(ReadPhases)).toEqual(["active"])
  })

  it("accepts any pair of states without a transition graph", () => {
    const runtime = makeRuntime()
    const Jump = Game.System("State/Jump", {
      queries: { modes: Game.Query({ selection: { mode: Game.Query.write(Mode) } }) }
    }, ({ queries }) => {
      for (const { data } of queries.modes.each()) {
        data.mode.transition(0, 2)
        data.mode.transition(2, 1)
      }
    })
    const ReadModes = Game.Inspector("State/ReadModes", {
      queries: { modes: Game.Query({ selection: { mode: Game.Query.read(Mode) } }) }
    }, ({ queries }) => queries.modes.each().map((match) => match.data.mode.get()))
    runtime.tick(Game.Schedule(Jump))
    expect(runtime.inspect(ReadModes)).toEqual([1])
  })

  it("is an ordinary write: change detection sees it and a failed system rolls it back", () => {
    const runtime = makeRuntime()
    const Fail = Game.System("State/Fail", { queries: { phases: Phases } }, ({ queries }) => {
      for (const { data } of queries.phases.each()) data.phase.transition("ready", "windup")
      return Result.fail("Rejected" as const)
    })
    expect(runtime.tick(Game.Schedule(Fail))._tag).toBe("Failure")
    expect(runtime.inspect(ReadPhases)).toEqual(["ready"])

    const changed: Array<number> = []
    const Advance = Game.System("State/AdvanceOnce", { queries: { phases: Phases } }, ({ queries }) => {
      for (const { data } of queries.phases.each()) data.phase.transition("ready", "windup")
    })
    const Watch = Game.System("State/Watch", {
      queries: {
        changed: Game.Query({ selection: { phase: Game.Query.read(Phase) }, filters: [Game.Query.changed(Phase)] })
      }
    }, ({ queries }) => {
      changed.push(queries.changed.each().length)
    })
    runtime.tick(Game.Schedule(Watch))
    runtime.tick(Game.Schedule(Advance, Watch))
    runtime.tick(Game.Schedule(Watch))
    expect(changed).toEqual([1, 1, 0])
  })

  it("keeps setRaw validation and rejects unknown states in snapshots", () => {
    const runtime = makeRuntime()
    const results: Array<boolean> = []
    const Raw = Game.System("State/Raw", { queries: { phases: Phases } }, ({ queries }) => {
      for (const { data } of queries.phases.each()) {
        results.push(data.phase.setRaw("active")._tag === "Success", data.phase.setRaw("sleeping" as never)._tag === "Success")
      }
    })
    runtime.tick(Game.Schedule(Raw))
    expect(results).toEqual([true, false])

    const snapshot = runtime.snapshot()
    const entity = snapshot.entities[0]!
    const restored = runtime.restore({
      ...snapshot,
      entities: [{ ...entity, components: { ...entity.components, "State/Phase": "sleeping" } }]
    })
    expect(restored._tag === "Success" ? undefined : restored.failure._tag).toBe("InvalidComponent")
    expect(runtime.restore(JSON.parse(JSON.stringify(snapshot)))._tag).toBe("Success")
    expect(runtime.inspect(ReadPhases)).toEqual(["active"])
  })
})
