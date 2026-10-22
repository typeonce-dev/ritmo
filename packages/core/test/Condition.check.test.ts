import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Schema } from "@typeonce/ritmo"
import * as Runtime from "@typeonce/ritmo/Runtime"

const hostClock = HostClock.test()

const Freeze = Descriptor.Resource<{ readonly remaining: number }>()("Check/Freeze")
const Log = Descriptor.Resource<ReadonlyArray<string>>()("Check/Log")
const Enemy = Descriptor.Tag("Check/Enemy")
const Ping = Descriptor.Event<number>()("Check/Ping")

const Game = Schema.bind(Schema.fragment({ components: { Enemy }, resources: { Freeze, Log }, events: { Ping } }))
const Flow = Game.StateMachine("Check/Flow", ["Playing", "Over"] as const)

const makeRuntime = (freeze = 0, flow: "Playing" | "Over" = "Playing") =>
  Game.Runtime.make({
    services: Runtime.services(),
    resources: { Freeze: { remaining: freeze }, Log: [] },
    machines: Runtime.machines(Runtime.machine(Flow, flow)),
    debug: { hostClock }
  }).success

const ReadLog = Game.Inspector("Check/ReadLog", { resources: { log: Game.System.readResource(Log) } }, ({ resources }) => resources.log.get())

const logs = (name: string) =>
  Game.System(`Check/${name}`, { resources: { log: Game.System.writeResource(Log) } }, ({ resources }) => {
    resources.log.update((log) => [...log, name])
  })

const frozen = Game.Condition.check("frozen", { resources: { freeze: Game.System.readResource(Freeze) } }, ({ resources }) =>
  resources.freeze.get().remaining > 0)

describe("Condition.check", () => {
  it("gates systems on a resource value, with ordinary code for the logic", () => {
    const playingUnfrozen = Game.Condition.check("playingUnfrozen", {
      resources: { freeze: Game.System.readResource(Freeze) },
      machines: { flow: Game.System.machine(Flow) }
    }, ({ resources, machines }) => machines.flow.get() === "Playing" && resources.freeze.get().remaining <= 0)
    const schedule = Game.Schedule.when([playingUnfrozen], logs("a"), logs("b"))

    for (const [freeze, flow, expected] of [[0, "Playing", ["a", "b"]], [1, "Playing", []], [0, "Over", []]] as const) {
      const runtime = makeRuntime(freeze, flow)
      runtime.tick(schedule)
      expect(runtime.inspect(ReadLog)).toEqual(expected)
    }
  })

  it("composes with machine conditions and not/and/or", () => {
    const system = Game.System("Check/Composed", {
      resources: { log: Game.System.writeResource(Log) },
      when: [Game.Condition.inState(Flow, "Playing"), Game.Condition.not(frozen)]
    }, ({ resources }) => {
      resources.log.update((log) => [...log, "ran"])
    })
    const either = Game.Schedule.when([Game.Condition.or(frozen, Game.Condition.inState(Flow, "Over"))], logs("either"))
    const runtime = makeRuntime(0, "Playing")
    runtime.tick(Game.Schedule(system, either))
    expect(runtime.inspect(ReadLog)).toEqual(["ran"])
    const frozenRuntime = makeRuntime(2, "Playing")
    frozenRuntime.tick(Game.Schedule(system, either))
    expect(frozenRuntime.inspect(ReadLog)).toEqual(["either"])
  })

  it("is evaluated before each gated system and sees earlier writes in the same run", () => {
    const Unfreeze = Game.System("Check/Unfreeze", { resources: { freeze: Game.System.writeResource(Freeze) } }, ({ resources }) => {
      resources.freeze.set({ remaining: 0 })
    })
    const runtime = makeRuntime(1)
    runtime.tick(Game.Schedule(Game.Schedule.when([Game.Condition.not(frozen)], logs("before")), Unfreeze, Game.Schedule.when([Game.Condition.not(frozen)], logs("after"))))
    expect(runtime.inspect(ReadLog)).toEqual(["after"])
  })

  it("reads plain queries", () => {
    const enemiesLeft = Game.Condition.check("enemiesLeft", {
      queries: { enemies: Game.Query({ selection: { enemy: Game.Query.read(Enemy) } }) }
    }, ({ queries }) => queries.enemies.each().length > 0)
    const Spawn = Game.System("Check/SpawnEnemy", {
      commands: Game.System.commands(Game.System.spawns(Enemy))
    }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Enemy, {}]))
    })
    const runtime = makeRuntime()
    const fight = Game.Schedule.when([enemiesLeft], logs("fight"))
    runtime.tick(fight)
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred(), fight))
    expect(runtime.inspect(ReadLog)).toEqual(["fight"])
  })

  it("never consumes or advances what gated systems read", () => {
    const seenEvents: Array<ReadonlyArray<number>> = []
    const seenAdded: Array<number> = []
    const always = Game.Condition.check("always", { resources: { freeze: Game.System.readResource(Freeze) } }, () => true)
    const Emit = Game.System("Check/Emit", {
      events: { ping: Game.System.writeEvent(Ping) },
      commands: Game.System.commands(Game.System.spawns(Enemy))
    }, ({ events, commands }) => {
      events.ping.emit(1)
      commands.spawn(Game.Command.spawn([Enemy, {}]))
    })
    const Read = Game.System("Check/Read", {
      events: { ping: Game.System.readEvent(Ping) },
      queries: { added: Game.Query({ selection: { enemy: Game.Query.read(Enemy) }, filters: [Game.Query.added(Enemy)] }) }
    }, ({ events, queries }) => {
      seenEvents.push(events.ping.all())
      seenAdded.push(queries.added.each().length)
    })
    const runtime = makeRuntime()
    // The same check gates four systems; each evaluation must leave the reader untouched.
    const schedule = Game.Schedule(Emit, Game.Schedule.applyDeferred(), Game.Schedule.when([always], logs("a"), logs("b"), logs("c"), Read))
    runtime.tick(schedule)
    runtime.tick(Game.Schedule(Game.Schedule.when([always], Read)))
    expect(seenEvents).toEqual([[1], []])
    expect(seenAdded).toEqual([1, 0])
  })

  it("requires what it reads, through not/and/or and schedule groups", () => {
    const withoutFreeze = Game.Runtime.make({
      services: Runtime.services(),
      resources: { Log: [] },
      machines: Runtime.machines(Runtime.machine(Flow, "Playing"))
    }).success
    expect(withoutFreeze.tryTick(Game.Schedule.when([Game.Condition.not(frozen)], logs("a")))).toEqual({
      _tag: "Failure",
      failure: { _tag: "MissingRuntimeRequirements", requirements: [{ kind: "resource", name: "Check/Freeze" }] }
    })
  })

  it("propagates an exception from the predicate as a defect", () => {
    const broken = Game.Condition.check("broken", { resources: { freeze: Game.System.readResource(Freeze) } }, () => {
      throw new Error("predicate failed")
    })
    const runtime = makeRuntime()
    expect(() => runtime.tick(Game.Schedule.when([broken], logs("a")))).toThrow("predicate failed")
    expect(runtime.inspect(ReadLog)).toEqual([])
  })

  it("is described by name, and its reads count as the gated system's reads", () => {
    const runtime = makeRuntime()
    const schedule = Game.Schedule.when([Game.Condition.not(frozen)], logs("gated"))
    runtime.debug.nameSchedules({ update: schedule })
    const description = runtime.debug.describe()
    const gated = description.systems.find((system) => system.name === "Check/gated")!
    expect(gated.when).toEqual(["not(check(frozen))"])
    expect(gated.resources.reads).toContain("Check/Freeze")
    expect(description.access.resources.find((entry) => entry.name === "Check/Freeze")?.readers).toContain("Check/gated")
  })
})
