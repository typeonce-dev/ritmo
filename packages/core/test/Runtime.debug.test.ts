import { describe, expect, it } from "vitest"
import { Debug, Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"

const hostClock = HostClock.test()

const Position = Descriptor.Component<{ readonly x: number }>()("Debug/Position")
const Tagged = Descriptor.Component<{}>()("Debug/Tagged")
const Sprite = Descriptor.TransientComponent<{ readonly frame: number }>()("Debug/Sprite")
const Score = Descriptor.Resource<number>()("Debug/Score")
const Ping = Descriptor.Event<number>()("Debug/Ping")
const Lonely = Descriptor.Event<number>()("Debug/Lonely")
const Clock = Descriptor.Service<{ readonly now: () => number }>()("Debug/Clock")
const { relation: ChildOf } = Descriptor.Hierarchy("Debug/ChildOf", "Debug/Children")

const Game = Schema.bind(Schema.fragment({
  components: { Position, Tagged, Sprite },
  resources: { Score },
  events: { Ping, Lonely },
  relations: { ChildOf }
}))
const Flow = Game.StateMachine("Debug/Flow", ["Menu", "Playing"])

const makeRuntime = () => Game.Runtime.make({
  services: Game.Runtime.services(Game.Runtime.service(Clock, { now: () => 0 })),
  resources: { Score: 0 },
  machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Menu")),
  debug: { hostClock }
}).success

const Moving = Game.Query({ selection: { position: Game.Query.write(Position) } })

const Spawn = Game.System("Debug/Spawn", {
  commands: Game.System.commands(Game.System.spawns(Position, Sprite, Tagged), Game.System.relates(ChildOf))
}, ({ commands }) => {
  const parent = commands.spawn(Game.Command.spawn([Position, { x: 1 }], [Sprite, { frame: 0 }]))
  commands.spawn(Game.Command.relate(Game.Command.spawn([Tagged, {}]), ChildOf, parent))
})

const Move = Game.System("Debug/Move", {
  queries: { moving: Moving },
  resources: { score: Game.System.writeResource(Score) },
  events: { ping: Game.System.writeEvent(Ping) },
  nextMachines: { flow: Game.System.nextState(Flow) }
}, ({ queries, resources, events, nextMachines }) => {
  for (const match of queries.moving.each()) {
    match.data.position.update((position) => ({ x: position.x + 1 }))
  }
  resources.score.update((score) => score + 10)
  events.ping.emit(7)
  nextMachines.flow.set("Playing")
})

const collect = (runtime: ReturnType<typeof makeRuntime>) => {
  const events: Array<Debug.TraceEvent> = []
  const stop = runtime.debug.observe((event) => events.push(event))
  return { events, stop }
}

describe("Runtime debug handle", () => {
  it("is absent without the debug option", () => {
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(Game.Runtime.service(Clock, { now: () => 0 })),
      resources: { Score: 0 }
    }).success
    expect("debug" in runtime).toBe(false)
  })

  it("dumps entities, relations, resources, machines, and pending commands", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(Spawn))

    const dump = runtime.debug.dump()
    expect(dump.entityCount).toBe(2)
    expect(dump.entities).toEqual([
      { id: 1, components: { "Debug/Position": { x: 1 }, "Debug/Sprite": { frame: 0 } }, relations: {} },
      { id: 2, components: { "Debug/Tagged": {} }, relations: { "Debug/ChildOf": 1 } }
    ])
    expect(dump.resources).toEqual({ "Debug/Score": 0 })
    expect(dump.machines).toEqual({ "Debug/Flow": { current: "Menu" } })
    expect(dump.pendingCommands).toEqual([
      { tag: "spawn", system: "Debug/Spawn" },
      { tag: "spawn", system: "Debug/Spawn" }
    ])
    expect(runtime.debug.dump({ with: [Tagged] }).entities.map((entity) => entity.id)).toEqual([2])
    expect(runtime.debug.dump({ entities: [1], limit: 1 }).entities.map((entity) => entity.id)).toEqual([1])
  })

  it("describes schema, named schedules, access, and lints", () => {
    const runtime = makeRuntime()
    const Emit = Game.System("Debug/EmitLonely", { events: { lonely: Game.System.writeEvent(Lonely) } }, () => {})
    const update = Game.Schedule(Move, Emit, Game.Schedule.applyDeferred())
    runtime.debug.nameSchedules({ update })

    const description = runtime.debug.describe()
    expect(description.components).toEqual([
      { name: "Debug/Position", storage: "plain", immutable: false, requires: [] },
      { name: "Debug/Tagged", storage: "plain", immutable: false, requires: [] },
      { name: "Debug/Sprite", storage: "transient", immutable: false, requires: [] }
    ])
    expect(description.machines).toEqual([{ name: "Debug/Flow", states: ["Menu", "Playing"], current: "Menu", provided: true, within: undefined }])
    expect(description.scopes).toEqual([])
    expect(description.services).toEqual([{ name: "Debug/Clock", provided: true }])
    expect(description.schedules).toEqual([{
      name: "update",
      steps: [
        { kind: "system", system: "Debug/Move" },
        { kind: "system", system: "Debug/EmitLonely" },
        { kind: "applyDeferred" }
      ]
    }])
    const move = description.systems.find((system) => system.name === "Debug/Move")!
    expect(move.placements).toEqual(["update#0"])
    expect(move.queries).toEqual([expect.objectContaining({ slot: "moving", writes: ["Debug/Position"] })])
    expect(move.resources).toEqual({ reads: [], changed: [], writes: ["Debug/Score"] })
    expect(description.access.resources).toEqual([{ name: "Debug/Score", readers: [], writers: ["Debug/Move"] }])
    expect(description.lints.map((lint) => [lint.code, lint.subject])).toEqual([
      ["event-never-read", "Debug/Ping"],
      ["event-never-read", "Debug/Lonely"],
      ["next-state-never-applied", "Debug/Flow"],
      ["component-never-read", "Debug/Position"]
    ])
  })

  it("lints relations that commands relate when no described system reads their failures", () => {
    const runtime = makeRuntime()
    const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
    runtime.debug.nameSchedules({ setup })
    const relationLints = () => runtime.debug.describe().lints.filter((lint) => lint.code === "relation-failure-never-read")
    // Spawn relates in its drafts, so it declares relates(ChildOf): the lint holds before any command ran, and after.
    expect(relationLints().map((lint) => lint.subject)).toEqual(["Debug/ChildOf"])

    runtime.tick(setup)
    expect(relationLints()).toEqual([{
      severity: "warning",
      code: "relation-failure-never-read",
      subject: "Debug/ChildOf",
      message: "Debug/ChildOf is related by commands from Debug/Spawn, but no described system reads its failures (Game.System.readRelationFailures(Debug/ChildOf)), so a failed relate or reorder is dropped silently",
      fix: "read the failures with Game.System.readRelationFailures(Debug/ChildOf) in a system and handle them"
    }])

    const ReadFailures = Game.System("Debug/ReadChildOfFailures", {
      relationFailures: { childOf: Game.System.readRelationFailures(ChildOf) }
    }, () => {})
    runtime.debug.nameSchedules({ setup, failures: Game.Schedule(ReadFailures) })
    expect(relationLints()).toEqual([])
  })

  it("lints a next state one system queued and another replaced before the marker", () => {
    const runtime = makeRuntime()
    const queue = (name: string, value: "Menu" | "Playing") =>
      Game.System(`Debug/Queue${name}`, { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
        nextMachines.flow.set(value)
      })
    const Lose = queue("Lose", "Menu")
    const Win = queue("Win", "Playing")
    const Again = queue("Again", "Playing")
    const replaced = () => runtime.debug.describe().lints.filter((lint) => lint.code === "next-state-replaced")

    // The same value twice, or one system alone, replaces nothing.
    runtime.tick(Game.Schedule(Win, Again, Game.Schedule.applyStateTransitions()))
    expect(replaced()).toEqual([])

    runtime.tick(Game.Schedule(Lose, Win, Game.Schedule.applyStateTransitions()))
    runtime.tick(Game.Schedule(Lose, Win, Game.Schedule.applyStateTransitions()))
    expect(replaced()).toEqual([{
      severity: "warning",
      code: "next-state-replaced",
      subject: "Debug/Flow",
      message: "Debug/QueueWin queued Debug/Flow=Playing, replacing Menu queued by Debug/QueueLose before the same applyStateTransitions(), 2 times: the last value wins",
      fix: "decide between the values in one system, or check whether a next state is already queued (nextMachines.x.getPending()) before setting another"
    }])
  })

  it("lints a relation a system may relate (declared relates) before any command ran, and not once its failures are read", () => {
    const runtime = makeRuntime()
    const Adopt = Game.System("Debug/Adopt", { commands: Game.System.commands(Game.System.relates(ChildOf)) }, () => {})
    runtime.debug.nameSchedules({ adopt: Game.Schedule(Adopt) })
    const relationLints = () => runtime.debug.describe().lints.filter((lint) => lint.code === "relation-failure-never-read")
    expect(relationLints().map((lint) => lint.message)).toEqual([
      "Debug/ChildOf is related by commands from Debug/Adopt, but no described system reads its failures (Game.System.readRelationFailures(Debug/ChildOf)), so a failed relate or reorder is dropped silently"
    ])
    const ReadFailures = Game.System("Debug/ReadAdoptFailures", {
      relationFailures: { childOf: Game.System.readRelationFailures(ChildOf) }
    }, () => {})
    runtime.debug.nameSchedules({ adopt: Game.Schedule(Adopt), failures: Game.Schedule(ReadFailures) })
    expect(relationLints()).toEqual([])
  })

  it("lints declared command permissions a system that ran never used, and none it used", () => {
    const runtime = makeRuntime()
    const Place = Game.System("Debug/Place", {
      commands: Game.System.commands(Game.System.spawns(Position, Tagged), Game.System.inserts(Tagged), Game.System.removes(Tagged))
    }, ({ commands }) => {
      const id = commands.spawn(Game.Command.spawn([Position, { x: 0 }], [Tagged, {}]))
      commands.remove(id, Tagged)
    })
    const setup = Game.Schedule(Place, Game.Schedule.applyDeferred())
    runtime.debug.nameSchedules({ setup })
    const unused = () => runtime.debug.describe().lints.filter((lint) => lint.code === "command-permission-unused")
    // A system that has not run reports nothing.
    expect(unused()).toEqual([])
    runtime.tick(setup)
    expect(unused()).toEqual([{
      severity: "info",
      code: "command-permission-unused",
      subject: "Debug/Place",
      message: "Debug/Place may insert Debug/Tagged but never did in this session",
      fix: "fine if the session did not reach the case where Debug/Place uses it; otherwise drop the permission from its Game.System.commands(...)"
    }])
    expect(runtime.debug.describe().systems.find((system) => system.name === "Debug/Place")?.commands).toEqual({
      spawns: ["Debug/Position", "Debug/Tagged"],
      inserts: ["Debug/Tagged"],
      removes: ["Debug/Tagged"],
      despawns: [],
      despawnsScope: [],
      relates: []
    })
  })

  it("indexes declared spawns, inserts, and removes as component writers", () => {
    const runtime = makeRuntime()
    const Place = Game.System("Debug/PlaceTagged", { commands: Game.System.commands(Game.System.spawns(Tagged)) }, () => {})
    runtime.debug.nameSchedules({ setup: Game.Schedule(Place) })
    const described = runtime.debug.describe()
    expect(described.access.components.find((entry) => entry.name === "Debug/Tagged")?.writers).toEqual(["Debug/PlaceTagged"])
    expect(described.lints.filter((lint) => lint.code === "component-never-read").map((lint) => lint.subject)).toContain("Debug/Tagged")
    const ReadTagged = Game.System("Debug/ReadTagged", { queries: { tagged: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Tagged] }) } }, () => {})
    runtime.debug.nameSchedules({ setup: Game.Schedule(Place, ReadTagged) })
    expect(runtime.debug.describe().lints.filter((lint) => lint.code === "component-never-read").map((lint) => lint.subject)).not.toContain("Debug/Tagged")
  })

  it("traces system writes with before and after values, and commands with their effects", () => {
    const runtime = makeRuntime()
    const setup = Game.Schedule(Spawn, Game.Schedule.applyDeferred())
    const update = Game.Schedule(Move, Game.Schedule.applyStateTransitions())
    runtime.debug.nameSchedules({ setup, update })
    const { events, stop } = collect(runtime)
    runtime.tick(setup)
    runtime.tick(update)
    stop()

    expect(events.map((event) => event.type)).toEqual([
      "frame", "schedule.start", "system", "deferred", "schedule.end",
      "frame", "schedule.start", "system", "transition", "schedule.end"
    ])
    const deferred = events.find((event): event is Debug.DeferredEvent => event.type === "deferred")!
    expect(deferred.commands).toEqual([
      {
        tag: "spawn",
        system: "Debug/Spawn",
        effects: [{ kind: "spawn", entity: 1, components: { "Debug/Position": { x: 1 }, "Debug/Sprite": { frame: 0 } } }]
      },
      {
        tag: "spawn",
        system: "Debug/Spawn",
        effects: [
          { kind: "spawn", entity: 2, components: { "Debug/Tagged": {} } },
          { kind: "relate", entity: 2, relation: "Debug/ChildOf", target: 1 }
        ]
      }
    ])
    const move = events.filter((event): event is Debug.SystemEvent => event.type === "system")[1]!
    expect(move).toMatchObject({
      schedule: "update",
      system: "Debug/Move",
      outcome: "ok",
      frame: 2,
      writes: [{ entity: 1, component: "Debug/Position", before: { x: 1 }, after: { x: 2 } }],
      resources: [{ resource: "Debug/Score", before: 0, after: 10 }],
      events: [{ event: "Debug/Ping", values: [7] }],
      nextStates: [{ machine: "Debug/Flow", value: "Playing" }],
      commands: [],
      missed: []
    })
    expect(events.find((event) => event.type === "transition")).toMatchObject({
      machine: "Debug/Flow", from: "Menu", to: "Playing", outcome: "applied"
    })
    expect(runtime.debug.frame()).toBe(2)
  })

  it("reports rolled-back writes of failed systems and dropped commands", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
    const Failing = Game.System("Debug/Failing", {
      queries: { moving: Moving },
      commands: Game.System.commands(Game.System.spawns(Tagged))
    }, ({ queries, commands }) => {
      for (const match of queries.moving.each()) match.data.position.set({ x: 99 })
      commands.spawn(Game.Command.spawn([Tagged, {}]))
      return Result.fail("Nope" as const)
    })
    const { events } = collect(runtime)
    expect(runtime.tick(Game.Schedule(Failing))._tag).toBe("Failure")
    const failed = events.find((event): event is Debug.SystemEvent => event.type === "system")!
    expect(failed).toMatchObject({
      outcome: "failed",
      error: "Nope",
      writes: [{ entity: 1, component: "Debug/Position", before: { x: 1 }, after: { x: 99 } }],
      commands: ["spawn"]
    })
    expect(runtime.debug.dump({ entities: [1] }).entities[0]!.components["Debug/Position"]).toEqual({ x: 1 })
  })

  it("names transition schedules and skipped systems with their discarded messages", () => {
    const runtime = makeRuntime()
    const Emit = Game.System("Debug/Emit", { events: { ping: Game.System.writeEvent(Ping) } }, ({ events }) => {
      events.ping.emit(1)
    })
    const ReadWhenPlaying = Game.System("Debug/ReadWhenPlaying", {
      events: { ping: Game.System.readEvent(Ping) },
      when: [Game.Condition.inState(Flow, "Playing")]
    }, () => {})
    const Start = Game.System("Debug/Start", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
      nextMachines.flow.set("Playing")
    })
    const Stop = Game.System("Debug/Stop", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
      nextMachines.flow.set("Menu")
    })
    const OnPlay = Game.Schedule.onEnter(Flow, "Playing", [Emit])
    const transitions = Game.Schedule.transitions(OnPlay)
    const start = Game.Schedule(Start, Game.Schedule.applyStateTransitions(transitions), ReadWhenPlaying)
    const stop = Game.Schedule(Stop, Game.Schedule.applyStateTransitions(transitions), Emit, ReadWhenPlaying)
    runtime.debug.nameSchedules({ start, stop })
    const { events } = collect(runtime)
    runtime.tick(start)
    runtime.tick(stop)

    const emitted = events.filter((event): event is Debug.SystemEvent => event.type === "system" && event.system === "Debug/Emit")
    expect(emitted[0]!.schedule).toBe("start > onEnter(Debug/Flow=Playing)")
    expect(emitted[1]!.schedule).toBe("stop")
    const skipped = events.find((event): event is Debug.SystemSkippedEvent => event.type === "system.skipped")!
    expect(skipped).toMatchObject({
      system: "Debug/ReadWhenPlaying",
      condition: "inState(Debug/Flow=Playing)",
      discarded: [{ stream: "Debug/Ping", count: 1 }]
    })
    expect(runtime.debug.describe().schedules.map((schedule) => schedule.name)).toEqual([
      "start", "onEnter(Debug/Flow=Playing)", "stop"
    ])
  })

  it("reports stream readers, unread counts, and the reader holding retention", () => {
    const runtime = makeRuntime()
    const Emit = Game.System("Debug/EmitPing", { events: { ping: Game.System.writeEvent(Ping) } }, ({ events }) => {
      events.ping.emit(1)
    })
    const Read = Game.System("Debug/SlowReader", { events: { ping: Game.System.readEvent(Ping) } }, () => {})
    runtime.tick(Game.Schedule(Read))
    const emit = Game.Schedule(Emit)
    for (let frame = 0; frame < 4; frame++) runtime.tick(emit)

    const [ping] = runtime.debug.streams()
    expect(ping).toMatchObject({
      kind: "event",
      stream: "Debug/Ping",
      size: 4,
      readers: [{ system: "Debug/SlowReader", unread: 4, lagged: false }],
      heldBy: "Debug/SlowReader"
    })
  })

  it("reports readers that lost entries at stream capacity", () => {
    const runtime = makeRuntime()
    const Flood = Game.System("Debug/Flood", { events: { ping: Game.System.writeEvent(Ping) } }, ({ events }) => {
      for (let index = 0; index < 40_000; index++) events.ping.emit(index)
    })
    const Read = Game.System("Debug/StalledReader", { events: { ping: Game.System.readEvent(Ping) } }, () => {})
    const read = Game.Schedule(Read)
    runtime.tick(read)
    const flood = Game.Schedule(Flood)
    runtime.tick(flood)
    runtime.tick(flood)
    // Two more frames move the last batch out of the two-frame window.
    runtime.tick(Game.Schedule())
    runtime.tick(Game.Schedule())

    const [ping] = runtime.debug.streams()
    expect(ping).toMatchObject({
      size: 40_000,
      readers: [{ system: "Debug/StalledReader", unread: 40_000, lagged: true }],
      heldBy: "Debug/StalledReader"
    })
    const { events } = collect(runtime)
    runtime.tick(read)
    const run = events.find((event): event is Debug.SystemEvent => event.type === "system")!
    expect(run.missed).toEqual([{ kind: "event", stream: "Debug/Ping" }])
  })

  it("does not report removed reads held for a slow reader as missed", () => {
    const runtime = makeRuntime()
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
    const ReadRemoved = Game.System("Debug/ReadRemoved", { removed: { tagged: Game.System.readRemoved(Tagged) } }, () => {})
    const Untag = Game.System("Debug/Untag", {
      queries: { tagged: Game.Query({ selection: { tagged: Game.Query.read(Tagged) } }) },
      commands: Game.System.commands(Game.System.removes(Tagged))
    }, ({ queries, commands }) => {
      for (const match of queries.tagged.each()) commands.remove(match.entity, Tagged)
    })
    const read = Game.Schedule(ReadRemoved)
    runtime.tick(read)
    runtime.tick(Game.Schedule(Untag, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule())
    runtime.tick(Game.Schedule())
    const { events } = collect(runtime)
    runtime.tick(read)
    const run = events.find((event): event is Debug.SystemEvent => event.type === "system")!
    expect(run.missed).toEqual([])
  })

  it("reports despawned reads dropped at capacity as missed", () => {
    const runtime = makeRuntime()
    const ReadDespawned = Game.System("Debug/ReadDespawned", { despawned: { entities: Game.System.readDespawned() } }, () => {})
    const SpawnMany = Game.System("Debug/SpawnMany", {
      commands: Game.System.commands(Game.System.spawns(Tagged))
    }, ({ commands }) => {
      for (let index = 0; index < 40_000; index++) commands.spawn(Game.Command.spawn([Tagged, {}]))
    })
    const DespawnAll = Game.System("Debug/DespawnAll", {
      queries: { all: Game.Query({ selection: {}, with: [Tagged] }) },
      commands: Game.System.commands(Game.System.despawns(Tagged))
    }, ({ queries, commands }) => {
      for (const match of queries.all.each()) commands.despawn(match.entity)
    })
    const read = Game.Schedule(ReadDespawned)
    runtime.tick(read)
    const churn = Game.Schedule(SpawnMany, Game.Schedule.applyDeferred(), DespawnAll, Game.Schedule.applyDeferred())
    runtime.tick(churn)
    runtime.tick(churn)
    runtime.tick(Game.Schedule())
    runtime.tick(Game.Schedule())
    const { events } = collect(runtime)
    runtime.tick(read)
    const run = events.find((event): event is Debug.SystemEvent => event.type === "system")!
    expect(run.missed).toEqual([{ kind: "despawned", stream: "despawned" }])
  })

  it("stops tracing when the last listener unsubscribes", () => {
    const runtime = makeRuntime()
    const { events, stop } = collect(runtime)
    stop()
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
    expect(events).toEqual([])
  })
})

describe("Runtime debug handle: population and ordering lints", () => {
  it("counts live entities and entities per component", () => {
    const runtime = makeRuntime()
    expect(runtime.debug.population()).toEqual({
      entities: 0,
      components: { "Debug/Position": 0, "Debug/Tagged": 0, "Debug/Sprite": 0 }
    })
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
    runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred()))
    expect(runtime.debug.population()).toEqual({
      entities: 4,
      components: { "Debug/Position": 2, "Debug/Tagged": 2, "Debug/Sprite": 2 }
    })
  })

  it("counts components read only inside Query.anyOf as reads", () => {
    const runtime = makeRuntime()
    const Place = Game.System("Debug/PlaceTaggedAny", { commands: Game.System.commands(Game.System.spawns(Tagged)) }, () => {})
    const Redraw = Game.System("Debug/RedrawAny", { queries: { q: Game.Query({
      selection: { sprite: Game.Query.read(Sprite) },
      filters: [Game.Query.anyOf(Game.Query.added(Tagged), Game.Query.changed(Position))]
    }) } }, () => {})
    runtime.debug.nameSchedules({ update: Game.Schedule(Redraw, Place, Move) })
    const described = runtime.debug.describe()
    expect(described.access.components.find((entry) => entry.name === "Debug/Tagged")?.readers).toEqual(["Debug/RedrawAny"])
    expect(described.lints.filter((lint) => lint.code === "component-never-read").map((lint) => lint.subject)).not.toContain("Debug/Tagged")
    // Redraw reads Position only through anyOf, before Move writes it.
    expect(described.lints.filter((lint) => lint.code === "read-before-write").map((lint) => lint.subject)).toContain("Debug/Position")
  })

  it("describes a system placed directly and under Schedule.when once, with both placements", () => {
    const runtime = makeRuntime()
    const Noop = Game.System("Debug/NoopTwice", {}, () => {})
    runtime.debug.nameSchedules({
      plain: Game.Schedule(Noop),
      gated: Game.Schedule(Game.Schedule.when([Game.Condition.inState(Flow, "Playing")], Noop))
    })
    const entries = runtime.debug.describe().systems.filter((system) => system.name === "Debug/NoopTwice")
    expect(entries.map((system) => system.placements)).toEqual([["plain#0", "gated#0"]])
  })

  it("notes systems that read something before the schedule's first writer of it", () => {
    const runtime = makeRuntime()
    const ReadAll = Game.System("Debug/ReadAll", {
      queries: {
        positions: Game.Query({ selection: { position: Game.Query.read(Position) } }),
        tagged: Game.Query({ selection: { position: Game.Query.read(Position) }, with: [Tagged] })
      },
      resources: { score: Game.System.readResource(Score) },
      events: { ping: Game.System.readEvent(Ping) }
    }, () => {})
    const ReadTagged = Game.System("Debug/ReadTagged", {
      queries: { tagged: Game.Query({ selection: { tagged: Game.Query.read(Tagged) } }) }
    }, () => {})
    // ReadAll before Move: previous-run values. ReadAll after Move: current values, no lint.
    runtime.debug.nameSchedules({ early: Game.Schedule(ReadAll, ReadTagged, Move), late: Game.Schedule(Move, ReadAll) })
    const lints = runtime.debug.describe().lints.filter((lint) => lint.code === "read-before-write")
    expect(lints.map((lint) => [lint.severity, lint.subject])).toEqual([
      ["info", "Debug/Position"],
      ["info", "Debug/Score"],
      ["info", "Debug/Ping"]
    ])
    expect(lints[0]!.message).toBe(
      "in early, Debug/ReadAll runs before Debug/Move writes Debug/Position, so it sees the Debug/Position value from the previous run"
    )
    expect(lints[2]!.message).toContain("sees Debug/Ping events one run late")
  })
})
