import { describe, expect, it } from "vitest"
import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"

const Log = Descriptor.Resource<ReadonlyArray<string>>()("ScheduleWhen/Log")
const Ping = Descriptor.Event<number>()("ScheduleWhen/Ping")
const Marker = Descriptor.Tag("ScheduleWhen/Marker")

const Game = Schema.bind(Schema.fragment({ components: { Marker }, resources: { Log }, events: { Ping } }))
const Mode = Game.StateMachine("ScheduleWhen/Mode", ["Playing", "Paused"] as const)
const Round = Game.StateMachine("ScheduleWhen/Round", ["Live", "Over"] as const)

const makeRuntime = (mode: "Playing" | "Paused" = "Playing", round: "Live" | "Over" = "Live") =>
  Game.Runtime.make({
    services: Runtime.services(),
    resources: { Log: [] },
    machines: Runtime.machines(Runtime.machine(Mode, mode), Runtime.machine(Round, round))
  }).success

const ReadLog = Game.Inspector("ScheduleWhen/ReadLog", { resources: { log: Game.System.readResource(Log) } }, ({ resources }) => resources.log.get())

/** A system that appends its name to the log. */
const logs = (name: string) =>
  Game.System(`ScheduleWhen/${name}`, { resources: { log: Game.System.writeResource(Log) } }, ({ resources }) => {
    resources.log.update((log) => [...log, name])
  })

describe("Schedule.when", () => {
  it("gates every system in the group, nested schedules included", () => {
    const a = logs("a")
    const b = logs("b")
    const outside = logs("outside")
    const gated = Game.Schedule.when([Game.Condition.inState(Mode, "Playing")], a, Game.Schedule(b))
    const schedule = Game.Schedule(gated, outside)

    const playing = makeRuntime("Playing")
    playing.tick(schedule)
    expect(playing.inspect(ReadLog)).toEqual(["a", "b", "outside"])

    const paused = makeRuntime("Paused")
    paused.tick(schedule)
    expect(paused.inspect(ReadLog)).toEqual(["outside"])
  })

  it("combines with a system's own conditions and with nested groups", () => {
    const own = Game.System("ScheduleWhen/own", {
      resources: { log: Game.System.writeResource(Log) },
      when: [Game.Condition.inState(Round, "Live")]
    }, ({ resources }) => {
      resources.log.update((log) => [...log, "own"])
    })
    const schedule = Game.Schedule.when([Game.Condition.inState(Mode, "Playing")], own)
    const nested = Game.Schedule.when([Game.Condition.inState(Round, "Live")], Game.Schedule.when([Game.Condition.inState(Mode, "Playing")], logs("nested")))

    for (const [mode, round, expected] of [
      ["Playing", "Live", ["own", "nested"]],
      ["Playing", "Over", []],
      ["Paused", "Live", []]
    ] as const) {
      const runtime = makeRuntime(mode, round)
      runtime.tick(schedule)
      runtime.tick(nested)
      expect(runtime.inspect(ReadLog)).toEqual(expected)
    }
  })

  it("still runs marker steps in the group", () => {
    const Spawn = Game.System("ScheduleWhen/Queue", {
      commands: Game.System.commands(Game.System.spawns(Marker))
    }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Marker, {}]))
    })
    const runtime = makeRuntime("Playing")
    runtime.tick(Game.Schedule(Spawn))
    // The queued spawn is applied by the marker inside a group whose condition fails.
    const paused = Game.Schedule.when([Game.Condition.inState(Mode, "Paused")], Game.Schedule.applyDeferred())
    runtime.tick(paused)
    const Count = Game.Inspector("ScheduleWhen/Count", { queries: { all: Game.Query({ selection: {} }) } }, ({ queries }) => queries.all.each().length)
    expect(runtime.inspect(Count)).toBe(1)
  })

  it("shares reader state between a system and its gated copy", () => {
    const seen: Array<ReadonlyArray<number>> = []
    const Emit = Game.System("ScheduleWhen/Emit", { events: { ping: Game.System.writeEvent(Ping) } }, ({ events }) => {
      events.ping.emit(1)
    })
    const Read = Game.System("ScheduleWhen/Read", { events: { ping: Game.System.readEvent(Ping) } }, ({ events }) => {
      seen.push(events.ping.all())
    })
    const runtime = makeRuntime("Playing")
    runtime.tick(Game.Schedule(Emit, Read))
    runtime.tick(Game.Schedule(Emit, Game.Schedule.when([Game.Condition.inState(Mode, "Playing")], Read)))
    runtime.tick(Game.Schedule(Read))
    // One reader: each event is seen exactly once, whichever copy runs.
    expect(seen).toEqual([[1], [1], []])
  })

  it("rejects the same system twice in one schedule, gated or not", () => {
    const a = logs("a")
    expect(() => Game.Schedule(a, Game.Schedule.when([Game.Condition.inState(Mode, "Playing")], a))).toThrow(/Duplicate system step/)
  })

  it("requires the machines its conditions read", () => {
    const schedule = Game.Schedule.when([Game.Condition.inState(Mode, "Playing")], logs("a"))
    const withoutMachines = Game.Runtime.make({ services: Runtime.services(), resources: { Log: [] } }).success
    expect(withoutMachines.tryTick(schedule)).toEqual({
      _tag: "Failure",
      failure: { _tag: "MissingRuntimeRequirements", requirements: [{ kind: "stateMachine", name: "ScheduleWhen/Mode" }] }
    })
  })
})
