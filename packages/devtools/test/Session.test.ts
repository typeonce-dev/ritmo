import { inspect } from "node:util"
import { describe, expect, it } from "vitest"
import { Descriptor, HostClock, Result, Schema } from "@typeonce/ritmo"
import { Format, Invariant, Session } from "@typeonce/ritmo-devtools"

const hostClock = HostClock.test()

const Position = Descriptor.Component<{ readonly x: number }>()("Dev/Position")
const Health = Descriptor.Component<number>()("Dev/Health")
const Score = Descriptor.Resource<number>()("Dev/Score")
const Hit = Descriptor.Event<number>()("Dev/Hit")
const Game = Schema.bind(Schema.fragment({
  components: { Position, Health },
  resources: { Score },
  events: { Hit }
}))
const Flow = Game.StateMachine("Dev/Flow", ["Playing", "Paused"])

const Movers = Game.Query({ selection: { position: Game.Query.write(Position) } })
const Healthy = Game.Query({ selection: { health: Game.Query.write(Health) } })

const Spawn = Game.System("Dev/Spawn", { commands: Game.System.commands(Game.System.spawns(Position, Health)) }, ({ commands }) => {
  commands.spawn(Game.Command.spawn([Position, { x: 0 }], [Health, 3]))
})
const Move = Game.System("Dev/Move", { queries: { movers: Movers } }, ({ queries }) => {
  for (const match of queries.movers.each()) match.data.position.update((position) => ({ x: position.x + 1 }))
})
const Idle = Game.System("Dev/Idle", { resources: { score: Game.System.writeResource(Score) } }, ({ resources }) => {
  resources.score.set(resources.score.get())
})
const Damage = Game.System("Dev/Damage", {
  queries: { healthy: Healthy },
  events: { hit: Game.System.writeEvent(Hit) }
}, ({ queries, events }) => {
  for (const match of queries.healthy.each()) {
    match.data.health.update((health) => health - 1)
    events.hit.emit(1)
  }
})
const ReadHitsWhenPaused = Game.System("Dev/ReadHitsWhenPaused", {
  events: { hit: Game.System.readEvent(Hit) },
  when: [Game.Condition.inState(Flow, "Paused")]
}, () => {})

const Play = Game.System("Dev/Play", { nextMachines: { flow: Game.System.nextState(Flow) } }, ({ nextMachines }) => {
  nextMachines.flow.set("Playing")
})

const NearOrigin = Invariant.fromInspector(Game.Inspector("near origin", {
  queries: { movers: Game.Query({ selection: { position: Game.Query.read(Position) } }) }
}, ({ queries }) => {
  const far = queries.movers.each().map((match) => match.data.position.get().x).find((x) => x > 2)
  return far === undefined ? undefined : `x=${far}`
}))

// The reader runs once while paused, then is skipped while playing.
const setup = Game.Schedule(Spawn, ReadHitsWhenPaused, Play, Game.Schedule.applyStateTransitions())
const update = Game.Schedule(Move, Idle, Damage, ReadHitsWhenPaused)

const makeRuntime = () => Game.Runtime.make({
  services: Game.Runtime.services(),
  resources: { Score: 0 },
  machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Paused")),
  debug: { hostClock }
}).success

const makeSession = () => {
  const runtime = makeRuntime()
  const session = Session.make(runtime, { hostClock, schedules: { setup, update } })
  return { runtime, session }
}

describe("Session", () => {
  it("records host sends and reports held pauses separately from discarded skips", () => {
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Paused")),
      debug: { hostClock }
    }).success
    const Read = Game.System("Dev/HeldReader", { events: { hit: Game.System.readEvent(Hit) } }, () => {})
    const update = Game.Schedule.pauseWhen([Game.Condition.inState(Flow, "Playing")], Read)
    const session = Session.make(runtime, { hostClock, schedules: { update } })
    session.run("update")
    runtime.send(Hit, 7)
    session.run("update")
    expect(session.report().data.systems.find((system) => system.system === Read.name)).toMatchObject({ runs: 0, skips: 0, pauses: 2 })
    expect(session.report().data.warnings).toEqual([])
    expect(session.journal({ verbose: true }).text).toContain("sent Dev/Hit 7 (runtime.send)")
    expect(session.journal({ verbose: true }).text).toContain("holding its stream entries")
    runtime.send(Hit, Number.NaN)
    expect(session.report().data.warnings.some((warning) => warning.code === "non-finite-value")).toBe(true)
  })

  it("runs named schedules and reports completed runs", () => {
    const { session } = makeSession()
    expect(session.run("setup").data).toMatchObject({ ok: true, frames: 1, range: [1, 1], stop: { reason: "completed" } })
    const run = session.run("update", { frames: 2 })
    expect(run.data).toMatchObject({ ok: true, frames: 2, range: [2, 3] })
    expect(String(run).split("\n")[0]).toMatch(/^run update: 2 frames \(f2-f3\) in .*ms, completed$/)
    // The paused-only reader discards the hits emitted while playing.
    expect(String(run).split("\n").slice(1)).toEqual(["warnings during the run (see report()): discarded-messages x2"])
    expect(run.data).toMatchObject({ warnings: { "discarded-messages": 2 }, entities: { start: 1, peak: 1, end: 1 }, growing: [] })
    expect(inspect(run)).toBe(run.text)
    expect(JSON.parse(JSON.stringify(run))).toMatchObject({ schedule: "update", ok: true })
  })

  it("writes identical text in two sessions timed by test clocks", () => {
    const play = () => {
      const clock = HostClock.test()
      const runtime = Game.Runtime.make({
        services: Game.Runtime.services(),
        resources: { Score: 0 },
        machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Paused")),
        debug: { hostClock: clock }
      }).success
      const session = Session.make(runtime, { hostClock: clock, schedules: { setup, update } })
      const runs = [session.run("setup").text, session.run("update", { frames: 5 }).text]
      return { runs, report: session.report().text }
    }
    const first = play()
    const second = play()
    expect(first.runs[1]).toMatch(/ in 0(\.0+)?ms/)
    expect(second.runs).toEqual(first.runs)
    expect(second.report).toBe(first.report)
  })

  it("stops at an until condition", () => {
    const { session } = makeSession()
    session.run("setup")
    expect(session.run("update", { frames: 10, until: (frame) => frame === 3 }).data.stop).toEqual({ reason: "until", frame: 3 })
  })

  it("stops at the first violated invariant with its message", () => {
    const session = Session.make(makeRuntime(), { hostClock, schedules: { setup, update }, invariants: [NearOrigin] })
    session.run("setup")
    const run = session.run("update", { frames: 10 })
    expect(run.data).toMatchObject({ ok: false, frames: 3, stop: { reason: "invariant", frame: 4, invariant: "near origin", message: "x=3" } })
    expect(run.text).toContain(`INVARIANT "near origin" violated at f4: x=3`)
  })

  it("stops with invariant-threw, keeping the run's text, when an invariant throws", () => {
    const FirstMover = Invariant.fromInspector(Game.Inspector("first mover", {
      queries: { movers: Game.Query({ selection: { position: Game.Query.read(Position) } }) }
    }, ({ queries }): string | undefined => {
      const first = queries.movers.each()[0]
      if (first === undefined) throw new Error("no mover")
      return undefined
    }))
    const session = Session.make(makeRuntime(), { hostClock, schedules: { setup, update }, invariants: [FirstMover] })
    const run = session.run("update", { frames: 5 })
    expect(run.data).toMatchObject({ ok: false, frames: 1, stop: { reason: "invariant-threw", frame: 1, invariant: "first mover" } })
    expect(run.text).toContain(`INVARIANT "first mover" threw at f1: Error: no mover`)
    // The session stays usable.
    expect(session.run("setup").data.stop).toEqual({ reason: "completed" })
  })

  it("reports expected failures and thrown defects as stops", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Score: 0 }, debug: { hostClock } }).success
    const Fail = Game.System("Dev/Fail", {}, () => Result.fail("Broken" as const))
    const Throw = Game.System("Dev/Throw", {}, () => {
      throw new Error("kaboom")
    })
    const session = Session.make(runtime, { hostClock, schedules: { fail: Game.Schedule(Fail), boom: Game.Schedule(Throw) } })
    expect(session.run("fail").data.stop).toEqual({ reason: "failure", frame: 1, system: "Dev/Fail", error: "Broken" })
    const defect = session.run("boom").data.stop
    expect(defect).toMatchObject({ reason: "defect", frame: 2 })
    expect(session.report().data.warnings.map((warning) => warning.code)).toEqual(["system-failed", "system-failed"])
  })

  it("journals writes with filters and hides no-change lines unless verbose", () => {
    const { session } = makeSession()
    session.run("setup")
    session.run("update", { frames: 3 })

    const journal = session.journal({ frames: 2 })
    expect(journal.data.map((line) => line.text)).toEqual([
      "write e1 Dev/Position {x:0} -> {x:1}",
      "write e1 Dev/Health 3 -> 2",
      "emit Dev/Hit [1]",
      "skipped: inState(Dev/Flow=Paused) is false; discarded 1 Dev/Hit"
    ])
    expect(journal.text.split("\n")[0]).toBe("journal: 4 lines (history f1-f4, 1 no-change lines hidden (verbose: true shows them))")
    expect(session.journal({ frames: 2, verbose: true }).data.map((line) => line.text)).toContain("resource Dev/Score 0 -> 0")
    expect(session.journal({ component: Health }).data.map((line) => [line.frame, line.text])).toEqual([
      [2, "write e1 Dev/Health 3 -> 2"],
      [3, "write e1 Dev/Health 2 -> 1"],
      [4, "write e1 Dev/Health 1 -> 0"]
    ])
    expect(session.journal({ system: "Dev/Move", limit: 1 }).data.map((line) => line.frame)).toEqual([4])
    expect(session.journal({ kinds: ["effect"] }).data.map((line) => line.text)).toEqual([
      "applyStateTransitions: spawn e1 Dev/Position={x:0} Dev/Health=3"
    ])
  })

  it("explains the latest changes to one component, including its spawn", () => {
    const { session } = makeSession()
    session.run("setup")
    session.run("update", { frames: 2 })
    const why = session.why(1, Position, { limit: 3 })
    expect(why.text).toBe([
      "e1 Dev/Position is now {x:2}; last 3 changes (oldest first):",
      "could have spawned it: Dev/Spawn",
      "f1 setup  Dev/Spawn  applyStateTransitions: spawn e1 Dev/Position={x:0} Dev/Health=3",
      "f2 update  Dev/Move  write e1 Dev/Position {x:0} -> {x:1}",
      "f3 update  Dev/Move  write e1 Dev/Position {x:1} -> {x:2}"
    ].join("\n"))
  })

  it("summarizes systems and warnings in the report", () => {
    const { session } = makeSession()
    const Queue = Game.System("Dev/QueueLate", { commands: Game.System.commands(Game.System.spawns(Health)) }, ({ commands }) => {
      commands.spawn(Game.Command.spawn([Health, 1]))
    })
    const runtime2 = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Score: 0 }, debug: { hostClock } }).success
    const late = Session.make(runtime2, { hostClock, schedules: { late: Game.Schedule(Queue) } })
    late.run("late", { frames: 2 })
    expect(late.report().data.warnings).toMatchObject([
      { code: "pending-commands", count: 2, firstFrame: 1, lastFrame: 2 }
    ])

    session.run("setup")
    session.run("update", { frames: 2 })
    const report = session.report()
    expect(report.data.systems.find((entry) => entry.system === "Dev/ReadHitsWhenPaused")).toMatchObject({ runs: 1, skips: 2 })
    expect(report.data.warnings).toMatchObject([
      { code: "discarded-messages", count: 2 }
    ])
  })

  it("renders the dump, description, system activity, and streams as text", () => {
    const { session } = makeSession()
    session.run("setup")
    session.run("update")
    expect(session.dump().text.split("\n").slice(0, 2)).toEqual([
      "frame 2 (tick 9), 1 of 1 entities",
      "e1  Dev/Position={x:1}  Dev/Health=2"
    ])
    expect(session.describe().text).toContain("update:\n   0 Dev/Move\n   1 Dev/Idle")
    expect(session.system("Dev/Move").text).toContain("query movers: write Dev/Position")
    expect(session.streams().text).toContain("event Dev/Hit: 1/65536 retained")
  })
})

describe("Format.system change reads", () => {
  it("prints anyOf filters and resources read with changedResource", () => {
    const Redraw = Game.System("Dev/Redraw", {
      queries: {
        moved: Game.Query({
          selection: { position: Game.Query.read(Position) },
          filters: [Game.Query.anyOf(Game.Query.changed(Position), Game.Query.added(Health))]
        })
      },
      resources: { score: Game.System.changedResource(Score) }
    }, () => {})
    const runtime = makeRuntime()
    const session = Session.make(runtime, { hostClock, schedules: { update: Game.Schedule(Idle, Redraw) } })
    const text = session.system("Dev/Redraw").text
    expect(text).toContain("query moved: read Dev/Position; any of (added Dev/Health, changed Dev/Position)")
    expect(text).toContain("reads resources when changed: Dev/Score")
    expect(text).not.toContain("reads resources: Dev/Score")
  })
})

describe("Format.value", () => {
  it("prints compact values", () => {
    expect(Format.value({ x: 1.23456, list: [1, 2, 3], nested: { deep: { deeper: { deepest: 1 } } } })).toBe(
      "{x:1.235,list:[1,2,3],nested:{deep:{deeper:{…}}}}"
    )
    expect(Format.value(4)).toBe("4")
    expect(Format.value(Array.from({ length: 10 }, (_, index) => index))).toBe("[0,1,2,3,4,5,6,7,…+2]")
    class Sprite {
      readonly frame = 1
    }
    expect(Format.value(new Sprite())).toBe("Sprite{frame:1}")
  })
})

describe("Format.transition", () => {
  it("prints a sub-state without a value as (inactive)", () => {
    expect(Format.transition({ machine: "Dev/Phase", from: undefined, to: "Setup" })).toBe("Dev/Phase (inactive) -> Setup")
    expect(Format.transition({ machine: "Dev/Phase", from: "Battle", to: undefined })).toBe("Dev/Phase Battle -> (inactive)")
    expect(Format.transition({ machine: "Dev/Flow", from: "Menu", to: "Playing" })).toBe("Dev/Flow Menu -> Playing")
  })
})

describe("Session report streams", () => {
  it("lists streams held past the frame window by a reader", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Score: 0 }, debug: { hostClock } }).success
    const Emit = Game.System("Dev/EmitHit", { events: { hit: Game.System.writeEvent(Hit) } }, ({ events }) => {
      events.hit.emit(1)
    })
    const Read = Game.System("Dev/RareReader", { events: { hit: Game.System.readEvent(Hit) } }, () => {})
    const session = Session.make(runtime, { hostClock, schedules: { read: Game.Schedule(Read), emit: Game.Schedule(Emit) } })
    session.run("read")
    session.run("emit", { frames: 4 })
    const report = session.report()
    expect(report.data.streams).toMatchObject([{ stream: "Dev/Hit", size: 4, heldBy: "Dev/RareReader" }])
    expect(report.text).toContain("# Streams held by readers\nevent Dev/Hit: 4/65536 retained, held by Dev/RareReader\n  Dev/RareReader: 4 unread")
  })
})

describe("Session next states and resources", () => {
  it("warns about next states never applied, at run time and through lints", () => {
    const runtime = Game.Runtime.make({
      services: Game.Runtime.services(),
      resources: { Score: 0 },
      machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Paused")),
      debug: { hostClock }
    }).success
    const session = Session.make(runtime, { hostClock, schedules: { update: Game.Schedule(Play, Game.Schedule.applyDeferred()) } })
    const run = session.run("update", { frames: 3 })
    expect(run.data.lintWarnings).toBe(1)
    expect(run.text.split("\n")[1]).toBe("1 lint warnings (see describe() or report()): next-state-never-applied Dev/Flow")
    const report = session.report()
    expect(report.data.warnings).toMatchObject([{ code: "pending-next-state", count: 3 }])
    expect(report.text.split("\n").slice(2, 4)).toEqual([
      "# Lints",
      "warning next-state-never-applied: next states of Dev/Flow are queued by Dev/Play @ update#0, but no described schedule has an applyStateTransitions() marker, so they never take effect"
    ])
  })

  it("explains the latest changes to a resource", () => {
    const runtime = Game.Runtime.make({ services: Game.Runtime.services(), resources: { Score: 0 }, debug: { hostClock } }).success
    const Add = Game.System("Dev/Add", { resources: { score: Game.System.writeResource(Score) } }, ({ resources }) => {
      resources.score.update((score) => score + 5)
    })
    const session = Session.make(runtime, { hostClock, schedules: { add: Game.Schedule(Add) } })
    session.run("add", { frames: 2 })
    expect(session.whyResource(Score).text).toBe([
      "Dev/Score is now 10; last 2 changes (oldest first):",
      "f1 add  Dev/Add  resource Dev/Score 0 -> 5",
      "f2 add  Dev/Add  resource Dev/Score 5 -> 10"
    ].join("\n"))
  })
})

describe("describe-only schedules", () => {
  const Renderer = Descriptor.Service<{ readonly draw: (hits: number) => void }>()("Dev/Renderer")
  const DrawHits = Game.System("Dev/DrawHits", {
    events: { hit: Game.System.readEvent(Hit) },
    services: { renderer: Game.System.service(Renderer) }
  }, ({ events, services }) => {
    services.renderer.draw(events.hit.all().length)
  })

  const headless = () => Game.Runtime.make({
    services: Game.Runtime.services(),
    resources: { Score: 0 },
    machines: Game.Runtime.machines(Game.Runtime.machine(Flow, "Playing")),
    debug: { hostClock }
  }).success
  const update = Game.Schedule(Damage)

  it("counts their reads in lints without making them runnable", () => {
    const lintCodes = (session: { describe: () => { data: { lints: ReadonlyArray<{ code: string; message: string }> } } }) =>
      session.describe().data.lints.filter((lint) => lint.message.includes("Dev/Hit")).map((lint) => lint.code)

    const without = Session.make(headless(), { hostClock, schedules: { update } })
    expect(lintCodes(without)).toContain("event-never-read")

    const withRender = Session.make(headless(), { hostClock, schedules: { update }, describe: { render: Game.Schedule(DrawHits) } })
    expect(lintCodes(withRender)).not.toContain("event-never-read")
    expect(withRender.describe().data.schedules.map((schedule) => schedule.name).sort()).toEqual(["render", "update"])
    // The renderer is shown as needed but not provided, which is not a lint.
    expect(withRender.describe().data.services).toContainEqual({ name: "Dev/Renderer", provided: false })
  })

  it("rejects a name used for both a runnable and a described-only schedule", () => {
    expect(() => Session.make(headless(), { hostClock, schedules: { update }, describe: { update: Game.Schedule(DrawHits) } })).toThrow(/both a runnable/)
  })
})


describe("Session risk checks", () => {
  const Velocity = Descriptor.Component<{ readonly x: number }>()("Risk/Velocity")
  const Shot = Descriptor.Component<{ readonly speed: number }>()("Risk/Shot")
  const Total = Descriptor.Resource<{ readonly sum: number }>()("Risk/Total")
  const Blast = Descriptor.Event<{ readonly force: number }>()("Risk/Blast")
  const RiskGame = Schema.bind(Schema.fragment({ components: { Velocity, Shot }, resources: { Total }, events: { Blast } }))

  const makeRiskSession = (update: ReturnType<typeof RiskGame.Schedule>) => {
    const runtime = RiskGame.Runtime.make({ services: RiskGame.Runtime.services(), resources: { Total: { sum: 0 } }, debug: { hostClock } }).success
    return Session.make(runtime, { hostClock, schedules: { update } })
  }

  it("warns about NaN and infinite numbers in writes, resources, events, and spawns", () => {
    const SpawnMover = RiskGame.System("Risk/SpawnMover", { commands: RiskGame.System.commands(RiskGame.System.spawns(Velocity, Shot)) }, ({ commands }) => {
      commands.spawn(RiskGame.Command.spawn([Velocity, { x: 1 }], [Shot, { speed: Number.POSITIVE_INFINITY }]))
    })
    const Normalize = RiskGame.System("Risk/Normalize", {
      queries: { movers: RiskGame.Query({ selection: { velocity: RiskGame.Query.write(Velocity) } }) },
      resources: { total: RiskGame.System.writeResource(Total) },
      events: { blast: RiskGame.System.writeEvent(Blast) }
    }, ({ queries, resources, events }) => {
      for (const { data } of queries.movers.each()) data.velocity.set({ x: 0 / 0 })
      resources.total.set({ sum: 1 / 0 })
      events.blast.emit({ force: Number.NaN })
    })
    const session = makeRiskSession(RiskGame.Schedule(SpawnMover, RiskGame.Schedule.applyDeferred(), Normalize))
    const run = session.run("update", { frames: 2 })
    expect(run.data.warnings).toEqual({ "non-finite-value": 9 })
    expect(session.report().data.warnings.map((warning) => warning.message)).toEqual([
      "Risk/SpawnMover wrote a NaN or infinite number to e1 Risk/Shot.speed (first at f1; why() shows its history)",
      "Risk/Normalize wrote a NaN or infinite number to e1 Risk/Velocity.x (first at f1; why() shows its history)",
      "Risk/Normalize wrote a NaN or infinite number to Risk/Total.sum (first at f1; why() shows its history)",
      "Risk/Normalize wrote a NaN or infinite number to Risk/Blast[0].force (first at f1; why() shows its history)"
    ])
  })

  it("warns about counts that rise through a whole run, not about bursts that are cleaned up", () => {
    const Fire = RiskGame.System("Risk/Fire", { commands: RiskGame.System.commands(RiskGame.System.spawns(Shot)) }, ({ commands }) => {
      commands.spawn(RiskGame.Command.spawn([Shot, { speed: 1 }]))
    })
    const leaking = makeRiskSession(RiskGame.Schedule(Fire, RiskGame.Schedule.applyDeferred()))
    const leak = leaking.run("update", { frames: 80 })
    expect(leak.data.growing).toEqual([{ component: "Risk/Shot", start: 0, peak: 80, end: 80 }])
    expect(leak.data.entities).toEqual({ start: 0, peak: 80, end: 80 })
    expect(leak.text.split("\n")[1]).toBe("warnings during the run (see report()): population-growing x1")
    expect(leaking.report().text).toContain("# Population: 80 entities\nRisk/Shot: 80")

    // A run too short to judge is not checked.
    expect(makeRiskSession(RiskGame.Schedule(Fire, RiskGame.Schedule.applyDeferred())).run("update", { frames: 30 }).data.growing).toEqual([])

    // Shots live 20 frames, so the count rises and then stays level.
    const Expire = RiskGame.System("Risk/Expire", {
      queries: { shots: RiskGame.Query({ selection: { shot: RiskGame.Query.write(Shot) } }) },
      commands: RiskGame.System.commands(RiskGame.System.despawns(Shot))
    }, ({ queries, commands }) => {
      for (const { entity, data } of queries.shots.each()) {
        const speed = data.shot.get().speed + 1
        if (speed > 20) commands.despawn(entity)
        else data.shot.set({ speed })
      }
    })
    const bounded = makeRiskSession(RiskGame.Schedule(Fire, Expire, RiskGame.Schedule.applyDeferred()))
    const steady = bounded.run("update", { frames: 200 })
    expect(steady.data.growing).toEqual([])
    expect(steady.data.warnings).toEqual({})
  })
})
